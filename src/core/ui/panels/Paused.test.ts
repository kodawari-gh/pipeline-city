// The Paused screen and the menu family (ticket #40; SPEC §5.10, §9, §10, §11.2; ACCEPTANCE 10).
// Written before src/core/ui/panels/Paused.ts exists: the Paused-screen tests fail until it lands. That module is loaded by a
// dynamic import, so the family and Space tests run on their own. Signatures assumed here:
//   PAUSE_SPINE: readonly string[]: the primary spine labels in order, Resume first, then the utilities.
//   PAUSED_ANNOUNCE: string: the screen-reader text on open, 'Paused. Clock stopped.'.
//   utilityLists(phone: boolean): { files, tools, help }: the labels of each utility list.
//   escTarget(layers: { list: boolean; menu: boolean }): 'list' | 'menu' | null: what one Esc closes (the inner list first).
//   Paused(): the screen's component. Its tree has a role="status" element and role="menuitem" rows.
// The menu family (state.ts) and the Space key (Hud.tsx PauseKey) exist already and are driven directly here.
import { batch, effect } from '@preact/signals';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';

const hooks = vi.hoisted(() => ({ effects: [] as (() => unknown)[] }));
vi.mock('preact/hooks', () => ({
  useEffect: (fn: () => unknown) => { hooks.effects.push(fn); },
  useRef: () => ({ current: null }),
  useState: (v: unknown) => [v, () => {}],
}));

type VEl = { type: unknown; props: Record<string, any> };
type Node = VEl | string | number | boolean | null | undefined | Node[];
type Key = { type: 'keydown' | 'keyup'; code: string; key: string; target: object; repeat: boolean; preventDefault: () => void };
type PausedMod = {
  PAUSE_SPINE: readonly string[];
  PAUSED_ANNOUNCE: string;
  utilityLists: (phone: boolean) => { files: string[]; tools: string[]; help: string[] };
  escTarget: (layers: { list: boolean; menu: boolean }) => 'list' | 'menu' | null;
  Paused: () => unknown;
};
type State = typeof import('@/core/ui/state');
type Store = typeof import('@/app/store');

let st: State;
let store: Store;
let Hud: () => unknown;
let base: Snapshot;
let onPage: Set<string>;
let listeners: Record<string, ((e: Key) => void)[]>;

const elements = (v: Node): VEl[] => {
  if (Array.isArray(v)) return v.flatMap(elements);
  if (v && typeof v === 'object' && 'props' in v) return [v];
  return [];
};
const childrenOf = (el: VEl): Node => el.props.children as Node;
function all(v: Node): VEl[] {
  return elements(v).flatMap((el) => [el, ...all(childrenOf(el))]);
}
/** The text a rendered node shows, in order. */
function textOf(v: Node): string {
  if (v === null || v === undefined || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  if ('props' in v) return textOf(childrenOf(v));
  return '';
}

const importPaused = () => import('@/core/ui/panels/Paused') as unknown as Promise<PausedMod>;

beforeEach(async () => {
  vi.resetModules();
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  });
  onPage = new Set();
  vi.stubGlobal('document', {
    activeElement: null,
    querySelector: (sel: string) => (sel.split(',').some((part) => onPage.has(part.trim())) ? {} : null),
    documentElement: { setAttribute: () => {}, style: { setProperty: () => {} }, classList: { toggle: () => {}, add: () => {}, remove: () => {} } },
  });
  listeners = {};
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: (e: Key) => void) => { (listeners[type] ??= []).push(fn); },
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
  const pk = all(Hud() as unknown as Node).find((el) => typeof el.type === 'function' && (el.type as { name?: string }).name === 'PauseKey');
  expect(pk, 'PauseKey is in the HUD').toBeDefined();
  hooks.effects = [];
  (pk!.type as () => unknown)();
  for (const fn of hooks.effects) fn();
}
const press = (type: 'keydown' | 'keyup'): void => {
  const e: Key = { type, code: 'Space', key: ' ', target: { tagName: 'BODY', isContentEditable: false }, repeat: false, preventDefault: () => {} };
  for (const fn of listeners[type] ?? []) fn(e);
};
const speed = () => store.speed.value;

describe('the menu family holds the clock as one holder', () => {
  it('Paused, Settings, Paused and Resume: the clock stops once and restarts once, at its speed', () => {
    store.setSpeed(2);
    const seen: number[] = [];
    const stop = effect(() => { seen.push(store.speed.value); });
    st.gameMenuOpen.value = true;
    expect(speed()).toBe(0);
    // The Paused Settings row: the menu closes and Settings opens in one batch, so the clock is never released between them.
    batch(() => { st.gameMenuOpen.value = false; st.openSettings('paused'); });
    expect(speed()).toBe(0);
    expect(st.holdActive.value).toBe(true);
    st.closeSettings();
    expect(st.gameMenuOpen.value).toBe(true);
    expect(speed()).toBe(0);
    st.gameMenuOpen.value = false;
    expect(speed()).toBe(2);
    stop();
    expect(seen, 'no speed change between the menu and Settings').toEqual([2, 0, 2]);
  });

  it('Paused, Controls and back to Paused: the clock stays stopped and one holder stays on', () => {
    store.setSpeed(2);
    st.gameMenuOpen.value = true;
    st.openControlsFromMenu();
    expect(speed()).toBe(0);
    expect(st.holdActive.value).toBe(true);
    st.closeControls();
    expect(st.gameMenuOpen.value).toBe(true);
    expect(speed()).toBe(0);
    expect(st.holdActive.value).toBe(true);
  });
});

describe('Space while the menu is open', () => {
  it('does not resume a clock that the menu stopped, and does not toggle it', () => {
    store.setSpeed(2);
    st.gameMenuOpen.value = true;
    mountPauseKey();
    press('keydown');
    press('keyup');
    expect(speed(), 'Space must not resume the game').toBe(0);
    expect(st.gameMenuOpen.value).toBe(true);
  });

  it('does not resume while Controls opened from Paused is open', () => {
    store.setSpeed(2);
    st.gameMenuOpen.value = true;
    st.openControlsFromMenu();
    mountPauseKey();
    press('keydown');
    press('keyup');
    expect(speed()).toBe(0);
    expect(st.controlsOpen.value).toBe(true);
  });
});

describe('the Save now row while a save is in flight (SPEC 5.10)', () => {
  const saveMeta = async (): Promise<string> => {
    const P = await importPaused();
    st.gameMenuOpen.value = true;
    const row = all(P.Paused() as Node).find((el) => el.props.role === 'menuitem' && textOf(el.props.children as Node).includes('Save now'));
    expect(row, 'a Save now row').toBeDefined();
    return textOf(row!.props.children as Node);
  };
  const pending = () => store.saving;

  it('shows "saving" while pending and "saved" once it completes', async () => {
    store.autosaveAt.value = Date.now() - 10_000;
    pending().value = true;
    expect(await saveMeta()).toMatch(/saving/);
    pending().value = false;
    const after = await saveMeta();
    expect(after).toMatch(/saved/);
    expect(after).not.toMatch(/saving/);
  });
});

describe('Enter activates and Space does nothing on the open menu', () => {
  it('Resume closes the menu on activation; Space on the menu layer is not handled as a key', async () => {
    const P = await importPaused();
    st.gameMenuOpen.value = true;
    const tree = P.Paused() as Node;
    const layer = all(tree).find((el) => typeof el.props.onKeyDown === 'function');
    let prevented = false;
    layer?.props.onKeyDown({ key: ' ', code: 'Space', target: null, preventDefault: () => { prevented = true; } });
    expect(prevented, 'the menu does not act on Space').toBe(false);
    expect(st.gameMenuOpen.value).toBe(true);
    const resume = all(tree).find((el) => el.props.role === 'menuitem' && textOf(el.props.children as Node).includes('Resume'));
    expect(typeof resume?.props.onClick, 'Resume is a button, so Enter clicks it').toBe('function');
    resume!.props.onClick();
    expect(st.gameMenuOpen.value).toBe(false);
  });
});

describe('Esc closes the inner layer first', () => {
  it('with a utility list open, Esc closes the list and Paused stays open', async () => {
    const P = await importPaused();
    expect(P.escTarget({ list: true, menu: true })).toBe('list');
  });

  it('with no list open, Esc closes Paused', async () => {
    const P = await importPaused();
    expect(P.escTarget({ list: false, menu: true })).toBe('menu');
  });

  it('with nothing open, Esc takes no action here', async () => {
    const P = await importPaused();
    expect(P.escTarget({ list: false, menu: false })).toBeNull();
  });
});

describe('the Paused screen', () => {
  it('the spine lists Resume first, then Save now, Settings, Controls, Main menu, then Files, Tools and Help', async () => {
    const P = await importPaused();
    expect(P.PAUSE_SPINE.slice(0, 5)).toEqual(['Resume', 'Save now', 'Settings', 'Controls', 'Main menu']);
    expect(P.PAUSE_SPINE.slice(5)).toEqual(['Files', 'Tools', 'Help']);
  });

  it('the first menu row rendered is Resume', async () => {
    const P = await importPaused();
    st.gameMenuOpen.value = true;
    const rows = all(P.Paused() as Node).filter((el) => el.props.role === 'menuitem');
    expect(rows.length).toBeGreaterThan(0);
    expect(textOf(rows[0]!.props.children as Node)).toContain('Resume');
  });

  it('opening it announces "Paused. Clock stopped." as a status', async () => {
    const P = await importPaused();
    expect(P.PAUSED_ANNOUNCE).toBe('Paused. Clock stopped.');
    st.gameMenuOpen.value = true;
    const status = all(P.Paused() as Node).find((el) => el.props.role === 'status');
    expect(status, 'a role="status" element on open').toBeDefined();
    expect(textOf(status!.props.children as Node)).toBe('Paused. Clock stopped.');
  });
});

describe("every item of today's menu has a place in Files, Tools or Help", () => {
  it('Files holds Export game, Import game and New game', async () => {
    const P = await importPaused();
    const files = P.utilityLists(false).files;
    for (const item of ['Export game', 'Import game', 'New game']) expect(files).toContain(item);
  });

  it('Tools holds Stats, Trace and Levels (today\'s labels, with the toggled wording)', async () => {
    const P = await importPaused();
    const tools = P.utilityLists(false).tools.map((t) => t.toLowerCase());
    for (const item of ['stats', 'trace', 'levels']) expect(tools.some((t) => t.includes(item))).toBe(true);
  });

  it('Help holds Replay tutorial and Show hints again', async () => {
    const P = await importPaused();
    const help = P.utilityLists(false).help;
    expect(help).toContain('Replay tutorial');
    expect(help).toContain('Show hints again');
  });

  it('Settings and Controls stay on the spine, not in a utility list', async () => {
    const P = await importPaused();
    const L = P.utilityLists(false);
    expect(P.PAUSE_SPINE).toContain('Settings');
    expect(P.PAUSE_SPINE).toContain('Controls');
    expect([...L.files, ...L.tools, ...L.help]).not.toContain('Controls');
  });

  it('the phone Tools list adds Zoom slow and the HUD segments (OS, net, power bill, machine state)', async () => {
    const P = await importPaused();
    const desktop = P.utilityLists(false).tools;
    const phone = P.utilityLists(true).tools;
    expect(desktop.some((t) => /zoom slow/i.test(t))).toBe(false);
    expect(phone.some((t) => /zoom slow/i.test(t))).toBe(true);
    expect(phone.some((t) => /^OS\b/.test(t))).toBe(true);
    expect(phone.length).toBeGreaterThan(desktop.length);
  });
});
