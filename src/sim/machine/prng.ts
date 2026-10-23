// Seeded PRNG (mulberry32). The whole state is one uint32, so it can go straight into a save.

export class Prng {
  private s: number;

  constructor(seed = 1) {
    this.s = seed >>> 0;
  }

  /** Next uint32. */
  nextU32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Integer in [0, n). */
  nextInt(n: number): number {
    if (!Number.isInteger(n) || n <= 0) throw new RangeError(`nextInt(${n})`);
    return Math.floor(this.next() * n);
  }

  getState(): number {
    return this.s;
  }

  setState(state: number): void {
    this.s = state >>> 0;
  }
}
