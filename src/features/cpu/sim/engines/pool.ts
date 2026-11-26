// The instruction pool of the timed engines: dynamic instruction fields for the few instructions in flight, as typed arrays
// (structure-of-arrays; there are no per-instruction objects), with fetch and allocation-free decode.

import { OPS } from '../isa/isa';

/** Per-opcode format code for decoding straight into the pool arrays (0 = illegal opcode). */
const FMT_R = 1,
  FMT_I = 2,
  FMT_SB = 3,
  FMT_U = 4,
  FMT_J = 5,
  FMT_N = 6;
const OP_FMT = new Uint8Array(128);
for (const s of OPS) {
  OP_FMT[s.op] = { R: FMT_R, I: FMT_I, S: FMT_SB, B: FMT_SB, U: FMT_U, J: FMT_J, N: FMT_N }[s.fmt];
}

/** Dynamic instruction fields for the (few) instructions in flight. Slot = id & (POOL - 1). */
export const POOL = 8;
export const POOL_MASK = POOL - 1;
/** InstrPool.state bits. */
export const St = { ExDone: 1, Started: 2, Missing: 4 } as const;

export class InstrPool {
  readonly word: Uint32Array;
  readonly pc: Uint32Array;
  readonly op: Uint8Array; // 0 = illegal / unfetchable
  readonly rd: Uint8Array;
  readonly rs1: Uint8Array;
  readonly rs2: Uint8Array;
  readonly imm: Int32Array;
  readonly a: Int32Array;
  readonly b: Int32Array;
  readonly res: Int32Array;
  readonly addr: Uint32Array;
  readonly predNext: Uint32Array;
  readonly wait: Int32Array;
  readonly state: Uint8Array;
  /** A page fault this instruction carries (`VmFault`, 0 none) and the virtual address it faulted on: taken when the instruction is known to be on the right path. */
  readonly fault: Uint8Array;
  readonly vaddr: Uint32Array;
  /** The logical core (thread) the instruction belongs to: an index into the engine's `cores` (0 when it has one). */
  readonly thread: Uint8Array;
  /** Slot = id & mask. */
  readonly mask: number;

  /** `size` must be a power of two (default 8: enough for the width-1 pipeline). */
  constructor(readonly size = POOL) {
    this.mask = size - 1;
    this.word = new Uint32Array(size);
    this.pc = new Uint32Array(size);
    this.op = new Uint8Array(size);
    this.rd = new Uint8Array(size);
    this.rs1 = new Uint8Array(size);
    this.rs2 = new Uint8Array(size);
    this.imm = new Int32Array(size);
    this.a = new Int32Array(size);
    this.b = new Int32Array(size);
    this.res = new Int32Array(size);
    this.addr = new Uint32Array(size);
    this.predNext = new Uint32Array(size);
    this.wait = new Int32Array(size);
    this.state = new Uint8Array(size);
    this.fault = new Uint8Array(size);
    this.vaddr = new Uint32Array(size);
    this.thread = new Uint8Array(size);
  }

  /** Start the slot's instruction: its pc and the word fetched for it (0, an illegal instruction, when the pc cannot be fetched), nothing decoded yet. */
  fetch(slot: number, pc: number, word: number): void {
    this.pc[slot] = pc;
    this.fault[slot] = 0;
    this.state[slot] = 0;
    this.wait[slot] = 0;
    this.word[slot] = word;
    this.op[slot] = 0;
  }

  /**
   * Decode the fetched word into the slot's fields without allocating (same bit layout and the same zeros for
   * unused fields as `decode` in isa.ts, which the tests compare against). Illegal words leave op = 0.
   */
  decodeSlot(slot: number): void {
    // every use of the word is a bitwise operation, which reads it as an int32 itself
    const w = this.word[slot] ?? 0;
    const fmt = OP_FMT[w & 0x7f] ?? 0;
    let rd = 0,
      rs1 = 0,
      rs2 = 0,
      imm = 0;
    switch (fmt) {
      case FMT_R: {
        rd = (w >>> 7) & 0xf;
        rs1 = (w >>> 11) & 0xf;
        rs2 = (w >>> 15) & 0xf;
        break;
      }
      case FMT_I: {
        rd = (w >>> 7) & 0xf;
        rs1 = (w >>> 11) & 0xf;
        imm = w >> 15;
        break;
      }
      case FMT_SB: {
        rs1 = (w >>> 11) & 0xf;
        rs2 = (w >>> 15) & 0xf;
        imm = ((w >> 19) << 4) | ((w >>> 7) & 0xf);
        break;
      }
      case FMT_U: {
        rd = (w >>> 7) & 0xf;
        imm = w >>> 11;
        break;
      }
      case FMT_J: {
        rd = (w >>> 7) & 0xf;
        imm = w >> 11;
        break;
      }
      default: {
        break; // an illegal word and FMT_N have no fields
      }
    }
    this.op[slot] = fmt === 0 ? 0 : w & 0x7f;
    this.rd[slot] = rd;
    this.rs1[slot] = rs1;
    this.rs2[slot] = rs2;
    this.imm[slot] = imm;
  }
}
