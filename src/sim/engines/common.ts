// Shared pieces of the timed engines: op tables, execute semantics, data cache, instruction pool, engine base class.
// Everything dynamic lives in typed arrays (structure-of-arrays); there are no per-instruction objects.

import { OPS, SPEC_BY_NAME } from "../isa/isa";
import type { Bus } from "../machine/bus";
import type { Engine } from "../machine/engine";
import type { Machine } from "../machine/machine";
import { Counter, Fate, ViewState, type EngineView } from "./view";

const opc = (name: string): number => SPEC_BY_NAME.get(name)!.op;
const ADD = opc("add"), SUB = opc("sub"), AND = opc("and"), OR = opc("or"), XOR = opc("xor");
const SLL = opc("sll"), SRL = opc("srl"), SRA = opc("sra"), SLT = opc("slt"), SLTU = opc("sltu"), MUL = opc("mul");
const ADDI = opc("addi"), ANDI = opc("andi"), ORI = opc("ori"), XORI = opc("xori");
const SLLI = opc("slli"), SRLI = opc("srli"), SRAI = opc("srai"), SLTI = opc("slti"), SLTIU = opc("sltiu");
const LW = opc("lw"), LB = opc("lb"), SW = opc("sw");
const BEQ = opc("beq"), BNE = opc("bne"), BLT = opc("blt"), BGE = opc("bge"), BLTU = opc("bltu");
const LUI = opc("lui"), AUIPC = opc("auipc");
export const OP_ECALL = opc("ecall");
export const OP_MUL = MUL;
export const OP_SW = SW;
export const OP_LW = LW;
export const OP_LB = LB;

/** Per-opcode class flags (indexed by the 7-bit opcode). */
export const F = { Writes: 1, Rs1: 2, Rs2: 4, Load: 8, Store: 16, Branch: 32, Jal: 64, Jalr: 128 } as const;
export const F_MEM = F.Load | F.Store;
export const OPF = new Uint8Array(128);
for (const s of OPS) {
  let f = 0;
  switch (s.fmt) {
    case "R": f = F.Writes | F.Rs1 | F.Rs2; break;
    case "I": f = F.Writes | F.Rs1; break;
    case "S": f = F.Rs1 | F.Rs2 | F.Store; break;
    case "B": f = F.Rs1 | F.Rs2 | F.Branch; break;
    case "U": f = F.Writes; break;
    case "J": f = F.Writes | F.Jal; break;
    case "N": break;
  }
  if (s.mem) f |= F.Load;
  if (s.name === "jalr") f |= F.Jalr;
  OPF[s.op] = f;
}

/** Per-opcode format code for decoding straight into the pool arrays (0 = illegal opcode). */
const FMT_R = 1, FMT_I = 2, FMT_SB = 3, FMT_U = 4, FMT_J = 5, FMT_N = 6;
const OP_FMT = new Uint8Array(128);
for (const s of OPS) OP_FMT[s.op] = { R: FMT_R, I: FMT_I, S: FMT_SB, B: FMT_SB, U: FMT_U, J: FMT_J, N: FMT_N }[s.fmt];

/** ALU / address-generation result for non-branch ops (semantics identical to src/sim/ref). */
function alu(op: number, a: number, b: number, imm: number, pc: number): number {
  switch (op) {
    case ADD: return a + b;
    case SUB: return a - b;
    case AND: return a & b;
    case OR: return a | b;
    case XOR: return a ^ b;
    case SLL: return a << (b & 31);
    case SRL: return a >>> (b & 31);
    case SRA: return a >> (b & 31);
    case SLT: return a < b ? 1 : 0;
    case SLTU: return a >>> 0 < b >>> 0 ? 1 : 0;
    case MUL: return Math.imul(a, b);
    case ADDI: return a + imm;
    case ANDI: return a & imm;
    case ORI: return a | imm;
    case XORI: return a ^ imm;
    case SLLI: return a << imm;
    case SRLI: return a >>> imm;
    case SRAI: return a >> imm;
    case SLTI: return a < imm ? 1 : 0;
    case SLTIU: return a >>> 0 < imm >>> 0 ? 1 : 0;
    case LUI: return imm << 11;
    case AUIPC: return pc + (imm << 11);
  }
  return 0;
}

function branchTaken(op: number, a: number, b: number): boolean {
  switch (op) {
    case BEQ: return a === b;
    case BNE: return a !== b;
    case BLT: return a < b;
    case BGE: return a >= b;
    case BLTU: return a >>> 0 < b >>> 0;
    default: return a >>> 0 >= b >>> 0; // bgeu
  }
}

/** Direct-mapped, tags only (RAM is always up to date: write-through, no-allocate). Only RAM addresses are cached. */
export class DataCache {
  private readonly tags: Uint32Array;
  private readonly valid: Uint8Array;
  private readonly shift: number;
  private readonly mask: number;
  constructor(readonly lines: number, readonly lineBytes: number, readonly missPenalty: number) {
    if (lines < 1 || (lines & (lines - 1)) !== 0) throw new RangeError("cache lines must be a power of two");
    if (lineBytes < 4 || (lineBytes & (lineBytes - 1)) !== 0) throw new RangeError("cache line size must be a power of two >= 4");
    if (missPenalty < 0 || !Number.isInteger(missPenalty)) throw new RangeError("missPenalty must be an integer >= 0");
    this.tags = new Uint32Array(lines);
    this.valid = new Uint8Array(lines);
    this.shift = Math.log2(lineBytes);
    this.mask = lines - 1;
  }
  invalidate(): void { this.valid.fill(0); }
  hit(addr: number): boolean {
    const line = addr >>> this.shift;
    const i = line & this.mask;
    return this.valid[i] === 1 && this.tags[i] === line;
  }
  fill(addr: number): void {
    const line = addr >>> this.shift;
    const i = line & this.mask;
    this.valid[i] = 1;
    this.tags[i] = line;
  }
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
  /** Slot = id & mask. */
  readonly mask: number;

  /** `size` must be a power of two (default 8: enough for the width-1 pipeline). */
  constructor(readonly size = POOL) {
    this.mask = size - 1;
    this.word = new Uint32Array(size); this.pc = new Uint32Array(size); this.op = new Uint8Array(size);
    this.rd = new Uint8Array(size); this.rs1 = new Uint8Array(size); this.rs2 = new Uint8Array(size);
    this.imm = new Int32Array(size); this.a = new Int32Array(size); this.b = new Int32Array(size);
    this.res = new Int32Array(size); this.addr = new Uint32Array(size); this.predNext = new Uint32Array(size);
    this.wait = new Int32Array(size); this.state = new Uint8Array(size);
  }

  /** Instruction fetch: a real read through the bus. Unaligned or non-RAM pcs yield an illegal (op 0) instruction. */
  fetch(bus: Bus, ramSize: number, slot: number, pc: number): void {
    this.pc[slot] = pc;
    this.state[slot] = 0;
    this.wait[slot] = 0;
    this.word[slot] = pc % 4 === 0 && pc + 4 <= ramSize ? bus.load32(pc) : 0;
    this.op[slot] = 0;
  }

  /**
   * Decode the fetched word into the slot's fields without allocating (same bit layout and the same zeros for
   * unused fields as `decode` in isa.ts, which the tests compare against). Illegal words leave op = 0.
   */
  decodeSlot(slot: number): void {
    const w = this.word[slot]! | 0;
    const fmt = OP_FMT[w & 0x7f]!;
    let rd = 0, rs1 = 0, rs2 = 0, imm = 0;
    switch (fmt) {
      case FMT_R: rd = (w >>> 7) & 0xf; rs1 = (w >>> 11) & 0xf; rs2 = (w >>> 15) & 0xf; break;
      case FMT_I: rd = (w >>> 7) & 0xf; rs1 = (w >>> 11) & 0xf; imm = w >> 15; break;
      case FMT_SB: rs1 = (w >>> 11) & 0xf; rs2 = (w >>> 15) & 0xf; imm = ((w >> 19) << 4) | ((w >>> 7) & 0xf); break;
      case FMT_U: rd = (w >>> 7) & 0xf; imm = w >>> 11; break;
      case FMT_J: rd = (w >>> 7) & 0xf; imm = w >> 11; break;
    }
    this.op[slot] = fmt === 0 ? 0 : w & 0x7f;
    this.rd[slot] = rd; this.rs1[slot] = rs1; this.rs2[slot] = rs2; this.imm[slot] = imm;
  }
}

export interface PipelineEngine extends Engine {
  readonly view: EngineView;
  /** Drop every data cache line (the next accesses miss). */
  invalidateCache(): void;
  /** Flip the 1-bit branch predictor entry for `pc`, or every entry if omitted. No-op for engines without prediction. */
  flipPredictor(pc?: number): void;
}

export interface EngineSettings {
  /** Data cache: number of lines (power of two). Default 8. */
  cacheLines?: number;
  /** Data cache: bytes per line (power of two). Default 16. */
  cacheLineBytes?: number;
  /** Extra cycles a load miss freezes the pipeline. Default 4. */
  missPenalty?: number;
  /** Timeline ring: instructions kept (>= 8, default 32) and cycles kept (default 64). */
  timelineRows?: number;
  timelineCols?: number;
}

/** State and helpers shared by both engines. */
export abstract class EngineBase implements PipelineEngine {
  protected readonly v: ViewState;
  protected readonly pool: InstrPool;
  protected readonly cache: DataCache;
  protected machine!: Machine;
  protected bus!: Bus;
  protected regs!: Int32Array;
  protected ramSize = 0;
  protected fetchPc = 0;
  protected cycleNo = 0;
  protected isHalted = false;
  /** Set by execute(): whether the last conditional branch was taken. */
  protected taken = false;

  constructor(s: EngineSettings = {}, poolSize = POOL, view?: ViewState) {
    this.pool = new InstrPool(poolSize);
    this.v = view ?? new ViewState(s.timelineRows ?? 32, s.timelineCols ?? 64);
    this.cache = new DataCache(s.cacheLines ?? 8, s.cacheLineBytes ?? 16, s.missPenalty ?? 4);
  }

  get view(): EngineView { return this.v; }
  get halted(): boolean { return this.isHalted; }
  /** Address of the next instruction to fetch (after ecall: the address following it, like the reference). */
  get pc(): number { return this.fetchPc; }
  get cycle(): number { return this.cycleNo; }

  abstract step(): void;
  flipPredictor(_pc?: number): void {}
  invalidateCache(): void { this.cache.invalidate(); }

  reset(machine: Machine, program: Uint32Array): void {
    machine.loadProgram(program);
    this.machine = machine;
    this.bus = machine.bus;
    this.regs = machine.regs;
    this.ramSize = machine.ram.length;
    this.fetchPc = 0;
    this.cycleNo = 0;
    this.isHalted = false;
    this.cache.invalidate();
    this.v.reset();
    this.onReset();
  }
  protected onReset(): void {}

  protected retire(id: number): void {
    this.v.counters[Counter.Retired]!++;
    this.v.setFate(id, Fate.Retired);
  }

  /**
   * EX work for a decoded slot whose operands are in pool.a / pool.b: fills res and addr and returns the actual next pc.
   * Throws RangeError for illegal instructions (only non-squashed ones ever get here).
   */
  protected execute(s: number): number {
    const p = this.pool;
    const op = p.op[s]!;
    const pc = p.pc[s]!;
    if (op === 0) throw new RangeError(`illegal instruction 0x${p.word[s]!.toString(16)} at pc=0x${pc.toString(16)}`);
    const f = OPF[op]!;
    const a = p.a[s]!, b = p.b[s]!, imm = p.imm[s]!;
    if (f & F_MEM) {
      p.addr[s] = (a + imm) >>> 0;
      return (pc + 4) >>> 0;
    }
    if (f & F.Branch) {
      this.taken = branchTaken(op, a, b);
      return (this.taken ? pc + imm : pc + 4) >>> 0;
    }
    if (f & F.Jal) { p.res[s] = pc + 4; return (pc + imm) >>> 0; }
    if (f & F.Jalr) { p.res[s] = pc + 4; return ((a + imm) & ~3) >>> 0; }
    if (op !== OP_ECALL) p.res[s] = alu(op, a, b, imm, pc);
    return (pc + 4) >>> 0;
  }

  /**
   * One processing step of the MEM-stage occupant. Returns true when its memory access is complete, false when it must
   * hold (data cache miss freeze). Counts StallCache for each held step.
   */
  protected memStep(s: number): boolean {
    const p = this.pool;
    const op = p.op[s]!;
    const f = OPF[op]!;
    if (!(f & F_MEM)) return true;
    const c = this.v.counters;
    let st = p.state[s]!;
    const addr = p.addr[s]!;
    if (f & F.Store) {
      if (!(st & St.Started)) {
        p.state[s] = st | St.Started;
        if (op === SW) this.bus.store32(addr, p.b[s]!);
        else this.bus.store8(addr, p.b[s]!);
      }
      return true;
    }
    if (!(st & St.Started)) {
      st |= St.Started;
      if (addr < this.ramSize) {
        if (this.cache.hit(addr)) { c[Counter.CacheHits]!++; p.res[s] = this.load(op, addr); }
        else { c[Counter.CacheMisses]!++; st |= St.Missing; p.wait[s] = this.cache.missPenalty; }
      } else {
        p.res[s] = this.load(op, addr); // device access: uncached
      }
      p.state[s] = st;
    }
    if (st & St.Missing) {
      if (p.wait[s]! > 0) {
        p.wait[s]!--;
        c[Counter.StallCache]!++;
        return false;
      }
      this.cache.fill(addr);
      p.res[s] = this.load(op, addr);
      p.state[s] = st & ~St.Missing;
    }
    return true;
  }

  protected load(op: number, addr: number): number {
    if (op === LW) return this.bus.load32(addr) | 0;
    if (op === LB) return (this.bus.load8(addr) << 24) >> 24;
    return this.bus.load8(addr); // lbu
  }
}
