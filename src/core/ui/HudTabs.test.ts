// HUD in Edge tabs (ticket #39). Same node seam as Hud.test.ts: Hud is called as a plain function, its child components are
// found in the tree and called by hand, and their effects are run. Covered here: the speed rail (steps, pause state, slow
// motion) and the inset reporter (the bar's box is reported so cards and the camera keep clear of it).
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

const elements = (v: Node): VEl[] => {
  if (Array.isArray(v)) return v.flatMap(elements);
  if (v && typeof v === 'object' && 'props' in v) return [v];
  return [];
};
function all(v: Node): VEl[] {
  return elements(v).flatMap((el) => [el, ...all(el.props.children as Node)]);
}
/** Text content of a node, for reading what the player sees. */
function text(v: Node): string {
  if (Array.isArray(v)) return v.map(text).join('');
  if (v && typeof v === 'object' && 'props' in v) return text(v.props.children as Node);
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return '';
}

let Hud: () => unknown;
let st: typeof import('@/core/ui/state');
let store: typeof import('@/app/store');
let hover: typeof import('@/app/hover');
let base: Snapshot;

beforeEach(async () => {
  vi.resetModules();
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  });
  vi.stubGlobal('document', {
    activeElement: null,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { setAttribute: () => {}, style: { setProperty: () => {} }, classList: { toggle: () => {}, add: () => {}, remove: () => {} } },
  });
  vi.stubGlobal('window', {
    innerWidth: 1920, innerHeight: 1080,
    addEventListener: () => {}, removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  hooks.effects = [];
  ({ Hud } = (await import('@/core/ui/Hud')) as unknown as { Hud: () => unknown });
  st = await import('@/core/ui/state');
  store = await import('@/app/store');
  hover = await import('@/app/hover');
  base = new Game({ seed: 7 }).snapshot();
  store.snapshot.value = base;
});

/** Finds a child component by its function name in the HUD tree, and runs it with its effects. */
function mount(name: string): VEl {
  const el = all(Hud() as unknown as Node).find((e) => typeof e.type === 'function' && (e.type as { name?: string }).name === name);
  expect(el, `${name} is in the HUD`).toBeDefined();
  hooks.effects = [];
  const out = (el!.type as (p: Record<string, unknown>) => unknown)(el!.props) as Node;
  for (const fn of hooks.effects) fn();
  return { type: 'out', props: { children: out } };
}

const rail = (): VEl => mount('SpeedControl');
const button = (root: VEl, pred: (p: Record<string, any>) => boolean): VEl => {
  const b = all(root.props.children as Node).find((e) => e.type === 'button' && pred(e.props));
  expect(b, 'the control is on the rail').toBeDefined();
  return b!;
};

describe('HUD speed rail keeps its controls', () => {
  it('offers the campaign speeds 0.25x, 0.5x, 1x, 2x, 3x (no 0 step)', () => {
    const labels = all(rail().props.children as Node)
      .filter((e) => e.type === 'button' && String(e.props.title ?? '').startsWith('Run at '))
      .map((e) => text(e.props.children as Node).trim());
    expect(labels).toEqual(['0.25x', '0.5x', '1x', '2x', '3x']);
  });

  it('a speed step runs the game at that speed', () => {
    store.setSpeed(4);
    const r = rail();
    button(r, (p) => p.title === 'Run at 2x').props.onClick();
    expect(store.speed.value).toBe(8);
  });

  it('the pause button pauses a running game and resumes a paused one', () => {
    store.setSpeed(4);
    button(rail(), (p) => p.title === 'Pause (Space)').props.onClick();
    expect(store.speed.value).toBe(0);
    button(rail(), (p) => p.title === 'Resume (Space)').props.onClick();
    expect(store.speed.value).toBeGreaterThan(0);
  });

  it('the rail says "Paused" while paused by the player', () => {
    store.setSpeed(0);
    st.holdActive.value = false;
    expect(text(rail().props.children as Node)).toContain('Paused');
  });

  it('the rail says "Held" while a popup or the menu holds the clock, and the pause button does nothing', () => {
    store.setSpeed(0);
    st.setHold('menu', true);
    expect(text(rail().props.children as Node)).toContain('Held');
    button(rail(), (p) => p.title?.startsWith('Held')).props.onClick();
    expect(store.speed.value, 'a held clock is not lifted from the rail').toBe(0);
  });

  it('slow motion switch toggles zoomSlowOn', () => {
    const before = store.zoomSlowOn.value;
    button(rail(), (p) => p.title?.startsWith('Slow motion when zoomed in')).props.onClick();
    expect(store.zoomSlowOn.value).toBe(!before);
  });
});

describe('HUD reports its tabs to the inset reporter', () => {
  it('the bar bottom plus half a rem is the top inset, so the overview frames under it', () => {
    const bar = { getBoundingClientRect: () => ({ top: 0, bottom: 84, height: 84, left: 0, right: 1920, width: 1920 }), style: { setProperty: () => {} }, classList: { contains: () => false } };
    vi.stubGlobal('document', {
      activeElement: null,
      getElementById: () => ({ style: { setProperty: () => {} } }),
      querySelector: () => null,
      querySelectorAll: (sel: string) => (sel === '.hud-side' ? [bar] : []),
      documentElement: { setAttribute: () => {}, style: { setProperty: () => {} }, classList: { toggle: () => {}, add: () => {}, remove: () => {} } },
    });
    vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' }));
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
    hover.viewInset.value = { top: 0, right: 0, bottom: 0, left: 0 };
    mount('InsetReporter');
    expect(hover.viewInset.value.top).toBe(92);
  });
});
