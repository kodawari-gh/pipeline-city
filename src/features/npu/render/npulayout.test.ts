import { describe, expect, it } from 'vitest';
import { specsOfKind } from '../../board/sim/specs';
import { cardRect, CARD_LEN } from '@/core/render/accelart';
import { setLayoutTier, type Rect } from '../../board/render/layout/layout';
import { NPU_H, NPU_LEN, npuGeo, npuIds, npuInputOf, npuParts } from './npulayout';

const inside = (r: Rect, o: Rect): boolean => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const apart = (a: Rect, c: Rect): boolean => a.x + a.w <= c.x + 0.01 || c.x + c.w <= a.x + 0.01 || a.y + a.h <= c.y + 0.01 || c.y + c.h <= a.y + 0.01;

describe('the AI card in its slot', () => {
  it('takes its array, memory and link from its spec', () => {
    for (const s of specsOfKind('npu')) expect(npuInputOf(s.visual)).toEqual({ grid: s.npu!.grid, memBytes: s.npu!.memBytes, lanes: s.pcieWidth });
  });

  it('puts the die under the lid and the lid on the card, and the card inside what a click hits', () => {
    setLayoutTier(3, 3);
    for (const s of specsOfKind('npu')) {
      const g = npuGeo(s.visual), r = { x: 0, y: 0, w: g.w, h: g.h };
      expect(inside(g.die, g.lid), s.id).toBe(true);
      expect(inside(g.lid, r), s.id).toBe(true);
      expect(g.w, s.id).toBe(NPU_LEN[s.visual]);
      expect(g.h, s.id).toBe(NPU_H[s.visual]);
      expect(CARD_LEN[s.visual], s.id).toBe(NPU_LEN[s.visual]);
      for (let slot = 0; slot < 4; slot++) expect(cardRect(slot, s.visual).h, s.id).toBe(NPU_H[s.visual]);
    }
  });

  it('gives every part a distinct slot-keyed id: the cells first, the blocks, the lid last', () => {
    for (const s of specsOfKind('npu')) {
      const K = s.npu!.grid, ids = npuIds(s.visual, 'pcie2');
      expect(new Set(ids).size, s.id).toBe(ids.length);
      expect(ids.every((i) => i.startsWith('pcie2.'))).toBe(true);
      expect(ids.slice(0, K * K).every((i) => /^pcie2\.mac\d+x\d+$/.test(i))).toBe(true);
      expect(ids).toEqual(expect.arrayContaining(['pcie2.mac0x0', `pcie2.mac${K - 1}x${K - 1}`, 'pcie2.tile3', 'pcie2.entry7', 'pcie2.host', 'pcie2.ctl', 'pcie2.desc', 'pcie2.tiles', 'pcie2.array', 'pcie2.post', 'pcie2.cardmem']));
      expect(ids[ids.length - 1]).toBe('pcie2.lid');
      expect(npuParts(npuGeo(s.visual)).filter((p) => !p.inner).map((p) => p.id)).toEqual(['lid']);
    }
  });

  it('keeps the cells of the array apart and inside the array block, and every part inside the die', () => {
    for (const s of specsOfKind('npu')) {
      const g = npuGeo(s.visual), parts = npuParts(g), arr = parts.find((p) => p.id === 'array')!;
      const macs = parts.filter((p) => p.id.startsWith('mac'));
      expect(macs).toHaveLength(g.grid * g.grid);
      for (const p of parts.filter((x) => x.inner)) expect(inside(p.rect, g.die), `${s.id} ${p.id}`).toBe(true);
      for (const m of macs) expect(inside(m.rect, arr.rect), `${s.id} ${m.id}`).toBe(true);
      for (let i = 0; i < macs.length; i++) for (let j = i + 1; j < macs.length; j++) expect(apart(macs[i]!.rect, macs[j]!.rect), `${macs[i]!.id} / ${macs[j]!.id}`).toBe(true);
      // a cell is big enough to hover and to read a number in at the zoom where they show
      for (const m of macs) expect(m.rect.w, `${s.id} ${m.id}`).toBeGreaterThan(24);
    }
  });

  it('keeps the blocks apart, so a hover lands on one part', () => {
    const g = npuGeo('npu-2'), rs = g.plan.blocks.map((b) => b.rect);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(apart(rs[i]!, rs[j]!), `${g.plan.blocks[i]!.id} / ${g.plan.blocks[j]!.id}`).toBe(true);
  });
});
