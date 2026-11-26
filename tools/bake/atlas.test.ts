import { describe, expect, it } from 'vitest';
import { buildAtlas, chartTexels, weld } from './atlas';

type V3 = [number, number, number];
type V2 = readonly [number, number];

const p3 = (x: number, y: number, z: number): V3 => [x, y, z];

/** A box from `a` to `b` as loose triangles (no index), as `mergeStatic` leaves a merged mesh. */
function box(a: V3, b: V3): Float32Array {
  const [x0, y0, z0] = a,
    [x1, y1, z1] = b;
  const quads: [V3, V3, V3, V3][] = [
    [p3(x0, y0, z0), p3(x1, y0, z0), p3(x1, y1, z0), p3(x0, y1, z0)],
    [p3(x0, y0, z1), p3(x0, y1, z1), p3(x1, y1, z1), p3(x1, y0, z1)],
    [p3(x0, y0, z0), p3(x0, y1, z0), p3(x0, y1, z1), p3(x0, y0, z1)],
    [p3(x1, y0, z0), p3(x1, y0, z1), p3(x1, y1, z1), p3(x1, y1, z0)],
    [p3(x0, y0, z0), p3(x0, y0, z1), p3(x1, y0, z1), p3(x1, y0, z0)],
    [p3(x0, y1, z0), p3(x1, y1, z0), p3(x1, y1, z1), p3(x0, y1, z1)],
  ];
  return new Float32Array(quads.flatMap(([q0, q1, q2, q3]) => [q0, q1, q2, q0, q2, q3].flat()));
}

/** The item at `i` of a list the test built. */
function nth<T>(a: readonly T[], i: number): T {
  const v = a[i];
  if (v === undefined) {
    throw new Error(`no item ${i}`);
  }
  return v;
}

/** The number at `i` (the tests read within the arrays they built). */
const at = (a: ArrayLike<number>, i: number): number => a[i] ?? Number.NaN;

const area3 = (p: Float32Array, i: number) => {
  const u = [at(p, i + 3) - at(p, i), at(p, i + 4) - at(p, i + 1), at(p, i + 5) - at(p, i + 2)],
    v = [at(p, i + 6) - at(p, i), at(p, i + 7) - at(p, i + 1), at(p, i + 8) - at(p, i + 2)];
  return (
    Math.hypot(
      at(u, 1) * at(v, 2) - at(u, 2) * at(v, 1),
      at(u, 2) * at(v, 0) - at(u, 0) * at(v, 2),
      at(u, 0) * at(v, 1) - at(u, 1) * at(v, 0),
    ) / 2
  );
};

/** A UV triangle's area in texels: the triangle from `i` in `uv`, on an atlas of `size` (width, height). */
const area2 = (uv: Float32Array, i: number, [w, h]: V2) =>
  Math.abs(
    (at(uv, i + 2) - at(uv, i)) * w * (at(uv, i + 5) - at(uv, i + 1)) * h -
      (at(uv, i + 4) - at(uv, i)) * w * (at(uv, i + 3) - at(uv, i + 1)) * h,
  ) / 2;

/** Which side of the edge from `a` to `b` the point `q` is on (twice the signed area). */
const edge = ([a, b]: [V2, V2], [x, y]: V2) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);

/** Whether the texel centre `q` lies strictly inside the triangle `t` (either winding). */
function inside(t: [V2, V2, V2], q: V2): boolean {
  const e = [edge([t[0], t[1]], q), edge([t[1], t[2]], q), edge([t[2], t[0]], q)];
  return e.every((v) => v > 1e-6) || e.every((v) => v < -1e-6);
}

/** How many triangles of the atlas's meshes cover each texel centre. */
function coverage(a: Awaited<ReturnType<typeof buildAtlas>>): Uint8Array {
  const hits = new Uint8Array(a.width * a.height);
  for (const m of a.meshes) {
    for (let t = 0; t < m.uv.length; t += 6) {
      const corner = (j: number): V2 => [at(m.uv, t + 2 * j) * a.width, at(m.uv, t + 2 * j + 1) * a.height];
      const tri: [V2, V2, V2] = [corner(0), corner(1), corner(2)];
      const [x0, x1] = [Math.floor(Math.min(...tri.map((q) => q[0]))), Math.ceil(Math.max(...tri.map((q) => q[0])))];
      const [y0, y1] = [Math.floor(Math.min(...tri.map((q) => q[1]))), Math.ceil(Math.max(...tri.map((q) => q[1])))];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hits[y * a.width + x] = at(hits, y * a.width + x) + (inside(tri, [x + 0.5, y + 0.5]) ? 1 : 0);
        }
      }
    }
  }
  return hits;
}

describe('weld', () => {
  it('joins the corners at one place', () => {
    const w = weld(box([0, 0, 0], [1, 1, 1]), null);
    expect(w.pos.length / 3).toBe(8);
    expect(w.index).toHaveLength(36);
  });
});

describe('chartTexels', () => {
  // a triangle over the atlas's bottom left, 8 x 8 of 16 x 16 texels (v up: the bottom rows are the last)
  const uv = new Uint16Array([0, 0, 32_768, 0, 0, 32_768]);

  it('marks the texels under a triangle, rows from the top', () => {
    const k = chartTexels(uv, { width: 16, height: 16, grow: 0 });
    expect(k[15 * 16 + 1]).toBe(1);
    expect(k[1]).toBe(0);
    expect(k[15 * 16 + 14]).toBe(0);
  });

  it("grows by the filter's reach, and no farther", () => {
    const k = chartTexels(uv, { width: 16, height: 16, grow: 2 }),
      row = (y: number) => [...k.subarray(y * 16, y * 16 + 16)];
    expect(row(15)[9]).toBe(1);
    expect(row(15)[11]).toBe(0);
    expect(row(6)[0]).toBe(1);
    expect(row(5)[0]).toBe(0);
  });
});

describe('buildAtlas', () => {
  it("gives each corner a UV in the atlas, in the triangles' order, at the asked density", async () => {
    // a flat slab and a tall box: their triangles differ in size, so a shuffled order would not keep each one's area
    const meshes = [
      { pos: box([0, 0, 0], [2, 0.1, 1]), index: null },
      { pos: box([3, 0, 0], [3.4, 1.5, 0.4]), index: null },
    ];
    const a = await buildAtlas(meshes, 40, 2);
    expect(a.width).toBeGreaterThan(0);
    for (const [k, m] of a.meshes.entries()) {
      const { pos } = nth(meshes, k);
      expect(m.uv).toHaveLength((pos.length / 3) * 2);
      for (const v of m.uv) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      for (let t = 0; t < m.uv.length / 6; t++) {
        expect(area2(m.uv, 6 * t, [a.width, a.height]) / (area3(pos, 9 * t) * 40 * 40)).toBeCloseTo(1, 0);
      }
    }
  });

  it('keeps the charts apart: no texel centre lies in two triangles', async () => {
    const a = await buildAtlas(
      [
        { pos: box([0, 0, 0], [1, 0.5, 0.7]), index: null },
        { pos: box([2, 0, 0], [2.6, 0.6, 0.2]), index: null },
      ],
      32,
      2,
    );
    const hits = coverage(a);
    expect(Math.max(...hits)).toBe(1);
  });

  it('numbers the charts across the meshes', async () => {
    const a = await buildAtlas(
      [
        { pos: box([0, 0, 0], [1, 1, 1]), index: null },
        { pos: box([2, 0, 0], [3, 1, 1]), index: null },
      ],
      16,
      2,
    );
    const [m0, m1] = a.meshes,
      first = new Set(m0?.chart),
      second = new Set(m1?.chart);
    for (const c of second) {
      expect(first.has(c)).toBe(false);
    }
    expect(first.has(0)).toBe(false);
  });
});
