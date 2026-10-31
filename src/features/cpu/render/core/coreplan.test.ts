import { describe, expect, it } from 'vitest';
import { cpuPlan } from './cpuplans';
import { splitPlan } from './coreplan';
import { packetsFor, type BeatEvent } from '../die/diemotion';

describe('splitPlan', () => {
  it('is null for a single-core plan', () => {
    expect(splitPlan(cpuPlan({ arch: 'inorder', cacheLines: 8 }))).toBeNull();
  });

  it.each([{ arch: 'inorder', cores: 4 }, { arch: 'ooo', cores: 2 }] as const)('$arch x$cores: one plan per tile and the rest shared', (i) => {
    const plan = cpuPlan({ ...i, cacheLines: 8, l2Lines: 32 });
    const sp = splitPlan(plan)!;
    expect(sp.tiles).toHaveLength(i.cores);
    const total = sp.tiles.reduce((n, t) => n + t.plan.blocks.length, sp.shared.blocks.length);
    expect(total).toBe(plan.blocks.length);
    for (const [k, t] of sp.tiles.entries()) {
      expect(t.plan.cores).toBe(1);
      expect(t.plan.die).toEqual(plan.tiles![k]);
      expect(t.scale).toBeGreaterThan(0.2);
      expect(t.scale).toBeLessThanOrEqual(1);
      const ids = new Set(t.plan.blocks.map((b) => b.id));
      expect(ids.has('pc') && ids.has('fetch')).toBe(true);
      expect(t.plan.blocks.every((b) => b.core === undefined && !b.id.startsWith('c'))).toBe(true);
      // every link of a tile joins two blocks of it
      for (const l of t.plan.links) { expect(ids.has(l.from), l.id).toBe(true); expect(ids.has(l.to), l.id).toBe(true); }
      for (const b of t.plan.blocks) expect(b.rect.x >= t.rect.x - 1 && b.rect.y >= t.rect.y - 1 && b.rect.x + b.rect.w <= t.rect.x + t.rect.w + 1, b.id).toBe(true);
    }
    expect(sp.shared.blocks.some((b) => b.core !== undefined)).toBe(false);
    expect(sp.shared.blocks.some((b) => b.id === 'l2s')).toBe(true);
  });

  it('gives each tile the shared blocks and the wires out to them, so a miss and an instruction fetch leave the tile', () => {
    for (const arch of ['inorder', 'ooo'] as const) {
      const sp = splitPlan(cpuPlan({ arch, cores: 4, cacheLines: 8, l2Lines: 32 }))!;
      for (const t of sp.tiles) {
        const ids = new Set(t.motion.blocks.map((b) => b.id));
        for (const id of ['l2', 'fabric', 'mc', 'intc', 'pc', 'dc']) expect(ids.has(id), `${arch} ${id}`).toBe(true);
        expect(ids.has('l2s')).toBe(false);
        for (const l of t.motion.links) { expect(ids.has(l.from), l.id).toBe(true); expect(ids.has(l.to), l.id).toBe(true); }
        expect(t.motion.links.some((l) => l.kind === 'irq' && l.from === 'intc')).toBe(true);
        const beat = (to: string, op: string, miss: boolean): BeatEvent => ({ to, lane: 0, op, id: 1, cycle: 5, text: op, pc: 0, dwell: 3, miss });
        const via = (b: BeatEvent) => packetsFor(t.motion, b).map((p) => p.link.id);
        // a data cache miss goes out through the shared L2, the bus and the memory controller, and the line comes back the same way
        const miss = via(beat(arch === 'ooo' ? 'X' : 'M', 'lw', true));
        for (const id of ['dc-l2', 'l2-fab', 'fab-mc']) expect(miss, `${arch} miss ${id}`).toContain(id);
        // an instruction fetch (no instruction cache on these tiles) goes to the L2 too
        expect(via(beat('F', 'add', false)).some((id) => id === 'src-l2'), `${arch} fetch`).toBe(true);
        // on the tile's own plan nothing leaves it
        expect(packetsFor(t.plan, beat(arch === 'ooo' ? 'X' : 'M', 'lw', true)).every((p) => !['dc-l2', 'l2-fab', 'fab-mc'].includes(p.link.id))).toBe(true);
      }
    }
  });
});
