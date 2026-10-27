// Invariants of the CPU die floorplans (docs/DIE.md): the blocks tile the die, nothing overlaps, the board-facing blocks sit on the edge their
// pins are on, every cell grid is exact, every link starts and ends on the edge of the blocks it names and runs square through the gutters.
import { describe, expect, it } from 'vitest';
import { specsOfKind, type CpuSpec } from '../sim/board/specs';
import { gridExact, planInput, type Block, type CpuPlan, type PlanInput, type Pt, type Rect } from './cpuplan';
import { GAP, col, leaf, place, routeLinks, row, spans } from './cpufloor';
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
  ['5-stage + MMU', { arch: 'inorder', forwarding: true, cacheLines: 16, tlbEntries: 4 }],
  ['2-wide + MMU + L2', { arch: 'inorder2', forwarding: true, cacheLines: 64, ways: 4, icacheLines: 16, l2Lines: 64, tlbEntries: 16 }],
  ['ooo + MMU', { arch: 'ooo', width: 2, robSize: 16, schedSize: 10, fetchQueue: 4, cacheLines: 16, icacheLines: 16, tlbEntries: 8 }],
  ['ooo wide + MMU + L2', { arch: 'ooo', width: 4, robSize: 32, schedSize: 16, fetchQueue: 8, cacheLines: 64, ways: 4, icacheLines: 32, l2Lines: 128, tlbEntries: 32 }],
  ['4 cores in-order', { arch: 'inorder', forwarding: true, cacheLines: 16, cores: 4, l2Lines: 64 }],
  ['8 cores in-order', { arch: 'inorder', forwarding: true, cacheLines: 8, cores: 8, l2Lines: 128 }],
  ['2 cores ooo', { arch: 'ooo', width: 4, robSize: 32, schedSize: 16, fetchQueue: 8, cacheLines: 64, ways: 4, cores: 2, l2Lines: 128 }],
];

const inside = (a: Rect, o: Rect): boolean => a.x >= o.x && a.y >= o.y && a.x + a.w <= o.x + o.w && a.y + a.h <= o.y + o.h;
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
const isPow2 = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

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
    if (b.grid && (b.grid.cols * b.grid.rows !== b.grid.count || b.grid.cols < 1 || b.grid.rows < 1)) bad.push(`${b.id} has an inexact grid ${b.grid.cols}x${b.grid.rows} for ${b.grid.count}`);
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
    if (!(l.lanes >= 1 && l.lanes <= 4)) bad.push(`${l.id} has ${l.lanes} lanes`);
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

const get = (plan: CpuPlan, id: string): Block => {
  const b = plan.blocks.find((x) => x.id === id);
  if (!b) throw new Error(`no block ${id}`);
  return b;
};
const count = (plan: CpuPlan, id: string): number | undefined => plan.blocks.find((b) => b.id === id)?.grid?.count;
/** The share of the die's usable area the (non-frame) blocks cover. */
const usage = (plan: CpuPlan): number => {
  const area = plan.blocks.filter((b) => b.kind !== 'stage').reduce((n, b) => n + b.rect.w * b.rect.h, 0);
  return area / ((DIE.w - 48) * (DIE.h - 48));
};

describe('cpu floorplans', () => {
  describe.each(CONFIGS)('%s', (_name, input) => {
    const plan = cpuPlan(input);
    const n = input.cores ?? 1;
    const p = (id: string) => (n > 1 ? `c0.${id}` : id);
    it('fits the die with no overlaps, exact grids and clean links', () => {
      expect(check(plan)).toEqual([]);
    });
    it('uses the die: the blocks tile it', () => {
      expect(usage(plan)).toBeGreaterThan(n > 1 ? 0.55 : 0.78);
    });
    it('is deterministic', () => {
      expect(cpuPlan({ ...input })).toEqual(plan);
    });
    it('has a grid per structure, sized by the configuration', () => {
      expect(count(plan, p('rf'))).toBe(16);
      expect(count(plan, p('dc'))).toBe(input.cacheLines ?? 8);
      if (input.icacheLines) expect(count(plan, p('ic'))).toBe(input.icacheLines);
      else expect(plan.blocks.some((b) => b.id === p('ic'))).toBe(false);
      if (input.l2Lines) expect(count(plan, n > 1 ? 'l2s' : 'l2')).toBe(input.l2Lines);
      if (input.arch === 'ooo') {
        expect(count(plan, p('rob'))).toBe(input.robSize);
        expect(count(plan, p('sched'))).toBe(input.schedSize);
        expect(count(plan, p('fq'))).toBe(input.fetchQueue);
        expect(plan.blocks.filter((b) => b.kind === 'decode')).toHaveLength((input.width ?? 2) * n);
      }
      if (input.arch !== 'unpipelined') expect(count(plan, p('bp'))).toBe(input.predEntries ?? 64);
      else expect(plan.blocks.some((b) => b.kind === 'predictor')).toBe(false);
    });
    it('puts the board-facing blocks on the edge their pins are on', () => {
      const core = plan.blocks.filter((b) => b.zone === 'core' && b.kind !== 'stage');
      const left = Math.min(...core.map((b) => b.rect.x)), right = Math.max(...core.map((b) => b.rect.x + b.rect.w));
      const top = Math.min(...core.map((b) => b.rect.y)), bottom = Math.max(...core.map((b) => b.rect.y + b.rect.h));
      const west = (id: string) => get(plan, id).rect.x + get(plan, id).rect.w <= left;
      expect(get(plan, 'mc').rect.x).toBeGreaterThanOrEqual(right);   // the DIMM bus leaves east
      expect(west('usb') && west('display') && west('intc')).toBe(true); // USB, video out, interrupts: west
      for (const id of ['pwr', 'thermal']) expect(get(plan, id).rect.y + get(plan, id).rect.h).toBeLessThanOrEqual(top); // vcore and SVID: north
      for (const id of ['pcie', 'clk']) expect(get(plan, id).rect.y).toBeGreaterThanOrEqual(bottom - 1);               // PCIe, NVMe, DMI, the crystal: south
    });
  });

  it('has the clock, the interrupt controller and every edge block exactly once', () => {
    for (const [, input] of CONFIGS) {
      const plan = cpuPlan(input);
      for (const id of ['pwr', 'thermal', 'mc', 'pcie', 'clk', 'usb', 'display', 'intc', 'fabric']) expect(plan.blocks.filter((b) => b.id === id), id).toHaveLength(1);
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
    for (const [, i] of CONFIGS) expect(kinds(i).has('port')).toBe(false); // no invented fetch port: without an I-cache fetch goes through the bus
  });

  it('draws one lit unit per OoO functional unit, with the names of the engine', () => {
    const plan = cpuPlan({ arch: 'ooo' });
    expect(plan.blocks.filter((b) => b.unit).map((b) => b.unit).sort()).toEqual(['ALU0', 'ALU1', 'LSU', 'MUL']);
  });

  it('gives a stage frame to every pipeline stage, in order', () => {
    const frames = cpuPlan({ arch: 'inorder', forwarding: true }).blocks.filter((b) => b.kind === 'stage');
    expect(frames.map((f) => f.stage)).toEqual([0, 1, 2, 3, 4]);
    const xs = frames.map((f) => f.rect.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('keeps every grid a full rectangle: power-of-two counts have power-of-two sides', () => {
    for (const [, input] of CONFIGS) {
      for (const b of cpuPlan(input).blocks) {
        if (!b.grid || !isPow2(b.grid.count)) continue;
        expect(isPow2(b.grid.cols) && isPow2(b.grid.rows), `${b.id} ${b.grid.cols}x${b.grid.rows}`).toBe(true);
      }
    }
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

describe('gridExact', () => {
  it('is an exact rectangle of cells, never a partial row', () => {
    for (const n of [1, 2, 4, 6, 8, 10, 12, 16, 32, 64, 128, 512]) {
      const g = gridExact(n, 300, 200);
      expect(g.cols * g.rows).toBe(n);
    }
  });
  it('splits a power of two into power-of-two sides, long side along the long side of the box', () => {
    expect(gridExact(8, 400, 120)).toEqual({ cols: 4, rows: 2, count: 8 });
    expect(gridExact(8, 200, 200)).toEqual({ cols: 2, rows: 4, count: 8 });
    expect(gridExact(8, 120, 400)).toEqual({ cols: 1, rows: 8, count: 8 });
    expect(gridExact(16, 300, 300)).toEqual({ cols: 4, rows: 4, count: 16 });
    expect(gridExact(64, 300, 300)).toEqual({ cols: 8, rows: 8, count: 64 });
  });
  it('makes a prime count a single row or column', () => {
    const g = gridExact(7, 300, 100);
    expect([g.cols, g.rows].sort()).toEqual([1, 7]);
  });
});

describe('slicing layout', () => {
  it('spans fill the length exactly, with the gutter between every pair', () => {
    const sp = spans(1000, [{ f: 1 }, { px: 30 }, { f: 2 }, { f: 1.3 }], GAP);
    expect(sp[0]![0]).toBe(0);
    for (let i = 1; i < sp.length; i++) expect(sp[i]![0] - (sp[i - 1]![0] + sp[i - 1]![1])).toBe(GAP);
    expect(sp[sp.length - 1]![0] + sp[sp.length - 1]![1]).toBe(1000);
    expect(sp[1]![1]).toBe(30);
  });
  it('places a tree edge to edge, a frame before its children', () => {
    const out: Block[] = [];
    place(row([col([leaf('a', 'pc', 'A'), leaf('b', 'pc', 'B', { px: 40 })], { frame: { id: 'f', kind: 'stage', label: 'F' }, f: 1 }), leaf('c', 'pc', 'C', { px: 100 })]), { x: 0, y: 0, w: 400, h: 300 }, out);
    expect(out.map((b) => b.id)).toEqual(['f', 'a', 'b', 'c']);
    expect(out.find((b) => b.id === 'c')!.rect).toEqual({ x: 300, y: 0, w: 100, h: 300 });
    expect(out.find((b) => b.id === 'a')!.parent).toBe('f');
  });
});

describe('channel router', () => {
  const die = { x: 0, y: 0, w: 400, h: 300 };
  const mk = (id: string, r: Rect): Block => ({ id, kind: 'pc', label: id, rect: r, zone: 'core' });
  it('joins two neighbours with a jog along the gutter (a visible wire, not a stub): out of one edge high, into the other low', () => {
    const blocks = [mk('a', { x: 40, y: 40, w: 100, h: 100 }), mk('b', { x: 154, y: 40, w: 100, h: 100 })];
    const [l] = routeLinks(die, blocks, [{ id: 'l', kind: 'data', from: 'a', to: 'b' }]);
    expect(l!.pts).toHaveLength(4);
    expect(l!.pts[0]![0]).toBe(140);
    expect(l!.pts[3]![0]).toBe(154);
    expect(l!.pts[0]![1]).toBeLessThan(l!.pts[3]![1]);
    expect(l!.pts[1]![0]).toBe(l!.pts[2]![0]); // the run along the gutter
    expect(l!.pts[2]![1] - l!.pts[1]![1]).toBeGreaterThan(30);
  });
  it('keeps a hop straight where the blocks face each other along too little of their edges to jog', () => {
    const blocks = [mk('a', { x: 40, y: 40, w: 100, h: 100 }), mk('b', { x: 154, y: 120, w: 100, h: 100 })];
    const [l] = routeLinks(die, blocks, [{ id: 'l', kind: 'data', from: 'a', to: 'b' }]);
    expect(l!.pts.length).toBeLessThanOrEqual(4);
    for (let k = 1; k < l!.pts.length; k++) expect(l!.pts[k]![0] === l!.pts[k - 1]![0] || l!.pts[k]![1] === l!.pts[k - 1]![1]).toBe(true);
  });
  it('goes around a block in the way, through the gutters only', () => {
    const blocks = [mk('a', { x: 40, y: 100, w: 60, h: 60 }), mk('wall', { x: 114, y: 40, w: 60, h: 180 }), mk('b', { x: 188, y: 100, w: 60, h: 60 })];
    const [l] = routeLinks(die, blocks, [{ id: 'l', kind: 'data', from: 'a', to: 'b' }]);
    for (let k = 1; k < l!.pts.length; k++) expect(crosses(l!.pts[k - 1]!, l!.pts[k]!, blocks[1]!.rect)).toBe(false);
    expect(l!.pts.length).toBeGreaterThan(2);
  });
  it('fails loudly when a block is walled in', () => {
    const blocks = [mk('a', { x: 150, y: 100, w: 40, h: 40 }), mk('wall', { x: 40, y: 40, w: 320, h: 220 }), mk('b', { x: 380, y: 280, w: 10, h: 10 })];
    expect(() => routeLinks(die, blocks, [{ id: 'l', kind: 'data', from: 'a', to: 'b' }])).toThrow(/no route|no free edge/);
  });
});

describe('the TLB', () => {
  it('is drawn when the CPU has an MMU, with one cell per entry and the links of translation and the page walk, and not otherwise', () => {
    for (const tlb of [4, 8, 16, 32]) {
      for (const arch of ['inorder', 'inorder2', 'ooo'] as const) {
        const p = cpuPlan({ arch, cacheLines: 16, tlbEntries: tlb, l2Lines: tlb % 8 === 0 ? 64 : 0 });
        const b = p.blocks.find((x) => x.kind === 'tlb');
        expect(b, `${arch} ${tlb}`).toBeDefined();
        expect(b!.grid!.count).toBe(tlb);
        for (const id of ['lsu-tlb', 'fetch-tlb', 'tlb-walk']) expect(p.links.some((l) => l.id === id), `${arch} ${id}`).toBe(true);
      }
    }
    for (const arch of ['unpipelined', 'inorder', 'ooo'] as const) expect(cpuPlan({ arch, cacheLines: 8 }).blocks.some((x) => x.kind === 'tlb')).toBe(false);
  });

  it('every shipped CPU with an MMU draws its TLB at the size of its spec', () => {
    for (const s of specsOfKind('cpu') as CpuSpec[]) {
      const p = cpuPlan(planInput(s.engine, s.mmu ? { tlbEntries: s.mmu.tlb } : {}));
      expect(p.blocks.find((x) => x.kind === 'tlb')?.grid?.count, s.id).toBe(s.mmu?.tlb);
    }
  });
});
