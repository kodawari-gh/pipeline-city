import { assert, describe, expect, it } from 'vitest';
import { GRID, avenueX, streetZ } from './plan';
import { PERIOD, STEP, Traffic, lightAt } from './traffic';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** Whether a crossing's light stops the avenue or the street (or both) at `t`. */
const stopsOne = (i: number, j: number, t: number): boolean =>
  lightAt(i, j, t, true) === 'stop' || lightAt(i, j, t, false) === 'stop';

/** Whether a place is out of the window's sight: behind our facade, or far off. */
const outOfSight = (x: number, z: number): boolean => z > 30 || Math.hypot(x - GRID.av0, z) > 900;

interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** The roadways' meeting square at a crossing. */
const box = (i: number, j: number): Box => ({
  x0: avenueX(i) - 11,
  x1: avenueX(i) + 11,
  z0: streetZ(j) - 7,
  z1: streetZ(j) + 7,
});

/** Whether a place is in the box. */
const inBox = (p: { x: number; z: number }, b: Box): boolean =>
  p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1;

/** The cars going faster than 5 m/s, and those standing. */
function speeds(tr: Traffic): { moved: number; stopped: number } {
  let moved = 0,
    stopped = 0;
  for (const c of tr.cars) {
    if (c.v > 5) {
      moved++;
    }
    if (c.v === 0) {
      stopped++;
    }
  }
  return { moved, stopped };
}

/** Where, in a lane, a car's front is not behind the tail of the one ahead. */
function laneBumps(tr: Traffic): string[] {
  const lanes = tr.routes.map((): [number, number][] => []),
    bumps: string[] = [];
  for (const c of tr.cars) {
    must(lanes[c.route]).push([c.s, c.s - c.len]);
  }
  for (const [r, lane] of lanes.entries()) {
    const cs = lane.toSorted((a, b) => b[0] - a[0]);
    for (let q = 1; q < cs.length; q++) {
      if (must(cs[q])[0] >= must(cs[q - 1])[1]) {
        bumps.push(`route ${r} at ${tr.t.toFixed(1)}`);
      }
    }
  }
  return bumps;
}

/** The crossing boxes that hold cars of the avenue and of the street at once. */
function crossingClashes(tr: Traffic, near: Box[]): string[] {
  const counts = near.map((): [number, number] => [0, 0]);
  for (const c of tr.cars) {
    const p = tr.pose(c),
      n = near.findIndex((b) => inBox(p, b));
    if (n !== -1) {
      const count = must(counts[n]);
      count[must(tr.routes[c.route]).dz === 0 ? 1 : 0]++;
    }
  }
  return counts.flatMap(([av, st], n) =>
    av > 0 && st > 0 ? [`${JSON.stringify(near[n])} at ${tr.t.toFixed(1)}`] : [],
  );
}

/** Where every car is drawn. */
const posesOf = (tr: Traffic) => tr.cars.map((car) => tr.pose(car));

/** How far each car's front went since the last draw, and how many came in again at their route's start (out past its end). */
function frontSteps(tr: Traffic, last: number[], now: number[]): { again: number; steps: number[] } {
  let again = 0;
  const steps: number[] = [];
  for (const [i, f] of now.entries()) {
    const d = f - must(last[i]);
    if (d < -must(tr.routes[must(tr.cars[i]).route]).len / 2) {
      again++;
    } else {
      steps.push(d);
    }
  }
  return { again, steps };
}

describe('traffic', () => {
  it('never lets the avenue and the street in at once at a crossing', () => {
    for (const [i, j] of [
      [0, 0],
      [1, 3],
      [-2, 7],
    ] as const) {
      for (let t = 0; t < PERIOD * 2; t += 0.25) {
        expect(stopsOne(i, j, t)).toBe(true);
      }
    }
  });

  it("starts and ends every route out of the window's sight: behind our facade or far off", () => {
    const tr = new Traffic();
    for (const r of tr.routes) {
      for (const s of [0, r.len]) {
        const x = r.x + r.dx * s,
          z = r.z + r.dz * s;
        expect(outOfSight(x, z)).toBe(true);
      }
    }
  });

  it('keeps the cars apart in a lane and out of a crossing while the other road has it', () => {
    const tr = new Traffic(),
      dt = 0.1;
    // the crossings near the window
    const near = [-1, 0, 1].flatMap((i) => [0, 1, 2, 3].map((j) => box(i, j)));
    let moved = 0,
      stopped = 0;
    const bumps: string[] = [],
      clashes: string[] = [];
    // a step: the speeds, and in a lane, each car's front stays behind the tail of the one ahead
    const tick = (): void => {
      tr.step(dt);
      const v = speeds(tr);
      moved += v.moved;
      stopped += v.stopped;
      bumps.push(...laneBumps(tr));
    };
    // every fifth step, from the first: no crossing holds both roads
    for (let k = 0; k < 1200; k += 5) {
      tick();
      clashes.push(...crossingClashes(tr, near));
      for (let m = 1; m < 5; m++) {
        tick();
      }
    }
    expect(bumps.slice(0, 3)).toStrictEqual([]);
    expect(clashes.slice(0, 3)).toStrictEqual([]);
    // the traffic flows and queues
    expect(moved).toBeGreaterThan(stopped);
    expect(stopped).toBeGreaterThan(0);
  }, 30_000);

  it('steps each lane on its own beat: a short tick steps only some of them', () => {
    const tr = new Traffic(),
      lanes = tr.lanes.length;
    for (let k = 0; k < 20; k++) {
      const was = tr.lanes.map((l) => l.map((c) => c.was).join(','));
      tr.step(0.1);
      const stepped = tr.lanes.filter((l, ri) => l.map((c) => c.was).join(',') !== was[ri]).length;
      expect(stepped).toBeGreaterThan(0);
      expect(stepped).toBeLessThan(lanes / 2);
    }
  });

  it('draws a car by the clock alone: at any frame rate it is at the same place', () => {
    // (6.05 s on, off every lane's beat: on a beat, a car out past its route's end may come in again at the start a step early)
    const a = new Traffic(),
      b = new Traffic(),
      c = new Traffic();
    for (const tr of [a, b, c]) {
      tr.step(0.05);
    }
    for (let k = 0; k < 60; k++) {
      a.step(0.1);
    }
    for (let k = 0; k < 15; k++) {
      b.step(0.4);
    }
    for (let k = 0; k < 6; k++) {
      c.step(STEP * 2);
    }
    expect(a.t).toBeCloseTo(b.t, 9);
    const pa = posesOf(a),
      pb = posesOf(b),
      pc = posesOf(c);
    let worst = 0;
    for (const [i, p] of pa.entries()) {
      const q = must(pb[i]),
        r = must(pc[i]);
      worst = Math.max(worst, Math.hypot(p.x - q.x, p.z - q.z), Math.hypot(p.x - r.x, p.z - r.z));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('moves a drawn car smoothly between draws: never back, never a jump (but where it comes in again, out of sight)', () => {
    const tr = new Traffic(),
      fronts = (): number[] => tr.cars.map((c) => tr.front(c, tr.phase(c.route)));
    let last = fronts(),
      back = 0,
      most = 0,
      again = 0;
    for (let k = 0; k < 600; k++) {
      const dt = [1 / 30, 0.1, 0.2][k % 3];
      assert.exists(dt);
      tr.step(dt);
      const now = fronts();
      // (out past the route's end, a car comes in again at its start)
      const run = frontSteps(tr, last, now);
      again += run.again;
      back = Math.min(back, ...run.steps);
      most = Math.max(most, ...run.steps.map((d) => d / dt));
      last = now;
    }
    expect(back).toBeGreaterThan(-1e-9);
    // (no faster than the fastest car wants to go)
    expect(most).toBeLessThan(13 * 1.15 + 0.5);
    expect(again).toBeGreaterThan(0);
  }, 30_000);
});
