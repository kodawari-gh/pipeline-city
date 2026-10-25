// Length matching: the lanes of a bus group must arrive together, so the shorter lanes of a bundle carry a serpentine, the way a real board does.
// A bundle that turns is shorter on the inside of the turn by (n - 1) * pitch * 2 * tan(turn / 2) whatever the corner looks like, so no routing
// avoids it. `serpentine` adds the missing length: the bundle opens out toward the side of its shortest lane (a 45 degree flare, which already
// gives that lane some length back), every lane then runs a row of small square-toothed bumps as long as it needs (the shortest lane the most),
// and the bundle closes again. The teeth all lean the same way, into the room the flare opened, so no two lanes ever touch. Pure geometry.

export type Pt = [number, number];

export interface SerpOpts {
  /** Bundle pitch of the lanes, the stroke width and the clear gap kept between lanes. */
  pitch: number; w: number; gap?: number;
  /** Lane pitch in the flared stretch (default `pitch` + 12): a lane's teeth are as high as the room this leaves, `flare - w - gap`. */
  flare?: number;
  /** Bevel of a tooth's corners, the flat on top of a tooth and the flat between two teeth, the straight lead kept at both ends of the stretch used. */
  bevel?: number; flat?: number; space?: number; margin?: number;
  /** Lanes within this much of the longest are left alone. */
  tol?: number;
  /** Use only a stretch along this axis ('h' runs along x). */
  axis?: 'h' | 'v';
}

export const lengthOf = (pts: Pt[]): number => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) : 0), 0);

interface Seg { j: number; axis: 'h' | 'v'; c: number; a: number; b: number; dir: 1 | -1 }

function segsOf(pts: Pt[]): Seg[] {
  const out: Seg[] = [];
  for (let j = 0; j + 1 < pts.length; j++) {
    const p = pts[j]!, q = pts[j + 1]!, dx = q[0] - p[0], dy = q[1] - p[1];
    if (Math.abs(dy) < 1e-6 && Math.abs(dx) > 1e-6) out.push({ j, axis: 'h', c: p[1], a: p[0], b: q[0], dir: dx > 0 ? 1 : -1 });
    else if (Math.abs(dx) < 1e-6 && Math.abs(dy) > 1e-6) out.push({ j, axis: 'v', c: p[0], a: p[1], b: q[1], dir: dy > 0 ? 1 : -1 });
  }
  return out;
}
const span = (s: Seg): [number, number] => (s.a < s.b ? [s.a, s.b] : [s.b, s.a]);

/** A tooth of height A and bevel b adds 2A - b(8 - 4 sqrt 2) to a lane's length (it is a tooth only for A >= 2b + 2; a smaller one is a plain 45 degree notch). */
const BEV = 8 - 4 * Math.SQRT2;

/** The tooth that adds exactly `e` to a lane: its height and bevel. */
function toothFor(e: number, b0: number): { A: number; b: number } {
  if (e >= 2 * (2 * b0 + 2) - b0 * BEV) return { A: (e + b0 * BEV) / 2, b: b0 };
  // a notch: A = 2b, extra = 2A - b * BEV = A * (2 - BEV / 2)
  const A = e / (2 - BEV / 2);
  return { A, b: A / 2 };
}

/**
 * Make every lane of the bundle as long as the longest. `lines` are the lanes (first end to last), parallel over a straight stretch.
 * Returns the lanes unchanged when they already match, or when no stretch is long enough (a test then flags the skew).
 */
export function serpentine(lines: Pt[][], o: SerpOpts): Pt[][] {
  const n = lines.length, tol = o.tol ?? 1.5, gap = o.gap ?? 8, b0 = o.bevel ?? 5, margin = o.margin ?? 40, clear = o.w + gap;
  const flat = o.flat ?? 6, space = o.space ?? 6, Pf = o.flare ?? o.pitch + 12, Amax = Pf - clear;
  const lens = lines.map(lengthOf), tgt = Math.max(...lens);
  if (n < 2 || tgt - Math.min(...lens) < tol) return lines;

  // the straight stretch every lane has in common (same axis, same direction, side by side): the longest one
  const segs = lines.map(segsOf);
  let best: { picks: Seg[]; lo: number; hi: number; axis: 'h' | 'v'; dir: 1 | -1 } | null = null;
  for (const s0 of segs[0]!) {
    if (o.axis && s0.axis !== o.axis) continue;
    const picks: Seg[] = [s0];
    let [lo, hi] = span(s0);
    for (let i = 1; i < n && picks.length === i; i++) {
      let pick: Seg | null = null, ov = 0;
      for (const s of segs[i]!) {
        if (s.axis !== s0.axis || s.dir !== s0.dir || Math.abs(s.c - s0.c) > 4 * (n - 1) * o.pitch) continue;
        const [a, b] = span(s), m = Math.min(b, hi) - Math.max(a, lo);
        if (m > ov) { ov = m; pick = s; }
      }
      if (pick) { picks.push(pick); const [a, b] = span(pick); lo = Math.max(lo, a); hi = Math.min(hi, b); }
    }
    if (picks.length === n && hi - lo > 0 && (!best || hi - lo > best.hi - best.lo)) best = { picks, lo, hi, axis: s0.axis, dir: s0.dir };
  }
  if (!best) return lines;
  const { picks, lo, hi, axis, dir } = best;

  // the bundle opens out toward the side of its shortest lane; the lane on the far side keeps its place
  const order = picks.map((s, i) => ({ i, c: s.c })).sort((a, b) => a.c - b.c);
  const toLow = lens[order[0]!.i]! <= lens[order[n - 1]!.i]!;
  const far = toLow ? order[n - 1]!.c : order[0]!.c;
  const sgn = toLow ? -1 : 1;
  const k = Pf / o.pitch - 1;
  const delta = lines.map((_, i) => Math.abs(picks[i]!.c - far) * k);
  const dMax = Math.max(...delta);

  // each lane's shortfall once the flare has given some length back, the teeth that make it up
  const flared = lens.map((l, i) => l + 2 * delta[i]! * (Math.SQRT2 - 1));
  const top = Math.max(...flared);
  const maxExtra = 2 * Amax - b0 * BEV;
  const plan = lines.map((_, i) => {
    const E = top - flared[i]!;
    if (E < tol) return null;
    const m = Math.max(1, Math.ceil(E / maxExtra - 1e-9));
    return { m, ...toothFor(E / m, b0) };
  });
  const pitchOf = (b: number) => 4 * b + flat + space;
  const need = Math.max(0, ...plan.map((p) => (p ? p.m * pitchOf(p.b) - space : 0)));
  const room = hi - lo - 2 * margin - 2 * dMax;
  if (need > room) return lines;
  const base = dir > 0 ? lo : hi, A = (t: number) => base + dir * t;
  const t0 = margin, t1 = hi - lo - margin, mid = (t0 + t1) / 2;

  return lines.map((pts, i) => {
    const s = picks[i]!, d = delta[i]!, c = s.c, p = plan[i];
    const P = (t: number, q: number): Pt => (axis === 'h' ? [A(t), c + sgn * q] : [c + sgn * q, A(t)]);
    const mid2: Pt[] = [];
    if (d > 1e-6) mid2.push(P(t0, 0), P(t0 + d, d));
    if (p) {
      const pt = pitchOf(p.b), total = p.m * pt - space;
      for (let j = 0; j < p.m; j++) {
        const a = mid - total / 2 + j * pt, b = p.b, h = p.A;
        mid2.push(P(a, d), P(a + b, d + b), P(a + b, d + h - b), P(a + 2 * b, d + h), P(a + 2 * b + flat, d + h), P(a + 3 * b + flat, d + h - b), P(a + 3 * b + flat, d + b), P(a + 4 * b + flat, d));
      }
    }
    if (d > 1e-6) mid2.push(P(t1 - d, d), P(t1, 0));
    if (!mid2.length) return pts;
    const out = [...pts.slice(0, s.j + 1), ...mid2, ...pts.slice(s.j + 1)];
    return out.filter((q, j) => j === 0 || Math.hypot(q[0] - out[j - 1]![0], q[1] - out[j - 1]![1]) > 1e-6);
  });
}
