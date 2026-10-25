// Length matching: the lanes of a bus group must arrive together, so the shorter lanes of a bundle carry a serpentine, the way a real board does.
// A bundle that turns is shorter on the inside of the turn by (n - 1) * pitch * 2 * tan(turn / 2) whatever the corner looks like, so no routing
// avoids it. `nestMatch` adds the missing length with one or more nested "trombones": every lane steps out toward the side of the shortest
// lane, runs along and steps back; the outermost lane (the shortest) steps out the farthest, the others nest inside it at the lane pitch, so the
// lanes never touch and the bundle needs free room only on one side. Pure geometry: nothing here draws.

export type Pt = [number, number];

export interface NestOpts {
  /** Bundle pitch of the lanes (the nest keeps it), the stroke width and the gap kept between lanes. */
  pitch: number; w: number; gap?: number;
  /** The highest the outermost lane steps out (the room beside the bundle), the 45 degree bevel of every corner, the straight lead kept at both ends of the stretch used. */
  hmax?: number; bevel?: number; margin?: number;
  /** Where in the common straight run the nests sit: 'start', 'mid' (default) or 'end' (in the direction of travel). */
  at?: 'start' | 'mid' | 'end';
  /** Lanes within this much of the longest are left alone. */
  tol?: number;
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

/**
 * Make every lane of the bundle as long as the longest. `lines` are the lanes (first end to last), parallel over a straight stretch.
 * Returns the lanes unchanged when they already match, or when no stretch is long enough (a test then flags the skew).
 */
export function nestMatch(lines: Pt[][], o: NestOpts): Pt[][] {
  const n = lines.length, tol = o.tol ?? 1.5, gap = o.gap ?? 8, b0 = o.bevel ?? 5, margin = o.margin ?? 40, hmax = o.hmax ?? 90, clear = o.w + gap;
  const lens = lines.map(lengthOf), tgt = Math.max(...lens), need = lens.map((l) => tgt - l);
  if (n < 2 || Math.max(...need) < tol) return lines;

  // the straight stretch every lane has in common (same axis, same direction, side by side): the longest one
  const segs = lines.map(segsOf);
  let best: { picks: Seg[]; lo: number; hi: number; axis: 'h' | 'v'; dir: 1 | -1 } | null = null;
  for (const s0 of segs[0]!) {
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

  // lanes ordered across the run; the nest steps out toward the side of the shortest lane
  const order = picks.map((s, i) => ({ i, c: s.c })).sort((a, b) => a.c - b.c);
  const toLow = need[order[0]!.i]! >= need[order[n - 1]!.i]!;
  const outer = toLow ? order[0]!.c : order[n - 1]!.c;
  const off = (i: number) => Math.abs(picks[i]!.c - outer);
  const sgn = toLow ? -1 : 1; // lateral coordinate of the step-out direction

  // cycles: as many nests in a row as the highest lane's height allows
  const needMax = Math.max(...need);
  const hOf = (e: number, b: number) => (e + b * (8 - 4 * Math.SQRT2)) / 2;
  let m = 1;
  while (hOf(needMax / m, b0) > hmax && m < 8) m++;
  // a lane's bump: the bevel shrinks for a small shortfall (the smallest bump is as high as two bevels and two units)
  const lane = (i: number) => {
    const e = need[i]! / m;
    if (e < 6.5) return null;
    return { b: Math.min(b0, (e - 4) / (4 * Math.SQRT2 - 4)), e };
  };
  const offMax = Math.max(...picks.map((_, i) => off(i)));
  const F = 6 + 2 * offMax + 2 * b0; // the outer lane's width at the top: the inner lane keeps 6
  const cycleW = F + 2 * b0, gc = Math.max(14, clear - 2 * b0 + 4);
  const total = m * cycleW + (m - 1) * gc;
  const room = hi - lo - 2 * margin;
  if (total > room) return lines;
  const t0 = at(o.at ?? 'mid', room, total) + margin + b0; // start of the first cycle's outer lane, measured along the direction of travel from the range's start
  const base = dir > 0 ? lo : hi;
  const A = (t: number) => base + dir * t;

  return lines.map((pts, i) => {
    const l = lane(i);
    if (!l) return pts;
    const s = picks[i]!, h = hOf(l.e, l.b), b = l.b, c = s.c, ofs = off(i);
    const P = (t: number, q: number): Pt => (axis === 'h' ? [A(t), c + sgn * q] : [c + sgn * q, A(t)]);
    const mid: Pt[] = [];
    for (let k = 0; k < m; k++) {
      const x0 = t0 + k * (cycleW + gc) - b0; // the cycle's left edge
      const xr = x0 + b0 + ofs, xd = x0 + b0 + F - ofs;
      mid.push(P(xr - b, 0), P(xr, b), P(xr, h - b), P(xr + b, h), P(xd - b, h), P(xd, h - b), P(xd, b), P(xd + b, 0));
    }
    return [...pts.slice(0, s.j + 1), ...mid, ...pts.slice(s.j + 1)];
  });
}

function at(where: 'start' | 'mid' | 'end', room: number, total: number): number {
  return where === 'start' ? 0 : where === 'end' ? room - total : (room - total) / 2;
}
