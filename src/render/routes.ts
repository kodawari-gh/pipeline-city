import {
  BR, DIMM_H, DIMM_X, DIMM_Y, PKG, PORT_Y, PSU_PORTS, SOCKET_E, VIDEO_Y, type Rect,
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

export type BusKind = 'mem' | 'nvme' | 'dmi' | 'pcie' | 'sata' | 'usb' | 'video' | 'pwr12' | 'pwrcpu' | 'pwr5' | 'vcore';

export interface Bus {
  id: BusKind;
  /** Lanes from the first end to the second. */
  lanes: Lane[];
  /** Lane stroke width in world units. */
  w: number;
  /** Branches (e.g. one per DIMM) that light together with the main run when `tap(i)` is installed. */
  taps?: { key: string; lanes: Lane[] }[];
}

const mk = (id: BusKind, centre: Pt[], n: number, spacing: number, w: number, c = 120): Bus => ({
  id, w, lanes: bundle(centre, n, spacing, c).map((p, i) => mkLane(p, i * 37)),
});

/** Every board bus, routed once. Lane order inside a bundle is stable; direction runs CPU outward. */
export function buildBuses(): Bus[] {
  const px = PKG.x - SOCKET_E, qx = PKG.x + PKG.w + SOCKET_E, qy = PKG.y + PKG.h + SOCKET_E;
  const buses: Bus[] = [];

  // memory bus: CPU east edge -> down the channel west of the DIMMs -> under the DIMM bank; a comb of equal-length taps per DIMM
  const mem = mk('mem', [[qx, 0], [1250, 0], [1250, 1000], [2300, 1000]], 10, 22, 11, 130);
  mem.taps = [0, 1, 2, 3].map((d) => ({
    key: 'dimm' + d,
    lanes: Array.from({ length: 10 }, (_, k): Lane => {
      const x = DIMM_X(d) + 24 + k * 14, ylane = 880, yb = DIMM_Y + DIMM_H;
      return mkLane([[x, yb], [x, ylane]], k * 13);
    }),
  }));
  buses.push(mem);

  // NVMe: CPU east edge, up and over the DIMM tops, down into the M.2 slot
  buses.push(mk('nvme', [[qx, -640], [1200, -640], [1200, -1000], [BR.m2.x + 100, -1000], [BR.m2.x + 100, BR.m2.y]], 6, 22, 10, 110));

  // DMI: CPU west edge straight to the chipset
  buses.push(mk('dmi', [[px, 0], [BR.chip.x + BR.chip.w, 0]], 8, 22, 9));

  // PCIe x16: CPU south edge straight down into the slot
  buses.push(mk('pcie', [[450, qy], [450, 1030]], 12, 18, 9));

  // USB: chipset west edge to the rear I/O
  buses.push(mk('usb', [[BR.chip.x, 0], [BR.io.x + BR.io.w, 0]], 4, 26, 9));

  // SATA: chipset south edge to SATA port 1
  buses.push(mk('sata', [[BR.sata.x + 75, BR.chip.y + BR.chip.h], [BR.sata.x + 75, BR.sata.y]], 4, 24, 9));

  // display: CPU west edge, jog up, to the HDMI port on the rear I/O
  buses.push(mk('video', [[px, -640], [-1560, -640], [-1560, VIDEO_Y], [BR.io.x + BR.io.w, VIDEO_Y]], 4, 28, 11, 200));

  // power on the board
  // 24-pin 12 V: west along the north-east to the right end of the VRM row
  buses.push(mk('pwr12', [[BR.atx.x, -1250], [BR.vrm.x + BR.vrm.w, -1250]], 3, 56, 30));
  // 8-pin CPU 12 V: west along the top, down into the VRM row
  buses.push(mk('pwrcpu', [[BR.cpw.x, BR.cpw.y + BR.cpw.h / 2], [900, BR.cpw.y + BR.cpw.h / 2], [900, BR.vrm.y]], 4, 52, 28, 160));
  // 5 V rail: down the east side to the DRAM VRM
  buses.push(mk('pwr5', [[BR.atx.x, -620], [2950, -620], [2950, BR.dvrm.y + BR.dvrm.h / 2], [BR.dvrm.x + BR.dvrm.w, BR.dvrm.y + BR.dvrm.h / 2]], 3, 40, 22, 140));
  // core voltage: VRM row straight down to the package
  const vc: Lane[] = [];
  for (let i = 0; i < 9; i++) { const x = -480 + i * 120; vc.push(mkLane([[x, BR.vrm.y + BR.vrm.h], [x, PKG.y - SOCKET_E + 10]], i * 20)); }
  buses.push({ id: 'vcore', lanes: vc, w: 30 });
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

/** The three PSU cables and the video cable. `pcie` is only drawn when a PCIe device needs it. */
export function buildCables(): Cable[] {
  const psuPlugH = 150;
  const mkc = (kind: CableKind, route: Pt[], w: number, a: Plug, b: Plug, r: number): Cable => ({ kind, path: mkLane(roundedPath(route, r)), w, a, b });
  const plugV = (x: number, y: number, w: number, pins: [number, number]): Plug => ({ x, y, dx: 0, dy: -1, w, l: psuPlugH, pins });
  const out: Cable[] = [];
  // ATX 24-pin: up the gutter, left into the plug that sits on the board connector
  {
    const x = PSU_PORTS.atx, y = BR.atx.y + BR.atx.h / 2, plugX = BR.atx.x + 100;
    out.push(mkc('atx', [[x, PORT_Y - psuPlugH + 20], [x, y], [plugX + 240, y]], 120, plugV(x, PORT_Y, 150, [12, 2]),
      { x: plugX, y, dx: 1, dy: 0, w: BR.atx.h - 60, l: 270, pins: [12, 2] }, 190));
  }
  // CPU 8-pin
  {
    const x = PSU_PORTS.cpu, y = BR.cpw.y + BR.cpw.h / 2, plugX = BR.cpw.x + 100;
    out.push(mkc('cpu', [[x, PORT_Y - psuPlugH + 20], [x, y], [plugX + 240, y]], 84, plugV(x, PORT_Y, 110, [4, 2]),
      { x: plugX, y, dx: 1, dy: 0, w: BR.cpw.h - 40, l: 270, pins: [4, 2] }, 190));
  }
  // PCIe 6-pin (only when something in a PCIe slot wants it)
  {
    const x = PSU_PORTS.pcie, y = BR.pciew.y + BR.pciew.h / 2, plugX = BR.pciew.x + 100;
    out.push(mkc('pcie', [[x, PORT_Y - psuPlugH + 20], [x, y], [plugX + 240, y]], 84, plugV(x, PORT_Y, 110, [3, 2]),
      { x: plugX, y, dx: 1, dy: 0, w: BR.pciew.h - 40, l: 270, pins: [3, 2] }, 190));
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
