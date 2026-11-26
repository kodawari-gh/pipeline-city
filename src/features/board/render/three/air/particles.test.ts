import { describe, expect, it } from 'vitest';
import { AirSim } from './build';
import type { AirBox, V3 } from './grid';
import * as particles from './particles';
import type { AirPart, AirPlan, PlanFan, PlanVent } from './plan';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const MIN: V3 = [0, 0, 0],
  MAX: V3 = [8000, 6000, 4000];
const intake: PlanFan = {
  id: 'f0',
  bank: 'case:front0',
  kind: 'wall',
  wall: 1,
  centre: [0, 3000, 2000],
  r: 1200,
  into: true,
  q: 1e11,
};
const rear: PlanVent = { id: 'rear', wall: 0, centre: [0, 3000, 2000], shape: { r: 1500 }, open: 1 };
/** A block in the middle of the case, in the way of the stream. */
const block: AirBox = { id: 'blk', min: [3000, 2000, 1000], max: [4500, 4000, 3000], k: [0, 0, 0] };
const plan = (boxes: AirBox[] = [block]): AirPlan => ({
  key: 'k',
  min: MIN,
  max: MAX,
  boxes,
  vents: [rear],
  fans: [intake],
  bodies: [],
});
const AMBIENT = 25;
const env = (o: Partial<particles.AirEnv> = {}): particles.AirEnv => ({
  dt: 1 / 30,
  ambientC: AMBIENT,
  mixC: AMBIENT,
  ...o,
});
const isHalo = (k: number): boolean => k === particles.EXHAUST || k === particles.INTAKE;
const insideCase = (x: number, y: number, z: number): boolean =>
  x > MIN[0] && x < MAX[0] && y > MIN[1] && y < MAX[1] && z > MIN[2] && z < MAX[2];

function world(boxes?: AirBox[], target = 400): { sim: AirSim; p: particles.AirParticles } {
  const sim = new AirSim(plan(boxes), 3000);
  for (let i = 0; i < 400 && !sim.run(50); i++) {
    /* settle */
  }
  sim.levels(() => 1);
  return { sim, p: new particles.AirParticles(sim, target, 5) };
}
const run = (p: particles.AirParticles, steps: number, e: particles.AirEnv = env()): void => {
  for (let i = 0; i < steps; i++) {
    p.step(e);
  }
};
const head = (p: particles.AirParticles, i: number): V3 => [
  must(p.P[i * particles.TRAIL * 3]),
  must(p.P[i * particles.TRAIL * 3 + 1]),
  must(p.P[i * particles.TRAIL * 3 + 2]),
];

describe("the air's particles", () => {
  it('fill the case with air that flows, and stay in it and out of the solid parts', () => {
    const { p } = world();
    p.fill(AMBIENT);
    expect(p.count).toBeGreaterThan(300);
    run(p, 400);
    for (let i = 0; i < p.count; i++) {
      const [x, y, z] = head(p, i);
      // (the halo is outside the case: it is the air that left it, and the room's air coming in)
      if (isHalo(must(p.K[i]))) {
        expect(insideCase(x, y, z)).toBe(false);
        continue;
      }
      expect(x).toBeGreaterThanOrEqual(MIN[0]);
      expect(x).toBeLessThanOrEqual(MAX[0]);
      expect(y).toBeGreaterThanOrEqual(MIN[1]);
      expect(y).toBeLessThanOrEqual(MAX[1]);
      expect(z).toBeGreaterThanOrEqual(MIN[2]);
      expect(z).toBeLessThanOrEqual(MAX[2]);
      if (p.K[i] === particles.AIR) {
        expect(
          x > block.min[0] &&
            x < block.max[0] &&
            y > block.min[1] &&
            y < block.max[1] &&
            z > block.min[2] &&
            z < block.max[2],
        ).toBe(false);
      }
    }
  });

  it('are born at the intake and renewed as they leave: the count holds near what was asked', () => {
    const { p } = world(undefined, 400);
    p.fill(AMBIENT);
    run(p, 900);
    expect(p.count).toBeGreaterThan(250);
    expect(p.count).toBeLessThanOrEqual(p.cap);
  });

  it('ride the flow: on the whole they go from the east wall to the west, where the air leaves', () => {
    const { p } = world([], 300);
    p.fill(AMBIENT);
    run(p, 20);
    const x0: number[] = [];
    for (let i = 0; i < p.count; i++) {
      x0.push(head(p, i)[0]);
    }
    const n = p.count;
    run(p, 20);
    // (the same particles: births put new ones at the end and deaths swap from it, so the first ones are still those that stayed)
    let dx = 0,
      k = 0;
    for (let i = 0; i < Math.min(n, p.count, 100); i++) {
      if (Math.abs(head(p, i)[0] - must(x0[i])) < 4000) {
        dx += head(p, i)[0] - must(x0[i]);
        k++;
      }
    }
    expect(k).toBeGreaterThan(20);
    expect(dx / k).toBeLessThan(0);
  });

  it('a fan that stops lets the air age out: no new air, and the case empties', () => {
    const { sim, p } = world();
    p.fill(AMBIENT);
    sim.levels(() => 0);
    run(p, 800, env({ dt: 0.1 }));
    let air = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.K[i] === particles.AIR) {
        air++;
      }
    }
    expect(air).toBe(0);
  });

  it('are held by a paused game: with no time nothing moves', () => {
    const { p } = world();
    p.fill(AMBIENT);
    run(p, 10);
    const before = Array.from(p.P.slice(0, p.count * particles.TRAIL * 3));
    p.step(env({ dt: 0 }));
    expect(Array.from(p.P.slice(0, p.count * particles.TRAIL * 3))).toStrictEqual(before);
  });

  it('take heat from a hot part in their way, never more than the part has, and carry it on', () => {
    const { p } = world([]);
    const hot: AirPart = {
      id: 'cpu',
      kind: 'cooler',
      min: [5500, 2000, 1000],
      max: [6500, 4000, 3000],
      porous: true,
      reach: 0,
      tempC: 80,
      powerW: 70,
      ua: 4,
      label: 'CPU',
    };
    p.setParts([hot]);
    p.fill(AMBIENT);
    run(p, 500);
    let warm = 0,
      max = -Infinity;
    for (let i = 0; i < p.count; i++) {
      if (p.K[i] === particles.AIR) {
        if (must(p.T[i]) > AMBIENT + 2) {
          warm++;
        }
        max = Math.max(max, must(p.T[i]));
      }
    }
    expect(warm).toBeGreaterThan(5);
    expect(max).toBeLessThanOrEqual(80 + 1e-3);
    // (a cold part gives nothing)
    const { p: q } = world([]);
    q.setParts([{ ...hot, tempC: AMBIENT, ua: 0 }]);
    q.fill(AMBIENT);
    run(q, 300);
    for (let i = 0; i < q.count; i++) {
      expect(q.T[i]).toBeLessThanOrEqual(AMBIENT + 1e-3);
    }
  });

  it('a part with a higher coefficient heats the air more', () => {
    const heat = (ua: number): number => {
      const { p } = world([]);
      p.setParts([
        {
          id: 'cpu',
          kind: 'cooler',
          min: [5500, 2000, 1000],
          max: [6500, 4000, 3000],
          porous: true,
          reach: 0,
          tempC: 80,
          powerW: 70,
          ua,
          label: 'CPU',
        },
      ]);
      p.fill(AMBIENT);
      run(p, 400);
      let s = 0;
      for (let i = 0; i < p.count; i++) {
        s += must(p.T[i]) - AMBIENT;
      }
      return s / p.count;
    };
    expect(heat(6)).toBeGreaterThan(heat(0.5));
  });

  it('a part warmer than the room sheds warm air in its own place, as much as the heat it gives; a cold part, or one with no coefficient, sheds none', () => {
    const warmAir = (tempC: number, ua: number): { warm: number; count: number; cap: number } => {
      const { p } = world([]);
      p.setParts([
        {
          id: 'cpu',
          kind: 'cooler',
          min: [3000, 2000, 1000],
          max: [4000, 4000, 3000],
          porous: true,
          reach: 0,
          tempC,
          powerW: 70,
          ua,
          label: 'CPU',
        },
      ]);
      p.fill(AMBIENT);
      run(p, 100);
      let warm = 0;
      for (let i = 0; i < p.count; i++) {
        if (p.K[i] === particles.AIR && must(p.T[i]) > AMBIENT + 8) {
          warm++;
        }
      }
      return { warm, count: p.count, cap: p.cap };
    };
    const hot = warmAir(85, 4);
    expect(hot.warm).toBeGreaterThan(8);
    expect(hot.count).toBeLessThanOrEqual(hot.cap);
    expect(warmAir(AMBIENT, 4).warm).toBe(0);
    expect(warmAir(85, 0).warm).toBe(0);
    // (a part that gives little heat sheds fewer)
    expect(warmAir(85, 0.3).warm).toBeLessThan(hot.warm);
  });

  it('keep no heat particles: a hot part in still air makes no air of its own', () => {
    const { sim, p } = world([]);
    sim.levels(() => 0);
    p.setParts([
      {
        id: 'cpu',
        kind: 'cooler',
        min: [3000, 2000, 1000],
        max: [4000, 4000, 3000],
        porous: true,
        reach: 0,
        tempC: 90,
        powerW: 120,
        ua: 4,
        label: 'CPU',
      },
    ]);
    run(p, 300, env());
    expect(p.count).toBe(0);
  });

  it('keep a short trail behind the head, that follows the path it took', () => {
    const { p } = world([]);
    p.fill(AMBIENT);
    run(p, 200);
    let trailed = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.K[i] !== particles.AIR) {
        continue;
      }
      const h = i * particles.TRAIL * 3,
        d = Math.hypot(
          must(p.P[h]) - must(p.P[h + 3 * (particles.TRAIL - 1)]),
          must(p.P[h + 1]) - must(p.P[h + 3 * (particles.TRAIL - 1) + 1]),
          must(p.P[h + 2]) - must(p.P[h + 3 * (particles.TRAIL - 1) + 2]),
        );
      if (d > 100) {
        trailed++;
      }
      expect(d).toBeLessThan(6000);
    }
    expect(trailed).toBeGreaterThan(50);
  });
});

describe('the halo: the air outside the case', () => {
  it('air that leaves by the rear grille goes on outside as a jet that fades out with the distance from the case', () => {
    const { p } = world([], 400);
    p.fill(AMBIENT);
    let seen = 0,
      far = 0;
    for (let s = 0; s < 500; s++) {
      p.step(env());
      for (let i = 0; i < p.count; i++) {
        if (p.K[i] !== particles.EXHAUST) {
          continue;
        }
        seen++;
        const [x, y, z] = head(p, i);
        expect(insideCase(x, y, z)).toBe(false);
        // (it left by the west wall and stays on that side)
        expect(x).toBeLessThan(MIN[0] + 60);
        far = Math.max(far, MIN[0] - x);
        expect(p.A[i]).toBeLessThanOrEqual(1);
        // whole at the wall, none at the edge of the halo
        if (MIN[0] - x > p.halo * 0.9) {
          expect(p.A[i]).toBeLessThan(0.1);
        }
      }
    }
    expect(seen).toBeGreaterThan(50);
    expect(far).toBeGreaterThan(500);
    expect(far).toBeLessThanOrEqual(p.halo * 1.05);
  });

  it('a jet keeps the warmth the air had, and mixes into the room as it slows', () => {
    const { p } = world([]);
    p.setParts([
      {
        id: 'cpu',
        kind: 'cooler',
        min: [300, 2000, 1000],
        max: [1800, 4000, 3000],
        porous: true,
        reach: 0,
        tempC: 85,
        powerW: 90,
        ua: 12,
        label: 'CPU',
      },
    ]);
    p.fill(AMBIENT);
    const sum = [0, 0],
      n = [0, 0];
    for (let s = 0; s < 700; s++) {
      p.step(env());
      for (let i = 0; i < p.count; i++) {
        if (p.K[i] !== particles.EXHAUST) {
          continue;
        }
        const young = must(p['age'][i]) < 0.3 ? 0 : must(p['age'][i]) > 1.1 ? 1 : -1;
        if (young >= 0) {
          sum[young] = must(sum[young]) + must(p.T[i]);
          n[young] = must(n[young]) + 1;
        }
      }
    }
    expect(n[0]).toBeGreaterThan(20);
    expect(n[1]).toBeGreaterThan(5);
    const fresh = must(sum[0]) / must(n[0]),
      old = must(sum[1]) / must(n[1]);
    expect(fresh).toBeGreaterThan(AMBIENT + 0.8);
    expect(old).toBeLessThan(fresh);
    expect(old).toBeGreaterThanOrEqual(AMBIENT - 1e-3);
  });

  it('room air is drawn in toward an intake from outside the case, ever nearer, and is gone where it arrives', () => {
    const { sim, p } = world([], 300);
    expect(p['spawnIntake'](AMBIENT)).toBe(true);
    sim.levels(() => 0);
    const tgt: V3 = [must(p['aux'][0]), must(p['aux'][1]), must(p['aux'][2])],
      gap = (): number => {
        const [x, y, z] = head(p, 0);
        return Math.hypot(x - tgt[0], y - tgt[1], z - tgt[2]);
      };
    // (the point it is drawn to is on the intake's wall)
    expect(tgt[0]).toBeCloseTo(MAX[0], 3);
    const d0 = gap();
    expect(d0).toBeGreaterThan(p.halo * 0.1);
    expect(insideCase(...head(p, 0))).toBe(false);
    run(p, 6);
    expect(p.count).toBe(1);
    expect(gap()).toBeLessThan(d0);
    for (let s = 0; s < 400 && p.count; s++) {
      p.step(env());
      if (p.count) {
        expect(insideCase(...head(p, 0))).toBe(false);
      }
    }
    expect(p.count).toBe(0);
  });

  it("room air is born on the intake's side of the case and comes close to the opening", () => {
    const { p } = world([], 400);
    p.fill(AMBIENT);
    let seen = 0,
      nearest = Infinity;
    for (let s = 0; s < 400; s++) {
      p.step(env());
      for (let i = 0; i < p.count; i++) {
        if (p.K[i] !== particles.INTAKE) {
          continue;
        }
        seen++;
        const [x] = head(p, i);
        expect(x).toBeGreaterThan(MAX[0] - 60);
        nearest = Math.min(nearest, x - MAX[0]);
      }
    }
    expect(seen).toBeGreaterThan(50);
    expect(nearest).toBeLessThan(900);
  });

  it("the halo keeps to its own pool: it never takes the case's room, and it ages out when the fans stop", () => {
    const { sim, p } = world([], 300);
    p.fill(AMBIENT);
    for (let s = 0; s < 600; s++) {
      p.step(env());
      let halo = 0;
      for (let i = 0; i < p.count; i++) {
        if (isHalo(must(p.K[i]))) {
          halo++;
        }
      }
      expect(halo).toBeLessThanOrEqual(p.haloMax);
      expect(p.count).toBeLessThanOrEqual(p.cap);
    }
    let halo = 0;
    for (let i = 0; i < p.count; i++) {
      if (isHalo(must(p.K[i]))) {
        halo++;
      }
    }
    expect(halo).toBeGreaterThan(20);
    sim.levels(() => 0);
    run(p, 400, env({ dt: 0.1 }));
    expect(p.count).toBe(0);
  });
});
