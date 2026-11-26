// Geometry of the NIC die symbols (docs/render/net.md "Inside the NIC and the router"). Shared by the static art and the live layer.

import type { Rect } from '../../../cpu/render/core/cpuplan';
import type { NicPlanInput } from './nicplan';

export const PAIRS = ['A', 'B', 'C', 'D'] as const;
/** The four lanes of a QSFP+ port, as 40GBASE-R numbers them (each lane is one way over its own twinax pair, so a stage has no echo to cancel). */
export const LANES = ['0', '1', '2', '3'] as const;
/** The Ethernet frame's fields and the width each takes in the drawing (not to scale: the payload is up to 1500 bytes, the rest a few). */
export const FRAME_FIELDS = [
  ['PRE', 10],
  ['DST', 14],
  ['SRC', 14],
  ['TYPE', 9],
  ['PAYLOAD', 41],
  ['FCS', 12],
] as const;
/** The three stages each pair goes through in the PHY. */
export const PHY_STAGES = ['AFE', 'DSP', 'PCS'] as const;

// ---------------------------------------------------------------- the geometry the drawing and the live layer share

/** The names of a PHY's rows: a copper port's pairs, or a QSFP+ port's lanes. */
export const phyNames = (input: Pick<NicPlanInput, 'port'>): readonly string[] =>
  input.port === 'qsfp' ? LANES : PAIRS;

/** The PHY: a row for each pair the standard uses (`pairs`: four, or two for 100BASE-TX; a QSFP+ port's four are lanes, `names`) with its three stages, the speed gauge and the line under it. */
export function phyGeom(
  a: Rect,
  pairs: number = PAIRS.length,
  names: readonly string[] = PAIRS,
): {
  pairs: { name: string; cy: number; stages: Rect[] }[];
  gauge: Rect;
  note: Rect;
  gap: number;
} {
  const lw = 20,
    foot = 50,
    pitch = (a.h - foot) / pairs,
    gap = 12,
    sw = (a.w - lw - 2 * gap) / 3;
  return {
    pairs: names.slice(0, pairs).map((name, k) => {
      const y = a.y + k * pitch,
        h = Math.min(30, pitch - 8),
        cy = y + pitch / 2;
      return {
        name,
        cy,
        stages: PHY_STAGES.map((_, j) => ({ x: a.x + lw + j * (sw + gap), y: cy - h / 2, w: sw, h })),
      };
    }),
    gauge: { x: a.x, y: a.y + a.h - foot + 8, w: a.w, h: 12 },
    note: { x: a.x, y: a.y + a.h - foot + 24, w: a.w, h: 24 },
    gap,
  };
}

/** The MAC: the frame as its fields, the lane a received frame runs along and the lane a sent one runs along under it. */
export function macGeom(a: Rect): { fields: Rect[]; rx: Rect; tx: Rect; note: Rect } {
  const total = FRAME_FIELDS.reduce((s, f) => s + f[1], 0),
    fh = Math.min(30, a.h * 0.3);
  let { x } = a;
  const fields = FRAME_FIELDS.map((f) => {
    const w = (a.w * f[1]) / total,
      r = { x, y: a.y + 2, w: w - 1.5, h: fh };
    x += w;
    return r;
  });
  const lane = (y: number) => ({ x: a.x + 22, y, w: a.w - 22, h: Math.min(14, (a.h - fh - 14) / 3) });
  const rx = lane(a.y + fh + 12),
    tx = lane(rx.y + rx.h + 8);
  return {
    fields,
    rx,
    tx,
    note: { x: a.x, y: tx.y + tx.h + 6, w: a.w, h: Math.max(10, a.y + a.h - (tx.y + tx.h + 6)) },
  };
}

/** The statistics: the two counters and the two load bars. */
export function statsGeom(a: Rect): {
  rx: Rect;
  tx: Rect;
  rxVal: Rect;
  txVal: Rect;
  rxBar: Rect;
  txBar: Rect;
  nw: number;
} {
  const rh = Math.min(22, (a.h - 12) / 3),
    nw = 40;
  const row = (k: number) => ({ x: a.x, y: a.y + k * (rh + 4), w: a.w, h: rh });
  const bar = (k: number) => {
    const w = (a.w - 12) / 2;
    return { x: a.x + k * (w + 12), y: a.y + 2 * (rh + 4) + 2, w, h: rh - 4 };
  };
  return {
    rx: row(0),
    tx: row(1),
    rxVal: { x: a.x + nw, y: row(0).y, w: a.w - nw, h: rh },
    txVal: { x: a.x + nw, y: row(1).y, w: a.w - nw, h: rh },
    rxBar: bar(0),
    txBar: bar(1),
    nw,
  };
}

/**
 * A queue: along its top the chip's own buffer, one cell for each segment it holds (`fifo`: only the receive side has one, the transmit side reads the kernel's ring straight), and below it
 * the transfers in flight, a row each.
 */
export function queueGeom(
  a: Rect,
  fifo: number,
): {
  cells: Rect[];
  fifoBox: Rect | null;
  label: Rect;
  flows: { row: Rect; label: Rect; bar: Rect; pct: Rect }[];
} {
  const ch = 16,
    lw = 40,
    cw = (a.w - lw - 4) / Math.max(1, fifo),
    top = fifo > 0 ? ch + 8 : 0,
    rows = Math.max(0, Math.min(3, Math.floor((a.h - top) / 26)));
  return {
    cells: Array.from({ length: fifo }, (_, k) => ({ x: a.x + lw + k * cw + 1, y: a.y + 1, w: cw - 2, h: ch })),
    fifoBox: fifo > 0 ? { x: a.x + lw, y: a.y, w: fifo * cw, h: ch + 2 } : null,
    label: { x: a.x, y: a.y, w: lw, h: ch + 2 },
    flows: Array.from({ length: rows }, (_, k) => {
      const y = a.y + top + k * 26,
        h = 22;
      return {
        row: { x: a.x, y, w: a.w, h },
        label: { x: a.x + 2, y, w: a.w * 0.5, h },
        bar: { x: a.x + a.w * 0.53, y: y + h * 0.28, w: a.w * 0.34, h: h * 0.44 },
        pct: { x: a.x + a.w * 0.89, y, w: a.w * 0.11, h },
      };
    }),
  };
}

/**
 * The DMA engine: the two descriptor rings it walks (the kernel's receive slots and transmit slots, in RAM: `rx` and `tx` cells), the two ways a frame goes (into RAM, out of RAM) and the
 * line that counts the words it moved.
 */
export function dmaGeom(
  a: Rect,
  rx: number,
  tx: number,
): {
  ring: Rect;
  rx: { label: Rect; cells: Rect[] };
  tx: { label: Rect; cells: Rect[] };
  engine: Rect;
  down: Rect;
  up: Rect;
  note: Rect;
} {
  const rh = Math.min(40, a.h * 0.22),
    gap = 16,
    foot = 22,
    ey = a.y + rh + gap,
    eh = Math.max(30, a.h - rh - gap - foot - 4);
  const pad = 8,
    lw = 22,
    mid = 12,
    gw = (a.w - 2 * pad - mid) / 2,
    cy = a.y + rh * 0.28,
    ch = rh * 0.44;
  // (the engine's two halves: the way into RAM on the left, the way out of it on the right, each an arrow and its name)
  const half = (k: number) => ({ x: a.x + 4 + k * (a.w / 2), y: ey + 4, w: a.w / 2 - 8, h: eh - 8 });
  const group = (k: number, n: number) => {
    const x0 = a.x + pad + k * (gw + mid),
      cw = (gw - lw) / Math.max(1, n);
    return {
      label: { x: x0, y: a.y, w: lw, h: rh },
      cells: Array.from({ length: n }, (_, i) => ({ x: x0 + lw + i * cw + 1, y: cy, w: cw - 2, h: ch })),
    };
  };
  return {
    ring: { x: a.x, y: a.y, w: a.w, h: rh },
    rx: group(0, rx),
    tx: group(1, tx),
    engine: { x: a.x, y: ey, w: a.w, h: eh },
    down: half(0),
    up: half(1),
    note: { x: a.x, y: a.y + a.h - foot, w: a.w, h: foot },
  };
}

/** The PCIe core: a lane is two pairs, one into the card and one out of it. */
export function pcieGeom(
  a: Rect,
  lanes: number,
): {
  lanes: { idx: number; rx: Rect; tx: Rect; tag: { x: number; y: number } }[];
  note: Rect;
} {
  const cw = Math.min(30, (a.w - 4) / lanes),
    x0 = a.x + (a.w - lanes * cw) / 2,
    h = Math.max(30, a.h - 66),
    y = a.y + 6;
  return {
    lanes: Array.from({ length: lanes }, (_, k) => ({
      idx: k,
      rx: { x: x0 + k * cw + cw * 0.12, y, w: cw * 0.34, h },
      tx: { x: x0 + k * cw + cw * 0.54, y, w: cw * 0.34, h },
      tag: { x: x0 + k * cw + cw / 2, y: y + h + 9 },
    })),
    note: { x: a.x, y: y + h + 18, w: a.w, h: Math.max(12, a.y + a.h - (y + h + 18)) },
  };
}

/** The heat sensor: the scale from room temperature to the damage point, with the throttle and unstable marks on it. */
export function tempGeom(a: Rect): { bar: Rect; icon: { cx: number; cy: number; h: number } } {
  const sx = a.x + 40,
    bar = { x: sx, y: a.y + a.h * 0.3, w: a.w - 40 - 8, h: a.h * 0.4 };
  return { bar, icon: { cx: a.x + 16, cy: a.y + a.h / 2, h: a.h } };
}

/** A temperature's place on the sensor's scale (0 at 20 degrees, 1 at the damage point). */
export const tempAt = (c: number, damage: number): number =>
  Math.min(1, Math.max(0, (c - 20) / Math.max(1, damage - 20)));

// ---------------------------------------------------------------- the static symbols

/** Draw the symbol of block `b` into `g`; `put` adds a label. `input` is the plan's. */
