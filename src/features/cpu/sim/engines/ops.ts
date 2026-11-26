// The op tables and execute semantics of the timed engines: opcode numbers, per-opcode class flags, the ALU and the branch condition.
// Split out of the engines' shared module (#133).

import { OPS, SPEC_BY_NAME } from '../isa/isa';
import type { InstrPool } from './pool';

/** The opcode of the op named `name` (every name used here is in the ISA). */
function opc(name: string): number {
  const spec = SPEC_BY_NAME.get(name);
  if (spec === undefined) {
    throw new RangeError(`the ISA has no op named ${name}`);
  }
  return spec.op;
}
const ADD = opc('add'),
  SUB = opc('sub'),
  AND = opc('and'),
  OR = opc('or'),
  XOR = opc('xor');
const SLL = opc('sll'),
  SRL = opc('srl'),
  SRA = opc('sra'),
  SLT = opc('slt'),
  SLTU = opc('sltu'),
  MUL = opc('mul');
const ADDI = opc('addi'),
  ANDI = opc('andi'),
  ORI = opc('ori'),
  XORI = opc('xori');
const SLLI = opc('slli'),
  SRLI = opc('srli'),
  SRAI = opc('srai'),
  SLTI = opc('slti'),
  SLTIU = opc('sltiu');
const LW = opc('lw'),
  LB = opc('lb'),
  SW = opc('sw');
const AMOADD = opc('amoadd');
const BEQ = opc('beq'),
  BNE = opc('bne'),
  BLT = opc('blt'),
  BGE = opc('bge'),
  BLTU = opc('bltu');
const LUI = opc('lui'),
  AUIPC = opc('auipc');
export const OP_ECALL = opc('ecall');
export const OP_IRET = opc('iret');
export const OP_MUL = MUL;
export const OP_SW = SW;
export const OP_LW = LW;
export const OP_LB = LB;
export const OP_AMOADD = AMOADD;

/** `x` as a signed 32-bit integer (the ISA's register values): the low 32 bits, two's complement. */
export function toInt32(x: number): number {
  const u = x >>> 0;
  return u > 0x7f_ff_ff_ff ? u - 2 ** 32 : u;
}

/** Per-opcode class flags (indexed by the 7-bit opcode). */
export const F = { Writes: 1, Rs1: 2, Rs2: 4, Load: 8, Store: 16, Branch: 32, Jal: 64, Jalr: 128, Amo: 256 } as const;
export const F_MEM = F.Load | F.Store;
/** The class flags each instruction format gives. */
const FMT_FLAGS = {
  R: F.Writes | F.Rs1 | F.Rs2,
  I: F.Writes | F.Rs1,
  S: F.Rs1 | F.Rs2 | F.Store,
  B: F.Rs1 | F.Rs2 | F.Branch,
  U: F.Writes,
  J: F.Writes | F.Jal,
  N: 0,
} as const;
export const OPF = new Uint16Array(128);
for (const s of OPS) {
  const mem = s.mem === true ? F.Load : 0;
  // an atomic is both: the load-use hazard of a load, the shared port and the store ordering of a store
  const amo = s.amo === true ? F.Load | F.Store | F.Amo : 0;
  // iret is a register-less jump to the interrupt controller's EPC
  const jump = s.name === 'jalr' || s.name === 'iret' ? F.Jalr : 0;
  OPF[s.op] = FMT_FLAGS[s.fmt] | mem | amo | jump;
}

/** Which ALU group an opcode is in (0: none, the ALU gives 0). */
const ALU_REG = 1,
  ALU_IMM = 2,
  ALU_UPPER = 3;
const ALU_GROUP = new Uint8Array(128);
for (const op of [ADD, SUB, AND, OR, XOR, SLL, SRL, SRA, SLT, SLTU, MUL]) {
  ALU_GROUP[op] = ALU_REG;
}
for (const op of [ADDI, ANDI, ORI, XORI, SLLI, SRLI, SRAI, SLTI, SLTIU]) {
  ALU_GROUP[op] = ALU_IMM;
}
for (const op of [LUI, AUIPC]) {
  ALU_GROUP[op] = ALU_UPPER;
}

/** The register-register ops. */
function aluReg(op: number, a: number, b: number): number {
  switch (op) {
    case ADD: {
      return a + b;
    }
    case SUB: {
      return a - b;
    }
    case AND: {
      return a & b;
    }
    case OR: {
      return a | b;
    }
    case XOR: {
      return a ^ b;
    }
    case SLL: {
      return a << (b & 31);
    }
    case SRL: {
      return a >>> (b & 31);
    }
    case SRA: {
      return a >> (b & 31);
    }
    case SLT: {
      return a < b ? 1 : 0;
    }
    case SLTU: {
      return a >>> 0 < b >>> 0 ? 1 : 0;
    }
    case MUL: {
      return Math.imul(a, b);
    }
    default: {
      return 0;
    }
  }
}

/** The register-immediate ops. */
function aluImm(op: number, a: number, imm: number): number {
  switch (op) {
    case ADDI: {
      return a + imm;
    }
    case ANDI: {
      return a & imm;
    }
    case ORI: {
      return a | imm;
    }
    case XORI: {
      return a ^ imm;
    }
    case SLLI: {
      return a << imm;
    }
    case SRLI: {
      return a >>> imm;
    }
    case SRAI: {
      return a >> imm;
    }
    case SLTI: {
      return a < imm ? 1 : 0;
    }
    case SLTIU: {
      return a >>> 0 < imm >>> 0 ? 1 : 0;
    }
    default: {
      return 0;
    }
  }
}

/** The upper-immediate ops. */
function aluUpper(op: number, imm: number, pc: number): number {
  switch (op) {
    case LUI: {
      return imm << 11;
    }
    case AUIPC: {
      return pc + (imm << 11);
    }
    default: {
      return 0;
    }
  }
}

/** ALU / address-generation result for the non-branch op in pool slot `s`, from its operands (semantics identical to src/sim/ref). */
export function alu(p: InstrPool, s: number): number {
  const op = p.op[s] ?? 0;
  switch (ALU_GROUP[op] ?? 0) {
    case ALU_REG: {
      return aluReg(op, p.a[s] ?? 0, p.b[s] ?? 0);
    }
    case ALU_IMM: {
      return aluImm(op, p.a[s] ?? 0, p.imm[s] ?? 0);
    }
    case ALU_UPPER: {
      return aluUpper(op, p.imm[s] ?? 0, p.pc[s] ?? 0);
    }
    default: {
      return 0;
    }
  }
}

export function branchTaken(op: number, a: number, b: number): boolean {
  switch (op) {
    case BEQ: {
      return a === b;
    }
    case BNE: {
      return a !== b;
    }
    case BLT: {
      return a < b;
    }
    case BGE: {
      return a >= b;
    }
    case BLTU: {
      return a >>> 0 < b >>> 0;
    }
    default: {
      return a >>> 0 >= b >>> 0;
    } // bgeu
  }
}
