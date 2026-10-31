import { describe, expect, it } from 'vitest';
import type { PlanInput } from '../core/cpuplan';
import { cpuPlan } from '../core/cpuplans';
import { cellRects, isTall, laneLines, LANE_GAP, offsetPts } from './dieart';

// The geometry the die art shares with the live view (docs/DIE.md): cell rectangles and trace bundles.

const INPUTS: PlanInput[] = [
  { arch: 'unpipelined', cacheLines: 8 },
  { arch: 'inorder', forwarding: true, cacheLines: 16, icacheLines: 8, l2Lines: 32 },
  { arch: 'inorder2', forwarding: true, cacheLines: 16 },
  { arch: 'ooo', width: 4, robSize: 32, schedSize: 16, fetchQueue: 8, cacheLines: 64, ways: 4, icacheLines: 32, l2Lines: 128 },
];

describe('cellRects', () => {
  it('a block has exactly its grid\'s cells (or none when too small to show them), all inside the block and apart', () => {
    for (const i of INPUTS) {
      for (const b of cpuPlan(i).blocks) {
        const cs = cellRects(b);
        if (!b.grid) { expect(cs, b.id).toEqual([]); continue; }
        if (cs.length === 0) continue;
        expect(cs.length, b.id).toBe(b.grid.count);
        for (const c of cs) {
          expect(c.x, b.id).toBeGreaterThanOrEqual(b.rect.x);
          expect(c.y, b.id).toBeGreaterThanOrEqual(b.rect.y);
          expect(c.x + c.w, b.id).toBeLessThanOrEqual(b.rect.x + b.rect.w + 0.01);
          expect(c.y + c.h, b.id).toBeLessThanOrEqual(b.rect.y + b.rect.h + 0.01);
        }
        // a row of cells is a row: same y, increasing x
        const first = cs.slice(0, b.grid.cols);
        for (const c of first) expect(c.y).toBeCloseTo(first[0]!.y, 6);
      }
    }
  });

  it('the cells of the structures the live view fills are all shown (reorder buffer, scheduler, fetch queue)', () => {
    const p = cpuPlan({ arch: 'ooo', width: 2, robSize: 8, schedSize: 6, fetchQueue: 4, cacheLines: 16 });
    for (const [id, n] of [['rob', 8], ['sched', 6], ['fq', 4]] as const) {
      expect(cellRects(p.blocks.find((b) => b.id === id)!), id).toHaveLength(n);
    }
  });

  it('a tall, narrow block keeps its name in a left strip, so the cells do not sit under it', () => {
    const fq = cpuPlan({ arch: 'ooo', width: 2, robSize: 8, schedSize: 6, fetchQueue: 4, cacheLines: 16 }).blocks.find((b) => b.id === 'fq')!;
    expect(isTall(fq)).toBe(true);
    expect(cellRects(fq)[0]!.x).toBeGreaterThanOrEqual(fq.rect.x + 22);
  });
});

describe('trace bundles', () => {
  it('a bundle of n lanes has n lines, spaced LANE_GAP apart, that never cross the centre line\'s ends', () => {
    for (const i of INPUTS) {
      for (const l of cpuPlan(i).links) {
        const lines = laneLines(l);
        expect(lines, l.id).toHaveLength(l.lanes);
        for (const line of lines) expect(line, l.id).toHaveLength(l.pts.length);
      }
    }
  });

  it('offsetting a straight line moves it sideways by exactly the offset', () => {
    const line = offsetPts([[0, 0], [100, 0]], LANE_GAP);
    expect(line[0]![1]).toBeCloseTo(LANE_GAP * (line[0]![1] > 0 ? 1 : -1), 6);
    expect(line[1]![1]).toBeCloseTo(line[0]![1], 6);
    expect(line[0]![0]).toBe(0);
    expect(line[1]![0]).toBe(100);
  });

  it('a corner keeps both legs parallel to the centre line (a miter)', () => {
    const line = offsetPts([[0, 0], [100, 0], [100, 80]], 4);
    expect(line[0]![1]).toBeCloseTo(line[1]![1], 6);
    expect(line[1]![0]).toBeCloseTo(line[2]![0], 6);
  });
});
