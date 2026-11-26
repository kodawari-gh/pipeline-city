import { assert, describe, expect, it } from 'vitest';
import { Box3, BufferAttribute, Vector3 } from 'three';
import type * as threeTypes from 'three';
import { frameLoft, ribbon, taperTube } from './loft';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The box round a geometry's points. */
function boxOf(g: threeTypes.BufferGeometry): Box3 {
  const a = g.attributes['position'];
  assert.instanceOf(a, BufferAttribute);
  return new Box3().setFromBufferAttribute(a);
}
/** The indices of an attribute's vertices. */
const indicesOf = (a: { count: number }) => Array.from({ length: a.count }, (_, i) => i);
/** How many of the bottom side's vertices are on the flat top step (z 150) and face +z. */
function upOnTopStep(g: threeTypes.BufferGeometry): number {
  const p = must(g.attributes['position']),
    n = must(g.attributes['normal']);
  return indicesOf(p).filter((i) => p.getZ(i) === 150 && n.getZ(i) > 0.9).length;
}
/** How many of the bottom side's vertices are on the outer wall (inset 0, below the top) and face -y. */
function outOnOuterWall(g: threeTypes.BufferGeometry): number {
  const p = must(g.attributes['position']),
    n = must(g.attributes['normal']);
  return indicesOf(p).filter((i) => p.getY(i) === -300 && p.getZ(i) === 0 && n.getY(i) < -0.9).length;
}
/** The tube's largest radius round the y axis at height `y`. */
function radiusAt(g: threeTypes.BufferGeometry, y: number): number {
  const p = must(g.attributes['position']);
  const radii = indicesOf(p)
    .filter((i) => Math.abs(p.getY(i) - y) < 1)
    .map((i) => Math.hypot(p.getX(i), p.getZ(i)));
  return Math.max(0, ...radii);
}

describe('frameLoft', () => {
  const profile = [
    [0, 0],
    [0, 100],
    [50, 150],
    [200, 150],
  ] as const;

  it('spans the rect and the profile height', () => {
    const b = boxOf(frameLoft(1000, 600, profile));
    expect(b.min.toArray()).toStrictEqual([-500, -300, 0]);
    expect(b.max.toArray()).toStrictEqual([500, 300, 150]);
  });

  it('faces out: the top step looks up, the outer wall looks out', () => {
    const g = frameLoft(1000, 600, profile);
    // the bottom side's vertices: the flat top step (z 150) faces +z, the outer wall (inset 0, below the top) faces -y
    expect(upOnTopStep(g)).toBeGreaterThan(0);
    expect(outOnOuterWall(g)).toBeGreaterThan(0);
  });

  it('caps the inner rect when asked', () => {
    const open = frameLoft(1000, 600, profile),
      shut = frameLoft(1000, 600, profile, { cap: true });
    expect(must(shut.index).count - must(open.index).count).toBe(6);
  });
});

describe('taperTube', () => {
  it('is thick at its start and thin at its end', () => {
    const g = taperTube(
      [
        [0, 0, 0],
        [0, 500, 0],
        [0, 1000, 0],
      ],
      100,
      20,
      8,
    );
    expect(radiusAt(g, 0)).toBeCloseTo(100, 0);
    expect(radiusAt(g, 1000)).toBeCloseTo(20, 0);
  });
});

describe('ribbon', () => {
  it('runs along its points, its width along up', () => {
    const b = boxOf(
      ribbon(
        [
          [0, 0, 0],
          [500, 0, 0],
          [1000, 0, 0],
        ],
        200,
      ),
    );
    expect(
      b
        .getSize(new Vector3())
        .toArray()
        .map((x) => Math.round(x)),
    ).toStrictEqual([1000, 200, 0]);
  });
});
