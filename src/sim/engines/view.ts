// Observability for the timed engines: typed-array views only (no per-instruction objects). See docs/ENGINES.md.

export const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;
export const Stage = { IF: 0, ID: 1, EX: 2, MEM: 3, WB: 4 } as const;

/** What occupies a stage this cycle. */
export const SlotKind = { Empty: 0, Instr: 1, Bubble: 2 } as const;

/** Why a bubble exists. */
export const Cause = { None: 0, Load: 1, Data: 2, Flush: 3, Struct: 4 } as const;

/** Timeline cell codes. Index into STAGE_CODE_CHARS for the letter. */
export const StageCode = { None: 0, F: 1, D: 2, X: 3, M: 4, W: 5, Flushed: 6, S: 7, R: 8, C: 9 } as const;
/** In-order uses F D X M W x; the out-of-order engine uses F D S X R C x (S scheduler wait, R result ready in the ROB, C commit). */
export const STAGE_CODE_CHARS = " FDXMWxSRC";

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
  /** ooo: cycles dispatch was blocked because the reorder buffer was full. */
  StallRobFull: 13,
  /** ooo: cycles dispatch was blocked because the scheduler was full. */
  StallSchedFull: 14,
  /** ooo: instructions sent to an execution unit. */
  Issued: 15,
  /** ooo: loads that took their value from an older in-flight store. */
  LoadForwards: 16,
  /** ooo: load-cycles spent waiting for older stores / for the head of the ROB (memory ordering). */
  LoadWaits: 17,
  /** ooo: sum over cycles of reorder buffer occupancy (divide by Cycles for the average). */
  RobOccupancySum: 18,
  /** ooo: sum over cycles of scheduler occupancy. */
  SchedOccupancySum: 19,
  /** inorder width > 1: cycles two instructions issued together. */
  DualIssues: 20,
  /** inorder width > 1: cycles the pairing rules (RAW/WAW in bundle, one mem op, branch ends bundle) kept the next instruction back. */
  PairBreaks: 21,
  /** Instruction cache (when the CPU has one): fetches that hit / missed. */
  ICacheHits: 22,
  ICacheMisses: 23,
  /** Cycles fetch waited for an instruction cache line. */
  StallIFetch: 24,
  /** Shared L2 (when the CPU has one): L1 misses that hit / missed it. */
  L2Hits: 25,
  L2Misses: 26,
  /** DRAM (when the game gives the engine one): accesses that found their row open, found the bank closed, or had to close another row first. */
  RowHits: 27,
  RowEmpty: 28,
  RowConflicts: 29,
  /** MMU (when the CPU has one and the OS has it on): translations the TLB had, translations that needed a table walk, page faults taken. */
  TlbHits: 30,
  TlbMisses: 31,
  PageFaults: 32,
} as const;
export const COUNTER_NAMES = [
  "cycles", "retired", "stallLoad", "stallData", "stallFlush", "stallStruct", "stallCache",
  "flushes", "flushedInstrs", "branches", "branchMispredicts", "cacheHits", "cacheMisses",
  "stallRobFull", "stallSchedFull", "issued", "loadForwards", "loadWaits", "robOccupancySum", "schedOccupancySum",
  "dualIssues", "pairBreaks", "iCacheHits", "iCacheMisses", "stallIFetch", "l2Hits", "l2Misses", "rowHits", "rowEmpty", "rowConflicts", "tlbHits", "tlbMisses", "pageFaults",
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
  /** Lanes per stage (pipeline width; 1 for the scalar engines). Stage arrays are indexed stage * width + lane. */
  readonly width: number;
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
  readonly stageKind: Uint8Array;
  readonly stageId: Int32Array;
  readonly stagePc: Uint32Array;
  readonly stageCause: Uint8Array;
  readonly stageStalled: Uint8Array;
  readonly counters = new Float64Array(COUNTER_COUNT);
  readonly timeline: TimelineView;
  nextId = 0;
  private col = 0;

  constructor(rows: number, cols: number, readonly width = 1) {
    if (rows < 8) throw new RangeError("timeline needs at least 8 rows");
    const n = 5 * width;
    this.stageKind = new Uint8Array(n);
    this.stageId = new Int32Array(n);
    this.stagePc = new Uint32Array(n);
    this.stageCause = new Uint8Array(n);
    this.stageStalled = new Uint8Array(n);
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

  /** Mark only if the cell is still empty (bulk end-of-cycle marking that must not override explicit marks). */
  markIfEmpty(id: number, code: number): void {
    const t = this.timeline;
    const r = id % t.rows;
    if (t.id[r] === id && t.codes[r * t.cols + this.col] === 0) t.codes[r * t.cols + this.col] = code;
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

// ---- Out-of-order view ----

/** Execution units of the ooo engine (index into the unit* arrays). */
export const Unit = { ALU0: 0, ALU1: 1, MUL: 2, LSU: 3 } as const;
export const UNIT_NAMES = ["ALU0", "ALU1", "MUL", "LSU"] as const;
export const UNIT_COUNT = 4;

/** State of a reorder buffer entry. */
export const RobState = { Empty: 0, Waiting: 1, Executing: 2, Done: 3 } as const;

/** Why a scheduler entry did not issue this cycle. */
export const SchedWhy = { None: 0, Operands: 1, Memory: 2, Unit: 3, Head: 4 } as const;

/** Indices into OooView.stall: why each front/back end part made no progress this cycle (0 = fine). */
export const OooPart = { Fetch: 0, Dispatch: 1, Commit: 2 } as const;
export const FetchStall = { None: 0, QueueFull: 1, Stopped: 2, ICache: 3 } as const;
export const DispatchStall = { None: 0, Empty: 1, RobFull: 2, SchedFull: 3 } as const;
export const CommitStall = { None: 0, Empty: 1, HeadPending: 2 } as const;

/** Indices into OooView.occ. */
export const Occ = { Fetch: 0, Decode: 1, Rob: 2, Sched: 3, Units: 4, RobHead: 5 } as const;

/**
 * Out-of-order observability: structure occupancy as typed arrays (all live, read only). Unused slots have id -1.
 * Queues list the oldest instruction first. ROB arrays are the physical ring: logical entry k (0 = oldest) is at
 * index (occ[RobHead] + k) % rob.length for k < occ[Rob]. Scheduler slots are fixed (an entry keeps its slot until issue).
 * The inherited stage* arrays are unused (empty) for this engine.
 */
export interface OooView extends EngineView {
  readonly robSize: number;
  readonly schedSize: number;
  readonly fetchQueueSize: number;
  readonly fetchId: Int32Array;
  readonly fetchPc: Uint32Array;
  readonly decodeId: Int32Array;
  readonly decodePc: Uint32Array;
  readonly robId: Int32Array;
  readonly robPc: Uint32Array;
  /** RobState per physical ROB index. */
  readonly robState: Uint8Array;
  readonly schedId: Int32Array;
  readonly schedPc: Uint32Array;
  /** SchedWhy per scheduler slot (why it did not issue this cycle; None for an empty slot or one that just issued). */
  readonly schedWhy: Uint8Array;
  /** Per unit ALU0 ALU1 MUL LSU: occupant id (-1 idle), pc, cycles left, total latency. */
  readonly unitId: Int32Array;
  readonly unitPc: Uint32Array;
  readonly unitLeft: Uint8Array;
  readonly unitTotal: Uint8Array;
  /** Counts indexed by Occ. */
  readonly occ: Int32Array;
  /** Per OooPart: FetchStall / DispatchStall / CommitStall cause this cycle. */
  readonly stall: Uint8Array;
}

export class OooViewState extends ViewState implements OooView {
  readonly fetchId: Int32Array; readonly fetchPc: Uint32Array;
  readonly decodeId: Int32Array; readonly decodePc: Uint32Array;
  readonly robId: Int32Array; readonly robPc: Uint32Array; readonly robState: Uint8Array;
  readonly schedId: Int32Array; readonly schedPc: Uint32Array; readonly schedWhy: Uint8Array;
  readonly unitId = new Int32Array(UNIT_COUNT);
  readonly unitPc = new Uint32Array(UNIT_COUNT);
  readonly unitLeft = new Uint8Array(UNIT_COUNT);
  readonly unitTotal = new Uint8Array(UNIT_COUNT);
  readonly occ = new Int32Array(6);
  readonly stall = new Uint8Array(3);

  constructor(rows: number, cols: number, width: number, readonly robSize: number, readonly schedSize: number, readonly fetchQueueSize: number) {
    super(rows, cols, width);
    this.fetchId = new Int32Array(fetchQueueSize); this.fetchPc = new Uint32Array(fetchQueueSize);
    this.decodeId = new Int32Array(width); this.decodePc = new Uint32Array(width);
    this.robId = new Int32Array(robSize); this.robPc = new Uint32Array(robSize); this.robState = new Uint8Array(robSize);
    this.schedId = new Int32Array(schedSize); this.schedPc = new Uint32Array(schedSize); this.schedWhy = new Uint8Array(schedSize);
    this.reset();
  }

  override reset(): void {
    super.reset();
    // Called from the base constructor before the fields exist.
    if (!this.fetchId) return;
    this.fetchId.fill(-1); this.fetchPc.fill(0); this.decodeId.fill(-1); this.decodePc.fill(0);
    this.robId.fill(-1); this.robPc.fill(0); this.robState.fill(0);
    this.schedId.fill(-1); this.schedPc.fill(0); this.schedWhy.fill(0);
    this.unitId.fill(-1); this.unitPc.fill(0); this.unitLeft.fill(0); this.unitTotal.fill(0);
    this.occ.fill(0); this.stall.fill(0);
  }
}
