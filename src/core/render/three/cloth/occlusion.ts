// Baked ambient occlusion for a cloth as it lies (docs/render/cloth.md): how open each point is, on each of its two sides, to rays cast a short
// way out. The cloth's own triangles (a fold, a layer over another) and the solid it lies on (the chair under it) block them, so the creases
// and the cloth where it touches darken in the game. Pure maths.
import type { Sdf } from './solid';

/** A uniform grid of the triangles: each cell's first entry in `items` (counting sort), the triangles by cell. */
interface Grid { x0: number; y0: number; z0: number; inv: number; nx: number; ny: number; nz: number; start: Int32Array; items: Int32Array }

/** The grid over the box [x0, y0, z0, x1, y1, z1]: a triangle that reaches out of it is kept only in its cells inside, one wholly out not at all. */
function triangleGrid(pos: Float32Array, tris: Uint32Array, cell: number, box: readonly number[]): Grid {
  const [x0, y0, z0, x1, y1, z1] = box as [number, number, number, number, number, number];
  const inv = 1 / cell, nx = Math.floor((x1 - x0) * inv) + 1, ny = Math.floor((y1 - y0) * inv) + 1, nz = Math.floor((z1 - z0) * inv) + 1;
  const g: Grid = { x0, y0, z0, inv, nx, ny, nz, start: new Int32Array(nx * ny * nz + 1), items: new Int32Array(0) };
  // each triangle goes in every cell its box touches: count, then place
  const each = (t: number, f: (c: number) => void) => {
    const a = 3 * tris[3 * t]!, b = 3 * tris[3 * t + 1]!, c = 3 * tris[3 * t + 2]!;
    const lo = (o: number, m: number) => Math.max(0, Math.floor((Math.min(pos[a + o]!, pos[b + o]!, pos[c + o]!) - m) * inv));
    const hi = (o: number, m: number, n: number) => Math.min(n - 1, Math.floor((Math.max(pos[a + o]!, pos[b + o]!, pos[c + o]!) - m) * inv));
    for (let k = lo(2, z0); k <= hi(2, z0, nz); k++) for (let j = lo(1, y0); j <= hi(1, y0, ny); j++) for (let i = lo(0, x0); i <= hi(0, x0, nx); i++) f(i + nx * (j + ny * k));
  };
  const m = tris.length / 3;
  for (let t = 0; t < m; t++) each(t, (c) => g.start[c]!++);
  for (let c = 0, s = 0; c < g.start.length; c++) { s += g.start[c]!; g.start[c] = s; }
  g.items = new Int32Array(g.start[g.start.length - 1]!);
  for (let t = 0; t < m; t++) each(t, (c) => { g.items[--g.start[c]!] = t; });
  return g;
}

/** Where the ray from `o` along unit `d` meets triangle `t` (its distance), or Infinity. */
function hitTriangle(pos: Float32Array, tris: Uint32Array, t: number, o: readonly number[], d: readonly number[]): number {
  const a = 3 * tris[3 * t]!, b = 3 * tris[3 * t + 1]!, c = 3 * tris[3 * t + 2]!;
  const e1x = pos[b]! - pos[a]!, e1y = pos[b + 1]! - pos[a + 1]!, e1z = pos[b + 2]! - pos[a + 2]!;
  const e2x = pos[c]! - pos[a]!, e2y = pos[c + 1]! - pos[a + 1]!, e2z = pos[c + 2]! - pos[a + 2]!;
  const px = d[1]! * e2z - d[2]! * e2y, py = d[2]! * e2x - d[0]! * e2z, pz = d[0]! * e2y - d[1]! * e2x, det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-9) return Infinity;
  const f = 1 / det, sx = o[0]! - pos[a]!, sy = o[1]! - pos[a + 1]!, sz = o[2]! - pos[a + 2]!, u = f * (sx * px + sy * py + sz * pz);
  if (u < 0 || u > 1) return Infinity;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = f * (d[0]! * qx + d[1]! * qy + d[2]! * qz);
  if (v < 0 || u + v > 1) return Infinity;
  const h = f * (e2x * qx + e2y * qy + e2z * qz);
  return h > 0 ? h : Infinity;
}

/**
 * Each point's open share on its normal's side and on the other (two values a point; 1 nothing near, 0 shut in), from `rays` cosine-weighted
 * rays a side out to `reach` mm; a hit counts less the farther off it is. A point never blocks itself through the triangles on it (`weld`:
 * the welded id of each point), nor through cloth nearer than `skin` mm: layers that close are one sheet (the solver keeps layers its
 * `self` apart, but two pressed together can settle in each other's gaps, and their faces would show as dark flecks). `pos` and `nrm` hold
 * three values a point. Only the first `cast` points are cast (the rest only block: the things round a mesh, `vertexao.ts`). A point marked
 * in `one` is seen from its normal's side only: the other is not cast and stays open.
 */
export function occlusion(pos: Float32Array, nrm: Float32Array, tris: Uint32Array, weld: Int32Array, solid: Sdf, rays: number, reach: number, skin = 0, cast = pos.length / 3, one?: Uint8Array): Float32Array {
  // the grid need only reach as far as a cast ray goes
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 3 * cast; k++) { box[k % 3] = Math.min(box[k % 3]!, pos[k]!); box[3 + (k % 3)] = Math.max(box[3 + (k % 3)]!, pos[k]!); }
  for (let a = 0; a < 3; a++) { box[a] = box[a]! - reach; box[3 + a] = box[3 + a]! + reach; }
  const n = cast, out = new Float32Array(2 * n), g = triangleGrid(pos, tris, Math.max(8, reach / 6), box);
  const seen = new Int32Array(tris.length / 3).fill(-1), mine = new Set<number>(), first = new Int32Array(pos.length / 3).fill(-1);
  // which triangles hold each welded point, so its own are skipped
  const around = new Map<number, number[]>();
  for (let t = 0; t < tris.length / 3; t++) for (let e = 0; e < 3; e++) {
    const r = weld[tris[3 * t + e]!]!, l = around.get(r);
    if (l) l.push(t); else around.set(r, [t]);
  }
  // cosine-weighted directions about +z (Hammersley), turned about the normal by a fixed angle for each point
  const dirs: [number, number, number][] = [];
  for (let k = 0; k < rays; k++) {
    let bits = k, rad = 0;
    for (let b = 0.5; bits; bits >>= 1, b /= 2) if (bits & 1) rad += b;
    const u = (k + 0.5) / rays, r = Math.sqrt(u), phi = 2 * Math.PI * rad;
    dirs.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)]);
  }
  const o = [0, 0, 0], d = [0, 0, 0];
  let ray = 0;
  for (let i = 0; i < n; i++) {
    // welded points lie on one another: the first of them is cast for all
    const w = weld[i]!, f0 = first[w]!;
    if (f0 >= 0) { out[2 * i] = out[2 * f0]!; out[2 * i + 1] = out[2 * f0 + 1]!; continue; }
    first[w] = i;
    const k = 3 * i, nx0 = nrm[k]!, ny0 = nrm[k + 1]!, nz0 = nrm[k + 2]!;
    mine.clear();
    for (const t of around.get(weld[i]!) ?? []) mine.add(t);
    // a frame about the normal
    const ax = Math.abs(nx0) < 0.9 ? 1 : 0, ay = 1 - ax;
    let tx = ay * nz0, ty = -ax * nz0, tz = ax * ny0 - ay * nx0;
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const bx = ny0 * tz - nz0 * ty, by = nz0 * tx - nx0 * tz, bz = nx0 * ty - ny0 * tx;
    const turn = (Math.sin(i * 12.9898) * 43758.5453) % (2 * Math.PI), ct = Math.cos(turn), st = Math.sin(turn);
    out[2 * i + 1] = 1;
    for (let side = 0; side < (one?.[i] ? 1 : 2); side++) {
      const sg = side ? -1 : 1;
      let shut = 0;
      for (const [lx0, ly0, lz] of dirs) {
        const lx = lx0 * ct - ly0 * st, ly = lx0 * st + ly0 * ct;
        d[0] = lx * tx + ly * bx + sg * lz * nx0; d[1] = lx * ty + ly * by + sg * lz * ny0; d[2] = lx * tz + ly * bz + sg * lz * nz0;
        o[0] = pos[k]! + sg * 0.3 * nx0; o[1] = pos[k + 1]! + sg * 0.3 * ny0; o[2] = pos[k + 2]! + sg * 0.3 * nz0;
        // the solid: march by its distance
        let hit = Infinity;
        for (let s = 0.5; s < reach;) {
          const f = solid(o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s);
          if (f < 0.2) { hit = s; break; }
          s += Math.max(0.5, f * 0.9);
        }
        // the cloth: walk the grid's cells along the ray (3D DDA) up to the nearer of the solid's hit and the reach
        ray++;
        const far = Math.min(hit, reach);
        let ci = Math.floor((o[0] - g.x0) * g.inv), cj = Math.floor((o[1] - g.y0) * g.inv), ck = Math.floor((o[2] - g.z0) * g.inv);
        const si = d[0] > 0 ? 1 : -1, sj = d[1] > 0 ? 1 : -1, sk = d[2] > 0 ? 1 : -1, cell = 1 / g.inv;
        const next = (c: number, m: number, p: number, dd: number, s: number) => (dd === 0 ? Infinity : ((m + (c + (s > 0 ? 1 : 0)) * cell) - p) / dd);
        let txm = next(ci, g.x0, o[0], d[0], si), tym = next(cj, g.y0, o[1], d[1], sj), tzm = next(ck, g.z0, o[2], d[2], sk);
        const dtx = d[0] === 0 ? Infinity : cell / Math.abs(d[0]), dty = d[1] === 0 ? Infinity : cell / Math.abs(d[1]), dtz = d[2] === 0 ? Infinity : cell / Math.abs(d[2]);
        for (let at = 0; at < far && hit > at;) {
          if (ci >= 0 && cj >= 0 && ck >= 0 && ci < g.nx && cj < g.ny && ck < g.nz) {
            const c = ci + g.nx * (cj + g.ny * ck);
            for (let s = g.start[c]!; s < g.start[c + 1]!; s++) {
              const t = g.items[s]!;
              if (seen[t] === ray || mine.has(t)) continue;
              seen[t] = ray;
              const h = hitTriangle(pos, tris, t, o, d);
              if (h >= skin) hit = Math.min(hit, h);
            }
          } else if ((ci < 0 && si < 0) || (cj < 0 && sj < 0) || (ck < 0 && sk < 0) || (ci >= g.nx && si > 0) || (cj >= g.ny && sj > 0) || (ck >= g.nz && sk > 0)) break;
          if (txm <= tym && txm <= tzm) { at = txm; txm += dtx; ci += si; } else if (tym <= tzm) { at = tym; tym += dty; cj += sj; } else { at = tzm; tzm += dtz; ck += sk; }
        }
        if (hit < reach) shut += 1 - (hit / reach) ** 2;
      }
      out[2 * i + side] = 1 - shut / rays;
    }
  }
  return out;
}
