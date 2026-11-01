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

/**
 * The Verlet steps (`hang`), on flat arrays: the points' x, y, z in turn. A box farther than the cable can reach is left out, and the steps stop
 * once the points have come to rest.
 */
function settle(s: RopeSpec): V3[] {
  const n = Math.max(6, s.n ?? 28), r = s.r ?? 0, stiff = Math.min(1, Math.max(0, s.stiff ?? 0.3)), down = s.down ?? [0, -1, 0];
  const a = s.a, b = s.b, chord = b ? dist(a.at, b.at) : 0, L = Math.max(s.length, chord * 1.0005, 1), seg = L / (n - 1);
  const lead = Math.min(s.lead ?? seg, L * 0.3);
  const pinned = new Uint8Array(n), pins: [number, V3][] = [];
  const pinTo = (i: number, q: V3) => { pinned[i] = 1; pins.push([i, q]); };
  pinTo(0, a.at);
  pinTo(1, add(a.at, mul(a.dir, lead)));
  if (b) { pinTo(n - 1, b.at); pinTo(n - 2, add(b.at, mul(b.dir, lead))); }
  const pinAt = (i: number) => pins.find(([j]) => j === i)![1];
  // start from a smooth curve between the ends (a Hermite curve along the plug directions), or straight out and down from a free end
  const p = new Float64Array(n * 3), k = Math.max(chord, L * 0.5);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (b) {
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
      for (let j = 0; j < 3; j++) p[i * 3 + j] = h00 * a.at[j]! + h10 * a.dir[j]! * k + h01 * b.at[j]! - h11 * b.dir[j]! * k;
    } else {
      const s1 = Math.min(t * L, lead * 2), s2 = Math.max(0, t * L - lead * 2);
      for (let j = 0; j < 3; j++) p[i * 3 + j] = a.at[j]! + a.dir[j]! * s1 + down[j]! * s2;
    }
  }
  const prev = p.slice(), gx = down[0] * seg * 0.012, gy = down[1] * seg * 0.012, gz = down[2] * seg * 0.012;
  const pin = () => { for (const [i, q] of pins) for (let j = 0; j < 3; j++) p[i * 3 + j] = prev[i * 3 + j] = q[j]!; };
  // the bend limit: no joint turns more than `maxTurn` (a cable bends round, it never folds), held as a least distance between every other point
  const rest = Array.from({ length: n - 1 }, (_, i) => (pinned[i] && pinned[i + 1] ? dist(pinAt(i), pinAt(i + 1)) : seg));
  const maxTurn = 0.45 + (1 - stiff) * 0.55, bend = Math.cos(maxTurn / 2);
  // the cable stays within its length of its ends: a box out of that reach (with a margin for the first swings) is never met
  const c = b ? [0, 1, 2].map((j) => (a.at[j]! + b.at[j]!) / 2) : a.at, reach = (b ? L / 2 : L) * 1.25 + r;
  const solids = (s.solids ?? []).filter((x) => [0, 1, 2].every((j) => x.min[j]! - r < c[j]! + reach && x.max[j]! + r > c[j]! - reach));
  const planes = s.planes ?? [], rest2 = (seg * 1e-4) ** 2;
  pin();
  for (let it = 0; it < ITER; it++) {
    // move: the velocity (damped) and gravity
    let still = true;
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const o = i * 3, vx = p[o]! - prev[o]!, vy = p[o + 1]! - prev[o + 1]!, vz = p[o + 2]! - prev[o + 2]!;
      if (vx * vx + vy * vy + vz * vz > rest2) still = false;
      prev[o] = p[o]!; prev[o + 1] = p[o + 1]!; prev[o + 2] = p[o + 2]!;
      p[o] = p[o]! + vx * 0.96 + gx; p[o + 1] = p[o + 1]! + vy * 0.96 + gy; p[o + 2] = p[o + 2]! + vz * 0.96 + gz;
    }
    // at rest: what is left of the steps would move no point by a ten-thousandth of a segment
    if (still && it > 40) break;
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
      pin();
    }
  }
  return Array.from({ length: n }, (_, i) => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!] as V3);
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

/** The length of a polyline. */
export const lengthOf = (pts: readonly V3[]): number => pts.reduce((s, q, i) => (i ? s + dist(q, pts[i - 1]!) : 0), 0);

const add = (x: V3, y: V3): V3 => [x[0] + y[0], x[1] + y[1], x[2] + y[2]];
const mul = (x: V3, k: number): V3 => [x[0] * k, x[1] * k, x[2] * k];
export const dist = (x: V3, y: V3): number => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
