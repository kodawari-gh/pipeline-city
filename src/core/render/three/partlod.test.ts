import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, Raycaster, Vector3 } from 'three';
import { mat, own } from './materials';
import { LOD_BAND, LOD_PX, LOD_RADII, PartLod, drawnMeshes, farClasses, heldBy, lodSources, sizeClass, standInDraws } from './partlod';
import { UNDRAWN } from './pick';

const box = (s: number, m = mat(0x808080), x = 0) => { const o = new Mesh(new BoxGeometry(s, s, s), m); o.position.x = x; return o; };

/** A model: two parts of small still meshes, a skin over two meshes, a fade group, a rotor, a large panel. */
function model() {
  const root = new Group(), a = new Group(), b = new Group(), fade = new Group(), rotor = new Group(), skin = own(mat(0x204060));
  a.userData.id = 'a'; b.userData.id = 'b'; rotor.userData.spin = true;
  a.add(box(10, mat(0xff0000), 0), box(10, mat(0x00ff00), 40), box(12, skin, 80), box(12, skin, 120));
  b.add(box(10, mat(0x0000ff), 200), box(60, mat(0x333333), 300), box(60, mat(0x444444), 400));
  fade.add(box(10, mat(0x111111), 500), box(10, mat(0x222222), 540));
  rotor.add(box(10, mat(0x555555), 600), box(10, mat(0x666666), 640));
  const copies = new InstancedMesh(new BoxGeometry(8, 8, 8), mat(0x999999), 3);
  for (let i = 0; i < 3; i++) copies.setMatrixAt(i, new Matrix4().makeTranslation(700 + 30 * i, 0, 0));
  root.add(a, b, fade, rotor, copies, box(2000, mat(0xaaaaaa), -3000));
  return { root, a, b, fade, rotor, skin };
}

describe('the distance LOD rule (PERF6)', () => {
  it('sorts by world radius and switches each class with a dead band', () => {
    expect([10, 25, 26, 200, 201].map(sizeClass)).toEqual([0, 0, 1, 3, -1]);
    const at = LOD_PX / LOD_RADII[0];
    expect(farClasses(at * 0.99)[0]).toBe(true);
    expect(farClasses(at * 1.1, [false])[0]).toBe(false);
    expect(farClasses(at * 1.1, [true])[0]).toBe(true);
    expect(farClasses(at * (1 + LOD_BAND) * 1.01, [true])[0]).toBe(false);
    // a ceiling: no class far from it in, and the dead band stays under it
    expect(farClasses(0.05, [true, true, true, true], 0.05).some(Boolean)).toBe(false);
    expect(farClasses(0.05 / (1 + LOD_BAND) * 0.99, [], 0.05).every(Boolean)).toBe(true);
  });

  it('takes the small still meshes, by anchor, and leaves the rest', () => {
    const { root, fade } = model(), src = lodSources(root, { anchors: [fade] });
    expect(src.length).toBe(10); // (not the rotor's two, not the panel)
    expect(src.filter((s) => s.anchor === fade).length).toBe(2);
    expect(lodSources(root, { skip: [fade] }).length).toBe(8);
  });

  it('switches with a dead band, never flips at a steady zoom, and does no work at an unchanged zoom', () => {
    const { root, fade, a } = model(), lod = new PartLod(root, () => ({ anchors: [fade] })), at = LOD_PX / LOD_RADII[0], hi = at * (1 + LOD_BAND);
    const part = a.children[0] as Mesh, standIn = lod.standIns.find((s) => lod.sourcesOf(s).includes(part))!;
    const drawsAsStandIn = () => !(part.layers.mask & 1) && !!(standIn.layers.mask & 1);
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
    for (const z of [at * 0.99, at * 1.2]) for (let i = 0; i < 20; i++) lod.update(z); // a steady zoom: no flip
    expect(drawsAsStandIn()).toBe(true);
    // an unchanged zoom touches no layer
    part.layers.mask = 0b1000;
    standIn.layers.mask = 0b1000;
    lod.update(at * 1.2);
    expect(part.layers.mask).toBe(0b1000);
    expect(standIn.layers.mask).toBe(0b1000);
  });

  it('holds a part and all under it', () => {
    const { root, a } = model(), m = a.children[0]!;
    expect(heldBy(m, new Set([a]))).toBe(true);
    expect(heldBy(m, new Set([root.children[1]!]))).toBe(false);
    expect(standInDraws(true, [m], new Set([a]))).toBe(false);
    expect(standInDraws(false, [m], new Set())).toBe(false);
  });

  it('draws fewer meshes far, the same near, with the state material itself, and the parts still answer a ray', () => {
    const { root, a, fade, skin } = model(), near = drawnMeshes(root), lod = new PartLod(root, () => ({ anchors: [fade] }));
    expect(drawnMeshes(root)).toBe(near);
    lod.update(0.01);
    expect(lod.farNow.every(Boolean)).toBe(true);
    expect(drawnMeshes(root)).toBeLessThan(near - 4);
    // the skin's two meshes draw as one mesh with the skin itself; the fade's stand-in is under the fade
    expect(lod.standIns.some((s) => s.material === skin && lod.sourcesOf(s).length === 2)).toBe(true);
    expect(lod.standIns.filter((s) => s.parent === fade).length).toBe(1);
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
    a.children[0]!.visible = false;
    lod.update(0.01);
    expect(lod.standIns.every((s) => !lod.sourcesOf(s).includes(a.children[0] as Mesh))).toBe(true);
    a.children[0]!.visible = true;
    // near again, with the dead band; then freed
    lod.update(LOD_PX / LOD_RADII[0] * 2);
    expect(drawnMeshes(root)).toBe(near);
    lod.dispose();
    expect(lod.standIns.length).toBe(0);
    let left = 0;
    root.traverse((o) => { if (o.userData.standIn) left++; });
    expect(left).toBe(0);
  });
});
