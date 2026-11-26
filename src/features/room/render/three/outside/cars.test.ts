import {
  Color,
  Frustum,
  InstancedMesh,
  Matrix4,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  Sphere,
  Vector3,
} from 'three';
import type * as threeTypes from 'three';
import { assert, describe, expect, it } from 'vitest';
import { FULL_LOW, Fleet, carMaterial, ownAvenue, parkCells, reach, share, within } from './cars';
import type { HazeUniforms } from './haze';
import { LOW_FLEET } from './detail';
import { GRID, buildings, parked, rng } from './plan';
import type * as planTypes from './plan';
import { Traffic } from './traffic';
import type * as trafficTypes from './traffic';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A camera somewhere over the street near the window, turned at random (`r`), and its frustum. */
function eye(r: () => number, fov = 26): { cam: PerspectiveCamera; seen: Frustum } {
  const cam = new PerspectiveCamera(fov, 412 / 915, 0.5, 20_000);
  cam.position.set(GRID.av0 + (r() - 0.5) * 300, 5 + r() * 120, 30 - r() * 300);
  cam.rotation.set(-0.6 + r() * 0.7, r() * Math.PI * 2, 0, 'YXZ');
  cam.updateMatrixWorld();
  return {
    cam,
    seen: new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    ),
  };
}

const ball = ([x, y, z]: [number, number, number], r: number): Sphere => new Sphere(new Vector3(x, y, z), r);
/** The places (x, z) of a mesh's instances. */
const placed = (im: threeTypes.InstancedMesh): string[] => {
  const a = im.instanceMatrix.array,
    out: string[] = [];
  for (let i = 0; i < im.count; i++) {
    const aItem = a[i * 16 + 12];
    assert.exists(aItem);
    out.push(`${aItem.toFixed(2)},${must(a[i * 16 + 14]).toFixed(2)}`);
  }
  return out;
};
const key = (x: number, z: number): string => `${Math.fround(x).toFixed(2)},${Math.fround(z).toFixed(2)}`;

const haze = (): HazeUniforms => ({
  hzCol: { value: new Color() },
  hzSun: { value: new Color() },
  hzDir: { value: new Vector3() },
  hzDensity: { value: 0 },
  hzFall: { value: 0 },
  hzMist: { value: new Color() },
  hzMistD: { value: 0 },
  hzTime: { value: 0 },
});
/** The (x, z) of a mesh's instances, as numbers. */
const spots = (im: threeTypes.InstancedMesh): [number, number][] => {
  const a = im.instanceMatrix.array,
    out: [number, number][] = [];
  for (let i = 0; i < im.count; i++) {
    const aItem2 = a[i * 16 + 12];
    assert.exists(aItem2);
    const aItem3 = a[i * 16 + 14];
    assert.exists(aItem3);
    out.push([aItem2, aItem3]);
  }
  return out;
};
interface Inside {
  moving: threeTypes.InstancedMesh[];
  near: threeTypes.InstancedMesh[];
  far: threeTypes.InstancedMesh;
  pools: threeTypes.InstancedMesh;
  shades: threeTypes.InstancedMesh;
  still: { im: threeTypes.InstancedMesh; cars: planTypes.Car[] }[];
}

/** The value down a path of fields under `o`, each read as it stands (unknown until checked): the fleet keeps these to itself. */
function dig(o: unknown, ...path: string[]): unknown {
  let at = o;
  for (const k of path) {
    assert(typeof at === 'object' && at !== null, `no ${path.join('.')}`);
    const fields = new Map<string, unknown>(Object.entries(at));
    assert(fields.has(k), `no ${path.join('.')}`);
    at = fields.get(k);
  }
  return at;
}

/** Whether a value is an instanced mesh. */
const isInstanced = (o: unknown): o is threeTypes.InstancedMesh => o instanceof InstancedMesh;

/** An instanced mesh read with `dig`, checked. */
function meshAt(x: unknown): threeTypes.InstancedMesh {
  assert(isInstanced(x), 'not an instanced mesh');
  return x;
}

/** A list of instanced meshes read with `dig`, checked. */
function meshList(x: unknown): threeTypes.InstancedMesh[] {
  assert(Array.isArray(x), 'not a list');
  const list: unknown[] = x;
  return list.map((m) => meshAt(m));
}

/** Whether a value read from the fleet is a parked car (its place on the ground). */
const isCar = (c: unknown): c is planTypes.Car =>
  typeof c === 'object' && c !== null && 'x' in c && typeof c.x === 'number' && 'z' in c && typeof c.z === 'number';

/** A fleet's parked sets: each mesh with the cars it may place. */
function stillOf(f: Fleet): Inside['still'] {
  const still = dig(f, 'still');
  assert(Array.isArray(still), 'the fleet has no parked sets');
  const sets: unknown[] = still;
  return sets.map((set) => {
    const cars = dig(set, 'cars');
    assert(Array.isArray(cars), 'a parked set has no cars');
    const list: unknown[] = cars;
    return { im: meshAt(dig(set, 'im')), cars: list.filter((c) => isCar(c)) };
  });
}

/** A fleet's meshes and parked sets as they stand now (read again after each draw). */
function inside(f: Fleet): Inside {
  return {
    moving: meshList(dig(f, 'moving')),
    near: meshList(dig(f, 'near')),
    far: meshAt(dig(f, 'far')),
    pools: meshAt(dig(f, 'pools')),
    shades: meshAt(dig(f, 'shades')),
    still: stillOf(f),
  };
}

/** A fleet's car material. */
function matOf(f: Fleet): threeTypes.MeshPhysicalMaterial {
  const mat = dig(f, 'mat');
  assert.instanceOf(mat, MeshPhysicalMaterial);
  return mat;
}

/** The moving meshes of a fleet. */
const movingOf = (f: Fleet): threeTypes.InstancedMesh[] => inside(f).moving;

/** The spots of every instance of the meshes. */
const spotsOf = (ims: threeTypes.InstancedMesh[]): [number, number][] => ims.flatMap((im) => spots(im));

/** The plane-by-plane cut `within` reported for the ball, and the planes the ball does cross: both empty for a ball out of the frustum. */
function planeCuts(seen: Frustum, b: Sphere, cut: number): { got: boolean[]; want: boolean[] } {
  if (cut < 0) {
    return { got: [], want: [] };
  }
  return {
    got: seen.planes.map((_, i) => (cut & (1 << i)) !== 0),
    want: seen.planes.map((p) => p.distanceToPoint(b.center) < b.radius),
  };
}

/** Along a route, the samples where `reach`'s stretch and the frustum disagree on a ball (`y` up, radius `rad`), and how many it sampled. */
function routeMisses(
  rt: trafficTypes.Route,
  seen: Frustum,
  probe: { y: number; rad: number; eye: number },
): { n: number; miss: string[] } {
  const out = [0, 0],
    miss: string[] = [];
  reach(rt, seen, probe.y, probe.rad, out);
  const lo = must(out[0]),
    hi = must(out[1]);
  let n = 0;
  for (let m = -40; m < rt.len + 40; m += 3.7) {
    if (Math.abs(m - lo) < 1e-6 || Math.abs(m - hi) < 1e-6) {
      continue;
    }
    n++;
    if (
      (m >= lo && m <= hi) !== seen.intersectsSphere(ball([rt.x + rt.dx * m, probe.y, rt.z + rt.dz * m], probe.rad))
    ) {
      miss.push(`eye ${probe.eye} m ${m}`);
    }
  }
  return { n, miss };
}

/** The cars Low keeps: every car of the window's own avenue, and on the other lanes those whose share is under LOW_FLEET. */
function lowKeeps(tr: Traffic): number {
  let keep = 0;
  for (const [ri, lane] of tr.lanes.entries()) {
    keep += ownAvenue(must(tr.routes[ri])) ? lane.length : lane.filter((_, q) => share(ri, q) < LOW_FLEET).length;
  }
  return keep;
}

/** Whether a route crosses the window's avenue without being one of its lanes. */
const crossesAvenue = (rt: trafficTypes.Route) => Math.abs(rt.dx) > 0.5 && !ownAvenue(rt);

/** Whether a spot is on the window's avenue, from FULL_LOW to 900 m of the eye (ex, ez). */
const onAvenueStretch = ([x, z]: [number, number], ex: number, ez: number) =>
  Math.abs(x - GRID.av0) <= GRID.avenue / 2 &&
  Math.hypot(x - ex, z - ez) >= FULL_LOW &&
  Math.hypot(x - ex, z - ez) < 900;

/** Where the cars of the window's avenue lanes are, by key. */
const mine = (tr: Traffic): Set<string> =>
  new Set(
    tr.routes.flatMap((rt, ri) =>
      ownAvenue(rt)
        ? must(tr.lanes[ri]).map((c) => {
            const m = tr.front(c, tr.phase(ri)) - c.len / 2;
            return key(rt.x + rt.dx * m, rt.z + rt.dz * m);
          })
        : [],
    ),
  );

/** The cars of the window's avenue lanes: those whose share is under LOW_FLEET, and all of them. */
function avenueShares(tr: Traffic): { shared: number; total: number } {
  let shared = 0,
    total = 0;
  for (const [ri, rt] of tr.routes.entries()) {
    if (ownAvenue(rt)) {
      const lane = must(tr.lanes[ri]);
      shared += lane.filter((_, q) => share(ri, q) < LOW_FLEET).length;
      total += lane.length;
    }
  }
  return { shared, total };
}

/** After a draw from the eye (ex, ez): the spots of the full models and of the far box. */
const drawAt = (f: Fleet, ex: number, ez: number): { full: [number, number][]; box: [number, number][] } => {
  f.update(0.1, ex, ez);
  const i = inside(f);
  return { full: spotsOf(i.near), box: spots(i.far) };
};

/** Eyes spread over the street near the window. */
const eyes = (r: () => number): [number, number][] =>
  Array.from({ length: 8 }, () => [GRID.av0 + (r() - 0.5) * 600, (r() - 0.5) * 600]);

/** A room-window eye: over the street near the window, looking down the avenue (-z), with its frustum. */
const windowEye = (r: () => number): { ex: number; ez: number; seen: Frustum } => {
  const cam = new PerspectiveCamera(26, 412 / 915, 0.5, 20_000);
  cam.position.set(GRID.av0 + (r() - 0.5) * 60, 47, 3 + r() * 6);
  cam.rotation.set(-0.05 - r() * 0.2, (r() - 0.5) * 0.3, 0, 'YXZ');
  cam.updateMatrixWorld();
  return {
    ex: cam.position.x,
    ez: cam.position.z,
    seen: new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    ),
  };
};

/** How far each spot is from the eye (ex, ez). */
const dist = (s: [number, number][], ex: number, ez: number): number[] => s.map(([x, z]) => Math.hypot(x - ex, z - ez));

/** A note for each distance `ok` does not allow: `${what} at ${h}`. */
const misses = (hs: number[], ok: (h: number) => boolean, what: string): string[] =>
  hs.filter((h) => !ok(h)).map((h) => `${what} at ${h}`);

/** What the eye should see of the traffic: the cars it sees (and of those, the ones within 260 m), their shadows and their pools. */
function inView(
  tr: Traffic,
  seen: Frustum,
  eyeAt: { ex: number; ez: number },
): { body: string[]; close: string[]; shade: number; pool: number } {
  const body: string[] = [],
    close: string[] = [];
  let shade = 0,
    pool = 0;
  for (const c of tr.cars) {
    const { x, z } = tr.pose(c);
    if (seen.intersectsSphere(ball([x, 1.5, z], 3))) {
      body.push(key(x, z));
      if (Math.hypot(x - eyeAt.ex, z - eyeAt.ez) < 260) {
        close.push(key(x, z));
      }
    }
    if (seen.intersectsSphere(ball([x, 0, z], 4.5))) {
      shade++;
    }
    if (seen.intersectsSphere(ball([x, 0, z], 17.5))) {
      pool++;
    }
  }
  return { body, close, shade, pool };
}

/** 1 when some but not all of the `total` are seen, else 0. */
const someNotAll = (n: number, total: number): number => (n > 0 && n < total ? 1 : 0);

/** Whether either frustum sees the ball. */
const inEither = (a: Frustum, b: Frustum, s: Sphere): boolean => a.intersectsSphere(s) || b.intersectsSphere(s);

describe('cars', () => {
  it('tells a ball out of a frustum, wholly in it, or across the planes it cuts', () => {
    const r = rng(3);
    for (let k = 0; k < 20; k++) {
      const { cam, seen } = eye(r);
      for (let q = 0; q < 200; q++) {
        const b = ball(
            [cam.position.x + (r() - 0.5) * 800, r() * 20, cam.position.z + (r() - 0.5) * 800],
            1 + r() * 60,
          ),
          cut = within(seen, b);
        expect(cut >= 0).toBe(seen.intersectsSphere(b));
        const { got, want } = planeCuts(seen, b, cut);
        expect(got).toStrictEqual(want);
      }
    }
  });

  it("cuts a route to the stretch where a car's ball meets the frustum", () => {
    // (count the misses and expect once: an expect for each sample took over 5 s)
    const r = rng(5),
      tr = new Traffic(),
      out = [0, 0],
      miss: string[] = [];
    let n = 0;
    for (let k = 0; k < 12; k++) {
      const { seen } = eye(r, must([70, 26][k % 2]));
      for (const rt of tr.routes) {
        for (const [y, rad] of [
          [0, 4.5],
          [1.5, 3],
          [0, 17.5],
        ] as const) {
          const run = routeMisses(rt, seen, { y, rad, eye: k });
          n += run.n;
          miss.push(...run.miss);
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(miss).toStrictEqual([]);
    // (with no frustum, all of it)
    assert.exists(tr.routes[0]);
    reach(tr.routes[0], undefined, 0, 3, out);
    expect(out).toStrictEqual([-Infinity, Infinity]);
  });

  it('keeps every parked car in a cell whose ball holds it', () => {
    const all = parked(),
      { cars, turn, cells } = parkCells(all);
    expect(new Set(cars)).toStrictEqual(new Set(all));
    expect(cars).toHaveLength(all.length);
    const lastCell = cells.at(-1);
    assert.exists(lastCell);
    expect(lastCell.to).toBe(cars.length);
    for (const { ball: b, from, to } of cells) {
      for (let i = from; i < to; i++) {
        const c = cars[i];
        assert.exists(c);
        expect(Math.hypot(c.x - b.center.x, c.z - b.center.z) + 3).toBeLessThanOrEqual(b.radius + 1e-9);
        expect(turn[i * 2]).toBeCloseTo(Math.cos(c.rot), 12);
        expect(turn[i * 2 + 1]).toBeCloseTo(Math.sin(c.rot), 12);
      }
    }
  });

  describe('fleet size', () => {
    const meshes = movingOf;
    const drawnCars = (f: Fleet): number => {
      f.update(0.1, 0, 0);
      return meshes(f).reduce((s, im) => s + im.count, 0);
    };
    /** The moving cars drawn within `FULL_LOW` of the eye (ex, ez): they always drive at Low. */
    const nearCount = (f: Fleet, ex: number, ez: number): number =>
      spotsOf(meshes(f)).filter(([x, z]) => Math.hypot(x - ex, z - ez) < FULL_LOW).length;

    it('lock: the default fleet is every car, in several meshes', () => {
      const tr = new Traffic(),
        light = { night: { value: 0 } },
        a = new Fleet(tr, parked(), light, haze()),
        b = new Fleet(tr, parked(), light, haze(), 1);
      expect(drawnCars(a)).toBe(tr.cars.length);
      expect(drawnCars(b)).toBe(tr.cars.length);
      expect(meshes(b)).toHaveLength(meshes(a).length);
      expect(meshes(a).length).toBeGreaterThan(1);
      a.dispose();
      b.dispose();
    });

    it('Low: one full model and the far box for moving cars, those whose share is under LOW_FLEET', () => {
      const tr = new Traffic(),
        low = new Fleet(tr, parked(), { night: { value: 0 } }, haze(), LOW_FLEET, 1);
      expect(meshes(low)).toHaveLength(2);
      expect(inside(low).near).toHaveLength(1);
      // (the share is picked before the clip, so an eye sees at most that many: the clip of Low leaves some of the fleet out of reach of one eye)
      low.update(0.1, GRID.av0, 0);
      const seenNow = meshes(low).reduce((s, im) => s + im.count, 0);
      expect(seenNow).toBeGreaterThan(0);
      // (the window's own avenue keeps every car: those are over the share)
      const keep = lowKeeps(tr);
      expect(seenNow).toBeLessThanOrEqual(keep + nearCount(low, GRID.av0, 0));
      low.dispose();
    });

    it("Low: every car in a lane of the window's avenue drives out to the avenue's clip; a street that crosses it keeps its share", () => {
      const light = { night: { value: 0 } },
        trF = new Traffic(),
        trL = new Traffic();
      const full = new Fleet(trF, parked(), light, haze(), 1, 1),
        low = new Fleet(trL, parked(), light, haze(), LOW_FLEET, 1);
      const own = trL.routes.filter((rt) => ownAvenue(rt));
      expect(own.length).toBeGreaterThan(1);
      expect(own.length).toBeLessThan(trL.routes.length / 4);
      for (const rt of own) {
        expect(rt.dx).toBe(0);
        expect(Math.abs(rt.x - GRID.av0)).toBeLessThanOrEqual(GRID.avenue / 2);
      }
      // a street's lane where it crosses the avenue is not the avenue's
      expect(trL.routes.some((rt) => crossesAvenue(rt))).toBe(true);
      const ex = GRID.av0,
        ez = 0;
      full.update(0.1, ex, ez);
      low.update(0.1, ex, ez);
      // the avenue's cars past FULL_LOW, to the avenue's clip (900 m, a ring's edge): the stretch the window shows (the near block hides it to about 350 m)
      const lanes = (f: Fleet): string[] =>
        spotsOf(meshes(f))
          .filter((at) => onAvenueStretch(at, ex, ez))
          .map(([x, z]) => key(x, z))
          .toSorted();
      const along = (f: Fleet, tr: Traffic): string[] => {
        const set = mine(tr);
        return lanes(f).filter((k) => set.has(k));
      };
      expect(along(low, trL)).toStrictEqual(along(full, trF));
      expect(along(low, trL).length).toBeGreaterThan(4);
      // and more of them than the share alone would leave
      const { shared, total } = avenueShares(trL);
      expect(shared).toBeLessThan(total);
      full.dispose();
      low.dispose();
    });

    it('Low: every car within FULL_LOW (300 m) of the eye drives, the share thins only the rest', () => {
      expect(FULL_LOW).toBe(300);
      const light = { night: { value: 0 } },
        full = new Fleet(new Traffic(), parked(), light, haze(), 1, 1),
        low = new Fleet(new Traffic(), parked(), light, haze(), LOW_FLEET, 1);
      for (const [ex, ez] of [
        [GRID.av0, 0],
        [GRID.av0 + 40, 120],
        [GRID.av0 - 90, -60],
      ] as const) {
        full.update(0.1, ex, ez);
        low.update(0.1, ex, ez);
        const near = (f: Fleet): string[] =>
          spotsOf(meshes(f))
            .filter(([x, z]) => Math.hypot(x - ex, z - ez) < FULL_LOW)
            .map(([x, z]) => key(x, z))
            .toSorted();
        expect(near(low)).toStrictEqual(near(full));
        expect(near(low).length).toBeGreaterThan(0);
        // past it, the share thins the fleet
        const all = (f: Fleet): number => meshes(f).reduce((s, im) => s + im.count, 0);
        expect(all(low)).toBeLessThan(all(full));
      }
      full.dispose();
      low.dispose();
    });

    it('Low: a car key is in [0, 1), the same each call, and about evenly spread', () => {
      const keys: number[] = [];
      for (let ri = 0; ri < 40; ri++) {
        for (let q = 0; q < 40; q++) {
          const k = share(ri, q);
          expect(k).toBeGreaterThanOrEqual(0);
          expect(k).toBeLessThan(1);
          expect(share(ri, q)).toBe(k);
          keys.push(k);
        }
      }
      const under = keys.filter((k) => k < LOW_FLEET).length / keys.length;
      expect(Math.abs(under - LOW_FLEET)).toBeLessThan(0.05);
    });
  });

  describe('near range', () => {
    it('Low: a full model only within 100 m of the eye, the far box past it', () => {
      const r = rng(12),
        low = new Fleet(new Traffic(), parked(), { night: { value: 0 } }, haze(), LOW_FLEET, 1);
      const bad: string[] = [];
      let full = 0,
        box = 0;
      for (const [ex, ez] of eyes(r)) {
        const d = drawAt(low, ex, ez);
        bad.push(
          ...misses(dist(d.full, ex, ez), (h) => h < 100, 'full'),
          ...misses(dist(d.box, ex, ez), (h) => h >= 100, 'box'),
        );
        full += d.full.length;
        box += d.box.length;
      }
      // (a miss is counted, not expected one by one: an expect for each car took long)
      expect(bad).toStrictEqual([]);
      expect(full).toBeGreaterThan(0);
      expect(box).toBeGreaterThan(0);
      low.dispose();
    });

    it('High: a full model within 260 m of the eye, the far box past it, full models past 100 m', () => {
      const r = rng(13),
        high = new Fleet(new Traffic(), parked(), { night: { value: 0 } }, haze());
      const bad: string[] = [];
      let full = 0,
        box = 0,
        past100 = 0;
      for (const [ex, ez] of eyes(r)) {
        const d = drawAt(high, ex, ez),
          fullAt = dist(d.full, ex, ez);
        bad.push(...misses(fullAt, (h) => h < 260, 'full'), ...misses(dist(d.box, ex, ez), (h) => h >= 260, 'box'));
        past100 += fullAt.filter((h) => h >= 100).length;
        full += d.full.length;
        box += d.box.length;
      }
      expect(bad).toStrictEqual([]);
      expect(full).toBeGreaterThan(0);
      expect(box).toBeGreaterThan(0);
      expect(past100).toBeGreaterThan(0);
      high.dispose();
    });

    // (the Low clip, as `CLIP_LOW` in cars.ts: a car past it is not drawn, moving or parked; one within it still is. On the window's avenue
    // the clip is `CLIP_AVENUE_LOW`)
    const CLIP = 350,
      CLIP_AVENUE = 900;
    /** Whether Low may draw a car at `x`, `h` m from the eye. */
    const kept = (x: number, h: number): boolean =>
      h <= CLIP || (Math.abs(x - GRID.av0) <= GRID.avenue / 2 && h <= CLIP_AVENUE);
    it("Low: no car past 350 m of the eye, moving or parked, but on the window's avenue (to 900 m); those within it are drawn", () => {
      const r = rng(14),
        low = new Fleet(new Traffic(), parked(), { night: { value: 0 } }, haze(), LOW_FLEET, 1);
      const bad: string[] = [];
      let moving = 0,
        parkedIn = 0;
      for (const [ex, ez] of eyes(r)) {
        low.update(0.1, ex, ez);
        low.park(undefined, ex, ez);
        const i = inside(low);
        const mv = [...spotsOf(i.near), ...spots(i.far)],
          pk = i.still.flatMap(({ im }) => spots(im));
        bad.push(
          ...[...mv, ...pk]
            .map(([x, z]) => [x, Math.hypot(x - ex, z - ez)] as const)
            .filter(([x, h]) => !kept(x, h))
            .map(([, h]) => `car at ${h}`),
        );
        moving += mv.filter(([x, z]) => Math.hypot(x - ex, z - ez) <= CLIP).length;
        parkedIn += pk.filter(([x, z]) => Math.hypot(x - ex, z - ez) <= CLIP).length;
      }
      expect(bad).toStrictEqual([]);
      expect(moving).toBeGreaterThan(0);
      expect(parkedIn).toBeGreaterThan(0);
      low.dispose();
    });

    /** Whether Low may draw the far box for a car at `x`, `h` m from the eye: past 100 m, and within the clip. */
    const boxKept = (x: number, h: number): boolean => h >= 100 && kept(x, h);
    it('Low: from a window eye, moving cars past 100 m (and within the clip) are the far box, not the full model', () => {
      const r = rng(21),
        low = new Fleet(new Traffic(), parked(), { night: { value: 0 } }, haze(), LOW_FLEET, 1);
      let box = 0,
        full = 0;
      const bad: string[] = [];
      for (let k = 0; k < 6; k++) {
        const { ex, ez, seen } = windowEye(r);
        for (let q = 0; q < 20; q++) {
          low.update(0.1, ex, ez, seen);
          low.park(seen, ex, ez);
        }
        const i = inside(low),
          far = dist(spots(i.far), ex, ez),
          near = dist(spotsOf(i.near), ex, ez);
        bad.push(
          ...spots(i.far)
            .map(([x], j) => [x, must(far[j])] as const)
            .filter(([x, h]) => !boxKept(x, h))
            .map(([, h]) => `box at ${h}`),
          ...misses(near, (h) => h < 100, 'full'),
        );
        box += far.filter((h) => h >= 100).length;
        full += near.length;
      }
      expect(bad).toStrictEqual([]);
      // (the far box carries the mid-avenue cars: some on every window eye, the full models few)
      expect(box).toBeGreaterThan(0);
      expect(full).toBeLessThan(box);
      low.dispose();
    });

    it('Low: from a window eye, the parked cars past 100 m (and within the clip) are instanced in the box mesh', () => {
      const r = rng(22),
        low = new Fleet(new Traffic(), parked(), { night: { value: 0 } }, haze(), LOW_FLEET, 1);
      let inRange = 0;
      const bad: string[] = [];
      for (let k = 0; k < 6; k++) {
        const { ex, ez, seen } = windowEye(r);
        low.update(0.1, ex, ez, seen);
        low.park(seen, ex, ez);
        // (every parked car at Low is a box: its one mesh of them, with the cars it places)
        const { still } = inside(low);
        expect(still).toHaveLength(1);
        const at = spots(must(still[0]).im),
          h = dist(at, ex, ez);
        bad.push(
          ...at
            .map(([x], j) => [x, must(h[j])] as const)
            .filter(([x, d]) => !kept(x, d))
            .map(([, d]) => `parked at ${d}`),
        );
        inRange += h.filter((d) => d >= 100).length;
      }
      expect(bad).toStrictEqual([]);
      expect(inRange).toBeGreaterThan(0);
      low.dispose();
    });

    it('High: from a window eye, the full models stay within 260 m and the box is past it', () => {
      const r = rng(23),
        high = new Fleet(new Traffic(), parked(), { night: { value: 0 } }, haze());
      const bad: string[] = [];
      let midFull = 0;
      for (let k = 0; k < 6; k++) {
        const { ex, ez, seen } = windowEye(r);
        high.update(0.1, ex, ez, seen);
        high.park(seen, ex, ez);
        const i = inside(high),
          fullAt = dist(spotsOf(i.near), ex, ez),
          boxAt = dist(spots(i.far), ex, ez);
        bad.push(...misses(fullAt, (h) => h < 260, 'full'), ...misses(boxAt, (h) => h >= 260, 'box'));
        midFull += fullAt.filter((h) => h >= 100).length;
      }
      expect(bad).toStrictEqual([]);
      expect(midFull).toBeGreaterThan(0);
      high.dispose();
    });

    /**
     * The live window eye (flyToRoom, 485×997: the camera outside at (-0.59, 46.49, 3.69)). From it the near block east of the avenue hides
     * the avenue to the crossing at z ≈ -348, so the stretch the window shows runs from about 340 m to 720 m (past it the blocks close it).
     * Low clipped every car past 350 m, and the window's avenue was empty: shots/ad7/diag-day.png against base's ~20 cars in
     * shots/official-gpu-final/compare-day-street.png. Each car is tested on its line of sight against the real buildings.
     */
    const LIVE = new Vector3(-0.59, 46.49, 3.69);
    const hidden = (bs: planTypes.Building[], x: number, z: number): boolean => {
      const d = [x - LIVE.x, 0.8 - LIVE.y, z - LIVE.z],
        o = [LIVE.x, LIVE.y, LIVE.z];
      return bs.some((b) =>
        b.tiers.some((t) => {
          const box = [
            [t.x0, t.x1],
            [t.y0, t.y1],
            [t.z0, t.z1],
          ];
          let lo = 0,
            hi = 0.999;
          for (let a = 0; a < 3; a++) {
            let u = (must(must(box[a])[0]) - must(o[a])) / must(d[a]),
              v = (must(must(box[a])[1]) - must(o[a])) / must(d[a]);
            if (u > v) {
              [u, v] = [v, u];
            }
            lo = Math.max(lo, u);
            hi = Math.min(hi, v);
          }
          return lo <= hi;
        }),
      );
    };
    /** The cars on the window's avenue in the stretch it shows, in sight of the live eye, summed over a run of draws. */
    const inSight = (f: Fleet, bs: planTypes.Building[]): number => {
      let n = 0;
      for (let q = 0; q < 8; q++) {
        f.update(2, LIVE.x, LIVE.z);
        f.park(undefined, LIVE.x, LIVE.z);
        const i = inside(f);
        for (const [x, z] of [...spotsOf(i.moving), ...i.still.flatMap(({ im }) => spots(im))]) {
          const h = Math.hypot(x - LIVE.x, z - LIVE.z);
          if (Math.abs(x - GRID.av0) <= GRID.avenue / 2 && h >= 340 && h <= 720 && !hidden(bs, x, z)) {
            n++;
          }
        }
      }
      return n;
    };

    it("Low: from the live window eye, about half of High's cars show on the avenue past the near block", () => {
      const bs = buildings();
      const high = new Fleet(new Traffic(), parked(), { night: { value: 0 } }, haze());
      const low = new Fleet(new Traffic(), parked(), { night: { value: 0 } }, haze(), LOW_FLEET, 1);
      const h = inSight(high, bs),
        l = inSight(low, bs);
      expect(h).toBeGreaterThan(20);
      expect(l).toBeGreaterThanOrEqual(h * 0.4);
      expect(l).toBeLessThan(h);
      high.dispose();
      low.dispose();
    }, 60_000);

    it('High: no clip, so cars past 350 m of the eye are placed', () => {
      const r = rng(15),
        high = new Fleet(new Traffic(), parked(), { night: { value: 0 } }, haze());
      let past = 0;
      for (const [ex, ez] of eyes(r)) {
        high.update(0.1, ex, ez);
        high.park(undefined, ex, ez);
        const i = inside(high);
        past += [...spotsOf(i.near), ...spots(i.far), ...i.still.flatMap(({ im }) => spots(im))].filter(
          ([x, z]) => Math.hypot(x - ex, z - ez) > CLIP,
        ).length;
      }
      expect(past).toBeGreaterThan(0);
      high.dispose();
    });
  });

  describe('material', () => {
    it('High: the car material keeps its clearcoat of 1', () => {
      expect(carMaterial({ night: { value: 0 } }).clearcoat).toBe(1);
      const high = new Fleet(new Traffic(), parked(), { night: { value: 0 } }, haze());
      expect(matOf(high).clearcoat).toBe(1);
      high.dispose();
    });

    it('Low: the car material has no clearcoat', () => {
      expect(carMaterial({ night: { value: 0 } }, false).clearcoat).toBe(0);
      const low = new Fleet(new Traffic(), parked(), { night: { value: 0 } }, haze(), LOW_FLEET, 1);
      expect(matOf(low).clearcoat).toBe(0);
      low.dispose();
    });

    it('Low: the fleet has no light pools or soft shadows in the group', () => {
      const low = new Fleet(new Traffic(), parked(), { night: { value: 0 } }, haze(), LOW_FLEET, 1);
      const i = inside(low);
      expect(i.pools.parent).toBeNull();
      expect(i.shades.parent).toBeNull();
      low.dispose();
    });
  });

  it('places just the cars the eye sees: moving and parked, their shadows, their pools at night', () => {
    const r = rng(9),
      tr = new Traffic(),
      light = { night: { value: 0 } },
      fleet = new Fleet(tr, parked(), light, haze());
    const P = parked().length;
    let saw = 0;
    for (let k = 0; k < 10; k++) {
      const { cam, seen } = eye(r),
        ex = cam.position.x,
        ez = cam.position.z;
      light.night.value = k % 2;
      fleet.update(0.1 + r() * 0.3, ex, ez, seen);
      fleet.park(seen);
      const { body, close, shade, pool } = inView(tr, seen, { ex, ez });
      saw += someNotAll(body.length, tr.cars.length);
      const f = inside(fleet);
      expect(f.moving.flatMap((im) => placed(im)).toSorted()).toStrictEqual(body.toSorted());
      expect(f.near.flatMap((im) => placed(im)).toSorted()).toStrictEqual(close.toSorted());
      // (at night a car's shadow goes with its pool: more of them than are seen, none missing)
      expect(f.shades.count - P).toBe([shade, pool][k % 2]);
      expect(f.pools.count).toBe([0, pool][k % 2]);
      for (const { im, cars } of f.still) {
        expect(placed(im).toSorted()).toStrictEqual(
          cars
            .filter((c) => seen.intersectsSphere(ball([c.x, 1.5, c.z], 3)))
            .map((c) => key(c.x, c.z))
            .toSorted(),
        );
      }
    }
    // (most of the eyes see some of the traffic, not all of it)
    expect(saw).toBeGreaterThan(5);
    // with no frustum, every car
    fleet.update(0.1, 0, 0);
    fleet.park();
    const all = inside(fleet);
    expect(all.moving.reduce((s, im) => s + im.count, 0)).toBe(tr.cars.length);
    expect(all.still.reduce((s, { im }) => s + im.count, 0)).toBe(P);
    // on a frame that draws the sun's map, the parked cars the eye sees and those its box holds (CITY-08): the cars out of both are not placed
    const r2 = rng(4),
      { seen: a } = eye(r2),
      { seen: b } = eye(r2);
    fleet.park(a, 0, 0, b);
    for (const { im, cars } of inside(fleet).still) {
      expect(placed(im).toSorted()).toStrictEqual(
        cars
          .filter((c) => inEither(a, b, ball([c.x, 1.5, c.z], 3)))
          .map((c) => key(c.x, c.z))
          .toSorted(),
      );
    }
    const union = inside(fleet).still.reduce((s, { im }) => s + im.count, 0);
    fleet.park(a, 0, 0);
    expect(union).toBeGreaterThanOrEqual(inside(fleet).still.reduce((s, { im }) => s + im.count, 0));
    expect(union).toBeLessThan(P);
    fleet.dispose();
  }, 30_000);
});
