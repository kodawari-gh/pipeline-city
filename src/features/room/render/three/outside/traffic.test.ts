import { describe, expect, it } from 'vitest';
import { GRID, avenueX, streetZ } from './plan';
import { PERIOD, STEP, Traffic, lightAt } from './traffic';

describe('traffic', () => {
  it('never lets the avenue and the street in at once at a crossing', () => {
    for (const [i, j] of [[0, 0], [1, 3], [-2, 7]] as const) for (let t = 0; t < PERIOD * 2; t += 0.25) {
      expect(lightAt(i, j, t, true) === 'stop' || lightAt(i, j, t, false) === 'stop').toBe(true);
    }
  });

  it('starts and ends every route out of the window\'s sight: behind our facade or far off', () => {
    const tr = new Traffic();
    for (const r of tr.routes) for (const s of [0, r.len]) {
      const x = r.x + r.dx * s, z = r.z + r.dz * s;
      expect(z > 30 || Math.hypot(x - GRID.av0, z) > 900).toBe(true);
    }
  });

  it('keeps the cars apart in a lane and out of a crossing while the other road has it', () => {
    const tr = new Traffic(), dt = 0.1;
    // the roadways' meeting square at a crossing, and the crossings near the window
    const box = (i: number, j: number) => ({ x0: avenueX(i) - 11, x1: avenueX(i) + 11, z0: streetZ(j) - 7, z1: streetZ(j) + 7 });
    const near = [-1, 0, 1].flatMap((i) => [0, 1, 2, 3].map((j) => box(i, j)));
    let moved = 0, stopped = 0;
    const bumps: string[] = [], clashes: string[] = [];
    for (let k = 0; k < 1200; k++) {
      tr.step(dt);
      const lanes = tr.routes.map(() => [] as [number, number][]);
      for (const c of tr.cars) {
        lanes[c.route]!.push([c.s, c.s - c.len]);
        if (c.v > 5) moved++;
        if (c.v === 0) stopped++;
      }
      // in a lane, each car's front stays behind the tail of the one ahead
      lanes.forEach((cs, r) => {
        cs.sort((a, b) => b[0] - a[0]);
        for (let q = 1; q < cs.length; q++) if (cs[q]![0] >= cs[q - 1]![1]) bumps.push(`route ${r} at ${tr.t.toFixed(1)}`);
      });
      if (k % 5) continue;
      const counts = near.map(() => [0, 0]);
      for (const c of tr.cars) {
        const p = tr.pose(c), n = near.findIndex((b) => p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1);
        if (n >= 0) counts[n]![tr.routes[c.route]!.dz !== 0 ? 0 : 1]!++;
      }
      counts.forEach(([av, st], n) => { if (av && st) clashes.push(`${JSON.stringify(near[n])} at ${tr.t.toFixed(1)}`); });
    }
    expect(bumps.slice(0, 3)).toEqual([]);
    expect(clashes.slice(0, 3)).toEqual([]);
    // the traffic flows and queues
    expect(moved).toBeGreaterThan(stopped);
    expect(stopped).toBeGreaterThan(0);
  }, 30000);

  it('steps each lane on its own beat: a short tick steps only some of them', () => {
    const tr = new Traffic(), lanes = tr.lanes.length;
    for (let k = 0; k < 20; k++) {
      const was = tr.lanes.map((l) => l.map((c) => c.was).join());
      tr.step(0.1);
      const stepped = tr.lanes.filter((l, ri) => l.map((c) => c.was).join() !== was[ri]).length;
      expect(stepped).toBeGreaterThan(0);
      expect(stepped).toBeLessThan(lanes / 2);
    }
  });

  it('draws a car by the clock alone: at any frame rate it is at the same place', () => {
    // (6.05 s on, off every lane's beat: on a beat, a car out past its route's end may come in again at the start a step early)
    const a = new Traffic(), b = new Traffic(), c = new Traffic();
    for (const tr of [a, b, c]) tr.step(0.05);
    for (let k = 0; k < 60; k++) a.step(0.1);
    for (let k = 0; k < 15; k++) b.step(0.4);
    for (let k = 0; k < 6; k++) c.step(STEP * 2);
    expect(a.t).toBeCloseTo(b.t, 9);
    const at = (tr: Traffic) => tr.cars.map((car) => tr.pose(car));
    const pa = at(a), pb = at(b), pc = at(c);
    let worst = 0;
    pa.forEach((p, i) => { worst = Math.max(worst, Math.hypot(p.x - pb[i]!.x, p.z - pb[i]!.z), Math.hypot(p.x - pc[i]!.x, p.z - pc[i]!.z)); });
    expect(worst).toBeLessThan(1e-6);
  });

  it('moves a drawn car smoothly between draws: never back, never a jump (but where it comes in again, out of sight)', () => {
    const tr = new Traffic(), fronts = (): number[] => tr.cars.map((c) => tr.front(c, tr.phase(c.route)));
    let last = fronts(), back = 0, most = 0, again = 0;
    for (let k = 0; k < 600; k++) {
      const dt = [1 / 30, 0.1, 0.2][k % 3]!;
      tr.step(dt);
      const now = fronts();
      now.forEach((f, i) => {
        const d = f - last[i]!;
        // (out past the route's end, a car comes in again at its start)
        if (d < -tr.routes[tr.cars[i]!.route]!.len / 2) { again++; return; }
        back = Math.min(back, d);
        most = Math.max(most, d / dt);
      });
      last = now;
    }
    expect(back).toBeGreaterThan(-1e-9);
    // (no faster than the fastest car wants to go)
    expect(most).toBeLessThan(13 * 1.15 + 0.5);
    expect(again).toBeGreaterThan(0);
  }, 30000);
});
