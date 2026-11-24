// Space on the Settings screen opened from the paused game (ticket #38). The node test run has no DOM, so Hud is called as a
// plain function: its PauseKey child is found in the tree and called, its effect is captured and run by hand, and the window
// key listeners that effect adds are the ones a player's Space reaches.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';

const hooks = vi.hoisted(() => ({ effects: [] as (() => unknown)[] }));
vi.mock('preact/hooks', () => ({
  useEffect: (fn: () => unknown) => {
    hooks.effects.push(fn);
  },
  useRef: () => ({ current: null }),
  useState: (v: unknown) => [v, () => {}],
}));

type VEl = { type: unknown; props: Record<string, any> };
type Node = VEl | string | number | boolean | null | undefined | Node[];
type Key = {
  type: 'keydown' | 'keyup';
  code: string;
  key: string;
  target: object;
  repeat: boolean;
  preventDefault: () => void;
};

const elements = (v: Node): VEl[] => {
  if (Array.isArray(v)) return v.flatMap(elements);
  if (v && typeof v === 'object' && 'props' in v) return [v];
  return [];
};
const childrenOf = (el: VEl): Node => el.props['children'] as Node;
function all(v: Node): VEl[] {
  return elements(v).flatMap((el) => [el, ...all(childrenOf(el))]);
}

/** Compound selectors that match an element on the fake page. The stub document answers querySelector by checking the real selector list. */
let onPage: Set<string>;
let Hud: () => unknown;
let st: typeof import('@/core/ui/state');
let store: typeof import('@/app/store');
let base: Snapshot;
let listeners: Record<string, ((e: Key) => void)[]>;

beforeEach(async () => {
  vi.resetModules();
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  // The HUD's document reads are PauseKey's. Nothing is on the page at first, so a Space reaches the pause.
  onPage = new Set();
  vi.stubGlobal('document', {
    activeElement: null,
    querySelector: (sel: string) => (sel.split(',').some((part) => onPage.has(part.trim())) ? {} : null),
    documentElement: {
      setAttribute: () => {},
      style: { setProperty: () => {} },
      classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    },
  });
  listeners = {};
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: (e: Key) => void) => {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  hooks.effects = [];
  ({ Hud } = (await import('@/core/ui/Hud')) as unknown as { Hud: () => unknown });
  st = await import('@/core/ui/state');
  store = await import('@/app/store');
  base = new Game({ seed: 7 }).snapshot();
  store.snapshot.value = base;
});

/** Calls the HUD's PauseKey child by hand, so its window key listeners are added. */
function mountPauseKey(): void {
  const pk = all(Hud() as unknown as Node).find(
    (el) => typeof el.type === 'function' && (el.type as { name?: string }).name === 'PauseKey',
  );
  expect(pk, 'PauseKey is in the HUD').toBeDefined();
  hooks.effects = [];
  (pk!.type as () => unknown)();
  for (const fn of hooks.effects) fn();
}

const press = (type: 'keydown' | 'keyup'): void => {
  const e: Key = {
    type,
    code: 'Space',
    key: ' ',
    target: { tagName: 'BODY', isContentEditable: false },
    repeat: false,
    preventDefault: () => {},
  };
  for (const fn of listeners[type] ?? []) fn(e);
};
const speed = () => store.speed.value;

describe('Space on the Settings screen opened from the paused game', () => {
  it('pauses the running game when nothing is open (the key works)', () => {
    store.setSpeed(2);
    mountPauseKey();
    press('keydown');
    expect(speed()).toBe(0);
  });

  it('does not toggle the pause while Settings is open from the paused menu', () => {
    store.setSpeed(2);
    st.gameMenuOpen.value = true; // the player opens the in-game menu: the clock stops
    st.gameMenuOpen.value = false; // the menu's Settings item closes it ...
    st.openSettings('paused'); // ... and opens Settings from it: the clock stays held
    expect(st.settingsOpen.value).toBe(true);
    expect(speed()).toBe(0);
    mountPauseKey();
    press('keydown');
    press('keyup');
    expect(speed(), 'Space must not resume the game').toBe(0);
    expect(st.gameMenuOpen.value).toBe(false);
  });

  it('ignores Space while an element matching .pl-menu.settings is on the page, even with the clock free', () => {
    store.setSpeed(2);
    onPage.add('.pl-menu.settings');
    mountPauseKey();
    press('keydown');
    press('keyup');
    expect(speed(), 'the settings guard must stop the toggle').toBe(2);
  });

  it('toggles the pause when no .pl-menu.settings element is on the page and the clock is free', () => {
    store.setSpeed(2);
    onPage.add('.unrelated');
    mountPauseKey();
    press('keydown');
    expect(speed()).toBe(0);
  });
});
