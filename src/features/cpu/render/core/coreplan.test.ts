import { describe, expect, it } from 'vitest';
import { cpuPlan } from './cpuplans';
import { splitPlan } from './coreplan';
import { packetsFor } from '../die/diemotion';
import type * as motionTypes from '../die/diemotion';
import type * as planTypes from './cpuplan';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** Whether block `b` belongs to no core and has no `c<k>.` prefix. */
const isTileLocal = (b: planTypes.Block) => b.core === undefined && !b.id.startsWith('c');

/** Whether `r` lies inside `tile`, give or take a pixel on each side but the bottom. */
const insideTile = (r: planTypes.Rect, tile: planTypes.Rect) =>
  r.x >= tile.x - 1 && r.y >= tile.y - 1 && r.x + r.w <= tile.x + tile.w + 1;

/** Whether `l` is an interrupt wire from the interrupt controller. */
const isIrqFromIntc = (l: planTypes.Link) => l.kind === 'irq' && l.from === 'intc';

/** The stage a load reaches the data cache in, by architecture. */
const MEM_STAGE = { inorder: 'M', ooo: 'X' } as const;

/** A beat of instruction `op` into stage `to` at cycle 5 (a cache miss when `miss`). */
const beat = (to: string, op: string, miss: boolean): motionTypes.BeatEvent => ({
  to,
  lane: 0,
  op,
  id: 1,
  cycle: 5,
  text: op,
  pc: 0,
  dwell: 3,
  miss,
});

describe('splitPlan', () => {
  it('is null for a single-core plan', () => {
    expect(splitPlan(cpuPlan({ arch: 'inorder', cacheLines: 8 }))).toBeNull();
  });

  it.each([
    { arch: 'inorder', cores: 4 },
    { arch: 'ooo', cores: 2 },
  ] as const)('$arch x$cores: one plan per tile and the rest shared', (i) => {
    const plan = cpuPlan({ ...i, cacheLines: 8, l2Lines: 32 });
    const sp = must(splitPlan(plan));
    expect(sp.tiles).toHaveLength(i.cores);
    const total = sp.tiles.reduce((n, t) => n + t.plan.blocks.length, sp.shared.blocks.length);
    expect(total).toBe(plan.blocks.length);
    for (const [k, t] of sp.tiles.entries()) {
      expect(t.plan.cores).toBe(1);
      expect(t.plan.die).toStrictEqual(must(plan.tiles)[k]);
      expect(t.scale).toBeGreaterThan(0.2);
      expect(t.scale).toBeLessThanOrEqual(1);
      const ids = new Set(t.plan.blocks.map((b) => b.id));
      expect(['pc', 'fetch'].every((id) => ids.has(id))).toBe(true);
      expect(t.plan.blocks.every((b) => isTileLocal(b))).toBe(true);
      // every link of a tile joins two blocks of it
      for (const l of t.plan.links) {
        expect(ids.has(l.from), `link ${l.id}`).toBe(true);
        expect(ids.has(l.to), `link ${l.id}`).toBe(true);
      }
      for (const b of t.plan.blocks) {
        expect(insideTile(b.rect, t.rect), `block ${b.id}`).toBe(true);
      }
    }
    expect(sp.shared.blocks.some((b) => b.core !== undefined)).toBe(false);
    expect(sp.shared.blocks.some((b) => b.id === 'l2s')).toBe(true);
  });

  it('gives each tile the shared blocks and the wires out to them, so a miss and an instruction fetch leave the tile', () => {
    for (const arch of ['inorder', 'ooo'] as const) {
      const sp = must(splitPlan(cpuPlan({ arch, cores: 4, cacheLines: 8, l2Lines: 32 })));
      for (const t of sp.tiles) {
        const ids = new Set(t.motion.blocks.map((b) => b.id));
        for (const id of ['l2', 'fabric', 'mc', 'intc', 'pc', 'dc']) {
          expect(ids.has(id), `${arch} ${id}`).toBe(true);
        }
        expect(ids.has('l2s')).toBe(false);
        for (const l of t.motion.links) {
          expect(ids.has(l.from), `link ${l.id}`).toBe(true);
          expect(ids.has(l.to), `link ${l.id}`).toBe(true);
        }
        expect(t.motion.links.some((l) => isIrqFromIntc(l))).toBe(true);
        const via = (b: motionTypes.BeatEvent) => packetsFor(t.motion, b).map((p) => p.link.id);
        // a data cache miss goes out through the shared L2, the bus and the memory controller, and the line comes back the same way
        const miss = via(beat(MEM_STAGE[arch], 'lw', true));
        for (const id of ['dc-l2', 'l2-fab', 'fab-mc']) {
          expect(miss, `${arch} miss ${id}`).toContain(id);
        }
        // an instruction fetch (no instruction cache on these tiles) goes to the L2 too
        expect(
          via(beat('F', 'add', false)).some((id) => id === 'src-l2'),
          `${arch} fetch`,
        ).toBe(true);
        // on the tile's own plan nothing leaves it
        expect(
          packetsFor(t.plan, beat(MEM_STAGE[arch], 'lw', true)).every(
            (p) => !['dc-l2', 'l2-fab', 'fab-mc'].includes(p.link.id),
          ),
        ).toBe(true);
      }
    }
  });
});
