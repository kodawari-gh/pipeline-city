// The outline of every level 1 in the maxed machine (LOD-05, rule of LOD-01): a level draws only in the overview's stand-in, so its outline
// may move at most 1 px at the overview's limit (`LOD_OVERVIEW` px per unit). The outline is the shape's reach in 26 directions (the faces,
// edges and corners of a cube), in world units: the reach of a shape is the farthest of its vertices along a direction.
import { Matrix4, Vector3, type BufferGeometry, type InstancedMesh, type Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { lowOf } from '@/core/render/three/merge';
import { LOD_OVERVIEW } from '@/core/render/three/partlod';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

quietCanvas();

const DIRS = [-1, 0, 1]
  .flatMap((x) => [-1, 0, 1].flatMap((y) => [-1, 0, 1].map((z) => new Vector3(x, y, z))))
  .filter((d) => d.lengthSq() > 0)
  .map((d) => d.normalize());

/** The reach of `g` along each of `DIRS`, after `m`. */
function reach(g: BufferGeometry, m: Matrix4): number[] {
  const p = g.getAttribute('position'),
    v = new Vector3(),
    out = DIRS.map(() => -Infinity);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    DIRS.forEach((d, k) => {
      out[k] = Math.max(out[k]!, v.dot(d));
    });
  }
  return out;
}

describe('the levels of the maxed machine', () => {
  it('keep their outline within 1 px at the overview', () => {
    const machine = buildMachine(maxedSnapshot(), false, false),
      seen = new Set<BufferGeometry>(),
      px = 1 / LOD_OVERVIEW;
    machine.root.updateMatrixWorld(true);
    let levels = 0,
      worst = 0,
      where = '';
    const bad: string[] = [],
      path = (o: Object3D | null): string => {
        const s: string[] = [];
        for (; o; o = o.parent) if (o.userData.id || o.name) s.push(String(o.userData.id ?? o.name));
        return s.slice(0, 3).join(' < ');
      };
    machine.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || seen.has(mesh.geometry)) return;
      seen.add(mesh.geometry);
      const low = lowOf(mesh.geometry);
      if (!low) return;
      levels++;
      // (an instanced mesh: its first copy stands for the rest, as they share the geometry and differ only in place)
      const m = new Matrix4().copy(mesh.matrixWorld),
        inst = mesh as InstancedMesh;
      if (inst.isInstancedMesh) m.multiply(new Matrix4().fromArray(inst.instanceMatrix.array as Float32Array, 0));
      const a = reach(mesh.geometry, m),
        b = reach(low, m);
      const ds = a.map((r, k) => Math.abs(r - b[k]!)),
        d = Math.max(...ds),
        k = ds.indexOf(d);
      // (the levels past half a pixel, listed when the test fails: the shape, its vertices, the direction and where it is)
      if (d > px / 2)
        bad.push(
          `${d.toFixed(1)} ${mesh.geometry.type} ${mesh.geometry.getAttribute('position').count} ${DIRS[k]!.toArray().map((x) => x.toFixed(2))} ${path(o)}`,
        );
      if (d > worst) {
        worst = d;
        where = `${mesh.geometry.type} ${path(o)}`;
      }
    });
    expect(levels).toBeGreaterThan(20);
    expect(
      worst / px,
      `the worst: ${where}\n${bad.sort((x, y) => Number.parseFloat(y) - Number.parseFloat(x)).join('\n')}`,
    ).toBeLessThanOrEqual(1);
    machine.dispose();
  }, 60_000);
});
