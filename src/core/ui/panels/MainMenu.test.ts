// The main menu rows (ticket #36; SPEC §5.1 to §5.3). The node test run has no DOM, so MainMenu is called as a plain
// function and its returned tree is walked. Hooks are stubbed. Rows are the direct children of the nav "Main menu".
// Written before the coder's changes: the spine and loading rules fail until they land.
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import type * as mainMenuApi from '@/core/ui/panels/MainMenu';
import type * as storeApi from '@/app/store';

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

interface VEl {
  type: unknown;
  props: Record<string, any>;
}
type Node = VEl | string | number | boolean | null | undefined | Node[];

/** The element children of a node, with the nested arrays and empty values removed. */
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

/** Every element in the tree, depth first. */
function all(v: Node): VEl[] {
  return elements(v).flatMap((el) => [el, ...all(childrenOf(el))]);
}

/** The visible text of a node: its strings, in order. */
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

let MainMenu: typeof mainMenuApi.MainMenu;
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
  store = await import('@/app/store');
  store.autosaveOffer.value = null;
  store.previousOffer.value = null;
});

/** The menu's nav tree as rendered with the current signals. */
function render(ready = true) {
  const tree = MainMenu({ ready }) as unknown as Node;
  const nav = all(tree).find((el) => el.props['aria-label'] === 'Main menu');
  if (!nav) {
    throw new Error('no Main menu nav');
  }
  const rows = elements(childrenOf(nav)).filter((el) => String(el.props['class'] ?? '').includes('mm-btn'));
  return { nav, rows };
}

const save = () => JSON.parse(JSON.stringify(new Game({ seed: 7 }).toSave()));
const titleOf = (row: VEl) => text(childrenOf(row)).trim();

describe('the no-save menu', () => {
  it('shows no Continue row when there is no autosave', () => {
    const { rows } = render();
    expect(rows.map((row) => titleOf(row)).some((t) => t.startsWith('Continue'))).toBe(false);
  });

  it('shows Continue first when there is an autosave', () => {
    store.autosaveOffer.value = save();
    const { rows } = render();
    assert.exists(rows[0]);
    expect(titleOf(rows[0])).toMatch(/^Continue/u);
  });
});

describe('the Previous save row', () => {
  it('is not shown when no backup exists', () => {
    const { rows } = render();
    expect(rows.map((row) => titleOf(row)).some((t) => t.startsWith('Previous save'))).toBe(false);
  });

  it('is shown when a backup exists', () => {
    store.previousOffer.value = save();
    const { rows } = render();
    expect(rows.map((row) => titleOf(row)).some((t) => t.startsWith('Previous save'))).toBe(true);
  });
});

describe('spines are plain lists of buttons', () => {
  it('every row of the main menu is a button, not a label or a link', () => {
    store.autosaveOffer.value = save();
    store.previousOffer.value = save();
    const { rows } = render();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.type).toBe('button');
    }
  });

  it('Load file is a button too', () => {
    const { rows } = render();
    const load = rows.find((r) => titleOf(r).startsWith('Load file'));
    expect(load?.type).toBe('button');
  });
});

describe('the loading screen rows', () => {
  it('Build my PC and Gallery are disabled with the meta "after loading" while the world loads', () => {
    const { rows } = render(false);
    for (const name of ['Build my PC', 'Gallery']) {
      const row = rows.find((r) => titleOf(r).startsWith(name));
      expect(row, name).toBeDefined();
      assert.exists(row);
      expect(row.props['disabled'], name).toBe(true);
      expect(titleOf(row), name).toContain('after loading');
    }
  });

  it('the same two rows are enabled once the world is ready', () => {
    const { rows } = render(true);
    for (const name of ['Build my PC', 'Gallery']) {
      const row = rows.find((r) => titleOf(r).startsWith(name));
      assert.exists(row);
      expect(row.props['disabled'], name).toBeFalsy();
    }
  });
});

describe('left and right on the main menu', () => {
  it('do nothing on a row: the main menu has no value rows, so the key is not taken', () => {
    const tree = MainMenu({ ready: true }) as unknown as Node;
    const menu = all(tree).find((el) => typeof el.props['onKeyDown'] === 'function');
    assert.exists(menu);
    const row = { dataset: { group: '0' }, classList: { contains: () => false } };
    vi.stubGlobal('document', { activeElement: row, getElementById: () => null });
    for (const key of ['ArrowLeft', 'ArrowRight']) {
      const preventDefault = vi.fn();
      menu.props['onKeyDown']({ key, preventDefault });
      expect(preventDefault, key).not.toHaveBeenCalled();
    }
  });
});
