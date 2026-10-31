import { decode, REG_NAMES, SPEC_BY_NAME } from '../../sim/isa';

// What the die shows of one instruction (docs/DIE.md "Instructions on the die"): its address, its own colour, the fields of its word, the
// registers it reads and writes. Pure, so it is testable; blockart.ts and dieview.ts draw it.

/** One field of the instruction word, `bits` wide in the encoding. */
export interface Field { name: string; value: string; bits: number }

const hex = (v: number, w = 1) => '0x' + (v >>> 0).toString(16).padStart(w, '0');
export const regName = (n: number): string => REG_NAMES[n] ?? 'x' + n;
const reg = regName;
/** An address as the token's reference: `@c5a0`. */
export const pcText = (pc: number): string => '@' + (pc >>> 0).toString(16).padStart(4, '0');
/** A short number that tells apart two runs of the same instruction (a loop body): the instruction's sequence number. */
export const seqText = (id: number): string => '#' + id;

/** A colour that belongs to one instruction (its ring and its pips in the queues): a hue by sequence number. */
export function idColor(id: number, dark: boolean): string {
  const h = ((id * 47) % 360) / 360, s = 0.85, l = dark ? 0.62 : 0.42;
  const f = (n: number) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  const c = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + c(f(0)) + c(f(8)) + c(f(4));
}

/** The registers an instruction reads, in order. */
export function readsOf(word: number): number[] {
  const i = decode(word);
  if (!i) return [];
  switch (SPEC_BY_NAME.get(i.name)?.fmt) {
    case 'R': case 'S': case 'B': return [i.rs1, i.rs2];
    case 'I': return [i.rs1];
    default: return [];
  }
}

/** The register an instruction writes, or -1. */
export function writesOf(word: number): number {
  const i = decode(word);
  if (!i) return -1;
  const f = SPEC_BY_NAME.get(i.name)?.fmt;
  return (f === 'R' || f === 'I' || f === 'U' || f === 'J') && i.rd !== 0 ? i.rd : -1;
}

/** The fields of a word as the decoder splits it. */
export function fieldsOf(word: number): Field[] {
  const i = decode(word);
  if (!i) return [{ name: 'word', value: hex(word, 8), bits: 32 }];
  const op: Field = { name: 'op', value: i.name, bits: 7 };
  switch (SPEC_BY_NAME.get(i.name)?.fmt) {
    case 'R': return [op, { name: 'rd', value: reg(i.rd), bits: 4 }, { name: 'rs1', value: reg(i.rs1), bits: 4 }, { name: 'rs2', value: reg(i.rs2), bits: 4 }];
    case 'I': return [op, { name: 'rd', value: reg(i.rd), bits: 4 }, { name: 'rs1', value: reg(i.rs1), bits: 4 }, { name: 'imm', value: String(i.imm), bits: 13 }];
    case 'S': case 'B': return [op, { name: 'rs1', value: reg(i.rs1), bits: 4 }, { name: 'rs2', value: reg(i.rs2), bits: 4 }, { name: 'imm', value: String(i.imm), bits: 13 }];
    case 'U': case 'J': return [op, { name: 'rd', value: reg(i.rd), bits: 4 }, { name: 'imm', value: String(i.imm), bits: 13 }];
    default: return [op];
  }
}


/** The five slots of the decoder's word strip (op, rd, rs1, rs2, imm), each with what the instruction has there ('' when the format has none). */
export function slotValues(word: number): string[] {
  const i = decode(word);
  if (!i) return ['?', '', '', '', ''];
  const f = SPEC_BY_NAME.get(i.name)?.fmt;
  return [i.name, f === 'R' || f === 'I' || f === 'U' || f === 'J' ? reg(i.rd) : '', f === 'R' || f === 'I' || f === 'S' || f === 'B' ? reg(i.rs1) : '', f === 'R' || f === 'S' || f === 'B' ? reg(i.rs2) : '', f === 'N' || f === 'R' ? '' : String(i.imm)];
}
