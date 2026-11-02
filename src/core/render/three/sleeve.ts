// A sleeved cable's skin over settled points (rope.ts): one geometry for a lead's strands, a ring of vertices at each sample, the arc length in
// the texture's u so a weave keeps its pitch on every strand. A rope's straight lead out of a plug is longer than its other segments, and a
// Catmull-Rom curve overshoots past an uneven spacing into a hook: the long segments are split first, and the curve is centripetal (it never
// loops on what unevenness is left). The rings follow a parallel-transported frame
// from the first end, so the weave does not roll along a bend and does not swim where that end stays put. Each end is capped (a strand is
// solid, not a hollow tube). `update` writes the vertices in place: a held cable re-skins every frame without a new geometry.
import { BufferAttribute, BufferGeometry } from 'three';
import type { V3 } from './rope';

/** Weave tiles round a sleeve; a tile runs `2π / WRAP` radii along it, so it is square on the surface. */
export const WRAP = 4;
const WEAVE = (2 * Math.PI) / WRAP;
/** Catmull-Rom points between two settled points, before the strand is resampled evenly along its length. */
const SUB = 4;

/** `p` with each long segment (a plug's straight lead) split to the typical one: evenly spaced, a curve keeps the lead straight into its bend. */
function spread(p: readonly V3[]): readonly V3[] {
  const l = p.slice(1).map((q, i) => Math.hypot(q[0] - p[i]![0], q[1] - p[i]![1], q[2] - p[i]![2])), typical = [...l].sort((a, b) => a - b)[l.length >> 1]!;
  if (!(typical > 0) || l.every((x) => x < typical * 1.5)) return p;
  const out: V3[] = [p[0]!];
  l.forEach((x, i) => {
    const a = p[i]!, b = p[i + 1]!, k = Math.max(1, Math.round(x / typical));
    for (let f = 1; f <= k; f++) out.push([a[0] + ((b[0] - a[0]) * f) / k, a[1] + ((b[1] - a[1]) * f) / k, a[2] + ((b[2] - a[2]) * f) / k]);
  });
  return out;
}

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
    // each strand's rings, then (after all of them) each strand's two caps: a centre and a ring each
    const ring = this.ring = radial + 1, per = (samples + 1) * ring, tubes = strands * per, n = tubes + strands * 2 * (ring + 1);
    this.pos = new Float32Array(n * 3); this.nrm = new Float32Array(n * 3); this.uv = new Float32Array(n * 2);
    this.even = new Float64Array((samples + 1) * 3);
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(strands * (samples * radial * 6 + 2 * radial * 3));
    let k = 0;
    // counter-clockwise seen from outside: the faces point out of the tube
    for (let s = 0; s < strands; s++) for (let i = 0; i < samples; i++) for (let j = 0; j < radial; j++) {
      const a = s * per + i * ring + j, b = a + ring;
      idx[k++] = a; idx[k++] = a + 1; idx[k++] = b;
      idx[k++] = b; idx[k++] = a + 1; idx[k++] = b + 1;
    }
    for (let s = 0; s < strands; s++) for (let e = 0; e < 2; e++) {
      const c = tubes + (s * 2 + e) * (ring + 1);
      for (let j = 0; j < radial; j++) {
        // the first end's cap faces back along the strand, the last end's on along it
        idx[k++] = c; idx[k++] = c + 1 + (e ? j : j + 1); idx[k++] = c + 1 + (e ? j + 1 : j);
      }
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

  private strand(s: number, path: readonly V3[]) {
    const S = this.samples, R = this.radial, r = this.r, ring = this.ring, base = s * (S + 1) * ring, p = spread(path);
    // a dense centripetal Catmull-Rom curve through the points (the ends reflected, so the curve leaves each along its first segment), then
    // samples evenly along its length
    const m = (p.length - 1) * SUB + 1;
    if (this.dense.length < m * 3) { this.dense = new Float64Array(m * 3); this.lens = new Float64Array(m); }
    const d = this.dense, L = this.lens, gap = (a: V3, b: V3) => Math.max(1e-3, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
    for (let i = 0; i + 1 < p.length; i++) {
      const p1 = p[i]!, p2 = p[i + 1]!;
      const p0: V3 = i > 0 ? p[i - 1]! : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1], 2 * p1[2] - p2[2]];
      const p3: V3 = i + 2 < p.length ? p[i + 2]! : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1], 2 * p2[2] - p1[2]];
      // the knot spans (the square root of each chord) and the tangents at p1 and p2 over this span (Barry-Goldman)
      const d0 = gap(p0, p1), d1 = gap(p1, p2), d2 = gap(p2, p3);
      for (let k = 0; k < SUB; k++) {
        const t = k / SUB, t2 = t * t, t3 = t2 * t, o = (i * SUB + k) * 3;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = 3 * t2 - 2 * t3, h11 = t3 - t2;
        for (let j = 0; j < 3; j++) {
          const m1 = d1 * ((p1[j]! - p0[j]!) / d0 - (p2[j]! - p0[j]!) / (d0 + d1) + (p2[j]! - p1[j]!) / d1);
          const m2 = d1 * ((p2[j]! - p1[j]!) / d1 - (p3[j]! - p1[j]!) / (d1 + d2) + (p3[j]! - p2[j]!) / d2);
          d[o + j] = h00 * p1[j]! + h10 * m1 + h01 * p2[j]! + h11 * m2;
        }
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
      if (i === 0 || i === S) this.cap(s, i ? 1 : 0, base + i * ring, i ? tx : -tx, i ? ty : -ty, i ? tz : -tz, i * 3, u);
    }
  }

  /** End `e`'s cap of strand `s`: its centre on the path, its ring on the strand's end ring (`at`), facing (nx, ny, nz); the weave laid flat on it. */
  private cap(s: number, e: number, at: number, nx: number, ny: number, nz: number, mid: number, u: number) {
    const ring = this.ring, c = this.strands * (this.samples + 1) * ring + (s * 2 + e) * (ring + 1), P = this.pos, N = this.nrm, U = this.uv;
    for (let j = -1; j < ring; j++) {
      const v = c + 1 + j, src = at + j, th = (j / this.radial) * Math.PI * 2;
      if (j < 0) { P[v * 3] = this.even[mid]!; P[v * 3 + 1] = this.even[mid + 1]!; P[v * 3 + 2] = this.even[mid + 2]!; U[v * 2] = u; U[v * 2 + 1] = 0; }
      else { P[v * 3] = P[src * 3]!; P[v * 3 + 1] = P[src * 3 + 1]!; P[v * 3 + 2] = P[src * 3 + 2]!; U[v * 2] = u + Math.cos(th) / WEAVE; U[v * 2 + 1] = Math.sin(th) / WEAVE; }
      N[v * 3] = nx; N[v * 3 + 1] = ny; N[v * 3 + 2] = nz;
    }
  }
}
