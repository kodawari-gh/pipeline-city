import { serpentine } from '../layout/match';
import { mkLane, nth } from './lane';
import type { Bus, BusKind, Ends, Lane, Pt, Run } from './types';

// Orderly routing. A route is a centre line made of horizontal, vertical and 45 degree segments; a bundle is that
// centre line copied n times at a fixed spacing (miter joins keep the spacing constant through bends). Corners that
// would be 90 degrees are chamfered into two 45 degree bends. Nothing here is random.

/** Replace every interior corner of a rectilinear polyline with a 45 degree chamfer of leg length c. */
export function chamfer(pts: Pt[], c: number): Pt[] {
  if (c <= 0) {
    return [...pts];
  }
  const out: Pt[] = [nth(pts, 0)];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = nth(pts, i - 1),
      p = nth(pts, i),
      b = nth(pts, i + 1);
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]),
      l2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const k = Math.min(c, l1 / 2, l2 / 2);
    out.push(
      [p[0] + ((a[0] - p[0]) / l1) * k, p[1] + ((a[1] - p[1]) / l1) * k],
      [p[0] + ((b[0] - p[0]) / l2) * k, p[1] + ((b[1] - p[1]) / l2) * k],
    );
  }
  out.push(nth(pts, -1));
  return out;
}

/** Parallel copy of a polyline at signed distance d (left of travel is negative y-down normal flip handled here). */
export function offsetLine(pts: Pt[], d: number): Pt[] {
  const n = pts.length;
  const nrm: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p = nth(pts, i),
      q = nth(pts, i + 1);
    const dx = q[0] - p[0],
      dy = q[1] - p[1],
      l = Math.hypot(dx, dy) || 1;
    nrm.push([-dy / l, dx / l]);
  }
  const p0 = nth(pts, 0),
    n0 = nth(nrm, 0);
  const out: Pt[] = [[p0[0] + n0[0] * d, p0[1] + n0[1] * d]];
  for (let i = 1; i < n - 1; i++) {
    const a = nth(nrm, i - 1),
      b = nth(nrm, i),
      p = nth(pts, i);
    const mx = a[0] + b[0],
      my = a[1] + b[1];
    const dot = 1 + a[0] * b[0] + a[1] * b[1]; // |a+b|^2 / 2
    const k = dot < 1e-6 ? 0 : d / dot;
    out.push([p[0] + mx * k, p[1] + my * k]);
  }
  const pe = nth(pts, n - 1),
    ne = nth(nrm, n - 2);
  out.push([pe[0] + ne[0] * d, pe[1] + ne[1] * d]);
  return out;
}

/** n parallel lanes centred on the route, `spacing` apart. */
export function bundle(centre: Pt[], { n, spacing, c = 120 }: Run): Pt[][] {
  const line = chamfer(centre, c);
  const out: Pt[][] = [];
  for (let i = 0; i < n; i++) {
    out.push(offsetLine(line, (i - (n - 1) / 2) * spacing));
  }
  return out;
}

/** How far a lane runs straight into its pad after the last bend of a fan-out. */
const LEAD = 36;

/** The direction a lane arrives at its last point, and where it lies across that direction. */
function arrival(pts: Pt[]): { ux: number; uy: number; lat: number } {
  const a = nth(pts, -2),
    p = nth(pts, -1),
    l = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1;
  const ux = (p[0] - a[0]) / l,
    uy = (p[1] - a[1]) / l;
  return { ux, uy, lat: p[0] * -uy + p[1] * ux };
}

/** A lane that ends on `pad`: it keeps its run up to the last point, then steps sideways on a 45 degree leg and runs `lead` straight into the pad. */
function reEnd(pts: Pt[], pad: Pt, { ux, uy, lead }: { ux: number; uy: number; lead: number }): Pt[] {
  const p = nth(pts, -1);
  const d = (pad[0] - p[0]) * -uy + (pad[1] - p[1]) * ux;
  const res = pts.slice(0, -1);
  if (Math.abs(d) < 0.5) {
    res.push(pad);
  } else {
    const q2: Pt = [pad[0] - ux * lead, pad[1] - uy * lead];
    res.push([q2[0] + uy * d - ux * Math.abs(d), q2[1] - ux * d - uy * Math.abs(d)], q2, pad);
  }
  return res;
}

/**
 * Re-end every lane of a bundle on its pad: the lanes keep their parallel run and, near the end, step sideways on a 45 degree leg that
 * starts where the sideways shift needs it (the farthest lane first), then run straight into the pad. Pads and lanes are matched by
 * their order across the lanes' direction of travel, so nothing crosses. `atEnd` false does the same for the first end.
 */
function land(
  lines: Pt[][],
  pads: Pt[],
  { atEnd, lead = LEAD }: { atEnd: boolean; lead?: number | undefined },
): Pt[][] {
  const ls = atEnd ? lines : lines.map((l) => l.toReversed());
  const info = ls.map((pts) => arrival(pts));
  const ref = nth(info, 0);
  const nx = -ref.uy,
    ny = ref.ux;
  const padOrder = pads.map((q, i) => ({ i, lat: q[0] * nx + q[1] * ny })).toSorted((a, b) => a.lat - b.lat);
  const laneOrder = info.map((f, i) => ({ i, lat: f.lat })).toSorted((a, b) => a.lat - b.lat);
  const out: Pt[][] = [...ls];
  for (const [rank, lo] of laneOrder.entries()) {
    const { ux, uy } = nth(info, lo.i);
    out[lo.i] = reEnd(nth(ls, lo.i), nth(pads, nth(padOrder, rank).i), { ux, uy, lead });
  }
  return atEnd ? out : out.map((l) => l.toReversed());
}

/** A bundle of n lanes along a centre line whose ends land on pads (`ends`); `match` adds the serpentines that make the lanes equally long. */
export function bundleOn(centre: Pt[], run: Run, ends: Ends = {}): Pt[][] {
  let lines = bundle(centre, run);
  if (ends.to) {
    lines = land(lines, ends.to, { atEnd: true, lead: ends.lead });
  }
  if (ends.from) {
    lines = land(lines, ends.from, { atEnd: false, lead: ends.lead });
  }
  return ends.match ? serpentine(lines, { pitch: run.spacing, ...ends.match }) : lines;
}

/** Lanes of the polylines, their phases 37 apart from `ph`. */
const lanesOf = (lines: Pt[][], ph = 0): Lane[] => lines.map((p, i) => mkLane(p, ph + i * 37));

/** The mean of coordinate `k` (0 = x, 1 = y) of the points. */
export const mean = (pts: Pt[], k: 0 | 1): number => pts.reduce((a, p) => a + p[k], 0) / pts.length;

/** A bus of one bundle: `run` with the stroke width `w`, its ends on pads (`ends`). */
export const mk = (id: BusKind, centre: Pt[], { w, ends = {}, ...run }: Run & { w: number; ends?: Ends }): Bus => ({
  id,
  w,
  lanes: lanesOf(bundleOn(centre, run, ends)),
});
