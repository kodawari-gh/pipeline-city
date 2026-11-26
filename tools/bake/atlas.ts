// The light bake's lightmap UVs (`src/features/room/light.md`, "Offline bakes"): xatlas cuts every receiver into charts and packs them all in
// one atlas. The result is a UV for each corner of each triangle, in the triangles' own order, so the game adds it to a mesh as it is built
// (an indexed mesh first loses its index) and Blender bakes into the same place. Node only (`bake.mjs`).
import createXAtlas from 'xatlas-wasm';

/** A receiver: its positions (metres) and its triangles (null: each three positions are one). */
export interface AtlasInput {
  pos: Float32Array;
  index: Uint32Array | null;
}
export interface Atlas {
  width: number;
  height: number;
  /** For each mesh: a UV for each corner (0 to 1, v up as a texture's), and its chart (a number across the whole atlas). */
  meshes: { uv: Float32Array; chart: Uint32Array }[];
  utilization: number;
}

/** The number at `i` of an array the caller indexes within its length. */
const num = (a: ArrayLike<number>, i: number): number => a[i] ?? 0;

/**
 * Join the corners that sit at the same place (to a tenth of a millimetre), so xatlas sees the surface whole and cuts it only where it must.
 * Returns the joined positions and each corner's point.
 */
export function weld(pos: Float32Array, index: Uint32Array | null): { pos: Float32Array; index: Uint32Array } {
  const corners = index ? index.length : pos.length / 3,
    at = new Map<string, number>(),
    out: number[] = [],
    idx = new Uint32Array(corners);
  for (let c = 0; c < corners; c++) {
    const v = index ? num(index, c) : c,
      x = num(pos, 3 * v),
      y = num(pos, 3 * v + 1),
      z = num(pos, 3 * v + 2),
      key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let k = at.get(key);
    if (k === undefined) {
      k = out.length / 3;
      at.set(key, k);
      out.push(x, y, z);
    }
    idx[c] = k;
  }
  return { pos: new Float32Array(out), index: idx };
}

/** A point in texels. */
interface Pt {
  x: number;
  y: number;
}

/** The atlas's size in texels and how far (texels) round a triangle a texel can still be read. */
export interface TexelGrid {
  width: number;
  height: number;
  grow: number;
}

/** Whether `p` is within `grow` of the segment from `a` to `b`. */
function near(p: Pt, [a, b]: [Pt, Pt], grow: number): boolean {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy,
    t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return (a.x + t * dx - p.x) ** 2 + (a.y + t * dy - p.y) ** 2 <= grow * grow;
}

/** Whether `p` is inside the triangle `a`, `b`, `c` (either winding) or within `grow` of its edges. */
function covers(p: Pt, [a, b, c]: [Pt, Pt, Pt], grow: number): boolean {
  const w0 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x),
    w1 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x),
    w2 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  return (
    (w0 >= 0 && w1 >= 0 && w2 >= 0) ||
    (w0 <= 0 && w1 <= 0 && w2 <= 0) ||
    near(p, [a, b], grow) ||
    near(p, [b, c], grow) ||
    near(p, [c, a], grow)
  );
}

/**
 * The texels the receivers can read (1, rows from the top): those under a triangle or within `grow` texels of one, for the bilinear filter's
 * reach. `uv` holds two Uint16 a corner (`meshes.bin`: v up), three corners a triangle.
 */
export function chartTexels(uv: Uint16Array, { width, height, grow }: TexelGrid): Uint8Array {
  const out = new Uint8Array(width * height),
    corner = (i: number): Pt => ({ x: (num(uv, i) / 65_535) * width, y: (1 - num(uv, i + 1) / 65_535) * height });
  for (let i = 0; i + 5 < uv.length; i += 6) {
    const a = corner(i),
      b = corner(i + 2),
      c = corner(i + 4);
    const x1 = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x) + grow)),
      y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y) + grow)),
      x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x) - grow - 1));
    for (let y = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y) - grow - 1)); y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = y * width + x;
        if (out[k] === 0 && covers({ x: x + 0.5, y: y + 0.5 }, [a, b, c], grow)) {
          out[k] = 1;
        }
      }
    }
  }
  return out;
}

/** The charts are numbered in each mesh: number them across the atlas (0 stays: no chart). */
function numberAcross(meshes: Atlas['meshes']): void {
  let base = 0;
  for (const m of meshes) {
    let top = 0;
    for (let c = 0; c < m.chart.length; c++) {
      const k = num(m.chart, c);
      if (k > 0) {
        top = Math.max(top, k);
        m.chart[c] = k + base;
      }
    }
    base += top;
  }
}

/** The atlas of the receivers at `texelsPerMetre`, `padding` texels round each chart. */
export async function buildAtlas(meshes: AtlasInput[], texelsPerMetre: number, padding: number): Promise<Atlas> {
  const xatlas = await createXAtlas(),
    atlas = xatlas.createAtlas();
  try {
    for (const m of meshes) {
      const w = weld(m.pos, m.index),
        err = atlas.addMesh({ positions: w.pos, indices: w.index, meshCountHint: meshes.length });
      if (err) {
        throw new Error(`xatlas: ${xatlas.addMeshErrorString(err)}`);
      }
    }
    atlas.generate({}, { padding, texelsPerUnit: texelsPerMetre, bilinear: true, bruteForce: true });
    if (atlas.atlasCount !== 1) {
      throw new Error(`xatlas made ${atlas.atlasCount} atlases`);
    }
    const W = atlas.width,
      H = atlas.height;
    const out = meshes.map((m, i) => {
      const r = atlas.getMesh(i),
        corners = m.index ? m.index.length : m.pos.length / 3;
      if (r.indexCount !== corners) {
        throw new Error(`xatlas: mesh ${i} has ${r.indexCount} corners, not ${corners}`);
      }
      const uv = new Float32Array(2 * corners),
        chart = new Uint32Array(corners);
      for (let c = 0; c < corners; c++) {
        const v = r.vertices[num(r.indices, c)];
        if (!v) {
          throw new Error(`xatlas: mesh ${i} has no vertex for corner ${c}`);
        }
        uv[2 * c] = v.uv[0] / W;
        uv[2 * c + 1] = v.uv[1] / H;
        chart[c] = v.chartIndex < 0 ? 0 : v.chartIndex + 1;
      }
      return { uv, chart };
    });
    numberAcross(out);
    return { width: W, height: H, meshes: out, utilization: atlas.getUtilization(0) };
  } finally {
    atlas.destroy();
  }
}
