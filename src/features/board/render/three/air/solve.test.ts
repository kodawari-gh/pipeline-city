import { describe, expect, it } from 'vitest';
import { AirGrid, type AirBox, type V3 } from './grid';
import { AirField, V_MAX, innerFan, wallFan, type AirFanDef } from './solve';

const MIN: V3 = [0, 0, 0], MAX: V3 = [8000, 5000, 4000], Q = 2.1e11, R = 1400, KF = (2 * Math.PI * R) / 3;

const intake = (g: AirGrid, at: V3 = [8000, 2500, 2000]): AirFanDef => wallFan(g, 'in', 1, at, { r: R }, true, Q, KF);
const exhaust = (g: AirGrid, at: V3 = [0, 2500, 2000]): AirFanDef => wallFan(g, 'out', 0, at, { r: R }, false, Q, KF);

/** Total flux of the mixed field through the plane of cells at x index `i`, units cubed per second (positive toward +x). */
function fluxAcrossX(f: AirField, i: number): number {
  const g = f.grid;
  let s = 0;
  for (let k = 0; k < g.n[2]; k++) for (let j = 0; j < g.n[1]; j++) {
    const c = g.index(i, j, k);
    s += f.u[3 * c]! * g.open[0][c]! * g.h[1] * g.h[2];
  }
  return s;
}

function solved(boxes: AirBox[], mk: (g: AirGrid) => AirFanDef[], levels?: number[]): AirField {
  const g = new AirGrid(MIN, MAX, boxes, 6000), fans = mk(g), f = new AirField(g, fans);
  expect(f.run(20000)).toBe(true);
  fans.forEach((_, i) => f.setLevel(i, levels?.[i] ?? 1));
  f.mix();
  return f;
}

describe('AirField', () => {
  it('carries the flow of an intake fan on one wall to an exhaust fan on the other', () => {
    const f = solved([], (g) => [intake(g), exhaust(g)]);
    const g = f.grid, mid = Math.floor(g.n[0] / 2), flux = fluxAcrossX(f, mid);
    // (it flows west: toward -x)
    expect(flux).toBeLessThan(0);
    // the intake's flow is its full flow less what the pressure took off (the stiffness): a fair share of it crosses the middle
    expect(Math.abs(flux)).toBeGreaterThan(0.5 * Q);
    expect(Math.abs(flux)).toBeLessThan(1.05 * Q);
    // the same flux crosses every plane between the fans: the air is conserved
    for (const i of [2, mid, g.n[0] - 3]) expect(Math.abs(fluxAcrossX(f, i) - flux) / Math.abs(flux)).toBeLessThan(0.08);
  });

  it('is linear in the fans: half the speed, half the air', () => {
    const mk = (g: AirGrid): AirFanDef[] => [intake(g), exhaust(g)];
    const full = solved([], mk), half = solved([], mk, [0.5, 0.5]), i = Math.floor(full.grid.n[0] / 2);
    expect(fluxAcrossX(half, i) / fluxAcrossX(full, i)).toBeCloseTo(0.5, 2);
  });

  it('sends the air through the gap of a wall across the case', () => {
    const wall: AirBox = { id: 'wall', min: [3800, 0, 0], max: [4200, 5000, 4000], k: [0, 0, 0] };
    // a gap high on the wall: cut it into two boxes
    const gap = [{ ...wall, id: 'low', max: [4200, 2000, 4000] as V3 }, { ...wall, id: 'high', min: [3800, 3200, 0] as V3 }];
    const f = solved(gap, (g) => [intake(g), exhaust(g)]), g = f.grid;
    const at = (x: number, y: number, z: number): number => f.u[3 * g.cellAt(x, y, z)]!;
    // in the gap the air goes faster toward the west than in the open case away from the wall
    expect(at(4000, 2600, 2000)).toBeLessThan(0);
    expect(Math.abs(at(4000, 2600, 2000))).toBeGreaterThan(Math.abs(at(6500, 2600, 2000)));
    // inside the wall no air moves
    expect(Math.hypot(f.u[3 * g.cellAt(4000, 1000, 2000)]!, f.u[3 * g.cellAt(4000, 1000, 2000) + 1]!)).toBeLessThan(1);
  });

  it('draws the air in through a vent when a fan only blows out, and out when it only blows in', () => {
    const inOnly = solved([], (g) => { g.vent(0, [0, 2500, 2000], { r: 1500 }, 1); return [intake(g)]; });
    const outOnly = solved([], (g) => { g.vent(0, [0, 2500, 2000], { r: 1500 }, 1); return [wallFan(g, 'out', 1, [8000, 2500, 2000], { r: R }, false, Q, KF)]; });
    const i = Math.floor(inOnly.grid.n[0] / 2);
    expect(fluxAcrossX(inOnly, i)).toBeLessThan(0);
    // an exhaust at the east wall draws air in at the west vent: the flow goes east
    expect(fluxAcrossX(outOnly, i)).toBeGreaterThan(0);
  });

  it('runs an inner fan: the air goes through its plane and returns round it', () => {
    const f = solved([], (g) => [innerFan(g, 'cooler', [4000, 2500, 2000], 0, 1, { r: 900 }, Q / 4)]), g = f.grid;
    // on the fan's axis the air goes east, with the fan
    expect(f.u[3 * g.cellAt(4000, 2500, 2000)]!).toBeGreaterThan(0);
    // far from the axis the air comes back west
    expect(f.u[3 * g.cellAt(4000, 4600, 2000)]!).toBeLessThan(0);
  });

  it('runs an inner fan the other way when its direction is reversed', () => {
    const f = solved([], (g) => [innerFan(g, 'cooler', [4000, 2500, 2000], 0, -1, { r: 900 }, Q / 4)]), g = f.grid;
    expect(f.u[3 * g.cellAt(4000, 2500, 2000)]!).toBeLessThan(0);
  });

  it('keeps every speed under the cap', () => {
    const f = solved([{ id: 'plate', min: [3800, 0, 0], max: [4200, 5000, 4000], k: [0.001, 0, 0] }], (g) => [intake(g), exhaust(g)]);
    let top = 0;
    for (let c = 0; c < f.grid.cells; c++) top = Math.max(top, Math.hypot(f.u[3 * c]!, f.u[3 * c + 1]!, f.u[3 * c + 2]!));
    expect(top).toBeLessThanOrEqual(V_MAX * 1.0001);
  });

  it('samples a point between cells and reads still air in a wall', () => {
    const f = solved([{ id: 'wall', min: [3000, 1000, 1000], max: [5000, 4000, 3000], k: [0, 0, 0] }], (g) => [intake(g), exhaust(g)]);
    const out: V3 = [0, 0, 0];
    f.sample(4000, 2500, 2000, out);
    expect(Math.hypot(...out)).toBeLessThan(1);
    f.sample(6500, 2500, 2000, out);
    expect(out[0]).toBeLessThan(0);
  });
});
