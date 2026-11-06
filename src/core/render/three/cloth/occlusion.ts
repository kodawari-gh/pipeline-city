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
  const m = tris.length / 3, start = g.start;
  for (let pass = 0; pass < 2; pass++) {
    if (pass) {
      for (let c = 0, s = 0; c < start.length; c++) { s += start[c]!; start[c] = s; }
      g.items = new Int32Array(start[start.length - 1]!);
    }
    const items = g.items;
    for (let t = 0; t < m; t++) {
      const a = 3 * tris[3 * t]!, b = 3 * tris[3 * t + 1]!, c = 3 * tris[3 * t + 2]!;
      const ax = pos[a]!, ay = pos[a + 1]!, az = pos[a + 2]!, bx = pos[b]!, by = pos[b + 1]!, bz = pos[b + 2]!, cx = pos[c]!, cy = pos[c + 1]!, cz = pos[c + 2]!;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) * inv)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) * inv));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) * inv)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - y0) * inv));
      const k0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) * inv)), k1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0) * inv));
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const q = i + nx * (j + ny * k);
        if (pass) items[--start[q]!] = t; else start[q]!++;
      }
    }
  }
  return g;
}

/** Each triangle's first corner and its two edges from there, nine values a triangle: a ray asks them far more often than they change. */
function triangleEdges(pos: Float32Array, tris: Uint32Array): Float64Array {
  const out = new Float64Array(3 * tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const a = 3 * tris[i]!, b = 3 * tris[i + 1]!, c = 3 * tris[i + 2]!, k = 3 * i;
    out[k] = pos[a]!; out[k + 1] = pos[a + 1]!; out[k + 2] = pos[a + 2]!;
    out[k + 3] = pos[b]! - pos[a]!; out[k + 4] = pos[b + 1]! - pos[a + 1]!; out[k + 5] = pos[b + 2]! - pos[a + 2]!;
    out[k + 6] = pos[c]! - pos[a]!; out[k + 7] = pos[c + 1]! - pos[a + 1]!; out[k + 8] = pos[c + 2]! - pos[a + 2]!;
  }
  return out;
}

/** Where the ray from (ox, oy, oz) along unit (dx, dy, dz) meets triangle `t` (`triangleEdges`; its distance), or Infinity. */
function hitTriangle(tri: Float64Array, t: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  const k = 9 * t, e1x = tri[k + 3]!, e1y = tri[k + 4]!, e1z = tri[k + 5]!, e2x = tri[k + 6]!, e2y = tri[k + 7]!, e2z = tri[k + 8]!;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-9) return Infinity;
  const f = 1 / det, sx = ox - tri[k]!, sy = oy - tri[k + 1]!, sz = oz - tri[k + 2]!, u = f * (sx * px + sy * py + sz * pz);
  if (u < 0 || u > 1) return Infinity;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = f * (dx * qx + dy * qy + dz * qz);
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
  const n = cast, out = new Float32Array(2 * n), g = triangleGrid(pos, tris, Math.max(8, reach / 6), box), tri = triangleEdges(pos, tris);
  const m = tris.length / 3, points = pos.length / 3, seen = new Int32Array(m).fill(-1), mine = new Int32Array(m).fill(-1), first = new Int32Array(points).fill(-1);
  // which triangles hold each welded point, so its own are skipped (by counting sort, as the grid's cells)
  const aroundAt = new Int32Array(points + 1), around = new Int32Array(tris.length);
  for (let e = 0; e < tris.length; e++) aroundAt[weld[tris[e]!]!]!++;
  for (let p = 0, s = 0; p <= points; p++) { s += aroundAt[p]!; aroundAt[p] = s; }
  for (let e = 0; e < tris.length; e++) around[--aroundAt[weld[tris[e]!]!]!] = (e / 3) | 0;
  // cosine-weighted directions about +z (Hammersley), turned about the normal by a fixed angle for each point
  const dirs = new Float64Array(3 * rays);
  for (let k = 0; k < rays; k++) {
    let bits = k, rad = 0;
    for (let b = 0.5; bits; bits >>= 1, b /= 2) if (bits & 1) rad += b;
    const u = (k + 0.5) / rays, r = Math.sqrt(u), phi = 2 * Math.PI * rad;
    dirs[3 * k] = r * Math.cos(phi); dirs[3 * k + 1] = r * Math.sin(phi); dirs[3 * k + 2] = Math.sqrt(1 - u);
  }
  const cell = 1 / g.inv, next = (c: number, m0: number, p: number, dd: number, s: number) => (dd === 0 ? Infinity : ((m0 + (c + (s > 0 ? 1 : 0)) * cell) - p) / dd);
  let ray = 0;
  for (let i = 0; i < n; i++) {
    // welded points lie on one another: the first of them is cast for all
    const w = weld[i]!, f0 = first[w]!;
    if (f0 >= 0) { out[2 * i] = out[2 * f0]!; out[2 * i + 1] = out[2 * f0 + 1]!; continue; }
    first[w] = i;
    const k = 3 * i, nx0 = nrm[k]!, ny0 = nrm[k + 1]!, nz0 = nrm[k + 2]!;
    for (let s = aroundAt[w]!, end = aroundAt[w + 1]!; s < end; s++) mine[around[s]!] = i;
    // a frame about the normal
    const ax = Math.abs(nx0) < 0.9 ? 1 : 0, ay = 1 - ax;
    let tx = ay * nz0, ty = -ax * nz0, tz = ax * ny0 - ay * nx0;
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const bx = ny0 * tz - nz0 * ty, by = nz0 * tx - nx0 * tz, bz = nx0 * ty - ny0 * tx;
    const turn = (Math.sin(i * 12.9898) * 43758.5453) % (2 * Math.PI), ct = Math.cos(turn), st = Math.sin(turn);
    out[2 * i + 1] = 1;
    for (let side = 0; side < (one?.[i] ? 1 : 2); side++) {
      const sg = side ? -1 : 1, ox = pos[k]! + sg * 0.3 * nx0, oy = pos[k + 1]! + sg * 0.3 * ny0, oz = pos[k + 2]! + sg * 0.3 * nz0;
      let shut = 0;
      for (let q = 0; q < 3 * rays; q += 3) {
        const lx0 = dirs[q]!, ly0 = dirs[q + 1]!, lz = dirs[q + 2]!, lx = lx0 * ct - ly0 * st, ly = lx0 * st + ly0 * ct;
        const dx = lx * tx + ly * bx + sg * lz * nx0, dy = lx * ty + ly * by + sg * lz * ny0, dz = lx * tz + ly * bz + sg * lz * nz0;
        // the solid: march by its distance
        let hit = Infinity;
        for (let s = 0.5; s < reach;) {
          const f = solid(ox + dx * s, oy + dy * s, oz + dz * s);
          if (f < 0.2) { hit = s; break; }
          s += Math.max(0.5, f * 0.9);
        }
        // the cloth: walk the grid's cells along the ray (3D DDA) up to the nearer of the solid's hit and the reach
        ray++;
        const far = Math.min(hit, reach);
        let ci = Math.floor((ox - g.x0) * g.inv), cj = Math.floor((oy - g.y0) * g.inv), ck = Math.floor((oz - g.z0) * g.inv);
        const si = dx > 0 ? 1 : -1, sj = dy > 0 ? 1 : -1, sk = dz > 0 ? 1 : -1;
        let txm = next(ci, g.x0, ox, dx, si), tym = next(cj, g.y0, oy, dy, sj), tzm = next(ck, g.z0, oz, dz, sk);
        const dtx = dx === 0 ? Infinity : cell / Math.abs(dx), dty = dy === 0 ? Infinity : cell / Math.abs(dy), dtz = dz === 0 ? Infinity : cell / Math.abs(dz);
        for (let at = 0; at < far && hit > at;) {
          if (ci >= 0 && cj >= 0 && ck >= 0 && ci < g.nx && cj < g.ny && ck < g.nz) {
            const c = ci + g.nx * (cj + g.ny * ck);
            for (let s = g.start[c]!, end = g.start[c + 1]!; s < end; s++) {
              const t = g.items[s]!;
              if (seen[t] === ray || mine[t] === i) continue;
              seen[t] = ray;
              const h = hitTriangle(tri, t, ox, oy, oz, dx, dy, dz);
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
