// Invariants of the GPU card floorplans (docs/GPU.md section 7): the blocks tile the die, nothing overlaps, every cell grid is exact, every link
// starts and ends on the edge of the blocks it names and runs square through the gutters, and the tiers differ.
import { describe, expect, it } from 'vitest';
import { specsOfKind } from '../../sim/board/specs';
import type { Pt, Rect } from '../die/cpuplan';
import { leaf, routeWires, row, placeTree } from '../die/cpufloor';
import { gpuPlanInput, type GpuBlock, type GpuPlan, type GpuPlanInput } from './gpuplan';
import { DIE_MARGIN, GPU_DIE, gpuPlan } from './gpuplans';

const inside = (a: Rect, o: Rect): boolean => a.x >= o.x && a.y >= o.y && a.x + a.w <= o.x + o.w && a.y + a.h <= o.y + o.h;
const apart = (a: Rect, c: Rect): boolean => a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y;
const onEdge = (p: Pt, r: Rect): boolean => {
  const inX = p[0] >= r.x && p[0] <= r.x + r.w, inY = p[1] >= r.y && p[1] <= r.y + r.h;
  return (inX && (p[1] === r.y || p[1] === r.y + r.h)) || (inY && (p[0] === r.x || p[0] === r.x + r.w));
};
const crosses = (a: Pt, b: Pt, r: Rect): boolean => {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;
};

function check(plan: GpuPlan): string[] {
  const bad: string[] = [];
  const byId = new Map<string, GpuBlock>();
  for (const b of plan.blocks) {
    if (byId.has(b.id)) bad.push(`duplicate block id ${b.id}`);
    byId.set(b.id, b);
    if (!inside(b.rect, plan.die)) bad.push(`${b.id} is outside the die`);
    if (b.rect.w <= 0 || b.rect.h <= 0) bad.push(`${b.id} has no area`);
    if (b.parent) {
      const p = byId.get(b.parent);
      if (!p) bad.push(`${b.id}: parent ${b.parent} is not defined before it`);
      else if (!inside(b.rect, p.rect)) bad.push(`${b.id} sticks out of its frame ${b.parent}`);
    }
    if (b.grid && (b.grid.cols * b.grid.rows !== b.grid.count || b.grid.cols < 1 || b.grid.rows < 1)) bad.push(`${b.id} has an inexact grid ${b.grid.cols}x${b.grid.rows} for ${b.grid.count}`);
  }
  for (let i = 0; i < plan.blocks.length; i++) {
    for (let j = i + 1; j < plan.blocks.length; j++) {
      const a = plan.blocks[i]!, c = plan.blocks[j]!;
      if (a.parent === c.id || c.parent === a.id) continue;
      if (!apart(a.rect, c.rect)) bad.push(`${a.id} overlaps ${c.id}`);
    }
  }
  const frames = new Set(plan.blocks.map((b) => b.parent).filter(Boolean));
  const ids = new Set<string>();
  for (const l of plan.links) {
    if (ids.has(l.id)) bad.push(`duplicate link id ${l.id}`);
    ids.add(l.id);
    const a = byId.get(l.from), c = byId.get(l.to);
    if (!a || !c) { bad.push(`${l.id}: unknown end ${l.from} / ${l.to}`); continue; }
    if (l.pts.length < 2) bad.push(`${l.id} has fewer than two points`);
    if (!onEdge(l.pts[0]!, a.rect)) bad.push(`${l.id} starts off the edge of ${l.from}`);
    if (!onEdge(l.pts[l.pts.length - 1]!, c.rect)) bad.push(`${l.id} ends off the edge of ${l.to}`);
    for (let k = 1; k < l.pts.length; k++) {
      const u = l.pts[k - 1]!, v = l.pts[k]!;
      if (u[0] !== v[0] && u[1] !== v[1]) bad.push(`${l.id} has a diagonal segment`);
      if (u[0] === v[0] && u[1] === v[1]) bad.push(`${l.id} has a zero-length segment`);
      if (!inside({ x: Math.min(u[0], v[0]), y: Math.min(u[1], v[1]), w: Math.abs(u[0] - v[0]), h: Math.abs(u[1] - v[1]) }, plan.die)) bad.push(`${l.id} leaves the die`);
      for (const o of plan.blocks) {
        if (frames.has(o.id) || o.id === l.from || o.id === l.to) continue;
        if (crosses(u, v, o.rect)) bad.push(`${l.id} runs through ${o.id}`);
      }
    }
  }
  return bad;
}

const base: GpuPlanInput = { kind: 'warp', sms: 1, warps: 2, lanes: 16, banks: 2, memBytes: 32768, lineWords: 8, l1Lines: 0, l2Lines: 0 };
const CONFIGS: [string, GpuPlanInput][] = [
  ['simd 8 lanes', { kind: 'simd', sms: 1, warps: 1, lanes: 8, banks: 1, memBytes: 16384, lineWords: 1, l1Lines: 0, l2Lines: 0 }],
  ['simd 32 lanes, 4 banks', { kind: 'simd', sms: 1, warps: 1, lanes: 32, banks: 4, memBytes: 65536, lineWords: 1, l1Lines: 0, l2Lines: 0 }],
  ['warp, 2 warps', base],
  ['warp, 1 warp', { ...base, warps: 1, lanes: 8, banks: 1 }],
  ['warp, 4 warps, 32 lanes', { ...base, warps: 4, lanes: 32, banks: 4 }],
  ['multi, 2 SMs', { kind: 'multi', sms: 2, warps: 2, lanes: 32, banks: 4, memBytes: 65536, lineWords: 8, l1Lines: 16, l2Lines: 64 }],
  ['multi, 3 SMs', { kind: 'multi', sms: 3, warps: 2, lanes: 24, banks: 4, memBytes: 65536, lineWords: 8, l1Lines: 8, l2Lines: 32 }],
];

describe('gpu floorplans', () => {
  describe.each(CONFIGS)('%s', (_name, input) => {
    const plan = gpuPlan(input);
    it('is a valid plan', () => { expect(check(plan)).toEqual([]); });
    it('is deterministic and cached', () => { expect(gpuPlan(input)).toBe(plan); expect(JSON.stringify(gpuPlan({ ...input }))).toBe(JSON.stringify(plan)); });
    it('has a block of every part of the model', () => {
      const kinds = new Set(plan.blocks.map((b) => b.kind));
      for (const k of ['pcie', 'launch', 'regfile', 'lanes', 'mask', 'dram']) expect(kinds.has(k as never), k).toBe(true);
      expect(kinds.has('coalescer')).toBe(input.kind !== 'simd');
      expect(kinds.has('sched')).toBe(input.kind !== 'simd');
      expect(kinds.has('l2')).toBe(input.kind === 'multi');
    });
    it('shows the lanes and the registers as cells', () => {
      const per = input.lanes / input.sms;
      for (const b of plan.blocks.filter((x) => x.kind === 'lanes')) expect(b.grid?.count).toBe(per);
      for (const b of plan.blocks.filter((x) => x.kind === 'regfile')) expect(b.grid).toMatchObject({ cols: per, rows: 8 });
    });
    it('uses most of the die', () => {
      const frames = new Set(plan.blocks.map((b) => b.parent).filter(Boolean));
      const area = plan.blocks.filter((b) => !frames.has(b.id) && b.kind !== 'sm').reduce((n, b) => n + b.rect.w * b.rect.h, 0);
      expect(area / ((plan.die.w - 2 * DIE_MARGIN.x) * (plan.die.h - DIE_MARGIN.top - DIE_MARGIN.bottom))).toBeGreaterThan(0.7);
    });
    it('leaves the south margin for the title strip and knows the card memory size', () => {
      for (const b of plan.blocks) expect(b.rect.y + b.rect.h, b.id).toBeLessThanOrEqual(plan.die.h - DIE_MARGIN.bottom + 0.5);
      expect(plan.blocks.find((b) => b.id === 'dram')?.bytes).toBe(input.memBytes);
    });
  });

  it('every card spec plans, and the tiers differ', () => {
    const plans = specsOfKind('gpu').map((s) => gpuPlan(gpuPlanInput(s.gpu!)));
    expect(plans.length).toBeGreaterThanOrEqual(3);
    for (const p of plans) expect(check(p)).toEqual([]);
    expect(new Set(plans.map((p) => p.blocks.length)).size).toBe(plans.length);
    expect(new Set(plans.map((p) => p.input.kind)).size).toBe(plans.length);
  });

  it('a multi-SM card has one framed SM per SM, with the SM ids on its blocks', () => {
    const plan = gpuPlan(CONFIGS[5]![1]);
    expect(plan.blocks.filter((b) => b.kind === 'sm').map((b) => b.id)).toEqual(['sm0', 'sm1']);
    expect(plan.blocks.filter((b) => b.kind === 'lanes').map((b) => [b.id, b.sm])).toEqual([['sm0.lanes', 0], ['sm1.lanes', 1]]);
    expect(plan.blocks.find((b) => b.id === 'l2')?.grid?.count).toBe(64);
  });

  it('the single SM of the smaller cards is framed too, with its blocks keeping their plain ids', () => {
    for (const s of specsOfKind('gpu').filter((x) => x.gpu!.kind !== 'multi')) {
      const plan = gpuPlan(gpuPlanInput(s.gpu!));
      expect(plan.blocks.filter((b) => b.kind === 'sm').map((b) => b.id), s.id).toEqual(['sm0']);
      expect(plan.blocks.find((b) => b.id === 'lanes')?.parent, s.id).toBe('sm0');
      expect(plan.blocks.find((b) => b.id === 'lanes')?.sm, s.id).toBe(0);
    }
  });

  it('the plan follows the config: lanes, banks, warps and caches change the cells', () => {
    const a = gpuPlan(base), b = gpuPlan({ ...base, lanes: 32, banks: 4, warps: 4 });
    expect(a.blocks.find((x) => x.kind === 'banks')?.grid?.count).toBe(2);
    expect(b.blocks.find((x) => x.kind === 'banks')?.grid?.count).toBe(4);
    expect(b.blocks.find((x) => x.kind === 'warps')?.grid?.count).toBe(4);
    expect(b.blocks.find((x) => x.kind === 'regfile')?.grid?.cols).toBe(32);
  });

  it('plans are the size GPU_DIE says', () => {
    for (const [name, input] of CONFIGS) expect(gpuPlan(input).die, name).toMatchObject({ w: GPU_DIE[input.kind].w, h: GPU_DIE[input.kind].h });
  });

  it('the router throws when a link has nowhere to go', () => {
    // a block walled in by two neighbours and the die edge: no gutter reaches it
    const tree = row([leaf('a', 'pcie', 'A', { px: 60 }), leaf('b', 'pcie', 'B', { px: 60 }), leaf('c', 'pcie', 'C', { px: 60 })], { gap: 0 });
    const blocks: GpuBlock[] = [];
    placeTree(tree, { x: 20, y: 20, w: 180, h: 60 }, blocks, (s, r) => ({ id: s.id, kind: 'pcie', label: s.label, rect: { ...r } }));
    expect(() => routeWires({ x: 0, y: 0, w: 220, h: 100 }, blocks, [{ id: 'x', kind: 'data', from: 'a', to: 'c' }], undefined, 'gpuplan')).toThrow(/gpuplan/);
  });
});
