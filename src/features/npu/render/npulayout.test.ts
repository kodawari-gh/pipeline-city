import { assert, describe, expect, it } from 'vitest';
import { specsOfKind } from '../../board/sim/specs';
import { cardRect, CARD_LEN } from '@/core/render/accelart';
import { setLayoutTier } from '../../board/render/layout/layout';
import type * as layoutTypes from '../../board/render/layout/layout';
import { NPU_H, NPU_LEN, npuGeo, npuIds, npuInputOf, npuParts } from './npulayout';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const inside = (r: layoutTypes.Rect, o: layoutTypes.Rect): boolean =>
  r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const apart = (a: layoutTypes.Rect, c: layoutTypes.Rect): boolean =>
  a.x + a.w <= c.x + 0.01 || c.x + c.w <= a.x + 0.01 || a.y + a.h <= c.y + 0.01 || c.y + c.h <= a.y + 0.01;

describe('the AI card in its slot', () => {
  it('takes its array, memory and link from its spec', () => {
    for (const s of specsOfKind('npu')) {
      assert.exists(s.npu);
      expect(npuInputOf(s.visual)).toStrictEqual({ grid: s.npu.grid, memBytes: s.npu.memBytes, lanes: s.pcieWidth });
    }
  });

  it('puts the die under the lid and the lid on the card, and the card inside what a click hits', () => {
    setLayoutTier(3, 3);
    for (const s of specsOfKind('npu')) {
      const g = npuGeo(s.visual),
        r = { x: 0, y: 0, w: g.w, h: g.h };
      // (the lid is over the main die; the card memory is a chip of its own beside it, with no lid)
      expect(inside(g.core, g.lid), `for ${s.id}`).toBe(true);
      expect(inside(g.lid, r), `for ${s.id}`).toBe(true);
      expect(inside(g.memory, r), `for ${s.id}`).toBe(true);
      expect(inside(g.memory, g.die), `for ${s.id}`).toBe(true);
      expect(inside(g.core, g.die), `for ${s.id}`).toBe(true);
      expect(g.core.w / g.core.h, `for ${s.id}`).toBeGreaterThan(1.1);
      expect(g.core.w / g.core.h, `for ${s.id}`).toBeLessThan(1.5);
      expect(inside(g.lid, r), `for ${s.id}`).toBe(true);
      expect(g.w, `for ${s.id}`).toBe(NPU_LEN[s.visual]);
      expect(g.h, `for ${s.id}`).toBe(NPU_H[s.visual]);
      expect(CARD_LEN[s.visual], `for ${s.id}`).toBe(NPU_LEN[s.visual]);
      for (let slot = 0; slot < 4; slot++) {
        expect(cardRect(slot, s.visual).h, `for ${s.id}`).toBe(NPU_H[s.visual]);
      }
    }
  });

  it('gives every part a distinct slot-keyed id: the cells first, the blocks, the lid last', () => {
    for (const s of specsOfKind('npu')) {
      const K = must(s.npu).grid,
        ids = npuIds(s.visual, 'pcie2');
      expect(new Set(ids).size, `for ${s.id}`).toBe(ids.length);
      expect(ids.every((i) => i.startsWith('pcie2.'))).toBe(true);
      expect(ids.slice(0, K * K).every((i) => /^pcie2\.mac\d+x\d+$/u.test(i))).toBe(true);
      expect(ids).toStrictEqual(
        expect.arrayContaining([
          'pcie2.mac0x0',
          `pcie2.mac${K - 1}x${K - 1}`,
          'pcie2.tile3',
          'pcie2.entry7',
          'pcie2.host',
          'pcie2.ctl',
          'pcie2.desc',
          'pcie2.tiles',
          'pcie2.array',
          'pcie2.post',
          'pcie2.cardmem',
        ]),
      );
      expect(ids.at(-1)).toBe('pcie2.lid');
      expect(
        npuParts(npuGeo(s.visual))
          .filter((p) => !p.inner)
          .map((p) => p.id),
      ).toStrictEqual(['lid']);
    }
  });

  it('keeps the cells of the array apart and inside the array block, and every part inside the die', () => {
    for (const s of specsOfKind('npu')) {
      const g = npuGeo(s.visual),
        parts = npuParts(g),
        arr = must(parts.find((p) => p.id === 'array'));
      const macs = parts.filter((p) => p.id.startsWith('mac'));
      expect(macs).toHaveLength(g.grid * g.grid);
      for (const p of parts.filter((x) => x.inner)) {
        expect(inside(p.rect, g.die), `${s.id} ${p.id}`).toBe(true);
      }
      for (const m of macs) {
        expect(inside(m.rect, arr.rect), `${s.id} ${m.id}`).toBe(true);
      }
      for (let i = 0; i < macs.length; i++) {
        for (let j = i + 1; j < macs.length; j++) {
          const mac = macs[i];
          assert.exists(mac);
          const mac2 = macs[j];
          assert.exists(mac2);
          expect(apart(mac.rect, mac2.rect), `${must(macs[i]).id} / ${must(macs[j]).id}`).toBe(true);
        }
      }
      // a cell is big enough to hover and to read a number in at the zoom where they show
      for (const m of macs) {
        expect(m.rect.w, `${s.id} ${m.id}`).toBeGreaterThan(24);
      }
    }
  });

  it('keeps the blocks apart, so a hover lands on one part', () => {
    const g = npuGeo('npu-2'),
      rs = g.plan.blocks.map((b) => b.rect);
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const rsItem = rs[i];
        assert.exists(rsItem);
        const rsItem2 = rs[j];
        assert.exists(rsItem2);
        expect(apart(rsItem, rsItem2), `${must(g.plan.blocks[i]).id} / ${must(g.plan.blocks[j]).id}`).toBe(true);
      }
    }
  });
});
