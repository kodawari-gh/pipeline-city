// The root of the timed engines' class chain (`EngineRoot` <- `EngineFetch` <- `EngineBase`): the state both engines share, reset and
// threads, the logged register, cache and predictor writes, and the cost of an L1 miss. Split out of the engines' shared module (#133).

/* oxlint-disable typescript/no-non-null-assertion, unicorn/prefer-math-trunc, typescript/strict-boolean-expressions -- reads of typed arrays and tables at indexes that are valid by construction (hot cycle loop); a guard per read is left to the cpu area wave of #115; `x | 0` and `x >>> 0` are the ISA's int32/uint32 wrap, not a truncation or a typo */
/* oxlint-disable eslint/class-methods-use-this, eslint/no-empty-function, typescript/class-literal-property-style, unicorn/consistent-function-scoping, eslint/max-params -- default hooks the engines override (threads, predictor, reset), and signatures moved unchanged from common.ts (#133); left to the cpu area wave of #115 */
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import type { Bus } from '@/core/sim/hw/bus';
import type { Core } from '../core';
import type { Machine } from '@/core/sim/machine';
import { Counter, ViewState } from './view';
import type { EngineView } from './view';
import { MemSystem } from '@/features/memory/sim/memsys';
import type { CoreCaches } from '@/features/memory/sim/memsys';
import { DataCache } from './cache';
import { Ev, EventLog, Which } from './events';
import { Predictor } from './predictor';
import { InstrPool, POOL } from './pool';
import type { CacheState, EngineSettings, EngineState, PipelineEngine } from './contract';

/** State and helpers shared by both engines. */
export abstract class EngineRoot implements PipelineEngine {
  protected readonly v: ViewState;
  protected readonly pool: InstrPool;
  protected readonly cache: DataCache;
  protected readonly icache: DataCache | null;
  /** The L2 and the DRAM behind the L1 caches: built from the settings, or shared with other cores (`useMemSystem`). */
  protected mem: MemSystem;
  private ownsMem = true;
  protected readonly pred: Predictor;
  protected readonly events = new EventLog();
  /** The pc whose instruction cache line is being waited for, and the cycles left. */
  protected iWaitPc = -1;
  protected iWait = 0;
  /** The pc a sequential fetch would come from next. */
  protected seqPc = 0;
  protected readonly redirectPenalty: number;
  protected machine!: Machine;
  /** The core this engine runs: its registers, interrupt controller and MMU. */
  protected core!: Core;
  protected bus!: Bus;
  protected regs!: Int32Array;
  protected ramSize = 0;
  protected fetchPc = 0;
  /** The logical cores (threads) this engine runs; the first is the one it was reset with. `core` and `regs` follow `useThread`. */
  protected cores: Core[] = [];
  /** The thread fetch is for (an index into `cores`; when `fetchIdle` it is the one that fetched last). */
  protected fetchThread = 0;
  protected fetchIdle = false;
  protected cycleNo = 0;
  protected isHalted = false;
  /** Set while an interrupt waits for the pipeline to empty: nothing new is fetched. */
  protected hold = false;
  /** Set by execute(): whether the last conditional branch was taken. */
  protected taken = false;

  constructor(s: EngineSettings = {}, poolSize = POOL, view?: ViewState) {
    this.pool = new InstrPool(poolSize);
    this.v = view ?? new ViewState(s.timelineRows ?? 32, s.timelineCols ?? 64);
    const lineBytes = s.cacheLineBytes ?? 16,
      penalty = s.missPenalty ?? 4;
    this.cache = new DataCache(s.cacheLines ?? 8, lineBytes, penalty, s.ways ?? 1);
    this.icache = s.icacheLines ? new DataCache(s.icacheLines, lineBytes, penalty) : null;
    this.mem = new MemSystem({
      lineBytes,
      missPenalty: penalty,
      l2Lines: s.l2Lines ?? 0,
      l2Penalty: s.l2Penalty ?? 2,
      dram: s.dram,
    });
    this.redirectPenalty = s.redirectPenalty ?? 0;
    if (!Number.isInteger(this.redirectPenalty) || this.redirectPenalty < 0) {
      throw new RangeError('redirectPenalty must be an integer >= 0');
    }
    this.pred = new Predictor(s.predEntries ?? 64, s.predBits ?? 1);
    this.port = { cache: this.cache, icache: this.icache, counters: this.v.counters, events: this.events };
  }

  /** What a shared memory system sees of this core: its L1 caches and where to count and log (the coherence rule). */
  protected readonly port: CoreCaches;

  get view(): EngineView {
    return this.v;
  }
  get halted(): boolean {
    return this.isHalted;
  }
  /** Address of the next instruction to fetch (after ecall: the address following it, like the reference). */
  get pc(): number {
    return this.fetchPc;
  }
  get cycle(): number {
    return this.cycleNo;
  }
  get threads(): readonly Core[] | undefined {
    return this.cores.length > 1 ? this.cores : undefined;
  }
  get activeCore(): Core | null {
    return this.fetchIdle ? null : (this.cores[this.fetchThread] ?? null);
  }
  get waiting(): boolean {
    return false;
  }
  switchTo(_core: Core): boolean {
    return true;
  }
  yieldThread(): void {}
  /** Add a logical core. Only engines that support threads (the in-order one) do. */
  addThread(_core: Core): void {
    throw new RangeError('this engine runs one thread per core');
  }
  /** Make thread `t`'s registers, MMU and interrupt state the ones the engine's helpers use. */
  protected useThread(t: number): void {
    const c = this.cores[t]!;
    if (c !== this.core) {
      this.core = c;
      this.regs = c.regs;
    }
  }
  /** The machine tells the engine about something that happened outside it (an interrupt taken, an address space switched) so the event log shows it in order. */
  note(kind: number, a: number, b: number, c: number): void {
    this.events.push(this.cycleNo, kind, a | 0, b | 0, c | 0, 0);
  }
  /** No instruction in flight (see `Engine.drained`). */
  abstract get drained(): boolean;
  /** The L2 and DRAM this engine reaches (its own, or the shared one it was given). */
  get memSystem(): MemSystem {
    return this.mem;
  }
  /** Use a memory system shared with other cores instead of the engine's own (before `reset`). Its owner resets it. */
  useMemSystem(mem: MemSystem): void {
    this.mem = mem;
    this.ownsMem = false;
  }
  holdFetch(on: boolean): void {
    this.hold = on;
  }
  redirect(pc: number): void {
    this.fetchPc = pc >>> 0;
  }

  abstract step(): void;
  flipPredictor(_pc?: number): void {}
  storedState(): EngineState {
    const c = (x: DataCache): CacheState => ({
      lines: x.lines,
      ways: x.ways,
      lineBytes: 1 << x.lineShift,
      tags: x.dump(),
    });
    const { l2, dram } = this.mem;
    return {
      regs: [...(this.regs ?? [])],
      d: c(this.cache),
      ...(this.icache ? { i: c(this.icache) } : {}),
      ...(l2 ? { l2: c(l2) } : {}),
      pred: { entries: this.pred.entries, bits: this.pred.bits, table: this.pred.dump() },
      ...(dram
        ? { dram: { channels: dram.channels, banks: dram.banks, rowBytes: dram.rowBytes, open: dram.openRows() } }
        : {}),
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
    if (h) {
      this.events.push(this.cycleNo, Ev.Hit, Which.D, this.cache.lastSlot, addr >>> this.cache.lineShift, 0);
    } else if (this.mem.shared && this.cache.takeDropped(addr)) {
      this.v.counters[Counter.CoherenceMisses]!++;
    }
    return h;
  }
  protected dFill(addr: number): void {
    this.cache.fill(addr);
    this.events.push(
      this.cycleNo,
      Ev.Fill,
      Which.D,
      this.cache.lastSlot,
      addr >>> this.cache.lineShift,
      this.cache.lastEvicted,
    );
  }
  /** A load (kind 0) or a store (kind 1) of the data side: address and value. */
  protected logMem(kind: number, addr: number, value: number): void {
    this.events.push(this.cycleNo, Ev.Mem, kind, addr | 0, value | 0, 0);
    if (kind === 1 && this.mem.shared && addr < this.ramSize) {
      this.mem.storeLanded(this.port, addr, this.cycleNo);
    } // the store has landed in RAM: other cores drop the line
  }
  /** Train the predictor and log the counter's change. */
  protected trainPred(pc: number, taken: boolean): void {
    const old = this.pred.get(pc);
    this.pred.train(pc, taken);
    this.events.push(this.cycleNo, Ev.Pred, (pc >>> 2) % this.pred.entries, this.pred.get(pc), old, 0);
  }

  invalidateCache(): void {
    this.cache.invalidate();
    this.icache?.invalidate();
    this.mem.invalidate();
  }

  reset(machine: Machine, program: Uint32Array, core: Core = machine.cores[0]!): void {
    machine.loadProgram(program, core);
    this.machine = machine;
    this.core = core;
    this.cores = [core];
    this.fetchThread = 0;
    this.fetchIdle = false;
    this.bus = machine.bus;
    this.regs = core.regs;
    this.ramSize = machine.ram.length;
    this.fetchPc = core.entry;
    this.cycleNo = 0;
    this.isHalted = false;
    this.hold = false;
    this.cache.invalidate();
    this.icache?.invalidate();
    if (this.ownsMem) {
      this.mem.reset();
    }
    if (this.mem.shared) {
      this.mem.join(this.port);
    }
    this.pred.reset();
    this.events.reset();
    this.iWaitPc = -1;
    this.iWait = 0;
    this.seqPc = 0;
    this.v.reset();
    this.onReset();
  }
  protected onReset(): void {}
  /** Forget the instruction fetch in progress and the sequential stream: the next fetch is a jump (a thread switch). */
  protected resetFetchWait(): void {
    this.iWaitPc = -1;
    this.iWait = 0;
    this.seqPc = -1;
  }
  /** Exchange the instruction fetch in progress (the pc being waited for, the cycles left, the sequential stream) with `w` (three words): a core that fetches for several threads keeps one stream per thread. */
  protected swapFetchWait(w: Int32Array): void {
    const a = this.iWaitPc,
      b = this.iWait,
      c = this.seqPc;
    this.iWaitPc = w[0]!;
    this.iWait = w[1]!;
    this.seqPc = w[2]!;
    w[0] = a;
    w[1] = b;
    w[2] = c;
  }

  /** Cycles a miss of an L1 cache costs: the L2's hit time if the line is in it, else the full RAM penalty (and the line goes into the L2). */
  protected missCost(addr: number): number {
    const m = this.mem;
    return m.missCost(addr, m.shared ? m.now : this.cycleNo, this.v.counters, this.events, this.cycleNo);
  }
}
