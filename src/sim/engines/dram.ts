// The DRAM behind the caches and the memory controller in front of it (docs/RAM.md). Memory is cut into rows (a page, `rowBytes`) held in banks,
// banks are grouped, and the pages are interleaved over channels (one per stick the CPU can drive at once). Each bank has one row open in its row
// buffer; an access costs tCL when that row is open (a row hit), tRCD + tCL when the bank is closed, tRP + tRCD + tCL when another row is open (a
// conflict), plus `burst` cycles to move the line over the channel's data bus. A channel's bus carries one burst at a time and wants a longer gap
// between two bursts of the same bank group (ccdL) than of different ones (ccdS), so back to back misses queue; a refresh closes one bank's row
// and keeps the bank busy for tRFC. The page policy decides what happens to a row after its access: `open` keeps it, `closed` precharges at once
// (no conflicts, never a hit), `adaptive` closes a bank's row after an access that was a conflict (random access) and keeps it otherwise.
// Times are CPU cycles; everything is deterministic and off unless an engine is given a `dram` setting (the game derives it, apply.ts).

export type PagePolicy = "open" | "closed" | "adaptive";

export interface DramSettings {
  /** Channels (power of two): pages alternate between them, each has its own data bus and banks. */
  channels: number;
  /** Banks per channel (power of two) in `bankGroups` groups; bank b is in group b % bankGroups. */
  banks: number;
  bankGroups: number;
  /** Bytes per row (power of two). */
  rowBytes: number;
  /** Row access timings in CPU cycles: column access (the open row), row activate, precharge. */
  tCL: number;
  tRCD: number;
  tRP: number;
  /** Cycles a line takes on the channel's data bus, and the gap between two bursts of different / the same bank group. */
  burst: number;
  ccdS: number;
  ccdL: number;
  /** One bank is refreshed every `refreshEvery` cycles (round robin over every channel's banks; 0 = no refresh) and is busy for `tRFC`. */
  refreshEvery: number;
  tRFC: number;
  policy: PagePolicy;
}

export const RowOutcome = { Hit: 0, Empty: 1, Conflict: 2, Refresh: 3 } as const;
export type RowOutcomeKind = (typeof RowOutcome)[keyof typeof RowOutcome];

export interface DramAccess {
  /** Cycles from the request to the line being in the CPU. */
  cycles: number;
  channel: number;
  /** Bank index over all channels (channel * banks + bank). */
  bank: number;
  row: number;
  /** The row that was open in the bank before (-1: none). */
  prev: number;
  outcome: RowOutcomeKind;
}

/** A change of a bank's open row, for the log: a refresh or the closed policy closes the row (row -1). */
export type DramLog = (cycle: number, bank: number, row: number, prev: number, outcome: RowOutcomeKind) => void;

const pow2 = (n: number) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

export class Dram {
  readonly channels: number;
  readonly banks: number;
  readonly rowBytes: number;
  private readonly shift: number;
  private readonly chanMask: number;
  private readonly chanShift: number;
  private readonly bankMask: number;
  private readonly bankShift: number;
  private readonly open: Int32Array;
  private readonly bankBusy: Float64Array;
  private readonly busBusy: Float64Array;
  private readonly lastGroup: Int32Array;
  private nextRefresh: number;
  private refreshAt = 0;

  constructor(readonly s: DramSettings) {
    if (!pow2(s.channels) || !pow2(s.banks) || !pow2(s.rowBytes) || !pow2(s.bankGroups)) throw new RangeError("dram: channels, banks, bankGroups and rowBytes must be powers of two");
    if (s.bankGroups > s.banks) throw new RangeError("dram: more bank groups than banks");
    for (const k of ["tCL", "tRCD", "tRP", "burst", "ccdS", "ccdL", "refreshEvery", "tRFC"] as const) if (!Number.isInteger(s[k]) || s[k] < 0) throw new RangeError(`dram: ${k} must be an integer >= 0`);
    this.channels = s.channels;
    this.banks = s.banks;
    this.rowBytes = s.rowBytes;
    this.shift = Math.log2(s.rowBytes);
    this.chanMask = s.channels - 1;
    this.chanShift = Math.log2(s.channels);
    this.bankMask = s.banks - 1;
    this.bankShift = Math.log2(s.banks);
    const n = s.channels * s.banks;
    this.open = new Int32Array(n).fill(-1);
    this.bankBusy = new Float64Array(n);
    this.busBusy = new Float64Array(s.channels);
    this.lastGroup = new Int32Array(s.channels).fill(-1);
    this.nextRefresh = s.refreshEvery;
  }

  reset(): void {
    this.open.fill(-1);
    this.bankBusy.fill(0);
    this.busBusy.fill(0);
    this.lastGroup.fill(-1);
    this.nextRefresh = this.s.refreshEvery;
    this.refreshAt = 0;
  }

  /** Where an address lives: pages alternate between channels, then between banks. */
  locate(addr: number): { channel: number; bank: number; row: number } {
    const page = addr >>> this.shift;
    const channel = page & this.chanMask, p = page >>> this.chanShift;
    return { channel, bank: channel * this.banks + (p & this.bankMask), row: p >>> this.bankShift };
  }

  /** The page number whose row is `row` in bank index `bank` (over all channels): the inverse of `locate`, for drawing. */
  pageOf(bank: number, row: number): number {
    const channel = Math.floor(bank / this.banks), b = bank % this.banks;
    return (((row << this.bankShift) | b) << this.chanShift) | channel;
  }

  /** The open row of every bank over all channels (-1: closed). */
  openRows(): number[] { return Array.from(this.open); }

  private refresh(now: number, log: DramLog | null): void {
    const every = this.s.refreshEvery;
    if (every <= 0) return;
    const total = this.open.length;
    while (now >= this.nextRefresh) {
      const b = this.refreshAt;
      const prev = this.open[b]!;
      if (prev >= 0) { this.open[b] = -1; log?.(this.nextRefresh, b, -1, prev, RowOutcome.Refresh); }
      this.bankBusy[b] = Math.max(this.bankBusy[b]!, this.nextRefresh + this.s.tRFC);
      this.refreshAt = (b + 1) % total;
      this.nextRefresh += every;
    }
  }

  /** An access at cycle `now`: what it costs until the line arrives, and the bank, the channel's bus and the row buffer change. */
  access(addr: number, now: number, log: DramLog | null = null): DramAccess {
    this.refresh(now, log);
    const s = this.s;
    const { channel, bank, row } = this.locate(addr);
    const group = (bank % this.banks) % s.bankGroups;
    const prev = this.open[bank]!;
    let outcome: RowOutcomeKind, work: number;
    if (prev === row) { outcome = RowOutcome.Hit; work = s.tCL; }
    else if (prev < 0) { outcome = RowOutcome.Empty; work = s.tRCD + s.tCL; }
    else { outcome = RowOutcome.Conflict; work = s.tRP + s.tRCD + s.tCL; }
    // the bank must be free (a refresh keeps it busy), then the row work; the burst needs the channel's bus after the previous burst and its gap
    const gap = this.lastGroup[channel] === group ? s.ccdL : s.ccdS;
    const start = Math.max(now, this.bankBusy[bank]!);
    const dataAt = Math.max(start + work, this.busBusy[channel]! + gap);
    const done = dataAt + s.burst;
    this.busBusy[channel] = done;
    this.lastGroup[channel] = group;
    this.bankBusy[bank] = start + work;
    const closeNow = s.policy === "closed" || (s.policy === "adaptive" && outcome === RowOutcome.Conflict);
    this.open[bank] = closeNow ? -1 : row;
    log?.(now, bank, closeNow ? -1 : row, prev, outcome);
    return { cycles: Math.ceil(done - now), channel, bank, row, prev, outcome };
  }
}
