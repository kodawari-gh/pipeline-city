import { encode, fitsImm17, instr, parseReg, REG_RA, REG_ZERO, SPEC_BY_NAME, type Instr } from "../isa/isa";
import { RAM_BASE } from "../isa/memmap";

export class AsmError extends Error {
  constructor(public line: number, msg: string) {
    super(`line ${line}: ${msg}`);
    this.name = "AsmError";
  }
}

export interface AsmResult {
  /** Program image as little-endian words (data directives included, padded to a word). */
  program: Uint32Array;
  /** Label -> absolute address (origin + byte offset). */
  symbols: Map<string, number>;
}

export interface AsmOptions {
  /** Address the program will be loaded at (affects symbol values and `la`/`.word label`). */
  origin?: number;
}

interface Item {
  line: number;
  off: number;
  mnem: string;
  ops: string[];
  size: number;
}

/** Strip a `#` or `;` comment, ignoring those characters inside quotes. */
function stripComment(s: string): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#" || c === ";") return s.slice(0, i);
  }
  return s;
}

/** Split on commas outside quotes. */
function splitOps(s: string): string[] {
  const out: string[] = [];
  let q: string | null = null;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      cur += c;
      if (c === "\\") cur += s[++i] ?? "";
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === ",") { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  if (cur.trim() !== "" || out.length > 0) out.push(cur.trim());
  return out;
}

const ESC: Record<string, number> = { n: 10, t: 9, r: 13, "0": 0, "\\": 92, '"': 34, "'": 39 };

function parseString(line: number, s: string): number[] {
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') throw new AsmError(line, `expected a "quoted string", got ${s}`);
  const bytes: number[] = [];
  for (let i = 1; i < s.length - 1; i++) {
    let c = s[i]!;
    if (c === "\\") {
      c = s[++i]!;
      const e = ESC[c];
      if (e === undefined) throw new AsmError(line, `unknown escape \\${c}`);
      bytes.push(e);
    } else {
      const code = c.charCodeAt(0);
      if (code > 127) throw new AsmError(line, "only ASCII is supported in strings");
      bytes.push(code);
    }
  }
  return bytes;
}

/** Numeric literal (decimal, 0x, 0b, 'c') or null. */
function parseNum(s: string): number | null {
  if (/^[-+]?(0x[0-9a-f]+|0b[01]+|\d+)$/i.test(s)) {
    const neg = s[0] === "-";
    const body = s.replace(/^[-+]/, "");
    const v = Number(body);
    return neg ? -v : v;
  }
  const m = /^'(\\.|[^\\])'$/.exec(s);
  if (m) {
    const t = m[1]!;
    return t.length === 2 ? (ESC[t[1]!] ?? null) : t.charCodeAt(0);
  }
  return null;
}

/** Split v into hi (21 bits, for lui/auipc) and signed 11-bit lo so that (hi << 11) + lo == v mod 2^32. */
function splitHiLo(v: number): { hi: number; lo: number } {
  const lo = ((v & 0x7ff) ^ 0x400) - 0x400;
  const hi = (((v - lo) >>> 0) >>> 11) & 0x1fffff;
  return { hi, lo };
}

const LI_MIN = -(2 ** 31);
const LI_MAX = 2 ** 32 - 1;

function liSize(v: number): number {
  if (fitsImm17(v)) return 4;
  return splitHiLo(v | 0).lo === 0 ? 4 : 8;
}

const LABEL_RE = /^[A-Za-z_.][\w.]*$/;

export function assemble(src: string, opts: AsmOptions = {}): AsmResult {
  const origin = opts.origin ?? RAM_BASE;
  const symbols = new Map<string, number>();
  const items: Item[] = [];
  let off = 0;

  // ---- pass 1: parse lines, assign offsets, collect labels
  const lines = src.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = n + 1;
    let text = stripComment(lines[n]!).trim();
    for (;;) {
      const m = /^([A-Za-z_.][\w.]*)\s*:\s*(.*)$/.exec(text);
      if (!m) break;
      const name = m[1]!;
      if (symbols.has(name)) throw new AsmError(line, `duplicate label '${name}'`);
      symbols.set(name, origin + off);
      text = m[2]!;
    }
    if (text === "") continue;
    const sp = text.search(/\s/);
    const mnem = (sp < 0 ? text : text.slice(0, sp)).toLowerCase();
    const ops = sp < 0 ? [] : splitOps(text.slice(sp + 1).trim());
    const item: Item = { line, off, mnem, ops, size: 0 };
    item.size = sizeOf(item);
    off += item.size;
    items.push(item);
  }

  function sizeOf(it: Item): number {
    const { line, mnem, ops } = it;
    switch (mnem) {
      case ".string": {
        if (ops.length !== 1) throw new AsmError(line, ".string takes one quoted string");
        return parseString(line, ops[0]!).length + 1;
      }
      case ".byte": return ops.length;
      case ".word":
        requireAligned(it);
        return 4 * ops.length;
      case ".align": return (4 - (it.off % 4)) % 4;
      case "li": {
        if (ops.length !== 2) throw new AsmError(line, "li takes: rd, number");
        const v = parseNum(ops[1]!);
        if (v === null) throw new AsmError(line, "li needs a numeric literal (use la for labels)");
        if (v < LI_MIN || v > LI_MAX) throw new AsmError(line, `li value ${v} does not fit in 32 bits`);
        requireAligned(it);
        return liSize(v);
      }
      case "la":
        requireAligned(it);
        return 8;
      default:
        if (mnem.startsWith(".")) throw new AsmError(line, `unknown directive '${mnem}'`);
        if (!SPEC_BY_NAME.has(mnem) && !["mv", "j", "ret", "nop", "call"].includes(mnem)) {
          throw new AsmError(line, `unknown instruction '${mnem}'`);
        }
        requireAligned(it);
        return 4;
    }
  }

  function requireAligned(it: Item): void {
    if (it.off % 4 !== 0) throw new AsmError(it.line, "misaligned after data; add .align");
  }

  // ---- pass 2: emit
  const total = Math.ceil(off / 4) * 4;
  const bytes = new Uint8Array(total);
  const dv = new DataView(bytes.buffer);

  for (const it of items) {
    const { line, mnem, ops } = it;
    const addr = origin + it.off;
    const reg = (s: string | undefined): number => {
      if (s === undefined) throw new AsmError(line, `${mnem}: missing operand`);
      const r = parseReg(s);
      if (r < 0) throw new AsmError(line, `${mnem}: '${s}' is not a register`);
      return r;
    };
    const num = (s: string | undefined): number => {
      if (s === undefined) throw new AsmError(line, `${mnem}: missing operand`);
      const v = parseNum(s);
      if (v === null) throw new AsmError(line, `${mnem}: '${s}' is not a number`);
      return v;
    };
    const sym = (s: string): number => {
      const v = symbols.get(s);
      if (v === undefined) throw new AsmError(line, `undefined label '${s}'`);
      return v;
    };
    /** Absolute value: number or label. */
    const value = (s: string): number => {
      const v = parseNum(s);
      if (v !== null) return v;
      if (LABEL_RE.test(s)) return sym(s);
      throw new AsmError(line, `bad value '${s}'`);
    };
    /** Branch/jump operand: label (made relative to this instruction at pc) or a raw byte offset. */
    const target = (s: string | undefined, pc: number): number => {
      if (s === undefined) throw new AsmError(line, `${mnem}: missing operand`);
      const v = parseNum(s);
      if (v !== null) return v;
      if (LABEL_RE.test(s) && parseReg(s) < 0) return sym(s) - pc;
      throw new AsmError(line, `${mnem}: bad target '${s}'`);
    };
    const arity = (n: number): void => {
      if (ops.length !== n) throw new AsmError(line, `${mnem} takes ${n} operand(s), got ${ops.length}`);
    };
    const memOp = (s: string | undefined): { imm: number; rs1: number } => {
      const m = s === undefined ? null : /^(.*)\(\s*(\w+)\s*\)$/.exec(s);
      if (!m) throw new AsmError(line, `${mnem}: expected imm(reg), got '${s ?? ""}'`);
      const t = m[1]!.trim();
      return { imm: t === "" ? 0 : num(t), rs1: reg(m[2]) };
    };

    if (mnem === ".string" || mnem === ".byte" || mnem === ".word" || mnem === ".align") {
      if (mnem === ".string") bytes.set([...parseString(line, ops[0]!), 0], it.off);
      else if (mnem === ".byte") {
        ops.forEach((o, k) => {
          const v = num(o);
          if (v < -128 || v > 255) throw new AsmError(line, `.byte value ${v} out of range`);
          bytes[it.off + k] = v & 0xff;
        });
      } else if (mnem === ".word") {
        ops.forEach((o, k) => {
          const v = value(o);
          if (v < LI_MIN || v > LI_MAX) throw new AsmError(line, `.word value ${v} does not fit in 32 bits`);
          dv.setUint32(it.off + 4 * k, v >>> 0, true);
        });
      }
      continue;
    }

    const out: Instr[] = [];
    try {
      switch (mnem) {
        case "nop": arity(0); out.push(instr("addi")); break;
        case "ret": arity(0); out.push(instr("jalr", { rd: REG_ZERO, rs1: REG_RA })); break;
        case "mv": arity(2); out.push(instr("addi", { rd: reg(ops[0]), rs1: reg(ops[1]) })); break;
        case "j": arity(1); out.push(instr("jal", { rd: REG_ZERO, imm: target(ops[0], addr) })); break;
        case "call": arity(1); out.push(instr("jal", { rd: REG_RA, imm: target(ops[0], addr) })); break;
        case "li": {
          const rd = reg(ops[0]);
          const v = parseNum(ops[1]!)!;
          if (fitsImm17(v)) out.push(instr("addi", { rd, imm: v }));
          else {
            const { hi, lo } = splitHiLo(v | 0);
            out.push(instr("lui", { rd, imm: hi }));
            if (lo !== 0) out.push(instr("addi", { rd, rs1: rd, imm: lo }));
          }
          break;
        }
        case "la": {
          arity(2);
          const rd = reg(ops[0]);
          const s = ops[1]!;
          if (!LABEL_RE.test(s)) throw new AsmError(line, "la needs a label");
          const { hi, lo } = splitHiLo(sym(s) - addr);
          out.push(instr("auipc", { rd, imm: hi }), instr("addi", { rd, rs1: rd, imm: lo }));
          break;
        }
        default: {
          const spec = SPEC_BY_NAME.get(mnem)!;
          switch (spec.fmt) {
            case "N": arity(0); out.push(instr(mnem)); break;
            case "R": arity(3); out.push(instr(mnem, { rd: reg(ops[0]), rs1: reg(ops[1]), rs2: reg(ops[2]) })); break;
            case "I":
              if (spec.mem) {
                arity(2);
                const m = memOp(ops[1]);
                out.push(instr(mnem, { rd: reg(ops[0]), rs1: m.rs1, imm: m.imm }));
              } else {
                arity(3);
                out.push(instr(mnem, { rd: reg(ops[0]), rs1: reg(ops[1]), imm: num(ops[2]) }));
              }
              break;
            case "S": {
              arity(2);
              const m = memOp(ops[1]);
              out.push(instr(mnem, { rs2: reg(ops[0]), rs1: m.rs1, imm: m.imm }));
              break;
            }
            case "B": arity(3); out.push(instr(mnem, { rs1: reg(ops[0]), rs2: reg(ops[1]), imm: target(ops[2], addr) })); break;
            case "U": arity(2); out.push(instr(mnem, { rd: reg(ops[0]), imm: num(ops[1]) })); break;
            case "J": arity(2); out.push(instr(mnem, { rd: reg(ops[0]), imm: target(ops[1], addr) })); break;
          }
        }
      }
      out.forEach((i, k) => dv.setUint32(it.off + 4 * k, encode(i), true));
    } catch (e) {
      if (e instanceof AsmError) throw e;
      if (e instanceof RangeError) throw new AsmError(line, e.message);
      throw e;
    }
  }

  const program = new Uint32Array(total / 4);
  for (let k = 0; k < program.length; k++) program[k] = dv.getUint32(4 * k, true);
  return { program, symbols };
}
