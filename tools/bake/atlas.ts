// The light bake's lightmap UVs (`src/features/room/light.md`, "Offline bakes"): xatlas cuts every receiver into charts and packs them all in
// one atlas. The result is a UV for each corner of each triangle, in the triangles' own order, so the game adds it to a mesh as it is built
// (an indexed mesh first loses its index) and Blender bakes into the same place. Node only (`bake.mjs`).
import createXAtlas from 'xatlas-wasm';

/** A receiver: its positions (metres) and its triangles (null: each three positions are one). */
export interface AtlasInput { pos: Float32Array; index: Uint32Array | null }
export interface Atlas {
  width: number;
  height: number;
  /** For each mesh: a UV for each corner (0 to 1, v up as a texture's), and its chart (a number across the whole atlas). */
  meshes: { uv: Float32Array; chart: Uint32Array }[];
  utilization: number;
}

/**
 * Join the corners that sit at the same place (to a tenth of a millimetre), so xatlas sees the surface whole and cuts it only where it must.
 * Returns the joined positions and each corner's point.
 */
export function weld(pos: Float32Array, index: Uint32Array | null): { pos: Float32Array; index: Uint32Array } {
  const corners = index ? index.length : pos.length / 3, at = new Map<string, number>(), out: number[] = [], idx = new Uint32Array(corners);
  for (let c = 0; c < corners; c++) {
    const v = index ? index[c]! : c, key = `${Math.round(pos[3 * v]! * 1e4)},${Math.round(pos[3 * v + 1]! * 1e4)},${Math.round(pos[3 * v + 2]! * 1e4)}`;
    let k = at.get(key);
    if (k === undefined) { k = out.length / 3; at.set(key, k); out.push(pos[3 * v]!, pos[3 * v + 1]!, pos[3 * v + 2]!); }
    idx[c] = k;
  }
  return { pos: new Float32Array(out), index: idx };
}

/** The atlas of the receivers at `texelsPerMetre`, `padding` texels round each chart. */
export async function buildAtlas(meshes: AtlasInput[], texelsPerMetre: number, padding: number): Promise<Atlas> {
  const xatlas = await createXAtlas(), atlas = xatlas.createAtlas();
  try {
    for (const m of meshes) {
      const w = weld(m.pos, m.index), err = atlas.addMesh({ positions: w.pos, indices: w.index, meshCountHint: meshes.length });
      if (err) throw new Error(`xatlas: ${xatlas.addMeshErrorString(err)}`);
    }
    atlas.generate({}, { padding, texelsPerUnit: texelsPerMetre, bilinear: true, bruteForce: true });
    if (atlas.atlasCount !== 1) throw new Error(`xatlas made ${atlas.atlasCount} atlases`);
    const W = atlas.width, H = atlas.height;
    const out = meshes.map((m, i) => {
      const r = atlas.getMesh(i), corners = m.index ? m.index.length : m.pos.length / 3;
      if (r.indexCount !== corners) throw new Error(`xatlas: mesh ${i} has ${r.indexCount} corners, not ${corners}`);
      const uv = new Float32Array(2 * corners), chart = new Uint32Array(corners);
      for (let c = 0; c < corners; c++) {
        const v = r.vertices[r.indices[c]!]!;
        uv[2 * c] = v.uv[0] / W;
        uv[2 * c + 1] = v.uv[1] / H;
        chart[c] = v.chartIndex < 0 ? 0 : v.chartIndex + 1;
      }
      return { uv, chart };
    });
    // the charts are numbered in each mesh: number them across the atlas
    let base = 0;
    for (const m of out) {
      let top = 0;
      for (let c = 0; c < m.chart.length; c++) if (m.chart[c]) { top = Math.max(top, m.chart[c]!); m.chart[c] = m.chart[c]! + base; }
      base += top;
    }
    return { width: W, height: H, meshes: out, utilization: atlas.getUtilization(0) };
  } finally {
    atlas.destroy();
  }
}
