// An NPU card as a memory-mapped device (docs/ACCEL.md "NPU"): a fixed-function systolic matrix unit, not a second programmable ISA.
// The CPU builds a list of 4-word descriptors (src/sim/isa/memmap.ts `NpuOp`) in card memory next to the weights and activations,
// writes DESC and COUNT, then CMD = 1, and polls STATUS, exactly as for the GPU. Like the GPU port it sits in a PCIe slot (npu0..npu3
// follow pcie0..pcie3), crosses the link in GPU_HOP_TICKS each way, and is stepped one descriptor at a time with a cost in ticks.
//
// Cost of a descriptor, K = the grid size (a bigger grid finishes a matrix product in fewer descriptors but pays the same setup):
//   Load, Store   1 + K        (one row of K words a tick)
//   Matmul, Macc  2 + 3 K      (setup, K ticks to fill the array, K rows out, K to drain)
//   Bias          1 + K
//   Relu          2
//   Layer         T x T output tiles, each T products at 2 + 3 K and a 2 + K bias / relu / store, T = n / K (what the tile ops above would cost)

import {
  GPU_HOP_TICKS, GpuFaultCode, GpuStatus, NPU_BASE, NPU_LAYER_WORDS, NPU_NO_BIAS, NPU_DESC_WORDS, NPU_MEM, NPU_REG, NPU_STRIDE, NPU_TILES, NpuOp,
} from "../isa/memmap";
import type { Rate } from "./clock";
import type { Device } from "./device";

export interface NpuConfig {
  /** The array is `grid` x `grid` cells. */
  grid: number;
  /** Card memory in bytes (a multiple of 4). */
  memBytes: number;
}

export class NpuFault extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "NpuFault";
  }
}

/** Descriptors the view lists from the card's list, and steps kept in the log the board view replays. */
export const NPU_LIST_SHOWN = 8;
export const NPU_LOG = 16;
/** Words of card memory one entry of `NpuView.fill` covers: a 4 x 4 tile, the smallest unit the card moves. */
export const NPU_CELL_WORDS = 16;

/** The parameter block of a Layer descriptor, read out of card memory: where the weights, the activations in and out and the biases lie, the matrix size and whether relu follows. */
export interface NpuLayerBlock { w: number; x: number; out: number; bias: number; n: number; relu: number }

/** How full card memory is, cell by cell: the share of words that are not zero in each `NPU_CELL_WORDS`. */
function fillMap(mem: Uint32Array): number[] {
  const out: number[] = new Array(Math.ceil(mem.length / NPU_CELL_WORDS)).fill(0);
  for (let k = 0; k < mem.length; k++) if (mem[k] !== 0) out[(k / NPU_CELL_WORDS) | 0]!++;
  return out.map((n) => n / NPU_CELL_WORDS);
}

/** One descriptor the card ran (or faulted on), for the view: what it was, what it cost, the card memory it read and wrote (byte ranges) and the accumulator after it. */
export interface NpuStep {
  seq: number;
  /** The launch it belongs to, its place in the list and the list's length. */
  run: number;
  index: number;
  count: number;
  op: number;
  a: number;
  b: number;
  cost: number;
  fault: boolean;
  reads: [number, number][];
  writes: [number, number][];
  acc: number[];
}

/** What the card shows from the outside (docs/ACCEL.md "NPU internal view"): where a launch is, the registers, the descriptor list, the tiles, the accumulator and the last steps. */
export interface NpuView {
  phase: Phase;
  busy: boolean;
  error: boolean;
  done: boolean;
  fault: number;
  grid: number;
  memBytes: number;
  descAt: number;
  count: number;
  cycles: number;
  /** Ticks left in the PCIe hop of this phase and how long it is. */
  wait: number;
  span: number;
  /** The launch in flight (or the last one), the descriptor on show (-1: none yet) with the ticks left in it and its cost. */
  run: number;
  index: number;
  stepWait: number;
  stepSpan: number;
  /** The first NPU_LIST_SHOWN descriptors of the list, as the card memory holds them now (empty when the registers point nowhere). */
  list: { op: number; a: number; b: number; c: number; /** For a Layer descriptor whose block lies in card memory. */ layer?: NpuLayerBlock }[];
  /** A map of card memory, `NPU_CELL_WORDS` words a cell: 0 empty to 1 full. */
  fill: number[];
  /** Words the CPU has written into and read out of card memory through its window since power-on, and the card-memory byte address of the last of each (-1: none yet). */
  hostWrites: number;
  hostReads: number;
  lastWrite: number;
  lastRead: number;
  /** Which tile registers have been loaded this launch, and the accumulator now (grid x grid, row-major). */
  tiles: boolean[];
  acc: number[];
  launches: number;
  descriptors: number;
  log: NpuStep[];
}

/** The functional core: tile registers, an accumulator and card memory. `exec` runs one descriptor and returns its cost in ticks. */
export class NpuCore {
  readonly grid: number;
  readonly mem: Uint32Array;
  private readonly tiles: Int32Array[];
  private readonly acc: Int32Array;
  /** Tile registers loaded since the last reset (for the view). */
  readonly loaded: boolean[] = Array.from({ length: NPU_TILES }, () => false);

  constructor(cfg: NpuConfig) {
    if (!Number.isInteger(cfg.grid) || cfg.grid < 1 || cfg.grid > 16) throw new RangeError(`bad grid ${cfg.grid}`);
    if (cfg.memBytes % 4 !== 0 || cfg.memBytes < 4) throw new RangeError(`bad card memory size ${cfg.memBytes}`);
    this.grid = cfg.grid;
    this.mem = new Uint32Array(cfg.memBytes / 4);
    this.tiles = Array.from({ length: NPU_TILES }, () => new Int32Array(cfg.grid * cfg.grid));
    this.acc = new Int32Array(cfg.grid * cfg.grid);
  }

  /** Registers back to zero. Card memory is left as it is. */
  reset(): void {
    for (const t of this.tiles) t.fill(0);
    this.acc.fill(0);
    this.loaded.fill(false);
  }

  /** The accumulator, row-major, as plain numbers (for the view). */
  accNow(): number[] {
    return Array.from(this.acc);
  }

  /**
   * The byte ranges of card memory a descriptor reads and writes (for the view; read before it runs, so a Layer's block is what it will use). Ranges the op would fault on
   * are returned as they are asked for.
   */
  touched(op: number, a: number, b: number): { reads: [number, number][]; writes: [number, number][] } {
    const K = this.grid, n = K * K * 4, reads: [number, number][] = [], writes: [number, number][] = [];
    switch (op) {
      case NpuOp.Load: reads.push([b, b + n]); break;
      case NpuOp.Bias: reads.push([b, b + K * 4]); break;
      case NpuOp.Store: writes.push([b, b + n]); break;
      case NpuOp.Layer: {
        reads.push([a, a + NPU_LAYER_WORDS * 4]);
        const blk = a >>> 2;
        if (a % 4 === 0 && blk + NPU_LAYER_WORDS <= this.mem.length) {
          const f = (k: number): number => this.mem[blk + k]!, m = f(4), sz = m * m * 4;
          if (Number.isInteger(m) && m >= 1 && m <= 16) {
            reads.push([f(0), f(0) + sz], [f(1), f(1) + sz]);
            if (f(3) !== NPU_NO_BIAS) reads.push([f(3), f(3) + m * 4]);
            writes.push([f(2), f(2) + sz]);
          }
        }
        break;
      }
      default: break;
    }
    return { reads, writes };
  }

  private addr(a: number, words: number): number {
    if (a % 4 !== 0 || a < 0 || a / 4 + words > this.mem.length) throw new NpuFault(`address 0x${(a >>> 0).toString(16)} is outside card memory or misaligned`);
    return a >>> 2;
  }

  /** The Layer command: OUT = relu(W X + bias) over n x n row-major matrices, as the command processor's walk over the tiles. Returns the cost. */
  private layer(blockAt: number): number {
    const blk = this.addr(blockAt, NPU_LAYER_WORDS);
    const f = (k: number): number => this.mem[blk + k]!;
    const w = f(0), x = f(1), out = f(2), bias = f(3), n = f(4), relu = f(5);
    if (!Number.isInteger(n) || n < this.grid || n > 16 || n % this.grid !== 0) throw new NpuFault(`layer size ${n} does not fit a ${this.grid} x ${this.grid} grid`);
    const W = this.addr(w, n * n), X = this.addr(x, n * n), O = this.addr(out, n * n), B = bias === NPU_NO_BIAS ? -1 : this.addr(bias, n);
    const res = new Int32Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = B < 0 ? 0 : this.mem[B + i]! | 0;
        for (let k = 0; k < n; k++) s = (s + Math.imul(this.mem[W + i * n + k]! | 0, this.mem[X + k * n + j]! | 0)) | 0;
        res[i * n + j] = relu === 1 && s < 0 ? 0 : s;
      }
    }
    for (let k = 0; k < n * n; k++) this.mem[O + k] = res[k]! >>> 0;
    return this.layerCost(n);
  }

  private tile(slot: number): Int32Array {
    const t = this.tiles[slot];
    if (!t) throw new NpuFault(`no tile register ${slot}`);
    return t;
  }

  /** A Layer's cost for an n x n product on this grid. */
  layerCost(n: number): number {
    const T = n / this.grid;
    return T * T * (T * (2 + 3 * this.grid) + 2 + this.grid);
  }

  /** The cost, in ticks, of an op on this grid (for Layer, `exec` knows the size; this is the fixed ops only). */
  cost(op: number): number {
    const K = this.grid;
    switch (op) {
      case NpuOp.Load: case NpuOp.Store: case NpuOp.Bias: return 1 + K;
      case NpuOp.Matmul: case NpuOp.Macc: return 2 + 3 * K;
      case NpuOp.Relu: return 2;
      default: throw new NpuFault(`unknown descriptor op ${op}`);
    }
  }

  exec(op: number, a: number, b: number): number {
    const K = this.grid, n = K * K;
    switch (op) {
      case NpuOp.Load: {
        const at = this.addr(b, n);
        const t = this.tile(a);
        for (let k = 0; k < n; k++) t[k] = this.mem[at + k]! | 0;
        this.loaded[a] = true;
        break;
      }
      case NpuOp.Matmul: case NpuOp.Macc: {
        const x = this.tile(a), y = this.tile(b);
        const out = new Int32Array(n);
        for (let i = 0; i < K; i++) {
          for (let j = 0; j < K; j++) {
            let s = 0;
            for (let k = 0; k < K; k++) s = (s + Math.imul(x[i * K + k]!, y[k * K + j]!)) | 0;
            out[i * K + j] = s;
          }
        }
        for (let k = 0; k < n; k++) this.acc[k] = op === NpuOp.Macc ? (this.acc[k]! + out[k]!) | 0 : out[k]!;
        break;
      }
      case NpuOp.Bias: {
        const at = this.addr(b, K);
        for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) this.acc[i * K + j] = (this.acc[i * K + j]! + (this.mem[at + i]! | 0)) | 0;
        break;
      }
      case NpuOp.Relu:
        for (let k = 0; k < n; k++) if (this.acc[k]! < 0) this.acc[k] = 0;
        break;
      case NpuOp.Layer: return this.layer(a);
      case NpuOp.Store: {
        const at = this.addr(b, n);
        for (let k = 0; k < n; k++) this.mem[at + k] = this.acc[k]! >>> 0;
        break;
      }
      default: throw new NpuFault(`unknown descriptor op ${op}`);
    }
    return this.cost(op);
  }

  /** Run a descriptor list to the end (the reference the port is checked against). Returns the cycles. */
  run(descAt: number, count: number): number {
    this.reset();
    let cycles = 0;
    const base = this.addr(descAt, count * NPU_DESC_WORDS);
    for (let d = 0; d < count; d++) {
      const w = base + d * NPU_DESC_WORDS;
      cycles += this.exec(this.mem[w]!, this.mem[w + 1]! | 0, this.mem[w + 2]!);
    }
    return cycles;
  }
}

type Phase = "idle" | "in" | "run" | "out";

export class NpuPort implements Device {
  readonly size = NPU_STRIDE;
  readonly base: number;
  readonly clock: Rate = { mul: 0, div: 1 };

  private cfg: NpuConfig | null = null;
  private core: NpuCore | null = null;
  private phase: Phase = "idle";
  private wait = 0;
  private stall = 0;
  private descAt = 0;
  private count = 0;
  private next = 0;
  private cycles = 0;
  private done = false;
  private error = false;
  private fault: number = GpuFaultCode.None;
  private seq = 0;
  private curCost = 0;
  private log: NpuStep[] = [];
  private hostWrites = 0;
  private hostReads = 0;
  private lastWrite = -1;
  private lastRead = -1;
  /** Set while a run is in flight, cleared by `takeActivity`. */
  active = false;
  launches = 0;
  descriptors = 0;

  constructor(readonly name: string, index: number) {
    this.base = NPU_BASE + index * NPU_STRIDE;
  }

  configure(cfg: NpuConfig | null): void {
    const same = cfg && this.cfg && cfg.grid === this.cfg.grid && cfg.memBytes === this.cfg.memBytes;
    if (same || (!cfg && !this.cfg)) return;
    this.cfg = cfg;
    this.core = cfg ? new NpuCore(cfg) : null;
    this.reset();
  }

  /** Power-on reset: card memory is volatile and nothing is in flight. */
  reset(): void {
    this.core?.mem.fill(0);
    this.core?.reset();
    this.phase = "idle";
    this.wait = this.stall = this.next = 0;
    this.descAt = this.count = this.cycles = 0;
    this.done = this.error = false;
    this.fault = GpuFaultCode.None;
    this.active = false;
    this.curCost = 0;
    this.log = [];
    this.hostWrites = this.hostReads = 0;
    this.lastWrite = this.lastRead = -1;
  }

  /** The card as the board view draws it, or null without a card. */
  view(): NpuView | null {
    const core = this.core, cfg = this.cfg;
    if (!core || !cfg) return null;
    const list: NpuView["list"] = [];
    const base = this.descAt / 4;
    if (this.count > 0 && this.descAt % 4 === 0 && base + this.count * NPU_DESC_WORDS <= core.mem.length) {
      for (let k = 0; k < Math.min(this.count, NPU_LIST_SHOWN); k++) {
        const w = base + k * NPU_DESC_WORDS;
        const d: NpuView["list"][number] = { op: core.mem[w]!, a: core.mem[w + 1]! | 0, b: core.mem[w + 2]!, c: core.mem[w + 3]! };
        const blk = d.op === NpuOp.Layer ? d.a : -1;
        if (blk >= 0 && blk % 4 === 0 && blk / 4 + NPU_LAYER_WORDS <= core.mem.length) {
          const f = (j: number): number => core.mem[blk / 4 + j]!;
          d.layer = { w: f(0), x: f(1), out: f(2), bias: f(3), n: f(4), relu: f(5) };
        }
        list.push(d);
      }
    }
    const inRun = this.phase === "run" || this.phase === "out";
    return {
      phase: this.phase, busy: this.phase !== "idle", error: this.error, done: this.done, fault: this.fault, grid: cfg.grid, memBytes: cfg.memBytes,
      descAt: this.descAt, count: this.count, cycles: this.cycles, wait: this.wait, span: this.phase === "in" || this.phase === "out" ? GPU_HOP_TICKS : 0,
      run: this.launches, index: inRun ? this.next - 1 : -1, stepWait: this.phase === "run" ? this.stall + 1 : 0, stepSpan: this.curCost,
      list, fill: fillMap(core.mem), hostWrites: this.hostWrites, hostReads: this.hostReads, lastWrite: this.lastWrite, lastRead: this.lastRead,
      tiles: [...core.loaded], acc: core.accNow(), launches: this.launches, descriptors: this.descriptors, log: this.log.map((e) => ({ ...e, reads: e.reads.map((r): [number, number] => [...r]), writes: e.writes.map((r): [number, number] => [...r]), acc: [...e.acc] })),
    };
  }

  private note(index: number, op: number, a: number, b: number, cost: number, fault: boolean, t: ReturnType<NpuCore["touched"]>): void {
    this.log.push({ seq: ++this.seq, run: this.launches, index, count: this.count, op, a, b, cost, fault, reads: t.reads, writes: t.writes, acc: this.core!.accNow() });
    if (this.log.length > NPU_LOG) this.log.shift();
  }

  get present(): boolean {
    return this.core !== null;
  }

  get isBusy(): boolean {
    return this.phase !== "idle";
  }

  get memory(): Uint32Array | null {
    return this.core?.mem ?? null;
  }

  takeActivity(): boolean {
    const a = this.active;
    this.active = this.phase !== "idle";
    return a;
  }

  read(off: number): number {
    const core = this.core;
    if (off >= NPU_MEM) {
      const o = off - NPU_MEM;
      if (core && o < core.mem.length * 4 && (o & 3) === 0) { this.hostReads++; this.lastRead = o; }
      return core && o < core.mem.length * 4 ? (core.mem[o >>> 2]! >>> (8 * (o & 3))) & 0xff : 0;
    }
    let w = 0;
    switch (off & ~3) {
      case NPU_REG.STATUS:
        w = (this.phase !== "idle" ? GpuStatus.Busy : 0) | (this.error ? GpuStatus.Error : 0) | (core ? GpuStatus.Present : 0) | (this.done ? GpuStatus.Done : 0);
        break;
      case NPU_REG.DESC: w = this.descAt; break;
      case NPU_REG.COUNT: w = this.count; break;
      case NPU_REG.GRID: w = this.cfg?.grid ?? 0; break;
      case NPU_REG.MEM_BYTES: w = this.cfg?.memBytes ?? 0; break;
      case NPU_REG.CYCLES: w = this.cycles; break;
      case NPU_REG.FAULT: w = this.fault; break;
    }
    return (w >>> (8 * (off & 3))) & 0xff;
  }

  write(off: number, val: number): void {
    const core = this.core;
    if (off >= NPU_MEM) {
      const o = off - NPU_MEM;
      if (core && o < core.mem.length * 4) {
        if ((o & 3) === 0) { this.hostWrites++; this.lastWrite = o; }
        const sh = 8 * (o & 3);
        core.mem[o >>> 2] = ((core.mem[o >>> 2]! & ~(0xff << sh)) | ((val & 0xff) << sh)) >>> 0;
      }
      return;
    }
    const reg = off & ~3, sh = 8 * (off & 3);
    const put = (old: number): number => ((old & ~(0xff << sh)) | ((val & 0xff) << sh)) >>> 0;
    if (reg === NPU_REG.DESC) this.descAt = put(this.descAt);
    else if (reg === NPU_REG.COUNT) this.count = put(this.count);
    else if (reg === NPU_REG.CMD && off === reg) this.launch(val & 0xff);
  }

  private launch(cmd: number): void {
    const core = this.core;
    const listWords = this.count * NPU_DESC_WORDS;
    if (cmd !== 1 || !core || this.phase !== "idle" || this.count === 0 || this.descAt % 4 !== 0 || this.descAt / 4 + listWords > core.mem.length) {
      this.error = true;
      this.fault = GpuFaultCode.BadLaunch;
      return;
    }
    this.error = this.done = false;
    this.fault = GpuFaultCode.None;
    this.phase = "in";
    this.wait = GPU_HOP_TICKS;
    this.active = true;
    this.launches++;
  }

  tick(): void {
    const core = this.core;
    if (!core || this.phase === "idle") return;
    switch (this.phase) {
      case "in":
        if (--this.wait <= 0) {
          core.reset();
          this.next = 0;
          this.stall = 0;
          this.cycles = 0;
          this.phase = "run";
        }
        break;
      case "run": {
        if (this.stall > 0) {
          if (--this.stall === 0 && this.next >= this.count) this.finish();
          break;
        }
        const w = this.descAt / 4 + this.next * NPU_DESC_WORDS;
        const op = core.mem[w]!, a = core.mem[w + 1]! | 0, b = core.mem[w + 2]!, seen = core.touched(op, a, b);
        try {
          const cost = core.exec(op, a, b);
          this.cycles += cost;
          this.stall = cost - 1;
          this.curCost = cost;
          this.note(this.next, op, a, b, cost, false, seen);
          this.next++;
          this.descriptors++;
          if (this.next >= this.count && this.stall === 0) this.finish();
        } catch (e) {
          if (!(e instanceof NpuFault)) throw e;
          this.note(this.next, op, a, b, 0, true, seen);
          this.next++;
          this.curCost = 1;
          this.error = true;
          this.fault = GpuFaultCode.Kernel;
          this.finish();
        }
        break;
      }
      case "out":
        if (--this.wait <= 0) {
          this.phase = "idle";
          this.done = true;
        }
        break;
    }
  }

  private finish(): void {
    this.phase = "out";
    this.wait = GPU_HOP_TICKS;
  }
}
