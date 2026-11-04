// Contact between still things, worked out once as the scene is built. A depth map holds the surfaces already placed, seen along one axis, so
// the next thing can be set down on them (`settle`) and pressed into them (`conform`): a pillow on the mattress leans on the pillow behind it,
// flattened where they meet. A taut outline (`Taut`) is where cloth lies over a solid: round its convex hull, never into it. Pure maths on
// geometry already in place (`bake`); no DOM.
import type { BufferGeometry, Mesh } from 'three';

/** World axes: 0 x, 1 y, 2 z. */
export type Axis = 0 | 1 | 2;
export type V3 = readonly [number, number, number];

/** A mesh's own transform moved into its geometry: its vertices are then where it stands (the depth maps read them so). */
export function bake(m: Mesh): BufferGeometry {
  m.updateMatrix();
  m.geometry.applyMatrix4(m.matrix);
  m.position.set(0, 0, 0);
  m.rotation.set(0, 0, 0);
  m.scale.set(1, 1, 1);
  return m.geometry;
}

const softplus = (x: number): number => (x > 30 ? x : Math.log1p(Math.exp(x)));

/**
 * The surfaces already placed, seen from one side of an axis: over a grid on the two other axes, how far out along `side` they reach (a
 * pillow comes down onto the mattress: y, +1; it leans back onto the headboard: z, +1, the headboard's front). A thing that comes from that
 * side keeps its vertices beyond it. Only for what is wholly on the far side: a support under the thing, not one beside it.
 */
export class DepthMap {
  private readonly d: Float32Array;
  private readonly ua: Axis;
  private readonly va: Axis;
  private readonly u0: number;
  private readonly v0: number;
  readonly nu: number;
  readonly nv: number;

  /** `min` and `max`: the box the map covers (its extent along `axis` is not used); `cell`: the grid's pitch. */
  constructor(readonly axis: Axis, readonly side: 1 | -1, min: V3, max: V3, readonly cell: number) {
    this.ua = ((axis + 1) % 3) as Axis;
    this.va = ((axis + 2) % 3) as Axis;
    this.u0 = min[this.ua];
    this.v0 = min[this.va];
    this.nu = Math.max(1, Math.ceil((max[this.ua] - this.u0) / cell));
    this.nv = Math.max(1, Math.ceil((max[this.va] - this.v0) / cell));
    this.d = new Float32Array(this.nu * this.nv).fill(-Infinity);
  }

  private put(u: number, v: number, h: number): void {
    const i = Math.floor((u - this.u0) / this.cell), j = Math.floor((v - this.v0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nu || j >= this.nv) return;
    const k = j * this.nu + i;
    if (h > this.d[k]!) this.d[k] = h;
  }

  /** The triangles of a geometry (its vertices where it stands), sampled at half a cell. */
  add(geo: BufferGeometry): this {
    const p = geo.attributes.position!, idx = geo.index, n = idx ? idx.count : p.count;
    const at = (i: number): V3 => [p.getX(i), p.getY(i), p.getZ(i)];
    for (let t = 0; t + 2 < n; t += 3) {
      const a = at(idx ? idx.getX(t) : t), b = at(idx ? idx.getX(t + 1) : t + 1), c = at(idx ? idx.getX(t + 2) : t + 2);
      // (a triangle wholly off the map is not sampled)
      const lo = (k: Axis, o: number) => Math.min(a[k], b[k], c[k]) > o + (k === this.ua ? this.nu : this.nv) * this.cell, hi = (k: Axis, o: number) => Math.max(a[k], b[k], c[k]) < o;
      if (lo(this.ua, this.u0) || lo(this.va, this.v0) || hi(this.ua, this.u0) || hi(this.va, this.v0)) continue;
      const span = Math.max(Math.hypot(a[this.ua] - b[this.ua], a[this.va] - b[this.va]), Math.hypot(b[this.ua] - c[this.ua], b[this.va] - c[this.va]), Math.hypot(c[this.ua] - a[this.ua], c[this.va] - a[this.va]));
      const m = Math.max(1, Math.ceil((span / this.cell) * 2));
      for (let i = 0; i <= m; i++) for (let j = 0; i + j <= m; j++) {
        const wa = i / m, wb = j / m, wc = 1 - wa - wb;
        const q = (k: Axis) => a[k] * wa + b[k] * wb + c[k] * wc;
        this.put(q(this.ua), q(this.va), this.side * q(this.axis));
      }
    }
    return this;
  }

  /** A flat face at `level` along the axis over the rect `min`..`max` of the two other axes (a mattress's top, a headboard's front). */
  face(level: number, min: V3, max: V3): this {
    for (let j = 0; j < this.nv; j++) for (let i = 0; i < this.nu; i++) {
      const u = this.u0 + (i + 0.5) * this.cell, v = this.v0 + (j + 0.5) * this.cell;
      if (u >= min[this.ua] && u <= max[this.ua] && v >= min[this.va] && v <= max[this.va]) this.put(u, v, this.side * level);
    }
    return this;
  }

  /** How far out along `side` the surfaces reach over a point (its own value on the axis is not read): -Infinity where there is none. */
  height(p: V3): number {
    const fu = (p[this.ua] - this.u0) / this.cell - 0.5, fv = (p[this.va] - this.v0) / this.cell - 0.5;
    const i = Math.floor(fu), j = Math.floor(fv), tu = fu - i, tv = fv - j;
    const get = (a: number, b: number) => (a < 0 || b < 0 || a >= this.nu || b >= this.nv ? -Infinity : this.d[b * this.nu + a]!);
    const h00 = get(i, j), h10 = get(i + 1, j), h01 = get(i, j + 1), h11 = get(i + 1, j + 1);
    if (h00 > -Infinity && h10 > -Infinity && h01 > -Infinity && h11 > -Infinity) return (h00 * (1 - tu) + h10 * tu) * (1 - tv) + (h01 * (1 - tu) + h11 * tu) * tv;
    // at the edge of a surface: the highest of what is there, so a vertex just past it is still held
    return Math.max(h00, h10, h01, h11);
  }

  /** The least gap between a geometry and the surfaces, along the axis (negative: it is in them; Infinity: nothing under it). */
  clearance(geo: BufferGeometry): number {
    const p = geo.attributes.position!;
    let gap = Infinity;
    for (let i = 0; i < p.count; i++) {
      const v: V3 = [p.getX(i), p.getY(i), p.getZ(i)], h = this.height(v);
      if (h > -Infinity) gap = Math.min(gap, this.side * v[this.axis] - h);
    }
    return gap;
  }

  /** Move a geometry along the axis till its gap to the surfaces is `gap` (negative presses it in). Returns the move; nothing under it, no move. */
  settle(geo: BufferGeometry, gap = 0): number {
    const c = this.clearance(geo);
    if (c === Infinity) return 0;
    const move = -this.side * (c - gap), t: [number, number, number] = [0, 0, 0];
    t[this.axis] = move;
    geo.translate(t[0], t[1], t[2]);
    return move;
  }

  /**
   * Push each vertex that is in the surfaces back out onto them, as soft cloth gives where it is pressed: within `soft` of the surface it eases
   * out (a flat patch with a rounded edge), farther off it does not move; 0 is a hard stop.
   */
  conform(geo: BufferGeometry, soft = 0): void {
    const p = geo.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const v: [number, number, number] = [p.getX(i), p.getY(i), p.getZ(i)], h = this.height(v);
      if (h === -Infinity) continue;
      const s = this.side * v[this.axis];
      const out = soft > 0 ? h + soft * softplus((s - h) / soft) : Math.max(s, h);
      if (out === s) continue;
      v[this.axis] = this.side * out;
      p.setXYZ(i, v[0], v[1], v[2]);
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
}

/**
 * Where a taut cloth lies over a solid, in a cross-section: the convex hull of the section's points, walked clockwise (y up) from the point
 * nearest `from` to the point nearest `to` (over the top, for a cloth hung over it), then pushed out by `offset` (half the cloth's thickness and
 * a gap). `at(s)` is the point `s` along it and its outward normal; past the end it runs on straight.
 */
export class Taut {
  private readonly pts: [number, number][] = [];
  private readonly nrm: [number, number][] = [];
  private readonly len: number[] = [];

  constructor(points: readonly (readonly [number, number])[], from: readonly [number, number], to: readonly [number, number], offset: number) {
    const hull = convexHull(points);
    const near = (q: readonly [number, number]) => hull.reduce((b, p, i) => (Math.hypot(p[0] - q[0], p[1] - q[1]) < Math.hypot(hull[b]![0] - q[0], hull[b]![1] - q[1]) ? i : b), 0);
    // the hull runs counter-clockwise: walk it backwards
    const n = hull.length, a = near(from), b = near(to), chain: [number, number][] = [];
    for (let i = a; ; i = (i - 1 + n) % n) { chain.push(hull[i]!); if (i === b || chain.length > n) break; }
    // each point's outward normal: the left of the way on (clockwise round a convex shape), averaged with the way in
    const seg = (i: number): [number, number] => { const p = chain[i]!, q = chain[i + 1]!, l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [-(q[1] - p[1]) / l, (q[0] - p[0]) / l]; };
    let s = 0;
    for (let i = 0; i < chain.length; i++) {
      const na = i > 0 ? seg(i - 1) : seg(0), nb = i < chain.length - 1 ? seg(i) : seg(chain.length - 2);
      const nx = na[0] + nb[0], ny = na[1] + nb[1], l = Math.hypot(nx, ny) || 1, cos = Math.max(0.3, (na[0] * nb[0] + na[1] * nb[1] + 1) / 2) ** 0.5;
      // (out far enough at a corner that the offset is the same on both faces)
      const p: [number, number] = [chain[i]![0] + (nx / l) * offset / cos, chain[i]![1] + (ny / l) * offset / cos];
      if (i > 0) s += Math.hypot(p[0] - this.pts[i - 1]![0], p[1] - this.pts[i - 1]![1]);
      this.pts.push(p);
      this.nrm.push([nx / l, ny / l]);
      this.len.push(s);
    }
  }

  /** The length of the walk. */
  get length(): number { return this.len[this.len.length - 1]!; }

  /** The point `s` along the walk and the outward normal there. */
  at(s: number): { x: number; y: number; nx: number; ny: number } {
    const L = this.len, last = L.length - 1;
    if (s >= L[last]!) {
      const p = this.pts[last]!, q = this.pts[last - 1]!, l = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, e = s - L[last]!, n = this.nrm[last]!;
      return { x: p[0] + ((p[0] - q[0]) / l) * e, y: p[1] + ((p[1] - q[1]) / l) * e, nx: n[0], ny: n[1] };
    }
    if (s <= 0) { const p = this.pts[0]!, q = this.pts[1]!, l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, n = this.nrm[0]!; return { x: p[0] + ((q[0] - p[0]) / l) * s, y: p[1] + ((q[1] - p[1]) / l) * s, nx: n[0], ny: n[1] }; }
    let lo = 0, hi = last;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m]! <= s) lo = m; else hi = m; }
    const seg = L[hi]! - L[lo]! || 1, t = (s - L[lo]!) / seg, p = this.pts[lo]!, q = this.pts[hi]!;
    // a face's own normal along it, turning to the corner's only near each end (over the length of the face beyond, at most half its own)
    const own = [-(q[1] - p[1]) / seg, (q[0] - p[0]) / seg], na = this.nrm[lo]!, nb = this.nrm[hi]!;
    const bLo = Math.min(seg / 2, lo > 0 ? L[lo]! - L[lo - 1]! : seg / 2), bHi = Math.min(seg / 2, hi < last ? L[hi + 1]! - L[hi]! : seg / 2);
    const wa = Math.max(0, 1 - (s - L[lo]!) / (bLo || 1)), wb = Math.max(0, 1 - (L[hi]! - s) / (bHi || 1));
    const nx = own[0]! + wa * (na[0] - own[0]!) + wb * (nb[0] - own[0]!), ny = own[1]! + wa * (na[1] - own[1]!) + wb * (nb[1] - own[1]!), l = Math.hypot(nx, ny) || 1;
    return { x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t, nx: nx / l, ny: ny / l };
  }
}

/** The convex hull of points, counter-clockwise (y up), no point on an edge twice. */
export function convexHull(points: readonly (readonly [number, number])[]): [number, number][] {
  const p = [...points].map((q) => [q[0], q[1]] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Points round a quarter (or any part) of a circle: centre, radius, from and to angles (radians, counter-clockwise from +x), `n` steps. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 8): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number]; });
}
