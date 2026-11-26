import type { Rect } from '../../../cpu/render/core/cpuplan';
import type { Pen } from './types';

// The memory path of an SM: the coalescer, the bank arbiter and the SRAM banks.

/** The coalescer's layout: eight lane requests merging onto four line buffers, and a footer for the line counter when the block is tall. */
interface Coalescer {
  n: number;
  outs: number;
  foot: number;
  po: number;
  busX: number;
}

/** The lane requests, each through an address shifter (`>>`), merging pair by pair onto the line buffers. */
function drawLaneRequests(p: Pen, c: Coalescer): void {
  const { x, y, w } = p.a,
    { rect, stub, soft, solid } = p.kit,
    { n, foot, po } = c;
  const pl = (p.a.h - foot) / n,
    rq = Math.min(10, pl - 2);
  const sx = x + 26,
    sw = 18,
    mx = x + w * 0.46,
    bx = x + w * 0.6;
  for (let k = 0; k < n; k++) {
    const ly = y + (k + 0.5) * pl,
      oy = y + (Math.floor(k / 2) + 0.5) * po;
    rect(x, ly - rq / 2, 16, rq, k % 2 ? soft : solid);
    if (pl >= 11) {
      p.put(`l${k}`, x + 8, ly, 5.5);
    }
    stub(x + 16, ly, sx, ly);
    rect(sx, ly - rq / 2, sw, rq, soft);
    if (pl >= 11) {
      p.put('>>', sx + sw / 2, ly, 6);
    }
    p.wire(sx + sw, ly, mx, ly, mx + 8, oy, bx, oy);
  }
}

/** The four-word line buffers, out on one bus to the arbiter. */
function drawLineBuffers(p: Pen, c: Coalescer): void {
  const { x, y, w } = p.a,
    { rect, stub, soft, solid } = p.kit,
    { outs, po, busX } = c;
  const mx = x + w * 0.46,
    bx = x + w * 0.6,
    bw = x + w - 14 - bx,
    bh = Math.min(28, po * 0.62),
    cw = (bw - 2) / 4;
  for (let k = 0; k < outs; k++) {
    const oy = y + (k + 0.5) * po;
    p.dot(mx + 8, oy);
    rect(bx, oy - bh / 2, bw, bh, soft);
    p.outline({ x: bx, y: oy - bh / 2, w: bw, h: bh });
    for (let j = 0; j < 4; j++) {
      rect(bx + 1 + j * cw + 1, oy - bh / 2 + 2, cw - 2, bh - 4, j < 2 || k % 2 ? solid : soft);
    }
    if (bh >= 14) {
      p.put(`line ${k}`, bx + bw / 2, oy - bh / 2 - 4, 5.5);
    }
    stub(bx + bw, oy, busX, oy);
  }
  stub(busX, y + 0.5 * po, busX, y + (outs - 0.5) * po);
}

/** The counter of distinct lines the access touched: one cycle of the memory path per line. */
function drawLineCounter(p: Pen, c: Coalescer): void {
  const { x, y, w, h } = p.a,
    { rect, stub, soft, solid } = p.kit,
    { outs, foot, po, busX } = c;
  const fy = y + h - foot + 8,
    cwid = Math.min(18, (w - 60) / 4);
  p.lab('lines', [x, fy + 5], 6);
  for (let k = 0; k < 4; k++) {
    rect(x + 34 + k * (cwid + 3), fy, cwid, 10, k < 2 ? solid : soft);
  }
  stub(x + 34 + 4 * (cwid + 3) - 3, fy + 5, busX, fy + 5);
  p.dot(busX, fy + 5);
  stub(busX, y + (outs - 0.5) * po, busX, fy + 5);
}

/**
 * Every lane's address is shifted down to the number of the line it falls in; lanes of one line merge onto that line's buffer (here two lanes to a line, eight
 * lanes to four lines, the way a unit-stride load lands), and the lines go out on one bus to the bank arbiter.
 */
export function drawCoalescer(p: Pen): void {
  const { x, w, h } = p.a,
    foot = h >= 150 ? 30 : 0,
    outs = 4;
  const c: Coalescer = { n: 8, outs, foot, po: (h - foot) / outs, busX: x + w - 6 };
  drawLaneRequests(p, c);
  drawLineBuffers(p, c);
  if (foot) {
    drawLineCounter(p, c);
  }
}

/** On the two-SM card each bank's request queue is one row (the live layer fills it, a slot per access). */
function drawQueueRows(p: Pen): void {
  const { line } = p.kit;
  for (const [k, r] of p.cells.entries()) {
    p.lab(`b${k}`, [r.x + 3, r.y + 7], 6);
    const len = r.w - 4,
      seg = len / 8;
    for (let j = 0; j < 8; j++) {
      p.g
        .rect(r.x + 2 + j * seg + 1, r.y + 1 + Math.min(10, r.h * 0.3), seg - 2, r.h - 2 - Math.min(10, r.h * 0.3))
        .stroke({ width: 0.8, color: line, alpha: 0.55 });
    }
  }
}

/** The arbiter's layout: the request column, the region the bank queues share, and a footer for the comparator when the block is tall. */
interface Arbiter {
  nb: number;
  n: number;
  foot: number;
  region: number;
  busX: number;
}

/** The lanes' requests come in on a column of request cells and merge onto a bus. */
function drawRequests(p: Pen, s: Arbiter): void {
  const { x, y } = p.a,
    { rect, stub, soft, solid } = p.kit,
    { n, region, busX } = s;
  const rq = Math.min(14, region / n - 3);
  for (let k = 0; k < n; k++) {
    const ry = y + 4 + ((k + 0.5) * region) / n;
    rect(x + 2, ry - rq / 2, 10, rq, k % 3 === 0 ? solid : soft);
    stub(x + 12, ry, busX, ry);
    if (rq >= 8) {
      p.put(`${k}`, x + 7, ry, 5);
    }
  }
  stub(busX, y + 4 + (0.5 * region) / n, busX, y + 4 + ((n - 0.5) * region) / n);
}

/** A queue per bank, the requests at the bank they address; a picker takes the oldest of each queue. */
function drawBankQueues(p: Pen, s: Arbiter): void {
  const { x, y, w } = p.a,
    { rect, stub, soft, solid, line } = p.kit,
    { nb, region, busX } = s;
  const few = nb <= 2,
    pitch = Math.min(few ? 120 : 56, region / nb),
    sh = Math.min(few ? 34 : 14, pitch - 14),
    qx = x + 30,
    sw = Math.max(5, (w * 0.5 - 30) / 4);
  for (let k = 0; k < nb; k++) {
    const ry = y + 4 + k * pitch + pitch / 2 + (region - nb * pitch) / 2;
    p.lab(`b${k}`, [qx, ry - sh / 2 - 5], 6);
    stub(busX, ry, qx, ry);
    p.dot(busX, ry);
    for (let j = 0; j < 4; j++) {
      rect(qx + j * (sw + 1), ry - sh / 2, sw, sh, j === 0 ? solid : soft);
      if (sh >= 18 && sw >= 14) {
        p.put(`l${j}`, qx + j * (sw + 1) + sw / 2, ry - 4, 5.5);
        rect(qx + j * (sw + 1) + 2, ry + sh / 2 - 8, (sw - 4) * (1 - j * 0.22), 3, line);
      }
    }
    if (sh >= 18) {
      p.lab('oldest', [qx, ry + sh / 2 + 7], 5.5);
    }
    const px = qx + 4 * (sw + 1) + 7;
    stub(qx + 4 * (sw + 1), ry, px - 5, ry);
    p.gate([px, ry], 5, { width: 1.2, color: line });
    stub(px + 5, ry, x + w, ry);
  }
}

/** The comparator that spots two lanes on one bank and raises `serialise`. */
function drawConflict(p: Pen, s: Arbiter): void {
  const { x, y, w } = p.a,
    { rect, stub, soft, line } = p.kit,
    { n, foot, region, busX } = s;
  const cy = y + 4 + region + foot / 2 - 4,
    cx = x + w * 0.4;
  stub(busX, y + 4 + ((n - 0.5) * region) / n, busX, cy);
  stub(busX, cy, cx - 8, cy);
  p.dot(busX, cy);
  p.gate([cx, cy], 8, { width: 1.3, color: line });
  p.put('=?', cx, cy, 7);
  stub(cx + 8, cy, x + w * 0.58, cy);
  rect(x + w * 0.58, cy - 6, x + w - (x + w * 0.58), 12, soft);
  p.put('serialise', x + w * 0.58 + (x + w - (x + w * 0.58)) / 2, cy, 6);
}

/** The bank arbiter: the lanes' requests merge onto a bus and queue at the bank they address; a picker takes the oldest of each queue and a comparator spots two lanes on one bank. */
export function drawArbiter(p: Pen): void {
  const { b } = p;
  if (b.grid) {
    drawQueueRows(p);
    return;
  }
  const { x, h } = p.a,
    foot = h > 130 ? 44 : 0;
  const s: Arbiter = {
    nb: Math.max(1, Number(/^(?<n>\d+)/u.exec(b.sub ?? '')?.groups?.['n'] ?? 1)),
    n: 8,
    foot,
    region: h - foot - 4,
    busX: x + 20,
  };
  drawRequests(p, s);
  drawBankQueues(p, s);
  if (foot) {
    drawConflict(p, s);
  }
}

/** A tall array: the row decoder down its left side raises one word line, the others run across to the right; and the bit lines down the columns, where the sense amplifiers read them. */
function drawTallArray(p: Pen, r: Rect, body: { by: number; bh: number }): void {
  const { rect, stub, solid, line } = p.kit,
    { by, bh } = body,
    n = Math.max(1, Math.floor(bh / 6));
  const dec = r.h >= 90 && r.w >= 60 ? 10 : 0;
  if (dec) {
    rect(r.x + 1.5, by + 1, dec - 2, bh - 2, solid);
    p.outline({ x: r.x + 1.5, y: by + 1, w: dec - 2, h: bh - 2 });
    p.put('dec', r.x + 1.5 + (dec - 2) / 2, by + 8, 5);
  }
  for (let j = 1; j < n; j++) {
    stub(r.x + 1.5 + dec, by + (j * bh) / n, r.x + r.w - 1.5, by + (j * bh) / n);
  }
  const bl = Math.max(2, Math.floor((r.w - dec) / 14));
  if (bh > 40) {
    for (let j = 1; j < bl; j++) {
      const bx = r.x + 1.5 + dec + (j * (r.w - 3 - dec)) / bl;
      p.g.moveTo(bx, by + 2).lineTo(bx, by + bh - 2);
    }
  }
  p.g.stroke({ width: 0.8, color: line, alpha: 0.28 });
}

/** One bank: a row decoder on top, rows of words, the sense amplifiers underneath. */
function drawBank(p: Pen, r: Rect, k: number): void {
  const { rect, stub, soft, solid } = p.kit;
  rect(r.x, r.y, r.w, r.h, soft);
  const horizontal = r.w >= r.h,
    head = horizontal ? 0 : Math.min(9, r.h * 0.08),
    foot = horizontal ? 0 : Math.min(8, r.h * 0.07);
  if (head >= 5) {
    rect(r.x + 1.5, r.y + 1.5, r.w - 3, head - 2, solid);
    p.put(`b${k}`, r.x + r.w / 2, r.y + head / 2 + 0.5, Math.min(6, head - 1.5));
  }
  if (foot >= 4) {
    for (let j = 0; j < 4; j++) {
      rect(r.x + 1.5 + (j * (r.w - 3)) / 4, r.y + r.h - foot - 0.5, (r.w - 3) / 4 - 1, foot - 1, solid);
    }
  }
  if (foot >= 6 && r.w >= 70) {
    p.put('sense amps', r.x + r.w / 2, r.y + r.h - foot / 2 - 1, 5.5);
  }
  if (!horizontal) {
    drawTallArray(p, r, { by: r.y + head, bh: r.h - head - foot });
    return;
  }
  const m = Math.max(1, Math.floor(r.w / 6));
  for (let j = 1; j < m; j++) {
    stub(r.x + (j * r.w) / m, r.y + 1.5, r.x + (j * r.w) / m, r.y + r.h - 1.5);
  }
}

/** An SRAM array per bank: a row decoder on top, rows of words, the sense amplifiers underneath. */
export function drawBanks(p: Pen): void {
  for (const [k, r] of p.cells.entries()) {
    drawBank(p, r, k);
  }
}
