// The timed engines' branch predictor.

/** Branch predictor: `entries` saturating counters of `bits` (1 or 2) indexed by (pc >> 2) % entries. All start at "not taken". */
export class Predictor {
  private readonly t: Uint8Array;
  constructor(
    readonly entries = 64,
    readonly bits = 1,
  ) {
    if (!Number.isInteger(entries) || entries < 1) {
      throw new RangeError('predictor entries must be an integer >= 1');
    }
    if (bits !== 1 && bits !== 2) {
      throw new RangeError('predictor bits must be 1 or 2');
    }
    this.t = new Uint8Array(entries);
  }
  reset(): void {
    this.t.fill(0);
  }
  /** The counter of the entry for `pc`. */
  get(pc: number): number {
    return this.t[(pc >>> 2) % this.entries] ?? 0;
  }
  dump(): number[] {
    return [...this.t];
  }
  predict(pc: number): boolean {
    return (this.t[(pc >>> 2) % this.entries] ?? 0) >= (this.bits === 2 ? 2 : 1);
  }
  train(pc: number, taken: boolean): void {
    const i = (pc >>> 2) % this.entries;
    if (this.bits === 1) {
      this.t[i] = taken ? 1 : 0;
    } else {
      const n = this.t[i] ?? 0;
      this.t[i] = taken ? Math.min(3, n + 1) : Math.max(0, n - 1);
    }
  }
  /** Flip the prediction of the entry for `pc` (every entry if omitted), keeping its strength. */
  flip(pc?: number): void {
    const x = this.bits === 2 ? 2 : 1;
    if (pc === undefined) {
      for (let i = 0; i < this.entries; i++) {
        this.t[i] = (this.t[i] ?? 0) ^ x;
      }
    } else {
      const i = (pc >>> 2) % this.entries;
      this.t[i] = (this.t[i] ?? 0) ^ x;
    }
  }
}
