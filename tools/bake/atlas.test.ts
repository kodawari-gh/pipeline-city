import { describe, expect, it } from 'vitest';
import { buildAtlas, chartTexels, weld } from './atlas';

/** A box from `a` to `b` as loose triangles (no index), as `mergeStatic` leaves a merged mesh. */
function box(a: [number, number, number], b: [number, number, number]): Float32Array {
  const [x0, y0, z0] = a, [x1, y1, z1] = b, p = (x: number, y: number, z: number) => [x, y, z];
  const quads = [
    [p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0)], [p(x0, y0, z1), p(x0, y1, z1), p(x1, y1, z1), p(x1, y0, z1)],
    [p(x0, y0, z0), p(x0, y1, z0), p(x0, y1, z1), p(x0, y0, z1)], [p(x1, y0, z0), p(x1, y0, z1), p(x1, y1, z1), p(x1, y1, z0)],
    [p(x0, y0, z0), p(x0, y0, z1), p(x1, y0, z1), p(x1, y0, z0)], [p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)],
  ];
  return new Float32Array(quads.flatMap(([a, b, c, d]) => [...a!, ...b!, ...c!, ...a!, ...c!, ...d!]));
}

const area3 = (p: Float32Array, i: number) => {
  const u = [p[i + 3]! - p[i]!, p[i + 4]! - p[i + 1]!, p[i + 5]! - p[i + 2]!], v = [p[i + 6]! - p[i]!, p[i + 7]! - p[i + 1]!, p[i + 8]! - p[i + 2]!];
  return Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
};
const area2 = (uv: Float32Array, i: number, w: number, h: number) =>
  Math.abs((uv[i + 2]! - uv[i]!) * w * (uv[i + 5]! - uv[i + 1]!) * h - (uv[i + 4]! - uv[i]!) * w * (uv[i + 3]! - uv[i + 1]!) * h) / 2;

describe('weld', () => {
  it('joins the corners at one place', () => {
    const w = weld(box([0, 0, 0], [1, 1, 1]), null);
    expect(w.pos.length / 3).toBe(8);
    expect(w.index.length).toBe(36);
  });
});

describe('chartTexels', () => {
  // a triangle over the atlas's bottom left, 8 x 8 of 16 x 16 texels (v up: the bottom rows are the last)
  const uv = new Uint16Array([0, 0, 32768, 0, 0, 32768]);

  it('marks the texels under a triangle, rows from the top', () => {
    const k = chartTexels(uv, 16, 16, 0);
    expect(k[15 * 16 + 1]).toBe(1);
    expect(k[1]).toBe(0);
    expect(k[15 * 16 + 14]).toBe(0);
  });

  it('grows by the filter\'s reach, and no farther', () => {
    const k = chartTexels(uv, 16, 16, 2), row = (y: number) => [...k.subarray(y * 16, y * 16 + 16)];
    expect(row(15)[9]).toBe(1);
    expect(row(15)[11]).toBe(0);
    expect(row(6)[0]).toBe(1);
    expect(row(5)[0]).toBe(0);
  });
});

describe('buildAtlas', () => {
  it('gives each corner a UV in the atlas, in the triangles\' order, at the asked density', async () => {
    // a flat slab and a tall box: their triangles differ in size, so a shuffled order would not keep each one's area
    const meshes = [{ pos: box([0, 0, 0], [2, 0.1, 1]), index: null }, { pos: box([3, 0, 0], [3.4, 1.5, 0.4]), index: null }];
    const a = await buildAtlas(meshes, 40, 2);
    expect(a.width).toBeGreaterThan(0);
    for (const [k, m] of a.meshes.entries()) {
      expect(m.uv.length).toBe((meshes[k]!.pos.length / 3) * 2);
      for (const v of m.uv) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      for (let t = 0; t < m.uv.length / 6; t++) expect(area2(m.uv, 6 * t, a.width, a.height) / (area3(meshes[k]!.pos, 9 * t) * 40 * 40)).toBeCloseTo(1, 0);
    }
  });

  it('keeps the charts apart: no texel centre lies in two triangles', async () => {
    const a = await buildAtlas([{ pos: box([0, 0, 0], [1, 0.5, 0.7]), index: null }, { pos: box([2, 0, 0], [2.6, 0.6, 0.2]), index: null }], 32, 2);
    const hits = new Uint8Array(a.width * a.height);
    for (const m of a.meshes) {
      for (let t = 0; t < m.uv.length; t += 6) {
        const P = [0, 1, 2].map((j) => [m.uv[t + 2 * j]! * a.width, m.uv[t + 2 * j + 1]! * a.height] as const);
        const [x0, x1] = [Math.floor(Math.min(...P.map((p) => p[0]))), Math.ceil(Math.max(...P.map((p) => p[0])))];
        const [y0, y1] = [Math.floor(Math.min(...P.map((p) => p[1]))), Math.ceil(Math.max(...P.map((p) => p[1])))];
        const edge = (a: readonly number[], b: readonly number[], x: number, y: number) => (b[0]! - a[0]!) * (y - a[1]!) - (b[1]! - a[1]!) * (x - a[0]!);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const e = [edge(P[0]!, P[1]!, x + 0.5, y + 0.5), edge(P[1]!, P[2]!, x + 0.5, y + 0.5), edge(P[2]!, P[0]!, x + 0.5, y + 0.5)];
          if (e.every((v) => v > 1e-6) || e.every((v) => v < -1e-6)) hits[y * a.width + x]!++;
        }
      }
    }
    expect(Math.max(...hits)).toBe(1);
  });

  it('numbers the charts across the meshes', async () => {
    const a = await buildAtlas([{ pos: box([0, 0, 0], [1, 1, 1]), index: null }, { pos: box([2, 0, 0], [3, 1, 1]), index: null }], 16, 2);
    const first = new Set(a.meshes[0]!.chart), second = new Set(a.meshes[1]!.chart);
    for (const c of second) expect(first.has(c)).toBe(false);
    expect(first.has(0)).toBe(false);
  });
});
