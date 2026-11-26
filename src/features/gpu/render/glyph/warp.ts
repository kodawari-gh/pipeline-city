import type { Rect } from '../../../cpu/render/core/cpuplan';
import { pcDigits } from '../../../cpu/render/die/blockart';
import type { Pen } from './pen';

// The warps of an SM: the scheduler (a scoreboard and the round robin that picks the warp to issue) and one card per warp.

/** The scheduler's layout: a row per warp, a column per register, and the picker on the right when the block is wide. */
interface Sched {
  rows: number;
  cols: number;
  picker: boolean;
  gut: number;
  headH: number;
  sw: number;
  cw: number;
  rh: number;
}

function schedGeom(p: Pen): Sched {
  const { w, h } = p.a,
    rows = p.b.grid?.rows ?? 1,
    cols = p.b.grid?.cols ?? 8,
    picker = w >= 160,
    gut = w >= 90 ? 30 : 12,
    headH = h >= 30 ? 8 : 0;
  const sw = (picker ? w * 0.62 : w) - gut;
  return { rows, cols, picker, gut, headH, sw, cw: sw / cols, rh: Math.min(34, (h - headH) / rows) };
}

/** The scoreboard: a bit per register and warp (pending writes), and each warp's ready line, a gate that is true when none of the registers the next instruction reads is still pending. */
function drawScoreboard(p: Pen, s: Sched): void {
  const { x, y } = p.a,
    { rect, stub, poly, soft, solid, line } = p.kit,
    { rows, cols, gut, headH, sw, cw, rh } = s;
  if (headH && cw >= 9) {
    for (let k = 0; k < cols; k++) {
      p.put(`v${k}`, x + gut + (k + 0.5) * cw, y + 4, 5.5);
    }
  }
  if (headH && s.picker) {
    p.put('ready', x + gut + sw + 5, y + 4, 5.5);
  }
  for (let r = 0; r < rows; r++) {
    const ry = y + headH + r * rh;
    p.lab(gut >= 30 ? `warp ${r}` : `w${r}`, [x, ry + rh / 2], 6);
    for (let k = 0; k < cols; k++) {
      rect(x + gut + k * cw + 0.5, ry + 1, cw - 1, rh - 2, soft);
    }
    p.gate([x + gut + sw + 5, ry + rh / 2], 3, { width: 1, color: line, alpha: r === 0 ? 1 : 0.6 });
    stub(x + gut + sw, ry + rh / 2, x + gut + sw + 2, ry + rh / 2);
    poly([x - 7, ry + rh / 2 - 3, x - 1, ry + rh / 2, x - 7, ry + rh / 2 + 3], r === 0 ? solid : soft); // the pointer
  }
}

/** The round robin that picks the warp to issue: every ready line runs into its multiplexer. */
function drawPicker(p: Pen, s: Sched): void {
  const { x, y, w, h } = p.a,
    { rows, gut, headH, sw, rh } = s;
  const mw = 22,
    mx = x + w * 0.78,
    mh = Math.min(h * 0.85, rows * rh + 8),
    my = y + headH + (rows * rh - mh) / 2,
    xm = x + gut + sw + 14;
  p.kit.mux(
    mx,
    my,
    mw,
    mh,
    Array.from({ length: rows }, () => ''),
  );
  for (let r = 0; r < rows; r++) {
    const ry = y + headH + r * rh + rh / 2,
      iy = my + mh * ((r + 0.5) / rows);
    p.wire(x + gut + sw + 7, ry, xm, ry, xm, iy, mx - 7, iy);
  }
  p.put('rr', mx + mw * 0.5, my + mh / 2, 7);
  if (x + w - (mx + mw + 7) >= 30) {
    p.put('issue', mx + mw + 7 + (x + w - (mx + mw + 7)) / 2, my + mh / 2, 6);
  }
}

/** The scoreboard (a bit per register and warp: pending writes) and the round robin that picks the warp to issue. */
export function drawSched(p: Pen): void {
  const s = schedGeom(p);
  drawScoreboard(p, s);
  if (s.picker) {
    drawPicker(p, s);
  }
}

/** A warp's card and its number. */
interface Card {
  r: Rect;
  k: number;
}

/** A wide card: its name and state chip, then the program counter's digits, the 16-bit mask and the stack slots, each beside its label. */
function drawWideCard(p: Pen, { r, k }: Card): void {
  const { rect, solid, soft } = p.kit;
  const pad = 4,
    ix = r.x + pad,
    iw = r.w - 2 * pad;
  const top = r.y + 5,
    pitch = Math.min(28, (r.h - 22 - 9) / 3),
    lx = ix + 26,
    lw = iw - 26;
  p.lab(`warp ${k}`, [ix, top + 4], 7);
  rect(r.x + r.w - pad - 32, top, 32, 9, solid);
  p.put('ready', r.x + r.w - pad - 16, top + 4.5, 6);
  const y1 = top + 14,
    y2 = y1 + pitch,
    y3 = y2 + pitch;
  p.lab('pc', [ix, y1 + 6], 6.5);
  pcDigits(p.g, p.kit, { x: lx, y: y1, w: lw, h: 12 });
  p.lab('mask', [ix, y2 + 4], 6.5);
  for (let j = 0; j < 16; j++) {
    rect(lx + (j * lw) / 16, y2, lw / 16 - 1, 8, j < 12 ? solid : soft);
  }
  p.lab('stack', [ix, y3 + 5], 6.5);
  const sl = lw / 8;
  for (let j = 0; j < 8; j++) {
    if (j < 2) {
      rect(lx + j * sl, y3, sl - 3, 10, solid);
    }
    p.outline({ x: lx + j * sl, y: y3, w: sl - 3, h: 10 });
  }
}

/** A narrow card: its name, then the program counter, the mask and the stack each under its label. */
function drawNarrowCard(p: Pen, { r, k }: Card): void {
  const { rect, solid, soft } = p.kit;
  const ix = r.x + 4,
    iw = r.w - 8;
  const pitch = (r.h - 20 - 8) / 3,
    cx = r.x + r.w / 2;
  p.put(`warp ${k}`, cx, r.y + 7, 6.5);
  const y1 = r.y + 14,
    y2 = y1 + pitch,
    y3 = y2 + pitch;
  p.put('pc', cx, y1 + 3, 5.5);
  rect(ix, y1 + 7, iw, 6, solid);
  p.put('mask', cx, y2 + 3, 5.5);
  for (let j = 0; j < 8; j++) {
    rect(ix + (j * iw) / 8, y2 + 7, iw / 8 - 1, 6, j < 6 ? solid : soft);
  }
  p.put('stack', cx, y3 + 3, 5.5);
  for (let j = 0; j < 4; j++) {
    const sx = ix + (j * iw) / 4;
    if (j < 2) {
      rect(sx, y3 + 7, iw / 4 - 2, 8, solid);
    }
    p.outline({ x: sx, y: y3 + 7, w: iw / 4 - 2, h: 8 });
  }
}

/** A small card: bars for the program counter, the mask and the stack, named when there is room. */
function drawSmallCard(p: Pen, r: Rect): void {
  const { rect, solid, soft } = p.kit;
  const px = r.x + 3,
    pw = r.w - 6,
    rh = Math.max(2, (r.h - 8) / 6);
  rect(px, r.y + 3, pw * 0.7, rh, solid);
  if (r.h >= 34 && pw >= 70) {
    p.put('pc', px + pw * 0.85, r.y + 3 + rh / 2, Math.min(7, rh));
    p.put('mask', px + pw * 0.5, r.y + 5 + rh * 1.5, Math.min(7, rh));
    p.put('stack', px + pw * 0.5, r.y + 7 + rh * 3, Math.min(7, rh));
  }
  for (let j = 0; j < 8; j++) {
    rect(px + (j * pw) / 8, r.y + 5 + rh, Math.max(1, pw / 8 - 1), rh, j < 6 ? solid : soft);
  }
  for (let j = 0; j < 3; j++) {
    rect(px, r.y + 7 + rh * (2 + j) + j, pw * (0.9 - 0.2 * j), rh, soft);
  }
}

/** One card per warp: its state, program counter, active mask and divergence stack. */
export function drawWarps(p: Pen): void {
  for (const [k, r] of p.cells.entries()) {
    p.kit.rect(r.x, r.y, r.w, r.h, p.kit.soft);
    if (r.w >= 150 && r.h >= 62) {
      drawWideCard(p, { r, k });
    } else if (r.h >= 56 && r.w >= 36) {
      drawNarrowCard(p, { r, k });
    } else {
      drawSmallCard(p, r);
    }
  }
}
