// The GPU memory path (docs/GPU.md sections 4 and 5), pure timing: no data moves here, card memory stays the one flat array and the engines
// read and write it themselves. A memory instruction hands in the byte addresses of its active lanes and gets back what it costs.
//
//   coalescer  the addresses fall into lines of `lineWords` words; lanes in one line share one access, lanes on one address are a broadcast
//   arbiter    line L lives in bank L % banks; a bank serves one line per cycle, so the busiest bank sets the number of rounds
//   caches     optional tag-only L1 (one per SM) and one shared L2, on the CPU's `DataCache` (write-through, a store never fills a line);
//              a line that hits in L1 returns after `l1Hit`, else asks the L2 (one request per cycle for the whole card), else card memory

import { DataCache } from "../../cpu/sim/engines/common";

export interface GpuMemConfig {
  /** Memory banks a memory unit has. */
  banks: number;
  /** Words per line the coalescer groups lanes into (a power of two); 1 makes every distinct address its own line. */
  lineWords: number;
  /** Cycles from the last round of a load to its result when it goes to card memory. */
  globalLatency: number;
  /** SMs, each with its own L1 (default 1). */
  sms?: number;
  /** L1 lines per SM and the cycles an L1 hit takes; 0 lines = no L1. */
  l1Lines?: number;
  l1Hit?: number;
  /** Shared L2 lines and the cycles an L2 hit takes (after its port); 0 lines = no L2. */
  l2Lines?: number;
  l2Hit?: number;
}

/** What one access costs. */
export interface MemAccess {
  /** Distinct line numbers touched, ascending. */
  lines: number[];
  /** Lines each bank has to serve, `banks` entries. */
  perBank: number[];
  /** Cycles the memory unit is busy: the busiest bank's line count, at least 1. */
  rounds: number;
  /** Cycles from the issue until the data is back (loads); 0 for a store or an access with no lane. */
  latency: number;
  l1Hits: number;
  l2Hits: number;
  /** Lines that went all the way to card memory. */
  misses: number;
}

/** Distinct line numbers for byte addresses, ascending. */
export function coalesce(addrs: readonly number[], lineWords: number): number[] {
  const seen = new Set<number>();
  for (const a of addrs) seen.add(Math.floor(a / 4 / lineWords));
  return [...seen].sort((a, b) => a - b);
}

/** Lines per bank (line % banks). */
export function arbitrate(lines: readonly number[], banks: number): number[] {
  const per = new Array<number>(banks).fill(0);
  for (const l of lines) per[l % banks]!++;
  return per;
}

export class GpuMemSystem {
  readonly l1: (DataCache | null)[];
  readonly l2: DataCache | null;
  /** The first cycle the shared L2 port is free (a request occupies it for one cycle). */
  private l2Free = 0;
  loads = 0;
  stores = 0;
  l1Hits = 0;
  l1Misses = 0;
  l2Hits = 0;
  l2Misses = 0;

  constructor(readonly cfg: GpuMemConfig) {
    if (cfg.banks < 1) throw new RangeError("a memory unit needs at least one bank");
    if (cfg.lineWords < 1 || (cfg.lineWords & (cfg.lineWords - 1)) !== 0) throw new RangeError("lineWords must be a power of two");
    const lineBytes = Math.max(4, cfg.lineWords * 4);
    this.l1 = Array.from({ length: cfg.sms ?? 1 }, () => ((cfg.l1Lines ?? 0) > 0 ? new DataCache(cfg.l1Lines!, lineBytes, 0) : null));
    this.l2 = (cfg.l2Lines ?? 0) > 0 ? new DataCache(cfg.l2Lines!, lineBytes, 0) : null;
  }

  /** Cold caches and a free L2 port, as at power-on. The counters keep counting. */
  invalidate(): void {
    for (const c of this.l1) c?.invalidate();
    this.l2?.invalidate();
    this.l2Free = 0;
  }

  /** A load issued by SM `sm` at card cycle `now`, `addrs` the byte addresses of its active lanes. */
  load(sm: number, addrs: readonly number[], now: number): MemAccess {
    this.loads++;
    const { banks, lineWords, globalLatency } = this.cfg;
    const lines = coalesce(addrs, lineWords);
    const perBank = arbitrate(lines, banks);
    const rounds = Math.max(1, ...perBank);
    const l1 = this.l1[sm] ?? null;
    const served = new Array<number>(banks).fill(0); // lines of each bank served so far: the j-th one leaves in round j
    let latency = 0, l1Hits = 0, l2Hits = 0, misses = 0;
    for (const line of lines) {
      const round = served[line % banks]!++, addr = line * lineWords * 4;
      let ready = round; // cycles after the issue at which this line's data is back
      if (l1?.hit(addr)) {
        ready += this.cfg.l1Hit ?? 1;
        l1Hits++;
      } else {
        if (l1) this.l1Misses++;
        if (this.l2) {
          const start = Math.max(now + round, this.l2Free);
          this.l2Free = start + 1;
          ready = start - now;
          if (this.l2.hit(addr)) {
            ready += this.cfg.l2Hit ?? 1;
            l2Hits++;
          } else {
            this.l2.fill(addr);
            ready += globalLatency;
            misses++;
          }
        } else {
          ready += globalLatency;
          misses++;
        }
        l1?.fill(addr);
      }
      latency = Math.max(latency, ready);
    }
    this.l1Hits += l1Hits;
    this.l2Hits += l2Hits;
    this.l2Misses += misses;
    return { lines, perBank, rounds, latency: lines.length ? latency + 1 : 0, l1Hits, l2Hits, misses };
  }

  /** A store: write-through, no fill. It occupies the memory unit for its rounds and leaves nothing to wait for. */
  store(addrs: readonly number[]): MemAccess {
    this.stores++;
    const lines = coalesce(addrs, this.cfg.lineWords);
    const perBank = arbitrate(lines, this.cfg.banks);
    return { lines, perBank, rounds: Math.max(1, ...perBank), latency: 0, l1Hits: 0, l2Hits: 0, misses: 0 };
  }
}
