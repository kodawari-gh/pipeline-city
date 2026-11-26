import { mix } from '@/core/render/ink';
import { GPU_FRAME } from '@/core/sim/memmap';
import { KERNEL_LAYOUT } from '../../sim/kernels';
import { dramGeom } from '../gpumem';
import { cellInset } from '../plan/gpuplans';
import type { Pen } from './types';

// The memory of the card: the caches (L1, L2) and the card memory.

/** The lines of a cache: the valid bit and tag beside the data, the data split into its words along its longer side. */
function drawCacheLines(p: Pen): void {
  const { rect, stub, soft, solid } = p.kit;
  for (const r of p.cells) {
    rect(r.x, r.y, r.w * 0.3, r.h, solid);
    rect(r.x + r.w * 0.3 + 1, r.y, r.w * 0.7 - 1, r.h, soft);
    if (r.h >= 6 && r.w >= 12) {
      p.pip(r.x + 2.5, r.y + r.h / 2, 1);
    }
    const dx = r.x + r.w * 0.3 + 1,
      dw = r.w * 0.7 - 1;
    if (Math.max(dw, r.h) < 24) {
      continue;
    }
    for (let j = 1; j < 4; j++) {
      if (dw >= r.h) {
        stub(dx + (j * dw) / 4, r.y + 1, dx + (j * dw) / 4, r.y + r.h - 1);
      } else {
        stub(dx + 1, r.y + (j * r.h) / 4, dx + dw - 1, r.y + (j * r.h) / 4);
      }
    }
  }
}

/** The span of a cache's lines, top to bottom, and the room `cellInset` keeps beside and under them. */
interface CacheSpan {
  top: number;
  bot: number;
  ins: { l: number; b: number };
}

/** The index decoder on the left: the index part of the address picks the line. */
function drawIndexDecoder(p: Pen, s: CacheSpan): void {
  const { x } = p.a,
    { rect, stub, soft } = p.kit,
    { top, bot, ins } = s,
    cols = p.b.grid?.cols ?? 1;
  const dw = ins.l - 4;
  rect(x, top, dw, bot - top, soft);
  p.outline({ x, y: top, w: dw, h: bot - top });
  for (let k = 0; k * cols < p.cells.length; k++) {
    const rc = p.cells[k * cols];
    if (!rc) {
      continue;
    }
    const my = rc.y + rc.h / 2;
    stub(x + dw, my, rc.x, my);
  }
  stub(x - 6, (top + bot) / 2, x, (top + bot) / 2);
}

/** The tag compare under the lines: the tag part of the address against the line's tag, a match (a hit) lets the line's data through the mux. */
function drawTagCompare(p: Pen, s: CacheSpan): void {
  const { x, w } = p.a,
    { rect, stub, soft, line, mux } = p.kit,
    { bot, ins } = s;
  const fy = bot + 5,
    fh = ins.b - 8,
    cy = fy + fh / 2,
    wide = w >= 200,
    cx = x + ins.l + (wide ? 70 : 38),
    r = 7;
  p.lab('tag', [x + ins.l, cy], 6);
  stub(x + ins.l + 15, cy, cx - r, cy);
  p.gate([cx, cy], r, { width: 1.3, color: line });
  p.put('=?', cx, cy, 6);
  stub(cx + r, cy, cx + r + 8, cy);
  rect(cx + r + 8, cy - 6, 26, 12, soft);
  p.outline({ x: cx + r + 8, y: cy - 6, w: 26, h: 12 });
  p.put('hit', cx + r + 21, cy, 6);
  if (wide) {
    const mx = x + w * 0.66,
      mw = 16;
    stub(cx + r + 34, cy, mx - 7, cy);
    mux(mx, cy - fh / 2, mw, fh, ['']);
    p.lab('data', [mx + mw + 10, cy], 6);
  }
}

/**
 * A line is its valid bit and tag beside its data; the index part of the address runs into a decoder that picks the line, the tag part is compared with the line's tag,
 * and a match (a hit) lets the line's data through.
 */
export function drawCache(p: Pen): void {
  const ins = cellInset(p.b),
    c0 = p.cells.at(0),
    cz = p.cells.at(-1);
  drawCacheLines(p);
  if (!c0 || !cz) {
    return;
  }
  const s: CacheSpan = { top: c0.y, bot: cz.y + cz.h, ins };
  if (ins.l) {
    drawIndexDecoder(p, s);
  }
  if (ins.b) {
    drawTagCompare(p, s);
  }
}

/** The card memory's layout (`dramGeom`). */
type Dram = ReturnType<typeof dramGeom>;

/** The map of the memory: the kernel code, its two parameter words, the picture the card draws (docs/GPU.md section 2), as bands over the rows. */
function drawMemoryMap(p: Pen, d: Dram, bytes: number): void {
  const { x, y } = p.a,
    { solid, line } = p.kit,
    { cw, cols, rows } = d;
  const total = cols * rows,
    cell = (a0: number) => Math.min(total, Math.max(0, Math.round((a0 / bytes) * total)));
  const bands: { from: number; to: number; name: string; fill: string }[] = [
    { from: 0, to: KERNEL_LAYOUT.param, name: 'code', fill: solid },
    { from: KERNEL_LAYOUT.param, to: GPU_FRAME.at, name: 'args', fill: line },
    { from: GPU_FRAME.at, to: GPU_FRAME.at + GPU_FRAME.words * 4, name: 'frame', fill: mix(p.T.die, p.T.st, 0.7) },
  ];
  for (const bd of bands) {
    const a0 = cell(bd.from),
      z = Math.max(a0 + 1, cell(bd.to));
    for (let k = a0; k < Math.min(z, total); k++) {
      p.g
        .rect(x + (k % cols) * cw + 1, y + Math.floor(k / cols) * cw + 1, cw - 2, cw - 2)
        .setFillStyle({ color: bd.fill, alpha: 0.3 })
        .fill();
    }
    const r0 = Math.floor(a0 / cols);
    if (cols * cw > 90 && r0 < rows - 1) {
      p.put(bd.name, x + (a0 % cols) * cw + 18, y + r0 * cw + cw / 2 + 0.5, 7);
    }
  }
}

/** The row buffer: the words of the row the last access opened, in slots the live layer fills, and the controller. */
function drawRowBuffer(p: Pen, d: Dram): void {
  const { x } = p.a,
    { rect, stub, soft, solid } = p.kit,
    { cw, cols, by, slots } = d;
  const mx = x + (cols * cw) / 2,
    bw = cols * cw * 0.4,
    cy = by + 22 + 12;
  for (const r of slots) {
    rect(r.x, r.y, r.w, r.h, solid);
    p.outline(r);
  }
  p.lab('row buffer', [x + 2, by + 22 + 12], 6);
  stub(mx, by + 22, mx, cy - 6);
  rect(mx - bw / 2, cy - 6, bw, 12, soft);
  p.outline({ x: mx - bw / 2, y: cy - 6, w: bw, h: 12 });
  p.put('ctrl', mx, cy, 6.5);
  stub(x, cy, mx - bw / 2, cy);
  stub(mx + bw / 2, cy, x + cols * cw, cy);
}

/** The card's memory: rows of words (with the map of what lives where), the row buffer under them and the controller. */
export function drawDram(p: Pen): void {
  const { x, y } = p.a,
    d = dramGeom(p.a),
    { bytes } = p.b;
  for (let r = 0; r < d.rows; r++) {
    for (let k = 0; k < d.cols; k++) {
      p.g.rect(x + k * d.cw + 1, y + r * d.cw + 1, d.cw - 2, d.cw - 2);
    }
  }
  p.g.setFillStyle({ color: p.kit.soft }).fill();
  if (bytes !== undefined && bytes !== 0 && !Number.isNaN(bytes) && d.rows >= 4) {
    drawMemoryMap(p, d, bytes);
  }
  if (d.foot) {
    drawRowBuffer(p, d);
  }
}
