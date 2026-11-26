import { assert, describe, expect, it } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, Raycaster, Vector3 } from 'three';
import type * as threeTypes from 'three';
import { mat, own } from './materials';
import {
  LOD_BAND,
  LOD_OVERVIEW,
  LOD_PX,
  LOD_RADII,
  PartLod,
  drawnMeshes,
  farClasses,
  heldBy,
  lodSources,
  sizeClass,
  standInDraws,
} from './partlod';
import { UNDRAWN } from './pick';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const box = (s: number, m = mat(0x80_80_80), x = 0) => {
  const o = new Mesh(new BoxGeometry(s, s, s), m);
  o.position.x = x;
  return o;
};

const isMesh = (o: threeTypes.Object3D | undefined): o is Mesh => o instanceof Mesh;
/** The object as a mesh, failing the test when it is something else. */
function asMesh(o: threeTypes.Object3D | undefined): Mesh {
  assert(isMesh(o), 'expected a mesh');
  return o;
}
/** Whether the object draws (it is on the drawn layer, 0). */
const drawn = (o: threeTypes.Object3D) => (o.layers.mask & 1) === 1;
/** Whether the part is drawn by its stand-in: the part off the drawn layer, the stand-in on it. */
const standsIn = (part: threeTypes.Object3D, standIn: threeTypes.Object3D) => !drawn(part) && drawn(standIn);
/** How many stand-ins are left under `root`. */
function standInsUnder(root: threeTypes.Object3D): number {
  let left = 0;
  root.traverse((o) => {
    if (o.userData['standIn'] === true) {
      left++;
    }
  });
  return left;
}
/** A box whose x faces draw with the first material and its other faces with the second (as the RAM chips), at `x`. */
const twoMaterialBox = (m0: threeTypes.Material, m1: threeTypes.Material, x: number) => {
  const g = new BoxGeometry(10, 10, 10);
  g.clearGroups();
  g.addGroup(0, 12, 0);
  g.addGroup(12, 24, 1);
  const o = new Mesh(g, [m0, m1]);
  o.position.x = x;
  return o;
};

/** A model: two parts of small still meshes, a skin over two meshes, a fade group, a rotor, a large panel. */
function model() {
  const root = new Group(),
    a = new Group(),
    b = new Group(),
    fade = new Group(),
    rotor = new Group(),
    skin = own(mat(0x20_40_60));
  a.userData['id'] = 'a';
  b.userData['id'] = 'b';
  rotor.userData['spin'] = true;
  a.add(box(10, mat(0xff_00_00), 0), box(10, mat(0x00_ff_00), 40), box(12, skin, 80), box(12, skin, 120));
  b.add(box(10, mat(0x00_00_ff), 200), box(60, mat(0x33_33_33), 300), box(60, mat(0x44_44_44), 400));
  fade.add(box(10, mat(0x11_11_11), 500), box(10, mat(0x22_22_22), 540));
  rotor.add(box(10, mat(0x55_55_55), 600), box(10, mat(0x66_66_66), 640));
  const copies = new InstancedMesh(new BoxGeometry(8, 8, 8), mat(0x99_99_99), 3);
  for (let i = 0; i < 3; i++) {
    copies.setMatrixAt(i, new Matrix4().makeTranslation(700 + 30 * i, 0, 0));
  }
  root.add(a, b, fade, rotor, copies, box(2000, mat(0xaa_aa_aa), -3000));
  return { root, a, b, fade, rotor, skin };
}

describe('the distance LOD rule (PERF6)', () => {
  it('sorts by world radius and switches each class with a dead band', () => {
    // (a mesh over the last radius is in the overview's class, LPC5)
    expect([10, 25, 26, 200, 201].map((r) => sizeClass(r))).toStrictEqual([0, 0, 1, 3, 4]);
    expect(farClasses(LOD_OVERVIEW * 0.99)[4]).toBe(true);
    expect(farClasses(LOD_OVERVIEW * (1 + LOD_BAND) * 1.01, [true, true, true, true, true])[4]).toBe(false);
    const at = LOD_PX / LOD_RADII[0];
    expect(farClasses(at * 0.99)[0]).toBe(true);
    expect(farClasses(at * 1.1, [false])[0]).toBe(false);
    expect(farClasses(at * 1.1, [true])[0]).toBe(true);
    expect(farClasses(at * (1 + LOD_BAND) * 1.01, [true])[0]).toBe(false);
    // a ceiling: no class far from it in, and the dead band stays under it
    expect(farClasses(0.05, [true, true, true, true], 0.05).some(Boolean)).toBe(false);
    expect(farClasses((0.05 / (1 + LOD_BAND)) * 0.99, [], 0.05).every(Boolean)).toBe(true);
  });

  it('takes the small still meshes, by anchor, and leaves the rest', () => {
    const { root, fade } = model(),
      src = lodSources(root, { anchors: [fade] });
    expect(src).toHaveLength(11); // (not the rotor's two; the panel is in the overview's class)
    expect(src.filter((s) => s.cls === 4)).toHaveLength(1);
    expect(src.filter((s) => s.anchor === fade)).toHaveLength(2);
    expect(lodSources(root, { skip: [fade] })).toHaveLength(9);
  });

  it('switches with a dead band, never flips at a steady zoom, and does no work at an unchanged zoom', () => {
    const { root, fade, a } = model(),
      lod = new PartLod(root, () => ({ anchors: [fade] })),
      at = LOD_PX / LOD_RADII[0],
      hi = at * (1 + LOD_BAND);
    const part = asMesh(a.children[0]),
      standIn = must(lod.standIns.find((s) => lod.sourcesOf(s).includes(part)));
    const drawsAsStandIn = () => standsIn(part, standIn);
    lod.update(at * 1.5);
    expect(lod.farNow[0]).toBe(false);
    expect(drawsAsStandIn()).toBe(false);
    lod.update(at * 0.95); // just under the limit: far
    expect(lod.farNow[0]).toBe(true);
    expect(drawsAsStandIn()).toBe(true);
    lod.update(at * 1.1); // back over the limit, inside the band: stays far
    expect(drawsAsStandIn()).toBe(true);
    lod.update(hi * 1.01); // over the band: near
    expect(drawsAsStandIn()).toBe(false);
    lod.update(at * 1.1); // inside the band, coming from near: stays near
    expect(drawsAsStandIn()).toBe(false);
    for (const z of [at * 0.99, at * 1.2]) {
      for (let i = 0; i < 20; i++) {
        lod.update(z);
      }
    } // a steady zoom: no flip
    expect(drawsAsStandIn()).toBe(true);
    // an unchanged zoom touches no layer
    part.layers.mask = 0b1000;
    standIn.layers.mask = 0b1000;
    lod.update(at * 1.2);
    expect(part.layers.mask).toBe(0b1000);
    expect(standIn.layers.mask).toBe(0b1000);
  });

  it('holds a part and all under it', () => {
    const { root, a } = model(),
      m = must(a.children[0]),
      other = must(root.children[1]);
    expect(heldBy(m, new Set([a]))).toBe(true);
    expect(heldBy(m, new Set([other]))).toBe(false);
    expect(standInDraws(true, [m], new Set([a]))).toBe(false);
    expect(standInDraws(false, [m], new Set())).toBe(false);
  });

  it('draws fewer meshes far, the same near, with the state material itself, and the parts still answer a ray', () => {
    const { root, a, fade, skin } = model(),
      near = drawnMeshes(root),
      lod = new PartLod(root, () => ({ anchors: [fade] }));
    expect(drawnMeshes(root)).toBe(near);
    lod.update(0.01);
    expect(lod.farNow.every(Boolean)).toBe(true);
    expect(drawnMeshes(root)).toBeLessThan(near - 4);
    // the skin's two meshes draw as one mesh with the skin itself; the fade's stand-in is under the fade
    expect(lod.standIns.filter((s) => s.material === skin).some((s) => lod.sourcesOf(s).length === 2)).toBe(true);
    expect(lod.standIns.filter((s) => s.parent === fade)).toHaveLength(1);
    // a ray on the undrawn layer finds the part, never a stand-in
    const ray = new Raycaster(new Vector3(0, 0, 500), new Vector3(0, 0, -1));
    ray.layers.enable(UNDRAWN);
    root.updateMatrixWorld(true);
    expect(ray.intersectObject(root, true)[0]?.object).toBe(a.children[0]);
    // a held part: its stand-ins go back to the parts; the others stay
    const far = drawnMeshes(root);
    lod.hold([a]);
    expect(a.children.every((c) => c.layers.mask === 1)).toBe(true);
    expect(drawnMeshes(root)).toBeGreaterThan(far);
    lod.hold([]);
    expect(drawnMeshes(root)).toBe(far);
    // a hidden part since the build: its anchor is built again without it
    must(a.children[0]).visible = false;
    lod.update(0.01);
    const hidden = asMesh(a.children[0]);
    expect(lod.standIns.every((s) => !lod.sourcesOf(s).includes(hidden))).toBe(true);
    must(a.children[0]).visible = true;
    // near again, with the dead band; then freed
    lod.update((LOD_PX / LOD_RADII[0]) * 2);
    expect(drawnMeshes(root)).toBe(near);
    lod.dispose();
    expect(lod.standIns).toHaveLength(0);
    expect(standInsUnder(root)).toBe(0);
  });

  it('splits a mesh of two materials over two stand-ins, holds them together, and leaves a lone one as it is (MACH-06)', () => {
    // a box whose x faces draw with the first material and its other faces with the second (`twoMaterialBox`)
    const root = new Group(),
      c = new Group(),
      d = new Group(),
      skin = own(mat(0x20_40_60)),
      m = twoMaterialBox(mat(0xff_00_00), skin, 0),
      x = box(10, mat(0x00_ff_00), 40),
      y = box(10, skin, 80);
    const lone = twoMaterialBox(own(mat(0x10_10_10)), own(mat(0x20_20_20)), 120);
    c.userData['id'] = 'c';
    d.userData['id'] = 'd';
    c.add(m, x, lone);
    d.add(y);
    root.add(c, d);
    expect(lodSources(root).map((s) => s.mesh)).toContain(m);
    expect(lodSources(root).map((s) => s.mesh)).toContain(lone);
    const lod = new PartLod(root);
    lod.update(0.01);
    // the red faces join the green box, the skin's faces the skin's box: two stand-ins draw for the three meshes, with every triangle
    const of = (o: Mesh) => lod.standIns.filter((s) => lod.sourcesOf(s).includes(o));
    expect(of(m)).toHaveLength(2);
    expect(
      of(m)
        .map((s) => must(s.geometry.attributes['position']).count)
        .toSorted((p, q) => p - q),
    ).toStrictEqual([36 + 12, 36 + 24]);
    expect(of(m).find((s) => s.material === skin)).toBeDefined();
    expect([m, x, y].every((o) => !(o.layers.mask & 1))).toBe(true);
    // the lone two-material mesh joins nothing and draws as it is
    expect(of(lone)).toHaveLength(0);
    expect(lone.layers.mask & 1).toBe(1);
    expect(drawnMeshes(root)).toBe(3);
    // a held box sends its stand-in back, and with it the other stand-in of the split mesh: the split mesh draws whole
    lod.hold([d]);
    expect(of(m).every((s) => lod.held(s))).toBe(true);
    expect(of(m).every((s) => !drawn(s))).toBe(true);
    expect([m, x, y].every((o) => o.layers.mask & 1)).toBe(true);
    lod.hold([]);
    expect([m, x, y].every((o) => !(o.layers.mask & 1))).toBe(true);
    lod.dispose();
    expect([m, x, y, lone].every((o) => o.layers.mask & 1)).toBe(true);
  });
});
