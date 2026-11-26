// Geometry of the router SoC symbols (docs/render/net.md "Inside the NIC and the router"). Shared by the static art and the live layer.

import type { Rect } from '../../../cpu/render/core/cpuplan';
import * as nicglyph from '../nic/nicglyph';

// ---------------------------------------------------------------- the geometry the drawing and the live layer share

/** The WAN MAC: the frame as its fields, the lane a received frame runs along and the lane a sent one runs along under it, then the address the plan gives and the MAC address of the jack. */
export function wanGeom(a: Rect): { fields: Rect[]; rx: Rect; tx: Rect; ip: Rect; mac: Rect } {
  const total = nicglyph.FRAME_FIELDS.reduce((s, f) => s + f[1], 0),
    fh = 20;
  let { x } = a;
  const fields = nicglyph.FRAME_FIELDS.map((f) => {
    const w = (a.w * f[1]) / total,
      r = { x, y: a.y + 2, w: w - 1.5, h: fh };
    x += w;
    return r;
  });
  const lane = (y: number) => ({ x: a.x + 22, y, w: a.w - 22, h: 10 });
  const rx = lane(a.y + fh + 8),
    tx = lane(rx.y + rx.h + 6);
  return {
    fields,
    rx,
    tx,
    ip: { x: a.x, y: tx.y + tx.h + 8, w: a.w, h: 24 },
    mac: { x: a.x, y: tx.y + tx.h + 34, w: a.w, h: 22 },
  };
}

/** The CPU: its cores as tiles (up to four to a row) and the two lines under them. */
export function cpuGeom(a: Rect, cores: number): { cores: Rect[]; lease: Rect; via: Rect } {
  const cols = Math.min(cores, 4),
    rows = Math.ceil(cores / cols),
    noteH = 46,
    gh = a.h - noteH - 6,
    th = Math.max(10, Math.min(34, (gh - (rows - 1) * 6) / rows)),
    tw = Math.min(56, (a.w - (cols - 1) * 8) / cols);
  const x0 = a.x + (a.w - (cols * tw + (cols - 1) * 8)) / 2;
  return {
    cores: Array.from({ length: cores }, (_, k) => ({
      x: x0 + (k % cols) * (tw + 8),
      y: a.y + Math.floor(k / cols) * (th + 6),
      w: tw,
      h: th,
    })),
    lease: { x: a.x, y: a.y + a.h - noteH + 2, w: a.w, h: 22 },
    via: { x: a.x, y: a.y + a.h - 22, w: a.w, h: 20 },
  };
}

/** The memory controller: a channel for each DRAM chip, the ring of packet buffers under them and the line under that. */
export function memGeom(a: Rect, chips: number): { chips: Rect[]; cells: Rect[]; ringBox: Rect; note: Rect } {
  const gap = 8,
    cw = Math.min(70, (a.w - (chips - 1) * gap) / chips),
    ch = Math.min(30, a.h * 0.28),
    ring = 20,
    cell = (a.w - 8) / ring;
  const x0 = a.x + (a.w - (chips * cw + (chips - 1) * gap)) / 2;
  return {
    chips: Array.from({ length: chips }, (_, k) => ({ x: x0 + k * (cw + gap), y: a.y + 2, w: cw, h: ch })),
    cells: Array.from({ length: ring }, (_, k) => ({ x: a.x + k * cell + 1, y: a.y + ch + 12, w: cell - 2, h: 14 })),
    ringBox: { x: a.x, y: a.y + ch + 11, w: ring * cell, h: 16 },
    note: { x: a.x, y: a.y + ch + 34, w: a.w, h: Math.max(14, a.y + a.h - (a.y + ch + 34)) },
  };
}

/** One row of the NAT table or of the transfers, for a row of height `h` at `y` over the width of `a`: the address chain, the progress bar and the percent. */
const natRow = (a: Rect, y: number, h: number) => ({
  row: { x: a.x, y, w: a.w, h },
  label: { x: a.x + 2, y, w: a.w * 0.79, h },
  bar: { x: a.x + a.w * 0.81, y: y + h * 0.28, w: a.w * 0.11, h: h * 0.44 },
  pct: { x: a.x + a.w * 0.93, y, w: a.w * 0.07, h },
});

/** The forwarding engine: its four stages in a row, the table of clients under them (a cell for each slot, two rows when there are many), the caption and the rows of the NAT table, one for each client in service. */
export function pktGeom(
  a: Rect,
  slots: number,
): {
  stages: Rect[];
  cells: Rect[];
  table: Rect;
  caption: Rect;
  flows: { row: Rect; label: Rect; bar: Rect; pct: Rect }[];
  more: Rect;
} {
  const gap = 10,
    sw = (a.w - 3 * gap) / 4,
    sh = 26,
    per = slots > 8 ? Math.ceil(slots / 2) : slots,
    cw = (a.w - 8) / Math.max(1, per),
    ch = 13,
    ty = a.y + sh + 9,
    trows = slots > 8 ? 2 : 1;
  const cy = ty + trows * (ch + 3) + 3,
    fy = cy + 15,
    rows = Math.max(0, Math.min(4, Math.floor((a.y + a.h - 16 - fy) / 22)));
  return {
    stages: [0, 1, 2, 3].map((k) => ({ x: a.x + k * (sw + gap), y: a.y, w: sw, h: sh })),
    cells: Array.from({ length: slots }, (_, k) => ({
      x: a.x + (k % per) * cw + 1,
      y: ty + Math.floor(k / per) * (ch + 3),
      w: cw - 2,
      h: ch,
    })),
    table: { x: a.x, y: ty - 1, w: per * cw, h: trows * (ch + 3) + 1 },
    caption: { x: a.x, y: cy, w: a.w, h: 13 },
    flows: Array.from({ length: rows }, (_, k) => natRow(a, fy + k * 22, 20)),
    more: { x: a.x, y: a.y + a.h - 14, w: a.w, h: 14 },
  };
}

/** The LAN switch: the uplink to the engine on the left, the LAN ports on the right (a bar each, with the MAC address learned on it), the fabric between them and the line under it. */
export function swGeom(a: Rect, lan: number): { up: Rect; ports: Rect[]; fabric: Rect; note: Rect } {
  const noteH = 24,
    h = a.h - noteH - 4,
    pitch = h / lan,
    bh = Math.min(20, pitch - 3),
    up = { x: a.x, y: a.y, w: 36, h },
    pw = Math.min(a.w * 0.62, 210);
  return {
    up,
    ports: Array.from({ length: lan }, (_, k) => ({
      x: a.x + a.w - pw,
      y: a.y + k * pitch + (pitch - bh) / 2,
      w: pw,
      h: bh,
    })),
    fabric: { x: up.x + up.w, y: a.y, w: a.w - up.w - pw, h },
    note: { x: a.x, y: a.y + a.h - noteH, w: a.w, h: noteH },
  };
}

/** The traffic block: the two counters with their load bars, then the two lines of speeds and the limit. */
export function statGeom(a: Rect): { rx: Rect; rxBar: Rect; tx: Rect; txBar: Rect; lines: Rect[] } {
  const nw = 30,
    row = (k: number) => a.y + k * 34,
    w = a.w - nw;
  return {
    rx: { x: a.x + nw, y: row(0), w, h: 20 },
    rxBar: { x: a.x + nw, y: row(0) + 21, w, h: 8 },
    tx: { x: a.x + nw, y: row(1), w, h: 20 },
    txBar: { x: a.x + nw, y: row(1) + 21, w, h: 8 },
    lines: [
      { x: a.x, y: a.y + 70, w: a.w, h: 20 },
      { x: a.x, y: a.y + 92, w: a.w, h: 20 },
    ],
  };
}

// ---------------------------------------------------------------- the static symbols

/** Draw the symbol of block `b` into `g`; `put` adds a label. `input` is the plan's. */
