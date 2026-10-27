// Shared pieces of the timed engines: op tables, execute semantics, data cache, instruction pool, engine base class.
// Everything dynamic lives in typed arrays (structure-of-arrays); there are no per-instruction objects.

import { OPS, SPEC_BY_NAME } from "../isa/isa";
import type { Bus } from "../machine/bus";
import type { Engine } from "../machine/engine";
import type { Machine } from "../machine/machine";
import { Counter, Fate, ViewState, type EngineView } from "./view";
import { Dram, type DramSettings } from "./dram";

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
  /** Slot (set * ways + way) of the last hit or fill, and the line number the last fill evicted (-1: none). For the die view. */
  lastSlot = 0;
  lastEvicted = -1;
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
        this.lastSlot = i;
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
    this.lastEvicted = this.valid[victim] === 1 && this.tags[victim] !== line ? this.tags[victim]! : -1;
    this.lastSlot = victim;
    this.valid[victim] = 1;
    this.tags[victim] = line;
    this.used[victim] = ++this.clock;
  }
  /** The line number held in each slot (address >> log2(lineBytes)), -1 where the slot is empty. */
  dump(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.lines; i++) out.push(this.valid[i] === 1 ? this.tags[i]! : -1);
    return out;
  }
  /** Bytes per line, as a shift. */
  get lineShift(): number { return this.shift; }
}

/** What the die view needs to show what is stored: a ring of the writes the machine did in its last cycles (docs/DIE.md "What is stored"). */
export const Ev = { Reg: 1, Hit: 2, Fill: 3, Pred: 4, Mem: 5, Row: 6 } as const;
/** Which cache an event is about. */
export const Which = { D: 0, I: 1, L2: 2 } as const;
const EV_SIZE = 6, EV_CAP = 1024;
export class EventLog {
  private readonly a = new Int32Array(EV_SIZE * EV_CAP);
  private n = 0;
  reset(): void { this.n = 0; }
  push(cycle: number, kind: number, a: number, b: number, c: number, d: number): void {
    const i = (this.n++ % EV_CAP) * EV_SIZE;
    const x = this.a;
    x[i] = cycle; x[i + 1] = kind; x[i + 2] = a; x[i + 3] = b; x[i + 4] = c; x[i + 5] = d;
  }
  /** Events of cycle >= `from`, oldest first, flattened [cycle, kind, a, b, c, d, ...]. */
  since(from: number): number[] {
    const out: number[] = [];
    const first = Math.max(0, this.n - EV_CAP);
    for (let k = first; k < this.n; k++) {
      const i = (k % EV_CAP) * EV_SIZE;
      if (this.a[i]! >= from) for (let j = 0; j < EV_SIZE; j++) out.push(this.a[i + j]!);
    }
    return out;
  }
}

export interface CacheState { lines: number; ways: number; lineBytes: number; tags: number[] }
export interface EngineState {
  regs: number[];
  d: CacheState;
  i?: CacheState;
  l2?: CacheState;
  pred: { entries: number; bits: number; table: number[] };
  /** The DRAM behind the caches, when the engine has one: geometry and the open row of every bank (-1: closed). */
  dram?: { banks: number; rowBytes: number; open: number[] };
  events: EventLog;
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
  /** The counter of the entry for `pc`. */
  get(pc: number): number { return this.t[(pc >>> 2) % this.entries]!; }
  dump(): number[] { return Array.from(this.t); }
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
  /** What is stored right now (registers, cache lines, predictor counters) and the recent writes, for the die view. */
  storedState(): EngineState;
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
  /**
   * Cycles a jump (a taken branch, a jump, a flush, an interrupt) waits for its target when there is no instruction cache: the
   * target has to come from RAM. Fetch that carries on in sequence is free. Default 0 (instruction memory is ideal, as in the engine tests); the game
   * sets it for every CPU (apply.ts), so an instruction cache has something to save. With an instruction cache it does not apply.
   */
  redirectPenalty?: number;
  /** Branch predictor: entries (default 64) and bits per entry, 1 or 2 (default 1). */
  predEntries?: number;
  predBits?: number;
  /**
   * The DRAM behind the caches (docs/RAM.md): banks with an open row each; a miss that reaches RAM costs a row hit, an empty bank's activate, or a
   * conflict instead of the flat `missPenalty`. Default: none (the flat penalty), so the engine tests are unchanged.
   */
  dram?: DramSettings;
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
  protected readonly dram: Dram | null;
  protected readonly pred: Predictor;
  protected readonly events = new EventLog();
  /** The pc whose instruction cache line is being waited for, and the cycles left. */
  private iWaitPc = -1;
  private iWait = 0;
  /** The pc a sequential fetch would come from next. */
  private seqPc = 0;
  protected readonly redirectPenalty: number;
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
    this.dram = s.dram ? new Dram(s.dram) : null;
    if (!Number.isInteger(this.l2Penalty) || this.l2Penalty < 0) throw new RangeError("l2Penalty must be an integer >= 0");
    this.redirectPenalty = s.redirectPenalty ?? 0;
    if (!Number.isInteger(this.redirectPenalty) || this.redirectPenalty < 0) throw new RangeError("redirectPenalty must be an integer >= 0");
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
  storedState(): EngineState {
    const c = (x: DataCache): CacheState => ({ lines: x.lines, ways: x.ways, lineBytes: 1 << x.lineShift, tags: x.dump() });
    return {
      regs: Array.from(this.regs ?? []),
      d: c(this.cache), ...(this.icache ? { i: c(this.icache) } : {}), ...(this.l2 ? { l2: c(this.l2) } : {}),
      pred: { entries: this.pred.entries, bits: this.pred.bits, table: this.pred.dump() },
      ...(this.dram ? { dram: { banks: this.dram.banks, rowBytes: this.dram.rowBytes, open: this.dram.openRows() } } : {}),
      events: this.events,
    };
  }

  /** Write a register and log it (the die shows the register file filling in). */
  protected writeReg(r: number, value: number): void {
    this.events.push(this.cycleNo, Ev.Reg, r, value | 0, this.regs[r]! | 0, 0);
    this.regs[r] = value;
  }

  /** The data cache lookup and fill, logged. */
  protected dHit(addr: number): boolean {
    const h = this.cache.hit(addr);
    if (h) this.events.push(this.cycleNo, Ev.Hit, Which.D, this.cache.lastSlot, addr >>> this.cache.lineShift, 0);
    return h;
  }
  protected dFill(addr: number): void {
    this.cache.fill(addr);
    this.events.push(this.cycleNo, Ev.Fill, Which.D, this.cache.lastSlot, addr >>> this.cache.lineShift, this.cache.lastEvicted);
  }
  /** A load (kind 0) or a store (kind 1) of the data side: address and value. */
  protected logMem(kind: number, addr: number, value: number): void {
    this.events.push(this.cycleNo, Ev.Mem, kind, addr | 0, value | 0, 0);
  }
  /** Train the predictor and log the counter's change. */
  protected trainPred(pc: number, taken: boolean): void {
    const old = this.pred.get(pc);
    this.pred.train(pc, taken);
    this.events.push(this.cycleNo, Ev.Pred, (pc >>> 2) % this.pred.entries, this.pred.get(pc), old, 0);
  }

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
    this.dram?.reset();
    this.events.reset();
    this.iWaitPc = -1; this.iWait = 0; this.seqPc = 0;
    this.v.reset();
    this.onReset();
  }
  protected onReset(): void {}

  /** Cycles a miss of an L1 cache costs: the L2's hit time if the line is in it, else the full RAM penalty (and the line goes into the L2). */
  protected missCost(addr: number): number {
    const l2 = this.l2;
    if (!l2) return this.ramCost(addr);
    const c = this.v.counters;
    if (l2.hit(addr)) { c[Counter.L2Hits]!++; this.events.push(this.cycleNo, Ev.Hit, Which.L2, l2.lastSlot, addr >>> l2.lineShift, 0); return this.l2Penalty; }
    c[Counter.L2Misses]!++;
    l2.fill(addr);
    this.events.push(this.cycleNo, Ev.Fill, Which.L2, l2.lastSlot, addr >>> l2.lineShift, l2.lastEvicted);
    return this.ramCost(addr);
  }

  /** What reaching RAM costs: the flat penalty, or the DRAM's answer (a row hit, an activate, a conflict), which is logged for the die. */
  private ramCost(addr: number): number {
    const d = this.dram;
    if (!d) return this.cache.missPenalty;
    const c = this.v.counters;
    const a = d.access(addr, this.cycleNo, (cycle, bank, row, prev, outcome) => this.events.push(cycle, Ev.Row, bank, row, prev, outcome));
    c[a.outcome === 0 ? Counter.RowHits : a.outcome === 1 ? Counter.RowEmpty : Counter.RowConflicts]!++;
    return a.cycles;
  }

  /**
   * Whether the instruction at `pc` can be fetched this cycle. Fetch that carries on from the last instruction is a stream and always free
   * (the line it enters is filled into the instruction cache on the way). A jump (a taken branch, a jump, a flush, an interrupt) has to
   * find its target: with an instruction cache a hit is free and a miss waits the miss cost (the L2's if it holds the line, else RAM's);
   * without one it waits `redirectPenalty`. The wait counts in StallIFetch; a redirect during it starts a new lookup at the new pc.
   */
  protected fetchReady(pc: number): boolean {
    if (pc >= this.ramSize) return true;
    const ic = this.icache, c = this.v.counters;
    if (this.iWaitPc !== pc) {
      let wait = 0;
      if (pc === this.seqPc) { if (ic) this.iFill(ic, pc); this.seqPc = (pc + 4) >>> 0; return true; }
      if (ic) {
        if (ic.hit(pc)) { c[Counter.ICacheHits]!++; this.events.push(this.cycleNo, Ev.Hit, Which.I, ic.lastSlot, pc >>> ic.lineShift, 0); this.seqPc = (pc + 4) >>> 0; return true; }
        c[Counter.ICacheMisses]!++;
        wait = this.missCost(pc);
      } else if (this.redirectPenalty > 0) wait = this.redirectPenalty;
      else { this.seqPc = (pc + 4) >>> 0; return true; }
      this.iWaitPc = pc; this.iWait = wait;
    }
    if (this.iWait > 0) {
      this.iWait--;
      c[Counter.StallIFetch]!++;
      return false;
    }
    if (this.icache) this.iFill(this.icache, pc);
    this.iWaitPc = -1;
    this.seqPc = (pc + 4) >>> 0;
    return true;
  }

  private iFill(ic: DataCache, pc: number): void {
    const had = ic.hit(pc); // a line already there is only touched
    if (had) return;
    ic.fill(pc);
    this.events.push(this.cycleNo, Ev.Fill, Which.I, ic.lastSlot, pc >>> ic.lineShift, ic.lastEvicted);
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
        this.logMem(1, addr, p.b[s]!);
      }
      return true;
    }
    if (!(st & St.Started)) {
      st |= St.Started;
      if (addr < this.ramSize) this.logMem(0, addr, this.load(op, addr));
      if (addr < this.ramSize) {
        if (this.dHit(addr)) { c[Counter.CacheHits]!++; p.res[s] = this.load(op, addr); }
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
      this.dFill(addr);
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
