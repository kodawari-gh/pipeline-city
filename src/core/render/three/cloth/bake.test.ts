import { assert, describe, expect, it } from 'vitest';
import { bakeCloth, freeEdges } from './bake';
import type * as bakeTypes from './bake';
import { assemble } from './pattern';
import type * as patternTypes from './pattern';
import { sphere } from './solid';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A flat square `s` mm wide, laid by `place`. */
const square = (name: string, s: number, place: patternTypes.Piece['place']): patternTypes.Piece => ({
  name,
  edges: [
    {
      name: 'bottom',
      pts: [
        [0, 0],
        [s, 0],
      ],
    },
    {
      name: 'right',
      pts: [
        [s, 0],
        [s, s],
      ],
    },
    {
      name: 'top',
      pts: [
        [s, s],
        [0, s],
      ],
    },
    {
      name: 'left',
      pts: [
        [0, s],
        [0, 0],
      ],
    },
  ],
  place,
});

/** The parts of a GLB's JSON chunk this test reads. */
interface GltfJson {
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: { bufferView: number; count: number }[];
  bufferViews: { byteOffset: number }[];
}
const isGltf = (v: unknown): v is GltfJson =>
  typeof v === 'object' && v !== null && 'meshes' in v && 'accessors' in v && 'bufferViews' in v;
/** The occlusion of each side, summed over the points within `r` of the axis (the cloth's top over the ball), and how many there are. */
function sidesOver(p: Float32Array, ao: Float32Array, r: number): { front: number; back: number; top: number } {
  let top = 0,
    front = 0,
    back = 0;
  for (let i = 0; i < p.length / 3; i++) {
    if (Math.hypot(must(p[3 * i]), must(p[3 * i + 2])) < r) {
      front += must(ao[2 * i]);
      back += must(ao[2 * i + 1]);
      top++;
    }
  }
  return { front, back, top };
}

/** The first primitive's attribute `name` (`size` floats a vertex) out of a GLB. */
function attribute(bytes: Uint8Array, name: string, size: number): Float32Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    jl = dv.getUint32(12, true);
  const json: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jl)));
  assert(isGltf(json), 'the GLB has its JSON chunk');
  const prim = must(must(json.meshes[0]).primitives[0]),
    acc = must(json.accessors[must(prim.attributes[name])]),
    at = 28 + jl + must(json.bufferViews[acc.bufferView]).byteOffset;
  return new Float32Array(bytes.slice(at, at + 4 * size * acc.count).buffer);
}

describe('cloth bake', () => {
  it('finds the free edges: one loop round a piece, one round two pieces sewn side by side', () => {
    const one = assemble({ pieces: [square('a', 100, (x, y) => [x, y, 0])], seams: [], materials: ['c'] }, 20);
    const l1 = freeEdges(one);
    expect(l1).toHaveLength(1);
    expect(must(l1[0]).closed).toBe(true);
    expect(must(l1[0]).pts).toHaveLength(20);
    const two = assemble(
      {
        pieces: [square('a', 100, (x, y) => [x, y, 0]), square('b', 100, (x, y) => [x + 100, y, 0])],
        seams: [{ a: ['a', 'right'], b: ['b', 'left'], flip: true }],
        materials: ['c'],
      },
      20,
    );
    const l2 = freeEdges(two);
    expect(l2).toHaveLength(1);
    expect(must(l2[0]).pts).toHaveLength(30);
  });

  it('bakes a model whose smoothed cloth stays off the solid it lies on, darker on the side that faces it', () => {
    const ball = sphere(0, 0, 0, 80);
    const b: bakeTypes.ClothBake = {
      name: 'test',
      garment: { pieces: [square('a', 300, (x, y) => [x - 150, 100, y - 150])], seams: [], materials: ['c'] },
      h: 20,
      params: { rate: 1000, thickness: 3, self: 8, stretch: 1e-7, bend: 2e-4, friction: [0.6, 0.4] },
      phases: [{ label: 'drop', time: 1, gravity: 9810, solid: ball, sew: Infinity, keep: 0.1 }],
      tile: 100,
      rim: 0,
      smooth: 3,
      ao: 30,
    };
    const lines: string[] = [],
      bytes = bakeCloth(b, (l) => {
        lines.push(l);
      }),
      p = attribute(bytes, 'POSITION', 3),
      ao = attribute(bytes, '_AO', 2);
    expect(lines[0]).toMatch(/^test: \d+ points/u);
    expect(p.length).toBeGreaterThan(0);
    for (let i = 0; i < p.length; i += 3) {
      expect(ball(must(p[i]), must(p[i + 1]), must(p[i + 2]))).toBeGreaterThan(2.5);
    }
    // the cloth's top over the ball: one side lies on it, the other is open
    const { front, back, top } = sidesOver(p, ao, 40);
    const [shut, open] = [Math.min(front, back) / top, Math.max(front, back) / top];
    expect(shut).toBeLessThan(0.4);
    expect(open).toBeGreaterThan(0.9);
  });
});
