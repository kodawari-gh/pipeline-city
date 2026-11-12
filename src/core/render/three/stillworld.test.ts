import { describe, expect, it, vi } from 'vitest';
import { Group, Mesh, Object3D, PerspectiveCamera, Scene } from 'three';
import { syncWorld } from './stillworld';

/** A small tree: a scene, a turned and scaled group, a moved mesh in it with a child, and a second group. */
function tree() {
  const scene = new Scene(), a = new Group(), b = new Mesh(), c = new Object3D(), d = new Group();
  a.position.set(10, 20, 30); a.rotation.set(0.3, -0.7, 1.1); a.scale.set(2, 2, 2);
  b.position.set(-5, 1, 4); b.rotation.y = 0.5;
  c.position.x = 7;
  d.position.z = -50;
  scene.add(a, d); a.add(b); b.add(c);
  return { scene, a, b, c, d };
}

/** The world matrices three's own update gives for the tree as it stands. */
function expected(scene: Scene): number[][] {
  const copy = scene.clone(true), out: number[][] = [];
  copy.updateMatrixWorld(true);
  copy.traverse((o) => out.push([...o.matrixWorld.elements]));
  return out;
}
const worlds = (scene: Scene): number[][] => { const out: number[][] = []; scene.traverse((o) => out.push([...o.matrixWorld.elements])); return out; };

describe('syncWorld', () => {
  it('gives the matrices of three\'s own update', () => {
    const { scene } = tree();
    const want = expected(scene);
    syncWorld(scene);
    expect(worlds(scene)).toEqual(want);
  });

  it('composes nothing for a tree that stands still', () => {
    const { scene, a, b, c, d } = tree();
    syncWorld(scene);
    const spies = [scene, a, b, c, d].map((o) => vi.spyOn(o, 'updateMatrix'));
    const w = vi.spyOn(c.matrixWorld, 'multiplyMatrices');
    syncWorld(scene);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(w).not.toHaveBeenCalled();
  });

  it('follows a move, a turn and a scale, with what is under them', () => {
    const { scene, a, b } = tree();
    syncWorld(scene);
    b.position.y += 3;
    syncWorld(scene);
    expect(worlds(scene)).toEqual(expected(scene));
    a.rotation.z += 0.2;
    syncWorld(scene);
    expect(worlds(scene)).toEqual(expected(scene));
    a.scale.setScalar(0.5);
    syncWorld(scene);
    expect(worlds(scene)).toEqual(expected(scene));
  });

  it('follows an object put under another parent, and a new one', () => {
    const { scene, b, d } = tree();
    syncWorld(scene);
    d.add(b);
    const n = new Mesh();
    n.position.x = 3;
    d.add(n);
    syncWorld(scene);
    expect(worlds(scene)).toEqual(expected(scene));
  });

  it('follows a part moved, updated by three and moved back between two calls', () => {
    const { scene, a, b } = tree();
    syncWorld(scene);
    b.position.x += 100; a.rotation.x += 1;
    scene.updateMatrixWorld(true);
    b.position.x -= 100; a.rotation.x -= 1;
    syncWorld(scene);
    expect(worlds(scene)).toEqual(expected(scene));
    b.position.x += 100;
    b.updateWorldMatrix(true, true);
    b.position.x -= 100;
    syncWorld(scene);
    expect(worlds(scene)).toEqual(expected(scene));
  });

  it('follows a matrix written by hand', () => {
    const { scene, d } = tree();
    const m = new Mesh();
    m.matrixAutoUpdate = false;
    d.add(m);
    syncWorld(scene);
    m.matrix.makeTranslation(1, 2, 3);
    syncWorld(scene);
    expect(m.matrixWorld.elements.slice(12, 15)).toEqual([1, 2, -47]);
  });

  it('leaves an object with an update of its own to it', () => {
    const { scene, a } = tree();
    const cam = new PerspectiveCamera();
    cam.position.set(1, 2, 3);
    a.add(cam);
    syncWorld(scene);
    expect(worlds(scene)).toEqual(expected(scene));
    // (the camera's own update keeps its inverse too)
    const copy = scene.clone(true);
    copy.updateMatrixWorld(true);
    let twin: PerspectiveCamera | null = null;
    copy.traverse((o) => { if ((o as PerspectiveCamera).isPerspectiveCamera) twin = o as PerspectiveCamera; });
    expect([...cam.matrixWorldInverse.elements]).toEqual([...twin!.matrixWorldInverse.elements]);
  });
});
