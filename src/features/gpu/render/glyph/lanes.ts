import type { Rect } from '../../../cpu/render/core/cpuplan';
import { aluPoly } from '../../../cpu/render/die/blockart';
import { cellInset, maskParts } from '../plan/gpuplans';
import { ALU_UNITS, laneUnits } from './geom';
import type { Pen } from './pen';

// The data path of an SM: the register file, the lane ALUs and the execution mask.

/** The register file's cells as a grid, and the first and the last cell. */
interface Regs {
  cols: number;
  rows: number;
  top: number;
  bot: number;
}

/** The row decoder on the left: it raises the word line of the register the decoded word names. */
function drawRowDecoder(p: Pen, s: Regs, inset: number): void {
  const { x } = p.a,
    { rect, stub, soft } = p.kit,
    { cols, rows, top, bot } = s;
  const dw = inset - 5;
  rect(x, top, dw, bot - top, soft);
  p.outline({ x, y: top, w: dw, h: bot - top });
  for (let k = 0; k < rows; k++) {
    const rc = p.cells[k * cols];
    if (!rc) {
      continue;
    }
    const my = rc.y + rc.h / 2;
    stub(x + dw, my, rc.x, my);
    p.pip(x + dw - 3, my, 1.4);
  }
  stub(x - 7, (top + bot) / 2, x, (top + bot) / 2);
}

/** Under every lane's column, the two operand latches (A and B) that take what the read ports bring. */
function drawLatches(p: Pen, s: Regs): void {
  const { x } = p.a,
    { rect, stub, soft, solid } = p.kit;
  const ly = s.bot + 5;
  for (let k = 0; k < s.cols; k++) {
    const cc = p.cells[k];
    if (!cc) {
      continue;
    }
    stub(cc.x + cc.w / 2, s.bot, cc.x + cc.w / 2, ly);
    rect(cc.x + 1, ly, cc.w - 2, 7, solid);
    rect(cc.x + 1, ly + 10, cc.w - 2, 7, soft);
  }
  p.lab('A', [x + 3, ly + 3.5], 6);
  p.lab('B', [x + 3, ly + 13.5], 6);
}

/**
 * The register array, each row a register: a row decoder on the left raises the word line of the register the decoded word names, and under
 * every lane's column the two operand latches (A and B) take what the read ports bring; the results come back in on the write port.
 */
export function drawRegfile(p: Pen): void {
  const { x, y, w, h } = p.a,
    { rect, stub, soft, solid } = p.kit,
    { cells, b } = p;
  const cols = b.grid?.cols ?? 1,
    rows = b.grid?.rows ?? 0,
    ins = cellInset(b),
    c0 = cells.at(0),
    cz = cells.at(-1);
  for (const [k, r] of cells.entries()) {
    rect(r.x, r.y, r.w, r.h, Math.floor(k / cols) % 2 ? soft : solid);
  }
  for (let k = 0; k < rows; k++) {
    const rc = cells[k * cols];
    if (rc && rc.h >= 7) {
      p.put(`v${k}`, rc.x + 9, rc.y + rc.h / 2, Math.min(7, rc.h * 0.8));
    }
  }
  if (c0 && cz) {
    const s: Regs = { cols, rows, top: c0.y, bot: cz.y + cz.h };
    if (ins.l) {
      drawRowDecoder(p, s, ins.l);
    }
    if (ins.b) {
      drawLatches(p, s);
    }
  }
  if (!ins.l) {
    stub(x - 6, y + h * 0.3, x, y + h * 0.3);
    stub(x - 6, y + h * 0.7, x, y + h * 0.7);
  }
  stub(x + w, y + h / 2, x + w + 6, y + h / 2);
}

/** A lane's cell, its number, and the units of its ALU when the cell is roomy. */
interface Lane {
  r: Rect;
  k: number;
  u: NonNullable<ReturnType<typeof laneUnits>>;
}

/** A roomy lane: the operands run down a bus that taps every unit, the units' results meet in a mux the op field selects, and the latch holds the result. */
function drawAluUnits(p: Pen, { r, k, u }: Lane): void {
  const { rect, stub, soft, solid, mux } = p.kit;
  const top = u.units.at(0),
    bot = u.units.at(-1),
    mid = u.notch.y;
  if (!top || !bot) {
    return;
  }
  stub(u.notch.x, mid, u.busX, mid);
  if (r.h >= 60) {
    p.put('a b', u.notch.x + 9, mid - 6, 5.5);
  }
  stub(u.busX, top.y + top.h / 2, u.busX, bot.y + bot.h / 2);
  for (const [n, ur] of u.units.entries()) {
    const uy = ur.y + ur.h / 2;
    p.dot(u.busX, uy);
    stub(u.busX, uy, ur.x, uy);
    rect(ur.x, ur.y, ur.w, ur.h, n % 2 ? soft : solid);
    if (ur.h >= 6) {
      p.put(ALU_UNITS[n] ?? '', ur.x + ur.w / 2, uy, Math.min(6.5, ur.h * 0.7));
    }
  }
  mux(
    u.mux.x,
    u.mux.y,
    u.mux.w,
    u.mux.h,
    ALU_UNITS.map(() => ''),
  );
  const rx = u.mux.x + u.mux.w + 7,
    ry = u.res.y + u.res.h / 2;
  stub(rx, u.mux.y + u.mux.h / 2, u.res.x, u.mux.y + u.mux.h / 2);
  rect(u.res.x, u.res.y, u.res.w, u.res.h, solid);
  p.put('res', u.res.x + u.res.w / 2, ry, 6);
  p.put('op', u.mux.x + u.mux.w / 2, r.y + r.h * 0.09, 5.5);
  stub(u.mux.x + u.mux.w / 2, r.y + r.h * 0.125, u.mux.x + u.mux.w / 2, u.mux.y + u.mux.h * 0.11);
  p.put(r.h >= 70 ? `lane ${k}` : `l${k}`, r.x + (r.h >= 70 ? 22 : 12), r.y + r.h * 0.92, 5.5);
}

/**
 * An ALU in every lane: the notched trapezoid, its lane number and the operation it is given; a roomy cell opens up: the operands run down a bus that
 * taps every unit (add, logic, shift, compare, multiply, min/max), the units' results meet in a mux the op field selects, and the latch holds the result.
 */
export function drawLanes(p: Pen): void {
  for (const [k, r] of p.cells.entries()) {
    p.kit.poly(aluPoly(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3));
    const u = laneUnits(r);
    if (u) {
      drawAluUnits(p, { r, k, u });
    } else if (r.h >= 22 && r.w >= 34) {
      p.put('op', r.x + r.w * 0.55, r.y + r.h * 0.5, 6.5);
      p.put(`l${k}`, r.x + 12, r.y + r.h - 6, 5.5);
    }
  }
}

/**
 * Beside the stack: push/pop, which saves the mask on a divergent branch and takes it back (its wire runs up into the strip), and with more room the
 * compare of the `mset` ops, whose result becomes the new mask.
 */
function drawMaskUnits(p: Pen, m: ReturnType<typeof maskParts>): void {
  const { x, w } = p.a,
    { rect, stub, soft } = p.kit;
  const sEnd = m.stack.x + m.stack.w,
    room = x + w - sEnd - 16,
    sy = m.stack.y,
    sh = m.stack.h,
    up = (px: number) => {
      stub(px, sy - 1, px, m.strip.y + m.strip.h);
      p.dot(px, m.strip.y + m.strip.h);
    };
  if (room < 60 || sh < 8 || sy - (m.strip.y + m.strip.h) < 4) {
    return;
  }
  const uw = Math.min(64, room * (room >= 150 ? 0.4 : 0.8)),
    ux = sEnd + 14;
  stub(sEnd, sy + sh / 2, ux, sy + sh / 2);
  rect(ux, sy - 1, uw, sh + 2, soft);
  p.outline({ x: ux, y: sy - 1, w: uw, h: sh + 2 });
  p.put('push · pop', ux + uw / 2, sy + sh / 2, 6);
  up(ux + uw / 2);
  if (room >= 150) {
    const cx2 = ux + uw + 22,
      cw = Math.min(64, x + w - cx2 - 4);
    rect(cx2, sy - 1, cw, sh + 2, soft);
    p.outline({ x: cx2, y: sy - 1, w: cw, h: sh + 2 });
    p.put('mset cmp', cx2 + cw / 2, sy + sh / 2, 6);
    up(cx2 + cw / 2);
  }
}

/** A bit per lane, and the stack of masks a divergent branch pushes. */
export function drawMask(p: Pen): void {
  const { rect, soft, solid, line } = p.kit;
  const m = maskParts(p.b.rect, p.b.grid?.cols ?? 8);
  for (const [k, r] of m.bits.entries()) {
    rect(r.x, r.y, r.w, r.h, k % 2 ? soft : solid);
  }
  for (const r of m.slots) {
    p.g.rect(r.x, r.y, r.w, r.h).stroke({ width: 1.2, color: line });
  }
  drawMaskUnits(p, m);
}
