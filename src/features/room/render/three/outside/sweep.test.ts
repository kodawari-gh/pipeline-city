import { BoxGeometry, BufferAttribute, BufferGeometry, Frustum, Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { ballOf, bearing, Sweep, sweptMerge } from './sweep';
import { GRID } from './plan';

/** Three unit boxes of 3 vertices each, at x = -100, 0 and 100, 50 m north of the window. */
function row(): { mesh: Mesh; sweep: Sweep } {
  const xs = [-100, 0, 100], pos: number[] = [];
  for (const x of xs) pos.push(x, 0, -50, x + 1, 0, -50, x, 1, -50);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  const mesh = new Mesh(g);
  return { mesh, sweep: new Sweep(xs.map((_, i) => ballOf(pos, 3 * i, 3 * i + 3)), [{ mesh, at: [0, 3, 6, 9] }]) };
}

/** A narrow camera at the origin, looking north (`dz` -1) or south (1). */
function frustum(dz = -1): Frustum {
  const c = new PerspectiveCamera(30, 1, 0.1, 1000);
  c.lookAt(0, 0, dz);
  c.updateMatrixWorld();
  return new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
}

describe('sweep', () => {
  it('measures the bearing from the window: 0 north, negative west', () => {
    expect(bearing(GRID.av0, -10)).toBeCloseTo(0);
    expect(bearing(GRID.av0 - 10, -10)).toBeLessThan(0);
    expect(bearing(GRID.av0 + 10, -10)).toBeGreaterThan(0);
  });

  it('balls the vertices it is given, and none as empty', () => {
    const b = ballOf([0, 0, 0, 2, 0, 0], 0, 2);
    expect(b.center.x).toBeCloseTo(1);
    expect(b.radius).toBeCloseTo(1);
    expect(ballOf([], 0, 0).radius).toBeLessThan(0);
  });

  it('draws only the run the camera sees, and all of it with no frustum', () => {
    const { mesh, sweep } = row();
    sweep.cut(frustum());
    expect(mesh.geometry.drawRange).toMatchObject({ start: 3, count: 3 });
    expect(mesh.visible).toBe(true);
    sweep.cut();
    expect(mesh.geometry.drawRange).toMatchObject({ start: 0, count: 9 });
  });

  it('merges the meshes on each material in bearing order, and leaves the rest', () => {
    const root = new Group(), paint = new MeshBasicMaterial(), stone = new MeshBasicMaterial();
    for (const x of [100, -100, 0]) { const m = new Mesh(new BoxGeometry(1, 1, 1), paint); m.position.set(GRID.av0 + x, 0, -50); root.add(m); }
    root.add(new Mesh(new BoxGeometry(1, 1, 1), stone));
    const [sw] = sweptMerge(root, [paint]);
    expect(root.children.map((o) => (o as Mesh).material)).toEqual([stone, paint]);
    const merged = root.children[1] as Mesh, pos = merged.geometry.attributes.position!;
    expect(pos.count).toBe(3 * 36);
    // west to east: the pieces at -100, 0 and +100 m
    expect([0, 36, 72].map((v) => Math.round((pos.getX(v) - GRID.av0) / 100) + 0)).toEqual([-1, 0, 1]);
    sw!.cut();
    expect(merged.geometry.drawRange).toMatchObject({ start: 0, count: 108 });
  });

  it('hides the mesh when the camera sees none of it', () => {
    const { mesh, sweep } = row();
    sweep.cut(frustum(1));
    expect(mesh.geometry.drawRange.count).toBe(0);
    expect(mesh.visible).toBe(false);
  });
});
