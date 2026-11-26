// A lane is a polyline with its segment lengths: the shape of one trace or cable, and the arc-length math on it.

export type Pt = [number, number];

export interface Lane {
  pts: Pt[];
  seg: number[];
  len: number;
  ph: number;
  /** Stretches (arc length from, to) where the lane dives under what it crosses (a via at each end, nothing drawn between): only the buses of `HOP_BUSES` do. */
  hops?: [number, number][];
}

/** The item at index `i` (a negative index counts from the end). A missing item throws here, not as a crash further on. */
export function nth<T>(xs: readonly T[], i: number): T {
  const x = xs.at(i);
  if (x === undefined) {
    throw new RangeError(`no item at index ${i}`);
  }
  return x;
}

export function mkLane(pts: Pt[], ph = 0): Lane {
  let len = 0;
  const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const p = nth(pts, i),
      o = nth(pts, i - 1);
    const d = Math.hypot(p[0] - o[0], p[1] - o[1]);
    seg.push(d);
    len += d;
  }
  return { pts, seg, len, ph };
}

/** Point at arc length s along a lane (wraps). */
export function pointAt(l: Lane, s: number): Pt {
  let rest = ((s % l.len) + l.len) % l.len;
  for (let i = 0; i < l.seg.length; i++) {
    const d = nth(l.seg, i);
    if (rest <= d || i === l.seg.length - 1) {
      const f = d === 0 || Number.isNaN(d) ? 0 : Math.min(1, rest / d),
        a = nth(l.pts, i),
        b = nth(l.pts, i + 1);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    rest -= d;
  }
  return nth(l.pts, 0);
}

/** Where segment p-q meets segment u-v, as the fractions along each (k along p-q, m along u-v); null when they are parallel or meet off either segment. */
function cross([p, q]: readonly [Pt, Pt], [u, v]: readonly [Pt, Pt]): { k: number; m: number } | null {
  const rx = q[0] - p[0],
    ry = q[1] - p[1],
    tx = v[0] - u[0],
    ty = v[1] - u[1],
    den = rx * ty - ry * tx;
  if (Math.abs(den) <= 1e-9) {
    return null;
  }
  const k = ((u[0] - p[0]) * ty - (u[1] - p[1]) * tx) / den,
    m = ((u[0] - p[0]) * ry - (u[1] - p[1]) * rx) / den;
  return k > 1e-6 && k < 1 - 1e-6 && m > 1e-6 && m < 1 - 1e-6 ? { k, m } : null;
}

/** Where two lanes cross: the arc length along `a` and along `b` of every proper crossing. */
export function crossings(a: Lane, b: Lane): { s: number; t: number }[] {
  const out: { s: number; t: number }[] = [];
  let sa = 0;
  for (let i = 1; i < a.pts.length; i++) {
    const p = nth(a.pts, i - 1),
      q = nth(a.pts, i),
      da = nth(a.seg, i - 1);
    let sb = 0;
    for (let j = 1; j < b.pts.length; j++) {
      const db = nth(b.seg, j - 1),
        hit = cross([p, q], [nth(b.pts, j - 1), nth(b.pts, j)]);
      if (hit) {
        out.push({ s: sa + hit.k * da, t: sb + hit.m * db });
      }
      sb += db;
    }
    sa += da;
  }
  return out;
}

/** The points of the lane between arc lengths s0 and s1. */
function sliceLane(l: Lane, s0: number, s1: number): Pt[] {
  const out: Pt[] = [pointAt(l, Math.min(l.len - 1e-9, s0))];
  let c = 0;
  for (let i = 1; i < l.pts.length - 1; i++) {
    c += nth(l.seg, i - 1);
    if (c > s0 + 1e-6 && c < s1 - 1e-6) {
      out.push(nth(l.pts, i));
    }
  }
  out.push(s1 >= l.len ? nth(l.pts, -1) : pointAt(l, s1));
  return out;
}

/** The drawn pieces of a lane: the whole polyline, or what is left of it outside its hops. */
export function visibleParts(l: Lane): Pt[][] {
  if (l.hops === undefined || l.hops.length === 0) {
    return [l.pts];
  }
  const parts: Pt[][] = [];
  let at = 0;
  for (const [a, b] of l.hops) {
    if (a > at) {
      parts.push(sliceLane(l, at, a));
    }
    at = b;
  }
  if (at < l.len) {
    parts.push(sliceLane(l, at, l.len));
  }
  return parts;
}
