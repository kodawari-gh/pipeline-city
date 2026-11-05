// The cloth solver (docs/render/cloth.md): extended position-based dynamics in small steps (one pass of the constraints a step, many steps).
// The bake runs it offline, never in a frame. Stretch is held hard along the triangles' sides, bending is soft across them, sewn pairs are
// pulled together at a set speed until they meet. The cloth keeps `thickness` off the solids, with friction, and points that are not
// neighbours keep `self` apart (a hash grid), so folded layers do not pass through each other. Pure maths.
import type { ClothMesh } from './pattern';
import { gradient, type Sdf } from './solid';

export interface ClothParams {
  /** Steps a second. */
  rate: number;
  /** How far the cloth keeps off the solids (mm). */
  thickness: number;
  /** How far apart points keep that are not neighbours (mm; 0: no self-collision). */
  self: number;
  /**
   * Stretch compliance: higher is softer. Keep it above 0: sides that cannot all be at their length (a seam a hair longer than its mate)
   * make a hard cloth shiver.
   */
  stretch: number;
  /** Bending compliance: higher is softer. */
  bend: number;
  /** Friction on the solids: static, sliding. */
  friction: readonly [number, number];
}

export interface Phase {
  /** Seconds of cloth time. */
  time: number;
  /** Down, in mm/s² (0 while the pieces are sewn). */
  gravity: number;
  solid: Sdf;
  /**
   * How fast the seams close (mm/s); Infinity holds them shut. Sew with `keep` 0: a seam that closes while the cloth keeps its speed pumps
   * it up (the pieces start near their seams, so sewing is a short pull).
   */
  sew: number;
  /** The share of its speed the cloth keeps after a second (air drag); 0 keeps none: it moves only as it is pulled (sewing). */
  keep: number;
  /** An extra acceleration (a push, wind) on a point of piece `piece` at (x, y, z), at the phase's time t: added to `out`. */
  push?: (piece: number, x: number, y: number, z: number, t: number, out: [number, number, number]) => void;
}

const MAX_SPEED = 4000;
/** How far (mm, across) each point starts off where its piece is placed. */
const JITTER = 1;
/** How much of their difference in motion two touching layers give up each step. */
const SELF_FRICTION = 0.6;

export class Cloth {
  readonly p: Float64Array;
  private readonly q: Float64Array;
  private readonly v: Float64Array;
  /** For each welded point, the welded points it never pushes off (itself and two rings of neighbours), sorted. */
  private readonly near: Int32Array[];
  /** The self-collision grid: each cell's first entry in `cellPts` (counting sort), the points by cell. */
  private cellStart = new Int32Array(1);
  private readonly cellPts: Int32Array;
  private readonly cellOf: Int32Array;
  /** How far each point is known to be from the solids, less how far it has moved since: it is tested again only when that runs low. */
  private readonly clear: Float64Array;

  constructor(readonly mesh: ClothMesh, readonly o: ClothParams) {
    const n = mesh.n;
    this.p = Float64Array.from(mesh.start);
    // a flat piece pushed together along itself folds over within its plane and never stills: it starts a hair off it, so it buckles
    for (let k = 0, s = 1; k < 3 * n; k++) { s = (s * 16807) % 2147483647; this.p[k] = this.p[k]! + (s / 2147483647 - 0.5) * JITTER; }
    this.q = Float64Array.from(this.p);
    this.v = new Float64Array(3 * n);
    const W = mesh.weld, adj: Set<number>[] = [];
    for (let i = 0; i < n; i++) adj[W[i]!] ??= new Set([W[i]!]);
    for (let e = 0; e < mesh.edges.length; e += 2) {
      const a = W[mesh.edges[e]!]!, b = W[mesh.edges[e + 1]!]!;
      adj[a]!.add(b); adj[b]!.add(a);
    }
    this.near = [];
    for (let r = 0; r < n; r++) {
      if (!adj[r]) continue;
      const ring = new Set<number>();
      for (const a of adj[r]!) for (const b of adj[a]!) ring.add(b);
      this.near[r] = Int32Array.from(ring).sort();
    }
    this.cellPts = new Int32Array(n);
    this.cellOf = new Int32Array(n);
    this.clear = new Float64Array(n);
  }

  /** Step the cloth through a phase. */
  run(ph: Phase): void {
    const steps = Math.max(1, Math.round(ph.time * this.o.rate)), dt = ph.time / steps;
    this.clear.fill(-Infinity);
    for (let s = 0; s < steps; s++) this.step(ph, dt, s * dt);
  }

  private step(ph: Phase, dt: number, t: number): void {
    const { p, q, v, mesh: m, o } = this, n = m.n, damp = Math.pow(ph.keep, dt), acc: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const k = 3 * i;
      acc[0] = 0; acc[1] = -ph.gravity; acc[2] = 0;
      ph.push?.(m.piece[i]!, p[k]!, p[k + 1]!, p[k + 2]!, t, acc);
      let vx = (v[k]! + acc[0] * dt) * damp, vy = (v[k + 1]! + acc[1] * dt) * damp, vz = (v[k + 2]! + acc[2] * dt) * damp;
      const sp = Math.hypot(vx, vy, vz);
      if (sp > MAX_SPEED) { vx *= MAX_SPEED / sp; vy *= MAX_SPEED / sp; vz *= MAX_SPEED / sp; }
      q[k] = p[k]!; q[k + 1] = p[k + 1]!; q[k + 2] = p[k + 2]!;
      p[k] = p[k]! + vx * dt; p[k + 1] = p[k + 1]! + vy * dt; p[k + 2] = p[k + 2]! + vz * dt;
    }
    // the seams close at their speed, each side half the way
    const reach = ph.sew * dt;
    for (let e = 0; e < m.sewn.length; e += 2) {
      const a = 3 * m.sewn[e]!, b = 3 * m.sewn[e + 1]!;
      const dx = p[b]! - p[a]!, dy = p[b + 1]! - p[a + 1]!, dz = p[b + 2]! - p[a + 2]!, d = Math.hypot(dx, dy, dz);
      if (d < 1e-9) continue;
      const k = (0.5 * Math.min(d, reach)) / d;
      p[a] = p[a]! + dx * k; p[a + 1] = p[a + 1]! + dy * k; p[a + 2] = p[a + 2]! + dz * k;
      p[b] = p[b]! - dx * k; p[b + 1] = p[b + 1]! - dy * k; p[b + 2] = p[b + 2]! - dz * k;
    }
    this.lengths(m.edges, m.rest, o.stretch / (dt * dt));
    this.lengths(m.bends, m.bendRest, o.bend / (dt * dt));
    if (o.self > 0) this.selfCollide(o.self);
    this.collide(ph.solid);
    const inv = 1 / dt;
    for (let k = 0; k < 3 * n; k++) v[k] = (p[k]! - q[k]!) * inv;
  }

  /** One pass of distance constraints with compliance `a` (already over dt²): each point of a pair takes half the correction. */
  private lengths(pairs: Uint32Array, rest: Float64Array, a: number): void {
    const p = this.p, w = 1 / (2 + a);
    for (let e = 0, c = 0; e < pairs.length; e += 2, c++) {
      const i = 3 * pairs[e]!, j = 3 * pairs[e + 1]!;
      const dx = p[j]! - p[i]!, dy = p[j + 1]! - p[i + 1]!, dz = p[j + 2]! - p[i + 2]!, d = Math.hypot(dx, dy, dz);
      if (d < 1e-9) continue;
      const k = ((d - rest[c]!) * w) / d;
      p[i] = p[i]! + dx * k; p[i + 1] = p[i + 1]! + dy * k; p[i + 2] = p[i + 2]! + dz * k;
      p[j] = p[j]! - dx * k; p[j + 1] = p[j + 1]! - dy * k; p[j + 2] = p[j + 2]! - dz * k;
    }
  }

  /** Points that are not neighbours push each other off to `r` apart, found through a grid of cells `r` wide over the cloth's box. */
  private selfCollide(r: number): void {
    const { p, q, cellPts, cellOf, near } = this, n = this.mesh.n, W = this.mesh.weld, inv = 1 / r;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3 * n; k += 3) {
      x0 = Math.min(x0, p[k]!); x1 = Math.max(x1, p[k]!); y0 = Math.min(y0, p[k + 1]!); y1 = Math.max(y1, p[k + 1]!); z0 = Math.min(z0, p[k + 2]!); z1 = Math.max(z1, p[k + 2]!);
    }
    const nx = Math.floor((x1 - x0) * inv) + 1, ny = Math.floor((y1 - y0) * inv) + 1, nz = Math.floor((z1 - z0) * inv) + 1, cells = nx * ny * nz;
    // (a cloth thrown metres wide has blown up: no grid for it)
    if (!(cells < 3e7)) return;
    if (this.cellStart.length < cells + 1) this.cellStart = new Int32Array(cells + 1);
    const cellStart = this.cellStart;
    cellStart.fill(0, 0, cells + 1);
    for (let i = 0; i < n; i++) {
      const c = Math.floor((p[3 * i]! - x0) * inv) + nx * (Math.floor((p[3 * i + 1]! - y0) * inv) + ny * Math.floor((p[3 * i + 2]! - z0) * inv));
      cellOf[i] = c; cellStart[c]!++;
    }
    for (let c = 0, s = 0; c <= cells; c++) { s += cellStart[c]!; cellStart[c] = s; }
    for (let i = 0; i < n; i++) cellPts[--cellStart[cellOf[i]!]!] = i;
    const r2 = r * r;
    for (let i = 0; i < n; i++) {
      const a = 3 * i, cx = Math.floor((p[a]! - x0) * inv), cy = Math.floor((p[a + 1]! - y0) * inv), cz = Math.floor((p[a + 2]! - z0) * inv), skip = near[W[i]!]!;
      for (let dz = cz > 0 ? -1 : 0; dz <= (cz < nz - 1 ? 1 : 0); dz++) for (let dy = cy > 0 ? -1 : 0; dy <= (cy < ny - 1 ? 1 : 0); dy++) {
        const row = nx * (cy + dy + ny * (cz + dz));
        const s0 = cellStart[row + Math.max(0, cx - 1)]!, s1 = cellStart[row + Math.min(nx - 1, cx + 1) + 1]!;
        for (let s = s0; s < s1; s++) {
          const j = cellPts[s]!;
          if (j <= i) continue;
          const b = 3 * j, ex = p[b]! - p[a]!, ey = p[b + 1]! - p[a + 1]!, ez = p[b + 2]! - p[a + 2]!, d2 = ex * ex + ey * ey + ez * ez;
          if (d2 >= r2 || d2 < 1e-12 || has(skip, W[j]!)) continue;
          const d = Math.sqrt(d2), k = (0.5 * (r - d)) / d;
          p[a] = p[a]! - ex * k; p[a + 1] = p[a + 1]! - ey * k; p[a + 2] = p[a + 2]! - ez * k;
          p[b] = p[b]! + ex * k; p[b + 1] = p[b + 1]! + ey * k; p[b + 2] = p[b + 2]! + ez * k;
          // friction between the layers: both move this step more nearly by their average, so a stack does not shiver
          for (let c = 0; c < 3; c++) {
            const da = p[a + c]! - q[a + c]!, db = p[b + c]! - q[b + c]!, mid = (da + db) / 2;
            p[a + c] = p[a + c]! + (mid - da) * SELF_FRICTION; p[b + c] = p[b + c]! + (mid - db) * SELF_FRICTION;
          }
        }
      }
    }
  }

  /** Out of the solids to `thickness` off them; friction takes back the slide along the surface this step, as far as the push allows. */
  private collide(f: Sdf): void {
    const { p, q, o, clear } = this, n = this.mesh.n, g: [number, number, number] = [0, 0, 0], [ms, mk] = o.friction;
    for (let i = 0; i < n; i++) {
      const k = 3 * i;
      clear[i] = clear[i]! - Math.hypot(p[k]! - q[k]!, p[k + 1]! - q[k + 1]!, p[k + 2]! - q[k + 2]!);
      if (clear[i]! > o.thickness + 1) continue;
      const free = f(p[k]!, p[k + 1]!, p[k + 2]!), d = free - o.thickness;
      clear[i] = Math.max(free, o.thickness);
      if (d >= 0) continue;
      gradient(f, p[k]!, p[k + 1]!, p[k + 2]!, g);
      p[k] = p[k]! - g[0] * d; p[k + 1] = p[k + 1]! - g[1] * d; p[k + 2] = p[k + 2]! - g[2] * d;
      const mx = p[k]! - q[k]!, my = p[k + 1]! - q[k + 1]!, mz = p[k + 2]! - q[k + 2]!, along = mx * g[0] + my * g[1] + mz * g[2];
      const tx = mx - along * g[0], ty = my - along * g[1], tz = mz - along * g[2], slide = Math.hypot(tx, ty, tz), depth = -d;
      if (slide < 1e-12) continue;
      const back = slide < ms * depth ? 1 : Math.min(1, (mk * depth) / slide);
      p[k] = p[k]! - tx * back; p[k + 1] = p[k + 1]! - ty * back; p[k + 2] = p[k + 2]! - tz * back;
    }
  }

  /** How settled it is: the widest open seam, the most stretched side (share over its rest), the fastest point (mm/s). */
  stats(): { seam: number; stretch: number; speed: number } {
    const { p, v, mesh: m } = this;
    let seam = 0, stretch = 0, speed = 0;
    for (let e = 0; e < m.sewn.length; e += 2) {
      const a = 3 * m.sewn[e]!, b = 3 * m.sewn[e + 1]!;
      seam = Math.max(seam, Math.hypot(p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!));
    }
    for (let e = 0, c = 0; e < m.edges.length; e += 2, c++) {
      const a = 3 * m.edges[e]!, b = 3 * m.edges[e + 1]!;
      stretch = Math.max(stretch, Math.hypot(p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!) / m.rest[c]! - 1);
    }
    for (let i = 0; i < m.n; i++) speed = Math.max(speed, Math.hypot(v[3 * i]!, v[3 * i + 1]!, v[3 * i + 2]!));
    return { seam, stretch, speed };
  }
}

/** Is `x` in the sorted list. */
function has(list: Int32Array, x: number): boolean {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, y = list[mid]!;
    if (y === x) return true;
    if (y < x) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}
