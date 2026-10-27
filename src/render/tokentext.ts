import { decode, REG_NAMES, SPEC_BY_NAME } from '../sim/isa';

// What an instruction's token shows at each stage of its trip (docs/DIE.md "The token"): the raw word when it is fetched, its fields when it is
// decoded, the values it works on when it executes, the address it reaches for, the value it writes. Pure, so it is testable; dieview.ts draws it.

export interface TokenCtx {
  word: number;
  /** The registers as they are at the cycle shown. */
  regs: readonly number[];
  /** The address a load or store reached for, when it has been seen. */
  addr?: number;
}

/** One field of the instruction word, `bits` wide in the encoding. */
export interface Field { name: string; value: string; bits: number }
export interface Body { fields?: Field[]; text?: string }

const hex = (v: number, w = 1) => '0x' + (v >>> 0).toString(16).padStart(w, '0');
const reg = (n: number) => REG_NAMES[n] ?? 'x' + n;
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

/** What the token shows in `stage` (F D X M W in order, F D S X R C out of order, x flushed). */
export function bodyOf(stage: string, c: TokenCtx): Body {
  const i = decode(c.word);
  switch (stage) {
    case 'F': return { text: hex(c.word, 8) };
    case 'D': return { fields: fieldsOf(c.word) };
    case 'S': return { text: 'waits for ' + (readsOf(c.word).filter((r) => r !== 0).map(reg).join(' ') || 'nothing') };
    case 'X': {
      const rs = readsOf(c.word);
      const vals = rs.map((r) => `${reg(r)}=${r === 0 ? 0 : (c.regs[r] ?? 0) | 0}`);
      if (i && SPEC_BY_NAME.get(i.name)?.fmt === 'I') vals.push(String(i.imm));
      return { text: vals.join('  ') || '·' };
    }
    case 'M': return { text: c.addr !== undefined ? '[' + hex(c.addr, 4) + ']' : '·' };
    case 'R': return { text: 'result on the bus' };
    case 'W': case 'C': {
      const w = writesOf(c.word);
      if (w >= 0) return { text: `${reg(w)} ← ${hex(c.regs[w] ?? 0)}` };
      return { text: i && (i.name === 'sw' || i.name === 'sb') ? 'stored' : 'done' };
    }
    case 'x': return { text: 'flushed' };
    default: return { text: '' };
  }
}
