// World layout (arbitrary pixel units at zoom 1). The CPU socket sits at the origin. Ported from
// legacy/src/c3a.js: same region map, so the seeded decoration keeps its look.

export interface Rect { x: number; y: number; w: number; h: number }

export const BD: Rect = { x: -3400, y: -2500, w: 6800, h: 5200 };

export const BR = {
  vrmL: { x: -2250, y: -760, w: 950, h: 1520 }, vrmT: { x: -1100, y: -1580, w: 2200, h: 400 },
  dimm: { x: 1400, y: -840, w: 880, h: 1680 }, pcie: { x: -2950, y: 1120, w: 4150, h: 880 },
  chip: { x: 1900, y: 1300, w: 600, h: 600 }, io: { x: -3400, y: -2400, w: 650, h: 2000 },
  atx: { x: 3050, y: -1900, w: 350, h: 1000 }, cpw: { x: -1900, y: -2420, w: 560, h: 200 },
  m2: { x: 2420, y: -800, w: 200, h: 1300 }, sata: { x: 2400, y: 2250, w: 900, h: 200 },
  hex: { x: -800, y: 2150, w: 1700, h: 500 }, qr: { x: -3400, y: 1200, w: 420, h: 420 },
  audio: { x: -3400, y: 250, w: 700, h: 800 }, bat: { x: 1500, y: 2200, w: 340, h: 340 },
} satisfies Record<string, Rect>;

/** Keep-out rectangles for the generated traces and SMD parts. */
export const NOGO: Rect[] = [
  { x: -1250, y: -900, w: 2500, h: 1800 }, { x: -2300, y: -800, w: 1060, h: 1600 }, { x: -1150, y: -1600, w: 2300, h: 440 },
  { x: 1250, y: -900, w: 1100, h: 2000 }, { x: -3000, y: 1050, w: 4300, h: 1020 }, { x: 1850, y: 1250, w: 700, h: 700 },
  { x: -3400, y: -2450, w: 720, h: 2100 }, { x: 3000, y: -1950, w: 400, h: 1100 }, { x: -1950, y: -2450, w: 650, h: 260 },
  { x: 2380, y: -850, w: 260, h: 1400 }, { x: 2300, y: 2150, w: 1100, h: 300 }, { x: -800, y: 2150, w: 1700, h: 500 },
  { x: -3400, y: 1200, w: 420, h: 420 }, { x: -3400, y: 250, w: 700, h: 800 }, { x: 1450, y: 2150, w: 440, h: 440 },
];

export function inNoGo(x: number, y: number): boolean {
  for (const r of NOGO) if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
  return x < BD.x + 130 || x > BD.x + BD.w - 130 || y < BD.y + 130 || y > BD.y + BD.h - 130;
}

/** Deterministic PRNG (mulberry32). The board art is the same on every load. */
export function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BOARD_SEED = 1337;

// ---- CPU: package, die, floorplan (centred on the origin) ----
export const DIE: Rect = { x: -710, y: -565, w: 1420, h: 1130 };
export const PKG: Rect = { x: -900, y: -755, w: 1800, h: 1510 };
/** The cooler plate that sits on the package. */
export const COOLER: Rect = { x: -790, y: -690, w: 1580, h: 1380 };

export interface Tile extends Rect { id: string; label: string; sub: string }
const tile = (id: string, label: string, sub: string, x: number, y: number, w: number, h: number): Tile => ({ id, label, sub, x, y, w, h });
const STEP = 260;
const STAGE_LABELS: [string, string][] = [['IF', 'fetch'], ['ID', 'decode'], ['EX', 'execute'], ['MEM', 'memory'], ['WB', 'write back']];
/** Pipeline stage tiles, in order IF ID EX MEM WB. */
export const STAGES: Tile[] = STAGE_LABELS.map(([n, s], k) => tile(n, n, s, k * STEP - 620, -145, 200, 190));
/** Other floorplan blocks (decor, except those that light up from counters). */
export const BLOCKS: Tile[] = [
  tile('IC', 'I-CACHE', '', -620, -295, 200, 100),
  tile('BP', 'BRANCH PRED', '', -360, -295, 200, 100),
  tile('CLK', 'CLOCK', '', -100, -295, 200, 100),
  tile('DC', 'D-CACHE', '', 160, -295, 200, 100),
  tile('RF', 'REGISTERS', '', 420, -335, 200, 140),
  tile('UNCORE', 'UNCORE', '', -620, -475, 520, 150),
  tile('MC', 'MEM CTRL', '', 160, -475, 200, 150),
  tile('IO', 'I/O', '', 420, -475, 200, 120),
  tile('L2', 'L2 CACHE', '', -620, 245, 1240, 230),
];
export const CHIP_W = 156;
export const CHIP_H = 78;
/** Centre of the chip slot inside a stage tile. */
export const stageCentre = (s: number) => ({ x: STAGES[s]!.x + 100, y: STAGES[s]!.y + 105 });

// ---- DIMM, PCIe, PSU, monitor placement ----
export const DIMM_X = (i: number) => 1400 + i * 220;
export const DIMM_Y = -840, DIMM_W = 170, DIMM_H = 1680;
export const PCIE_RAILS: Rect[] = [
  { x: -2850, y: 1030, w: 3800, h: 60 }, { x: -2850, y: 2110, w: 1800, h: 60 }, { x: -2850, y: 2250, w: 600, h: 60 },
];
export const PSU: Rect = { x: 3600, y: -2000, w: 1200, h: 1300 };
export const MONITOR: Rect = { x: -5400, y: -2150, w: 1700, h: 1300 };
export const SCREEN: Rect = { x: -5240, y: -2000, w: 1380, h: 920 };

/** Everything the camera should see at once (board plus PSU and monitor). */
export const WORLD: Rect = { x: -5600, y: -2550, w: 10600, h: 5300 };

// ---- bus lanes (depend on the package rect) ----
export type LaneKind = 'mem' | 'pcie' | 'dmi';
export interface Lane { kind: LaneKind; pts: [number, number][]; seg: number[]; len: number; ph: number }

function mkLane(kind: LaneKind, pts: [number, number][], ph: number): Lane {
  let len = 0;
  const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    seg.push(d); len += d;
  }
  return { kind, pts, seg, len, ph };
}

export function buildLanes(rand: () => number): Lane[] {
  const k = PKG, out: Lane[] = [];
  for (let i = 0; i < 14; i++) {
    const y = -84 + i * 12, sx = k.x + k.w + 2, xd = 1150 + (13 - i) * 14, yt = 890 + i * 12;
    const pts: [number, number][] = [[sx, y]];
    if (i % 3 === 0) pts.push([sx + 60, y], [sx + 80, y - 14], [sx + 110, y + 14], [sx + 130, y]);
    pts.push([xd - 18, y], [xd, y + 18], [xd, yt - 18], [xd + 18, yt], [2240, yt]);
    out.push(mkLane('mem', pts, rand() * 3000));
  }
  for (let i = 0; i < 16; i++) {
    const xs = -120 + i * 16, ys = k.y + k.h + 2, xt = -300 + i * 30, ym = ys + 30, dx = xt - xs;
    out.push(mkLane('pcie', [[xs, ys], [xs, ym], [xt, ym + Math.abs(dx)], [xt, 1062]], rand() * 3000));
  }
  for (let i = 0; i < 8; i++) {
    const y = 300 + i * 10, xv = 1290 - 12 * i, yh = 1330 + 12 * i;
    out.push(mkLane('dmi', [[k.x + k.w + 2, y], [xv - 18, y], [xv, y + 18], [xv, yh - 18], [xv + 18, yh], [1900, yh]], rand() * 3000));
  }
  return out;
}

export function pointAt(l: Lane, s: number): [number, number] {
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

// ---- hover text-free region list (ids are the contract with the UI) ----
export const REGIONS: { id: string; rect: Rect }[] = [
  { id: 'vrm', rect: BR.vrmL }, { id: 'vrm2', rect: BR.vrmT }, { id: 'pcie', rect: BR.pcie }, { id: 'chipset', rect: BR.chip },
  { id: 'io', rect: BR.io }, { id: 'atx', rect: BR.atx }, { id: 'cpw', rect: BR.cpw }, { id: 'm2', rect: BR.m2 },
  { id: 'sata', rect: BR.sata }, { id: 'bat', rect: BR.bat }, { id: 'audio', rect: BR.audio }, { id: 'hex', rect: BR.hex },
  { id: 'qr', rect: BR.qr },
];
