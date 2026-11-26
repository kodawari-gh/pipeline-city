import { describe, expect, it } from 'vitest';
import * as grid from './grid';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const MIN: grid.V3 = [0, 0, 0],
  MAX: grid.V3 = [6000, 4000, 3000];
const box = (id: string, min: grid.V3, max: grid.V3, k: grid.V3 = [0, 0, 0]): grid.AirBox => ({ id, min, max, k });

describe('AirGrid', () => {
  it('cuts the case into about the asked number of cells and covers it exactly', () => {
    const g = new grid.AirGrid(MIN, MAX, [], 5000);
    expect(g.cells).toBeGreaterThan(3500);
    expect(g.cells).toBeLessThan(7500);
    expect(g.h[0] * g.n[0]).toBeCloseTo(6000, 6);
    expect(g.h[1] * g.n[1]).toBeCloseTo(4000, 6);
    expect(g.h[2] * g.n[2]).toBeCloseTo(3000, 6);
  });

  it('finds the cell of a point, and none outside', () => {
    const g = new grid.AirGrid(MIN, MAX, [], 1000);
    const c = g.cellAt(3000, 2000, 1500),
      mid = g.centre(c);
    expect(Math.abs(mid[0] - 3000)).toBeLessThanOrEqual(g.h[0]);
    expect(g.cellAt(-1, 10, 10)).toBe(-1);
    expect(g.cellAt(10, 10, 3001)).toBe(-1);
  });

  it('makes a cell inside a wall box solid and blocks the faces into it', () => {
    const g = new grid.AirGrid(MIN, MAX, [box('wall', [2000, 1000, 500], [4000, 3000, 2500])], 5000);
    const c = g.cellAt(3000, 2000, 1500);
    expect(g.solid(c)).toBe(true);
    expect(g.face[0][c]).toBe(0);
    // a cell in the open keeps its faces
    const o = g.cellAt(500, 500, 500);
    expect(g.solid(o)).toBe(false);
    expect(g.face[0][o]).toBeGreaterThan(0);
  });

  it('lets air slide along a thin plate and stops it across', () => {
    // a plate across x, one hundredth of the case thick, filling a whole cell column in y and z
    const g = new grid.AirGrid(MIN, MAX, [box('plate', [2990, 0, 0], [3010, 4000, 3000])], 5000);
    const c = g.cellAt(3000, 2000, 1500);
    expect(must(g.open[0][c])).toBeLessThan(0.01);
    expect(must(g.open[1][c])).toBeGreaterThan(0.9);
    expect(must(g.open[2][c])).toBeGreaterThan(0.9);
  });

  it('lets a porous box pass its share', () => {
    const g = new grid.AirGrid(MIN, MAX, [box('fins', [2000, 1000, 500], [4000, 3000, 2500], [0.5, 0.5, 0.05])], 5000);
    const c = g.cellAt(3000, 2000, 1500);
    expect(must(g.open[0][c])).toBeCloseTo(0.5, 1);
    expect(must(g.open[2][c])).toBeLessThan(0.1);
  });

  it('keeps the box lists: a point inside a box has that box in its cell', () => {
    const g = new grid.AirGrid(
      MIN,
      MAX,
      [box('a', [1000, 1000, 1000], [2000, 2000, 2000]), box('b', [4000, 500, 500], [5000, 1500, 1500])],
      5000,
    );
    const c = g.cellAt(1500, 1500, 1500),
      list = g.boxList.slice(g.boxStart[c], g.boxStart[c + 1]);
    expect(list).toContain(0);
    expect(list).not.toContain(1);
  });

  it('measures a disc footprint by its area', () => {
    const g = new grid.AirGrid(MIN, MAX, [], 5000),
      r = 900,
      f = g.footprint([3000, 2000, 0], 2, { r });
    const sum = f.area.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - Math.PI * r * r) / (Math.PI * r * r)).toBeLessThan(0.06);
  });

  it('gives a vent its conductance by area and distance to the wall', () => {
    const g = new grid.AirGrid(MIN, MAX, [], 5000),
      area = 1200 * 800,
      open = 0.6;
    g.vent(0, [0, 2000, 1500], { hw: 600, hh: 400 }, open);
    let sum = 0;
    for (let c = 0; c < g.cells; c++) {
      sum += must(g.ground[c]);
    }
    expect(Math.abs(sum - (open * area) / (g.h[0] / 2)) / ((open * area) / (g.h[0] / 2))).toBeLessThan(0.08);
    // only the cells at the -x wall have any
    const far = g.cellAt(3000, 2000, 1500);
    expect(g.ground[far]).toBe(0);
  });
});
