// The outline of every level 1 in the maxed machine (LOD-05, rule of LOD-01): a level draws only in the overview's stand-in, so its outline
// may move at most 1 px at the overview's limit (`LOD_OVERVIEW` px per unit). The outline is the shape's reach in 26 directions (the faces,
// edges and corners of a cube), in world units: the reach of a shape is the farthest of its vertices along a direction.
import * as three from 'three';
import { describe, expect, it } from 'vitest';
import { lowOf } from '@/core/render/three/merge';
import { LOD_OVERVIEW } from '@/core/render/three/partlod';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;

const isInstancedMesh = (o: unknown): o is three.InstancedMesh =>
  typeof o === 'object' && o !== null && 'isInstancedMesh' in o && o.isInstancedMesh === true;

quietCanvas();

const DIRS = [-1, 0, 1]
  .flatMap((x) => [-1, 0, 1].flatMap((y) => [-1, 0, 1].map((z) => new three.Vector3(x, y, z))))
  .filter((d) => d.lengthSq() > 0)
  .map((d) => d.normalize());

/** The reach of `g` along each of `DIRS`, after `m`. */
function reach(g: three.BufferGeometry, m: three.Matrix4): number[] {
  const p = g.getAttribute('position'),
    v = new three.Vector3(),
    out = DIRS.map(() => -Infinity);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    for (const [k, d] of DIRS.entries()) {
      out[k] = Math.max(must(out[k]), v.dot(d));
    }
  }
  return out;
}

/** Where an object is: the ids or names of it and its first parents, for the failure list. */
function path(start: three.Object3D | null): string {
  const s: string[] = [];
  for (let o = start; o !== null; o = o.parent) {
    const id: unknown = o.userData['id'];
    const label = typeof id === 'string' && id !== '' ? id : o.name;
    if (label !== '') {
      s.push(label);
    }
  }
  return s.slice(0, 3).join(' < ');
}

function assert_keep_their_outline_within_1_px_at_the_overview(): void {
  const machine = buildMachine(maxedSnapshot(), false, false),
    seen = new Set<three.BufferGeometry>(),
    px = 1 / LOD_OVERVIEW;
  machine.root.updateMatrixWorld(true);
  let levels = 0,
    worst = 0,
    where = '';
  const bad: string[] = [];
  machine.root.traverse((o) => {
    if (!isMesh(o)) {
      return;
    }
    const mesh = o;
    if (seen.has(mesh.geometry)) {
      return;
    }
    seen.add(mesh.geometry);
    const low = lowOf(mesh.geometry);
    if (!low) {
      return;
    }
    levels++;
    // (an instanced mesh: its first copy stands for the rest, as they share the geometry and differ only in place)
    const m = new three.Matrix4().copy(mesh.matrixWorld);
    if (isInstancedMesh(mesh)) {
      m.multiply(new three.Matrix4().fromArray(mesh.instanceMatrix.array, 0));
    }
    const a = reach(mesh.geometry, m),
      b = reach(low, m);
    const ds = a.map((r, k) => Math.abs(r - must(b[k]))),
      d = Math.max(...ds),
      k = ds.indexOf(d);
    // (the levels past half a pixel, listed when the test fails: the shape, its vertices, the direction and where it is)
    if (d > px / 2) {
      bad.push(
        `${d.toFixed(1)} ${mesh.geometry.type} ${mesh.geometry.getAttribute('position').count} ${must(DIRS[k])
          .toArray()
          .map((x) => x.toFixed(2))
          .join(',')} ${path(o)}`,
      );
    }
    if (d > worst) {
      worst = d;
      where = `${mesh.geometry.type} ${path(o)}`;
    }
  });
  expect(levels).toBeGreaterThan(20);
  expect(
    worst / px,
    `the worst: ${where}\n${bad.toSorted((x, y) => Number(y) - Number(x)).join('\n')}`,
  ).toBeLessThanOrEqual(1);
  machine.dispose();
}

describe('the levels of the maxed machine', () => {
  it('keep their outline within 1 px at the overview', () => {
    expect.hasAssertions();
    assert_keep_their_outline_within_1_px_at_the_overview();
  }, 60_000);
});
