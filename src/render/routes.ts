import { DIMM_H0 } from './boardlayout';
import {
  BR, GEO, PKG, PORT_Y, PSU_PORTS, SOCKET_E, VIDEO_Y, type Rect,
} from './layout';

// Orderly routing. A route is a centre line made of horizontal, vertical and 45 degree segments; a bundle is that
// centre line copied n times at a fixed spacing (miter joins keep the spacing constant through bends). Corners that
// would be 90 degrees are chamfered into two 45 degree bends. Nothing here is random.

export type Pt = [number, number];

export interface Lane { pts: Pt[]; seg: number[]; len: number; ph: number }

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

/** Replace every interior corner of a rectilinear polyline with a 45 degree chamfer of leg length c. */
export function chamfer(pts: Pt[], c: number): Pt[] {
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

export type BusKind = 'mem' | 'nvme' | 'dmi' | 'pcie' | 'sata' | 'usb' | 'video' | 'pwr12' | 'pwrcpu' | 'vcore' | 'vdimm' | 'audio' | 'lan';

export interface Bus {
  id: BusKind;
  /** Lanes from the first end to the second. */
  lanes: Lane[];
  /** Lane stroke width in world units. */
  w: number;
  /** Branches (one per DIMM) that light together with the main run when `tap(i)` is installed. */
  taps?: { key: string; lanes: Lane[] }[];
}

const mk = (id: BusKind, centre: Pt[], n: number, spacing: number, w: number, c = 120): Bus => ({
  id, w, lanes: bundle(centre, n, spacing, c).map((p, i) => mkLane(p, i * 37)),
});

/** Lanes in one memory bundle (one per DIMM) and their spacing: they land on the pad row of the socket. */
export const MEM_LANES = 6, MEM_SPACING = 18;
/**
 * x of the DMI column and of the first NVMe column that leave the south edge of the package (see `buildBuses`): all of them lie east
 * of the end of the x16 slot, DMI first, then one NVMe column per M.2 below the CPU, the lowest M.2 in the westmost column.
 */
export const DMI_X = 600, NVME_X0 = 720, NVME_DX = 80;
/** Lanes in an NVMe bundle and in a SATA bundle (and their spacing). */
export const NVME_LANES = 4, SATA_LANES = 3;

/**
 * Every board bus of the current tier (`GEO`), routed once. Lane order inside a bundle is stable; direction runs CPU outward.
 * Every run ends on a footprint: the CPU socket's escape pads at one end, a pad row on the socket / connector / chip at the other.
 * Memory is point-to-point: one bundle per DIMM, stacked in a staircase (the nearest DIMM takes the lane band closest to its
 * pads), so no two bundles cross.
 */
export function buildBuses(): Bus[] {
  const g = GEO;
  const px = PKG.x - SOCKET_E, qx = PKG.x + PKG.w + SOCKET_E, qy = PKG.y + PKG.h + SOCKET_E, py = PKG.y - SOCKET_E;
  const buses: Bus[] = [];

  // memory: a bundle per DIMM from the CPU east edge to its pad row (row 0 pads face down, row 1 pads face up)
  const mem: Bus = { id: 'mem', w: 9, lanes: [], taps: [] };
  g.dimm.forEach((d, i) => {
    const cx = d.rect.x + d.rect.w / 2, y = g.memY[i]!, pad = d.flip ? g.padY[1] : g.padY[0];
    mem.taps!.push({ key: 'dimm' + i, lanes: bundle([[qx, y], [cx, y], [cx, pad]], MEM_LANES, MEM_SPACING, 70).map((p, k) => mkLane(p, k * 37 + i * 11)) });
  });
  buses.push(mem);

  // The south edge of the package feeds the columns, west to east: PCIe x16 (ends on the first slot), DMI (the chipset below), then
  // NVMe (one per M.2 that lies below the CPU: the lowest one in the westmost column, so none crosses another); each column's x clears
  // the next, and the slots end before the DMI column. An M.2 level with the CPU is fed straight from its east edge.
  {
    const lanes: Lane[] = [];
    const below = g.m2.filter((m) => m.y + m.h / 2 > qy);
    g.m2.forEach((m) => {
      const y = m.y + m.h / 2, k = below.indexOf(m);
      const route: Pt[] = k < 0 ? [[qx, y], [m.x - 10, y]] : [[NVME_X0 + NVME_DX * (below.length - 1 - k), qy], [NVME_X0 + NVME_DX * (below.length - 1 - k), y], [m.x - 10, y]];
      for (const pts of bundle(route, NVME_LANES, 20, 100)) lanes.push(mkLane(pts, lanes.length * 37));
    });
    if (lanes.length) buses.push({ id: 'nvme', w: 10, lanes });
  }

  // DMI: CPU south edge straight down onto the chipset's top pads
  buses.push(mk('dmi', [[DMI_X, qy], [DMI_X, g.chip.y]], 8, 20, 9));

  // PCIe x16: CPU south edge straight down onto the first slot
  if (g.pcie[0]) buses.push(mk('pcie', [[250, qy], [250, g.pcie[0].y]], 12, 18, 9));

  // USB: the CPU's west edge straight to the rear I/O, through the hub controller that sits on the way
  buses.push(mk('usb', [[px, 0], [g.io.x + g.io.w, 0]], 4, 26, 9));

  // SATA: a bundle per port from the chipset's east edge (packed 84 apart, centred on the chipset) to the pads on the port's west side,
  // fanning out on 45 degree legs that all end at the same x (the outer ports start theirs first), so nothing crosses and the run
  // across the board is straight, along the port's row (the drive cables continue from there)
  if (g.sata.length) {
    const lanes: Lane[] = [], n = g.sata.length, cy = g.chip.y + g.chip.h / 2, x0 = g.chip.x + g.chip.w;
    const yc = (i: number) => cy + (i - (n - 1) / 2) * 84;
    const dmax = Math.max(0, ...g.sata.map((p, i) => Math.abs(p.y + p.h / 2 - yc(i))));
    const xe = x0 + 60 + dmax;
    g.sata.forEach((p, i) => {
      const y = p.y + p.h / 2, d = y - yc(i);
      const route: Pt[] = Math.abs(d) < 1 ? [[x0, y], [p.x - 6, y]] : [[x0, yc(i)], [xe - Math.abs(d), yc(i)], [xe, y], [p.x - 6, y]];
      for (const pts of bundle(route, SATA_LANES, 20, 40)) lanes.push(mkLane(pts, i * 29 + lanes.length * 37));
    });
    buses.push({ id: 'sata', w: 9, lanes });
  }

  // display: CPU west edge, west (above the USB lanes), up to the HDMI row, into the port
  buses.push(mk('video', [[px, -640], [-2300, -640], [-2300, VIDEO_Y], [g.io.x + g.io.w, VIDEO_Y]], 4, 28, 11, 200));

  // ---- power ----
  // 8-pin CPU 12 V: down from the connector, east along the input rail over every phase
  {
    const cx = g.cpw.x + g.cpw.w / 2, last = g.vrmPhases[g.vrmPhases.length - 1]!;
    buses.push(mk('pwrcpu', [[cx, g.cpw.y + g.cpw.h - 30], [cx, g.vrmRailY], [last.x + last.w - 30, g.vrmRailY]], 2, 40, 30, 90));
  }
  // core voltage: one run per phase from its output down into the package edge
  {
    const lanes: Lane[] = [];
    g.vrmPhases.forEach((r, i) => {
      const x = r.x + 110, lx = Math.max(-820, Math.min(820, x));
      lanes.push(mkLane(chamfer([[x, r.y + r.h - 4], [x, -1080], [lx, py + 8]], 90), i * 20));
    });
    buses.push({ id: 'vcore', lanes, w: 46 });
  }
  // 24-pin 12 V / 5 V: west from the connector to the memory regulator's input rail
  {
    const last = g.dPhases[g.dPhases.length - 1]!, xe = last.x + last.w + 30, yA = -1500, xm = xe + 380;
    const xw = g.dPhases[0]!.x + 60;
    const route: Pt[] = Math.abs(yA - g.dRailY) < 20 ? [[g.atx.x + 20, yA], [xw, yA]] : [[g.atx.x + 20, yA], [xm, yA], [xm, g.dRailY], [xw, g.dRailY]];
    buses.push(mk('pwr12', route, 2, 40, 30, 120));
  }
  // memory voltage: the regulator's output rail along the pins of the sockets, a drop into every DIMM (and, on the two-row boards,
  // round the east end to a second rail under the lower row)
  {
    const first = g.dPhases[0]!, y = g.vdimmY, lastRow0 = g.dimm.filter((d) => !d.flip).pop()!;
    const xEnd = lastRow0.rect.x + lastRow0.rect.w - 20;
    const lanes: Lane[] = [];
    for (const pts of bundle([[first.x + 40, y], [xEnd, y]], 2, 34, 60)) lanes.push(mkLane(pts, lanes.length * 31));
    const two = g.dimm.some((d) => d.flip);
    if (two) {
      const row1 = g.dimm.filter((d) => d.flip), yb = g.padY[1] + DIMM_H0 + 130, xs = xEnd + 140;
      for (const pts of bundle([[xEnd - 10, y], [xs, y], [xs, yb], [row1[0]!.rect.x + 20, yb]], 2, 34, 120)) lanes.push(mkLane(pts, lanes.length * 31));
    }
    // outputs of the phases down to the rail
    g.dPhases.forEach((r, i) => lanes.push(mkLane([[r.x + r.w / 2, r.y + r.h - 4], [r.x + r.w / 2, y - 17]], 90 + i * 20)));
    const bus: Bus = { id: 'vdimm', w: 26, lanes, taps: [] };
    g.dimm.forEach((d, i) => {
      const cx = d.rect.x + 30;
      bus.taps!.push({ key: 'dimm' + i, lanes: [mkLane(d.flip ? [[cx, g.padY[1] + DIMM_H0 + 130], [cx, g.padY[1] + DIMM_H0 - 6]] : [[cx, y], [cx, d.rect.y + 6]], i * 13)] });
    });
    buses.push(bus);
  }
  // audio: the codec to the jacks' shield; ethernet: the PHY to the jack's shield (they never light)
  buses.push(mk('audio', [[g.codec.x, g.codec.y + 90], [g.io.x + g.io.w, g.codec.y + 90]], 3, 24, 8));
  if (g.phy) buses.push(mk('lan', [[g.phy.x, g.phy.y + 130], [g.io.x + g.io.w, g.phy.y + 130]], 4, 24, 8));
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
