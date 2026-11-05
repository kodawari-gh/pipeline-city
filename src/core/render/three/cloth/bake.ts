// A cloth bake (docs/render/cloth.md): a garment is meshed, sewn and dropped through its phases once, offline, and the cloth as it lies is
// written out as a glTF model the game loads (`tools/bake-cloth.mjs`). Sewn points are welded, the normals run smooth over the seams, the
// pieces keep their own flat uvs, and a rolled rim runs along every free edge (a hem, a cuff, a hood's opening) so the single sheet reads thick.
// Pure: no DOM.
import { writeGlb, type GlbPrimitive } from './glb';
import { assemble, type ClothMesh, type Garment } from './pattern';
import { gradient, type Sdf } from './solid';
import { Cloth, type ClothParams, type Phase } from './solver';

export interface ClothBake {
  /** The model's name, and its file under `public/` (`models/<name>.glb`). */
  name: string;
  garment: Garment;
  /** Point spacing on the flat pieces (mm). */
  h: number;
  params: ClothParams;
  phases: readonly (Phase & { label: string })[];
  /** Millimetres of flat cloth to one texture tile (the uvs are the flat positions over it). */
  tile: number;
  /** The rolled rim's radius along the free edges (mm; 0: none). */
  rim: number;
  /** Smoothing passes over the cloth as it lies (0: none): they take off the spikes a seam or a pinch leaves, not its folds. */
  smooth: number;
}

/**
 * Taubin smoothing over the welded points (`sum` holds each weld group's position at its root): each pass moves every point toward the
 * middle of its neighbours, then back out a little more, so the cloth loses its spikes and not its size. Then it is set back `gap` off the
 * solid it lies on.
 */
function relax(m: ClothMesh, sum: Float64Array, passes: number, solid: Sdf, gap: number): void {
  const W = m.weld, nb = new Map<number, Set<number>>();
  for (let e = 0; e < m.edges.length; e += 2) {
    const a = W[m.edges[e]!]!, b = W[m.edges[e + 1]!]!;
    if (!nb.has(a)) nb.set(a, new Set());
    if (!nb.has(b)) nb.set(b, new Set());
    nb.get(a)!.add(b); nb.get(b)!.add(a);
  }
  const roots = [...nb.keys()], next = new Float64Array(sum.length);
  for (let k = 0; k < 2 * passes; k++) {
    const f = k % 2 ? -0.53 : 0.5;
    for (const r of roots) {
      const set = nb.get(r)!;
      for (let c = 0; c < 3; c++) {
        let mid = 0;
        for (const j of set) mid += sum[3 * j + c]!;
        next[3 * r + c] = sum[3 * r + c]! + f * (mid / set.size - sum[3 * r + c]!);
      }
    }
    for (const r of roots) for (let c = 0; c < 3; c++) sum[3 * r + c] = next[3 * r + c]!;
  }
  const g: [number, number, number] = [0, 0, 0];
  for (const r of roots) {
    const x = sum[3 * r]!, y = sum[3 * r + 1]!, z = sum[3 * r + 2]!, d = solid(x, y, z) - gap;
    if (d >= 0) continue;
    gradient(solid, x, y, z, g);
    for (let c = 0; c < 3; c++) sum[3 * r + c] = sum[3 * r + c]! - g[c]! * d;
  }
}

/** The cloth's surface as it lies: welded positions (smoothed `passes` times off `solid`), smooth normals. */
function surface(m: ClothMesh, p: Float64Array, passes: number, solid: Sdf, gap: number): { pos: Float32Array; nrm: Float32Array } {
  const n = m.n, W = m.weld, sum = new Float64Array(3 * n), cnt = new Float64Array(n), nr = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) { const r = W[i]!; cnt[r]!++; for (let c = 0; c < 3; c++) sum[3 * r + c] = sum[3 * r + c]! + p[3 * i + c]!; }
  for (let r = 0; r < n; r++) if (cnt[r]!) for (let c = 0; c < 3; c++) sum[3 * r + c] = sum[3 * r + c]! / cnt[r]!;
  if (passes > 0) relax(m, sum, passes, solid, gap);
  const pos = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { const r = W[i]!; for (let c = 0; c < 3; c++) pos[3 * i + c] = sum[3 * r + c]!; }
  const T = m.tris;
  for (let t = 0; t < T.length; t += 3) {
    const a = 3 * T[t]!, b = 3 * T[t + 1]!, c = 3 * T[t + 2]!;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const k of [T[t]!, T[t + 1]!, T[t + 2]!]) { const r = 3 * W[k]!; nr[r] = nr[r]! + fx; nr[r + 1] = nr[r + 1]! + fy; nr[r + 2] = nr[r + 2]! + fz; }
  }
  const nrm = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const r = 3 * W[i]!, l = Math.hypot(nr[r]!, nr[r + 1]!, nr[r + 2]!) || 1;
    nrm[3 * i] = nr[r]! / l; nrm[3 * i + 1] = nr[r + 1]! / l; nrm[3 * i + 2] = nr[r + 2]! / l;
  }
  return { pos, nrm };
}

/** The free edges as loops of points (welded ids, in the triangles' winding), each with the material of the cloth along it. */
export function freeEdges(m: ClothMesh): { pts: number[]; mat: number; closed: boolean }[] {
  const W = m.weld, T = m.tris, count = new Map<string, number>(), next = new Map<number, [number, number]>();
  const key = (u: number, v: number) => (u < v ? `${u},${v}` : `${v},${u}`);
  for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) {
    const k = key(W[T[t + e]!]!, W[T[t + ((e + 1) % 3)]!]!);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) {
    const u = W[T[t + e]!]!, v = W[T[t + ((e + 1) % 3)]!]!;
    if (count.get(key(u, v)) === 1) next.set(u, [v, m.triMat[t / 3]!]);
  }
  const loops: { pts: number[]; mat: number; closed: boolean }[] = [], used = new Set<number>();
  // open chains first (a start nothing leads into), then the closed loops
  const into = new Set([...next.values()].map(([v]) => v));
  const starts = [...[...next.keys()].filter((u) => !into.has(u)), ...next.keys()];
  for (const s of starts) {
    if (used.has(s)) continue;
    const pts = [s], mat = next.get(s)![1];
    used.add(s);
    let u = s, closed = false;
    for (;;) {
      const nx = next.get(u);
      if (!nx) break;
      if (nx[0] === s) { closed = true; break; }
      if (used.has(nx[0])) break;
      used.add(nx[0]); pts.push(nx[0]); u = nx[0];
    }
    if (pts.length > 1) loops.push({ pts, mat, closed });
  }
  return loops;
}

/** Run a bake: the model's bytes, and a line per phase on how it settled. */
export function bakeCloth(b: ClothBake, log: (line: string) => void = () => {}): Uint8Array {
  const t0 = Date.now(), m = assemble(b.garment, b.h);
  log(`${b.name}: ${m.n} points, ${m.tris.length / 3} triangles, ${m.sewn.length / 2} sewn pairs (${Date.now() - t0} ms)`);
  const cloth = new Cloth(m, b.params);
  for (const ph of b.phases) {
    const t = Date.now();
    cloth.run(ph);
    const s = cloth.stats();
    log(`  ${ph.label}: seam gap ${s.seam.toFixed(1)} mm, stretch ${(100 * s.stretch).toFixed(1)}%, fastest ${s.speed.toFixed(0)} mm/s (${Date.now() - t} ms)`);
  }
  const { pos, nrm } = surface(m, cloth.p, b.smooth, b.phases[b.phases.length - 1]!.solid, b.params.thickness), mats = b.garment.materials;
  const parts = mats.map(() => ({ position: [] as number[], normal: [] as number[], uv: [] as number[], index: [] as number[], map: new Map<number, number>() }));
  for (let t = 0; t < m.tris.length; t += 3) {
    const part = parts[m.triMat[t / 3]!]!;
    for (let e = 0; e < 3; e++) {
      const i = m.tris[t + e]!;
      let j = part.map.get(i);
      if (j === undefined) {
        j = part.position.length / 3;
        part.map.set(i, j);
        part.position.push(pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!);
        part.normal.push(nrm[3 * i]!, nrm[3 * i + 1]!, nrm[3 * i + 2]!);
        part.uv.push(m.flat[2 * i]! / b.tile, m.flat[2 * i + 1]! / b.tile);
      }
      part.index.push(j);
    }
  }
  // the rims: a tube round each free edge, on the cloth's own normal and the edge's run
  if (b.rim > 0) {
    const sides = 8;
    for (const loop of freeEdges(m)) {
      const part = parts[loop.mat]!, k0 = part.position.length / 3, L = loop.pts.length;
      let run = 0;
      for (let k = 0; k < L; k++) {
        const at = (j: number) => 3 * loop.pts[loop.closed ? (j + L) % L : Math.max(0, Math.min(L - 1, j))]!;
        const c = at(k), a = at(k - 1), d = at(k + 1);
        if (k > 0) run += Math.hypot(pos[c]! - pos[a]!, pos[c + 1]! - pos[a + 1]!, pos[c + 2]! - pos[a + 2]!);
        let tx = pos[d]! - pos[a]!, ty = pos[d + 1]! - pos[a + 1]!, tz = pos[d + 2]! - pos[a + 2]!;
        const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        let nx = nrm[c]!, ny = nrm[c + 1]!, nz = nrm[c + 2]!;
        const dn = nx * tx + ny * ty + nz * tz; nx -= dn * tx; ny -= dn * ty; nz -= dn * tz;
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
        for (let s = 0; s <= sides; s++) {
          const ang = (2 * Math.PI * s) / sides, cs = Math.cos(ang), sn = Math.sin(ang);
          const ox = cs * nx + sn * bx, oy = cs * ny + sn * by, oz = cs * nz + sn * bz;
          part.position.push(pos[c]! + b.rim * ox, pos[c + 1]! + b.rim * oy, pos[c + 2]! + b.rim * oz);
          part.normal.push(ox, oy, oz);
          part.uv.push(run / b.tile, s / sides);
        }
      }
      const segs = loop.closed ? L : L - 1;
      for (let k = 0; k < segs; k++) for (let s = 0; s < sides; s++) {
        const r0 = k0 + k * (sides + 1), r1 = k0 + ((k + 1) % L) * (sides + 1);
        part.index.push(r0 + s, r1 + s, r0 + s + 1, r0 + s + 1, r1 + s, r1 + s + 1);
      }
    }
  }
  const prims: GlbPrimitive[] = parts.flatMap((p, i) => p.index.length ? [{
    material: mats[i]!, position: Float32Array.from(p.position), normal: Float32Array.from(p.normal), uv: Float32Array.from(p.uv), index: Uint32Array.from(p.index),
  }] : []);
  log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return writeGlb(b.name, prims);
}
