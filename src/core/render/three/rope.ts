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

/** The settled cable, from `a` to `b` (or to its free end). */
export function hang(s: RopeSpec): V3[] {
  const n = Math.max(6, s.n ?? 28), r = s.r ?? 0, stiff = Math.min(1, Math.max(0, s.stiff ?? 0.3)), down = s.down ?? [0, -1, 0];
  const a = s.a, b = s.b, chord = b ? dist(a.at, b.at) : 0, L = Math.max(s.length, chord * 1.0005, 1), seg = L / (n - 1);
  const lead = Math.min(s.lead ?? seg, L * 0.3);
  const pins = new Map<number, V3>();
  pins.set(0, a.at);
  pins.set(1, add(a.at, mul(a.dir, lead)));
  if (b) { pins.set(n - 1, b.at); pins.set(n - 2, add(b.at, mul(b.dir, lead))); }
  // start from a smooth curve between the ends (a Hermite curve along the plug directions), or straight out and down from a free end
  const p: V3[] = [], k = Math.max(chord, L * 0.5);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (b) {
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
      p.push([0, 1, 2].map((j) => h00 * a.at[j]! + h10 * a.dir[j]! * k + h01 * b.at[j]! - h11 * b.dir[j]! * k) as V3);
    } else {
      const s1 = Math.min(t * L, lead * 2), s2 = Math.max(0, t * L - lead * 2);
      p.push(add(add(a.at, mul(a.dir, s1)), mul(down, s2)));
    }
  }
  const prev = p.map((q) => [...q] as V3), g = mul(down, seg * 0.012);
  const pin = () => { for (const [i, q] of pins) { p[i] = [...q]; prev[i] = [...q]; } };
  // the bend limit: no joint turns more than `maxTurn` (a cable bends round, it never folds), held as a least distance between every other point
  const rest = Array.from({ length: n - 1 }, (_, i) => (pins.has(i) && pins.has(i + 1) ? dist(pins.get(i)!, pins.get(i + 1)!) : seg));
  const maxTurn = 0.45 + (1 - stiff) * 0.55, bend = Math.cos(maxTurn / 2);
  pin();
  for (let it = 0; it < ITER; it++) {
    // move: the velocity (damped) and gravity
    for (let i = 0; i < n; i++) {
      if (pins.has(i)) continue;
      const q = p[i]!, v = sub(q, prev[i]!);
      prev[i] = [...q];
      p[i] = add(add(q, mul(v, 0.96)), g);
    }
    for (let pass = 0; pass < PASSES; pass++) {
      // the stiffness: each inner point eased toward the middle of its neighbours (before the lengths, which have the last word)
      if (stiff > 0) for (let i = 1; i + 1 < n; i++) {
        if (pins.has(i)) continue;
        const m = mul(add(p[i - 1]!, p[i + 1]!), 0.5);
        p[i] = add(p[i]!, mul(sub(m, p[i]!), stiff * 0.35));
      }
      for (let i = 0; i + 2 < n; i++) {
        const d = sub(p[i + 2]!, p[i]!), l = Math.hypot(...d) || 1e-6, least = (rest[i]! + rest[i + 1]!) * bend;
        if (l >= least) continue;
        const wa = pins.has(i) ? 0 : 1, wc = pins.has(i + 2) ? 0 : 1, w = wa + wc;
        if (!w) continue;
        const f = (l - least) / l;
        p[i] = add(p[i]!, mul(d, (f * wa) / w));
        p[i + 2] = sub(p[i + 2]!, mul(d, (f * wc) / w));
      }
      // each segment back to its length, from both ends in turn
      for (let k = 0; k < 2; k++) for (let j = 0; j + 1 < n; j++) {
        const i = k ? n - 2 - j : j, d = sub(p[i + 1]!, p[i]!), l = Math.hypot(...d) || 1e-6, f = (l - seg) / l;
        const wa = pins.has(i) ? 0 : 1, wb = pins.has(i + 1) ? 0 : 1, w = wa + wb;
        if (!w) continue;
        p[i] = add(p[i]!, mul(d, (f * wa) / w));
        p[i + 1] = sub(p[i + 1]!, mul(d, (f * wb) / w));
      }
      // what the cable lies on and goes round
      for (let i = 0; i < n; i++) {
        if (pins.has(i)) continue;
        for (const pl of s.planes ?? []) {
          const e = dot(p[i]!, pl.n) - pl.d - r;
          if (e < 0) p[i] = sub(p[i]!, mul(pl.n, e));
        }
        for (const bx of s.solids ?? []) p[i] = outOf(p[i]!, bx, r);
      }
      pin();
    }
  }
  return p;
}

/** The point pushed out of the box (grown by r) through its nearest face. */
function outOf(q: V3, bx: Solid, r: number): V3 {
  let best = -1, gap = Infinity, to = 0;
  for (let j = 0; j < 3; j++) {
    const lo = bx.min[j]! - r, hi = bx.max[j]! + r;
    if (q[j]! <= lo || q[j]! >= hi) return q;
    if (q[j]! - lo < gap) { gap = q[j]! - lo; best = j; to = lo; }
    if (hi - q[j]! < gap) { gap = hi - q[j]!; best = j; to = hi; }
  }
  const out: V3 = [...q];
  out[best] = to;
  return out;
}

/** The length of a polyline. */
export const lengthOf = (pts: readonly V3[]): number => pts.reduce((s, q, i) => (i ? s + dist(q, pts[i - 1]!) : 0), 0);

const add = (x: V3, y: V3): V3 => [x[0] + y[0], x[1] + y[1], x[2] + y[2]];
const sub = (x: V3, y: V3): V3 => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
const mul = (x: V3, k: number): V3 => [x[0] * k, x[1] * k, x[2] * k];
const dot = (x: V3, y: V3): number => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
export const dist = (x: V3, y: V3): number => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
