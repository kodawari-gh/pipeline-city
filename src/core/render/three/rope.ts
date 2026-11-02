// A cable that hangs (docs/GRAPHICS_3D_OVERHAUL.md "Cables"): a chain of points settled by Verlet steps under gravity, its segments held at
// their length, its bends eased by a stiffness, kept out of the boxes and off the planes it lies on. Each end leaves its plug straight (two points
// pinned along the plug's direction); an end left free hangs, its plug where it falls. Pure maths, no Three: the same inputs give the same curve.

export type V3 = [number, number, number];

/** A cable end: where it is and the way the cable leaves it (a unit vector, out of the plug into the cable). */
export interface RopeEnd { at: V3; dir: V3 }

/** Keep the points on the side of the plane where dot(p, n) >= d (the floor, a desk top, the tray, the glass). */
export interface Plane { n: V3; d: number }

/** Keep the points out of this box (world min and max corners). */
export interface Solid { min: V3; max: V3 }

export interface RopeSpec {
  a: RopeEnd;
  /** The other end, or null: it hangs free from `a`. */
  b: RopeEnd | null;
  /** The cable's length (at least the distance between the ends, or it is pulled taut). */
  length: number;
  /** The cable's radius: it keeps this far off the planes and the boxes. */
  r?: number;
  /** How many points (more: rounder). */
  n?: number;
  /** 0 a limp cord, 1 a stiff hose or a fat bundle: how strongly each bend is eased toward a straight line. */
  stiff?: number;
  planes?: Plane[];
  solids?: Solid[];
  /** Down, in the world (default -y). */
  down?: V3;
  /** How far the straight lead out of each plug runs before the cable may bend (default one segment). */
  lead?: number;
  /** How much of its weight pulls it (default 1): a lead combed into place holds its arcs, a loose cord sags fully. */
  sag?: number;
  /** The start curve's handles, in gaps (default: at least half the length): longer handles round a U-turn out of two parallel plugs. */
  handle?: number;
}

const ITER = 420, PASSES = 10;

/** The cables settled lately, by their spec: a rebuild hangs again only the ones whose ends or surroundings changed. */
const SETTLED = new Map<string, V3[]>();
const SETTLED_MAX = 400;

/** The settled cable, from `a` to `b` (or to its free end). */
export function hang(s: RopeSpec): V3[] {
  const key = JSON.stringify(s);
  let p = SETTLED.get(key);
  if (p) SETTLED.delete(key);
  else p = settle(s);
  SETTLED.set(key, p);
  if (SETTLED.size > SETTLED_MAX) SETTLED.delete(SETTLED.keys().next().value!);
  return p.map((q) => [...q] as V3);
}

/** The Verlet steps (`hang`): a rope stepped until its points come to rest. */
function settle(s: RopeSpec): V3[] {
  const rope = new Rope(s);
  rope.step(ITER);
  return rope.points();
}

/**
 * A cable's Verlet chain (`hang`), on flat arrays: the points' x, y, z in turn. `hang` steps one to rest; a held cable keeps one and steps
 * it a few times a frame while its ends move (`setEnds`). A box farther than the cable can reach is left out.
 */
export class Rope {
  readonly n: number;
  /** The cable's length (between its end points, along the chain). */
  readonly length: number;
  private readonly p: Float64Array;
  private readonly prev: Float64Array;
  private readonly pinned: Uint8Array;
  private pins: [number, V3][] = [];
  private rest: number[] = [];
  private readonly seg: number;
  private readonly lead: number;
  private readonly r: number;
  private readonly stiff: number;
  private readonly bend: number;
  private readonly g: V3;
  private readonly planes: Plane[];
  private readonly solids: Solid[];
  private readonly rest2: number;
  /** Steps since the ends last moved, and whether the points have come to rest since. */
  private age = 0;
  private rested = false;

  /**
   * The rope of `s`, from its start curve or from `start` (n points, a cable already hanging). A `live` rope keeps every box within its length
   * of `a`, since its other end will move.
   */
  constructor(s: RopeSpec, o: { live?: boolean; start?: readonly V3[] } = {}) {
    const n = this.n = Math.max(6, s.n ?? 28), r = this.r = s.r ?? 0, stiff = this.stiff = Math.min(1, Math.max(0, s.stiff ?? 0.3)), down = s.down ?? [0, -1, 0];
    const a = s.a, b = s.b, chord = b ? dist(a.at, b.at) : 0, L = this.length = Math.max(s.length, chord * 1.0005, 1), seg = this.seg = L / (n - 1);
    const lead = this.lead = Math.min(s.lead ?? seg, L * 0.3);
    this.pinned = new Uint8Array(n);
    // start from a smooth curve between the ends (a Hermite curve along the plug directions), or straight out and down from a free end
    const p = this.p = new Float64Array(n * 3), k = s.handle !== undefined ? chord * s.handle : Math.max(chord, L * 0.5);
    if (o.start?.length === n) for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) p[i * 3 + j] = o.start[i]![j]!;
    else for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      if (b) {
        const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
        for (let j = 0; j < 3; j++) p[i * 3 + j] = h00 * a.at[j]! + h10 * a.dir[j]! * k + h01 * b.at[j]! - h11 * b.dir[j]! * k;
      } else {
        const s1 = Math.min(t * L, lead * 2), s2 = Math.max(0, t * L - lead * 2);
        for (let j = 0; j < 3; j++) p[i * 3 + j] = a.at[j]! + a.dir[j]! * s1 + down[j]! * s2;
      }
    }
    const w = seg * 0.012 * (s.sag ?? 1);
    this.prev = p.slice();
    this.g = [down[0] * w, down[1] * w, down[2] * w];
    // the bend limit: no joint turns more than `maxTurn` (a cable bends round, it never folds), held as a least distance between every other point
    this.bend = Math.cos((0.45 + (1 - stiff) * 0.55) / 2);
    // the cable stays within its length of its ends: a box out of that reach (with a margin for the first swings) is never met
    const c = b && !o.live ? [0, 1, 2].map((j) => (a.at[j]! + b.at[j]!) / 2) : a.at, reach = (b && !o.live ? L / 2 : L) * 1.25 + r;
    this.solids = (s.solids ?? []).filter((x) => [0, 1, 2].every((j) => x.min[j]! - r < c[j]! + reach && x.max[j]! + r > c[j]! - reach));
    this.planes = s.planes ?? [];
    this.rest2 = (seg * 1e-4) ** 2;
    this.setEnds(a, b);
  }

  /** Move the ends (each leaves straight along its direction); `b` null lets that end go free. */
  setEnds(a: RopeEnd, b: RopeEnd | null): void {
    const { n, lead, pinned } = this;
    const pins: [number, V3][] = [[0, a.at], [1, add(a.at, mul(a.dir, lead))]];
    if (b) pins.push([n - 1, b.at], [n - 2, add(b.at, mul(b.dir, lead))]);
    const moved = pins.length !== this.pins.length || pins.some(([i, q], k) => this.pins[k]![0] !== i || dist(q, this.pins[k]![1]) > 1e-9);
    if (!moved) return;
    pinned.fill(0);
    for (const [i] of pins) pinned[i] = 1;
    this.pins = pins;
    this.rest = Array.from({ length: n - 1 }, (_, i) => (pinned[i] && pinned[i + 1] ? dist(pins.find(([j]) => j === i)![1], pins.find(([j]) => j === i + 1)![1]) : this.seg));
    this.age = 0;
    this.rested = false;
    this.pin();
  }

  /** Have the points come to rest since the ends last moved? */
  get resting(): boolean { return this.rested; }

  /** Up to `k` steps (none once at rest). Returns whether it is at rest. */
  step(k = 1): boolean {
    const { n, p, prev, pinned } = this, [gx, gy, gz] = this.g;
    for (let s = 0; s < k && !this.rested; s++) {
      // move: the velocity (damped) and gravity
      let still = true;
      for (let i = 0; i < n; i++) {
        if (pinned[i]) continue;
        const o = i * 3, vx = p[o]! - prev[o]!, vy = p[o + 1]! - prev[o + 1]!, vz = p[o + 2]! - prev[o + 2]!;
        if (vx * vx + vy * vy + vz * vz > this.rest2) still = false;
        prev[o] = p[o]!; prev[o + 1] = p[o + 1]!; prev[o + 2] = p[o + 2]!;
        p[o] = p[o]! + vx * 0.96 + gx; p[o + 1] = p[o + 1]! + vy * 0.96 + gy; p[o + 2] = p[o + 2]! + vz * 0.96 + gz;
      }
      // at rest: what is left of the steps would move no point by a ten-thousandth of a segment
      if (still && this.age > 40) { this.rested = true; break; }
      this.age++;
      this.relax();
    }
    return this.rested;
  }

  /** The points, from `a`. */
  points(): V3[] {
    return Array.from({ length: this.n }, (_, i) => [this.p[i * 3]!, this.p[i * 3 + 1]!, this.p[i * 3 + 2]!] as V3);
  }

  /** The last point and the way the cable runs into it (a free end's plug hangs along it). */
  tip(): { at: V3; dir: V3 } {
    const { n, p } = this, o = (n - 1) * 3, q = (n - 2) * 3, d: V3 = [p[o]! - p[q]!, p[o + 1]! - p[q + 1]!, p[o + 2]! - p[q + 2]!], l = Math.hypot(...d) || 1;
    return { at: [p[o]!, p[o + 1]!, p[o + 2]!], dir: [d[0] / l, d[1] / l, d[2] / l] };
  }

  private pin() {
    for (const [i, q] of this.pins) for (let j = 0; j < 3; j++) this.p[i * 3 + j] = this.prev[i * 3 + j] = q[j]!;
  }

  /** The constraints, a few passes: the stiffness, the bend limit, the lengths, what the cable lies on. */
  private relax() {
    const { n, p, pinned, rest, seg, r, stiff, bend, planes, solids } = this;
    for (let pass = 0; pass < PASSES; pass++) {
      // the stiffness: each inner point eased toward the middle of its neighbours (before the lengths, which have the last word)
      if (stiff > 0) for (let i = 1; i + 1 < n; i++) {
        if (pinned[i]) continue;
        for (let j = 0; j < 3; j++) { const o = i * 3 + j; p[o] = p[o]! + ((p[o - 3]! + p[o + 3]!) * 0.5 - p[o]!) * (stiff * 0.35); }
      }
      for (let i = 0; i + 2 < n; i++) {
        const o = i * 3, q = o + 6, dx = p[q]! - p[o]!, dy = p[q + 1]! - p[o + 1]!, dz = p[q + 2]! - p[o + 2]!;
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6, least = (rest[i]! + rest[i + 1]!) * bend;
        if (l >= least) continue;
        const wa = pinned[i] ? 0 : 1, wc = pinned[i + 2] ? 0 : 1, w = wa + wc;
        if (!w) continue;
        const f = (l - least) / l, fa = (f * wa) / w, fc = (f * wc) / w;
        p[o] = p[o]! + dx * fa; p[o + 1] = p[o + 1]! + dy * fa; p[o + 2] = p[o + 2]! + dz * fa;
        p[q] = p[q]! - dx * fc; p[q + 1] = p[q + 1]! - dy * fc; p[q + 2] = p[q + 2]! - dz * fc;
      }
      // each segment back to its length, from both ends in turn
      for (let k = 0; k < 2; k++) for (let j = 0; j + 1 < n; j++) {
        const i = k ? n - 2 - j : j, o = i * 3, q = o + 3, dx = p[q]! - p[o]!, dy = p[q + 1]! - p[o + 1]!, dz = p[q + 2]! - p[o + 2]!;
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6, f = (l - seg) / l;
        const wa = pinned[i] ? 0 : 1, wb = pinned[i + 1] ? 0 : 1, w = wa + wb;
        if (!w) continue;
        const fa = (f * wa) / w, fb = (f * wb) / w;
        p[o] = p[o]! + dx * fa; p[o + 1] = p[o + 1]! + dy * fa; p[o + 2] = p[o + 2]! + dz * fa;
        p[q] = p[q]! - dx * fb; p[q + 1] = p[q + 1]! - dy * fb; p[q + 2] = p[q + 2]! - dz * fb;
      }
      // what the cable lies on and goes round
      for (let i = 0; i < n; i++) {
        if (pinned[i]) continue;
        const o = i * 3;
        for (const pl of planes) {
          const e = p[o]! * pl.n[0] + p[o + 1]! * pl.n[1] + p[o + 2]! * pl.n[2] - pl.d - r;
          if (e < 0) { p[o] = p[o]! - pl.n[0] * e; p[o + 1] = p[o + 1]! - pl.n[1] * e; p[o + 2] = p[o + 2]! - pl.n[2] * e; }
        }
        for (const bx of solids) outOf(p, o, bx, r);
      }
      this.pin();
    }
  }
}

/** Push the point at `p[o..o+2]` out of the box (grown by r) through its nearest face. */
function outOf(p: Float64Array, o: number, bx: Solid, r: number): void {
  let best = -1, gap = Infinity, to = 0;
  for (let j = 0; j < 3; j++) {
    const lo = bx.min[j]! - r, hi = bx.max[j]! + r, q = p[o + j]!;
    if (q <= lo || q >= hi) return;
    if (q - lo < gap) { gap = q - lo; best = j; to = lo; }
    if (hi - q < gap) { gap = hi - q; best = j; to = hi; }
  }
  p[o + best] = to;
}

/**
 * The length a routed cable needs between two ends: the smooth curve that leaves each end along its plug (the Hermite curve `settle` starts
 * from, its handles `handle` gaps long). A cable this long runs in clean arcs; more slack has to fold somewhere.
 */
export function naturalLength(a: RopeEnd, b: RopeEnd, handle = 1, steps = 64): number {
  const k = dist(a.at, b.at) * handle;
  let len = 0, prev = a.at;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
    const q = [0, 1, 2].map((j) => h00 * a.at[j]! + h10 * a.dir[j]! * k + h01 * b.at[j]! - h11 * b.dir[j]! * k) as V3;
    len += dist(prev, q);
    prev = q;
  }
  return len;
}

/** The length of a polyline. */
export const lengthOf = (pts: readonly V3[]): number => pts.reduce((s, q, i) => (i ? s + dist(q, pts[i - 1]!) : 0), 0);

const add = (x: V3, y: V3): V3 => [x[0] + y[0], x[1] + y[1], x[2] + y[2]];
const mul = (x: V3, k: number): V3 => [x[0] * k, x[1] * k, x[2] * k];
export const dist = (x: V3, y: V3): number => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
