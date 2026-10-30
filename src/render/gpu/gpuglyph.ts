import type { Graphics } from 'pixi.js';
import type { Rect } from '../die/cpuplan';
import { WORD_FIELDS, CONTROL_LINES, type Put } from '../die/blockart';
import { mix } from '../ink';
import { GPU_FRAME } from '../../sim/isa/memmap';
import { KERNEL_LAYOUT } from '../../sim/gen/gpukernels';
import type { Theme } from '../theme';
import type { GpuBlock, GpuBlockKind } from './gpuplan';
import { gpuCells, maskParts } from './gpuplans';

// What is inside a block of a GPU card (docs/DIE.md "Inside the blocks", docs/GPU.md section 7): the symbol an engineer would draw, drawn like
// the CPU die's (die/blockart.ts) so the two read as one family. The lane ALUs are the notched trapezoid, a warp is a card with its program
// counter, mask and stack, the scheduler a scoreboard with a pointer, the coalescer lanes funnelling into lines, the arbiter a multiplexer in
// front of the banks, a cache line a tag beside its data. Pure drawing into a Graphics (and a callback for the few labels).

/** The block kinds with a symbol: every kind of a plan but the SM frame, which is only a frame. */
export const GPU_GLYPH_KINDS: Record<GpuBlockKind, boolean> = {
  pcie: true, launch: true, pc: true, fetch: true, decode: true, sched: true, warps: true, regfile: true, lanes: true, mask: true,
  coalescer: true, arbiter: true, banks: true, l1: true, l2: true, dram: true, sm: false,
};

export const hasGpuSymbol = (b: GpuBlock): boolean => GPU_GLYPH_KINDS[b.kind];

/** The area a symbol may use: the block under its name (the area the cell grids fill), or null when the block is too small. */
export function gpuGlyphArea(b: Pick<GpuBlock, 'kind' | 'rect'>): Rect | null {
  if (!GPU_GLYPH_KINDS[b.kind]) return null;
  const r = b.rect, head = r.h >= 70 ? 44 : r.h * 0.55;
  const a = { x: r.x + 8, y: r.y + head, w: r.w - 16, h: r.y + r.h - 6 - (r.y + head) };
  return a.w > 8 && a.h > 6 ? a : null;
}

/** The control lines a decoder block raises: name and the line's end points (block coordinates), the ones the live layer lights for the instruction on show. */
export function gpuDecodeLines(b: Pick<GpuBlock, 'kind' | 'rect'>): { name: string; x0: number; x1: number; y: number }[] {
  const a = gpuGlyphArea(b);
  if (!a) return [];
  const wh = Math.min(18, a.h * 0.3), n = CONTROL_LINES.length, step = Math.min(14, (a.h - wh - 6) / n);
  return CONTROL_LINES.map((name, k) => ({ name, x0: a.x, x1: a.x + a.w * 0.35, y: a.y + wh + 8 + k * step + step / 2 }));
}

/** Which control lines an instruction raises: the ALU or memory unit it goes to, a register write, a branch or mask change, an immediate, a system operation. */
export function gpuControlLines(s: { name: string; kind: string; dest: number | null }): Set<string> {
  const out = new Set<string>();
  if (s.kind === 'alu') out.add('alu');
  if (s.kind === 'ld' || s.kind === 'st') out.add('mem');
  if (s.dest !== null) out.add('wr');
  if (s.kind === 'br' || s.kind === 'mask') out.add('br');
  if (/i$/.test(s.name) || s.name === 'vli' || s.kind === 'ld' || s.kind === 'st') out.add('imm');
  if (s.kind === 'sys') out.add('sys');
  return out;
}

/** Draw the symbol of block `b` into `g`; `put` adds a label. */
export function gpuGlyph(g: Graphics, T: Theme, b: GpuBlock, c: string, put: Put): void {
  const a = gpuGlyphArea(b);
  if (!a) return;
  const solid = mix(T.die, c, 0.42), soft = mix(T.die, c, 0.2), line = mix(T.die, c, 0.85);
  const { x, y, w, h } = a;
  const rect = (rx: number, ry: number, rw: number, rh: number, f = solid) => { g.roundRect(rx, ry, rw, rh, 1.5).fill({ color: f }); };
  const stub = (x0: number, y0: number, x1: number, y1: number) => { g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1.2, color: line }); };
  const poly = (pts: number[], f = soft) => { g.poly(pts).fill({ color: f }).stroke({ width: 1.3, color: line }); };
  const word = (wx: number, wy: number, ww: number, wh: number) => {
    const total = WORD_FIELDS.reduce((s, f) => s + f.bits, 0);
    let fx = wx;
    WORD_FIELDS.forEach((f, k) => {
      const fw = (ww * f.bits) / total;
      rect(fx + 0.6, wy, fw - 1.2, wh, k % 2 ? solid : soft);
      if (wh >= 8 && fw > 12) put(f.name, fx + fw / 2, wy + wh / 2, Math.min(7, wh * 0.7));
      fx += fw;
    });
  };
  const cells = gpuCells(b);

  switch (b.kind) {
    case 'pcie': {
      // differential pairs running into the die, a chevron on each saying which way it carries
      const n = Math.max(2, Math.min(16, Math.floor(h / 7)));
      for (let k = 0; k < n; k++) {
        const ly = y + ((k + 0.5) * h) / n;
        stub(x, ly, x + w, ly);
        const cx = x + w * 0.55;
        g.moveTo(cx - 3, ly - 2.5).lineTo(cx, ly).lineTo(cx - 3, ly + 2.5).stroke({ width: 1.1, color: line });
      }
      break;
    }
    case 'launch': {
      // the argument registers, and the go flag
      const rows = 4, rh = Math.min(14, h / rows);
      for (let k = 0; k < rows; k++) rect(x, y + k * (rh + 3), w * 0.68, rh, k % 2 ? solid : soft);
      rect(x + w * 0.76, y, w * 0.24, rh * 2 + 3, solid);
      if (rh >= 8 && w > 60) put('go', x + w * 0.88, y + rh + 1.5, Math.min(8, rh));
      break;
    }
    case 'pc': {
      const gap = 3, dw = (w - 7 * gap) / 8, dh = Math.min(h, 22);
      for (let k = 0; k < 8; k++) {
        const dx = x + k * (dw + gap);
        rect(dx, y + (h - dh) / 2, dw, dh);
        for (let j = 0; j < 4; j++) g.rect(dx + 1.5 + j * ((dw - 3) / 4), y + (h - dh) / 2 + dh - 3.5, Math.max(1, (dw - 3) / 4 - 1), 2).fill({ color: line });
      }
      break;
    }
    case 'fetch': {
      // the word read from the program, on its way to the decoder
      const wh = Math.min(18, h * 0.4);
      word(x, y + h * 0.15, w, wh);
      stub(x + w / 2, y + h * 0.15 + wh, x + w / 2, y + h * 0.15 + wh + 14);
      poly([x + w / 2 - 4, y + h * 0.15 + wh + 10, x + w / 2 + 4, y + h * 0.15 + wh + 10, x + w / 2, y + h * 0.15 + wh + 17], solid);
      break;
    }
    case 'decode': {
      // the fields of the word and the control lines it raises
      const wh = Math.min(18, h * 0.3);
      word(x, y, w, wh);
      const step = Math.min(14, (h - wh - 6) / CONTROL_LINES.length);
      for (const l of gpuDecodeLines(b)) {
        stub(l.x0, l.y, l.x1, l.y);
        if (step >= 7) put(l.name, l.x1 + 8 + l.name.length * 2, l.y, Math.min(7, step * 0.8));
      }
      break;
    }
    case 'sched': {
      // the scoreboard (a bit per register and warp) and the pointer that picks the next warp
      cells.forEach((r, k) => rect(r.x, r.y, r.w, r.h, k % 8 === 0 ? solid : soft));
      const rows = b.grid?.rows ?? 1, rh = h / rows;
      for (let k = 0; k < rows && rh >= 9; k++) put(`warp ${k}`, x + 20, y + k * rh + rh / 2, Math.min(7, rh * 0.5));
      for (let k = 0; k < rows; k++) poly([x - 7, y + k * rh + rh / 2 - 3, x - 1, y + k * rh + rh / 2, x - 7, y + k * rh + rh / 2 + 3], k === 0 ? solid : soft);
      break;
    }
    case 'warps': {
      // one card per warp: its program counter, its mask, its stack
      cells.forEach((r) => {
        rect(r.x, r.y, r.w, r.h, soft);
        const px = r.x + 3, pw = r.w - 6, rh = Math.max(2, (r.h - 8) / 6);
        rect(px, r.y + 3, pw * 0.7, rh, solid);
        if (r.h >= 34 && pw >= 70) { put('pc', px + pw * 0.85, r.y + 3 + rh / 2, Math.min(7, rh)); put('mask', px + pw * 0.5, r.y + 5 + rh * 1.5, Math.min(7, rh)); put('stack', px + pw * 0.5, r.y + 7 + rh * 3, Math.min(7, rh)); }
        for (let k = 0; k < 8; k++) rect(px + (k * pw) / 8, r.y + 5 + rh, Math.max(1, pw / 8 - 1), rh, k < 6 ? solid : soft);
        for (let k = 0; k < 3; k++) rect(px, r.y + 7 + rh * (2 + k) + k, pw * (0.9 - 0.2 * k), rh, soft);
      });
      break;
    }
    case 'regfile': {
      // the register array, each row a register, with its read and write ports
      cells.forEach((r, k) => rect(r.x, r.y, r.w, r.h, Math.floor(k / (b.grid?.cols ?? 1)) % 2 ? soft : solid));
      // a register's name on its row (v0..v7)
      for (let k = 0; k < (b.grid?.rows ?? 0); k++) { const c0 = cells[k * (b.grid?.cols ?? 1)]; if (c0 && c0.h >= 7) put(`v${k}`, c0.x + 9, c0.y + c0.h / 2, Math.min(7, c0.h * 0.8)); }
      stub(x - 6, y + h * 0.3, x, y + h * 0.3);
      stub(x - 6, y + h * 0.7, x, y + h * 0.7);
      stub(x + w, y + h / 2, x + w + 6, y + h / 2);
      break;
    }
    case 'lanes': {
      // an ALU in every lane: the notched trapezoid
      for (const r of cells) {
        const { x: lx, y: ly, w: lw, h: lh } = r;
        poly([lx + 1.5, ly + 1.5, lx + lw * 0.42, ly + 1.5, lx + lw * 0.5, ly + lh * 0.3, lx + lw * 0.58, ly + 1.5, lx + lw - 1.5, ly + 1.5, lx + lw * 0.82, ly + lh - 1.5, lx + lw * 0.18, ly + lh - 1.5]);
      }
      break;
    }
    case 'mask': {
      // a bit per lane, and the stack of masks a divergent branch pushes
      const m = maskParts(b.rect, b.grid?.cols ?? 8);
      m.bits.forEach((r, k) => rect(r.x, r.y, r.w, r.h, k % 2 ? soft : solid));
      m.slots.forEach((r) => { g.rect(r.x, r.y, r.w, r.h).stroke({ width: 1.2, color: line }); });
      break;
    }
    case 'coalescer': {
      // the lanes' addresses funnel into the few lines they touch
      const n = 8, outs = 3;
      for (let k = 0; k < n; k++) {
        const ly = y + ((k + 0.5) * h) / n, oy = y + ((Math.floor((k * outs) / n) + 0.5) * h) / outs;
        g.circle(x + 3, ly, 2).fill({ color: solid });
        g.moveTo(x + 3, ly).lineTo(x + w * 0.45, ly).lineTo(x + w * 0.6, oy).lineTo(x + w - 14, oy).stroke({ width: 1, color: line, alpha: 0.7 });
      }
      for (let k = 0; k < outs; k++) rect(x + w - 14, y + ((k + 0.5) * h) / outs - 5, 14, 10, solid);
      break;
    }
    case 'arbiter': {
      // requests in, a multiplexer, one access per bank out
      const ins = 4, outs = Math.max(1, b.grid?.count ?? 2), mw = Math.min(w * 0.4, 30), mx = x + w * 0.4, mh = Math.min(h, 60), my = y + (h - mh) / 2;
      poly([mx, my, mx + mw, my + mh * 0.22, mx + mw, my + mh * 0.78, mx, my + mh]);
      for (let k = 0; k < ins; k++) stub(x, my + mh * ((k + 0.5) / ins), mx, my + mh * ((k + 0.5) / ins));
      for (let k = 0; k < Math.min(outs, 6); k++) stub(mx + mw, my + mh * ((k + 0.5) / Math.min(outs, 6)), x + w, my + mh * ((k + 0.5) / Math.min(outs, 6)));
      break;
    }
    case 'banks': {
      // an SRAM array per bank: rows of words
      for (const r of cells) {
        rect(r.x, r.y, r.w, r.h, soft);
        const n = Math.max(1, Math.floor(r.h / 6)), horizontal = r.w >= r.h;
        for (let k = 1; k < (horizontal ? Math.max(1, Math.floor(r.w / 6)) : n); k++) {
          if (horizontal) stub(r.x + (k * r.w) / Math.floor(r.w / 6), r.y + 1.5, r.x + (k * r.w) / Math.floor(r.w / 6), r.y + r.h - 1.5);
          else stub(r.x + 1.5, r.y + (k * r.h) / n, r.x + r.w - 1.5, r.y + (k * r.h) / n);
        }
      }
      break;
    }
    case 'l1':
    case 'l2': {
      // a line is its tag beside its data
      for (const r of cells) { rect(r.x, r.y, r.w * 0.3, r.h, solid); rect(r.x + r.w * 0.3 + 1, r.y, r.w * 0.7 - 1, r.h, soft); }
      break;
    }
    case 'dram': {
      // the card's memory: rows of words
      const cw = 9, cols = Math.min(64, Math.floor(w / cw)), rows = Math.min(40, Math.floor(h / cw));
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) g.rect(x + k * cw + 1, y + r * cw + 1, cw - 2, cw - 2);
      g.fill({ color: soft });
      // the map of the memory: the kernel code, its two parameter words, the picture the card draws (docs/GPU.md section 2), as bands over the rows
      if (b.bytes && rows >= 4) {
        const total = cols * rows, cell = (a: number) => Math.min(total, Math.max(0, Math.round((a / b.bytes!) * total)));
        const bands: { from: number; to: number; name: string; fill: string }[] = [
          { from: 0, to: KERNEL_LAYOUT.param, name: 'code', fill: solid }, { from: KERNEL_LAYOUT.param, to: GPU_FRAME.at, name: 'args', fill: line }, { from: GPU_FRAME.at, to: GPU_FRAME.at + GPU_FRAME.words * 4, name: 'frame', fill: mix(T.die, T.st, 0.7) },
        ];
        for (const bd of bands) {
          const a = cell(bd.from), z = Math.max(a + 1, cell(bd.to));
          for (let k = a; k < Math.min(z, total); k++) g.rect(x + (k % cols) * cw + 1, y + Math.floor(k / cols) * cw + 1, cw - 2, cw - 2).fill({ color: bd.fill, alpha: 0.9 });
          const r0 = Math.floor(a / cols);
          if (cols * cw > 90 && r0 < rows - 1) put(bd.name, x + (a % cols) * cw + 18, y + r0 * cw + cw / 2 + 0.5, 7);
        }
      }
      break;
    }
    case 'sm':
      break;
  }
}
