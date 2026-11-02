import { describe, expect, it } from 'vitest';
import { EAST_X, FLOOR_Y, FRONT_Z, SLAT_W, WEST_X, WINDOW, daylight, eyeRoom, slatRuns, sunDir, wallAround } from './roomplan';

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

  it('keeps the sun behind the back wall, high at midday and low in the west at dusk', () => {
    for (const h of [6, 9, 12, 14.2, 18, 20.5]) expect(sunDir(h)[2]).toBeLessThan(0);
    expect(sunDir(13)[1]).toBeGreaterThan(0.6);
    expect(sunDir(20.5)[0]).toBeLessThan(0);
    expect(sunDir(20.5)[1]).toBeLessThan(0.05);
  });

  it('holds the eye inside the walls, the window and the floor', () => {
    const r = eyeRoom();
    expect(r.x0).toBeGreaterThan(WEST_X);
    expect(r.x1).toBeLessThan(EAST_X);
    expect(r.y0).toBeGreaterThan(-FLOOR_Y);
    expect(r.z0).toBeGreaterThan(0);
    expect(r.z1).toBeLessThan(FRONT_Z);
    expect(WINDOW.x).toBeGreaterThan(WEST_X);
  });
});
