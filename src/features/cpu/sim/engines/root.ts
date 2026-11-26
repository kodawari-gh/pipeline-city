// The root of the timed engines' class chain (`EngineRoot` <- `EngineFetch` <- `EngineBase`): the state both engines share, reset and
// threads, the logged register, cache and predictor writes, and the cost of an L1 miss. Split out of the engines' shared module (#133).

import type { Core } from '../core';
import type { Machine } from '@/core/sim/machine';
import type { EngineNote } from '@/core/sim/engine';
import { Counter, ViewState } from './view';
import * as memsys from '@/features/memory/sim/memsys';
import { DataCache } from './cache';
import { Ev, EventLog, Which } from './events';
import { Predictor } from './predictor';
import { InstrPool, POOL } from './pool';
import type { CacheState, EngineSettings, EngineState, PipelineEngine } from './contract';

/** What the die view shows of one cache. */
function cacheState(x: DataCache): CacheState {
  return {
    lines: x.lines,
    ways: x.ways,
    lineBytes: 1 << x.lineShift,
    tags: x.dump(),
  };
}

/** State and helpers shared by both engines. */
export abstract class EngineRoot implements PipelineEngine {
  protected readonly v: ViewState;
  protected readonly pool: InstrPool;
  protected readonly cache: DataCache;
  protected readonly icache: DataCache | null;
  /** The L2 and the DRAM behind the L1 caches: built from the settings, or shared with other cores (`useMemSystem`). */
  protected mem: memsys.MemSystem;
  private ownsMem = true;
  protected readonly pred: Predictor;
  /** Whether the engine predicts branches: `flipPredictor` flips its predictor only then. */
  protected readonly predicts: boolean = true;
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
  protected bus!: Machine['bus'];
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
    this.cache = new DataCache({ lines: s.cacheLines ?? 8, lineBytes, missPenalty: penalty, ways: s.ways ?? 1 });
    // no instruction cache when the setting is missing, 0 or NaN
    const icacheLines = s.icacheLines ?? 0;
    this.icache =
      icacheLines !== 0 && !Number.isNaN(icacheLines)
        ? new DataCache({ lines: icacheLines, lineBytes, missPenalty: penalty })
        : null;
    this.mem = new memsys.MemSystem({
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
  protected readonly port: memsys.CoreCaches;

  get view(): PipelineEngine['view'] {
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
  /** Make thread `t`'s registers, MMU and interrupt state the ones the engine's helpers use. */
  protected useThread(t: number): void {
    const c = this.cores[t];
    if (c === undefined) {
      throw new RangeError(`no thread ${String(t)} on this core`);
    }
    if (c !== this.core) {
      this.core = c;
      this.regs = c.regs;
    }
  }
  /** The machine tells the engine about something that happened outside it (an interrupt taken, an address space switched) so the event log shows it in order. */
  note(n: Readonly<EngineNote>): void {
    this.events.record({ cycle: this.cycleNo, kind: n.kind, a: n.a, b: n.b, c: n.c, d: 0 });
  }
  /** No instruction in flight (see `Engine.drained`). */
  abstract get drained(): boolean;
  /** The L2 and DRAM this engine reaches (its own, or the shared one it was given). */
  get memSystem(): memsys.MemSystem {
    return this.mem;
  }
  /** Use a memory system shared with other cores instead of the engine's own (before `reset`). Its owner resets it. */
  useMemSystem(mem: memsys.MemSystem): void {
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
  flipPredictor(pc?: number): void {
    if (this.predicts) {
      this.pred.flip(pc);
    }
  }
  storedState(): EngineState {
    const { l2, dram } = this.mem;
    return {
      regs: [...(this.regs ?? [])],
      d: cacheState(this.cache),
      ...(this.icache ? { i: cacheState(this.icache) } : {}),
      ...(l2 ? { l2: cacheState(l2) } : {}),
      pred: { entries: this.pred.entries, bits: this.pred.bits, table: this.pred.dump() },
      ...(dram
        ? { dram: { channels: dram.channels, banks: dram.banks, rowBytes: dram.rowBytes, open: dram.openRows() } }
        : {}),
      events: this.events,
    };
  }

  /** Write a register and log it (the die shows the register file filling in). */
  protected writeReg(r: number, value: number): void {
    this.events.record({ cycle: this.cycleNo, kind: Ev.Reg, a: r, b: value, c: this.regs[r] ?? 0, d: 0 });
    this.regs[r] = value;
  }

  /** The data cache lookup and fill, logged. */
  protected dHit(addr: number): boolean {
    const h = this.cache.hit(addr);
    if (h) {
      this.events.record({
        cycle: this.cycleNo,
        kind: Ev.Hit,
        a: Which.D,
        b: this.cache.lastSlot,
        c: addr >>> this.cache.lineShift,
        d: 0,
      });
    } else if (this.mem.shared && this.cache.takeDropped(addr)) {
      this.bump(Counter.CoherenceMisses);
    }
    return h;
  }
  protected dFill(addr: number): void {
    this.cache.fill(addr);
    this.events.record({
      cycle: this.cycleNo,
      kind: Ev.Fill,
      a: Which.D,
      b: this.cache.lastSlot,
      c: addr >>> this.cache.lineShift,
      d: this.cache.lastEvicted,
    });
  }
  /** A load (kind 0) or a store (kind 1) of the data side: address and value. */
  protected logMem(kind: number, addr: number, value: number): void {
    this.events.record({ cycle: this.cycleNo, kind: Ev.Mem, a: kind, b: addr, c: value, d: 0 });
    if (kind === 1 && this.mem.shared && addr < this.ramSize) {
      this.mem.storeLanded(this.port, addr, this.cycleNo);
    } // the store has landed in RAM: other cores drop the line
  }
  /** Train the predictor and log the counter's change. */
  protected trainPred(pc: number, taken: boolean): void {
    const old = this.pred.get(pc);
    this.pred.train(pc, taken);
    this.events.record({
      cycle: this.cycleNo,
      kind: Ev.Pred,
      a: (pc >>> 2) % this.pred.entries,
      b: this.pred.get(pc),
      c: old,
      d: 0,
    });
  }

  invalidateCache(): void {
    this.cache.invalidate();
    this.icache?.invalidate();
    this.mem.invalidate();
  }

  reset(machine: Machine, program: Uint32Array, first?: Core): void {
    const core = first ?? machine.cores[0];
    if (core === undefined) {
      throw new RangeError('the machine has no core');
    }
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
  /** The engine's own part of `reset`. */
  protected abstract onReset(): void;
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
    this.iWaitPc = w[0] ?? -1;
    this.iWait = w[1] ?? 0;
    this.seqPc = w[2] ?? -1;
    w[0] = a;
    w[1] = b;
    w[2] = c;
  }

  /** Count one more of `counter` in the view's counters. */
  protected bump(counter: number): void {
    const c = this.v.counters;
    c[counter] = (c[counter] ?? 0) + 1;
  }

  /** Cycles a miss of an L1 cache costs: the L2's hit time if the line is in it, else the full RAM penalty (and the line goes into the L2). */
  protected missCost(addr: number): number {
    const m = this.mem;
    return m.missCost(addr, m.shared ? m.now : this.cycleNo, this.v.counters, this.events, this.cycleNo);
  }
}
