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
export const OP_IRET = opc("iret");
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
  if (s.name === "jalr" || s.name === "iret") f |= F.Jalr; // iret is a register-less jump to the interrupt controller's EPC
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

/**
 * Tags only (RAM is always up to date: write-through, no-allocate). Only RAM addresses are cached. `ways` lines share a set
 * (default 1: direct mapped); within a set the least recently used line is replaced.
 */
export class DataCache {
  private readonly tags: Uint32Array;
  private readonly valid: Uint8Array;
  private readonly used: Uint32Array;
  private readonly shift: number;
  private readonly setMask: number;
  private clock = 0;
  constructor(readonly lines: number, readonly lineBytes: number, readonly missPenalty: number, readonly ways = 1) {
    if (lines < 1 || (lines & (lines - 1)) !== 0) throw new RangeError("cache lines must be a power of two");
    if (lineBytes < 4 || (lineBytes & (lineBytes - 1)) !== 0) throw new RangeError("cache line size must be a power of two >= 4");
    if (missPenalty < 0 || !Number.isInteger(missPenalty)) throw new RangeError("missPenalty must be an integer >= 0");
    if (ways < 1 || (ways & (ways - 1)) !== 0 || ways > lines) throw new RangeError("cache ways must be a power of two no larger than the line count");
    this.tags = new Uint32Array(lines);
    this.valid = new Uint8Array(lines);
    this.used = new Uint32Array(lines);
    this.shift = Math.log2(lineBytes);
    this.setMask = lines / ways - 1;
  }
  invalidate(): void { this.valid.fill(0); this.used.fill(0); this.clock = 0; }
  hit(addr: number): boolean {
    const line = addr >>> this.shift;
    const base = (line & this.setMask) * this.ways;
    for (let w = 0; w < this.ways; w++) {
      const i = base + w;
      if (this.valid[i] === 1 && this.tags[i] === line) {
        if (this.ways > 1) this.used[i] = ++this.clock;
        return true;
      }
    }
    return false;
  }
  fill(addr: number): void {
    const line = addr >>> this.shift;
    const base = (line & this.setMask) * this.ways;
    let victim = base;
    for (let w = 0; w < this.ways; w++) {
      const i = base + w;
      if (this.valid[i] === 1 && this.tags[i] === line) { victim = i; break; } // already there
      if (this.valid[i] === 0) { victim = i; break; }
      if (this.used[i]! < this.used[victim]!) victim = i;
    }
    this.valid[victim] = 1;
    this.tags[victim] = line;
    this.used[victim] = ++this.clock;
  }
}

/** Branch predictor: `entries` saturating counters of `bits` (1 or 2) indexed by (pc >> 2) % entries. All start at "not taken". */
export class Predictor {
  private readonly t: Uint8Array;
  constructor(readonly entries = 64, readonly bits = 1) {
    if (!Number.isInteger(entries) || entries < 1) throw new RangeError("predictor entries must be an integer >= 1");
    if (bits !== 1 && bits !== 2) throw new RangeError("predictor bits must be 1 or 2");
    this.t = new Uint8Array(entries);
  }
  reset(): void { this.t.fill(0); }
  predict(pc: number): boolean { return this.t[(pc >>> 2) % this.entries]! >= (this.bits === 2 ? 2 : 1); }
  train(pc: number, taken: boolean): void {
    const i = (pc >>> 2) % this.entries;
    if (this.bits === 1) this.t[i] = taken ? 1 : 0;
    else this.t[i] = taken ? Math.min(3, this.t[i]! + 1) : Math.max(0, this.t[i]! - 1);
  }
  /** Flip the prediction of the entry for `pc` (every entry if omitted), keeping its strength. */
  flip(pc?: number): void {
    const x = this.bits === 2 ? 2 : 1;
    if (pc === undefined) for (let i = 0; i < this.entries; i++) this.t[i] = this.t[i]! ^ x;
    else { const i = (pc >>> 2) % this.entries; this.t[i] = this.t[i]! ^ x; }
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
  /** Data cache: lines per set (power of two, default 1 = direct mapped; least recently used replacement). */
  ways?: number;
  /** Extra cycles a load miss freezes the pipeline (a miss that also misses the L2, when there is one). Default 4. */
  missPenalty?: number;
  /** Instruction cache lines (power of two, same line size as the data cache). Default 0: none, every fetch reads RAM at once. */
  icacheLines?: number;
  /** Shared second-level cache lines (power of two, 4-way, same line size) behind both L1 caches. Default 0: none. */
  l2Lines?: number;
  /** Cycles an L1 miss that hits the L2 costs. Default 2. */
  l2Penalty?: number;
  /** Branch predictor: entries (default 64) and bits per entry, 1 or 2 (default 1). */
  predEntries?: number;
  predBits?: number;
  /** Timeline ring: instructions kept (>= 8, default 32) and cycles kept (default 64). */
  timelineRows?: number;
  timelineCols?: number;
}

/** State and helpers shared by both engines. */
export abstract class EngineBase implements PipelineEngine {
  protected readonly v: ViewState;
  protected readonly pool: InstrPool;
  protected readonly cache: DataCache;
  protected readonly icache: DataCache | null;
  protected readonly l2: DataCache | null;
  protected readonly l2Penalty: number;
  protected readonly pred: Predictor;
  /** The pc whose instruction cache line is being waited for, and the cycles left. */
  private iWaitPc = -1;
  private iWait = 0;
  protected machine!: Machine;
  protected bus!: Bus;
  protected regs!: Int32Array;
  protected ramSize = 0;
  protected fetchPc = 0;
  protected cycleNo = 0;
  protected isHalted = false;
  /** Set while an interrupt waits for the pipeline to empty: nothing new is fetched. */
  protected hold = false;
  /** Set by execute(): whether the last conditional branch was taken. */
  protected taken = false;

  constructor(s: EngineSettings = {}, poolSize = POOL, view?: ViewState) {
    this.pool = new InstrPool(poolSize);
    this.v = view ?? new ViewState(s.timelineRows ?? 32, s.timelineCols ?? 64);
    const lineBytes = s.cacheLineBytes ?? 16, penalty = s.missPenalty ?? 4;
    this.cache = new DataCache(s.cacheLines ?? 8, lineBytes, penalty, s.ways ?? 1);
    this.icache = s.icacheLines ? new DataCache(s.icacheLines, lineBytes, penalty) : null;
    this.l2 = s.l2Lines ? new DataCache(s.l2Lines, lineBytes, penalty, Math.min(4, s.l2Lines)) : null;
    this.l2Penalty = s.l2Penalty ?? 2;
    if (!Number.isInteger(this.l2Penalty) || this.l2Penalty < 0) throw new RangeError("l2Penalty must be an integer >= 0");
    this.pred = new Predictor(s.predEntries ?? 64, s.predBits ?? 1);
  }

  get view(): EngineView { return this.v; }
  get halted(): boolean { return this.isHalted; }
  /** Address of the next instruction to fetch (after ecall: the address following it, like the reference). */
  get pc(): number { return this.fetchPc; }
  get cycle(): number { return this.cycleNo; }
  /** No instruction in flight (see `Engine.drained`). */
  abstract get drained(): boolean;
  holdFetch(on: boolean): void { this.hold = on; }
  redirect(pc: number): void { this.fetchPc = pc >>> 0; }

  abstract step(): void;
  flipPredictor(_pc?: number): void {}
  invalidateCache(): void { this.cache.invalidate(); this.icache?.invalidate(); this.l2?.invalidate(); }

  reset(machine: Machine, program: Uint32Array): void {
    machine.loadProgram(program);
    this.machine = machine;
    this.bus = machine.bus;
    this.regs = machine.regs;
    this.ramSize = machine.ram.length;
    this.fetchPc = 0;
    this.cycleNo = 0;
    this.isHalted = false;
    this.hold = false;
    this.cache.invalidate();
    this.icache?.invalidate();
    this.l2?.invalidate();
    this.pred.reset();
    this.iWaitPc = -1; this.iWait = 0;
    this.v.reset();
    this.onReset();
  }
  protected onReset(): void {}

  /** Cycles a miss of an L1 cache costs: the L2's hit time if the line is in it, else the full RAM penalty (and the line goes into the L2). */
  protected missCost(addr: number): number {
    const l2 = this.l2;
    if (!l2) return this.cache.missPenalty;
    const c = this.v.counters;
    if (l2.hit(addr)) { c[Counter.L2Hits]!++; return this.l2Penalty; }
    c[Counter.L2Misses]!++;
    l2.fill(addr);
    return this.cache.missPenalty;
  }

  /**
   * Whether the instruction at `pc` can be fetched this cycle. Without an instruction cache always; with one, a hit fetches at once and a
   * miss makes fetch wait the miss cost (counted in StallIFetch), then the line is filled and the fetch goes ahead. A redirect while
   * waiting starts a new lookup at the new pc.
   */
  protected fetchReady(pc: number): boolean {
    const ic = this.icache;
    if (!ic || pc >= this.ramSize) return true;
    const c = this.v.counters;
    if (this.iWaitPc !== pc) {
      if (ic.hit(pc)) { c[Counter.ICacheHits]!++; return true; }
      c[Counter.ICacheMisses]!++;
      this.iWaitPc = pc;
      this.iWait = this.missCost(pc);
    }
    if (this.iWait > 0) {
      this.iWait--;
      c[Counter.StallIFetch]!++;
      return false;
    }
    ic.fill(pc);
    this.iWaitPc = -1;
    return true;
  }

  protected retire(id: number, op: number): void {
    if (op === OP_IRET) this.machine.intc.leave(); // interrupts are on again once the iret has retired
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
    if (op === OP_IRET) return this.machine.intc.epc >>> 0;
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
        else { c[Counter.CacheMisses]!++; st |= St.Missing; p.wait[s] = this.missCost(addr); }
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
