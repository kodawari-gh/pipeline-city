import { describe, expect, it } from 'vitest';
import { bakeCloth, freeEdges, type ClothBake } from './bake';
import { assemble, type Piece } from './pattern';
import { sphere } from './solid';

/** A flat square `s` mm wide, laid by `place`. */
const square = (name: string, s: number, place: Piece['place']): Piece => ({
  name,
  edges: [
    { name: 'bottom', pts: [[0, 0], [s, 0]] }, { name: 'right', pts: [[s, 0], [s, s]] },
    { name: 'top', pts: [[s, s], [0, s]] }, { name: 'left', pts: [[0, s], [0, 0]] },
  ],
  place,
});

/** The first primitive's positions out of a GLB. */
function positions(bytes: Uint8Array): Float32Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jl))) as {
    meshes: { primitives: { attributes: { POSITION: number } }[] }[]; accessors: { bufferView: number; count: number }[]; bufferViews: { byteOffset: number }[];
  };
  const acc = json.accessors[json.meshes[0]!.primitives[0]!.attributes.POSITION]!, at = 28 + jl + json.bufferViews[acc.bufferView]!.byteOffset;
  return new Float32Array(bytes.slice(at, at + 12 * acc.count).buffer);
}

describe('cloth bake', () => {
  it('finds the free edges: one loop round a piece, one round two pieces sewn side by side', () => {
    const one = assemble({ pieces: [square('a', 100, (x, y) => [x, y, 0])], seams: [], materials: ['c'] }, 20);
    const l1 = freeEdges(one);
    expect(l1).toHaveLength(1);
    expect(l1[0]!.closed).toBe(true);
    expect(l1[0]!.pts).toHaveLength(20);
    const two = assemble({
      pieces: [square('a', 100, (x, y) => [x, y, 0]), square('b', 100, (x, y) => [x + 100, y, 0])],
      seams: [{ a: ['a', 'right'], b: ['b', 'left'], flip: true }], materials: ['c'],
    }, 20);
    const l2 = freeEdges(two);
    expect(l2).toHaveLength(1);
    expect(l2[0]!.pts).toHaveLength(30);
  });

  it('bakes a model whose smoothed cloth stays off the solid it lies on', () => {
    const ball = sphere(0, 0, 0, 80);
    const b: ClothBake = {
      name: 'test', garment: { pieces: [square('a', 300, (x, y) => [x - 150, 100, y - 150])], seams: [], materials: ['c'] }, h: 20,
      params: { rate: 1000, thickness: 3, self: 8, stretch: 1e-7, bend: 2e-4, friction: [0.6, 0.4] },
      phases: [{ label: 'drop', time: 1, gravity: 9810, solid: ball, sew: Infinity, keep: 0.1 }], tile: 100, rim: 0, smooth: 3,
    };
    const lines: string[] = [], p = positions(bakeCloth(b, (l) => lines.push(l)));
    expect(lines[0]).toMatch(/^test: \d+ points/);
    expect(p.length).toBeGreaterThan(0);
    for (let i = 0; i < p.length; i += 3) expect(ball(p[i]!, p[i + 1]!, p[i + 2]!)).toBeGreaterThan(2.5);
  });
});
