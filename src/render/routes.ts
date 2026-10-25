import { DIMM_H0, ioPort, type TierGeo } from './boardlayout';
import { serpentine, type SerpOpts } from './match';
import {
  BR, GEO, PKG, PORT_Y, PSU_PORTS, SOCKET_E, VIDEO_Y, type Rect,
} from './layout';
import {
  LEG_PITCH, MEM_LANES, MEM_SPACING, SATA_LANES, atx12v, pkgPads, cpuStageCtl, dramStageCtl, headerPin, legAt, legsFrom, cpuPowerPins, dimmPads, dimmPowerPad, ioPads, legRun, legsOf, m2Pads, pciePads, sataPads,
} from './pins';

export { MEM_LANES, MEM_SPACING, SATA_LANES };
/** x (from a phase block's left edge) of its output stub, where the core-voltage run starts (CPU VRM, see `vrmPhaseArt`), and the memory regulator's output and input stubs (`dramPhaseArt`). */
export const VRM_OUT_X = 265, DRAM_OUT_X = 124, DRAM_IN_X = 52;

// Orderly routing. A route is a centre line made of horizontal, vertical and 45 degree segments; a bundle is that
// centre line copied n times at a fixed spacing (miter joins keep the spacing constant through bends). Corners that
// would be 90 degrees are chamfered into two 45 degree bends. Nothing here is random.

export type Pt = [number, number];

export interface Lane {
  pts: Pt[]; seg: number[]; len: number; ph: number;
  /** Stretches (arc length from, to) where the lane dives under what it crosses (a via at each end, nothing drawn between): only the buses of `HOP_BUSES` do. */
  hops?: [number, number][];
}

export function mkLane(pts: Pt[], ph = 0): Lane {
  let len = 0;
  const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    seg.push(d); len += d;
  }
  return { pts, seg, len, ph };
}

/** Point at arc length s along a lane (wraps). */
export function pointAt(l: Lane, s: number): Pt {
  s = ((s % l.len) + l.len) % l.len;
  for (let i = 0; i < l.seg.length; i++) {
    if (s <= l.seg[i]! || i === l.seg.length - 1) {
      const f = l.seg[i]! ? Math.min(1, s / l.seg[i]!) : 0, a = l.pts[i]!, b = l.pts[i + 1]!;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    s -= l.seg[i]!;
  }
  return l.pts[0]!;
}

/** Where two lanes cross: the arc length along `a` and along `b` of every proper crossing. */
export function crossings(a: Lane, b: Lane): { s: number; t: number }[] {
  const out: { s: number; t: number }[] = [];
  let sa = 0;
  for (let i = 1; i < a.pts.length; i++) {
    const p = a.pts[i - 1]!, q = a.pts[i]!, rx = q[0] - p[0], ry = q[1] - p[1];
    let sb = 0;
    for (let j = 1; j < b.pts.length; j++) {
      const u = b.pts[j - 1]!, v = b.pts[j]!, tx = v[0] - u[0], ty = v[1] - u[1], den = rx * ty - ry * tx;
      if (Math.abs(den) > 1e-9) {
        const k = ((u[0] - p[0]) * ty - (u[1] - p[1]) * tx) / den, m = ((u[0] - p[0]) * ry - (u[1] - p[1]) * rx) / den;
        if (k > 1e-6 && k < 1 - 1e-6 && m > 1e-6 && m < 1 - 1e-6) out.push({ s: sa + k * a.seg[i - 1]!, t: sb + m * b.seg[j - 1]! });
      }
      sb += b.seg[j - 1]!;
    }
    sa += a.seg[i - 1]!;
  }
  return out;
}

/** The points of the lane between arc lengths s0 and s1. */
export function sliceLane(l: Lane, s0: number, s1: number): Pt[] {
  const out: Pt[] = [pointAt(l, Math.min(l.len - 1e-9, s0))];
  let c = 0;
  for (let i = 1; i < l.pts.length - 1; i++) { c += l.seg[i - 1]!; if (c > s0 + 1e-6 && c < s1 - 1e-6) out.push(l.pts[i]!); }
  out.push(s1 >= l.len ? l.pts[l.pts.length - 1]! : pointAt(l, s1));
  return out;
}

/** The drawn pieces of a lane: the whole polyline, or what is left of it outside its hops. */
export function visibleParts(l: Lane): Pt[][] {
  if (!l.hops?.length) return [l.pts];
  const parts: Pt[][] = [];
  let at = 0;
  for (const [a, b] of l.hops) { if (a > at) parts.push(sliceLane(l, at, a)); at = b; }
  if (at < l.len) parts.push(sliceLane(l, at, l.len));
  return parts;
}

/** Replace every interior corner of a rectilinear polyline with a 45 degree chamfer of leg length c. */
export function chamfer(pts: Pt[], c: number): Pt[] {
  if (c <= 0) return pts.slice();
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!, p = pts[i]!, b = pts[i + 1]!;
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]), l2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const k = Math.min(c, l1 / 2, l2 / 2);
    out.push([p[0] + ((a[0] - p[0]) / l1) * k, p[1] + ((a[1] - p[1]) / l1) * k]);
    out.push([p[0] + ((b[0] - p[0]) / l2) * k, p[1] + ((b[1] - p[1]) / l2) * k]);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Parallel copy of a polyline at signed distance d (left of travel is negative y-down normal flip handled here). */
export function offsetLine(pts: Pt[], d: number): Pt[] {
  const n = pts.length;
  const nrm: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1]![0] - pts[i]![0], dy = pts[i + 1]![1] - pts[i]![1], l = Math.hypot(dx, dy) || 1;
    nrm.push([-dy / l, dx / l]);
  }
  const out: Pt[] = [[pts[0]![0] + nrm[0]![0] * d, pts[0]![1] + nrm[0]![1] * d]];
  for (let i = 1; i < n - 1; i++) {
    const a = nrm[i - 1]!, b = nrm[i]!;
    const mx = a[0] + b[0], my = a[1] + b[1];
    const dot = 1 + a[0] * b[0] + a[1] * b[1]; // |a+b|^2 / 2
    const k = dot < 1e-6 ? 0 : d / dot;
    out.push([pts[i]![0] + mx * k, pts[i]![1] + my * k]);
  }
  out.push([pts[n - 1]![0] + nrm[n - 2]![0] * d, pts[n - 1]![1] + nrm[n - 2]![1] * d]);
  return out;
}

/** n parallel lanes centred on the route, `spacing` apart. */
export function bundle(centre: Pt[], n: number, spacing: number, c = 120): Pt[][] {
  const line = chamfer(centre, c);
  const out: Pt[][] = [];
  for (let i = 0; i < n; i++) out.push(offsetLine(line, (i - (n - 1) / 2) * spacing));
  return out;
}

export type BusKind = 'mem' | 'nvme' | 'dmi' | 'pcie' | 'sata' | 'usb' | 'video' | 'dp' | 'svid' | 'pwmc' | 'spi' | 'hdr' | 'rtc' | 'pwr12' | 'pwrcpu' | 'vcore' | 'vdimm' | 'audio' | 'lan' | 'hda' | 'phyl' | 'lpc' | 'dbg' | 'rgb';

/** Buses that are only there to be seen: they never light. */
export const DECOR_BUSES: readonly BusKind[] = ['audio', 'lan', 'dp', 'svid', 'pwmc', 'spi', 'hdr', 'rtc', 'hda', 'phyl', 'lpc', 'dbg', 'rgb'];
/** Buses that may dive under what they cross (a via at each end of the hop), in rank order: a lane of a later bus hops over a lane of an earlier one. */
export const HOP_BUSES: readonly BusKind[] = ['pwmc', 'hda', 'phyl', 'lpc', 'rgb'];

export interface Bus {
  id: BusKind;
  /** Lanes from the first end to the second. */
  lanes: Lane[];
  /** Lane stroke width in world units. */
  w: number;
  /** Width of the pad a lane ends on (default: twice the stroke). */
  pad?: number;
  /** Branches (one per DIMM) that light together with the main run when `tap(i)` is installed. */
  taps?: { key: string; lanes: Lane[] }[];
  /** The lanes that must arrive together (one memory channel, one M.2, one slot's lanes...): their lengths match. */
  groups?: Lane[][];
}

/** How far a lane runs straight into its pad after the last bend of a fan-out. */
const LEAD = 36;

/**
 * Re-end every lane of a bundle on its pad: the lanes keep their parallel run and, near the end, step sideways on a 45 degree leg that
 * starts where the sideways shift needs it (the farthest lane first), then run straight into the pad. Pads and lanes are matched by
 * their order across the lanes' direction of travel, so nothing crosses. `atEnd` false does the same for the first end.
 */
function land(lines: Pt[][], pads: Pt[], atEnd: boolean, lead = LEAD): Pt[][] {
  const ls = atEnd ? lines : lines.map((l) => l.slice().reverse());
  const info = ls.map((pts) => {
    const n = pts.length, a = pts[n - 2]!, p = pts[n - 1]!, l = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1;
    const ux = (p[0] - a[0]) / l, uy = (p[1] - a[1]) / l;
    return { ux, uy, lat: p[0] * -uy + p[1] * ux };
  });
  const ref = info[0]!;
  const nx = -ref.uy, ny = ref.ux;
  const padOrder = pads.map((q, i) => ({ i, lat: q[0] * nx + q[1] * ny })).sort((a, b) => a.lat - b.lat);
  const laneOrder = info.map((f, i) => ({ i, lat: f.lat })).sort((a, b) => a.lat - b.lat);
  const out: Pt[][] = ls.map((pts) => pts);
  laneOrder.forEach((lo, rank) => {
    const pts = ls[lo.i]!, pad = pads[padOrder[rank]!.i]!, n = pts.length, p = pts[n - 1]!, { ux, uy } = info[lo.i]!;
    const d = (pad[0] - p[0]) * -uy + (pad[1] - p[1]) * ux;
    const res = pts.slice(0, n - 1);
    if (Math.abs(d) < 0.5) res.push(pad);
    else {
      const q2: Pt = [pad[0] - ux * lead, pad[1] - uy * lead];
      res.push([q2[0] + uy * d - ux * Math.abs(d), q2[1] - ux * d - uy * Math.abs(d)], q2, pad);
    }
    out[lo.i] = res;
  });
  return atEnd ? out : out.map((l) => l.reverse());
}

/** Length matching of a bundle's lanes (`serpentine`): the stroke width and the room beside the bundle. */
type Match = Omit<SerpOpts, 'pitch'>;
type Ends = { from?: Pt[]; to?: Pt[]; lead?: number; match?: Match };
/** A bundle of n lanes along a centre line whose ends land on pads (`from` at the first end, `to` at the last; none = free end); `match` adds the serpentines that make the lanes equally long. */
function bundleOn(centre: Pt[], n: number, spacing: number, c: number, ends: Ends = {}): Pt[][] {
  let lines = bundle(centre, n, spacing, c);
  if (ends.to) lines = land(lines, ends.to, true, ends.lead);
  if (ends.from) lines = land(lines, ends.from, false, ends.lead);
  return ends.match ? serpentine(lines, { pitch: spacing, ...ends.match }) : lines;
}
const lanesOf = (lines: Pt[][], ph = 0): Lane[] => lines.map((p, i) => mkLane(p, ph + i * 37));
const mean = (pts: Pt[], k: 0 | 1) => pts.reduce((a, p) => a + p[k], 0) / pts.length;

const mk = (id: BusKind, centre: Pt[], n: number, spacing: number, w: number, c = 120, ends: Ends = {}): Bus => ({
  id, w, lanes: lanesOf(bundleOn(centre, n, spacing, c, ends)),
});

/**
 * The columns that leave the south edge of the package, west to east: PCIe x16 (lands on the first slot), DMI (the chipset's north legs),
 * then one NVMe column per M.2 below the CPU (the lowest M.2 in the westmost column, so none crosses another). An M.2 level with the
 * CPU is fed from its east edge. The x16 slot ends before the DMI column.
 */
export const PCIE_X = 110, NVME_DX = 130;
/** x of the first NVMe column of a tier: right of the DMI lanes. */
/** x where the memory rail's upper run ends: past the last socket of the row and past the last phase's output, so every output lands on the rail. */
export const vdimmEnd = (g: TierGeo) => {
  const lastRow0 = g.dimm.filter((d) => !d.flip).pop()!;
  return Math.max(lastRow0.rect.x + lastRow0.rect.w - 20, g.dPhases[g.dPhases.length - 1]!.x + DRAM_OUT_X + 24);
};
/** x where the memory rail's upper run starts: at the first socket's drop (and no later than the first phase's output). */
export const vdimmStart = (g: TierGeo) => {
  const d0 = g.dimm.find((d) => !d.flip)!;
  return Math.min(dimmPowerPad(d0.rect, d0.flip)[0], g.dPhases[0]!.x + DRAM_OUT_X) - 8;
};
export const nvmeX0 = (g: TierGeo) => g.dmiX + 107;
/** Lanes in an NVMe bundle (and their spacing) and in the DMI link. */
export const NVME_LANES = 3, NVME_SPACING = 22, DMI_LANES = 6;

/** Mark the stretches where a lane of a `HOP_BUSES` bus crosses another lane: it dives under (a via at each end, `hop` clear of the crossed trace). */
function addHops(buses: Bus[]) {
  const all = buses.flatMap((b) => b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : []).map((l) => ({ b, l })));
  const rank = (id: BusKind) => HOP_BUSES.indexOf(id);
  for (const { b, l } of all) {
    if (rank(b.id) < 0) continue;
    const cuts: [number, number][] = [];
    for (const o of all) {
      if (o.l === l || o.b === b || (rank(o.b.id) >= 0 && rank(o.b.id) > rank(b.id))) continue;
      const r = o.b.w / 2 + 20;
      for (const c of crossings(l, o.l)) cuts.push([c.s - r, c.s + r]);
    }
    cuts.sort((x, y) => x[0] - y[0]);
    const hops: [number, number][] = [];
    for (const c of cuts) {
      const last = hops[hops.length - 1];
      if (last && c[0] - last[1] < 36) last[1] = Math.max(last[1], c[1]);
      else hops.push([Math.max(18, c[0]), Math.min(l.len - 18, c[1])]);
    }
    if (hops.length) l.hops = hops;
  }
}

/**
 * Every board bus of the current tier (`GEO`), routed once. Lane order inside a bundle is stable; direction runs CPU outward.
 * Every lane ends on a pin that the part's art draws (`pins.ts`): the CPU socket's escape pads at one end, a pad bar on a socket, a leg
 * of a chip, a contact of a connector at the other. Memory is point-to-point: one bundle per DIMM, stacked in a staircase (the nearest
 * DIMM takes the lane band closest to its pads), so no two bundles cross. A run changes lane pitch only on a 45 degree leg right
 * before its pins.
 */
export function buildBuses(): Bus[] {
  const g = GEO;
  const px = PKG.x - SOCKET_E, qx = PKG.x + PKG.w + SOCKET_E, qy = PKG.y + PKG.h + SOCKET_E, py = PKG.y - SOCKET_E;
  const buses: Bus[] = [];

  // memory: a bundle per DIMM from the CPU east edge to the pad bar of its socket (row 0's bar is its south end, row 1's its north end)
  const mem: Bus = { id: 'mem', w: 9, pad: 13, lanes: [], taps: [] };
  g.dimm.forEach((d, i) => {
    const pads = dimmPads(d.rect, d.flip), cx = d.rect.x + d.rect.w / 2, y = g.memY[i]!;
    // the bundle opens out into the free band above its run (below it on the lower row) and its lanes run their serpentines there
    mem.taps!.push({ key: 'dimm' + i, lanes: lanesOf(bundleOn([[qx, y], [cx, y], [cx, pads[0]![1]]], MEM_LANES, MEM_SPACING, 70, { from: pkgPads(PKG, 'e', y, MEM_LANES), to: pads, match: { w: 9, flare: 30 } }), i * 11) });
  });
  buses.push(mem);

  // NVMe: one bundle per M.2 to the middle contacts of its socket
  {
    const lanes: Lane[] = [];
    const below = g.m2.filter((m) => m.y + m.h / 2 > qy);
    g.m2.forEach((m) => {
      const y = m.y + m.h / 2, k = below.indexOf(m), pads = m2Pads(m), xe = pads[0]![0];
      const x = nvmeX0(g) + NVME_DX * (below.length - 1 - k);
      const route: Pt[] = k < 0 ? [[qx, y], [xe, y]] : [[x, qy], [x, y], [xe, y]];
      for (const pts of bundleOn(route, NVME_LANES, NVME_SPACING, 100, { from: k < 0 ? pkgPads(PKG, 'e', y, NVME_LANES) : pkgPads(PKG, 's', 690 + 60 * (below.length - 1 - k), NVME_LANES), to: pads, match: { w: 10, flare: 36, side: 'high' } })) lanes.push(mkLane(pts, lanes.length * 37));
    });
    if (lanes.length) buses.push({ id: 'nvme', w: 10, lanes });
  }

  // DMI: CPU south edge straight down onto the chipset's north legs
  {
    const legs = legRun(g.chip, 'n', DMI_LANES), cx = mean(legs, 0);
    // (west of the NVMe columns' pads when the board has them: the lanes open out from the pads' 20 to the legs' 26 and keep clear of the columns)
    const at = g.m2.some((m) => m.y + m.h / 2 > qy) ? Math.min(cx, 590) : Math.min(cx, 780);
    buses.push(mk('dmi', [[cx, qy], [cx, legs[0]![1]]], DMI_LANES, LEG_PITCH, 9, 120, { from: pkgPads(PKG, 's', at, DMI_LANES), to: legs, match: { w: 9, flare: 32, side: 'low', margin: 20 } }));
  }

  // PCIe x16: CPU south edge down onto the pads on the first slot's north edge (the lanes open from 20 to 40 apart on 45 degree legs)
  if (g.pcie[0]) {
    const r = g.pcie[0], pads = pciePads(r, 12, 'n');
    buses.push(mk('pcie', [[PCIE_X, qy], [PCIE_X, r.y]], 12, 40, 9, 120, { from: pkgPads(PKG, 's', PCIE_X, 12, 2), to: pads }));
  }

  // the chipset's own PCIe lanes: four to each slot after the first, from a run of the chipset's west legs, west under the slots, then up
  // (or, for a slot level with the legs, down) onto the pads on the slot's south edge near its latch end. The slots end one after the
  // other going down the board, so each group's rise clears the shorter slots below it; the group that rises first runs highest.
  g.pcie.slice(1).forEach((r, k) => {
    const legs = legsFrom(g.chip, 'w', g.west.slots[k]!, 4), pads = pciePads(r, 4, 's'), yc = mean(legs, 1), xl = mean(pads, 0);
    const bus = buses.find((b) => b.id === 'pcie')!;
    for (const pts of bundleOn([[legs[0]![0], yc], [xl, yc], [xl, pads[0]![1]]], 4, LEG_PITCH, 100, { from: legs, to: pads, match: { w: 9, flare: 40 } })) bus.lanes.push(mkLane(pts, bus.lanes.length * 37));
  });

  // USB: four lanes from the CPU's west edge to the hub's east legs; from its west legs two lanes per port fan out (all the same way)
  // to the pads on the shield plate, level with each port
  {
    const hub = g.hub, up = legRun(hub, 'e', 4), lanes: Lane[] = [];
    for (const pts of bundleOn([[px, 0], [up[0]![0], 0]], 4, LEG_PITCH, 0, { from: pkgPads(PKG, 'w', 0, 4), to: up, match: { w: 9, flare: 34 } })) lanes.push(mkLane(pts, lanes.length * 37));
    const legs = legRun(hub, 'w', 2 * g.usb);
    for (let p = 0; p < g.usb; p++) {
      const own = legs.slice(2 * p, 2 * p + 2), yc = mean(own, 1), port = ioPort('usb' + p), pads = ioPads(port, 2);
      for (const pts of bundleOn([[own[0]![0], yc], [pads[0]![0], yc]], 2, LEG_PITCH, 0, { from: own, to: pads, lead: 60 })) lanes.push(mkLane(pts, lanes.length * 37));
    }
    buses.push({ id: 'usb', w: 9, lanes });
  }

  // SATA: a bundle per port from the chipset's east legs (one run of contiguous legs, three per port) to the pads on the port's west
  // side, fanning out on 45 degree legs that all end at the same x (the outer ports start theirs first), so nothing crosses and the run
  // across the board is straight, along the port's row (the drive cables continue from there)
  if (g.sata.length) {
    const lanes: Lane[] = [], n = g.sata.length, legs = legRun(g.chip, 'e', n * SATA_LANES), x0 = legs[0]![0];
    const yc = (i: number) => legs[i * SATA_LANES + 1]![1];
    const dmax = Math.max(0, ...g.sata.map((p, i) => Math.abs(p.y + p.h / 2 - yc(i))));
    const xe = x0 + 60 + dmax;
    g.sata.forEach((p, i) => {
      const y = p.y + p.h / 2, d = y - yc(i), pads = sataPads(p), own = legs.slice(i * SATA_LANES, (i + 1) * SATA_LANES);
      const route: Pt[] = Math.abs(d) < 1 ? [[x0, y], [pads[0]![0], y]] : [[x0, yc(i)], [xe - Math.abs(d), yc(i)], [xe, y], [pads[0]![0], y]];
      for (const pts of bundleOn(route, SATA_LANES, LEG_PITCH, 0, { from: own, to: pads })) lanes.push(mkLane(pts, i * 29 + lanes.length * 37));
    });
    buses.push({ id: 'sata', w: 9, lanes });
  }

  // display: CPU west edge, west (above the USB lanes), up to the HDMI row, into the pads behind the port (the second output, when the
  // board has one, runs the same way below it and nests inside: it never lights)
  {
    const hdmi = ioPort('hdmi'), hp = ioPads(hdmi, 4);
    // a ramp: west along the row, one 45 degree climb to the connector's row, west again (no sideways steps)
    const xa = -2000, ramp = (y0: number, y1: number, x0: number, pad: Pt): Pt[] => [[px, y0], [x0, y0], [x0 - (y0 - y1), y1], [pad[0], y1]];
    buses.push(mk('video', ramp(-540, hdmi.y, xa, hp[0]!), 4, LEG_PITCH, 11, 0, { from: pkgPads(PKG, 'w', -540, 4), to: hp, match: { w: 11, flare: 34, axis: 'h' } }));
    if (g.dp) {
      const dp = ioPort('dp'), dpp = ioPads(dp, 4);
      buses.push(mk('dp', ramp(-420, dp.y, xa - 80, dpp[0]!), 4, LEG_PITCH, 11, 0, { from: pkgPads(PKG, 'w', -420, 4), to: dpp, match: { w: 11, flare: 34, axis: 'h' } }));
    }
  }

  // SVID: the CPU's voltage request to the regulator's controller: three lanes from the controller's south legs, down and east onto the
  // socket's west edge (a controller beside or above the socket lands on its north edge instead). Decoration: it never lights.
  {
    const legs = legRun(g.pwm, 's', 3, 0, LEG_PITCH), cx = mean(legs, 0), ys = legs[0]![1];
    if (cx < px - 100) buses.push(mk('svid', [[cx, ys], [cx, -664], [px, -664]], 3, LEG_PITCH, 8, 100, { from: legs, to: pkgPads(PKG, 'w', -664, 3) }));
    else {
      buses.push(mk('svid', [[cx, ys], [cx, py]], 3, LEG_PITCH, 8, 0, { from: legs, to: pkgPads(PKG, 'n', Math.max(cx, px + 130), 3) }));
    }
  }

  // the regulators' controllers: a lane from each controller leg to the control leg of its phase. The nearest phase's lane runs straight in
  // (when the controller stands beside the phases); every other leaves from the next leg, drops to a level of its own under the phases, and rises
  // in the gap before its phase, the lane of the farthest phase on the lowest level, so none crosses another (they dive under the phases'
  // power stubs: `HOP_BUSES`)
  {
    const ph = g.vrmPhases, legs = legsOf(g.pwm, 'e'), yb = ph[0]!.y + ph[0]!.h + 40, lanes: Lane[] = [];
    ph.forEach((r, k) => {
      const leg = legs[k]!, c = cpuStageCtl(r), gx = r.x - 20, xk = ph[0]!.x - 40 - 16 * (k - 1), yk = yb + 18 * (k - 1);
      lanes.push(mkLane(chamfer(k === 0 ? [leg, [gx, leg[1]], [gx, c[1]], c] : [leg, [xk, leg[1]], [xk, yk], [gx, yk], [gx, c[1]], c], 14), k * 19 + 7));
    });
    buses.push({ id: 'pwmc', w: 8, lanes });
    const dp = g.dPhases, west = g.dpwmWest, dl = legsOf(g.dpwm, west ? 'e' : 'w'), seq = west ? dp : dp.slice().reverse(), yb2 = dp[0]!.y + dp[0]!.h + 18, lanes2: Lane[] = [];
    seq.forEach((r, k) => {
      const leg = dl[k]!, c = dramStageCtl(r), gx = r.x - 28, yk = yb2 + 10 * (west ? k - 1 : k);
      let route: Pt[];
      if (west) route = k === 0 ? [leg, [gx, leg[1]], [gx, c[1]], c] : [leg, [dp[0]!.x - 40 - 14 * (k - 1), leg[1]], [dp[0]!.x - 40 - 14 * (k - 1), yk], [gx, yk], [gx, c[1]], c];
      else { const xk = leg[0] - 22 - 14 * (seq.length - 1 - k); route = [leg, [xk, leg[1]], [xk, yk], [gx, yk], [gx, c[1]], c]; }
      lanes2.push(mkLane(chamfer(route, 12), k * 19 + 11));
    });
    buses.push({ id: 'pwmc', w: 8, lanes: lanes2 });
  }

  // the BIOS flash on its SPI lanes: its east legs straight across to the chipset's west legs
  {
    const a = legsOf(g.bios, 'e', 4, 26), b = legsFrom(g.chip, 'w', g.west.bios, 4);
    buses.push({ id: 'spi', w: 8, lanes: a.map((p, k) => mkLane([p, b[k]!], k * 17)) });
  }

  // the I/O controller: four lanes straight east to the chipset's west legs, and the header trunk: from its south leg west under the row of
  // pin headers, with a tap up to each header's first pin of the bottom row
  {
    const sio = g.sio, a = legsOf(sio, 'e'), b = legsFrom(g.chip, 'w', g.west.sio, 4), ym = mean(a, 1);
    buses.push(mk('lpc', [[a[0]![0], ym], [b[0]![0], ym]], 4, LEG_PITCH, 8, 0, { from: a, to: b }));
    const leg = legAt(sio, 's', 1, 4, LEG_PITCH), row = g.hdrs.filter((h) => h.name !== 'CLR_CMOS');
    const yb = Math.max(g.hdrY + 128 + 36, leg[1] + 30), pins = row.map((h) => headerPin(h.x, h.y, 0, h.rows - 1));
    const lanes: Lane[] = [mkLane(chamfer([leg, [leg[0], yb], [Math.min(...pins.map((q) => q[0])), yb]], 24), 31)];
    pins.forEach((q, i) => lanes.push(mkLane([[q[0], yb], q], i * 13 + 5)));
    buses.push({ id: 'hdr', w: 8, lanes });
  }

  // the I/O hub's links: the Ethernet PHY's four middle east legs and the audio codec's go down to the hub's north legs, the PHY's to the
  // left four, the codec's to the right four (they dive under the display lanes they cross)
  {
    const hubN = legsOf(g.hub, 'n'), top = hubN[0]![1], cl = legRun(g.codec, 'e', 4), cy = mean(cl, 1), xc = mean(hubN.slice(4), 0);
    buses.push(mk('hda', [[cl[0]![0], cy], [xc, cy], [xc, top]], 4, LEG_PITCH, 8, 80, { from: cl, to: hubN.slice(4), match: { w: 8, flare: 40, axis: 'h' } }));
    if (g.phy) {
      const pl = legRun(g.phy, 'e', 4), py = mean(pl, 1), xp = mean(hubN.slice(0, 4), 0);
      buses.push(mk('phyl', [[pl[0]![0], py], [xp, py], [xp, top]], 4, LEG_PITCH, 8, 60, { from: pl, to: hubN.slice(0, 4), match: { w: 8, flare: 40 } }));
    }
  }

  // the top board: four lanes from the chipset's south legs down onto the debug display, and the RGB strip's data lane from the ARGB header
  if (g.dbg) {
    const legs = legRun(g.chip, 's', 4);
    buses.push({ id: 'dbg', w: 8, lanes: legs.map((q, k) => mkLane([q, [q[0], g.dbg!.y]], k * 17)) });
  }
  if (g.rgb) {
    const h = g.hdrs.find((q) => q.name === 'ARGB')!, pin = headerPin(h.x, h.y, 1, 0), r = g.rgb;
    buses.push({ id: 'rgb', w: 8, lanes: [mkLane(chamfer([pin, [pin[0], r.y - 36], [r.x, r.y - 36], [r.x, r.y + r.h / 2]], 24), 0)] });
  }

  // the battery to the clear-CMOS jumper below it
  {
    const b = g.bat, cx = b.x + b.w / 2, cy = b.y + b.h / 2, j = g.hdrs.find((h) => h.name === 'CLR_CMOS')!;
    const lanes = [0, 1].map((i) => { const p = headerPin(j.x, j.y, i, 0); return mkLane([[p[0], cy + Math.sqrt(145 * 145 - (p[0] - cx) ** 2) - 6], p], i * 17); });
    buses.push({ id: 'rtc', w: 8, lanes });
  }

  // ---- power ----
  // 8-pin CPU 12 V: a comb: the four pins' runs drop onto the input rail, which runs east over every phase
  {
    const pins = cpuPowerPins(g.cpw), last = g.vrmPhases[g.vrmPhases.length - 1]!, ye = g.vrmRailY, y0 = pins[0]![1];
    const lanes: Lane[] = [mkLane(chamfer([[pins[0]![0], y0], [pins[0]![0], ye], [last.x + last.w - 30, ye]], 60), 0)];
    for (let i = 1; i < pins.length; i++) lanes.push(mkLane([[pins[i]![0], y0], [pins[i]![0], ye]], i * 31));
    buses.push({ id: 'pwrcpu', w: 30, lanes });
  }
  // core voltage: one run per phase from its output stub down into the package edge
  {
    const lanes: Lane[] = [];
    g.vrmPhases.forEach((r, i) => {
      const x = r.x + VRM_OUT_X, lx = Math.max(-820, Math.min(820, x));
      const dx = Math.abs(x - lx), route: Pt[] = dx < 1 ? [[x, r.y + r.h - 4], [x, py + 8]] : [[x, r.y + r.h - 4], [x, -1080], [lx, -1080 + dx], [lx, py + 8]];
      lanes.push(mkLane(route, i * 20));
    });
    buses.push({ id: 'vcore', lanes, w: 46 });
  }
  // 24-pin 12 V: straight west from the connector's top pin to the memory regulator's input rail (the connector sits level with it)
  {
    const pin = atx12v(g.atx), xw = g.dPhases[0]!.x + DRAM_IN_X;
    buses.push(mk('pwr12', [pin, [xw, pin[1]]], 1, 0, 36, 0));
  }
  // memory voltage: the regulator's output rail along the pins of the sockets, a drop into every DIMM (and, on the two-row boards,
  // round the east end to a second rail under the lower row)
  {
    const y = g.vdimmY;
    const xEnd = vdimmEnd(g);
    const lanes: Lane[] = [];
    for (const pts of bundle([[vdimmStart(g), y], [xEnd, y]], 2, 34, 60)) lanes.push(mkLane(pts, lanes.length * 31));
    const two = g.dimm.some((d) => d.flip);
    if (two) {
      const row1 = g.dimm.filter((d) => d.flip), yb = g.padY[1] + DIMM_H0 + 130, xs = xEnd + 140;
      for (const pts of bundle([[xEnd - 10, y], [xs, y], [xs, yb], [row1[0]!.rect.x + 20, yb]], 2, 34, 120)) lanes.push(mkLane(pts, lanes.length * 31));
    }
    // outputs of the phases down to the rail
    g.dPhases.forEach((r, i) => lanes.push(mkLane([[r.x + DRAM_OUT_X, r.y + r.h - 4], [r.x + DRAM_OUT_X, y - 17]], 90 + i * 20)));
    const bus: Bus = { id: 'vdimm', w: 26, lanes, taps: [] };
    g.dimm.forEach((d, i) => {
      const [cx, ey] = dimmPowerPad(d.rect, d.flip);
      bus.taps!.push({ key: 'dimm' + i, lanes: [mkLane(d.flip ? [[cx, g.padY[1] + DIMM_H0 + 130], [cx, ey]] : [[cx, y], [cx, ey]], i * 13)] });
    });
    buses.push(bus);
  }
  // audio: the codec's west legs (the 1st, 4th and 7th) straight to the pads behind the three jacks; ethernet: the PHY's four middle
  // legs straight to the pads behind the RJ45 (decoration: they never light)
  {
    const cw = legsOf(g.codec, 'w', 7), lanes: Lane[] = [];
    ['line-out', 'line-in', 'mic'].forEach((id, k) => lanes.push(mkLane([cw[k * 3]!, ioPads(ioPort(id), 1)[0]!], k * 17)));
    buses.push({ id: 'audio', w: 8, lanes });
  }
  if (g.phy) {
    const legs = legRun(g.phy, 'w', 4), pads = ioPads(ioPort('eth'), 4);
    buses.push(mk('lan', [[legs[0]![0], mean(legs, 1)], [pads[0]![0], mean(legs, 1)]], 4, LEG_PITCH, 8, 0, { from: legs, to: pads }));
  }
  addHops(buses);
  // the groups whose lanes must arrive together
  const cut = (b: Bus, sizes: number[]) => { let k = 0; return sizes.map((n) => b.lanes.slice(k, (k += n))); };
  for (const b of buses) {
    if (b.id === 'mem') b.groups = b.taps!.map((t) => t.lanes);
    else if (b.id === 'nvme') b.groups = cut(b, g.m2.map(() => NVME_LANES));
    else if (b.id === 'pcie') b.groups = cut(b, [12, ...g.pcie.slice(1).map(() => 4)]);
    else if (b.id === 'sata') b.groups = cut(b, g.sata.map(() => SATA_LANES));
    else if (b.id === 'usb') b.groups = cut(b, [4, ...Array.from({ length: g.usb }, () => 2)]);
    else if (['dmi', 'video', 'dp', 'lan'].includes(b.id)) b.groups = [b.lanes];
  }
  return buses;
}

// ---------------------------------------------------------------- cables (PSU to board, board to monitor)

export type CableKind = 'atx' | 'cpu' | 'pcie' | 'video';

export interface Cable {
  kind: CableKind;
  /** Cable centre line, dense and rounded (use for drawing, glow and hit rects). */
  path: Lane;
  /** Sleeve width. */
  w: number;
  /** Plug at the start (PSU / board end) and at the end. */
  a: Plug;
  b: Plug;
}

export interface Plug { x: number; y: number; /** Direction the cable leaves the plug, unit axis vector. */ dx: number; dy: number; w: number; l: number; pins: [number, number] }

/** Round the corners of a rectilinear route with radius r, sampled densely (step ~ 24). */
export function roundedPath(pts: Pt[], r: number, step = 24): Pt[] {
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!, p = pts[i]!, b = pts[i + 1]!;
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]), l2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const k = Math.min(r, l1 / 2, l2 / 2);
    const s: Pt = [p[0] + ((a[0] - p[0]) / l1) * k, p[1] + ((a[1] - p[1]) / l1) * k];
    const e: Pt = [p[0] + ((b[0] - p[0]) / l2) * k, p[1] + ((b[1] - p[1]) / l2) * k];
    const n = Math.max(4, Math.ceil((Math.PI * k * 0.5) / step));
    for (let j = 0; j <= n; j++) {
      const t = j / n, u = 1 - t;
      out.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]);
    }
  }
  out.push(pts[pts.length - 1]!);
  // resample straight runs so glow pulses and braid ticks have points to land on
  const dense: Pt[] = [out[0]!];
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1]!, b = out[i]!, d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / step));
    for (let j = 1; j <= n; j++) dense.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  return dense;
}

/**
 * The three PSU cables and the video cable. `pcie` is only drawn when a PCIe device needs it (and only on boards with the connector).
 * The 24-pin and the PCIe cable rise through the cable gutter and turn west into the east-edge connectors; the 8-pin cable keeps
 * rising to the top of the case, runs west over the board (the way a real build routes it) and drops onto the connector at the top edge.
 */
export function buildCables(): Cable[] {
  const psuPlugH = 150;
  const mkc = (kind: CableKind, route: Pt[], w: number, a: Plug, b: Plug, r: number): Cable => ({ kind, path: mkLane(roundedPath(route, r)), w, a, b });
  const plugV = (x: number, y: number, w: number, pins: [number, number]): Plug => ({ x, y, dx: 0, dy: -1, w, l: psuPlugH, pins });
  const g = GEO;
  const out: Cable[] = [];
  // ATX 24-pin: up the gutter, left into the plug that sits on the board connector
  {
    const x = PSU_PORTS.atx, y = g.atx.y + g.atx.h / 2, plugX = g.atx.x + 100;
    out.push(mkc('atx', [[x, PORT_Y - psuPlugH + 20], [x, y], [plugX + 240, y]], 120, plugV(x, PORT_Y, 150, [12, 2]),
      { x: plugX, y, dx: 1, dy: 0, w: g.atx.h - 60, l: 270, pins: [12, 2] }, 190));
  }
  // CPU 8-pin: up the gutter, west along the top of the case, down onto the connector (the plug's cable leaves upward)
  {
    const x = PSU_PORTS.cpu, cx = g.cpw.x + g.cpw.w / 2, plugBottom = g.cpw.y + g.cpw.h - 30, plugL = 300, yTop = g.bd.y - 120;
    out.push(mkc('cpu', [[x, PORT_Y - psuPlugH + 20], [x, yTop], [cx, yTop], [cx, plugBottom - plugL + 24]], 84, plugV(x, PORT_Y, 110, [4, 2]),
      { x: cx, y: plugBottom, dx: 0, dy: -1, w: g.cpw.w - 60, l: plugL, pins: [4, 2] }, 150));
  }
  // PCIe 6-pin (only when something in a PCIe slot wants it)
  if (g.pciew) {
    const x = PSU_PORTS.pcie, y = g.pciew.y + g.pciew.h / 2, plugX = g.pciew.x + 100;
    out.push(mkc('pcie', [[x, PORT_Y - psuPlugH + 20], [x, y], [plugX + 240, y]], 84, plugV(x, PORT_Y, 110, [3, 2]),
      { x: plugX, y, dx: 1, dy: 0, w: g.pciew.h - 40, l: 270, pins: [3, 2] }, 190));
  }
  // video: HDMI port on the rear I/O (west edge of the board) straight to the monitor's side port
  {
    const x0 = BR.io.x, x1 = -4200;
    out.push(mkc('video', [[x0 - 200, VIDEO_Y], [x1 + 200, VIDEO_Y]], 76,
      { x: x0, y: VIDEO_Y, dx: -1, dy: 0, w: 130, l: 220, pins: [1, 1] }, { x: x1, y: VIDEO_Y, dx: 1, dy: 0, w: 130, l: 220, pins: [1, 1] }, 1));
  }
  return out;
}

/** Thin rects along a lane for hit testing (pad on both sides). */
export function laneRects(l: Lane, pad: number): Rect[] {
  const rs: Rect[] = [];
  let s = 0;
  while (s < l.len) {
    const [x, y] = pointAt(l, s);
    rs.push({ x: x - pad, y: y - pad, w: pad * 2, h: pad * 2 });
    s += pad * 1.4;
  }
  return rs;
}

// ---------------------------------------------------------------- loose (unplugged) cables

/** The end of each cable the player moves: the board end of the PSU cables, the board (HDMI) end of the video cable. */
export const movablePlug = (c: Cable): Plug => (c.kind === 'video' ? c.a : c.b);

export interface Loose {
  /** Stub from the fixed end (PSU socket / monitor port) to the loose plug. */
  path: Lane;
  /** The loose plug lying at rest. */
  plug: Plug;
  /** Where the cable is fixed (PSU socket top, monitor side port) and the direction it leaves that fixed end. */
  anchor: Pt;
  anchorDir: Pt;
}

/** Scale of a loose plug relative to the fully seated one (the 24-pin plug is huge next to the PSU). */
export const LOOSE_SCALE = 0.54;

/** Where an unplugged cable's loose plug rests: the PSU cables in the gutter by the PSU, the HDMI cable near the monitor. */
export function looseCable(c: Cable): Loose {
  if (c.kind === 'video') {
    const y = VIDEO_Y + 420;
    const plug: Plug = { x: -3580, y, dx: -1, dy: 0, w: 130, l: 220, pins: [1, 1] };
    const route: Pt[] = [[-3990, VIDEO_Y], [-3880, VIDEO_Y], [-3880, y], [-3580 - 220 + 8, y]];
    return { path: mkLane(roundedPath(route, 90)), plug, anchor: [-4000, VIDEO_Y], anchorDir: [1, 0] };
  }
  const x = c.a.x;
  const w = Math.round(movablePlug(c).w * LOOSE_SCALE), l = 150;
  const top = c.kind === 'atx' ? 1800 : c.kind === 'cpu' ? 2200 : 1450;
  const plug: Plug = { x, y: top, dx: 0, dy: 1, w, l, pins: movablePlug(c).pins };
  const route: Pt[] = [[x, PORT_Y - 130 + 20], [x, top + l - 6]];
  return { path: mkLane(roundedPath(route, 1)), plug, anchor: [x, PORT_Y - 130 + 20], anchorDir: [0, -1] };
}

/** Sag cubic from the fixed end to the pointer, sampled; the cable the player stretches while dragging a plug. */
export function rubberBand(anchor: Pt, anchorDir: Pt, tip: Pt, steps = 28): Pt[] {
  const dx = tip[0] - anchor[0], dy = tip[1] - anchor[1], d = Math.hypot(dx, dy);
  const lead = Math.min(520, d * 0.45 + 80);
  const p1: Pt = [anchor[0] + anchorDir[0] * lead, anchor[1] + anchorDir[1] * lead];
  const sag = Math.min(260, d * 0.12);
  const p2: Pt = [tip[0] - dx * 0.22, tip[1] - dy * 0.22 + sag];
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push([
      u * u * u * anchor[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * tip[0],
      u * u * u * anchor[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * tip[1],
    ]);
  }
  return out;
}
