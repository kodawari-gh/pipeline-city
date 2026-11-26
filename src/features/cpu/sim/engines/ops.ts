// The op tables and execute semantics of the timed engines: opcode numbers, per-opcode class flags, the ALU and the branch condition.
// Split out of the engines' shared module (#133); no logic changed.

/* oxlint-disable typescript/no-non-null-assertion, oxc/bad-bitwise-operator, typescript/strict-boolean-expressions -- moved unchanged from common.ts (#133): spec lookups by known names, the ISA's bit flags and optional spec flags; left to the cpu area wave of #115 */
/* oxlint-disable eslint/complexity, eslint/max-lines-per-function, eslint/max-params, eslint/default-case -- `alu` is one flat switch over the opcodes with a fall-through result, as in the reference semantics; other ops have no case on purpose */
import { OPS, SPEC_BY_NAME } from '../isa/isa';

const opc = (name: string): number => SPEC_BY_NAME.get(name)!.op;
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

/** Per-opcode class flags (indexed by the 7-bit opcode). */
export const F = { Writes: 1, Rs1: 2, Rs2: 4, Load: 8, Store: 16, Branch: 32, Jal: 64, Jalr: 128, Amo: 256 } as const;
export const F_MEM = F.Load | F.Store;
export const OPF = new Uint16Array(128);
for (const s of OPS) {
  let f = 0;
  switch (s.fmt) {
    case 'R': {
      f = F.Writes | F.Rs1 | F.Rs2;
      break;
    }
    case 'I': {
      f = F.Writes | F.Rs1;
      break;
    }
    case 'S': {
      f = F.Rs1 | F.Rs2 | F.Store;
      break;
    }
    case 'B': {
      f = F.Rs1 | F.Rs2 | F.Branch;
      break;
    }
    case 'U': {
      f = F.Writes;
      break;
    }
    case 'J': {
      f = F.Writes | F.Jal;
      break;
    }
    case 'N': {
      break;
    }
  }
  if (s.mem) {
    f |= F.Load;
  }
  if (s.amo) {
    f |= F.Load | F.Store | F.Amo;
  } // an atomic is both: the load-use hazard of a load, the shared port and the store ordering of a store
  if (s.name === 'jalr' || s.name === 'iret') {
    f |= F.Jalr;
  } // iret is a register-less jump to the interrupt controller's EPC
  OPF[s.op] = f;
}

/** ALU / address-generation result for non-branch ops (semantics identical to src/sim/ref). */
export function alu(op: number, a: number, b: number, imm: number, pc: number): number {
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
    case LUI: {
      return imm << 11;
    }
    case AUIPC: {
      return pc + (imm << 11);
    }
  }
  return 0;
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
