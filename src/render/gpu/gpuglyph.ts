import type { Graphics } from 'pixi.js';
import type { Block, Rect } from '../die/cpuplan';
import { aluPoly, CONTROL_LINES, glyphKit, pcDigits, slotsOf, WORD_FIELDS, type LiveGlyph, type Put } from '../die/blockart';
import { mix } from '../ink';
import { GPU_FRAME } from '../../sim/isa/memmap';
import { KERNEL_LAYOUT } from '../../sim/gen/gpukernels';
import { gpuDecode, gpuDisassemble, GPU_SPEC_BY_NAME } from '../../sim/isa/gpu';
import type { GpuStep } from '../../sim/ref/gpuref';
import type { Theme } from '../theme';
import type { GpuBlock, GpuBlockKind } from './gpuplan';
import { gpuCells, maskParts } from './gpuplans';

// What is inside a block of a GPU card (docs/DIE.md "Inside the blocks", docs/GPU.md section 7): the schematic an engineer would draw for the part,
// drawn with the CPU die's own tools (`glyphKit`, `aluPoly`, `pcDigits`, the word strip) so the two read as one family, and wired inside: the
// decoder fans the op field out to its control lines, the scheduler's ready bits run into a round robin picker, the arbiter's requests queue per
// bank, the card memory ends in a row buffer and a controller. Pure drawing into a Graphics (and a callback for the few labels).
// The rectangles the live layer draws over (lane cells, warp cards, bank bars, register rows) are `gpuCells` / `maskParts` of gpuplans.ts and stay
// where they are; the symbols decorate inside them.

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

/** The block as the CPU die's slot geometry takes it (it reads only the id, kind, label, sub and rectangle). */
const asCpuBlock = (b: Pick<GpuBlock, 'id' | 'kind' | 'label' | 'sub' | 'rect'>) => b as unknown as Pick<Block, 'id' | 'kind' | 'label' | 'sub' | 'rect'>;

/** The five slots of the decoder's word strip for a GPU instruction (op, rd, rs1, rs2, imm), '' where the format has none. */
export function gpuSlotValues(word: number): string[] {
  const i = gpuDecode(word);
  if (!i) return ['?', '', '', '', ''];
  const f = GPU_SPEC_BY_NAME.get(i.name)!.fmt, v = (n: number) => `v${n}`;
  return [i.name, f === 'R' || f === 'I' || f === 'D' ? v(i.rd) : '', f === 'R' || f === 'I' || f === 'S' || f === 'M' ? v(i.rs1) : '', f === 'R' || f === 'S' || f === 'M' ? v(i.rs2) : '', f === 'I' || f === 'S' || f === 'O' ? String(i.imm) : ''];
}

/** Indices into CONTROL_LINES the instruction raises. */
export const gpuControlIndices = (s: { name: string; kind: string; dest: number | null }): number[] => {
  const set = gpuControlLines(s);
  return CONTROL_LINES.flatMap((n, k) => (set.has(n) ? [k] : []));
};

// ---------------------------------------------------------------- the geometry the drawing and the live layer share

const WORD_BITS = WORD_FIELDS.reduce((n, f) => n + f.bits, 0);
/** The fields of a word strip in proportion to their bits. */
function fieldRects(x: number, y: number, w: number, h: number): Rect[] {
  let fx = x;
  return WORD_FIELDS.map((f) => { const fw = (w * f.bits) / WORD_BITS, r = { x: fx, y, w: fw, h }; fx += fw; return r; });
}

/** The program counter's digits, on the left of the block with the next-pc logic beside them when it is wide enough. */
export const pcArea = (a: Rect): Rect => ({ x: a.x, y: a.y, w: a.w >= 200 ? a.w * 0.54 : a.w, h: Math.min(a.h, 22) });

/** The fetch: a window of the kernel, the word being fetched on the first row (the live word goes there), the words behind it dim. */
export function fetchGeom(a: Rect): { gutter: number; rows: Rect[] } {
  const gutter = a.w >= 90 ? 18 : 0, rh = Math.min(14, a.h), n = Math.max(1, Math.min(5, Math.floor((a.h + 3) / 17)));
  return { gutter, rows: Array.from({ length: n }, (_, k) => ({ x: a.x + gutter, y: a.y + k * 17, w: a.w - gutter, h: rh })) };
}

/** The decoder: the word on top; below it, when there is room, the register selects and the sign extender under their fields, the control unit under the op field and the control lines it fans out to. */
export function decodeGeom(a: Rect): { word: Rect; fields: Rect[]; lines: Rect[]; rich: boolean; sel: Rect[]; ctl: Rect; sext: Rect; busY: number } {
  const { x, y, w, h } = a, wh = Math.min(14, h * 0.4), n = CONTROL_LINES.length;
  const rich = h >= 56 && w >= 110, lh = 11, selH = 11;
  const gap = rich ? Math.max(6, Math.min(26, (h - wh - selH - lh) / 2)) : 0;
  const fields = fieldRects(x, y, w, wh), word = { x, y, w, h: wh };
  if (!rich) {
    const ly = y + wh + 4, h1 = Math.max(4, Math.min(11, h - wh - 6)), lw = (w - (n - 1) * 3) / n;
    return { word, fields, lines: CONTROL_LINES.map((_, k) => ({ x: x + k * (lw + 3), y: ly, w: lw, h: h1 })), rich, sel: [], ctl: word, sext: word, busY: ly };
  }
  const ySel = y + wh + gap, yLines = ySel + selH + gap, lw = (w - (n - 1) * 3) / n, box = (f: Rect): Rect => ({ x: f.x + 1, y: ySel, w: f.w - 2, h: selH });
  return {
    word, fields, rich, busY: ySel + selH + gap / 2, ctl: box(fields[0]!), sel: [1, 2, 3].map((k) => box(fields[k]!)), sext: box(fields[4]!),
    lines: CONTROL_LINES.map((_, k) => ({ x: x + k * (lw + 3), y: yLines, w: lw, h: lh })),
  };
}

/** What the symbols of the shared kinds show for the instruction on show (the program counter's digits, the word fetched, the decoded word and the lines it raises). `prog` is how far the instruction has got into the block (0..1), as on the CPU die. */
export function gpuGlyphLive(b: Pick<GpuBlock, 'id' | 'kind' | 'label' | 'sub' | 'rect'>, a: Rect, step: GpuStep | null, prog = 1): LiveGlyph {
  const out: LiveGlyph = { texts: [], lit: [] };
  if (!step) return out;
  const wipe = (r: Rect): Rect => ({ ...r, w: r.w * prog });
  switch (b.kind) {
    case 'pc': {
      const s = slotsOf(asCpuBlock(b), pcArea(a));
      if (s.digits) { const hex = (step.pc >>> 0).toString(16).padStart(8, '0'); s.digits.forEach((r, k) => out.texts.push({ rect: r, top: hex[k]!, bottom: '' })); }
      break;
    }
    case 'fetch': {
      const row = fetchGeom(a).rows[0]!;
      out.lit.push({ rect: wipe(row), color: 'alu', a: 0.92 });
      if (prog > 0.55) out.texts.push({ rect: row, top: step.word !== undefined ? gpuDisassemble(step.word) : step.name, bottom: '' });
      break;
    }
    case 'decode': {
      const d = decodeGeom(a);
      out.lit.push({ rect: wipe(d.word), color: 'alu', a: 0.92 });
      if (prog > 0.55 && step.word !== undefined) gpuSlotValues(step.word).forEach((v, n) => { if (v) out.texts.push({ rect: d.fields[n]!, top: v, bottom: '' }); });
      gpuControlIndices(step).forEach((n, j) => { if (prog > 0.45 + 0.1 * j) out.lit.push({ rect: d.lines[n]!, color: 'br', a: 0.6 }); });
      break;
    }
    default: break;
  }
  return out;
}

// ---------------------------------------------------------------- the symbols

/** Draw the symbol of block `b` into `g`; `put` adds a label. */
export function gpuGlyph(g: Graphics, T: Theme, b: GpuBlock, c: string, put: Put): void {
  const a = gpuGlyphArea(b);
  if (!a) return;
  const kit = glyphKit(g, T, c, put);
  const { solid, soft, line, rect, stub, poly, mux, adder, word } = kit;
  const { x, y, w, h } = a;
  const cells = gpuCells(b);
  /** A label starting at (lx, ly). */
  const lab = (t: string, lx: number, ly: number, size = 6.5) => put(t, lx + (t.length * size * 0.6) / 2, ly, size);
  const dot = (px: number, py: number) => { g.circle(px, py, 1.6).fill({ color: line }); };
  const outline = (rx: number, ry: number, rw: number, rh: number) => { g.roundRect(rx, ry, rw, rh, 1.5).stroke({ width: 1, color: line, alpha: 0.85 }); };
  const wire = (...p: number[]) => { g.moveTo(p[0]!, p[1]!); for (let k = 2; k < p.length; k += 2) g.lineTo(p[k]!, p[k + 1]!); g.stroke({ width: 1, color: line, alpha: 0.75 }); };

  switch (b.kind) {
    case 'pcie': {
      // the lanes of the link, receive and transmit a pair of cells each, merged onto a bus into the DMA engine and its credit counters
      const foot = h > 70 ? 16 : 0, top = h > 50 ? 9 : 0, bodyH = h - foot - top;
      const n = Math.max(2, Math.min(8, Math.floor(bodyH / 11))), cw = w * 0.25 - 1, busX = x + w * 0.56;
      if (top) { put('rx', x + cw / 2, y + 4, 6); put('tx', x + cw + 2 + cw / 2, y + 4, 6); }
      for (let k = 0; k < n; k++) {
        const ry = y + top + ((k + 0.5) * bodyH) / n;
        rect(x, ry - 3, cw, 6, soft); rect(x + cw + 2, ry - 3, cw, 6, solid);
        stub(x + 2 * cw + 2, ry, busX, ry);
      }
      stub(busX, y + top + 0.5 * bodyH / n, busX, y + top + (n - 0.5) * bodyH / n);
      const dh = Math.min(bodyH * 0.5, 44), dy = y + top + (bodyH - dh) / 2, dx = x + w * 0.64, dw = x + w - dx;
      stub(busX, dy + dh / 2, dx, dy + dh / 2); dot(busX, dy + dh / 2);
      rect(dx, dy, dw, dh, soft); outline(dx, dy, dw, dh); put('dma', dx + dw / 2, dy + dh / 2, 7);
      if (dy + dh + 12 < y + h - foot) for (let k = 0; k < 4; k++) rect(dx + 1 + (k * (dw - 2)) / 4, dy + dh + 6, (dw - 2) / 4 - 2, 5, k < 3 ? solid : soft);
      break;
    }
    case 'launch': {
      // the argument registers by name, merged onto a bus that raises the go flag; with room, the state machine of a launch and the command queue
      const names = ['kernel', 'arg0', 'arg1', 'lanes', 'status'], rows = h >= 85 ? 5 : Math.max(3, Math.floor(h / 15));
      const state = h >= rows * 17 + 34, queue = h >= rows * 17 + 70, pitch = state ? 17 : Math.min(26, h / rows), gut = Math.min(34, w * 0.26), vw = w * 0.6 - gut, busX = x + w * 0.68;
      for (let k = 0; k < rows; k++) {
        const ry = y + k * pitch;
        lab(names[k]!, x, ry + pitch / 2 - 1, 6.5);
        rect(x + gut, ry, vw, pitch - 3, k % 2 ? solid : soft);
        stub(x + gut + vw, ry + pitch / 2 - 1.5, busX, ry + pitch / 2 - 1.5);
      }
      stub(busX, y + pitch / 2 - 1.5, busX, y + (rows - 0.5) * pitch - 1.5);
      const gh = Math.min(rows * pitch * 0.5, 26), gy = y + (rows * pitch - gh) / 2 - 1.5, gx = x + w * 0.76;
      stub(busX, gy + gh / 2, gx, gy + gh / 2); dot(busX, gy + gh / 2);
      rect(gx, gy, x + w - gx, gh, soft); outline(gx, gy, x + w - gx, gh); put('go', gx + (x + w - gx) / 2, gy + gh / 2, 7);
      if (state) {
        // idle -> run -> done, and the commands waiting behind the one running
        const sy = y + rows * pitch + 14, bw = (w - 28) / 3;
        lab('launch state', x, sy - 6, 6.5);
        ['idle', 'run', 'done'].forEach((t, k) => {
          const bx = x + k * (bw + 14);
          rect(bx, sy, bw, 14, k === 1 ? solid : soft); outline(bx, sy, bw, 14); put(t, bx + bw / 2, sy + 7, 6.5);
          if (k < 2) wire(bx + bw, sy + 7, bx + bw + 14, sy + 7);
        });
        wire(x + 2 * (bw + 14) + bw / 2, sy + 14, x + 2 * (bw + 14) + bw / 2, sy + 22, x + bw / 2, sy + 22, x + bw / 2, sy + 14);
        const qy = sy + 34;
        if (queue) { lab('command queue', x, qy - 6, 6.5); for (let k = 0; k < 4; k++) rect(x + k * ((w - 3) / 4), qy, (w - 3) / 4 - 3, 12, k === 0 ? solid : soft); }
      }
      break;
    }
    case 'pc': {
      // the program counter feeding its own next value: + 1 for the next word, a branch target or the reconvergence point of a divergent branch, back in
      const pa = pcArea(a);
      pcDigits(g, kit, pa);
      if (pa.w < a.w - 1) {
        const cy = pa.y + pa.h / 2, r = Math.min(7, pa.h / 2 - 2), end = pa.x + pa.w, cx = end + 16 + r, mx = cx + r + 14, mw = 24, mh = Math.min(pa.h + 4, 26), my = cy - mh / 2, ox = mx + mw + 7;
        stub(end, cy, end + 9, cy);
        adder(cx, cy, r, ['', '']);
        stub(end + 9, cy, cx - r - 7, cy); dot(end + 9, cy);
        mux(mx, my, mw, mh, ['', '', '']);
        put('br', mx + mw * 0.45, my + mh * 0.26, 5.5); put('rcv', mx + mw * 0.45, my + mh * 0.78, 5.5);
        put('+1', cx, cy - r - 5, 5.5);
        if (a.h >= pa.h + 8) wire(ox, cy, ox + 1, cy, ox + 1, pa.y + pa.h + 5, pa.x + 4, pa.y + pa.h + 5, pa.x + 4, pa.y + pa.h);
        else stub(mx + mw, cy, ox, cy);
      }
      break;
    }
    case 'fetch': {
      // a window of the kernel: the word being fetched on the first row, the ones behind it dimmed, each by its distance from the pc
      const f = fetchGeom(a);
      f.rows.forEach((r, k) => {
        if (f.gutter) lab(k ? `+${k}` : 'pc', x, r.y + r.h / 2, 6.5);
        if (k === 0) { word(r.x, r.y, r.w, r.h, r.h >= 9); return; }
        fieldRects(r.x, r.y, r.w, r.h).forEach((fr) => rect(fr.x + 0.6, fr.y, fr.w - 1.2, fr.h, soft));
      });
      if (f.gutter && f.rows.length > 1) wire(x + f.gutter - 3, f.rows[0]!.y + f.rows[0]!.h / 2, x + f.gutter - 3, f.rows[f.rows.length - 1]!.y + f.rows[0]!.h / 2);
      break;
    }
    case 'decode': {
      const d = decodeGeom(a);
      word(d.word.x, d.word.y, d.word.w, d.word.h);
      if (!d.rich) {
        d.lines.forEach((r, k) => { rect(r.x, r.y, r.w, r.h, soft); if (r.h >= 7 && r.w > 14) put(CONTROL_LINES[k]!, r.x + r.w / 2, r.y + r.h / 2, 6); });
        break;
      }
      // the fields run down into their units: register selects, the sign extender, the control unit that fans the op out to its lines
      const named: [Rect, string][] = [[d.ctl, 'ctl'], [d.sel[0]!, 'dst'], [d.sel[1]!, 'srcA'], [d.sel[2]!, 'srcB'], [d.sext, 'sext']];
      named.forEach(([r, t], k) => {
        const fr = d.fields[k]!, cx = fr.x + fr.w / 2;
        stub(cx, fr.y + fr.h, cx, r.y);
        rect(r.x, r.y, r.w, r.h, k ? soft : solid); put(t, r.x + r.w / 2, r.y + r.h / 2, 6);
      });
      const cx = d.ctl.x + d.ctl.w / 2, first = d.lines[0]!, last = d.lines[d.lines.length - 1]!;
      stub(cx, d.ctl.y + d.ctl.h, cx, d.busY);
      stub(Math.min(cx, first.x + first.w / 2), d.busY, last.x + last.w / 2, d.busY); dot(cx, d.busY);
      d.lines.forEach((r, k) => { stub(r.x + r.w / 2, d.busY, r.x + r.w / 2, r.y); rect(r.x, r.y, r.w, r.h, soft); if (r.w > 14) put(CONTROL_LINES[k]!, r.x + r.w / 2, r.y + r.h / 2, 6); });
      break;
    }
    case 'sched': {
      // the scoreboard (a bit per register and warp: pending writes) and the round robin that picks the warp to issue
      const rows = b.grid?.rows ?? 1, cols = b.grid?.cols ?? 8, picker = w >= 160, gut = w >= 90 ? 30 : 12, headH = h >= 30 ? 8 : 0;
      const sw = (picker ? w * 0.62 : w) - gut, cw = sw / cols, rh = Math.min(34, (h - headH) / rows);
      if (headH && cw >= 9) for (let k = 0; k < cols; k++) put(`v${k}`, x + gut + (k + 0.5) * cw, y + 4, 5.5);
      for (let r = 0; r < rows; r++) {
        const ry = y + headH + r * rh;
        lab(gut >= 30 ? `warp ${r}` : `w${r}`, x, ry + rh / 2, 6);
        for (let k = 0; k < cols; k++) rect(x + gut + k * cw + 0.5, ry + 1, cw - 1, rh - 2, soft);
        g.circle(x + gut + sw + 5, ry + rh / 2, 2).fill({ color: line, alpha: r === 0 ? 0.95 : 0.5 }); // the warp's ready line
        poly([x - 7, ry + rh / 2 - 3, x - 1, ry + rh / 2, x - 7, ry + rh / 2 + 3], r === 0 ? solid : soft); // the pointer
      }
      if (picker) {
        const mw = 22, mx = x + w * 0.78, mh = Math.min(h * 0.85, rows * rh + 8), my = y + headH + (rows * rh - mh) / 2, xm = x + gut + sw + 14;
        mux(mx, my, mw, mh, Array(rows).fill(''));
        for (let r = 0; r < rows; r++) wire(x + gut + sw + 7, y + headH + r * rh + rh / 2, xm, y + headH + r * rh + rh / 2, xm, my + mh * ((r + 0.5) / rows), mx - 7, my + mh * ((r + 0.5) / rows));
        put('rr', mx + mw * 0.5, my + mh / 2, 7);
      }
      break;
    }
    case 'warps': {
      // one card per warp: its state, program counter, active mask and divergence stack
      cells.forEach((r, k) => {
        rect(r.x, r.y, r.w, r.h, soft);
        const pad = 4, ix = r.x + pad, iw = r.w - 2 * pad;
        if (r.w >= 150 && r.h >= 62) {
          const top = r.y + 5, pitch = Math.min(28, (r.h - 22 - 9) / 3), lx = ix + 26, lw = iw - 26;
          lab(`warp ${k}`, ix, top + 4, 7);
          rect(r.x + r.w - pad - 32, top, 32, 9, solid); put('ready', r.x + r.w - pad - 16, top + 4.5, 6);
          const y1 = top + 14, y2 = y1 + pitch, y3 = y2 + pitch;
          lab('pc', ix, y1 + 6, 6.5);
          pcDigits(g, kit, { x: lx, y: y1, w: lw, h: 12 });
          lab('mask', ix, y2 + 4, 6.5);
          for (let j = 0; j < 16; j++) rect(lx + (j * lw) / 16, y2, lw / 16 - 1, 8, j < 12 ? solid : soft);
          lab('stack', ix, y3 + 5, 6.5);
          const sl = lw / 8;
          for (let j = 0; j < 8; j++) { if (j < 2) rect(lx + j * sl, y3, sl - 3, 10, solid); outline(lx + j * sl, y3, sl - 3, 10); }
        } else if (r.h >= 56 && r.w >= 36) {
          // a narrow card: its name, then the program counter, the mask and the stack each under its label
          const pitch = (r.h - 20 - 8) / 3, cx = r.x + r.w / 2;
          put(`warp ${k}`, cx, r.y + 7, 6.5);
          const y1 = r.y + 14, y2 = y1 + pitch, y3 = y2 + pitch;
          put('pc', cx, y1 + 3, 5.5); rect(ix, y1 + 7, iw, 6, solid);
          put('mask', cx, y2 + 3, 5.5); for (let j = 0; j < 8; j++) rect(ix + (j * iw) / 8, y2 + 7, iw / 8 - 1, 6, j < 6 ? solid : soft);
          put('stack', cx, y3 + 3, 5.5);
          for (let j = 0; j < 4; j++) { const sx = ix + (j * iw) / 4; if (j < 2) rect(sx, y3 + 7, iw / 4 - 2, 8, solid); outline(sx, y3 + 7, iw / 4 - 2, 8); }
        } else {
          const px = r.x + 3, pw = r.w - 6, rh = Math.max(2, (r.h - 8) / 6);
          rect(px, r.y + 3, pw * 0.7, rh, solid);
          if (r.h >= 34 && pw >= 70) { put('pc', px + pw * 0.85, r.y + 3 + rh / 2, Math.min(7, rh)); put('mask', px + pw * 0.5, r.y + 5 + rh * 1.5, Math.min(7, rh)); put('stack', px + pw * 0.5, r.y + 7 + rh * 3, Math.min(7, rh)); }
          for (let j = 0; j < 8; j++) rect(px + (j * pw) / 8, r.y + 5 + rh, Math.max(1, pw / 8 - 1), rh, j < 6 ? solid : soft);
          for (let j = 0; j < 3; j++) rect(px, r.y + 7 + rh * (2 + j) + j, pw * (0.9 - 0.2 * j), rh, soft);
        }
      });
      break;
    }
    case 'regfile': {
      // the register array, each row a register, with its read and write ports
      const cols = b.grid?.cols ?? 1;
      cells.forEach((r, k) => rect(r.x, r.y, r.w, r.h, Math.floor(k / cols) % 2 ? soft : solid));
      for (let k = 0; k < (b.grid?.rows ?? 0); k++) { const c0 = cells[k * cols]; if (c0 && c0.h >= 7) put(`v${k}`, c0.x + 9, c0.y + c0.h / 2, Math.min(7, c0.h * 0.8)); }
      stub(x - 6, y + h * 0.3, x, y + h * 0.3);
      stub(x - 6, y + h * 0.7, x, y + h * 0.7);
      stub(x + w, y + h / 2, x + w + 6, y + h / 2);
      break;
    }
    case 'lanes': {
      // an ALU in every lane: the notched trapezoid, its lane number and the operation it is given
      cells.forEach((r, k) => {
        poly(aluPoly(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3));
        if (r.h >= 22 && r.w >= 34) { put('op', r.x + r.w * 0.55, r.y + r.h * 0.5, 6.5); put(`l${k}`, r.x + 12, r.y + r.h - 6, 5.5); }
      });
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
      // the lanes' addresses funnel into the few lines they touch: each lane's request merges onto the line it falls in
      const n = 8, outs = 3, lx0 = h / n >= 12 ? 14 : 3, mx = x + w * 0.6;
      for (let k = 0; k < n; k++) {
        const ly = y + ((k + 0.5) * h) / n, oy = y + ((Math.floor((k * outs) / n) + 0.5) * h) / outs;
        if (lx0 > 3) put(`l${k}`, x + 6, ly, 5.5);
        g.circle(x + lx0, ly, 2).fill({ color: solid });
        wire(x + lx0, ly, x + w * 0.4, ly, mx - 6, oy, x + w - 16, oy);
        dot(mx - 6, oy);
      }
      for (let k = 0; k < outs; k++) { const oy = y + ((k + 0.5) * h) / outs; rect(x + w - 16, oy - 6, 16, 12, solid); put('ln', x + w - 8, oy, 5.5); }
      break;
    }
    case 'arbiter': {
      const nb = Math.max(1, Number(/^(\d+)/.exec(b.sub ?? '')?.[1] ?? b.grid?.count ?? 1));
      if (b.grid) {
        // each bank's request queue is one row (the live layer fills it, a slot per access)
        cells.forEach((r, k) => {
          lab(`b${k}`, r.x + 3, r.y + 7, 6);
          const len = r.w - 4, seg = len / 8;
          for (let j = 0; j < 8; j++) g.rect(r.x + 2 + j * seg + 1, r.y + 1 + Math.min(10, r.h * 0.3), seg - 2, r.h - 2 - Math.min(10, r.h * 0.3)).stroke({ width: 0.8, color: line, alpha: 0.55 });
        });
        break;
      }
      // the lanes' requests come in on a column of request cells, merge onto a bus and queue at the bank they address; a picker takes the oldest of each
      // queue and a comparator spots two lanes on one bank
      const foot = h > 130 ? 44 : 0, region = h - foot - 4, pitch = Math.min(56, region / nb), busX = x + 20, sh = Math.min(14, pitch - 14), qx = x + 30;
      const sw = Math.max(5, (w * 0.5 - 30) / 4), n = 8, rq = Math.min(14, region / n - 3);
      for (let k = 0; k < n; k++) {
        const ry = y + 4 + ((k + 0.5) * region) / n;
        rect(x + 2, ry - rq / 2, 10, rq, k % 3 === 0 ? solid : soft); stub(x + 12, ry, busX, ry);
      }
      stub(busX, y + 4 + 0.5 * region / n, busX, y + 4 + (n - 0.5) * region / n);
      for (let k = 0; k < nb; k++) {
        const ry = y + 4 + k * pitch + pitch / 2 + (region - nb * pitch) / 2;
        lab(`b${k}`, qx, ry - sh / 2 - 5, 6);
        stub(busX, ry, qx, ry); dot(busX, ry);
        for (let j = 0; j < 4; j++) rect(qx + j * (sw + 1), ry - sh / 2, sw, sh, j === 0 ? solid : soft);
        const px = qx + 4 * (sw + 1) + 7;
        stub(qx + 4 * (sw + 1), ry, px - 5, ry);
        g.circle(px, ry, 5).fill({ color: soft }).stroke({ width: 1.2, color: line });
        stub(px + 5, ry, x + w, ry);
      }
      if (foot) {
        const cy = y + 4 + region + foot / 2 - 4, cx = x + w * 0.4;
        stub(busX, y + 4 + (n - 0.5) * region / n, busX, cy); stub(busX, cy, cx - 8, cy); dot(busX, cy);
        g.circle(cx, cy, 8).fill({ color: soft }).stroke({ width: 1.3, color: line }); put('=?', cx, cy, 7);
        stub(cx + 8, cy, x + w * 0.58, cy);
        rect(x + w * 0.58, cy - 6, x + w - (x + w * 0.58), 12, soft); put('serialise', x + w * 0.58 + (x + w - (x + w * 0.58)) / 2, cy, 6);
      }
      break;
    }
    case 'banks': {
      // an SRAM array per bank: a row decoder on top, rows of words, the sense amplifiers underneath
      cells.forEach((r, k) => {
        rect(r.x, r.y, r.w, r.h, soft);
        const horizontal = r.w >= r.h, head = horizontal ? 0 : Math.min(9, r.h * 0.08), foot = horizontal ? 0 : Math.min(8, r.h * 0.07);
        if (head >= 5) { rect(r.x + 1.5, r.y + 1.5, r.w - 3, head - 2, solid); put(`b${k}`, r.x + r.w / 2, r.y + head / 2 + 0.5, Math.min(6, head - 1.5)); }
        if (foot >= 4) for (let j = 0; j < 4; j++) rect(r.x + 1.5 + (j * (r.w - 3)) / 4, r.y + r.h - foot - 0.5, (r.w - 3) / 4 - 1, foot - 1, solid);
        const by = r.y + head, bh = r.h - head - foot, n = Math.max(1, Math.floor(bh / 6));
        if (horizontal) { const m = Math.max(1, Math.floor(r.w / 6)); for (let j = 1; j < m; j++) stub(r.x + (j * r.w) / m, r.y + 1.5, r.x + (j * r.w) / m, r.y + r.h - 1.5); }
        else for (let j = 1; j < n; j++) stub(r.x + 1.5, by + (j * bh) / n, r.x + r.w - 1.5, by + (j * bh) / n);
      });
      break;
    }
    case 'l1':
    case 'l2': {
      // a line is its valid bit and tag beside its data
      for (const r of cells) {
        rect(r.x, r.y, r.w * 0.3, r.h, solid); rect(r.x + r.w * 0.3 + 1, r.y, r.w * 0.7 - 1, r.h, soft);
        if (r.h >= 6 && r.w >= 12) g.circle(r.x + 2.5, r.y + r.h / 2, 1).fill({ color: line });
      }
      break;
    }
    case 'dram': {
      // the card's memory: rows of words (with the map of what lives where), the row buffer under them and the controller
      const foot = h > 150 ? 34 : 0, cw = 9, cols = Math.min(64, Math.floor(w / cw)), rows = Math.min(40, Math.floor((h - foot) / cw));
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) g.rect(x + k * cw + 1, y + r * cw + 1, cw - 2, cw - 2);
      g.fill({ color: soft });
      // the map of the memory: the kernel code, its two parameter words, the picture the card draws (docs/GPU.md section 2), as bands over the rows
      if (b.bytes && rows >= 4) {
        const total = cols * rows, cell = (a0: number) => Math.min(total, Math.max(0, Math.round((a0 / b.bytes!) * total)));
        const bands: { from: number; to: number; name: string; fill: string }[] = [
          { from: 0, to: KERNEL_LAYOUT.param, name: 'code', fill: solid }, { from: KERNEL_LAYOUT.param, to: GPU_FRAME.at, name: 'args', fill: line }, { from: GPU_FRAME.at, to: GPU_FRAME.at + GPU_FRAME.words * 4, name: 'frame', fill: mix(T.die, T.st, 0.7) },
        ];
        for (const bd of bands) {
          const a0 = cell(bd.from), z = Math.max(a0 + 1, cell(bd.to));
          for (let k = a0; k < Math.min(z, total); k++) g.rect(x + (k % cols) * cw + 1, y + Math.floor(k / cols) * cw + 1, cw - 2, cw - 2).fill({ color: bd.fill, alpha: 0.9 });
          const r0 = Math.floor(a0 / cols);
          if (cols * cw > 90 && r0 < rows - 1) put(bd.name, x + (a0 % cols) * cw + 18, y + r0 * cw + cw / 2 + 0.5, 7);
        }
      }
      if (foot) {
        const by = y + rows * cw + 4, mx = x + cols * cw / 2, bw = cols * cw * 0.4, cy = by + 21;
        for (let k = 0; k < cols; k++) g.rect(x + k * cw + 1, by, cw - 2, 6).fill({ color: solid });
        lab('row buffer', x + 2, by + 13, 6);
        stub(mx, by + 6, mx, cy - 6);
        rect(mx - bw / 2, cy - 6, bw, 12, soft); outline(mx - bw / 2, cy - 6, bw, 12); put('ctrl', mx, cy, 6.5);
        stub(x, cy, mx - bw / 2, cy); stub(mx + bw / 2, cy, x + cols * cw, cy);
      }
      break;
    }
    case 'sm':
      break;
  }
}
