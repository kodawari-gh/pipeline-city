// Build my PC in edge tabs (ticket #41; SPEC §5.7). The node test run has no DOM, so the Build components are called as plain functions and
// their returned trees are walked (the same seam as MainMenu.test.ts). Hooks are stubbed. Written before the coder's changes: the lens rail,
// the Graphics and Power on rules fail until they land. The browser checks (the four viewports, no overlap, the part card) are not here.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_KINDS } from '@/features/economy/ui/shop/shopdata';
import { NET_KINDS } from '@/features/board/sim/buildnet';
import type * as BuildBarsTypes from './BuildBars';
import type * as BuildCardTypes from './BuildCard';
import type * as BuildMachineTypes from './BuildMachine';
import type * as BuildModeTypes from './BuildMode';
import type * as BuildShelfTypes from './BuildShelf';

/** The part of `node:fs` this test reads with (no @types/node in this project; tests only). */
interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string;
}
/** The part of `node:url` this test uses. */
interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}
const fs = await vi.importActual<NodeFs>('node:fs');
const { fileURLToPath } = await vi.importActual<NodeUrl>('node:url');

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const hook = vi.hoisted(() => ({ ref: null as unknown, fx: [] as (() => void)[] }));
vi.mock('preact/hooks', () => ({
  useEffect: vi.fn<() => void>(),
  useLayoutEffect: (f: () => void) => {
    hook.fx.push(f);
  },
  useRef: () => ({ current: hook.ref }),
  useState: (v: unknown) => [v, vi.fn<(next: unknown) => void>()],
  useMemo: (f: () => unknown) => f(),
  useCallback: (f: unknown) => f,
}));
vi.mock(import('@/features/board/ui/builddrag'), () => ({
  useBuildDrag: () => ({
    drag: null,
    begin: vi.fn<() => void>(),
    cancel: vi.fn<() => void>(),
    air: { current: false },
  }),
}));

/** An element of a rendered tree: what the component returned for it, before any DOM. */
interface VEl {
  type: unknown;
  props: Record<string, unknown>;
}

/** Whether `v` is an element (a node with props), not a string, a number, an empty value or a list. */
function isElement(v: unknown): v is VEl {
  return typeof v === 'object' && v !== null && 'props' in v && typeof v.props === 'object' && v.props !== null;
}

/** The element children of a node, with the nested arrays and empty values removed. */
function elements(v: unknown): VEl[] {
  if (Array.isArray(v)) {
    return v.flatMap((x: unknown) => elements(x));
  }
  if (isElement(v)) {
    return [v];
  }
  return [];
}
const childrenOf = (el: VEl): unknown => el.props['children'];

/** Every element in the tree, depth first. */
function all(v: unknown): VEl[] {
  const out: VEl[] = [];
  for (const el of elements(v)) {
    out.push(el, ...all(childrenOf(el)));
  }
  return out;
}

/** The visible text of a node: its strings, in order. */
function text(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number') {
    return String(v);
  }
  if (Array.isArray(v)) {
    return v.map((x: unknown) => text(x)).join('');
  }
  if (isElement(v)) {
    return text(childrenOf(v));
  }
  return '';
}

/** A prop that holds words (a class, a label, a title), or nothing when it holds none. */
const words = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Every button in a tree, with its text and its class. */
function buttons(v: unknown): { text: string; cls: string; el: VEl }[] {
  return all(v)
    .filter((el) => el.type === 'button')
    .map((el) => ({ text: text(childrenOf(el)).trim(), cls: words(el.props['class']), el }));
}

let BuildMode: typeof BuildModeTypes.BuildMode;
let ViewOptions: typeof BuildBarsTypes.ViewOptions;
let RunControls: typeof BuildBarsTypes.RunControls;
let Foot: typeof BuildBarsTypes.Foot;
let BuildShelf: typeof BuildShelfTypes.BuildShelf;
let BuildMachine: typeof BuildMachineTypes.BuildMachine;

beforeEach(async () => {
  const { buildOpen } = await import('@/core/ui/state');
  buildOpen.value = true; // (BuildMode draws nothing while the screen is shut)
  ({ BuildMode } = await import('./BuildMode'));
  ({ ViewOptions, RunControls, Foot } = await import('./BuildBars'));
  ({ BuildShelf } = await import('./BuildShelf'));
  ({ BuildMachine } = await import('./BuildMachine'));
});

/** The props of the first element of `type` in a tree, or fail with the name. */
function propsOf(tree: unknown, type: unknown, name: string): Record<string, unknown> {
  const hit = all(tree).find((el) => el.type === type);
  if (!hit) {
    throw new Error(`no ${name} in the Build tree`);
  }
  return hit.props;
}

/** Whether `v` is a list of words. */
const isWords = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** The `kinds` prop of the first element of `type` in a tree, or fail with the name. */
function kindsOf(tree: unknown, type: unknown, name: string): string[] {
  const { kinds } = propsOf(tree, type, name);
  if (!isWords(kinds)) {
    throw new Error(`${name} has no list of kinds`);
  }
  return kinds;
}

// (the kinds BuildMode passes today: the studio's kinds without the monitor and the network kinds, then the network kinds)
const current = () => [
  ...STUDIO_KINDS.filter((k) => k !== 'display' && !(NET_KINDS as readonly string[]).includes(k)),
  ...NET_KINDS,
];

describe('Build rail: every part kind is reachable (ticket #41)', () => {
  it('the shelf rail offers every kind the current Build rail offers, and no more', () => {
    const kinds = kindsOf(BuildMode(), BuildShelf, 'BuildShelf');
    expect(kinds.toSorted()).toStrictEqual(current().toSorted());
  });

  it('includes the kinds the spec names in the rail: VRM, RSK, NET, AI and SEC (vrm-sink, ram-sink, nic, npu, tpm)', () => {
    const kinds = kindsOf(BuildMode(), BuildShelf, 'BuildShelf');
    for (const k of ['vrm-sink', 'ram-sink', 'nic', 'npu', 'tpm']) {
      expect(kinds).toContain(k);
    }
  });

  it('the machine list gets the same kinds as the rail', () => {
    const tree = BuildMode();
    const shelfKinds = kindsOf(tree, BuildShelf, 'BuildShelf');
    const machineKinds = kindsOf(tree, BuildMachine, 'BuildMachine');
    expect(machineKinds.toSorted()).toStrictEqual(shelfKinds.toSorted());
  });
});

describe('Build lens rail and actions (ticket #41)', () => {
  it('the lens rail holds Power, Airflow and Graphics, and no Settings', () => {
    const labels = buttons(ViewOptions({ ready: true, stage: null, onBench: vi.fn<() => void>() })).map((b) => b.text);
    expect(labels.join(' ')).toMatch(/Power/u);
    expect(labels.join(' ')).toMatch(/Airflow/u);
    expect(labels.some((t) => t.includes('Graphics'))).toBe(true);
    expect(labels).not.toContain('Settings');
  });

  it('Graphics is in the lens rail, not in the Foot tools bar, and it opens a dialog (Settings)', () => {
    const footLabels = buttons(
      Foot({ stage: null, hint: '', onOs: vi.fn<() => void>(), pane: 'parts', onPane: vi.fn<() => void>() }),
    ).map((b) => b.text);
    expect(footLabels.some((t) => t.includes('Graphics'))).toBe(false);
    const gfx = buttons(ViewOptions({ ready: true, stage: null, onBench: vi.fn<() => void>() })).find((b) =>
      b.text.includes('Graphics'),
    );
    expect(gfx?.el.props['aria-haspopup']).toBe('dialog');
  });

  it('Power on is the solid main action in the run tab, and comes first there', () => {
    const run = buttons(RunControls({ stage: null, busy: false, bare: false }));
    expect(run[0]?.text).toMatch(/^Power (?:on|off)$/u);
    expect(run[0]?.cls).toMatch(/\b(?:solid|primary|accent)\b/u);
  });
});

const urlOf = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

/** The pieces the part card keeps out from under: the selectors of BuildMode's `avoid` list, read from its source. */
function avoidList(): string[] {
  const src = fs.readFileSync(urlOf('./BuildMode.tsx'), 'utf8');
  const list = /const avoid = \(\) =>\s*\[(?<list>[^\]]*)\]/u.exec(src)?.groups?.['list'] ?? '';
  return (list.match(/'[^']+'/gu) ?? []).map((s) => s.slice(1, -1));
}

/** The class a selector ends on: its last compound, past any combinator. */
const lastCompound = (sel: string): string =>
  sel
    .trim()
    .split(/\s+|>|\+|~/u)
    .findLast((part) => part !== '') ?? '';

/** The class each rule of ui.css ends on, for the rules that set `display: contents` and are not desk-only (so they apply on the phone). */
function contentsOnPhone(): string[] {
  const css = fs.readFileSync(urlOf('../../../core/ui/ui.css'), 'utf8').replaceAll(/\/\*[\s\S]*?\*\//gu, '');
  const out: string[] = [];
  for (const m of css.matchAll(/(?<selectors>[^{}]+)\{(?<body>[^{}]*)\}/gu)) {
    if (!/display\s*:\s*contents/u.test(m.groups?.['body'] ?? '')) {
      continue;
    }
    for (const sel of (m.groups?.['selectors'] ?? '').split(',')) {
      if (!sel.includes('data-layout="desk"')) {
        out.push(lastCompound(sel));
      }
    }
  }
  return out;
}

const classesOf = (sel: string): string[] => sel.match(/\.[\w-]+/gu) ?? [];

describe('the part card avoids the Build tabs on the phone (ticket #41)', () => {
  it('every piece in the avoid list has a real layout box on the phone (no display: contents)', () => {
    const avoid = avoidList();
    expect(avoid.length).toBeGreaterThan(0);
    const contents = contentsOnPhone();
    const boxless = avoid.filter((q) => contents.some((last) => classesOf(last).includes(q)));
    expect(boxless).toStrictEqual([]);
  });
});

/** The edges of a panel on the screen, in pixels. */
interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** A panel over the stage, as the part card measures it (the node run has no DOM to lay one out). */
const box = (edges: Edges) => ({ getBoundingClientRect: () => edges }) as unknown as HTMLElement;
/** The Build stage the part card reads (the node run has no 3D stage): one fitted part, anchored mid-screen. */
const cardStage = (spec: string) =>
  ({
    viewRev: { value: 0 },
    status: { value: { rev: 0, busy: false } },
    board: { devices: [{ id: 'd1', spec, slot: 's' }] },
    anchorOf: () => ({ x: 180, y: 400, w: 30, h: 30 }),
    plan: () => [],
    select: vi.fn<() => void>(),
  }) as unknown as Parameters<typeof BuildCardTypes.BuildCard>[0]['stage'];

describe('the part card stays on the phone screen (ticket #41)', () => {
  it('with no free strip left by the panels, the card is still inside 390x844', async () => {
    const { BuildCard } = await import('./BuildCard');
    const { DEVICE_SPECS } = await import('@/features/board/sim/specs');
    const spec = must(Object.keys(DEVICE_SPECS)[0]);
    const size = { w: 300, h: 220 };
    const el = {
      offsetWidth: size.w,
      offsetHeight: size.h,
      dataset: {} as Record<string, string>,
      style: { transform: '', setProperty: vi.fn<() => void>() },
    };
    vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844 });
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' }));
    try {
      const stage = cardStage(spec);
      hook.fx.length = 0;
      hook.ref = el;
      // the top bar and the bottom bar together cover the whole height, so the free strip is empty
      const top = box({ left: 0, top: 0, right: 390, bottom: 800 });
      const bottom = box({ left: 0, top: 700, right: 390, bottom: 844 });
      BuildCard({ stage, id: 'd1', avoid: () => [top, bottom] });
      for (const f of hook.fx) {
        f();
      }
      const m = /translate\((?<x>-?\d+)px, (?<y>-?\d+)px\)/u.exec(el.style.transform);
      expect(m, `no transform: ${el.style.transform}`).not.toBeNull();
      const x = Number(must(m).groups?.['x']),
        y = Number(must(m).groups?.['y']);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + size.w).toBeLessThanOrEqual(390);
      expect(y + size.h).toBeLessThanOrEqual(844);
    } finally {
      hook.ref = null;
      vi.unstubAllGlobals();
    }
  });
});

/** The Build stage the run tab reads (the node run has no 3D stage): on or off, and what a click asked of it. */
const runStage = (on: boolean, calls: string[]) =>
  ({
    state: { value: { on } },
    simSpeed: { value: 1 },
    power: () => calls.push('power'),
    skip: () => calls.push('skip'),
  }) as unknown as Parameters<typeof BuildBarsTypes.RunControls>[0]['stage'];
const POWER = /^Power (?:on|off)$/u;
/** The Power button of the run tab, while a step plays (`busy`) or not, with the machine on or off. */
const powerBtn = (busy: boolean, on: boolean, calls: string[] = []) => {
  const run = buttons(RunControls({ stage: runStage(on, calls), busy, bare: false }));
  return must(run.find((b) => POWER.test(b.text)));
};
/** Whether a button is disabled. */
const disabled = (b: { el: VEl }): boolean => Boolean(b.el.props['disabled']);
/** Whether `v` is a click handler. */
const isHandler = (v: unknown): v is () => void => typeof v === 'function';
/** The click handler of a button, or fail when it has none. */
function clickOf(b: { text: string; el: VEl }): () => void {
  const { onClick } = b.el.props;
  if (!isHandler(onClick)) {
    throw new Error(`no click handler on the ${b.text} button`);
  }
  return onClick;
}

describe('Power on agrees with the click path (ticket #41)', () => {
  it('while a step plays and the machine is off, Power on stays enabled, solid, and a click skips the step', () => {
    const calls: string[] = [];
    const b = powerBtn(true, false, calls);
    expect(disabled(b)).toBe(false);
    expect(b.cls).toContain('primary');
    clickOf(b)();
    expect(calls).toStrictEqual(['skip']);
  });

  it('while a step plays and the machine is on, Power off is disabled (power() ignores it)', () => {
    expect(disabled(powerBtn(true, true))).toBe(true);
  });

  it.each([false, true])('when no step plays, the button is enabled (a click is accepted): on %s', (on) => {
    expect(disabled(powerBtn(false, on))).toBe(false);
  });
});

/** The tree with every component called (hooks are stubbed, the stage is null), so the buttons of the bars are in it. */
function expand(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map((x: unknown) => expand(x));
  }
  if (!isElement(v)) {
    return v;
  }
  if (isComponent(v.type)) {
    try {
      return expand(v.type(v.props));
    } catch {
      return null;
    }
  }
  return { ...v, props: { ...v.props, children: expand(v.props['children']) } };
}
/** Whether an element type is a component (a function of its props), not a tag name. */
function isComponent(t: unknown): t is (props: Record<string, unknown>) => unknown {
  return typeof t === 'function';
}
const leaves = (el: VEl): string =>
  `${words(el.props['aria-label'])} ${words(el.props['title'])} ${text(childrenOf(el))}`;
/** Whether an element is a button that leaves the screen itself (not the benchmark, the OS sheet or the part card). */
const isWayOut = (el: VEl): boolean =>
  el.type === 'button' &&
  /\b(?:back|close|exit|leave)\b/iu.test(leaves(el)) &&
  !/benchmark|OS sheet|card/iu.test(leaves(el));

describe('the Build screen has one way out (ticket #41)', () => {
  it('shows exactly one visible Back or Close control for the screen itself', () => {
    const out = all(expand(BuildMode())).filter((el) => isWayOut(el));
    expect(out.map((el) => leaves(el))).toHaveLength(1);
  });
});
