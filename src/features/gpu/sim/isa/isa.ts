// GPU ISA (docs/ACCEL.md "GPU"): a second, small instruction set on the same 32-bit word framework as the CPU's (isa.ts).
// One program runs on N lanes in lockstep. 8 vector registers v0..v7 (each holds one 32-bit value per lane), an execution
// mask (bit n = lane n is active), a mask stack for divergence, and word memory on the card.
//
// Bit layout (op in [6:0] everywhere, fields in the same places as the CPU's R/I/S formats):
//   R: rd[10:7] rs1[14:11] rs2[18:15]                        vector ALU: vd = vs1 op vs2
//   I: rd[10:7] rs1[14:11] imm[31:15]   (17-bit signed)      vd = vs1 op imm; vli splats imm; vld is a gather from vs1 + imm
//   D: rd[10:7]                                              lane: vd = lane id
//   S: immLo[10:7] rs1[14:11] rs2[18:15] immHi[31:19]        vst: memory[vs1 + imm] = vs2 (a scatter)
//   M: rs1[14:11] rs2[18:15]                                 mask set: mask &= (vs1 cmp vs2), per lane
//   O: imm[31:11] (21-bit signed byte offset, multiple of 4) bany / jmp, relative to the instruction
//   N: no operands
//
// Only the active lanes run an instruction. Divergence is real: both sides of an `if` run, under the mask
// (`mpush`, a mask set, the then-side, `melse`, the else-side, `mpop`). `bany` branches when any lane is still active,
// which is how a loop runs until its last lane is done.

export type GpuFormat = "R" | "I" | "D" | "S" | "M" | "O" | "N";

export interface GpuOpSpec {
  name: string;
  op: number;
  fmt: GpuFormat;
  /** I-format memory op: assembler syntax is `vd, imm(vs)`. */
  mem?: boolean;
  /** I-format shift: the immediate is a shift amount 0..31. */
  shift?: boolean;
}

export const GPU_OPS: readonly GpuOpSpec[] = [
  { name: "vadd", op: 0x01, fmt: "R" },
  { name: "vsub", op: 0x02, fmt: "R" },
  { name: "vand", op: 0x03, fmt: "R" },
  { name: "vor", op: 0x04, fmt: "R" },
  { name: "vxor", op: 0x05, fmt: "R" },
  { name: "vsll", op: 0x06, fmt: "R" },
  { name: "vsrl", op: 0x07, fmt: "R" },
  { name: "vsra", op: 0x08, fmt: "R" },
  { name: "vslt", op: 0x09, fmt: "R" },
  { name: "vmul", op: 0x0b, fmt: "R" },
  { name: "vmin", op: 0x0c, fmt: "R" },
  { name: "vmax", op: 0x0d, fmt: "R" },
  { name: "vaddi", op: 0x10, fmt: "I" },
  { name: "vandi", op: 0x11, fmt: "I" },
  { name: "vslli", op: 0x14, fmt: "I", shift: true },
  { name: "vsrli", op: 0x15, fmt: "I", shift: true },
  { name: "vsrai", op: 0x16, fmt: "I", shift: true },
  { name: "vli", op: 0x18, fmt: "I" },
  { name: "lane", op: 0x21, fmt: "D" },
  { name: "vld", op: 0x20, fmt: "I", mem: true },
  { name: "vst", op: 0x28, fmt: "S" },
  { name: "mseteq", op: 0x30, fmt: "M" },
  { name: "msetne", op: 0x31, fmt: "M" },
  { name: "msetlt", op: 0x32, fmt: "M" },
  { name: "msetge", op: 0x33, fmt: "M" },
  { name: "mpush", op: 0x38, fmt: "N" },
  { name: "mpop", op: 0x39, fmt: "N" },
  { name: "melse", op: 0x3a, fmt: "N" },
  { name: "bar", op: 0x3b, fmt: "N" },
  { name: "bany", op: 0x40, fmt: "O" },
  { name: "jmp", op: 0x41, fmt: "O" },
  { name: "halt", op: 0x7f, fmt: "N" },
];

export const GPU_SPEC_BY_NAME = new Map<string, GpuOpSpec>(GPU_OPS.map((s) => [s.name, s]));
const SPEC_BY_OP = new Map<number, GpuOpSpec>(GPU_OPS.map((s) => [s.op, s]));

export const GPU_REG_COUNT = 8;
/** Deepest `mpush` nesting. */
export const GPU_MASK_DEPTH = 8;

/** Parse "v3"; -1 if not a vector register. */
export function parseVReg(s: string): number {
  const m = /^v([0-7])$/.exec(s);
  return m ? Number(m[1]) : -1;
}

export interface GpuInstr { name: string; rd: number; rs1: number; rs2: number; imm: number }

export function gpuInstr(name: string, f: Partial<Omit<GpuInstr, "name">> = {}): GpuInstr {
  return { name, rd: 0, rs1: 0, rs2: 0, imm: 0, ...f };
}

const IMM17_MIN = -(1 << 16);
const IMM17_MAX = (1 << 16) - 1;
const IMM21_MIN = -(1 << 20);

const checkReg = (n: number, what: string): void => {
  if (!Number.isInteger(n) || n < 0 || n >= GPU_REG_COUNT) throw new RangeError(`bad ${what} vector register ${n}`);
};
const checkImm17 = (name: string, v: number): void => {
  if (!Number.isInteger(v) || v < IMM17_MIN || v > IMM17_MAX) throw new RangeError(`${name}: immediate ${v} out of 17-bit signed range`);
};

/** Encode to a Uint32 word. Throws RangeError on out-of-range fields. */
export function gpuEncode(i: GpuInstr): number {
  const spec = GPU_SPEC_BY_NAME.get(i.name);
  if (!spec) throw new RangeError(`unknown GPU instruction '${i.name}'`);
  const { rd, rs1, rs2, imm } = i;
  let w = spec.op;
  switch (spec.fmt) {
    case "N": break;
    case "R":
      checkReg(rd, "rd"); checkReg(rs1, "rs1"); checkReg(rs2, "rs2");
      w |= (rd << 7) | (rs1 << 11) | (rs2 << 15);
      break;
    case "I":
      checkReg(rd, "rd"); checkReg(rs1, "rs1"); checkImm17(i.name, imm);
      if (spec.shift && (imm < 0 || imm > 31)) throw new RangeError(`${i.name}: shift amount ${imm} not in 0..31`);
      w |= (rd << 7) | (rs1 << 11) | ((imm & 0x1ffff) << 15);
      break;
    case "D":
      checkReg(rd, "rd");
      w |= rd << 7;
      break;
    case "S": {
      checkReg(rs1, "rs1"); checkReg(rs2, "rs2"); checkImm17(i.name, imm);
      const u = imm & 0x1ffff;
      w |= ((u & 0xf) << 7) | (rs1 << 11) | (rs2 << 15) | ((u >>> 4) << 19);
      break;
    }
    case "M":
      checkReg(rs1, "rs1"); checkReg(rs2, "rs2");
      w |= (rs1 << 11) | (rs2 << 15);
      break;
    case "O":
      if (!Number.isInteger(imm) || imm < IMM21_MIN || imm >= -IMM21_MIN) throw new RangeError(`${i.name}: offset ${imm} out of 21-bit signed range`);
      if (imm % 4 !== 0) throw new RangeError(`${i.name}: offset ${imm} not a multiple of 4`);
      w |= (imm & 0x1fffff) << 11;
      break;
  }
  return w >>> 0;
}

/** Decode a word; null if the opcode is illegal or a register field is out of range. */
export function gpuDecode(word: number): GpuInstr | null {
  const w = word | 0;
  const spec = SPEC_BY_OP.get(w & 0x7f);
  if (!spec) return null;
  const rd = (w >>> 7) & 0xf, rs1 = (w >>> 11) & 0xf, rs2 = (w >>> 15) & 0xf;
  switch (spec.fmt) {
    case "N": return gpuInstr(spec.name);
    case "R": return rd < 8 && rs1 < 8 && rs2 < 8 ? gpuInstr(spec.name, { rd, rs1, rs2 }) : null;
    case "I": return rd < 8 && rs1 < 8 ? gpuInstr(spec.name, { rd, rs1, imm: w >> 15 }) : null;
    case "D": return rd < 8 ? gpuInstr(spec.name, { rd }) : null;
    case "S": return rs1 < 8 && rs2 < 8 ? gpuInstr(spec.name, { rs1, rs2, imm: ((w >> 19) << 4) | ((w >>> 7) & 0xf) }) : null;
    case "M": return rs1 < 8 && rs2 < 8 ? gpuInstr(spec.name, { rs1, rs2 }) : null;
    case "O": return gpuInstr(spec.name, { imm: w >> 11 });
  }
}

/** Word -> mnemonic text, in the syntax `assembleGpu` accepts (branch offsets are raw byte offsets). */
export function gpuDisassemble(word: number): string {
  const i = gpuDecode(word);
  if (!i) return `.word 0x${(word >>> 0).toString(16).padStart(8, "0")}`;
  const spec = GPU_SPEC_BY_NAME.get(i.name)!;
  const v = (n: number) => `v${n}`;
  switch (spec.fmt) {
    case "N": return i.name;
    case "R": return `${i.name} ${v(i.rd)}, ${v(i.rs1)}, ${v(i.rs2)}`;
    case "I":
      if (spec.mem) return `${i.name} ${v(i.rd)}, ${i.imm}(${v(i.rs1)})`;
      return i.name === "vli" ? `${i.name} ${v(i.rd)}, ${i.imm}` : `${i.name} ${v(i.rd)}, ${v(i.rs1)}, ${i.imm}`;
    case "D": return `${i.name} ${v(i.rd)}`;
    case "S": return `${i.name} ${v(i.rs2)}, ${i.imm}(${v(i.rs1)})`;
    case "M": return `${i.name} ${v(i.rs1)}, ${v(i.rs2)}`;
    case "O": return `${i.name} ${i.imm}`;
  }
}
