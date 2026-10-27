import type { Graphics } from 'pixi.js';
import type { Block, Rect } from './cpuplan';
import { fetchWidth, glyphArea, isGlyph, laneCount, GLYPH_KINDS } from './glyphgeom';
import { mix } from './ink';
import { regName, slotValues, writesOf } from './tokentext';
import type { Theme } from './theme';

// What is inside a block of the die (docs/DIE.md "Inside the blocks"): the symbol an engineer would draw for the part, not a field of identical
// cells. A register is a row of hex digits, a multiplexer a trapezoid with its inputs, an adder a circle with a plus, an ALU the notched
// trapezoid, a multiplier a triangle of partial products, the decoder the instruction's fields and the control lines it raises.
// Pure drawing into a Graphics (and a callback for the few labels), so it is testable and the far view never pays for it.

export { fetchWidth, glyphArea, isGlyph, laneCount, GLYPH_KINDS };

/** Where a text goes: its centre, in die units, and its size. */
export type Put = (text: string, x: number, y: number, size: number) => void;

/** The fields of a 32-bit instruction word, by width in bits (docs/ISA.md). */
export const WORD_FIELDS: readonly { name: string; bits: number }[] = [
  { name: 'op', bits: 7 }, { name: 'rd', bits: 4 }, { name: 'rs1', bits: 4 }, { name: 'rs2', bits: 4 }, { name: 'imm', bits: 13 },
];
/** The control lines the decoder raises, in the order they are drawn. */
export const CONTROL_LINES: readonly string[] = ['alu', 'mem', 'wr', 'br', 'imm', 'sys'];

/** Draw the symbol of block `b` into `g`; `put` adds a label. */
export function glyph(g: Graphics, T: Theme, b: Block, a: Rect, c: string, put: Put): void {
  const solid = mix(T.die, c, 0.42), soft = mix(T.die, c, 0.2), line = mix(T.die, c, 0.85);
  const { x, y, w, h } = a;
  const rect = (rx: number, ry: number, rw: number, rh: number, f = solid) => { g.roundRect(rx, ry, rw, rh, 1.5).fill({ color: f }); };
  const stub = (x0: number, y0: number, x1: number, y1: number) => { g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1.2, color: line }); };
  const poly = (pts: number[], f = soft) => { g.poly(pts).fill({ color: f }).stroke({ width: 1.3, color: line }); };
  const mux = (mx: number, my: number, mw: number, mh: number, ins: string[]) => {
    poly([mx, my, mx + mw, my + mh * 0.22, mx + mw, my + mh * 0.78, mx, my + mh]);
    ins.forEach((t, k) => { const iy = my + mh * ((k + 0.5) / ins.length); stub(mx - 7, iy, mx, iy); put(t, mx + 3 + t.length * 2, iy, 6); });
    stub(mx + mw, my + mh / 2, mx + mw + 7, my + mh / 2);
  };
  const adder = (cx: number, cy: number, r: number, ins: string[]) => {
    g.circle(cx, cy, r).fill({ color: soft }).stroke({ width: 1.3, color: line });
    g.moveTo(cx - r * 0.5, cy).lineTo(cx + r * 0.5, cy).moveTo(cx, cy - r * 0.5).lineTo(cx, cy + r * 0.5).stroke({ width: 1.3, color: line });
    ins.forEach((t, k) => { const iy = cy + (k - (ins.length - 1) / 2) * r * 1.1; stub(cx - r - 7, iy, cx - r * 0.8, iy); if (t) put(t, cx - r - 3, iy - 4, 6); });
    stub(cx + r, cy, cx + r + 7, cy);
  };
  /** A word as its fields in proportion, `n` bits wide in `bw`. */
  const word = (wx: number, wy: number, ww: number, wh: number, names = true) => {
    const total = WORD_FIELDS.reduce((s, f) => s + f.bits, 0);
    let fx = wx;
    WORD_FIELDS.forEach((f, k) => {
      const fw = (ww * f.bits) / total;
      rect(fx + 0.6, wy, fw - 1.2, wh, k % 2 ? solid : soft);
      if (names && wh >= 8 && fw > 12) put(f.name, fx + fw / 2, wy + wh / 2, Math.min(7, wh * 0.7));
      fx += fw;
    });
  };

  if (b.id === 'disp') {
    // the lanes that leave for the scheduler this cycle
    const n = laneCount(b), gap = 4, sw = (w - (n - 1) * gap) / n, sh = Math.min(16, h);
    for (let k = 0; k < n; k++) { rect(x + k * (sw + gap), y + (h - sh) / 2, sw, sh, soft); stub(x + k * (sw + gap) + sw, y + h / 2, x + k * (sw + gap) + sw + gap, y + h / 2); }
    return;
  }
  switch (b.kind) {
    case 'pc': {
      // eight hex digits, four bits each
      const gap = 3, dw = (w - 7 * gap) / 8, dh = Math.min(h, 22);
      for (let k = 0; k < 8; k++) {
        const dx = x + k * (dw + gap);
        rect(dx, y + (h - dh) / 2, dw, dh);
        for (let j = 0; j < 4; j++) g.rect(dx + 1.5 + j * ((dw - 3) / 4), y + (h - dh) / 2 + dh - 3.5, Math.max(1, (dw - 3) / 4 - 1), 2).fill({ color: line });
      }
      break;
    }
    case 'nextpc': {
      const mh = Math.min(h, 40), mw = Math.min(w * 0.35, 46);
      mux(x + w * 0.38, y + (h - mh) / 2, mw, mh, ['+4', 'br', 'irq']);
      break;
    }
    case 'pcadd': {
      const r = Math.min(h / 2, w / 5, 17);
      adder(x + w / 2, y + h / 2, r, ['pc', '4']);
      break;
    }
    case 'fetch': {
      // the words read this cycle, each as its fields
      const n = fetchWidth(b), gap = 3, wh = Math.min(16, (h - (n - 1) * gap) / n);
      for (let k = 0; k < n; k++) word(x, y + k * (wh + gap), w, wh, wh >= 9);
      break;
    }
    case 'imm': {
      // the immediate: the sign bit copied up, then the field
      const bh = Math.min(h, 18), by = y + (h - bh) / 2;
      rect(x, by, w * 0.4, bh, soft);
      rect(x + w * 0.44, by, w * 0.56, bh, solid);
      put('sign', x + w * 0.2, by + bh / 2, 7);
      put('imm', x + w * 0.72, by + bh / 2, 7);
      g.moveTo(x + w * 0.42, by + bh / 2).lineTo(x + w * 0.44, by + bh / 2).stroke({ width: 1.3, color: line });
      break;
    }
    case 'decode': {
      // the word it holds, and the lines it raises
      const wh = Math.min(14, h * 0.4);
      word(x, y, w, wh);
      const ly = y + wh + 4, lh = Math.max(4, Math.min(11, h - wh - 6)), n = CONTROL_LINES.length, lw = (w - (n - 1) * 3) / n;
      CONTROL_LINES.forEach((t, k) => { rect(x + k * (lw + 3), ly, lw, lh, soft); if (lh >= 7 && lw > 14) put(t, x + k * (lw + 3) + lw / 2, ly + lh / 2, 6); });
      break;
    }
    case 'alu': {
      // the notched trapezoid: operands A and B in, the operation in on top, the result out
      const ah = Math.min(h, 56), ay = y + (h - ah) / 2, aw = Math.min(w * 0.5, 88), ax = x + w * 0.2;
      poly([ax, ay, ax + aw, ay + ah * 0.22, ax + aw, ay + ah * 0.78, ax, ay + ah, ax, ay + ah * 0.62, ax + aw * 0.14, ay + ah / 2, ax, ay + ah * 0.38]);
      // the operands arrive on one bus (the pin the wires run into) that feeds A and B
      stub(ax - 18, ay + ah * 0.2, ax, ay + ah * 0.2); put('A', ax - 9, ay + ah * 0.2 - 5, 6);
      stub(ax - 18, ay + ah * 0.8, ax, ay + ah * 0.8); put('B', ax - 9, ay + ah * 0.8 + 5, 6);
      stub(ax - 18, ay + ah * 0.2, ax - 18, ay + ah * 0.8);
      stub(ax + aw, ay + ah / 2, ax + aw + 8, ay + ah / 2);
      rect(ax + aw + 8, ay + ah * 0.3, Math.min(40, x + w - (ax + aw + 8)), ah * 0.4);
      put('out', ax + aw + 8 + Math.min(40, x + w - (ax + aw + 8)) / 2, ay + ah / 2, 7);
      put('op', ax + aw * 0.55, ay + ah * 0.5, 7);
      break;
    }
    case 'mul': {
      // partial products added up in a triangle
      const rows = Math.max(3, Math.min(7, Math.floor(h / 7))), cell = Math.min(6, (h - 2) / rows, (w * 0.5) / rows);
      for (let r = 0; r < rows; r++) for (let k = 0; k <= r; k++) rect(x + 8 + k * (cell + 1.5), y + 1 + r * (cell + 1.5), cell, cell, k === r ? solid : soft);
      stub(x + 2, y + h / 2, x + 8, y + h / 2);
      stub(x + 12 + rows * (cell + 1.5), y + h / 2, x + w * 0.62, y + h / 2);
      rect(x + w * 0.62, y + h / 2 - 8, Math.min(60, w * 0.3), 16);
      put('a × b', x + w * 0.62 + Math.min(60, w * 0.3) / 2, y + h / 2, 7);
      break;
    }
    case 'lsu': {
      // the address adder, then the older loads and stores that are waiting
      const r = Math.min(h / 2.4, 14), cx = x + r + 10;
      adder(cx, y + h / 2, r, ['', '']);
      stub(cx - r - 12, y + h / 2 - r * 0.55, cx - r - 12, y + h / 2 + r * 0.55); stub(cx - r - 12, y + h / 2 - r * 0.55, cx - r - 7, y + h / 2 - r * 0.55); stub(cx - r - 12, y + h / 2 + r * 0.55, cx - r - 7, y + h / 2 + r * 0.55);
      const qx = cx + r + 14, qw = x + w - qx, n = 4, sw = (qw - (n - 1) * 3) / n, sh = Math.min(12, (h - 6) / 2);
      for (let q = 0; q < 2; q++) for (let k = 0; k < n; k++) rect(qx + k * (sw + 3), y + h / 2 - sh - 1.5 + q * (sh + 3), sw, sh, q ? solid : soft);
      put('load', qx - 11, y + h / 2 - sh / 2 - 1.5, 6);
      put('store', qx - 12, y + h / 2 + sh / 2 + 1.5, 6);
      break;
    }
    case 'branch': {
      // two values compared: equal, less, less unsigned -> taken
      const bh = Math.min(h, 40), by = y + (h - bh) / 2, bw = Math.min(w * 0.4, 56), bx = x + w * 0.25;
      poly([bx, by, bx + bw, by + bh * 0.2, bx + bw, by + bh * 0.8, bx, by + bh]);
      put('cmp', bx + bw * 0.45, by + bh / 2, 7);
      stub(bx - 14, by + bh * 0.25, bx, by + bh * 0.25); stub(bx - 14, by + bh * 0.75, bx, by + bh * 0.75); stub(bx - 14, by + bh * 0.25, bx - 14, by + bh * 0.75);
      stub(bx + bw, by + bh / 2, bx + bw + 8, by + bh / 2);
      rect(bx + bw + 8, by + bh / 2 - 6, 24, 12);
      put('taken', bx + bw + 20, by + bh / 2, 6);
      break;
    }
    case 'wb': {
      mux(x + w * 0.4, y + (h - Math.min(h, 40)) / 2, Math.min(w * 0.3, 40), Math.min(h, 40), ['alu', 'mem', 'pc+4']);
      break;
    }
    default: break;
  }
}


// ---------------------------------------------------------------- what the symbols show while the machine runs

/** An instruction as the live symbols need it. */
export interface LiveItem { op: string; text: string; pc: number; word?: number }
/** Text to show in a rectangle (it is fitted to it), and rectangles to light. */
export interface LiveGlyph { texts: { rect: Rect; top: string; bottom: string }[]; lit: { rect: Rect; color: 'alu' | 'mul' | 'ld' | 'st' | 'br'; a: number }[] }

const isImm = (op: string) => op.endsWith('i') && op !== 'bltui' || op === 'lw' || op === 'lb' || op === 'lbu' || op === 'sw' || op === 'sb' || op === 'jalr' || op === 'lui' || op === 'auipc' || op[0] === 'b' || op === 'jal';
const writes = (op: string) => !(op === 'sw' || op === 'sb' || op[0] === 'b' || op === 'ecall' || op === 'iret');

/** The control lines the decoder raises for an instruction (indices into CONTROL_LINES). */
export function controlsOf(op: string): number[] {
  const out: number[] = [];
  if (!(op === 'lw' || op === 'lb' || op === 'lbu' || op === 'sw' || op === 'sb' || op[0] === 'b' || op === 'jal' || op === 'jalr' || op === 'ecall' || op === 'iret')) out.push(0);
  if (op === 'lw' || op === 'lb' || op === 'lbu' || op === 'sw' || op === 'sb') out.push(1);
  if (writes(op)) out.push(2);
  if (op[0] === 'b' || op === 'jal' || op === 'jalr') out.push(3);
  if (isImm(op) && op[0] !== 'b') out.push(4);
  if (op === 'ecall' || op === 'iret') out.push(5);
  return out;
}

/** The rectangles inside a symbol where live text goes (the same geometry `glyph` draws). */
export function slotsOf(b: Block, a: Rect): { digits?: Rect[]; words?: Rect[]; word?: Rect; fields?: Rect[]; lines?: Rect[]; op?: Rect; operands?: Rect; out?: Rect } {
  const { x, y, w, h } = a;
  if (b.id === 'disp') { const n = laneCount(b), gap = 4, sw = (w - (n - 1) * gap) / n, sh = Math.min(16, h); return { words: Array.from({ length: n }, (_, k) => ({ x: x + k * (sw + gap), y: y + (h - sh) / 2, w: sw, h: sh })) }; }
  switch (b.kind) {
    case 'pc': {
      const gap = 3, dw = (w - 7 * gap) / 8, dh = Math.min(h, 22);
      return { digits: Array.from({ length: 8 }, (_, k) => ({ x: x + k * (dw + gap) - 3, y: y + (h - dh) / 2, w: dw + 6, h: dh })) }; // a little wider than the box: one digit fits either way
    }
    case 'fetch': {
      const n = fetchWidth(b), gap = 3, wh = Math.min(16, (h - (n - 1) * gap) / n);
      return { words: Array.from({ length: n }, (_, k) => ({ x, y: y + k * (wh + gap), w, h: wh })) };
    }
    case 'decode': {
      const wh = Math.min(14, h * 0.4), ly = y + wh + 4, lh = Math.max(4, Math.min(11, h - wh - 6)), n = CONTROL_LINES.length, lw = (w - (n - 1) * 3) / n;
      const total = WORD_FIELDS.reduce((n, f) => n + f.bits, 0);
      let fx = x;
      const fields = WORD_FIELDS.map((f) => { const fw = (w * f.bits) / total, r = { x: fx, y, w: fw, h: wh }; fx += fw; return r; });
      return { word: { x, y, w, h: wh }, fields, lines: Array.from({ length: n }, (_, k) => ({ x: x + k * (lw + 3), y: ly, w: lw, h: lh })) };
    }
    case 'alu': {
      const ah = Math.min(h, 56), ay = y + (h - ah) / 2, aw = Math.min(w * 0.5, 88), ax = x + w * 0.2, ow = Math.min(40, x + w - (ax + aw + 8));
      return { op: { x: ax + aw * 0.1, y: ay + ah * 0.3, w: aw * 0.8, h: ah * 0.4 }, out: { x: ax + aw + 8, y: ay + ah * 0.3, w: ow, h: ah * 0.4 }, operands: { x: ax, y: ay + ah + 1, w: aw + ow + 8, h: Math.max(0, y + h - (ay + ah) - 1) } };
    }
    case 'imm': { const bh = Math.min(h, 18); return { out: { x: x + w * 0.44, y: y + (h - bh) / 2, w: w * 0.56, h: bh } }; }
    case 'wb': { const mw = Math.min(w * 0.3, 40), ox = x + w * 0.4 + mw + 8; return { out: { x: ox, y: y + h / 2 - 7, w: Math.max(0, x + w - ox), h: 14 } }; }
    case 'mul': return { out: { x: x + w * 0.62, y: y + h / 2 - 8, w: Math.min(60, w * 0.3), h: 16 } };
    case 'lsu': return { operands: { x: x + w * 0.45, y: y + h - 9, w: w * 0.55, h: 9 } };
    default: return {};
  }
}

/** What a symbol shows for the instructions in its block: the PC's digits, the words fetched, the decoded word and the lines it raises, the operation in the ALU. */
export function glyphLive(b: Block, a: Rect, items: LiveItem[], pc?: number, prog: readonly number[] = []): LiveGlyph {
  const s = slotsOf(b, a), out: LiveGlyph = { texts: [], lit: [] };
  const it = items[0];
  /** How far an instruction has got into the block (0 just arrived .. 1 settled): its words wipe in, its control lines light one after another. */
  const pr = (k: number) => Math.max(0, Math.min(1, prog[k] ?? 1));
  const wipe = (r: Rect, f: number): Rect => ({ ...r, w: r.w * f });
  switch (b.kind) {
    case 'queue':
      items.slice(0, s.words?.length ?? 0).forEach((x, k) => {
        out.lit.push({ rect: wipe(s.words![k]!, pr(k)), color: 'ld', a: 0.92 });
        if (pr(k) > 0.55) out.texts.push({ rect: s.words![k]!, top: x.op, bottom: '' });
      });
      break;
    case 'pc':
      if (pc !== undefined && s.digits) { const hex = (pc >>> 0).toString(16).padStart(8, '0'); s.digits.forEach((r, k) => out.texts.push({ rect: r, top: hex[k]!, bottom: '' })); }
      break;
    case 'fetch':
      items.slice(0, s.words?.length ?? 0).forEach((x, k) => {
        out.lit.push({ rect: wipe(s.words![k]!, pr(k)), color: 'alu', a: 0.92 });
        if (pr(k) > 0.55) out.texts.push({ rect: s.words![k]!, top: x.text, bottom: '' });
      });
      break;
    case 'decode':
      if (it && s.word && s.lines) {
        out.lit.push({ rect: wipe(s.word, pr(0)), color: 'alu', a: 0.92 });
        if (pr(0) > 0.55 && s.fields) slotValues(it.word ?? 0).forEach((v, k) => { if (v) out.texts.push({ rect: s.fields![k]!, top: v, bottom: '' }); });
        controlsOf(it.op).forEach((k, j) => { if (pr(0) > 0.45 + 0.1 * j) out.lit.push({ rect: s.lines![k]!, color: 'br', a: 0.6 }); });
      }
      break;
    case 'imm':
      if (it && s.out) { out.lit.push({ rect: wipe(s.out, pr(0)), color: 'alu', a: 0.92 }); if (pr(0) > 0.55) out.texts.push({ rect: s.out, top: slotValues(it.word ?? 0)[4] ?? '', bottom: '' }); }
      break;
    case 'wb':
      if (it && s.out && s.out.w > 20) { const wr = writesOf(it.word ?? 0); out.lit.push({ rect: wipe(s.out, pr(0)), color: 'st', a: 0.9 }); if (pr(0) > 0.55) out.texts.push({ rect: s.out, top: wr >= 0 ? '→ ' + regName(wr) : 'done', bottom: '' }); }
      break;
    case 'alu': case 'mul': case 'lsu':
      if (it) {
        const col = b.kind === 'mul' ? 'mul' : b.kind === 'lsu' ? 'ld' : 'alu';
        if (s.op) { out.lit.push({ rect: wipe(s.op, pr(0)), color: col, a: 0.92 }); if (pr(0) > 0.55) out.texts.push({ rect: s.op, top: it.op, bottom: '' }); }
        const r = s.operands;
        if (r && r.h >= 7 && pr(0) > 0.7) out.texts.push({ rect: { ...r, h: Math.max(14, r.h) }, top: it.text.slice(it.op.length + 1), bottom: '' });
        if (s.out && pr(0) > 0.8) out.lit.push({ rect: s.out, color: col, a: 0.55 });
      }
      break;
    default: break;
  }
  return out;
}
