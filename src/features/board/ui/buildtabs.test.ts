// Build my PC in edge tabs (ticket #41; SPEC §5.7). The node test run has no DOM, so the Build components are called as plain functions and
// their returned trees are walked (the same seam as MainMenu.test.ts). Hooks are stubbed. Written before the coder's changes: the lens rail,
// the Graphics and Power on rules fail until they land. The browser checks (the four viewports, no overlap, the part card) are not here.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_KINDS } from '@/features/economy/ui/shop/shopdata';
import { NET_KINDS } from '@/features/board/sim/buildnet';
// (the node test run has no @types/node: the file system is reached through untyped imports, as in scaling.test.ts)
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';

const hook = vi.hoisted(() => ({ ref: null as unknown, fx: [] as (() => void)[] }));
vi.mock('preact/hooks', () => ({
  useEffect: () => {},
  useLayoutEffect: (f: () => void) => {
    hook.fx.push(f);
  },
  useRef: () => ({ current: hook.ref }),
  useState: (v: unknown) => [v, () => {}],
  useMemo: (f: () => unknown) => f(),
  useCallback: (f: unknown) => f,
}));
vi.mock('@/features/board/ui/builddrag', () => ({
  useBuildDrag: () => ({ drag: null, begin: () => {}, cancel: () => {}, air: null }),
}));

type VEl = { type: unknown; props: Record<string, any> };
type Node = VEl | string | number | boolean | null | undefined | Node[];

/** The element children of a node, with the nested arrays and empty values removed. */
const elements = (v: Node): VEl[] => {
  if (Array.isArray(v)) return v.flatMap(elements);
  if (v && typeof v === 'object' && 'props' in v) return [v];
  return [];
};
const childrenOf = (el: VEl): Node => el.props.children as Node;

/** Every element in the tree, depth first. */
function all(v: Node): VEl[] {
  return elements(v).flatMap((el) => [el, ...all(childrenOf(el))]);
}

/** The visible text of a node: its strings, in order. */
function text(v: Node): string {
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(text).join('');
  if (v && typeof v === 'object' && 'props' in v) return text(childrenOf(v));
  return '';
}

/** Every button in a tree, with its text and its class. */
function buttons(v: Node): { text: string; cls: string; el: VEl }[] {
  return all(v)
    .filter((el) => el.type === 'button')
    .map((el) => ({ text: text(childrenOf(el)).trim(), cls: String(el.props.class ?? ''), el }));
}

let BuildMode: typeof import('./BuildMode').BuildMode;
let ViewOptions: typeof import('./BuildBars').ViewOptions;
let RunControls: typeof import('./BuildBars').RunControls;
let Foot: typeof import('./BuildBars').Foot;
let BuildShelf: typeof import('./BuildShelf').BuildShelf;
let BuildMachine: typeof import('./BuildMachine').BuildMachine;

beforeEach(async () => {
  const { buildOpen } = await import('@/core/ui/state');
  buildOpen.value = true; // (BuildMode draws nothing while the screen is shut)
  ({ BuildMode } = await import('./BuildMode'));
  ({ ViewOptions, RunControls, Foot } = await import('./BuildBars'));
  ({ BuildShelf } = await import('./BuildShelf'));
  ({ BuildMachine } = await import('./BuildMachine'));
});

/** The props of the first element of `type` in a tree, or fail with the name. */
function propsOf(tree: Node, type: unknown, name: string): Record<string, any> {
  const hit = all(tree).find((el) => el.type === type);
  if (!hit) throw new Error(`no ${name} in the Build tree`);
  return hit.props;
}

describe('Build rail: every part kind is reachable (ticket #41)', () => {
  // (the kinds BuildMode passes today: the studio's kinds without the monitor and the network kinds, then the network kinds)
  const current = () => [
    ...STUDIO_KINDS.filter((k) => k !== 'display' && !(NET_KINDS as readonly string[]).includes(k)),
    ...NET_KINDS,
  ];

  it('the shelf rail offers every kind the current Build rail offers, and no more', () => {
    const tree = BuildMode() as unknown as Node;
    const kinds: string[] = propsOf(tree, BuildShelf, 'BuildShelf').kinds;
    expect([...kinds].sort()).toEqual([...current()].sort());
  });

  it('includes the kinds the spec names in the rail: VRM, RSK, NET, AI and SEC (vrm-sink, ram-sink, nic, npu, tpm)', () => {
    const tree = BuildMode() as unknown as Node;
    const kinds: string[] = propsOf(tree, BuildShelf, 'BuildShelf').kinds;
    for (const k of ['vrm-sink', 'ram-sink', 'nic', 'npu', 'tpm']) expect(kinds).toContain(k);
  });

  it('the machine list gets the same kinds as the rail', () => {
    const tree = BuildMode() as unknown as Node;
    const shelfKinds: string[] = propsOf(tree, BuildShelf, 'BuildShelf').kinds;
    const machineKinds: string[] = propsOf(tree, BuildMachine, 'BuildMachine').kinds;
    expect([...machineKinds].sort()).toEqual([...shelfKinds].sort());
  });
});

describe('Build lens rail and actions (ticket #41)', () => {
  it('the lens rail holds Power, Airflow and Graphics, and no Settings', () => {
    const labels = buttons(ViewOptions({ ready: true, stage: null, onBench: () => {} }) as unknown as Node).map(
      (b) => b.text,
    );
    expect(labels.join(' ')).toMatch(/Power/);
    expect(labels.join(' ')).toMatch(/Airflow/);
    expect(labels.some((t) => t.includes('Graphics'))).toBe(true);
    expect(labels).not.toContain('Settings');
  });

  it('Graphics is in the lens rail, not in the Foot tools bar, and it opens a dialog (Settings)', () => {
    const footLabels = buttons(
      Foot({ stage: null, hint: '', onOs: () => {}, pane: 'parts', onPane: () => {} }) as unknown as Node,
    ).map((b) => b.text);
    expect(footLabels.some((t) => t.includes('Graphics'))).toBe(false);
    const gfx = buttons(ViewOptions({ ready: true, stage: null, onBench: () => {} }) as unknown as Node).find((b) =>
      b.text.includes('Graphics'),
    );
    expect(gfx?.el.props['aria-haspopup']).toBe('dialog');
  });

  it('Power on is the solid main action in the run tab, and comes first there', () => {
    const run = buttons(RunControls({ stage: null, busy: false, bare: false }) as unknown as Node);
    expect(run[0]?.text).toMatch(/^Power (on|off)$/);
    expect(run[0]?.cls).toMatch(/\b(solid|primary|accent)\b/);
  });
});

const fs = fsMod as any;
const urlOf = (rel: string): string => urlMod.fileURLToPath(new URL(rel, import.meta.url));

/** The pieces the part card keeps out from under: the selectors of BuildMode's `avoid` list, read from its source. */
function avoidList(): string[] {
  const src: string = fs.readFileSync(urlOf('./BuildMode.tsx'), 'utf8');
  const list = /const avoid = \(\) =>\s*\[([^\]]*)\]/.exec(src)?.[1] ?? '';
  return (list.match(/'[^']+'/g) ?? []).map((s) => s.slice(1, -1));
}

/** The class each rule of ui.css ends on, for the rules that set `display: contents` and are not desk-only (so they apply on the phone). */
function contentsOnPhone(): string[] {
  const css: string = (fs.readFileSync(urlOf('../../../core/ui/ui.css'), 'utf8') as string).replaceAll(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const out: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(css))) {
    if (!/display\s*:\s*contents/.test(m[2] ?? '')) continue;
    for (const sel of (m[1] ?? '').split(',')) {
      if (sel.includes('data-layout="desk"')) continue;
      out.push(
        sel
          .trim()
          .split(/\s+|>|\+|~/)
          .filter(Boolean)
          .pop() ?? '',
      );
    }
  }
  return out;
}

describe('the part card avoids the Build tabs on the phone (ticket #41)', () => {
  it('every piece in the avoid list has a real layout box on the phone (no display: contents)', () => {
    const avoid = avoidList();
    expect(avoid.length).toBeGreaterThan(0);
    const contents = contentsOnPhone();
    const classesOf = (sel: string): string[] => sel.match(/\.[\w-]+/g) ?? [];
    const boxless = avoid.filter((q) => contents.some((last) => classesOf(last).includes(q)));
    expect(boxless).toEqual([]);
  });
});

describe('the part card stays on the phone screen (ticket #41)', () => {
  it('with no free strip left by the panels, the card is still inside 390x844', async () => {
    const { BuildCard } = await import('./BuildCard');
    const { DEVICE_SPECS } = await import('@/features/board/sim/specs');
    const spec = Object.keys(DEVICE_SPECS)[0]!;
    const size = { w: 300, h: 220 };
    const el = {
      offsetWidth: size.w,
      offsetHeight: size.h,
      dataset: {} as Record<string, string>,
      style: { transform: '', setProperty: () => {} } as any,
    };
    const box = (left: number, top: number, right: number, bottom: number) =>
      ({ getBoundingClientRect: () => ({ left, top, right, bottom }) }) as unknown as HTMLElement;
    vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844 });
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' }));
    try {
      const stage: any = {
        viewRev: { value: 0 },
        status: { value: { rev: 0, busy: false } },
        board: { devices: [{ id: 'd1', spec, slot: 's' }] },
        anchorOf: () => ({ x: 180, y: 400, w: 30, h: 30 }),
        plan: () => [],
        select: () => {},
      };
      hook.fx.length = 0;
      hook.ref = el;
      // the top bar and the bottom bar together cover the whole height, so the free strip is empty
      BuildCard({ stage, id: 'd1', avoid: () => [box(0, 0, 390, 800), box(0, 700, 390, 844)] });
      hook.fx.forEach((f) => f());
      const m = /translate\((-?\d+)px, (-?\d+)px\)/.exec(el.style.transform);
      expect(m, `no transform: ${el.style.transform}`).not.toBeNull();
      const x = Number(m![1]),
        y = Number(m![2]);
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

describe('Power on agrees with the click path (ticket #41)', () => {
  const stageOf = (on: boolean, calls: string[]): any => ({
    state: { value: { on } },
    simSpeed: { value: 1 },
    power: () => calls.push('power'),
    skip: () => calls.push('skip'),
  });
  const powerBtn = (busy: boolean, on: boolean, calls: string[] = []) =>
    buttons(RunControls({ stage: stageOf(on, calls), busy, bare: false }) as unknown as Node).find((b) =>
      /^Power (on|off)$/.test(b.text),
    )!;

  it('while a step plays and the machine is off, Power on stays enabled, solid, and a click skips the step', () => {
    const calls: string[] = [];
    const b = powerBtn(true, false, calls);
    expect(!!b.el.props.disabled).toBe(false);
    expect(b.cls).toContain('primary');
    b.el.props.onClick();
    expect(calls).toEqual(['skip']);
  });

  it('while a step plays and the machine is on, Power off is disabled (power() ignores it)', () => {
    expect(!!powerBtn(true, true).el.props.disabled).toBe(true);
  });

  it('when no step plays, the button is enabled (a click is accepted)', () => {
    for (const on of [false, true]) expect(!!powerBtn(false, on).el.props.disabled).toBe(false);
  });
});

describe('the Build screen has one way out (ticket #41)', () => {
  /** The tree with every component called (hooks are stubbed, the stage is null), so the buttons of the bars are in it. */
  const expand = (v: Node): Node => {
    if (Array.isArray(v)) return v.map(expand);
    if (!v || typeof v !== 'object' || !('props' in v)) return v;
    if (typeof v.type === 'function') {
      try {
        return expand((v.type as (p: unknown) => Node)(v.props));
      } catch {
        return null;
      }
    }
    return { ...v, props: { ...v.props, children: expand(v.props.children as Node) } };
  };
  const leaves = (el: VEl): string => `${el.props['aria-label'] ?? ''} ${el.props.title ?? ''} ${text(childrenOf(el))}`;

  it('shows exactly one visible Back or Close control for the screen itself', () => {
    const tree = expand(BuildMode() as unknown as Node);
    const out = all(tree).filter(
      (el) =>
        el.type === 'button' &&
        /\b(back|close|exit|leave)\b/i.test(leaves(el)) &&
        !/benchmark|OS sheet|card/i.test(leaves(el)),
    );
    expect(out.map(leaves)).toHaveLength(1);
  });
});
