import { describe, expect, it } from 'vitest';
import { GRID, avenueX, streetZ } from './plan';
import { PERIOD, Traffic, lightAt } from './traffic';

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
});
