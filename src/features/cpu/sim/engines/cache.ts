// The L1 cache model of the timed engines (and of the GPU's and the memory system's caches): tags only, LRU within a set.

/** A cache's shape: line count and size (powers of two), the miss penalty, and the lines per set (default 1: direct mapped). */
export interface CacheShape {
  lines: number;
  lineBytes: number;
  missPenalty: number;
  ways?: number;
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
  /** Slots another core's store dropped (their tag stays so the next miss on the line can be told apart), and how many are marked. */
  private readonly dropped: Uint8Array;
  private droppedN = 0;
  /** Slot (set * ways + way) of the last hit or fill, and the line number the last fill evicted (-1: none). For the die view. */
  lastSlot = 0;
  lastEvicted = -1;
  readonly lines: number;
  readonly lineBytes: number;
  readonly missPenalty: number;
  readonly ways: number;
  constructor(shape: Readonly<CacheShape>) {
    const { lines, lineBytes, missPenalty, ways = 1 } = shape;
    if (lines < 1 || (lines & (lines - 1)) !== 0) {
      throw new RangeError('cache lines must be a power of two');
    }
    if (lineBytes < 4 || (lineBytes & (lineBytes - 1)) !== 0) {
      throw new RangeError('cache line size must be a power of two >= 4');
    }
    if (missPenalty < 0 || !Number.isInteger(missPenalty)) {
      throw new RangeError('missPenalty must be an integer >= 0');
    }
    if (ways < 1 || (ways & (ways - 1)) !== 0 || ways > lines) {
      throw new RangeError('cache ways must be a power of two no larger than the line count');
    }
    this.lines = lines;
    this.lineBytes = lineBytes;
    this.missPenalty = missPenalty;
    this.ways = ways;
    this.tags = new Uint32Array(lines);
    this.valid = new Uint8Array(lines);
    this.used = new Uint32Array(lines);
    this.dropped = new Uint8Array(lines);
    this.shift = Math.log2(lineBytes);
    this.setMask = lines / ways - 1;
  }
  invalidate(): void {
    this.valid.fill(0);
    this.used.fill(0);
    this.clock = 0;
    this.dropped.fill(0);
    this.droppedN = 0;
  }
  /** Another core stored to this line: drop it if held (true), remembering that coherence took it. */
  drop(addr: number): boolean {
    const line = addr >>> this.shift;
    const base = (line & this.setMask) * this.ways;
    for (let w = 0; w < this.ways; w++) {
      const i = base + w;
      if (this.valid[i] === 1 && this.tags[i] === line) {
        this.valid[i] = 0;
        this.lastSlot = i;
        if (this.dropped[i] === 0) {
          this.dropped[i] = 1;
          this.droppedN++;
        }
        return true;
      }
    }
    return false;
  }
  /** Whether a miss on this line is because coherence dropped it (the mark is consumed). */
  takeDropped(addr: number): boolean {
    if (this.droppedN === 0) {
      return false;
    }
    const line = addr >>> this.shift;
    const base = (line & this.setMask) * this.ways;
    for (let w = 0; w < this.ways; w++) {
      const i = base + w;
      if (this.dropped[i] === 1 && this.tags[i] === line) {
        this.dropped[i] = 0;
        this.droppedN--;
        return true;
      }
    }
    return false;
  }
  hit(addr: number): boolean {
    const line = addr >>> this.shift;
    const base = (line & this.setMask) * this.ways;
    for (let w = 0; w < this.ways; w++) {
      const i = base + w;
      if (this.valid[i] === 1 && this.tags[i] === line) {
        if (this.ways > 1) {
          this.used[i] = ++this.clock;
        }
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
      if (this.valid[i] === 1 && this.tags[i] === line) {
        victim = i;
        break;
      } // already there
      if (this.valid[i] === 0) {
        victim = i;
        break;
      }
      if ((this.used[i] ?? 0) < (this.used[victim] ?? 0)) {
        victim = i;
      }
    }
    if (this.droppedN > 0 && this.dropped[victim] === 1) {
      this.dropped[victim] = 0;
      this.droppedN--;
    }
    this.lastEvicted = this.valid[victim] === 1 && this.tags[victim] !== line ? (this.tags[victim] ?? -1) : -1;
    this.lastSlot = victim;
    this.valid[victim] = 1;
    this.tags[victim] = line;
    this.used[victim] = ++this.clock;
  }
  /** The line number held in each slot (address >> log2(lineBytes)), -1 where the slot is empty. */
  dump(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.lines; i++) {
      out.push(this.valid[i] === 1 ? (this.tags[i] ?? -1) : -1);
    }
    return out;
  }
  /** Bytes per line, as a shift. */
  get lineShift(): number {
    return this.shift;
  }
}
