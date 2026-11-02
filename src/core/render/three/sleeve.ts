// A sleeved cable's skin over settled points (rope.ts): one geometry for a lead's strands, a ring of vertices at each sample, the arc length in
// the texture's u so a weave keeps its pitch on every strand. The rings follow a parallel-transported frame from the first end, so the weave
// does not roll along a bend and does not swim where that end stays put. `update` writes the vertices in place: a held cable re-skins every
// frame without a new geometry.
import { BufferAttribute, BufferGeometry } from 'three';
import type { V3 } from './rope';

/** Weave tiles round a sleeve; a tile runs `2π / WRAP` radii along it, so it is square on the surface. */
export const WRAP = 4;
const WEAVE = (2 * Math.PI) / WRAP;
/** Catmull-Rom points between two settled points, before the strand is resampled evenly along its length. */
const SUB = 4;

export class Sleeve {
  readonly geometry = new BufferGeometry();
  private pos: Float32Array;
  private nrm: Float32Array;
  private uv: Float32Array;
  private ring: number;
  // scratch for one strand: the dense curve, its lengths and the even samples
  private dense: Float64Array = new Float64Array(0);
  private lens: Float64Array = new Float64Array(0);
  private even: Float64Array;

  /** `strands` paths, each skinned with `samples` segments along and `radial` round, `r` thick. */
  constructor(readonly strands: number, readonly r: number, readonly samples = 48, readonly radial = 12) {
    const ring = this.ring = radial + 1, per = (samples + 1) * ring, n = strands * per;
    this.pos = new Float32Array(n * 3); this.nrm = new Float32Array(n * 3); this.uv = new Float32Array(n * 2);
    this.even = new Float64Array((samples + 1) * 3);
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(strands * samples * radial * 6);
    let k = 0;
    for (let s = 0; s < strands; s++) for (let i = 0; i < samples; i++) for (let j = 0; j < radial; j++) {
      const a = s * per + i * ring + j, b = a + ring;
      idx[k++] = a; idx[k++] = b; idx[k++] = a + 1;
      idx[k++] = b; idx[k++] = b + 1; idx[k++] = a + 1;
    }
    this.geometry.setIndex(new BufferAttribute(idx, 1));
    this.geometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('normal', new BufferAttribute(this.nrm, 3));
    this.geometry.setAttribute('uv', new BufferAttribute(this.uv, 2));
  }

  /** Skin each strand along its points (at least two each; a missing strand keeps its last skin). */
  update(paths: readonly (readonly V3[])[]): void {
    for (let s = 0; s < Math.min(this.strands, paths.length); s++) if (paths[s]!.length >= 2) this.strand(s, paths[s]!);
    for (const name of ['position', 'normal', 'uv']) this.geometry.getAttribute(name).needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  private strand(s: number, p: readonly V3[]) {
    const S = this.samples, R = this.radial, r = this.r, ring = this.ring, base = s * (S + 1) * ring;
    // a dense uniform Catmull-Rom curve through the points, then samples evenly along its length
    const m = (p.length - 1) * SUB + 1;
    if (this.dense.length < m * 3) { this.dense = new Float64Array(m * 3); this.lens = new Float64Array(m); }
    const d = this.dense, L = this.lens;
    for (let i = 0; i + 1 < p.length; i++) {
      const p0 = p[Math.max(0, i - 1)]!, p1 = p[i]!, p2 = p[i + 1]!, p3 = p[Math.min(p.length - 1, i + 2)]!;
      for (let k = 0; k < SUB; k++) {
        const t = k / SUB, t2 = t * t, t3 = t2 * t, o = (i * SUB + k) * 3;
        for (let j = 0; j < 3; j++) d[o + j] = 0.5 * (2 * p1[j]! + (p2[j]! - p0[j]!) * t + (2 * p0[j]! - 5 * p1[j]! + 4 * p2[j]! - p3[j]!) * t2 + (3 * p1[j]! - p0[j]! - 3 * p2[j]! + p3[j]!) * t3);
      }
    }
    const last = p[p.length - 1]!;
    d[(m - 1) * 3] = last[0]; d[(m - 1) * 3 + 1] = last[1]; d[(m - 1) * 3 + 2] = last[2];
    L[0] = 0;
    for (let i = 1; i < m; i++) L[i] = L[i - 1]! + Math.hypot(d[i * 3]! - d[i * 3 - 3]!, d[i * 3 + 1]! - d[i * 3 - 2]!, d[i * 3 + 2]! - d[i * 3 - 1]!);
    const total = L[m - 1]!, e = this.even;
    for (let i = 0, q = 0; i <= S; i++) {
      const want = (total * i) / S;
      while (q + 2 < m && L[q + 1]! < want) q++;
      const span = L[q + 1]! - L[q]! || 1, f = Math.min(1, Math.max(0, (want - L[q]!) / span));
      for (let j = 0; j < 3; j++) e[i * 3 + j] = d[q * 3 + j]! + (d[q * 3 + 3 + j]! - d[q * 3 + j]!) * f;
    }
    // the frame: the tangent, and a normal carried from the first end (projected off each new tangent)
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i <= S; i++) {
      const a = Math.max(0, i - 1), b = Math.min(S, i + 1);
      let tx = e[b * 3]! - e[a * 3]!, ty = e[b * 3 + 1]! - e[a * 3 + 1]!, tz = e[b * 3 + 2]! - e[a * 3 + 2]!;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      if (i === 0) {
        // the world axis least along the tangent, made square to it
        const ax = Math.abs(tx), ay = Math.abs(ty), az = Math.abs(tz);
        [nx, ny, nz] = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
      }
      const dt = nx * tx + ny * ty + nz * tz;
      nx -= tx * dt; ny -= ty * dt; nz -= tz * dt;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      const u = (total * i) / S / (r * WEAVE);
      for (let j = 0; j <= R; j++) {
        const th = (j / R) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th), v = base + i * ring + j;
        const ox = c * nx + sn * bx, oy = c * ny + sn * by, oz = c * nz + sn * bz;
        this.nrm[v * 3] = ox; this.nrm[v * 3 + 1] = oy; this.nrm[v * 3 + 2] = oz;
        this.pos[v * 3] = e[i * 3]! + ox * r; this.pos[v * 3 + 1] = e[i * 3 + 1]! + oy * r; this.pos[v * 3 + 2] = e[i * 3 + 2]! + oz * r;
        this.uv[v * 2] = u; this.uv[v * 2 + 1] = (j / R) * WRAP;
      }
    }
  }
}
