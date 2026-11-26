// HUD on a phone: what the top tab and the dock hold, and what a tap does (ticket #39; SPEC §5.12 phone table, §9 pause).
// Node seam, as in HudTabs.test.ts: Hud() is called as a plain function, its components are rendered by hand, and the
// result is read as text and boxes. CSS is not visible here, so the tab and dock arrangement on screen is checked by the
// browser script (e2e/hud.e2e.mjs). The media query stub reports the phone query as matching, so Hud takes the phone path: a click bubbles from the speed button to the speed group, which steps the speed.
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import { fmtMoney } from '@/core/ui/logic';
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
/** A rendered host element (a button, a div) and its rendered children. */
interface Box {
  tag: string;
  props: Record<string, any>;
  kids: Kid[];
}
type Kid = Box | string;

/** Expands components by calling them (their hooks are stubbed). Host elements stay as boxes, so an onClick can be called. */
function render(v: Node, depth = 0): Kid[] {
  if (v === null || v === undefined || typeof v === 'boolean') {
    return [];
  }
  if (typeof v === 'string' || typeof v === 'number') {
    return [String(v)];
  }
  if (Array.isArray(v)) {
    return v.flatMap((x) => render(x, depth));
  }
  if (typeof v !== 'object' || !('props' in v)) {
    return [];
  }
  const el = v;
  if (typeof el.type === 'function') {
    if (depth > 80) {
      return [];
    }
    let out: unknown;
    try {
      out = (el.type as (p: Record<string, unknown>) => unknown)(el.props);
    } catch {
      return [];
    }
    return render(out as Node, depth + 1);
  }
  return [{ tag: String(el.type), props: el.props, kids: render(el.props['children'] as Node, depth + 1) }];
}

const hostsIn = (b: Box): Box[] => [b, ...b.kids.flatMap((k) => (typeof k === 'string' ? [] : hostsIn(k)))];
const textOf = (k: Kid): string => (typeof k === 'string' ? k : k.kids.map(textOf).join(''));
const labelOf = (b: Box): string => String(b.props['aria-label'] ?? '');
const find = (box: Box, pred: (b: Box) => boolean): Box | undefined => hostsIn(box).find((b) => pred(b));
const last = (xs: Box[]): Box => {
  const xsItem = xs.at(-1);
  assert.exists(xsItem);
  return xsItem;
};

/** The chain of boxes from the top of the tree down to the first box that matches (the match is the last item). */
function pathTo(kids: Kid[], pred: (b: Box) => boolean, up: Box[] = []): Box[] | null {
  for (const k of kids) {
    if (typeof k === 'string') {
      continue;
    }
    const here = [...up, k];
    if (pred(k)) {
      return here;
    }
    const found = pathTo(k.kids, pred, here);
    if (found) {
      return found;
    }
  }
  return null;
}

/** The deepest box that holds both chains: the one tab that a player reads both things in. */
function sharedBox(a: Box[], b: Box[]): Box {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++;
  }
  const aItem = a[i - 1];
  assert.exists(aItem);
  return aItem;
}

let Hud: () => unknown;
let store: typeof storeApi;
let base: Snapshot;

/**
 * Loads the HUD fresh, with a new game on it. The window is a desktop one (1920 wide); `phoneQuery` is whether matchMedia
 * matches the phone query `(max-width: 48em)`. That query is the only phone check, so the width stays at the desktop value.
 */
async function loadHud(phoneQuery = true, width = 1920): Promise<void> {
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
    querySelector: () => null,
    querySelectorAll: () => [],
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
    innerWidth: width,
    innerHeight: 844,
    addEventListener: () => {
      /* no-op */
    },
    removeEventListener: () => {
      /* no-op */
    },
    matchMedia: (q: string) => ({
      matches: phoneQuery && q === '(max-width: 48em)',
      addEventListener: () => {
        /* no-op */
      },
    }),
  });
  ({ Hud } = (await import('@/core/ui/Hud')) as unknown as { Hud: () => unknown });
  store = await import('@/app/store');
  base = new Game({ seed: 7 }).snapshot();
  store.snapshot.value = base;
}

/**
 * One render of the HUD, read the way a player reads it: the top tab (the box that holds the money and the Menu), the dock
 * (the box that holds the Inventory and the Job log) and the buttons. All come from one render, so boxes compare by identity.
 */
function hud() {
  const tree = render(Hud() as Node);
  const money = pathTo(tree, (b) => b.props['data-hud'] === 'money');
  const menu = pathTo(tree, (b) => b.tag === 'button' && labelOf(b) === 'Menu');
  const shop = pathTo(tree, (b) => b.props['data-hud'] === 'shop');
  const inventory = pathTo(tree, (b) => b.tag === 'button' && labelOf(b).startsWith('Inventory, '));
  const joblog = pathTo(tree, (b) => b.props['data-hud'] === 'joblog');
  expect(money, 'the money is on the HUD').not.toBeNull();
  expect(menu, 'the Menu button is on the HUD').not.toBeNull();
  expect(shop, 'the Shop button is on the HUD').not.toBeNull();
  expect(inventory, 'the Inventory button is on the HUD').not.toBeNull();
  expect(joblog, 'the Job log button is on the HUD').not.toBeNull();
  assert.exists(money);
  expect(textOf(last(money)), 'the money reads the balance').toBe(fmtMoney(base.money));
  assert.exists(menu);
  assert.exists(inventory);
  assert.exists(joblog);
  assert.exists(shop);
  return {
    money: last(money),
    topTab: sharedBox(money, menu),
    dock: sharedBox(inventory, joblog),
    menu: last(menu),
    shop: last(shop),
  };
}

/** A tap on the control in `box` that reads `label` exactly (a speed step). */
function tapText(box: Box, label: string): void {
  const path = pathTo([box], (x) => typeof x.props['onClick'] === 'function' && textOf(x).trim() === label);
  expect(path, `a tap target reads "${label}" in the top tab`).not.toBeNull();
  // A real click bubbles: the target first, then each parent up to the top. The speed group handles it on a phone.
  const ev = { target: { closest: () => null } };
  assert.exists(path);
  for (const b of [...path].toReversed()) {
    (b.props['onClick'] as ((e: unknown) => void) | undefined)?.(ev);
  }
}

/** A press on the control in `box` whose accessible name matches `name`. */
function pressNamed(box: Box, name: RegExp): void {
  const b = find(box, (x) => typeof x.props['onClick'] === 'function' && name.test(labelOf(x)));
  expect(b, `a control named ${name} is in the top tab`).toBeDefined();
  assert.exists(b);
  (b.props['onClick'] as () => void)();
}

describe('HUD on a phone: the top tab, the dock and the taps', () => {
  beforeEach(async () => loadHud());

  it('the level, the pause control and the Menu are in the top tab with the money', () => {
    const h = hud();
    expect(
      find(h.topTab, (b) => /^Level \d+,/u.test(labelOf(b))),
      'the level is in the top tab',
    ).toBeDefined();
    expect(
      find(h.topTab, (b) => /^(?:Pause|Resume|Held)$/u.test(labelOf(b))),
      'the pause control is in the top tab',
    ).toBeDefined();
    expect(hostsIn(h.topTab)).toContain(h.menu);
  });

  it('the Shop is not in the top tab; the dock holds Inventory, Shop, Power lens, Almanac and Job log', () => {
    const h = hud();
    expect(hostsIn(h.topTab)).not.toContain(h.shop);
    const inDock = (ok: (b: Box) => boolean) => find(h.dock, ok) !== undefined;
    expect(
      inDock((b) => b.tag === 'button' && labelOf(b).startsWith('Inventory, ')),
      'Inventory is in the dock',
    ).toBe(true);
    expect(
      inDock((b) => b.props['data-hud'] === 'shop'),
      'Shop is in the dock',
    ).toBe(true);
    expect(
      inDock((b) => b.props['data-hud'] === 'lens'),
      'Power lens (the Lens branch) is in the dock',
    ).toBe(true);
    expect(
      inDock((b) => b.props['data-hud'] === 'almanac'),
      'Almanac is in the dock',
    ).toBe(true);
    expect(
      inDock((b) => b.props['data-hud'] === 'joblog'),
      'Job log is in the dock',
    ).toBe(true);
    expect(hostsIn(h.dock)).not.toContain(h.money);
  });

  it('a tap on the speed steps to the next speed: 1x runs at 2x', () => {
    store.setSpeed(4);
    tapText(hud().topTab, '1x');
    expect(store.speed.value, 'from 1x a tap runs at 2x').toBe(8);
  });

  it('a tap on the last speed wraps to the first: 3x runs at 0.25x', () => {
    store.setSpeed(12);
    tapText(hud().topTab, '3x');
    expect(store.speed.value, 'from 3x a tap wraps to 0.25x').toBe(1);
  });

  it('the pause control in the top tab pauses a running game and resumes it at the same speed', () => {
    store.setSpeed(8);
    pressNamed(hud().topTab, /^Pause$/u);
    expect(store.speed.value, 'paused').toBe(0);
    pressNamed(hud().topTab, /^Resume$/u);
    expect(store.speed.value, 'resumed at 2x').toBe(8);
  });

  it('the top tab says Paused while the game is paused', () => {
    store.setSpeed(0);
    expect(textOf(hud().topTab)).toContain('Paused');
  });

  it('a 700px window with matchMedia false is not a phone: a tap on 3x runs at 3x, it does not step', async () => {
    await loadHud(false, 700);
    store.setSpeed(4);
    tapText(hud().topTab, '3x');
    expect(store.speed.value, 'on a desktop a tap runs the speed it names').toBe(12);
  });
});
