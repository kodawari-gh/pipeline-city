// Invariants of the CPU die floorplans (docs/DIE.md): the blocks tile the die, nothing overlaps, the board-facing blocks sit on the edge their
// pins are on, every cell grid is exact, every link starts and ends on the edge of the blocks it names and runs square through the gutters.
import { describe, expect, it } from 'vitest';
import { specsOfKind } from '@/features/board/sim/specs';
import type * as specTypes from '@/features/board/sim/specs';
import { gridExact, planInput } from './cpuplan';
import type * as planTypes from './cpuplan';
import { GAP, col, leaf, place, routeLinks, row, spans } from './cpufloor';
import { cpuPlan } from './cpuplans';
import { glyphPins } from '../die/glyphgeom';
import { DIE_PLAN as DIE } from '@/features/board/render/layout/layout';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const CONFIGS: [string, planTypes.PlanInput][] = [
  ['unpipelined', { arch: 'unpipelined', cacheLines: 8 }],
  ['5-stage, no forwarding', { arch: 'inorder', forwarding: false, cacheLines: 8 }],
  ['5-stage, forwarding', { arch: 'inorder', forwarding: true, cacheLines: 16 }],
  [
    '5-stage + I-cache',
    { arch: 'inorder', forwarding: true, cacheLines: 16, icacheLines: 8, predEntries: 128, predBits: 2 },
  ],
  [
    '5-stage + I-cache + L2',
    { arch: 'inorder', forwarding: true, cacheLines: 32, ways: 2, icacheLines: 16, l2Lines: 64 },
  ],
  ['2-wide', { arch: 'inorder2', forwarding: true, cacheLines: 16 }],
  ['2-wide + L2', { arch: 'inorder2', forwarding: true, cacheLines: 64, ways: 4, icacheLines: 16, l2Lines: 64 }],
  ['ooo', { arch: 'ooo', width: 2, robSize: 8, schedSize: 6, fetchQueue: 4, cacheLines: 16, commitWidth: 4 }],
  [
    'ooo + I-cache',
    { arch: 'ooo', width: 2, robSize: 16, schedSize: 10, fetchQueue: 4, cacheLines: 16, icacheLines: 16 },
  ],
  [
    'ooo wide',
    {
      arch: 'ooo',
      width: 4,
      robSize: 32,
      schedSize: 16,
      fetchQueue: 8,
      cacheLines: 64,
      ways: 4,
      icacheLines: 32,
      l2Lines: 128,
      predEntries: 512,
      predBits: 2,
    },
  ],
  ['ooo scalar', { arch: 'ooo', width: 1, robSize: 2, schedSize: 1, fetchQueue: 2, cacheLines: 8 }],
  ['5-stage + MMU', { arch: 'inorder', forwarding: true, cacheLines: 16, tlbEntries: 4 }],
  [
    '2-wide + MMU + L2',
    { arch: 'inorder2', forwarding: true, cacheLines: 64, ways: 4, icacheLines: 16, l2Lines: 64, tlbEntries: 16 },
  ],
  [
    'ooo + MMU',
    {
      arch: 'ooo',
      width: 2,
      robSize: 16,
      schedSize: 10,
      fetchQueue: 4,
      cacheLines: 16,
      icacheLines: 16,
      tlbEntries: 8,
    },
  ],
  [
    'ooo wide + MMU + L2',
    {
      arch: 'ooo',
      width: 4,
      robSize: 32,
      schedSize: 16,
      fetchQueue: 8,
      cacheLines: 64,
      ways: 4,
      icacheLines: 32,
      l2Lines: 128,
      tlbEntries: 32,
    },
  ],
  ['4 cores in-order', { arch: 'inorder', forwarding: true, cacheLines: 16, cores: 4, l2Lines: 64 }],
  ['8 cores in-order', { arch: 'inorder', forwarding: true, cacheLines: 8, cores: 8, l2Lines: 128 }],
  [
    '2 cores ooo',
    {
      arch: 'ooo',
      width: 4,
      robSize: 32,
      schedSize: 16,
      fetchQueue: 8,
      cacheLines: 64,
      ways: 4,
      cores: 2,
      l2Lines: 128,
    },
  ],
];

const inside = (a: planTypes.Rect, o: planTypes.Rect): boolean =>
  a.x >= o.x && a.y >= o.y && a.x + a.w <= o.x + o.w && a.y + a.h <= o.y + o.h;
const apart = (a: planTypes.Rect, c: planTypes.Rect): boolean =>
  a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y;
const onEdge = (p: planTypes.Pt, r: planTypes.Rect): boolean => {
  const [x, y] = p;
  const inX = x >= r.x && x <= r.x + r.w,
    inY = y >= r.y && y <= r.y + r.h;
  return (inX && (y === r.y || y === r.y + r.h)) || (inY && (x === r.x || x === r.x + r.w));
};
/** Does the axis-aligned segment a-b pass through the inside of r (the edge itself does not count)? */
const crosses = (a: planTypes.Pt, b: planTypes.Pt, r: planTypes.Rect): boolean => {
  const x0 = Math.min(a[0], b[0]),
    x1 = Math.max(a[0], b[0]),
    y0 = Math.min(a[1], b[1]),
    y1 = Math.max(a[1], b[1]);
  return x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;
};
const eq = (a: planTypes.Pt, b: planTypes.Pt): boolean => a[0] === b[0] && a[1] === b[1];
const isPow2 = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;
/** The segments of a polyline, each as its two ends. */
const segments = (pts: planTypes.Pt[]): [planTypes.Pt, planTypes.Pt][] => pts.slice(1).map((v, k) => [must(pts[k]), v]);
/** Does the segment u-v run along an axis? */
const square = (u: planTypes.Pt, v: planTypes.Pt): boolean => u[0] === v[0] || u[1] === v[1];

/** What is wrong with the blocks of `plan`, each checked on its own and in order (a frame comes before its children). */
function checkBlocks(plan: planTypes.CpuPlan, byId: Map<string, planTypes.Block>): string[] {
  const bad: string[] = [];
  for (const b of plan.blocks) {
    if (byId.has(b.id)) {
      bad.push(`duplicate block id ${b.id}`);
    }
    byId.set(b.id, b);
    if (!inside(b.rect, DIE)) {
      bad.push(`${b.id} is outside the die`);
    }
    if (b.rect.w <= 0 || b.rect.h <= 0) {
      bad.push(`${b.id} has no area`);
    }
    if (b.parent !== undefined) {
      const p = byId.get(b.parent);
      if (!p) {
        bad.push(`${b.id}: parent ${b.parent} is not defined before it`);
      } else if (!inside(b.rect, p.rect)) {
        bad.push(`${b.id} sticks out of its frame ${b.parent}`);
      }
    }
    if (b.grid && (b.grid.cols * b.grid.rows !== b.grid.count || b.grid.cols < 1 || b.grid.rows < 1)) {
      bad.push(`${b.id} has an inexact grid ${b.grid.cols}x${b.grid.rows} for ${b.grid.count}`);
    }
  }
  return bad;
}

/** The pairs of blocks of `plan` that overlap (a child sits inside its frame, so that pair does not count). */
function checkOverlaps(plan: planTypes.CpuPlan): string[] {
  const bad: string[] = [];
  for (let i = 0; i < plan.blocks.length; i++) {
    for (let j = i + 1; j < plan.blocks.length; j++) {
      const a = must(plan.blocks[i]),
        c = must(plan.blocks[j]);
      if (a.parent === c.id || c.parent === a.id) {
        continue;
      } // a child sits inside its frame
      if (!apart(a.rect, c.rect)) {
        bad.push(`${a.id} overlaps ${c.id}`);
      }
    }
  }
  return bad;
}

/** What is wrong with a segment of link `l`: it must run square, have a length, stay on the die and keep out of the blocks. */
function checkSegment(
  plan: planTypes.CpuPlan,
  l: planTypes.CpuPlan['links'][number],
  [u, v]: [planTypes.Pt, planTypes.Pt],
): string[] {
  const bad: string[] = [];
  if (u[0] !== v[0] && u[1] !== v[1]) {
    bad.push(`${l.id} has a diagonal segment`);
  }
  if (u[0] === v[0] && u[1] === v[1]) {
    bad.push(`${l.id} has a zero-length segment`);
  }
  if (
    !inside(
      { x: Math.min(u[0], v[0]), y: Math.min(u[1], v[1]), w: Math.abs(u[0] - v[0]), h: Math.abs(u[1] - v[1]) },
      DIE,
    )
  ) {
    bad.push(`${l.id} leaves the die`);
  }
  for (const o of plan.blocks) {
    if (o.kind === 'stage' || o.id === l.from || o.id === l.to) {
      continue;
    }
    if (crosses(u, v, o.rect)) {
      bad.push(`${l.id} runs through ${o.id}`);
    }
  }
  return bad;
}

/** What is wrong with the links of `plan`: unique ids, known ends on the edge (or a pin) of their blocks, clean segments. */
function checkLinks(plan: planTypes.CpuPlan, byId: Map<string, planTypes.Block>): string[] {
  const bad: string[] = [];
  const ids = new Set<string>();
  for (const l of plan.links) {
    if (ids.has(l.id)) {
      bad.push(`duplicate link id ${l.id}`);
    }
    ids.add(l.id);
    const a = byId.get(l.from),
      c = byId.get(l.to);
    if (!a || !c) {
      bad.push(`${l.id}: unknown end ${l.from} / ${l.to}`);
      continue;
    }
    if (l.pts.length < 2) {
      bad.push(`${l.id} has fewer than two points`);
    }
    if (!(l.lanes >= 1 && l.lanes <= 4)) {
      bad.push(`${l.id} has ${l.lanes} lanes`);
    }
    const p0 = must(l.pts[0]),
      p1 = must(l.pts.at(-1));
    // a link ends on the edge of its block, or (where the block draws a symbol) at a pin inside it
    const out = glyphPins(a)?.out ?? null;
    if (!onEdge(p0, a.rect) && !(out !== null && eq(p0, out))) {
      bad.push(`${l.id} starts off the edge and off the output pin of ${l.from}`);
    }
    const ins = Object.values(glyphPins(c)?.ins ?? {});
    if (!onEdge(p1, c.rect) && !ins.some((q) => eq(p1, q))) {
      bad.push(`${l.id} ends off the edge and off an input pin of ${l.to}`);
    }
    for (const seg of segments(l.pts)) {
      bad.push(...checkSegment(plan, l, seg));
    }
  }
  return bad;
}

function check(plan: planTypes.CpuPlan): string[] {
  const byId = new Map<string, planTypes.Block>();
  return [...checkBlocks(plan, byId), ...checkOverlaps(plan), ...checkLinks(plan, byId)];
}

const kinds = (i: planTypes.PlanInput) => new Set(cpuPlan(i).blocks.map((b) => b.kind));
const sig = (i: planTypes.PlanInput) => JSON.stringify(cpuPlan(i).blocks.map((b) => [b.id, b.rect]));
/** The plan of a catalog CPU, with its TLB when it has an MMU. */
const specPlan = (s: specTypes.CpuSpec) => cpuPlan(planInput(s.engine, s.mmu ? { tlbEntries: s.mmu.tlb } : {}));

const get = (plan: planTypes.CpuPlan, id: string): planTypes.Block => {
  const b = plan.blocks.find((x) => x.id === id);
  if (!b) {
    throw new Error(`no block ${id}`);
  }
  return b;
};
const count = (plan: planTypes.CpuPlan, id: string): number | undefined =>
  plan.blocks.find((b) => b.id === id)?.grid?.count;
/** The share of the die's usable area the (non-frame) blocks cover. */
const usage = (plan: planTypes.CpuPlan): number => {
  const area = plan.blocks.filter((b) => b.kind !== 'stage').reduce((n, b) => n + b.rect.w * b.rect.h, 0);
  return area / ((DIE.w - 48) * (DIE.h - 48));
};

/** What the floorplan of an input holds: the cell count of each structure's grid, the structures it lacks, its decoders. */
interface Structures {
  grids: Record<string, number | undefined>;
  missing: string[];
  decoders?: number;
}

/** The structures the floorplan of `input` should have (`missing` names an absent block `id:` or block `kind:`). */
function structuresWanted(input: planTypes.PlanInput): Structures {
  const n = input.cores ?? 1;
  const p = (id: string) => (n > 1 ? `c0.${id}` : id);
  const grids: Record<string, number | undefined> = { [p('rf')]: 16, [p('dc')]: input.cacheLines ?? 8 };
  const missing: string[] = [];
  if ((input.icacheLines ?? 0) > 0) {
    grids[p('ic')] = input.icacheLines;
  } else {
    missing.push(`id:${p('ic')}`);
  }
  if ((input.l2Lines ?? 0) > 0) {
    grids[n > 1 ? 'l2s' : 'l2'] = input.l2Lines;
  }
  if (input.arch === 'unpipelined') {
    missing.push('kind:predictor');
  } else {
    grids[p('bp')] = input.predEntries ?? 64;
  }
  if (input.arch !== 'ooo') {
    return { grids, missing };
  }
  grids[p('rob')] = input.robSize;
  grids[p('sched')] = input.schedSize;
  grids[p('fq')] = input.fetchQueue;
  return { grids, missing, decoders: (input.width ?? 2) * n };
}

/** The structures `plan` has, read the way `want` asks for them. */
function structuresOf(plan: planTypes.CpuPlan, want: Structures): Structures {
  const grids = Object.fromEntries(Object.keys(want.grids).map((id) => [id, count(plan, id)]));
  const missing = want.missing.filter((m) => !plan.blocks.some((b) => m === `id:${b.id}` || m === `kind:${b.kind}`));
  if (want.decoders === undefined) {
    return { grids, missing };
  }
  return { grids, missing, decoders: plan.blocks.filter((b) => b.kind === 'decode').length };
}

/** The blocks of the cores (not their stage frames). */
const coreBlocks = (plan: planTypes.CpuPlan): planTypes.Block[] =>
  plan.blocks.filter((b) => b.zone === 'core' && b.kind !== 'stage');
/** The grids of `plan` with a power-of-two count whose sides are not powers of two. */
const ragged = (plan: planTypes.CpuPlan): string[] =>
  plan.blocks.flatMap((b) =>
    b.grid && isPow2(b.grid.count) && !(isPow2(b.grid.cols) && isPow2(b.grid.rows))
      ? [`${b.id} ${b.grid.cols}x${b.grid.rows}`]
      : [],
  );
/** The floorplan architecture an engine kind draws: anything not pipelined draws the unpipelined die. */
function archOf(kind: string): string {
  if (kind === 'ooo' || kind === 'inorder2' || kind === 'inorder') {
    return kind;
  }
  return 'unpipelined';
}

describe('cpu floorplans', () => {
  describe.each(CONFIGS)('%s', (_name, input) => {
    const plan = cpuPlan(input);
    const n = input.cores ?? 1;
    it('fits the die with no overlaps, exact grids and clean links', () => {
      expect(check(plan)).toStrictEqual([]);
    });
    const minUsage = n > 1 ? 0.55 : 0.78;
    it('uses the die: the blocks tile it', () => {
      expect(usage(plan)).toBeGreaterThan(minUsage);
    });
    it('is deterministic', () => {
      expect(cpuPlan({ ...input })).toStrictEqual(plan);
    });
    it('has a grid per structure, sized by the configuration', () => {
      const want = structuresWanted(input);
      expect(structuresOf(plan, want)).toStrictEqual(want);
    });
    it('puts the board-facing blocks on the edge their pins are on', () => {
      const core = coreBlocks(plan);
      const left = Math.min(...core.map((b) => b.rect.x)),
        right = Math.max(...core.map((b) => b.rect.x + b.rect.w));
      const top = Math.min(...core.map((b) => b.rect.y)),
        bottom = Math.max(...core.map((b) => b.rect.y + b.rect.h));
      const west = (id: string) => get(plan, id).rect.x + get(plan, id).rect.w <= left;
      expect(get(plan, 'mc').rect.x).toBeGreaterThanOrEqual(right); // the DIMM bus leaves east
      expect(['usb', 'display', 'intc', 'timer', 'mpu'].filter((id) => !west(id))).toStrictEqual([]); // USB, video out, interrupts, the timer and the MPU: west
      for (const id of ['pwr', 'thermal']) {
        expect(get(plan, id).rect.y + get(plan, id).rect.h).toBeLessThanOrEqual(top);
      } // vcore and SVID: north
      for (const id of ['pcie', 'clk']) {
        expect(get(plan, id).rect.y).toBeGreaterThanOrEqual(bottom - 1);
      } // PCIe, NVMe, DMI, the crystal: south
    });
  });

  it('has the clock, the interrupt controller and every edge block exactly once', () => {
    for (const [, input] of CONFIGS) {
      const plan = cpuPlan(input);
      for (const id of ['pwr', 'thermal', 'mc', 'pcie', 'clk', 'usb', 'display', 'intc', 'timer', 'mpu', 'fabric']) {
        expect(
          plan.blocks.filter((b) => b.id === id),
          `block ${id}`,
        ).toHaveLength(1);
      }
      expect(plan.links.some((l) => l.kind === 'irq')).toBe(true);
      // every unit the CPU reaches through the system bus has its wire (the die view runs a packet along it), and the timer ticks the controller
      for (const id of ['fab-intc', 'fab-timer', 'fab-mpu', 'timer-intc']) {
        expect(
          plan.links.some((l) => l.id === id),
          `link ${id}`,
        ).toBe(true);
      }
      expect(must(plan.links.find((l) => l.kind === 'irq')).from).toBe('intc'); // (the die view sends the interrupt along the first irq wire)
    }
  });

  it('shows the structures only the architecture has', () => {
    expect(kinds({ arch: 'unpipelined' }).has('latch')).toBe(false);
    expect(kinds({ arch: 'unpipelined' }).has('control')).toBe(true);
    expect(kinds({ arch: 'inorder', forwarding: false }).has('latch')).toBe(true);
    expect(kinds({ arch: 'inorder', forwarding: false }).has('forward')).toBe(false);
    expect(kinds({ arch: 'inorder', forwarding: true }).has('forward')).toBe(true);
    expect(kinds({ arch: 'inorder2', forwarding: true }).has('bundle')).toBe(true);
    for (const k of ['rob', 'sched', 'rename', 'resultbus', 'queue'] as const) {
      expect(kinds({ arch: 'ooo' }).has(k)).toBe(true);
    }
    expect(kinds({ arch: 'inorder', forwarding: true }).has('rob')).toBe(false);
    for (const [, i] of CONFIGS) {
      expect(kinds(i).has('port')).toBe(false);
    } // no invented fetch port: without an I-cache fetch goes through the bus
  });

  it('draws one lit unit per OoO functional unit, with the names of the engine', () => {
    const plan = cpuPlan({ arch: 'ooo' });
    expect(
      plan.blocks
        .map((b) => b.unit)
        .filter((u) => u !== undefined)
        .toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(['ALU0', 'ALU1', 'LSU', 'MUL']);
  });

  it('gives a stage frame to every pipeline stage, in order', () => {
    const frames = cpuPlan({ arch: 'inorder', forwarding: true }).blocks.filter((b) => b.kind === 'stage');
    expect(frames.map((f) => f.stage)).toStrictEqual([0, 1, 2, 3, 4]);
    const xs = frames.map((f) => f.rect.x);
    expect(xs.toSorted((a, b) => a - b)).toStrictEqual(xs);
  });

  it('keeps every grid a full rectangle: power-of-two counts have power-of-two sides', () => {
    for (const [, input] of CONFIGS) {
      expect(ragged(cpuPlan(input))).toStrictEqual([]);
    }
  });

  it('plans every CPU in the catalog from its engine config', () => {
    const cpus = specsOfKind('cpu');
    expect(cpus.length).toBeGreaterThanOrEqual(5);
    for (const s of cpus) {
      const plan = cpuPlan(planInput(s.engine));
      expect(check(plan), `spec ${s.id}`).toStrictEqual([]);
      expect(plan.arch, `spec ${s.id}`).toBe(archOf(s.engine.kind));
    }
  });

  it('draws different dies for different architectures (no shared floorplan)', () => {
    const set = new Set([
      sig({ arch: 'unpipelined' }),
      sig({ arch: 'inorder', forwarding: false }),
      sig({ arch: 'inorder', forwarding: true }),
      sig({ arch: 'inorder2', forwarding: true }),
      sig({ arch: 'ooo' }),
    ]);
    expect(set.size).toBe(5);
  });
});

describe('gridExact', () => {
  it('is an exact rectangle of cells, never a partial row', () => {
    for (const n of [1, 2, 4, 6, 8, 10, 12, 16, 32, 64, 128, 512]) {
      const g = gridExact(n, 300, 200);
      expect(g.cols * g.rows).toBe(n);
    }
  });
  it('splits a power of two into power-of-two sides, long side along the long side of the box', () => {
    expect(gridExact(8, 400, 120)).toStrictEqual({ cols: 4, rows: 2, count: 8 });
    expect(gridExact(8, 200, 200)).toStrictEqual({ cols: 2, rows: 4, count: 8 });
    expect(gridExact(8, 120, 400)).toStrictEqual({ cols: 1, rows: 8, count: 8 });
    expect(gridExact(16, 300, 300)).toStrictEqual({ cols: 4, rows: 4, count: 16 });
    expect(gridExact(64, 300, 300)).toStrictEqual({ cols: 8, rows: 8, count: 64 });
  });
  it('makes a prime count a single row or column', () => {
    const g = gridExact(7, 300, 100);
    expect([g.cols, g.rows].toSorted((a, b) => a - b)).toStrictEqual([1, 7]);
  });
});

describe('slicing layout', () => {
  it('spans fill the length exactly, with the gutter between every pair', () => {
    const sp = spans(1000, [{ f: 1 }, { px: 30 }, { f: 2 }, { f: 1.3 }], GAP);
    expect(must(sp[0])[0]).toBe(0);
    for (let i = 1; i < sp.length; i++) {
      expect(must(sp[i])[0] - (must(sp[i - 1])[0] + must(sp[i - 1])[1])).toBe(GAP);
    }
    expect(must(sp.at(-1))[0] + must(sp.at(-1))[1]).toBe(1000);
    expect(must(sp[1])[1]).toBe(30);
  });
  it('places a tree edge to edge, a frame before its children', () => {
    const out: planTypes.Block[] = [];
    const framed = col([leaf('a', 'pc', 'A'), leaf('b', 'pc', 'B', { px: 40 })], {
      frame: { id: 'f', kind: 'stage', label: 'F' },
      f: 1,
    });
    place(row([framed, leaf('c', 'pc', 'C', { px: 100 })]), { x: 0, y: 0, w: 400, h: 300 }, out);
    expect(out.map((b) => b.id)).toStrictEqual(['f', 'a', 'b', 'c']);
    expect(must(out.find((b) => b.id === 'c')).rect).toStrictEqual({ x: 300, y: 0, w: 100, h: 300 });
    expect(must(out.find((b) => b.id === 'a')).parent).toBe('f');
  });
});

const ROUTER_DIE = { x: 0, y: 0, w: 400, h: 300 };
/** A block of a kind with no symbol, so the ends stay on the edges. */
const mk = (id: string, r: planTypes.Rect): planTypes.Block => ({ id, kind: 'l2', label: id, rect: r, zone: 'core' });
/** The points of the one link from block a to block b among `blocks`. */
const routeAB = (blocks: planTypes.Block[]): planTypes.Pt[] =>
  must(routeLinks(ROUTER_DIE, blocks, [{ id: 'l', kind: 'data', from: 'a', to: 'b' }])[0]).pts;
describe('channel router', () => {
  it('joins two neighbours with a jog along the gutter (a visible wire, not a stub): out of one edge high, into the other low', () => {
    const pts = routeAB([mk('a', { x: 40, y: 40, w: 100, h: 100 }), mk('b', { x: 154, y: 40, w: 100, h: 100 })]);
    expect(pts).toHaveLength(4);
    const [p0, p1, p2, p3] = [0, 1, 2, 3].map((i) => must(pts[i]));
    expect(must(p0)[0]).toBe(140);
    expect(must(p3)[0]).toBe(154);
    expect(must(p0)[1]).toBeLessThan(must(p3)[1]);
    expect(must(p1)[0]).toBe(must(p2)[0]); // the run along the gutter
    expect(must(p2)[1] - must(p1)[1]).toBeGreaterThan(30);
  });
  it('keeps a hop straight where the blocks face each other along too little of their edges to jog', () => {
    const pts = routeAB([mk('a', { x: 40, y: 40, w: 100, h: 100 }), mk('b', { x: 154, y: 120, w: 100, h: 100 })]);
    expect(pts.length).toBeLessThanOrEqual(4);
    for (const [u, v] of segments(pts)) {
      expect(square(u, v)).toBe(true);
    }
  });
  it('goes around a block in the way, through the gutters only', () => {
    const blocks = [
      mk('a', { x: 40, y: 100, w: 60, h: 60 }),
      mk('wall', { x: 114, y: 40, w: 60, h: 180 }),
      mk('b', { x: 188, y: 100, w: 60, h: 60 }),
    ];
    const pts = routeAB(blocks);
    const wall = must(blocks[1]).rect;
    for (const [u, v] of segments(pts)) {
      expect(crosses(u, v, wall)).toBe(false);
    }
    expect(pts.length).toBeGreaterThan(2);
  });
  it('fails loudly when a block is walled in', () => {
    const blocks = [
      mk('a', { x: 150, y: 100, w: 40, h: 40 }),
      mk('wall', { x: 40, y: 40, w: 320, h: 220 }),
      mk('b', { x: 380, y: 280, w: 10, h: 10 }),
    ];
    expect(() => routeLinks(ROUTER_DIE, blocks, [{ id: 'l', kind: 'data', from: 'a', to: 'b' }])).toThrow(
      /no route|no free edge/u,
    );
  });
});

describe('the TLB', () => {
  it('is drawn when the CPU has an MMU, with one cell per entry and the links of translation and the page walk, and not otherwise', () => {
    for (const [tlb, l2Lines] of [
      [4, 0],
      [8, 64],
      [16, 64],
      [32, 64],
    ] as const) {
      for (const arch of ['inorder', 'inorder2', 'ooo'] as const) {
        const p = cpuPlan({ arch, cacheLines: 16, tlbEntries: tlb, l2Lines });
        const b = p.blocks.find((x) => x.kind === 'tlb');
        expect(b, `${arch} ${tlb}`).toBeDefined();
        expect(must(must(b).grid).count).toBe(tlb);
        for (const id of ['lsu-tlb', 'fetch-tlb', 'tlb-walk']) {
          expect(
            p.links.some((l) => l.id === id),
            `${arch} ${id}`,
          ).toBe(true);
        }
      }
    }
    for (const arch of ['unpipelined', 'inorder', 'ooo'] as const) {
      expect(cpuPlan({ arch, cacheLines: 8 }).blocks.some((x) => x.kind === 'tlb')).toBe(false);
    }
  });

  it('every shipped CPU with an MMU draws its TLB at the size of its spec', () => {
    for (const s of specsOfKind('cpu')) {
      const p = specPlan(s);
      expect(p.blocks.find((x) => x.kind === 'tlb')?.grid?.count, `spec ${s.id}`).toBe(s.mmu?.tlb);
    }
  });
});
