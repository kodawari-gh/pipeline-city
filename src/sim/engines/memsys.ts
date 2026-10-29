// The memory system behind the L1 caches: the shared L2 and the DRAM controller (docs/MULTICORE.md section 2). It answers "what does a miss at this
// address cost". An engine builds its own from its settings (a single-core CPU, every timing as before); a multicore Machine builds one and hands it
// to every engine, so the cores share one L2 and one set of banks. Events and counters go to the asking engine's log and view.

import { DataCache, Ev, Which, type EventLog } from "./common";
import { Dram, type DramSettings } from "./dram";
import { Counter } from "./view";

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

export class MemSystem {
  readonly l2: DataCache | null;
  readonly l2Penalty: number;
  readonly dram: Dram | null;
  readonly missPenalty: number;

  constructor(s: MemSettings) {
    this.missPenalty = s.missPenalty;
    this.l2 = s.l2Lines ? new DataCache(s.l2Lines, s.lineBytes, s.missPenalty, Math.min(4, s.l2Lines)) : null;
    this.l2Penalty = s.l2Penalty;
    this.dram = s.dram ? new Dram(s.dram) : null;
    if (!Number.isInteger(this.l2Penalty) || this.l2Penalty < 0) throw new RangeError("l2Penalty must be an integer >= 0");
  }

  /** Cold L2 and closed rows. */
  reset(): void {
    this.l2?.invalidate();
    this.dram?.reset();
  }

  /** Drop every L2 line. */
  invalidate(): void { this.l2?.invalidate(); }

  /**
   * Cycles a miss of an L1 cache costs at `cycle`: the L2's hit time if the line is in it, else the full RAM cost (and the line goes into the L2).
   * The L2 and DRAM events are logged to `events` and counted in `counters` (the asking engine's).
   */
  missCost(addr: number, cycle: number, counters: Float64Array, events: EventLog): number {
    const l2 = this.l2;
    if (!l2) return this.ramCost(addr, cycle, counters, events);
    if (l2.hit(addr)) { counters[Counter.L2Hits]!++; events.push(cycle, Ev.Hit, Which.L2, l2.lastSlot, addr >>> l2.lineShift, 0); return this.l2Penalty; }
    counters[Counter.L2Misses]!++;
    l2.fill(addr);
    events.push(cycle, Ev.Fill, Which.L2, l2.lastSlot, addr >>> l2.lineShift, l2.lastEvicted);
    return this.ramCost(addr, cycle, counters, events);
  }

  /** What reaching RAM costs: the flat penalty, or the DRAM's answer (a row hit, an activate, a conflict), which is logged for the die. */
  private ramCost(addr: number, cycle: number, counters: Float64Array, events: EventLog): number {
    const d = this.dram;
    if (!d) return this.missPenalty;
    const a = d.access(addr, cycle, (cyc, bank, row, prev, outcome) => events.push(cyc, Ev.Row, bank, row, prev, outcome));
    counters[a.outcome === 0 ? Counter.RowHits : a.outcome === 1 ? Counter.RowEmpty : Counter.RowConflicts]!++;
    return a.cycles;
  }
}
