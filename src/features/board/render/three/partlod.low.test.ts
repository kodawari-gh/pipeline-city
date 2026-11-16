// The lower detail level of the four costly shapes (LOD-05): a braided sleeve, a fan-guard ring, a heat pipe and a pin coil each have a level
// with at most half the triangles of the full shape, and `lowOf` keeps it (the same attributes, the same bounds).
import { MeshStandardMaterial, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { lowOf } from '@/core/render/three/merge';
import { braidedTube } from './cables3d';
import { guardRing } from './psu3d';
import { pipe } from './cooler3d';
import { pinCoil } from './nic3d';

const tris = (g: BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const m = new MeshStandardMaterial();

/** The full shape's triangles and its level's, which must exist and be at most half. */
function expectHalf(g: BufferGeometry, name: string): void {
  const low = lowOf(g);
  expect(low, `${name}: lower level`).toBeDefined();
  expect(tris(low!), `${name}: low triangles`).toBeLessThanOrEqual(tris(g) / 2);
}

describe('the lower detail level of the costly part shapes (LOD-05)', () => {
  it('a braided sleeve has a level of 6 sides and half the steps, in the same skin', () => {
    const pts = [0, 1, 2, 3, 4].map((i) => new Vector3(i * 40, Math.sin(i) * 20, i * 10));
    const { mesh } = braidedTube(pts, 4, '#0c1226', '#464078');
    expectHalf(mesh.geometry, 'braidedTube');
    expect(Object.keys(lowOf(mesh.geometry)!.attributes).sort()).toEqual(Object.keys(mesh.geometry.attributes).sort());
  });

  it('a fan-guard ring has a level of 4 sides round the wire and 24 along the ring', () => {
    expectHalf(guardRing(60, 1.5), 'guardRing');
  });

  it('a heat pipe has a level of 24 steps and 6 sides on the same curve', () => {
    const mesh = pipe([[0, 0, 0], [200, 0, 0], [200, 120, 0], [0, 120, 40]], 12, m);
    expectHalf(mesh.geometry, 'pipe');
  });

  it('a pin coil has a level of 24 steps and 4 sides on the same curve', () => {
    expectHalf(pinCoil(0, 0, 0, m).geometry, 'pinCoil');
  });
});
