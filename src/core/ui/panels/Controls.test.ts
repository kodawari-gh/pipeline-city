// The controls reference (ticket #35): the mouse and touch lists, and Esc closing the inner layer first.
// The node test run has no DOM, so the component's effect is captured and run by hand: its window key listener
// is the same one a player's Esc reaches. Rows come from the exported MOUSE, TOUCH and KEYS lists.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';

const hooks = vi.hoisted(() => ({ effect: null as null | (() => unknown) }));
vi.mock('preact/hooks', () => ({
  useEffect: (fn: () => unknown) => {
    hooks.effect = fn;
  },
}));

type Rows = readonly (readonly [keys: readonly string[], does: string])[];
type Controls = typeof import('@/core/ui/panels/Controls');
type State = typeof import('@/core/ui/state');
type Store = typeof import('@/app/store');

let ctl: Controls;
let st: State;
let store: Store;
let keydowns: ((e: { key: string; preventDefault: () => void }) => void)[];

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
    contains: () => false,
    documentElement: {
      setAttribute: () => {},
      style: { setProperty: () => {} },
      classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    },
  });
  keydowns = [];
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === 'keydown') keydowns.push(fn as never);
    },
    removeEventListener: () => {},
  });
  ctl = await import('@/core/ui/panels/Controls');
  st = await import('@/core/ui/state');
  store = await import('@/app/store');
  store.snapshot.value = new Game({ seed: 7 }).snapshot() as Snapshot;
});

/** Renders the panel the way Preact would: the component runs, then its effect is attached to the window. */
function openPanel() {
  ctl.Controls();
  hooks.effect?.();
}
const press = (key: string) => {
  const e = { key, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  for (const fn of keydowns) fn(e);
  return e;
};
const keysOf = (rows: Rows) => rows.flatMap(([k]) => [...k]);

describe('mouse list', () => {
  it('shows the Double-click row, with its flight to a part or back to the room', () => {
    const row = ctl.MOUSE.find(([k]) => k.includes('Double-click'));
    expect(row?.[1]).toBe('Fly to a part, or back to the room');
  });

  it('does not list Shift-drag (it still works in the game, see pad.test.ts)', () => {
    expect(keysOf(ctl.MOUSE)).not.toContain('Shift-drag');
    expect(keysOf(ctl.MOUSE)).toContain('Right-drag');
  });
});

describe('touch list', () => {
  it('shows every current gesture: pan, pinch, two-finger turn, double-tap, tap and hold-drag', () => {
    expect(keysOf(ctl.TOUCH)).toEqual(
      expect.arrayContaining(['1 finger', 'Pinch', '2 fingers', 'Double-tap', 'Tap', 'Hold, drag']),
    );
    expect(ctl.TOUCH).toHaveLength(6);
  });
});

describe('Esc closes the inner layer first', () => {
  it('Esc closes Controls and brings the menu back when Controls came from the menu', () => {
    store.setSpeed(2);
    st.openControlsFromMenu();
    openPanel();
    const e = press('Escape');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(st.controlsOpen.value).toBe(false);
    expect(st.gameMenuOpen.value).toBe(true);
    expect(store.speed.value).toBe(0);
  });

  it('Esc closes Controls only when Controls came from the HUD: the menu stays closed', () => {
    store.setSpeed(2);
    st.controlsOpen.value = true;
    openPanel();
    press('Escape');
    expect(st.controlsOpen.value).toBe(false);
    expect(st.gameMenuOpen.value).toBe(false);
    expect(store.speed.value).toBe(2);
  });

  it('other keys do not close Controls', () => {
    st.controlsOpen.value = true;
    openPanel();
    press('a');
    expect(st.controlsOpen.value).toBe(true);
  });
});
