// The lower detail level of the costly part shapes (LOD-05): a braided sleeve, a fan-guard ring, a heat pipe, a pin coil, a cable, a solder
// fillet, the case kit's walls and fixings, a chip's leg and a draped label each have a level with at most half the triangles of the full
// shape, and `lowOf` keeps it (the same attributes, the same bounds).
import * as three from 'three';
import { describe, expect, it } from 'vitest';
import { lowOf } from '@/core/render/three/merge';
import { braidedTube } from './cables3d';
import * as casekit3d from './casekit3d';
import { cableMesh } from './wires3d';
import { guardRing } from './psu3d';
import { pipe } from './cooler3d';
import { pinCoil, solderFillet } from './nic3d';
import { drape } from './pcbkit3d';
import { gullWing } from './solids3d';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): three.Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a Mesh');
  }
  return o;
}

const tris = (g: three.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const m = new three.MeshStandardMaterial();

/** The full shape's triangles and its level's, which must exist and be at most half. */
function expectHalf(g: three.BufferGeometry, name: string): void {
  const low = lowOf(g);
  expect(low, `${name}: lower level`).toBeDefined();
  expect(tris(must(low)), `${name}: low triangles`).toBeLessThanOrEqual(tris(g) / 2);
}

const size = (p: { x: number; y: number }[]): [number, number, number, number] => [
  Math.min(...p.map((q) => q.x)),
  Math.max(...p.map((q) => q.x)),
  Math.min(...p.map((q) => q.y)),
  Math.max(...p.map((q) => q.y)),
];

describe('the lower detail level of the costly part shapes (LOD-05)', () => {
  it('a braided sleeve has a level of 6 sides and half the steps, in the same skin', () => {
    const pts = [0, 1, 2, 3, 4].map((i) => new three.Vector3(i * 40, Math.sin(i) * 20, i * 10));
    const { mesh } = braidedTube(pts, 4, '#0c1226', '#464078');
    expectHalf(mesh.geometry, 'braidedTube');
    const low = must(lowOf(mesh.geometry));
    expect(Object.keys(low.attributes).toSorted()).toStrictEqual(Object.keys(mesh.geometry.attributes).toSorted());
  });

  it('a fan-guard ring has a level of 4 sides round the wire and 24 along the ring', () => {
    expectHalf(guardRing(60, 1.5), 'guardRing');
  });

  it('a heat pipe has a level of 24 steps and 6 sides on the same curve', () => {
    const mesh = pipe(
      [
        [0, 0, 0],
        [200, 0, 0],
        [200, 120, 0],
        [0, 120, 40],
      ],
      12,
      m,
    );
    expectHalf(mesh.geometry, 'pipe');
  });

  it('a pin coil has a level of 24 steps and 4 sides on the same curve', () => {
    expectHalf(pinCoil(0, 0, 0, m).geometry, 'pinCoil');
  });

  it('an ATX cable (a sleeve of several strands) has a level of half the steps and 6 sides, on the same paths', () => {
    const pts: [number, number, number][] = [0, 1, 2, 3, 4].map((i) => [i * 40, Math.sin(i) * 20, i * 10]);
    const mesh = cableMesh([pts, pts.map((p): [number, number, number] => [p[0], p[1] + 12, p[2]])], {
      r: 4,
      base: '#0c1226',
      accent: '#464078',
    });
    expectHalf(mesh.geometry, 'cableMesh');
    const low = must(lowOf(mesh.geometry));
    expect(Object.keys(low.attributes).toSorted()).toStrictEqual(Object.keys(mesh.geometry.attributes).toSorted());
  });

  it('a solder fillet has a level of one band (a cone) on the same 6 sides and the same outer size', () => {
    expectHalf(solderFillet(), 'solderFillet');
  });

  it('a coarse outline keeps its size: a small rounded corner becomes a chamfer, a wide round keeps its points, a circle two thirds of them', () => {
    const small = casekit3d.outlinePts({ x: 0, y: 0, w: 400, h: 200 }, 20),
      wide = casekit3d.outlinePts({ x: 0, y: 0, w: 3000, h: 2600 }, 600),
      circle = casekit3d.wallCircle(0, 0, 1300);
    expect(casekit3d.coarse(small)).toHaveLength(8);
    expect(size(casekit3d.coarse(small))).toStrictEqual(size(small));
    expect(casekit3d.coarse(wide)).toHaveLength(wide.length);
    expect(casekit3d.coarse(circle).length).toBeLessThanOrEqual((circle.length * 2) / 3);
    expect(size(casekit3d.coarse(circle))).toStrictEqual(size(circle));
  });

  it('a wall and a slab with many rounded openings have a level; a plain plate has none', () => {
    const holes = Array.from({ length: 12 }, (_, i) => ({ y0: i * 80, y1: i * 80 + 60, z0: 20, z1: 80, r: 14 }));
    expectHalf(casekit3d.wallX(0, 26, { y0: -20, y1: 980, z0: 0, z1: 100, r: 10 }, holes, m, 2).geometry, 'wallX');
    const cuts = Array.from({ length: 8 }, (_, i) =>
      casekit3d.outlinePts({ x: 40 + i * 120, y: 40, w: 80, h: 300 }, 40),
    );
    const outline = casekit3d.outlinePts({ x: 0, y: 0, w: 1040, h: 380 }, 30);
    const shape = casekit3d.shapeOf(outline, cuts);
    expectHalf(casekit3d.slab(shape, 0, 20, m, 6).geometry, 'slab');
    expect(
      lowOf(casekit3d.wallX(0, 10, { y0: 0, y1: 500, z0: 0, z1: 300 }, [], m).geometry),
      'a plain plate',
    ).toBeUndefined();
  });

  it('a screw, a rivet, a thumbscrew head and a pad each have a level that turns with them', () => {
    const spot = [{ x: 10, y: 20, z: 30 }],
      first = (g: { children: unknown[] }) => asMesh(g.children[0]).geometry;
    for (const f of ['z+', 'z-', 'x+', 'x-', 'y+', 'y-'] as casekit3d.Facing[]) {
      expectHalf(first(casekit3d.screws(spot, f, 65, m)), `screws ${f}`);
      expectHalf(first(casekit3d.rivets(spot, f, 40, m)), `rivets ${f}`);
      expectHalf(first(casekit3d.thumbscrews(spot, f, 56, 64, m)), `thumbscrews ${f}`);
      const pad = first(casekit3d.pads(spot, f, 60, m));
      expect(lowOf(pad), `pads ${f}`).toBeDefined();
    }
  });

  it("a chip's gull-wing leg has the box round it as its level", () => {
    expectHalf(gullWing(8), 'gullWing');
  });

  it('a label draped over its parts has a level of three times the grain', () => {
    const bumps = [
      { r: { x: 60, y: 50, w: 420, h: 380 }, top: 26, fall: 40 },
      { r: { x: 620, y: 50, w: 520, h: 380 }, top: 22, fall: 40 },
    ];
    expectHalf(drape({ x: 0, y: 0, w: 1256, h: 478 }, 0, bumps, m, 24).geometry, 'drape');
    expect(
      lowOf(drape({ x: 0, y: 0, w: 1256, h: 478 }, 0, bumps, m, 24, true).geometry),
      'the flat label',
    ).toBeUndefined();
  });
});
