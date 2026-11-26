// The New game screen (ticket #37; SPEC §5.1 and §5.4). The node test run has no DOM, so MainMenu and NewGameScreen are called as plain
// functions and their returned trees are walked. Hooks are stubbed. Written before the coder's changes: the two-click and red-label rules
// fail until they land. Copy is the SPEC text the player sees, not class names.
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import type * as storeApi from '@/app/store';
import type * as mainMenuApi from '@/core/ui/panels/MainMenu';
import type * as newGameApi from '@/core/ui/panels/NewGame';

vi.mock('preact/hooks', () => ({
  useEffect: () => {
    /* no-op */
  },
  useRef: () => ({ current: null }),
  useState: (v: unknown) => [
    v,
    () => {
      /* no-op */
    },
  ],
}));
vi.mock(import('@/app/store'), async (importOriginal) => ({
  ...(await importOriginal<typeof storeApi>()),
  startNewGame: vi.fn<typeof storeApi.startNewGame>(),
}));

interface VEl {
  type: unknown;
  props: Record<string, any>;
}
type Node = VEl | string | number | boolean | null | undefined | Node[];

const elements = (v: Node): VEl[] => {
  if (Array.isArray(v)) {
    return v.flatMap((child) => elements(child));
  }
  if (v && typeof v === 'object' && 'props' in v) {
    return [v];
  }
  return [];
};
const childrenOf = (el: VEl): Node => el.props['children'] as Node;
function all(v: Node): VEl[] {
  return elements(v).flatMap((el) => [el, ...all(childrenOf(el))]);
}
function text(v: Node): string {
  if (typeof v === 'string' || typeof v === 'number') {
    return String(v);
  }
  if (Array.isArray(v)) {
    return v.map((child) => text(child)).join('');
  }
  if (v && typeof v === 'object' && 'props' in v) {
    return text(childrenOf(v));
  }
  return '';
}
const titleOf = (row: VEl) => text(childrenOf(row)).trim();

let MainMenu: typeof mainMenuApi.MainMenu;
let NewGameScreen: typeof newGameApi.NewGameScreen;
let store: typeof storeApi;

beforeEach(async () => {
  vi.resetModules();
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  vi.stubGlobal('document', {
    activeElement: null,
    getElementById: () => null,
    contains: () => false,
    documentElement: {
      setAttribute: () => {
        /* no-op */
      },
      style: {
        setProperty: () => {
          /* no-op */
        },
      },
      classList: {
        toggle: () => {
          /* no-op */
        },
        add: () => {
          /* empty */
        },
        remove: () => {
          /* empty */
        },
      },
    },
  });
  vi.stubGlobal('window', {
    addEventListener: () => {
      /* no-op */
    },
    removeEventListener: () => {
      /* no-op */
    },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {
        /* no-op */
      },
    }),
  });
  ({ MainMenu } = await import('@/core/ui/panels/MainMenu'));
  ({ NewGameScreen } = await import('@/core/ui/panels/NewGame'));
  store = await import('@/app/store');
  store.autosaveOffer.value = null;
  store.previousOffer.value = null;
});

const save = () => JSON.parse(JSON.stringify(new Game({ seed: 7 }).toSave()));

/** The main menu's nav rows, as rendered with the current signals. */
function menuRows() {
  const tree = MainMenu({ ready: true }) as unknown as Node;
  const nav = all(tree).find((el) => el.props['aria-label'] === 'Main menu');
  if (!nav) {
    throw new Error('no Main menu nav');
  }
  return elements(childrenOf(nav)).filter((el) => String(el.props['class'] ?? '').includes('mm-btn'));
}

/** The New game screen's buttons, as rendered with the current signals. */
function screenButtons(): VEl[] {
  const tree = NewGameScreen() as unknown as Node;
  if (!tree) {
    throw new Error('New game screen did not open');
  }
  return all(tree).filter((el) => el.type === 'button');
}
const buttonNamed = (buttons: VEl[], re: RegExp) => {
  const hit = buttons.filter((b) => re.test(text(childrenOf(b)).trim()));
  if (hit.length !== 1) {
    throw new Error(`expected one button matching ${re}, found ${hit.length}`);
  }
  assert.exists(hit[0]);
  return hit[0];
};
const allText = (v: Node): string => text(v);
/** Opens the New game screen the way the player does: the menu row. */
const openFromMenu = () => {
  const newGameMenuRow = menuRows().find((r) => titleOf(r).startsWith('New game'));
  assert.exists(newGameMenuRow);
  return newGameMenuRow.props['onClick']();
};

describe('New game reaches the game in two clicks', () => {
  it('no save: New game, then Start starts the game once, with no second confirm', () => {
    const rows = menuRows();
    const newGame = rows.find((r) => titleOf(r).startsWith('New game'));
    assert.exists(newGame);
    newGame.props['onClick'](); // click 1: opens the screen
    const buttons = screenButtons();
    expect(buttons.map((b) => text(childrenOf(b)).trim())).not.toContain('Replace and start');
    buttonNamed(buttons, /^Start$/u).props['onClick'](); // click 2: starts
    expect(vi.mocked(store.startNewGame)).toHaveBeenCalledOnce(); // one call: no confirm step in between
  });

  it('with a save: New game, then Replace save and start starts the game once, with no second confirm', () => {
    store.autosaveOffer.value = save();
    const rows = menuRows();
    const newGame = rows.find((r) => titleOf(r).startsWith('New game'));
    assert.exists(newGame);
    newGame.props['onClick'](); // click 1
    const buttons = screenButtons();
    expect(buttons.map((b) => text(childrenOf(b)).trim())).not.toContain('Replace and start');
    buttonNamed(buttons, /^Replace save and start$/u).props['onClick'](); // click 2
    expect(vi.mocked(store.startNewGame)).toHaveBeenCalledOnce(); // one call: no confirm step in between
  });
});

describe('the hero label names what is replaced', () => {
  it('with a save: the hero reads Replace save and start, and the meta names the autosave', () => {
    store.autosaveOffer.value = save();
    openFromMenu();
    const buttons = screenButtons();
    buttonNamed(buttons, /^Replace save and start$/u);
    expect(allText(NewGameScreen() as unknown as Node)).toMatch(/Overwrites your autosave: Level \d+ · \$[\d,]+/u);
  });

  it('with no save: the hero reads Start and there is no warning', () => {
    openFromMenu();
    const buttons = screenButtons();
    buttonNamed(buttons, /^Start$/u);
    expect(allText(NewGameScreen() as unknown as Node)).not.toContain('Overwrites your autosave');
  });
});

describe('Back returns to the opener', () => {
  it('Back closes the screen and the main menu shows its New game row again', () => {
    openFromMenu();
    buttonNamed(screenButtons(), /^← Back/u).props['onClick']();
    expect(() => screenButtons()).toThrow(/New game screen did not open/u);
    expect(menuRows().some((r) => titleOf(r).startsWith('New game'))).toBe(true);
  });
});
