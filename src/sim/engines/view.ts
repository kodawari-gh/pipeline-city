// Observability for the timed engines: typed-array views only (no per-instruction objects). See docs/ENGINES.md.

export const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;
export const Stage = { IF: 0, ID: 1, EX: 2, MEM: 3, WB: 4 } as const;

/** What occupies a stage this cycle. */
export const SlotKind = { Empty: 0, Instr: 1, Bubble: 2 } as const;

/** Why a bubble exists. */
export const Cause = { None: 0, Load: 1, Data: 2, Flush: 3, Struct: 4 } as const;

/** Timeline cell codes. Index into STAGE_CODE_CHARS for the letter. */
export const StageCode = { None: 0, F: 1, D: 2, X: 3, M: 4, W: 5, Flushed: 6 } as const;
export const STAGE_CODE_CHARS = " FDXMWx";

/** Timeline row fate. */
export const Fate = { InFlight: 0, Retired: 1, Flushed: 2 } as const;

/** Indices into `view.counters`. */
export const Counter = {
  Cycles: 0,
  Retired: 1,
  /** Bubbles injected by load-use hazards (forwarding on). */
  StallLoad: 2,
  /** Bubbles injected waiting for an earlier result (forwarding off). */
  StallData: 3,
  /** Flush bubbles after a mispredicted control transfer (2 per flush). */
  StallFlush: 4,
  /** Fetch bubbles lost to the shared memory port. */
  StallStruct: 5,
  /** Cycles the pipeline was frozen by a data cache miss. */
  StallCache: 6,
  /** Mispredicted control transfers (branch, jalr). */
  Flushes: 7,
  /** Wrong-path instructions squashed by flushes (and by ecall). */
  FlushedInstrs: 8,
  /** Conditional branches resolved. */
  Branches: 9,
  /** Conditional branches mispredicted. */
  BranchMispredicts: 10,
  CacheHits: 11,
  CacheMisses: 12,
} as const;
export const COUNTER_NAMES = [
  "cycles", "retired", "stallLoad", "stallData", "stallFlush", "stallStruct", "stallCache",
  "flushes", "flushedInstrs", "branches", "branchMispredicts", "cacheHits", "cacheMisses",
] as const;
export const COUNTER_COUNT = COUNTER_NAMES.length;

/** Cause -> stall counter index. */
export const CAUSE_COUNTER = [0, Counter.StallLoad, Counter.StallData, Counter.StallFlush, Counter.StallStruct] as const;

/**
 * Ring buffer of the last `rows` instructions (row = id % rows) by `cols` cycles (column = cycle % cols).
 * A cell is valid if its row's `id` matches and the cycle is within the last `cols` cycles.
 * cell(row, cycle) = codes[row * cols + cycle % cols]; 0 = nothing.
 */
export interface TimelineView {
  readonly rows: number;
  readonly cols: number;
  /** Dynamic instruction id in each row, -1 if unused. */
  readonly id: Int32Array;
  readonly pc: Uint32Array;
  /** Raw instruction word (disassemble with src/sim/isa). */
  readonly word: Uint32Array;
  /** Fate enum. */
  readonly fate: Uint8Array;
  readonly codes: Uint8Array;
}

/** Read-only observability surface of an engine. All arrays are live (mutated in place every cycle): read, do not write. */
export interface EngineView {
  readonly stageNames: readonly string[];
  /** Per stage (IF ID EX MEM WB): SlotKind. */
  readonly stageKind: Uint8Array;
  /** Per stage: dynamic instruction id (-1 if empty or bubble). */
  readonly stageId: Int32Array;
  /** Per stage: pc of the occupant (0 for non-instructions). */
  readonly stagePc: Uint32Array;
  /** Per stage: Cause of a bubble (Cause.None otherwise). */
  readonly stageCause: Uint8Array;
  /** Per stage: 1 if the occupant is held this cycle (hazard stall or cache freeze). */
  readonly stageStalled: Uint8Array;
  /** Float64Array indexed by `Counter`. */
  readonly counters: Float64Array;
  readonly timeline: TimelineView;
  /** Ids handed out so far; the newest instruction has id nextId - 1. */
  readonly nextId: number;
}

/** Mutable implementation behind EngineView; engines write through it. */
export class ViewState implements EngineView {
  readonly stageNames = STAGE_NAMES;
  readonly stageKind = new Uint8Array(5);
  readonly stageId = new Int32Array(5);
  readonly stagePc = new Uint32Array(5);
  readonly stageCause = new Uint8Array(5);
  readonly stageStalled = new Uint8Array(5);
  readonly counters = new Float64Array(COUNTER_COUNT);
  readonly timeline: TimelineView;
  nextId = 0;
  private col = 0;

  constructor(rows: number, cols: number) {
    if (rows < 8) throw new RangeError("timeline needs at least 8 rows");
    this.timeline = {
      rows, cols,
      id: new Int32Array(rows), pc: new Uint32Array(rows), word: new Uint32Array(rows),
      fate: new Uint8Array(rows), codes: new Uint8Array(rows * cols),
    };
    this.reset();
  }

  reset(): void {
    this.stageKind.fill(0);
    this.stageId.fill(-1);
    this.stagePc.fill(0);
    this.stageCause.fill(0);
    this.stageStalled.fill(0);
    this.counters.fill(0);
    const t = this.timeline;
    t.id.fill(-1); t.pc.fill(0); t.word.fill(0); t.fate.fill(0); t.codes.fill(0);
    this.nextId = 0;
    this.col = 0;
  }

  /** Start a cycle: recycle that cycle's column in the timeline. */
  beginCycle(cycle: number): void {
    const t = this.timeline;
    this.col = cycle % t.cols;
    for (let r = 0; r < t.rows; r++) t.codes[r * t.cols + this.col] = 0;
  }

  startRow(id: number, pc: number, word: number): void {
    const t = this.timeline;
    const r = id % t.rows;
    t.id[r] = id; t.pc[r] = pc; t.word[r] = word; t.fate[r] = Fate.InFlight;
    t.codes.fill(0, r * t.cols, (r + 1) * t.cols);
  }

  mark(id: number, code: number): void {
    const t = this.timeline;
    const r = id % t.rows;
    if (t.id[r] === id) t.codes[r * t.cols + this.col] = code;
  }

  setFate(id: number, fate: number): void {
    const t = this.timeline;
    const r = id % t.rows;
    if (t.id[r] === id) t.fate[r] = fate;
  }

  setStage(s: number, kind: number, id: number, pc: number, cause: number): void {
    this.stageKind[s] = kind; this.stageId[s] = id; this.stagePc[s] = pc; this.stageCause[s] = cause;
  }

  moveStage(dst: number, src: number): void {
    this.stageKind[dst] = this.stageKind[src]!;
    this.stageId[dst] = this.stageId[src]!;
    this.stagePc[dst] = this.stagePc[src]!;
    this.stageCause[dst] = this.stageCause[src]!;
  }

  clearStage(s: number): void {
    this.setStage(s, SlotKind.Empty, -1, 0, Cause.None);
  }
}
