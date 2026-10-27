// The DRAM behind the caches (docs/RAM.md): rows of memory in banks, each bank with one row open in its row buffer. An access to the open row is
// fast (a row hit), to a closed bank costs an activate (a row miss on an empty bank), to a different row costs a precharge and an activate
// (a row conflict). Banks are interleaved by row (consecutive rows sit in different banks, so a sequential scan keeps every bank on an open row).
// A refresh closes one bank's row every `refreshEvery` cycles, round robin. Times are CPU cycles; everything is deterministic and off unless an
// engine is given a `dram` setting (the game derives it from the installed RAM, apply.ts).

export interface DramSettings {
  /** Banks (power of two). */
  banks: number;
  /** Bytes per row (power of two): the unit the row buffer holds. */
  rowBytes: number;
  /** Cycles an access costs: to the open row, to a closed bank, to a bank with another row open. */
  hit: number;
  empty: number;
  conflict: number;
  /** One bank's row is closed by a refresh every this many cycles (0 = no refresh). */
  refreshEvery: number;
}

export const RowOutcome = { Hit: 0, Empty: 1, Conflict: 2, Refresh: 3 } as const;
export type RowOutcomeKind = (typeof RowOutcome)[keyof typeof RowOutcome];

export interface DramAccess {
  cycles: number;
  bank: number;
  row: number;
  /** The row that was open in the bank before (-1: none). */
  prev: number;
  outcome: RowOutcomeKind;
}

/** A change of a bank's open row, for the log: a refresh closes the row (row -1). */
export type DramLog = (cycle: number, bank: number, row: number, prev: number, outcome: RowOutcomeKind) => void;

export class Dram {
  readonly banks: number;
  readonly rowBytes: number;
  private readonly shift: number;
  private readonly bankMask: number;
  private readonly bankShift: number;
  private readonly open: Int32Array;
  private nextRefresh: number;
  private refreshBank = 0;

  constructor(readonly s: DramSettings) {
    const pow2 = (n: number) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
    if (!pow2(s.banks) || !pow2(s.rowBytes)) throw new RangeError("dram: banks and rowBytes must be powers of two");
    for (const k of ["hit", "empty", "conflict", "refreshEvery"] as const) if (!Number.isInteger(s[k]) || s[k] < 0) throw new RangeError(`dram: ${k} must be an integer >= 0`);
    this.banks = s.banks;
    this.rowBytes = s.rowBytes;
    this.shift = Math.log2(s.rowBytes);
    this.bankShift = Math.log2(s.banks);
    this.bankMask = s.banks - 1;
    this.open = new Int32Array(s.banks).fill(-1);
    this.nextRefresh = s.refreshEvery;
  }

  reset(): void {
    this.open.fill(-1);
    this.nextRefresh = this.s.refreshEvery;
    this.refreshBank = 0;
  }

  /** The bank and row an address lives in. */
  locate(addr: number): { bank: number; row: number } {
    const page = addr >>> this.shift;
    return { bank: page & this.bankMask, row: page >>> this.bankShift };
  }

  /** The open row of every bank (-1: closed). */
  openRows(): number[] { return Array.from(this.open); }

  /** Run the refreshes due by cycle `now`. */
  private refresh(now: number, log: DramLog | null): void {
    const every = this.s.refreshEvery;
    if (every <= 0) return;
    while (now >= this.nextRefresh) {
      const b = this.refreshBank;
      const prev = this.open[b]!;
      if (prev >= 0) { this.open[b] = -1; log?.(this.nextRefresh, b, -1, prev, RowOutcome.Refresh); }
      this.refreshBank = (b + 1) % this.banks;
      this.nextRefresh += every;
    }
  }

  /** An access at cycle `now`: what it costs, and the bank's row buffer changes. */
  access(addr: number, now: number, log: DramLog | null = null): DramAccess {
    this.refresh(now, log);
    const { bank, row } = this.locate(addr);
    const prev = this.open[bank]!;
    let outcome: RowOutcomeKind, cycles: number;
    if (prev === row) { outcome = RowOutcome.Hit; cycles = this.s.hit; }
    else if (prev < 0) { outcome = RowOutcome.Empty; cycles = this.s.empty; }
    else { outcome = RowOutcome.Conflict; cycles = this.s.conflict; }
    this.open[bank] = row;
    log?.(now, bank, row, prev, outcome);
    return { cycles, bank, row, prev, outcome };
  }
}
