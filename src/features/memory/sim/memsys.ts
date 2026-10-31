// The memory system behind the L1 caches: the shared L2 and the DRAM controller (docs/MULTICORE.md section 2). It answers "what does a miss at this
// address cost". An engine builds its own from its settings (a single-core CPU, every timing as before); a multicore Machine builds one and hands it
// to every engine, so the cores share one L2 and one set of banks. Events and counters go to the asking engine's log and view.

import { DataCache, Ev, Which, type EventLog } from "../../cpu/sim/engines/common";
import { Dram, type DramSettings } from "./dram";
import { Counter } from "../../cpu/sim/engines/view";

export interface MemSettings {
  /** Bytes per line (the L1 line size). */
  lineBytes: number;
  /** Cycles a miss that reaches RAM costs when there is no DRAM: the flat penalty. */
  missPenalty: number;
  /** L2 lines (power of two, 4-way); 0: none. */
  l2Lines: number;
  /** Cycles an L1 miss that hits the L2 costs. */
  l2Penalty: number;
  dram?: DramSettings;
}

/** What the memory system needs of a core to apply the coherence rule: its L1 caches, and where to count and log what happens to them. */
export interface CoreCaches {
  readonly cache: DataCache;
  readonly icache: DataCache | null;
  readonly counters: Float64Array;
  readonly events: EventLog;
}

export class MemSystem {
  readonly l2: DataCache | null;
  readonly l2Penalty: number;
  readonly dram: Dram | null;
  readonly missPenalty: number;
  /**
   * Shared by several cores (set by the Machine): the L2 takes one lookup per cycle, queued, and a store drops the line from the other cores' L1 caches.
   * Off for an engine's own system, so a single core's timings are exactly as before.
   */
  shared = false;
  /** The machine's CPU cycle number: the time base of a shared system (cores' own cycle counts differ when one is stalled). */
  now = 0;
  /** L2 lookups through the port, in total. */
  portBusy = 0;
  /** The first cycle the L2 port is free. */
  private portFree = 0;
  private readonly cores: CoreCaches[] = [];

  constructor(s: MemSettings) {
    this.missPenalty = s.missPenalty;
    this.l2 = s.l2Lines ? new DataCache(s.l2Lines, s.lineBytes, s.missPenalty, Math.min(4, s.l2Lines)) : null;
    this.l2Penalty = s.l2Penalty;
    this.dram = s.dram ? new Dram(s.dram) : null;
    if (!Number.isInteger(this.l2Penalty) || this.l2Penalty < 0) throw new RangeError("l2Penalty must be an integer >= 0");
  }

  /** Cold L2 and closed rows, no cores joined. */
  reset(): void {
    this.l2?.invalidate();
    this.dram?.reset();
    this.now = 0;
    this.portBusy = 0;
    this.portFree = 0;
    this.cores.length = 0;
  }

  /** Drop every L2 line. */
  invalidate(): void { this.l2?.invalidate(); }

  /** A core's caches take part in the coherence rule (an engine calls this from its reset when the system is shared). */
  join(core: CoreCaches): void {
    const i = this.cores.findIndex((c) => c.counters === core.counters);
    if (i >= 0) this.cores[i] = core;
    else this.cores.push(core);
  }

  /**
   * Cycles a miss of an L1 cache costs at `cycle`: the L2's hit time if the line is in it, else the full RAM cost (and the line goes into the L2).
   * The L2 and DRAM events are logged to `events` (stamped `logCycle`) and counted in `counters` (the asking engine's). On a shared system the
   * lookup also waits for the L2 port, one lookup per cycle; the wait is part of the cost and counts in `StallL2Port`.
   */
  missCost(addr: number, cycle: number, counters: Float64Array, events: EventLog, logCycle = cycle): number {
    const l2 = this.l2;
    if (!l2) return this.ramCost(addr, cycle, counters, events, logCycle);
    let wait = 0;
    if (this.shared) {
      const start = Math.max(cycle, this.portFree);
      wait = start - cycle;
      this.portFree = start + 1;
      this.portBusy++;
      counters[Counter.L2PortBusy]!++;
      counters[Counter.StallL2Port]! += wait;
    }
    if (l2.hit(addr)) { counters[Counter.L2Hits]!++; events.push(logCycle, Ev.Hit, Which.L2, l2.lastSlot, addr >>> l2.lineShift, 0); return wait + this.l2Penalty; }
    counters[Counter.L2Misses]!++;
    l2.fill(addr);
    events.push(logCycle, Ev.Fill, Which.L2, l2.lastSlot, addr >>> l2.lineShift, l2.lastEvicted);
    return wait + this.ramCost(addr, cycle + wait, counters, events, logCycle);
  }

  /**
   * The invalidate-on-write rule (docs/MULTICORE.md section 3): a store (or atomic) by `writer` landed in RAM at `addr`, so every other core drops
   * the line from its L1 D and L1 I if it has it. The L2 is shared and keeps it. The next load there misses and pays the L2 cost.
   */
  storeLanded(writer: CoreCaches, addr: number, logCycle: number): void {
    const from = this.cores.indexOf(writer);
    for (const c of this.cores) {
      if (c === writer) continue;
      if (c.cache.drop(addr)) {
        c.counters[Counter.CoherenceInvals]!++;
        c.events.push(logCycle, Ev.Inval, Which.D, c.cache.lastSlot, addr >>> c.cache.lineShift, from);
      }
      const ic = c.icache;
      if (ic && ic.drop(addr)) {
        c.counters[Counter.CoherenceInvals]!++;
        c.events.push(logCycle, Ev.Inval, Which.I, ic.lastSlot, addr >>> ic.lineShift, from);
      }
    }
  }

  /** What reaching RAM costs: the flat penalty, or the DRAM's answer (a row hit, an activate, a conflict), which is logged for the die. */
  private ramCost(addr: number, cycle: number, counters: Float64Array, events: EventLog, logCycle: number): number {
    const d = this.dram;
    if (!d) return this.missPenalty;
    const a = d.access(addr, cycle, (cyc, bank, row, prev, outcome) => events.push(this.shared ? logCycle : cyc, Ev.Row, bank, row, prev, outcome));
    counters[a.outcome === 0 ? Counter.RowHits : a.outcome === 1 ? Counter.RowEmpty : Counter.RowConflicts]!++;
    return a.cycles;
  }
}
