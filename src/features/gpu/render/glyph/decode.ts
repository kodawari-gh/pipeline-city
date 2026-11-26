import type { Rect } from '../../../cpu/render/core/cpuplan';
import { CONTROL_LINES, WORD_FIELDS } from '../../../cpu/render/die/blockart';
import { gpuDecode, GPU_SPEC_BY_NAME } from '../../sim/isa/isa';

// The decoder's side of a GPU instruction: the control lines it raises, the slots of its word, and the geometry of the decoder block
// (the word strip, the units under its fields, the control lines) that the drawing and the live layer share.

/** An instruction as the control lines read it. */
interface ControlStep {
  name: string;
  kind: string;
  dest: number | null;
}

/** Which control lines an instruction raises: the ALU or memory unit it goes to, a register write, a branch or mask change, an immediate, a system operation. */
export function gpuControlLines(s: ControlStep): Set<string> {
  const out = new Set<string>();
  const memory = s.kind === 'ld' || s.kind === 'st';
  if (s.kind === 'alu') {
    out.add('alu');
  }
  if (memory) {
    out.add('mem');
  }
  if (s.dest !== null) {
    out.add('wr');
  }
  if (s.kind === 'br' || s.kind === 'mask') {
    out.add('br');
  }
  if (s.name.endsWith('i') || s.name === 'vli' || memory) {
    out.add('imm');
  }
  if (s.kind === 'sys') {
    out.add('sys');
  }
  return out;
}

/** A vector register's name. */
const v = (n: number) => `v${n}`;

/** The five slots of the decoder's word strip for a GPU instruction (op, rd, rs1, rs2, imm), '' where the format has none. */
export function gpuSlotValues(word: number): string[] {
  const i = gpuDecode(word);
  if (!i) {
    return ['?', '', '', '', ''];
  }
  const f = GPU_SPEC_BY_NAME.get(i.name)?.fmt;
  return [
    i.name,
    f === 'R' || f === 'I' || f === 'D' ? v(i.rd) : '',
    f === 'R' || f === 'I' || f === 'S' || f === 'M' ? v(i.rs1) : '',
    f === 'R' || f === 'S' || f === 'M' ? v(i.rs2) : '',
    f === 'I' || f === 'S' || f === 'O' ? String(i.imm) : '',
  ];
}

/** Indices into CONTROL_LINES the instruction raises. */
export const gpuControlIndices = (s: ControlStep): number[] => {
  const set = gpuControlLines(s);
  return CONTROL_LINES.flatMap((n, k) => (set.has(n) ? [k] : []));
};

const WORD_BITS = WORD_FIELDS.reduce((n, f) => n + f.bits, 0);
/** The fields of a word strip in proportion to their bits. */
export function fieldRects(r: Rect): Rect[] {
  let fx = r.x;
  return WORD_FIELDS.map((f) => {
    const fw = (r.w * f.bits) / WORD_BITS,
      fr = { x: fx, y: r.y, w: fw, h: r.h };
    fx += fw;
    return fr;
  });
}

/** The geometry of the decoder block. */
interface DecodeGeom {
  word: Rect;
  fields: Rect[];
  lines: Rect[];
  rich: boolean;
  sel: Rect[];
  ctl: Rect;
  sext: Rect;
  busY: number;
}

/** The control lines in one row from `x` to `x + w` at `ly`, each `lh` high. */
const lineRow = (a: Pick<Rect, 'x' | 'w'>, ly: number, lh: number): Rect[] => {
  const n = CONTROL_LINES.length,
    lw = (a.w - (n - 1) * 3) / n;
  return CONTROL_LINES.map((_, k) => ({ x: a.x + k * (lw + 3), y: ly, w: lw, h: lh }));
};

/** The decoder: the word on top; below it, when there is room, the register selects and the sign extender under their fields, the control unit under the op field and the control lines it fans out to. */
export function decodeGeom(a: Rect): DecodeGeom {
  const { x, y, w, h } = a,
    wh = Math.min(14, h * 0.4);
  const rich = h >= 56 && w >= 110,
    lh = 11,
    selH = 11;
  const gap = rich ? Math.max(6, Math.min(26, (h - wh - selH - lh) / 2)) : 0;
  const fields = fieldRects({ x, y, w, h: wh }),
    word = { x, y, w, h: wh };
  if (!rich) {
    const ly = y + wh + 4,
      h1 = Math.max(4, Math.min(11, h - wh - 6));
    return { word, fields, lines: lineRow(a, ly, h1), rich, sel: [], ctl: word, sext: word, busY: ly };
  }
  const ySel = y + wh + gap,
    yLines = ySel + selH + gap,
    box = (f: Rect | undefined): Rect => (f ? { x: f.x + 1, y: ySel, w: f.w - 2, h: selH } : word);
  return {
    word,
    fields,
    rich,
    busY: ySel + selH + gap / 2,
    ctl: box(fields[0]),
    sel: [1, 2, 3].map((k) => box(fields[k])),
    sext: box(fields[4]),
    lines: lineRow(a, yLines, lh),
  };
}
