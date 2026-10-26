// Invariants of the CPU die floorplans (docs/DIE.md): everything fits the die, nothing overlaps, every link starts and ends on the edge of
// the blocks it names and runs square, no link crosses a block it does not connect, and the cell grids match the configuration.
import { describe, expect, it } from 'vitest';
import { specsOfKind, type CpuSpec } from '../sim/board/specs';
import { ortho, planInput, type Block, type CpuPlan, type PlanInput, type Pt, type Rect } from './cpuplan';
import { cpuPlan } from './cpuplans';
import { DIE } from './layout';

const CONFIGS: [string, PlanInput][] = [
  ['unpipelined', { arch: 'unpipelined', cacheLines: 8 }],
  ['5-stage, no forwarding', { arch: 'inorder', forwarding: false, cacheLines: 8 }],
  ['5-stage, forwarding', { arch: 'inorder', forwarding: true, cacheLines: 16 }],
  ['5-stage + I-cache', { arch: 'inorder', forwarding: true, cacheLines: 16, icacheLines: 8, predEntries: 128, predBits: 2 }],
  ['5-stage + I-cache + L2', { arch: 'inorder', forwarding: true, cacheLines: 32, ways: 2, icacheLines: 16, l2Lines: 64 }],
  ['2-wide', { arch: 'inorder2', forwarding: true, cacheLines: 16 }],
  ['2-wide + L2', { arch: 'inorder2', forwarding: true, cacheLines: 64, ways: 4, icacheLines: 16, l2Lines: 64 }],
  ['ooo', { arch: 'ooo', width: 2, robSize: 8, schedSize: 6, fetchQueue: 4, cacheLines: 16, commitWidth: 4 }],
  ['ooo + I-cache', { arch: 'ooo', width: 2, robSize: 16, schedSize: 10, fetchQueue: 4, cacheLines: 16, icacheLines: 16 }],
  ['ooo wide', { arch: 'ooo', width: 4, robSize: 32, schedSize: 16, fetchQueue: 8, cacheLines: 64, ways: 4, icacheLines: 32, l2Lines: 128, predEntries: 512, predBits: 2 }],
  ['ooo scalar', { arch: 'ooo', width: 1, robSize: 2, schedSize: 1, fetchQueue: 2, cacheLines: 8 }],
  ['4 cores in-order', { arch: 'inorder', forwarding: true, cacheLines: 16, cores: 4 }],
  ['16 cores in-order', { arch: 'inorder', forwarding: true, cacheLines: 8, cores: 16 }],
  ['2 cores ooo', { arch: 'ooo', width: 4, robSize: 32, schedSize: 16, fetchQueue: 8, cacheLines: 64, ways: 4, cores: 2 }],
];

const inside = (a: Rect, o: Rect, m = 0): boolean => a.x >= o.x - m && a.y >= o.y - m && a.x + a.w <= o.x + o.w + m && a.y + a.h <= o.y + o.h + m;
const apart = (a: Rect, c: Rect): boolean => a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y;
const onEdge = (p: Pt, r: Rect): boolean => {
  const x = p[0], y = p[1];
  const inX = x >= r.x && x <= r.x + r.w, inY = y >= r.y && y <= r.y + r.h;
  return (inX && (y === r.y || y === r.y + r.h)) || (inY && (x === r.x || x === r.x + r.w));
};
/** Does the axis-aligned segment a-b pass through the inside of r (the edge itself does not count)? */
const crosses = (a: Pt, b: Pt, r: Rect): boolean => {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;
};

function check(plan: CpuPlan): string[] {
  const bad: string[] = [];
  const byId = new Map<string, Block>();
  for (const b of plan.blocks) {
    if (byId.has(b.id)) bad.push(`duplicate block id ${b.id}`);
    byId.set(b.id, b);
    if (!inside(b.rect, DIE)) bad.push(`${b.id} is outside the die`);
    if (b.rect.w <= 0 || b.rect.h <= 0) bad.push(`${b.id} has no area`);
    if (b.parent) {
      const p = byId.get(b.parent);
      if (!p) bad.push(`${b.id}: parent ${b.parent} is not defined before it`);
      else if (!inside(b.rect, p.rect)) bad.push(`${b.id} sticks out of its frame ${b.parent}`);
    }
  }
  for (let i = 0; i < plan.blocks.length; i++) {
    for (let j = i + 1; j < plan.blocks.length; j++) {
      const a = plan.blocks[i]!, c = plan.blocks[j]!;
      if (a.parent === c.id || c.parent === a.id) continue; // a child sits inside its frame
      if (!apart(a.rect, c.rect)) bad.push(`${a.id} overlaps ${c.id}`);
    }
  }
  const ids = new Set<string>();
  for (const l of plan.links) {
    if (ids.has(l.id)) bad.push(`duplicate link id ${l.id}`);
    ids.add(l.id);
    const a = byId.get(l.from), c = byId.get(l.to);
    if (!a || !c) { bad.push(`${l.id}: unknown end ${l.from} / ${l.to}`); continue; }
    if (l.pts.length < 2) bad.push(`${l.id} has fewer than two points`);
    const p0 = l.pts[0]!, p1 = l.pts[l.pts.length - 1]!;
    if (!onEdge(p0, a.rect)) bad.push(`${l.id} starts off the edge of ${l.from}`);
    if (!onEdge(p1, c.rect)) bad.push(`${l.id} ends off the edge of ${l.to}`);
    for (let k = 1; k < l.pts.length; k++) {
      const u = l.pts[k - 1]!, v = l.pts[k]!;
      if (u[0] !== v[0] && u[1] !== v[1]) bad.push(`${l.id} has a diagonal segment`);
      if (u[0] === v[0] && u[1] === v[1]) bad.push(`${l.id} has a zero-length segment`);
      if (!inside({ x: Math.min(u[0], v[0]), y: Math.min(u[1], v[1]), w: Math.abs(u[0] - v[0]), h: Math.abs(u[1] - v[1]) }, DIE)) bad.push(`${l.id} leaves the die`);
      for (const o of plan.blocks) {
        if (o.kind === 'stage' || o.id === l.from || o.id === l.to) continue;
        if (crosses(u, v, o.rect)) bad.push(`${l.id} runs through ${o.id}`);
      }
    }
  }
  return bad;
}

const count = (plan: CpuPlan, id: string): number | undefined => plan.blocks.find((b) => b.id === id)?.grid?.count;

describe('cpu floorplans', () => {
  describe.each(CONFIGS)('%s', (_name, input) => {
    const plan = cpuPlan(input);
    it('fits the die with no overlaps and clean links', () => {
      expect(check(plan)).toEqual([]);
    });
    it('is deterministic', () => {
      expect(cpuPlan(input)).toEqual(plan);
    });
    it('has a grid per structure, sized by the configuration', () => {
      const p = (id: string) => (input.cores ?? 1) > 1 ? `c0.${id}` : id;
      expect(count(plan, p('rf'))).toBe(16);
      expect(count(plan, p('dc'))).toBe(input.cacheLines ?? 8);
      if (input.icacheLines) expect(count(plan, p('ic'))).toBe(input.icacheLines);
      else expect(plan.blocks.some((b) => b.id === p('ic'))).toBe(false);
      if (input.l2Lines && (input.cores ?? 1) === 1) expect(count(plan, 'l2')).toBe(input.l2Lines);
      if (input.arch === 'ooo') {
        expect(count(plan, p('rob'))).toBe(input.robSize);
        expect(count(plan, p('sched'))).toBe(input.schedSize);
        expect(count(plan, p('fq'))).toBe(input.fetchQueue);
        expect(plan.blocks.filter((b) => b.kind === 'decode')).toHaveLength((input.width ?? 2) * (input.cores ?? 1));
      }
      if (input.arch !== 'unpipelined') expect(count(plan, p('bp'))).toBe(input.predEntries ?? 64);
      else expect(plan.blocks.some((b) => b.kind === 'predictor')).toBe(false);
    });
  });

  it('has a clock, an interrupt controller and a bus interface on every core', () => {
    for (const [, input] of CONFIGS) {
      const plan = cpuPlan(input);
      const n = input.cores ?? 1;
      for (const kind of ['clock', 'intc'] as const) expect(plan.blocks.filter((b) => b.kind === kind)).toHaveLength(n);
      expect(plan.blocks.filter((b) => b.kind === 'biu').length).toBeGreaterThanOrEqual(1);
      expect(plan.links.some((l) => l.kind === 'irq')).toBe(true);
    }
  });

  it('shows the structures only the architecture has', () => {
    const kinds = (i: PlanInput) => new Set(cpuPlan(i).blocks.map((b) => b.kind));
    expect(kinds({ arch: 'unpipelined' }).has('latch')).toBe(false);
    expect(kinds({ arch: 'unpipelined' }).has('control')).toBe(true);
    expect(kinds({ arch: 'inorder', forwarding: false }).has('latch')).toBe(true);
    expect(kinds({ arch: 'inorder', forwarding: false }).has('forward')).toBe(false);
    expect(kinds({ arch: 'inorder', forwarding: true }).has('forward')).toBe(true);
    expect(kinds({ arch: 'inorder2', forwarding: true }).has('bundle')).toBe(true);
    for (const k of ['rob', 'sched', 'rename', 'resultbus', 'queue'] as const) expect(kinds({ arch: 'ooo' }).has(k)).toBe(true);
    expect(kinds({ arch: 'inorder', forwarding: true }).has('rob')).toBe(false);
  });

  it('draws one lit unit per OoO functional unit, with the names of the engine', () => {
    const plan = cpuPlan({ arch: 'ooo' });
    expect(plan.blocks.filter((b) => b.unit).map((b) => b.unit).sort()).toEqual(['ALU0', 'ALU1', 'LSU', 'MUL']);
  });

  it('gives a stage frame to every pipeline stage, in order', () => {
    const plan = cpuPlan({ arch: 'inorder', forwarding: true });
    const frames = plan.blocks.filter((b) => b.kind === 'stage');
    expect(frames.map((f) => f.stage)).toEqual([0, 1, 2, 3, 4]);
    const xs = frames.map((f) => f.rect.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('plans every CPU in the catalog from its engine config', () => {
    const cpus = specsOfKind('cpu') as CpuSpec[];
    expect(cpus.length).toBeGreaterThanOrEqual(5);
    for (const s of cpus) {
      const plan = cpuPlan(planInput(s.engine));
      expect(check(plan), s.id).toEqual([]);
      const wanted = s.engine.kind === 'ooo' ? 'ooo' : s.engine.kind === 'inorder2' ? 'inorder2' : s.engine.kind === 'inorder' ? 'inorder' : 'unpipelined';
      expect(plan.arch, s.id).toBe(wanted);
    }
  });

  it('draws different dies for different architectures (no shared floorplan)', () => {
    const sig = (i: PlanInput) => JSON.stringify(cpuPlan(i).blocks.map((b) => [b.id, b.rect]));
    const set = new Set([
      sig({ arch: 'unpipelined' }), sig({ arch: 'inorder', forwarding: false }), sig({ arch: 'inorder', forwarding: true }),
      sig({ arch: 'inorder2', forwarding: true }), sig({ arch: 'ooo' }),
    ]);
    expect(set.size).toBe(5);
  });
});

describe('ortho routing', () => {
  it('goes square, with a Z in the middle when both ends face the same way', () => {
    expect(ortho([0, 0], true, [], [100, 40], true)).toEqual([[0, 0], [50, 0], [50, 40], [100, 40]]);
    expect(ortho([0, 0], false, [], [40, 100], false)).toEqual([[0, 0], [0, 50], [40, 50], [40, 100]]);
  });
  it('leaves along the first axis and arrives along the last', () => {
    expect(ortho([0, 0], true, [], [60, 60], false)).toEqual([[0, 0], [60, 0], [60, 60]]);
    expect(ortho([0, 0], false, [], [60, 60], true)).toEqual([[0, 0], [0, 60], [60, 60]]);
  });
  it('drops collinear middle points', () => {
    expect(ortho([0, 0], true, [[20, 0], [40, 0]], [60, 0], true)).toEqual([[0, 0], [60, 0]]);
  });
});
