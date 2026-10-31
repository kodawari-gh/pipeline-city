import { describe, expect, it } from 'vitest';
import { SLAT_W, daylight, slatRuns, wallAround } from './roomplan';

const HOLE = { x: 1000, y: 200, w: 1000, h: 400 };

describe('3D room plan', () => {
  it('cuts the slats round the window', () => {
    const runs = slatRuns(0, 4000, 0, 1000, HOLE);
    for (const r of runs) {
      const overlapsX = r.x < HOLE.x + HOLE.w && r.x + SLAT_W > HOLE.x, overlapsY = r.y0 < HOLE.y + HOLE.h && r.y1 > HOLE.y;
      expect(overlapsX && overlapsY).toBe(false);
    }
    expect(runs.some((r) => r.y1 === HOLE.y)).toBe(true);
    expect(runs.some((r) => r.y0 === HOLE.y + HOLE.h)).toBe(true);
  });

  it('builds a wall that covers everything but the hole', () => {
    const area = wallAround(0, 4000, 0, 1000, HOLE).reduce((a, r) => a + r.w * r.h, 0);
    expect(area).toBe(4000 * 1000 - HOLE.w * HOLE.h);
  });

  it('has sun by day and none at night', () => {
    expect(daylight(12)).toBe(1);
    expect(daylight(2)).toBe(0);
    expect(daylight(23)).toBe(0);
    expect(daylight(7)).toBeGreaterThan(0);
    expect(daylight(7)).toBeLessThan(1);
  });
});
