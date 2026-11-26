// The shared builders' lower detail level (LOD-05): each gives one with fewer triangles in the same space, and `lowOf` drops a level that
// no longer fits its geometry.
import { BufferAttribute, MeshStandardMaterial } from 'three';
import type * as threeTypes from 'three';
import { describe, expect, it } from 'vitest';
import { drum, post, rod, softBox, tube } from './geometry';
import { lowOf } from './merge';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const tris = (g: threeTypes.BufferGeometry): number =>
  (g.index ? g.index.count : must(g.attributes['position']).count) / 3;
const m = new MeshStandardMaterial();

describe('the lower detail level of the shared builders', () => {
  it('a soft box, a post, a drum, a rod and a tube each carry a level with fewer triangles', () => {
    const made = {
      softBox: softBox({ x: 0, y: 0, w: 400, h: 300 }, 0, 200, m),
      post: post(0, 0, 0, 50, 300, m, 24),
      drum: drum(0, 0, 0, 40, 100, m, 32),
      rod: rod([0, 0, 0], [300, 200, 100], 20, m, 16),
      tube: tube(
        [
          [0, 0, 0],
          [200, 100, 0],
          [400, 0, 100],
        ],
        15,
        m,
        8,
      ),
    };
    for (const [name, o] of Object.entries(made)) {
      const low = lowOf(o.geometry);
      expect(low, `${name}: a level`).toBeDefined();
      expect(tris(must(low)), `${name}: triangles`).toBeLessThanOrEqual(tris(o.geometry) / 2);
    }
    // a radius of 40 is too round for the plain box (`LOW_TOL`): a chamfer in place of 300 triangles of soft edge; a radius of 6 is the plain box
    const round = must(lowOf(made.softBox.geometry)),
      slight = softBox({ x: 0, y: 0, w: 400, h: 300 }, 0, 200, m, 6);
    const plain = must(lowOf(slight.geometry));
    expect(tris(round)).toBe(108);
    expect(tris(plain)).toBe(12);
  });

  it('a round shape with no fewer sides to give has no level', () => {
    expect(lowOf(post(0, 0, 0, 50, 300, m, 8).geometry)).toBeUndefined();
    expect(lowOf(rod([0, 0, 0], [0, 100, 0], 5, m, 6).geometry)).toBeUndefined();
  });

  it('a level no longer counts once its geometry moved, or took an attribute the level has not', () => {
    const moved = softBox({ x: 0, y: 0, w: 400, h: 300 }, 0, 200, m);
    moved.geometry.translate(500, 0, 0);
    expect(lowOf(moved.geometry)).toBeUndefined();
    const baked = softBox({ x: 0, y: 0, w: 400, h: 300 }, 0, 200, m);
    const corners = must(baked.geometry.attributes['position']).count;
    baked.geometry.setAttribute('_ao', new BufferAttribute(new Float32Array(corners), 1));
    expect(lowOf(baked.geometry)).toBeUndefined();
  });
});
