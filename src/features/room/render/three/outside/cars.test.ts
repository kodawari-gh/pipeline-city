import { Color, Frustum, Matrix4, PerspectiveCamera, Sphere, Vector3, type InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { Fleet, parkCells, reach, within } from './cars';
import type { HazeUniforms } from './haze';
import { LOW_FLEET } from './detail';
import { GRID, parked, rng, type Car } from './plan';
import { Traffic } from './traffic';

/** A camera somewhere over the street near the window, turned at random (`r`), and its frustum. */
function eye(r: () => number, fov = 26): { cam: PerspectiveCamera; seen: Frustum } {
  const cam = new PerspectiveCamera(fov, 412 / 915, 0.5, 20000);
  cam.position.set(GRID.av0 + (r() - 0.5) * 300, 5 + r() * 120, 30 - r() * 300);
  cam.rotation.set(-0.6 + r() * 0.7, r() * Math.PI * 2, 0, 'YXZ');
  cam.updateMatrixWorld();
  return { cam, seen: new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)) };
}

const ball = (x: number, y: number, z: number, r: number): Sphere => new Sphere(new Vector3(x, y, z), r);
/** The places (x, z) of a mesh's instances. */
const placed = (im: InstancedMesh): string[] => {
  const a = im.instanceMatrix.array, out: string[] = [];
  for (let i = 0; i < im.count; i++) out.push(`${a[i * 16 + 12]!.toFixed(2)},${a[i * 16 + 14]!.toFixed(2)}`);
  return out;
};
const key = (x: number, z: number): string => `${Math.fround(x).toFixed(2)},${Math.fround(z).toFixed(2)}`;

const haze = (): HazeUniforms => ({
  hzCol: { value: new Color() }, hzSun: { value: new Color() }, hzDir: { value: new Vector3() }, hzDensity: { value: 0 }, hzFall: { value: 0 },
  hzMist: { value: new Color() }, hzMistD: { value: 0 }, hzTime: { value: 0 },
});
/** The (x, z) of a mesh's instances, as numbers. */
const spots = (im: InstancedMesh): [number, number][] => {
  const a = im.instanceMatrix.array, out: [number, number][] = [];
  for (let i = 0; i < im.count; i++) out.push([a[i * 16 + 12]!, a[i * 16 + 14]!]);
  return out;
};
type Inside = { moving: InstancedMesh[]; near: InstancedMesh[]; far: InstancedMesh; pools: InstancedMesh; shades: InstancedMesh; still: { im: InstancedMesh; cars: Car[] }[] };

describe('cars', () => {
  it('tells a ball out of a frustum, wholly in it, or across the planes it cuts', () => {
    const r = rng(3);
    for (let k = 0; k < 20; k++) {
      const { cam, seen } = eye(r);
      for (let q = 0; q < 200; q++) {
        const b = ball(cam.position.x + (r() - 0.5) * 800, r() * 20, cam.position.z + (r() - 0.5) * 800, 1 + r() * 60), cut = within(seen, b);
        expect(cut >= 0).toBe(seen.intersectsSphere(b));
        if (cut < 0) continue;
        seen.planes.forEach((p, i) => expect(!!(cut & (1 << i))).toBe(p.distanceToPoint(b.center) < b.radius));
      }
    }
  });

  it('cuts a route to the stretch where a car\'s ball meets the frustum', () => {
    // (count the misses and expect once: an expect for each sample took over 5 s)
    const r = rng(5), tr = new Traffic(), out = [0, 0], miss: string[] = [];
    let n = 0;
    for (let k = 0; k < 12; k++) {
      const { seen } = eye(r, k % 2 ? 26 : 70);
      for (const rt of tr.routes) for (const [y, rad] of [[0, 4.5], [1.5, 3], [0, 17.5]] as const) {
        reach(rt, seen, y, rad, out);
        for (let m = -40; m < rt.len + 40; m += 3.7) {
          if (Math.abs(m - out[0]!) < 1e-6 || Math.abs(m - out[1]!) < 1e-6) continue;
          n++;
          if ((m >= out[0]! && m <= out[1]!) !== seen.intersectsSphere(ball(rt.x + rt.dx * m, y, rt.z + rt.dz * m, rad))) miss.push(`eye ${k} m ${m}`);
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(miss).toEqual([]);
    // (with no frustum, all of it)
    reach(tr.routes[0]!, undefined, 0, 3, out);
    expect(out).toEqual([-Infinity, Infinity]);
  });

  it('keeps every parked car in a cell whose ball holds it', () => {
    const all = parked(), { cars, turn, cells } = parkCells(all);
    expect(new Set(cars)).toEqual(new Set(all));
    expect(cars.length).toBe(all.length);
    expect(cells[cells.length - 1]!.to).toBe(cars.length);
    for (const { ball: b, from, to } of cells) for (let i = from; i < to; i++) {
      const c = cars[i]!;
      expect(Math.hypot(c.x - b.center.x, c.z - b.center.z) + 3).toBeLessThanOrEqual(b.radius + 1e-9);
      expect(turn[i * 2]).toBeCloseTo(Math.cos(c.rot), 12);
      expect(turn[i * 2 + 1]).toBeCloseTo(Math.sin(c.rot), 12);
    }
  });

  describe('fleet size', () => {
    /** `Fleet` as the Low cut will build it (the count scale and the model cap do not exist yet). */
    const Sized = Fleet as unknown as new (t: Traffic, p: Car[], l: { night: { value: number } }, h: HazeUniforms, scale?: number, models?: number) => Fleet;
    const meshes = (f: Fleet): InstancedMesh[] => (f as unknown as Inside).moving;
    const drawnCars = (f: Fleet): number => { f.update(0.1, 0, 0); return meshes(f).reduce((s, im) => s + im.count, 0); };

    it('lock: the default fleet is every car, in several meshes', () => {
      const tr = new Traffic(), light = { night: { value: 0 } }, a = new Fleet(tr, parked(), light, haze()), b = new Sized(tr, parked(), light, haze(), 1);
      expect(drawnCars(a)).toBe(tr.cars.length);
      expect(drawnCars(b)).toBe(tr.cars.length);
      expect(meshes(b).length).toBe(meshes(a).length);
      expect(meshes(a).length).toBeGreaterThan(1);
      a.dispose(); b.dispose();
    });

    it('Low: one full model and the far box for moving cars, ceil(High * LOW_FLEET) of them', () => {
      const tr = new Traffic(), low = new Sized(tr, parked(), { night: { value: 0 } }, haze(), LOW_FLEET, 1);
      expect(meshes(low).length).toBe(2);
      expect((low as unknown as Inside).near.length).toBe(1);
      // (the share is picked before the clip, so an eye sees at most that many: the clip of Low leaves some of the fleet out of reach of one eye)
      low.update(0.1, GRID.av0, 0);
      const seenNow = meshes(low).reduce((s, im) => s + im.count, 0);
      expect(seenNow).toBeGreaterThan(0);
      expect(seenNow).toBeLessThanOrEqual(Math.ceil(tr.cars.length * LOW_FLEET));
      low.dispose();
    });
  });

  describe('near range', () => {
    const Sized = Fleet as unknown as new (t: Traffic, p: Car[], l: { night: { value: number } }, h: HazeUniforms, scale?: number, models?: number) => Fleet;
    /** After a draw from the eye (ex, ez): the spots of the full models and of the far box. */
    const drawAt = (f: Fleet, ex: number, ez: number): { full: [number, number][]; box: [number, number][] } => {
      f.update(0.1, ex, ez);
      const i = f as unknown as Inside;
      return { full: i.near.flatMap(spots), box: spots(i.far) };
    };
    /** Eyes spread over the street near the window. */
    const eyes = (r: () => number): [number, number][] => Array.from({ length: 8 }, () => [GRID.av0 + (r() - 0.5) * 600, (r() - 0.5) * 600]);

    it('Low: a full model only within 100 m of the eye, the far box past it', () => {
      const r = rng(12), low = new Sized(new Traffic(), parked(), { night: { value: 0 } }, haze(), LOW_FLEET, 1);
      const bad: string[] = [];
      let full = 0, box = 0;
      for (const [ex, ez] of eyes(r)) {
        const d = drawAt(low, ex, ez);
        for (const [x, z] of d.full) if (!(Math.hypot(x - ex, z - ez) < 100)) bad.push(`full at ${Math.hypot(x - ex, z - ez)}`);
        for (const [x, z] of d.box) if (!(Math.hypot(x - ex, z - ez) >= 100)) bad.push(`box at ${Math.hypot(x - ex, z - ez)}`);
        full += d.full.length; box += d.box.length;
      }
      // (a miss is counted, not expected one by one: an expect for each car took long)
      expect(bad).toEqual([]);
      expect(full).toBeGreaterThan(0);
      expect(box).toBeGreaterThan(0);
      low.dispose();
    });

    it('High: a full model within 260 m of the eye, the far box past it, full models past 100 m', () => {
      const r = rng(13), high = new Sized(new Traffic(), parked(), { night: { value: 0 } }, haze());
      const bad: string[] = [];
      let full = 0, box = 0, past100 = 0;
      for (const [ex, ez] of eyes(r)) {
        const d = drawAt(high, ex, ez);
        for (const [x, z] of d.full) { const h = Math.hypot(x - ex, z - ez); if (!(h < 260)) bad.push(`full at ${h}`); if (h >= 100) past100++; }
        for (const [x, z] of d.box) if (!(Math.hypot(x - ex, z - ez) >= 260)) bad.push(`box at ${Math.hypot(x - ex, z - ez)}`);
        full += d.full.length; box += d.box.length;
      }
      expect(bad).toEqual([]);
      expect(full).toBeGreaterThan(0);
      expect(box).toBeGreaterThan(0);
      expect(past100).toBeGreaterThan(0);
      high.dispose();
    });

    // (the Low clip, as `CLIP_LOW` in cars.ts: a car past it is not drawn, moving or parked; one within it still is)
    const CLIP = 350;
    it('Low: no car past 350 m of the eye, moving or parked; those within it are drawn', () => {
      const r = rng(14), low = new Sized(new Traffic(), parked(), { night: { value: 0 } }, haze(), LOW_FLEET, 1);
      const bad: string[] = [];
      let moving = 0, parkedIn = 0;
      for (const [ex, ez] of eyes(r)) {
        low.update(0.1, ex, ez);
        low.park(undefined, ex, ez);
        const i = low as unknown as Inside;
        const mv = [...i.near.flatMap(spots), ...spots(i.far)], pk = i.still.flatMap(({ im }) => spots(im));
        for (const [x, z] of [...mv, ...pk]) { const h = Math.hypot(x - ex, z - ez); if (h > CLIP) bad.push(`car at ${h}`); }
        moving += mv.filter(([x, z]) => Math.hypot(x - ex, z - ez) <= CLIP).length;
        parkedIn += pk.filter(([x, z]) => Math.hypot(x - ex, z - ez) <= CLIP).length;
      }
      expect(bad).toEqual([]);
      expect(moving).toBeGreaterThan(0);
      expect(parkedIn).toBeGreaterThan(0);
      low.dispose();
    });

    it('High: no clip, so cars past 350 m of the eye are placed', () => {
      const r = rng(15), high = new Sized(new Traffic(), parked(), { night: { value: 0 } }, haze());
      let past = 0;
      for (const [ex, ez] of eyes(r)) {
        high.update(0.1, ex, ez);
        high.park(undefined, ex, ez);
        const i = high as unknown as Inside;
        for (const [x, z] of [...i.near.flatMap(spots), ...spots(i.far), ...i.still.flatMap(({ im }) => spots(im))]) if (Math.hypot(x - ex, z - ez) > CLIP) past++;
      }
      expect(past).toBeGreaterThan(0);
      high.dispose();
    });
  });

  it('places just the cars the eye sees: moving and parked, their shadows, their pools at night', () => {
    const r = rng(9), tr = new Traffic(), light = { night: { value: 0 } }, fleet = new Fleet(tr, parked(), light, haze());
    const f = fleet as unknown as Inside, P = parked().length;
    let saw = 0;
    for (let k = 0; k < 10; k++) {
      const { cam, seen } = eye(r), ex = cam.position.x, ez = cam.position.z;
      light.night.value = k % 2;
      fleet.update(0.1 + r() * 0.3, ex, ez, seen);
      fleet.park(seen);
      const body: string[] = [], close: string[] = [];
      let shade = 0, pool = 0;
      for (const c of tr.cars) {
        const { x, z } = tr.pose(c);
        if (seen.intersectsSphere(ball(x, 1.5, z, 3))) { body.push(key(x, z)); if (Math.hypot(x - ex, z - ez) < 260) close.push(key(x, z)); }
        if (seen.intersectsSphere(ball(x, 0, z, 4.5))) shade++;
        if (seen.intersectsSphere(ball(x, 0, z, 17.5))) pool++;
      }
      saw += body.length && body.length < tr.cars.length ? 1 : 0;
      expect(f.moving.flatMap(placed).sort()).toEqual(body.sort());
      expect(f.near.flatMap(placed).sort()).toEqual(close.sort());
      // (at night a car's shadow goes with its pool: more of them than are seen, none missing)
      expect(f.shades.count - P).toBe(k % 2 ? pool : shade);
      expect(f.pools.count).toBe(k % 2 ? pool : 0);
      for (const { im, cars } of f.still) {
        expect(placed(im).sort()).toEqual(cars.filter((c) => seen.intersectsSphere(ball(c.x, 1.5, c.z, 3))).map((c) => key(c.x, c.z)).sort());
      }
    }
    // (most of the eyes see some of the traffic, not all of it)
    expect(saw).toBeGreaterThan(5);
    // with no frustum (the sun's shadows), every car
    fleet.update(0.1, 0, 0);
    fleet.park();
    expect(f.moving.reduce((s, im) => s + im.count, 0)).toBe(tr.cars.length);
    expect(f.still.reduce((s, { im }) => s + im.count, 0)).toBe(P);
    fleet.dispose();
  }, 30000);
});
