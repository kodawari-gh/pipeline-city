import { describe, expect, it } from 'vitest';
import { specsOfKind } from '../../sim/board/specs';
import { gpuFanCount, gpuIds, gpuParts, gpuPlan, GPU_H, GPU_LEN, moveRect } from './gpulayout';
import type { Rect } from './layout';

const inside = (r: Rect, o: Rect): boolean => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('GPU floorplan', () => {
  it('has one plan per GPU spec, with its lanes and banks and one more fan per tier', () => {
    const specs = specsOfKind('gpu');
    expect(specs.length).toBeGreaterThanOrEqual(3);
    for (const s of specs) {
      const p = gpuPlan(s.visual);
      expect(p.lanes, s.id).toBe(s.gpu!.lanes);
      expect(p.banks, s.id).toBe(s.gpu!.banks);
      expect(p.laneCells, s.id).toHaveLength(s.gpu!.lanes);
      expect(p.maskBits, s.id).toHaveLength(s.gpu!.lanes);
      expect(p.bankBars, s.id).toHaveLength(s.gpu!.banks);
      expect(p.fans, s.id).toHaveLength(gpuFanCount(s.visual));
      expect(GPU_LEN[s.visual], s.id).toBeGreaterThan(0);
      expect(GPU_H[s.visual], s.id).toBeGreaterThan(0);
    }
    expect([1, 2, 3].map((t) => gpuPlan(`gpu-${t}`).fans.length)).toEqual([1, 2, 3]);
  });

  it('keeps every part inside the card, the internals inside the shroud, and the fans along the top edge', () => {
    for (const s of specsOfKind('gpu')) {
      const p = gpuPlan(s.visual), card: Rect = { x: 0, y: 0, w: p.w, h: p.h };
      expect(inside(p.shroud, card), s.id).toBe(true);
      for (const part of gpuParts(p)) {
        const room = part.id.startsWith('fan') ? { x: card.x, y: card.y - 20, w: card.w, h: card.h + 20 } : part.id === 'link' ? card : p.shroud;
        expect(inside(part.rect, room), `${s.id} ${part.id}`).toBe(true);
      }
      for (const f of p.fans) {
        expect(f.cy - f.r).toBeLessThan(20); // on the top edge
        expect(f.cy + f.r).toBeLessThan(p.body.y); // above the body
        expect(f.r).toBeGreaterThan(30);
      }
    }
  });

  it('lays lane cells, banks, registers and the mask out without overlap', () => {
    for (const s of specsOfKind('gpu')) {
      const p = gpuPlan(s.visual);
      for (const [i, a] of p.laneCells.entries()) {
        for (const b of p.laneCells.slice(i + 1)) expect(overlap(a, b), `${s.id} lanes`).toBe(false);
      }
      const blocks: [string, Rect][] = [['pc', p.pc], ['lanes', p.lanesBlock], ['mask', p.mask], ['regs', p.regs], ['maskstack', p.maskStack], ['mem', p.mem], ...p.bankBars.map((b, k): [string, Rect] => [`bank${k}`, b])];
      for (const [i, [na, a]] of blocks.entries()) {
        for (const [nb, b] of blocks.slice(i + 1)) expect(overlap(a, b), `${s.id} ${na}/${nb}`).toBe(false);
      }
      expect(p.regRows).toHaveLength(8);
      expect(p.maskSlots).toHaveLength(8);
      for (const r of p.regRows) expect(inside(r, p.regs), s.id).toBe(true);
    }
  });

  it('gives every part a distinct id, slot-keyed, and the lanes and banks come before the shroud under them', () => {
    const ids = gpuIds('gpu-3', 'pcie2');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('pcie2.lane31');
    expect(ids).toContain('pcie2.bank3');
    expect(ids).toContain('pcie2.fan2');
    expect(ids.every((i) => i.startsWith('pcie2.'))).toBe(true);
    expect(ids.indexOf('pcie2.lane0')).toBeLessThan(ids.indexOf('pcie2.fins'));
    expect(gpuParts(gpuPlan('gpu-1')).filter((x) => !x.inner).map((x) => x.id)).toEqual(['fan0']);
  });

  it('moves a rectangle to board space', () => {
    expect(moveRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 10, y: 20 })).toEqual({ x: 11, y: 22, w: 3, h: 4 });
  });
});
