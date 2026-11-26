import type { Rect } from '../../../cpu/render/core/cpuplan';

// The geometry the drawing and the live layer share: where the program counter's digits, the fetch rows, a lane's ALU units, the host link's
// cells and the launch registers sit inside a symbol's area. The live layer paints into these rectangles, so the drawing must use the same ones.

/** The program counter's digits, on the left of the block with the next-pc logic beside them when it is wide enough. */
export const pcArea = (a: Rect): Rect => ({ x: a.x, y: a.y, w: a.w >= 200 ? a.w * 0.54 : a.w, h: Math.min(a.h, 22) });

/** The fetch: a window of the kernel, the word being fetched on the first row (the live word goes there), the words behind it dim; a wide block keeps a side panel (kernel base + pc = the address) on the right. */
export function fetchGeom(a: Rect): { gutter: number; rows: Rect[]; side: Rect | null } {
  const gutter = a.w >= 90 ? 18 : 0,
    rh = Math.min(14, a.h),
    n = Math.max(1, Math.min(5, Math.floor((a.h + 3) / 17)));
  const side = a.w >= 400 ? { x: a.x + a.w - 150, y: a.y, w: 150, h: rh } : null,
    rw = a.w - gutter - (side ? 158 : 0);
  return {
    gutter,
    rows: Array.from({ length: n }, (_, k) => ({ x: a.x + gutter, y: a.y + k * 17, w: rw, h: rh })),
    side,
  };
}

/** The units inside a lane's ALU, in the order they are drawn, and the unit an instruction goes through (-1 when it does not use the ALU). */
export const ALU_UNITS = ['add', 'logic', 'shift', 'cmp', 'mul', 'min/max'] as const;
export function aluUnitOf(name: string): number {
  if (/^(?:vadd|vsub|vaddi|vli|lane|vld|vst)$/u.test(name)) {
    return 0;
  }
  if (/^(?:vand|vor|vxor|vandi)$/u.test(name)) {
    return 1;
  }
  if (/^(?:vsll|vsrl|vsra|vslli|vsrli|vsrai)$/u.test(name)) {
    return 2;
  }
  if (/^(?:vslt|mset(?:eq|ne|lt|ge))$/u.test(name)) {
    return 3;
  }
  if (name === 'vmul') {
    return 4;
  }
  if (/^(?:vmin|vmax)$/u.test(name)) {
    return 5;
  }
  return -1;
}

/** Inside a roomy lane cell: the operand bus, one box per unit, the mux that picks the result, the result latch. Null for the small cells of the wider cards. */
export function laneUnits(
  r: Rect,
): { units: Rect[]; busX: number; mux: Rect; res: Rect; notch: { x: number; y: number } } | null {
  if (r.w < 70 || r.h < 40) {
    return null;
  }
  const ax = r.x + 1.5,
    ay = r.y + 1.5,
    aw = r.w - 3,
    ah = r.h - 3,
    n = ALU_UNITS.length;
  const busX = ax + aw * 0.22,
    top = ay + ah * 0.16,
    span = ah * 0.68,
    pitch = span / n,
    ux = busX + 12,
    uw = aw * 0.3;
  const mux = { x: ux + uw + 9, y: top, w: aw * 0.07, h: span };
  return {
    units: ALU_UNITS.map((_, k) => ({ x: ux, y: top + k * pitch + 1, w: uw, h: pitch - 2 })),
    busX,
    mux,
    res: {
      x: mux.x + mux.w + 14,
      y: ay + ah * 0.38,
      w: Math.max(10, ax + aw * 0.96 - (mux.x + mux.w + 14)),
      h: ah * 0.24,
    },
    notch: { x: ax + aw * 0.14, y: ay + ah / 2 },
  };
}

/** One lane of the host link: its centre line, its receive cell and its transmit cell. */
interface PcieLane {
  y: number;
  rx: Rect;
  tx: Rect;
}

/** The host link: a receive and a transmit cell per lane, the bus into the DMA engine, and its credit counters. */
export function pcieGeom(a: Rect): {
  top: number;
  bodyH: number;
  n: number;
  cw: number;
  busX: number;
  lanes: PcieLane[];
  dma: Rect;
  credits: Rect[];
} {
  const { x, y, w, h } = a,
    foot = h > 70 ? 16 : 0,
    top = h > 50 ? 9 : 0,
    bodyH = h - foot - top;
  const n = Math.max(2, Math.min(8, Math.floor(bodyH / 11))),
    cw = w * 0.25 - 1,
    busX = x + w * 0.56;
  const lanes = Array.from({ length: n }, (_, k): PcieLane => {
    const ry = y + top + ((k + 0.5) * bodyH) / n;
    return { y: ry, rx: { x, y: ry - 3, w: cw, h: 6 }, tx: { x: x + cw + 2, y: ry - 3, w: cw, h: 6 } };
  });
  const dh = Math.min(bodyH * 0.5, 44),
    dy = y + top + (bodyH - dh) / 2,
    dx = x + w * 0.64,
    dw = x + w - dx;
  const credits: Rect[] =
    dy + dh + 12 < y + h - foot
      ? Array.from({ length: 4 }, (_, k) => ({
          x: dx + 1 + (k * (dw - 2)) / 4,
          y: dy + dh + 6,
          w: (dw - 2) / 4 - 2,
          h: 5,
        }))
      : [];
  return { top, bodyH, n, cw, busX, lanes, dma: { x: dx, y: dy, w: dw, h: dh }, credits };
}

/** The launch registers: a value cell per register, the go flag the bus raises, and with room the three states of a launch and the command queue. */
export function launchGeom(a: Rect): {
  rows: number;
  pitch: number;
  gut: number;
  vw: number;
  busX: number;
  regs: Rect[];
  go: Rect;
  states: Rect[];
  slots: Rect[];
} {
  const { x, y, w, h } = a,
    rows = h >= 85 ? 5 : Math.max(3, Math.floor(h / 15));
  const state = h >= rows * 17 + 34,
    queue = h >= rows * 17 + 70,
    pitch = state ? 17 : Math.min(26, h / rows),
    gut = Math.min(34, w * 0.26),
    vw = w * 0.6 - gut,
    busX = x + w * 0.68;
  const regs: Rect[] = Array.from({ length: rows }, (_, k) => ({ x: x + gut, y: y + k * pitch, w: vw, h: pitch - 3 }));
  const gh = Math.min(rows * pitch * 0.5, 26),
    gy = y + (rows * pitch - gh) / 2 - 1.5,
    gx = x + w * 0.76,
    go: Rect = { x: gx, y: gy, w: x + w - gx, h: gh };
  const sy = y + rows * pitch + 14,
    bw = (w - 28) / 3,
    qy = sy + 34;
  const states: Rect[] = state ? [0, 1, 2].map((k) => ({ x: x + k * (bw + 14), y: sy, w: bw, h: 14 })) : [];
  const slots: Rect[] = queue
    ? [0, 1, 2, 3].map((k) => ({ x: x + k * ((w - 3) / 4), y: qy, w: (w - 3) / 4 - 3, h: 12 }))
    : [];
  return { rows, pitch, gut, vw, busX, regs, go, states, slots };
}
