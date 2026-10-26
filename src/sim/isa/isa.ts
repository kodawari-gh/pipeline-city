// Toy ISA: 32-bit words, 16 registers, RISC-V-like formats with our own opcodes.
//
// Bit layout (every format has op in [6:0]):
//   R: rd[10:7] rs1[14:11] rs2[18:15]                       (rest zero)
//   I: rd[10:7] rs1[14:11] imm[31:15]   (17-bit signed)
//   S: immLo[10:7] rs1[14:11] rs2[18:15] immHi[31:19]  (17-bit signed = hi<<4|lo)
//   B: same as S; imm is a byte offset from the branch, multiple of 4
//   U: rd[10:7] imm[31:11]              (21 bits; lui: rd = imm << 11)
//   J: rd[10:7] imm[31:11]              (21-bit signed byte offset, multiple of 4)
//   N: no operands (ecall, iret)

export type Format = "R" | "I" | "S" | "B" | "U" | "J" | "N";

export interface OpSpec {
  name: string;
  op: number;
  fmt: Format;
  /** I-format load: assembler syntax is `rd, imm(rs1)`. */
  mem?: boolean;
  /** I-format shift: immediate is a shift amount 0..31. */
  shift?: boolean;
}

export const OPS: readonly OpSpec[] = [
  { name: "add", op: 0x01, fmt: "R" },
  { name: "sub", op: 0x02, fmt: "R" },
  { name: "and", op: 0x03, fmt: "R" },
  { name: "or", op: 0x04, fmt: "R" },
  { name: "xor", op: 0x05, fmt: "R" },
  { name: "sll", op: 0x06, fmt: "R" },
  { name: "srl", op: 0x07, fmt: "R" },
  { name: "sra", op: 0x08, fmt: "R" },
  { name: "slt", op: 0x09, fmt: "R" },
  { name: "sltu", op: 0x0a, fmt: "R" },
  { name: "mul", op: 0x0b, fmt: "R" },
  { name: "addi", op: 0x10, fmt: "I" },
  { name: "andi", op: 0x11, fmt: "I" },
  { name: "ori", op: 0x12, fmt: "I" },
  { name: "xori", op: 0x13, fmt: "I" },
  { name: "slli", op: 0x14, fmt: "I", shift: true },
  { name: "srli", op: 0x15, fmt: "I", shift: true },
  { name: "srai", op: 0x16, fmt: "I", shift: true },
  { name: "slti", op: 0x17, fmt: "I" },
  { name: "sltiu", op: 0x18, fmt: "I" },
  { name: "jalr", op: 0x19, fmt: "I" },
  { name: "lw", op: 0x20, fmt: "I", mem: true },
  { name: "lb", op: 0x21, fmt: "I", mem: true },
  { name: "lbu", op: 0x22, fmt: "I", mem: true },
  { name: "sw", op: 0x28, fmt: "S" },
  { name: "sb", op: 0x29, fmt: "S" },
  { name: "beq", op: 0x30, fmt: "B" },
  { name: "bne", op: 0x31, fmt: "B" },
  { name: "blt", op: 0x32, fmt: "B" },
  { name: "bge", op: 0x33, fmt: "B" },
  { name: "bltu", op: 0x34, fmt: "B" },
  { name: "bgeu", op: 0x35, fmt: "B" },
  { name: "lui", op: 0x38, fmt: "U" },
  { name: "auipc", op: 0x39, fmt: "U" },
  { name: "jal", op: 0x40, fmt: "J" },
  { name: "ecall", op: 0x70, fmt: "N" },
  // Return from an interrupt handler: pc = the interrupt controller's EPC, interrupts back on (docs/CPU.md).
  { name: "iret", op: 0x71, fmt: "N" },
];

export const SPEC_BY_NAME = new Map<string, OpSpec>(OPS.map((s) => [s.name, s]));
const SPEC_BY_OP = new Map<number, OpSpec>(OPS.map((s) => [s.op, s]));

export const REG_COUNT = 16;
export const REG_ZERO = 0;
export const REG_RA = 1; // link register
export const REG_SP = 2; // stack pointer
/** a0-a3 args/results, t0-t4 temporaries, s0-s3 saved. */
export const REG_NAMES = [
  "zero", "ra", "sp", "a0", "a1", "a2", "a3",
  "t0", "t1", "t2", "t3", "t4", "s0", "s1", "s2", "s3",
] as const;

/** Parse "a0" / "x3"; returns -1 if not a register. */
export function parseReg(s: string): number {
  const i = (REG_NAMES as readonly string[]).indexOf(s);
  if (i >= 0) return i;
  const m = /^x(\d+)$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n < REG_COUNT) return n;
  }
  return -1;
}

export interface Instr {
  name: string;
  rd: number;
  rs1: number;
  rs2: number;
  imm: number;
}

/** Instruction with unused fields defaulting to 0. */
export function instr(name: string, f: Partial<Omit<Instr, "name">> = {}): Instr {
  return { name, rd: 0, rs1: 0, rs2: 0, imm: 0, ...f };
}

const IMM17_MIN = -(1 << 16);
const IMM17_MAX = (1 << 16) - 1;
const IMM21_MIN = -(1 << 20);

export function fitsImm17(v: number): boolean {
  return Number.isInteger(v) && v >= IMM17_MIN && v <= IMM17_MAX;
}

function checkReg(n: number, what: string): void {
  if (!Number.isInteger(n) || n < 0 || n >= REG_COUNT) throw new RangeError(`bad ${what} register ${n}`);
}

/** Encode to a Uint32 word. Throws RangeError on out-of-range fields. */
export function encode(i: Instr): number {
  const spec = SPEC_BY_NAME.get(i.name);
  if (!spec) throw new RangeError(`unknown instruction '${i.name}'`);
  const { rd, rs1, rs2, imm } = i;
  let w = spec.op;
  switch (spec.fmt) {
    case "N":
      break;
    case "R":
      checkReg(rd, "rd"); checkReg(rs1, "rs1"); checkReg(rs2, "rs2");
      w |= (rd << 7) | (rs1 << 11) | (rs2 << 15);
      break;
    case "I":
      checkReg(rd, "rd"); checkReg(rs1, "rs1");
      if (!fitsImm17(imm)) throw new RangeError(`${i.name}: immediate ${imm} out of 17-bit signed range`);
      if (spec.shift && (imm < 0 || imm > 31)) throw new RangeError(`${i.name}: shift amount ${imm} not in 0..31`);
      w |= (rd << 7) | (rs1 << 11) | ((imm & 0x1ffff) << 15);
      break;
    case "S":
    case "B": {
      checkReg(rs1, "rs1"); checkReg(rs2, "rs2");
      if (!fitsImm17(imm)) throw new RangeError(`${i.name}: immediate ${imm} out of 17-bit signed range`);
      if (spec.fmt === "B" && imm % 4 !== 0) throw new RangeError(`${i.name}: branch offset ${imm} not a multiple of 4`);
      const u = imm & 0x1ffff;
      w |= ((u & 0xf) << 7) | (rs1 << 11) | (rs2 << 15) | ((u >>> 4) << 19);
      break;
    }
    case "U":
      checkReg(rd, "rd");
      if (!Number.isInteger(imm) || imm < IMM21_MIN || imm > 0x1fffff) throw new RangeError(`${i.name}: immediate ${imm} out of 21-bit range`);
      w |= (rd << 7) | ((imm & 0x1fffff) << 11);
      break;
    case "J":
      checkReg(rd, "rd");
      if (!Number.isInteger(imm) || imm < IMM21_MIN || imm >= -IMM21_MIN) throw new RangeError(`${i.name}: offset ${imm} out of 21-bit signed range`);
      if (imm % 4 !== 0) throw new RangeError(`${i.name}: offset ${imm} not a multiple of 4`);
      w |= (rd << 7) | ((imm & 0x1fffff) << 11);
      break;
  }
  return w >>> 0;
}

/** Decode a word; null if the opcode is illegal. U-format imm is returned unsigned (0..0x1fffff). */
export function decode(word: number): Instr | null {
  const w = word | 0;
  const spec = SPEC_BY_OP.get(w & 0x7f);
  if (!spec) return null;
  const rd = (w >>> 7) & 0xf;
  const rs1 = (w >>> 11) & 0xf;
  const rs2 = (w >>> 15) & 0xf;
  switch (spec.fmt) {
    case "N": return instr(spec.name);
    case "R": return instr(spec.name, { rd, rs1, rs2 });
    case "I": return instr(spec.name, { rd, rs1, imm: w >> 15 });
    case "S":
    case "B": return instr(spec.name, { rs1, rs2, imm: ((w >> 19) << 4) | ((w >>> 7) & 0xf) });
    case "U": return instr(spec.name, { rd, imm: w >>> 11 });
    case "J": return instr(spec.name, { rd, imm: w >> 11 });
  }
}
