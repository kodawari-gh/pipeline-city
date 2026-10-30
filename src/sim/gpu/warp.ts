// The SM engines (docs/GPU.md section 4): `warp` (gpu2) is one SM whose lanes are split into warps, `multi` (gpu3) is several of them on one
// card with caches (multi.ts). Every warp has its own pc, execution mask, mask stack and registers (a `GpuRef` of its lanes on the shared card
// memory, so the instruction semantics are the reference interpreter's); `SmCore` adds the timing around them:
//
//   issue      one instruction per cycle per SM, from the next ready warp after the one that issued last (round robin)
//   pipeline   fetch, decode, issue, execute, memory / write-back. An instruction issued in cycle t was fetched in t-2, decoded in t-1,
//              executes in t+1 and writes back in t+2; the first issue is in cycle FILL and the card is done DRAIN cycles after the last
//   scoreboard a load marks its destination pending until its data is back; an instruction that reads or writes a pending register waits
//              (ALU results are forwarded, so ALU work never stalls); only that warp waits, the others keep issuing
//   memory     the coalescer and bank arbiter (memsys.ts) turn the lanes' addresses into rounds and a latency; the SM's memory unit is
//              busy for the rounds, so a second memory instruction of the SM waits for it
//   branches   a taken branch is known at execute: the warp cannot issue for BRANCH_PENALTY cycles (another warp fills them)
//   bar        a warp that issues `bar` waits until every warp of its SM that is not done has reached it

import { GPU_OPS, gpuDecode, type GpuInstr } from "../isa/gpu";
import { GpuRef, type GpuStep } from "../ref/gpuref";
import type { GpuEngine, GpuSmView, GpuWarpView, WarpConfig } from "./engine";
import { GpuMemSystem, type GpuMemConfig } from "./memsys";

/** Cycles before the first issue (fetch and decode of the first instruction) and after the last (execute, write-back). */
export const WARP_FILL = 2;
export const WARP_DRAIN = 2;
/** Cycles a warp cannot issue after a taken branch. */
export const WARP_BRANCH_PENALTY = 2;

type State = "ready" | "barrier" | "done";

interface Warp {
  ref: GpuRef;
  state: State;
  /** First cycle the warp may issue again (a taken branch, or a barrier it was released from). */
  nextIssue: number;
  /** Cycle at which each vector register's data is back (0 = not pending). */
  pending: number[];
  /** Why the warp could not issue in the last scheduler pass. */
  blocked: "mem" | "branch" | "unit" | null;
}

const SPEC = new Map(GPU_OPS.map((o) => [o.name, o]));

/** Registers an instruction reads and writes (by format). */
function regUse(i: GpuInstr): { reads: number[]; writes: number | null } {
  const f = SPEC.get(i.name)?.fmt;
  switch (f) {
    case "R": return { reads: [i.rs1, i.rs2], writes: i.rd };
    case "I": return { reads: i.name === "vli" ? [] : [i.rs1], writes: i.rd };
    case "D": return { reads: [], writes: i.rd };
    case "S":
    case "M": return { reads: [i.rs1, i.rs2], writes: null };
    default: return { reads: [], writes: null };
  }
}

const popcount = (m: number): number => {
  let n = 0;
  for (let x = m >>> 0; x; x &= x - 1) n++;
  return n;
};

/** One streaming multiprocessor: its warps, scheduler and memory unit. */
export class SmCore {
  readonly warps: Warp[];
  /** Instructions issued by each warp, and the SM's other counters (the engine adds them up). */
  readonly issued: number[];
  instructions = 0;
  conflictCycles = 0;
  idleLaneSlots = 0;
  stallCycles = 0;
  drainAt = 0;
  private last = -1;
  private memFree = 0;

  constructor(readonly index: number, readonly mem: Uint32Array, readonly memsys: GpuMemSystem, readonly nWarps: number, readonly warpLanes: number, laneBase: number, banks: number) {
    this.warps = Array.from({ length: nWarps }, (_, k) => ({
      ref: new GpuRef({ lanes: warpLanes, memBytes: mem.length * 4, banks, mem, laneBase: laneBase + k * warpLanes }),
      state: "done" as State, nextIssue: 0, pending: new Array<number>(8).fill(0), blocked: null,
    }));
    this.issued = new Array<number>(nWarps).fill(0);
  }

  get lanes(): number { return this.nWarps * this.warpLanes; }
  get done(): boolean { return this.warps.every((x) => x.state === "done"); }

  /** `activeLanes` = the launch's lanes that fall on this SM. */
  reset(pc: number, activeLanes: number): void {
    this.warps.forEach((wp, k) => {
      const n = Math.max(0, Math.min(this.warpLanes, activeLanes - k * this.warpLanes));
      wp.ref.reset(pc, n);
      wp.state = n > 0 ? "ready" : "done";
      wp.nextIssue = WARP_FILL;
      wp.pending.fill(0);
      wp.blocked = null;
    });
    this.last = -1;
    this.memFree = 0;
    this.drainAt = 0;
    this.instructions = this.conflictCycles = this.idleLaneSlots = this.stallCycles = 0;
    this.issued.fill(0);
  }

  views(): GpuSmView {
    return {
      warps: this.warps.map((wp): GpuWarpView => ({
        pc: wp.ref.pc, mask: wp.ref.mask, stack: [...wp.ref.stack],
        state: wp.state === "done" ? "done" : wp.state === "barrier" ? "barrier" : wp.blocked === "mem" ? "wait-mem" : "ready",
      })),
    };
  }

  private peek(wp: Warp): GpuInstr | null {
    const pc = wp.ref.pc;
    if (pc % 4 !== 0 || pc < 0 || pc / 4 >= this.mem.length) return null;
    return gpuDecode(this.mem[pc / 4]!);
  }

  /** Whether the warp can issue its next instruction this cycle; records why not. */
  private ready(wp: Warp, cycle: number): boolean {
    wp.blocked = null;
    if (wp.state !== "ready") return false;
    if (cycle < wp.nextIssue) { wp.blocked = "branch"; return false; }
    const i = this.peek(wp);
    if (!i) return true; // an illegal fetch faults when it issues
    const { reads, writes } = regUse(i);
    for (const r of writes === null ? reads : [...reads, writes]) {
      if (wp.pending[r]! > cycle) { wp.blocked = "mem"; return false; }
    }
    if ((i.name === "vld" || i.name === "vst") && this.memFree > cycle) { wp.blocked = "unit"; return false; }
    return true;
  }

  /** Run card cycle `cycle` on this SM. Returns the instruction issued, or null. */
  step(cycle: number): GpuStep | null {
    let pick = -1;
    for (let n = 1; n <= this.nWarps; n++) {
      const k = (this.last + n + this.nWarps) % this.nWarps;
      if (this.ready(this.warps[k]!, cycle)) { pick = k; break; }
    }
    if (pick < 0) {
      if (!this.done) this.stallCycles++;
      return null;
    }
    const wp = this.warps[pick]!, ref = wp.ref;
    const before = ref.pc;
    const i = this.peek(wp);
    ref.step();
    const s = ref.lastStep!;
    this.last = pick;
    this.instructions++;
    this.issued[pick]!++;
    this.idleLaneSlots += this.warpLanes - popcount(s.mask);
    this.drainAt = Math.max(this.drainAt, cycle + 1 + WARP_DRAIN);
    let cost = 1, banks: number[] | null = null, stall: GpuStep["stall"] = null;

    if (i && (s.name === "vld" || s.name === "vst")) {
      const acc = s.name === "vld" ? this.memsys.load(this.index, ref.lastAddrs, cycle) : this.memsys.store(ref.lastAddrs);
      cost = acc.rounds;
      banks = acc.perBank;
      this.memFree = cycle + acc.rounds;
      this.conflictCycles += acc.rounds - 1;
      if (acc.rounds > 1) stall = "bank";
      if (s.name === "vld" && acc.latency > 0) wp.pending[i.rd] = cycle + acc.latency;
    } else if (s.name === "jmp" || (s.name === "bany" && ref.pc !== before + 4)) {
      wp.nextIssue = cycle + 1 + WARP_BRANCH_PENALTY;
    } else if (s.name === "bar") {
      wp.state = "barrier";
    } else if (s.name === "halt") {
      wp.state = "done";
    }
    this.release(cycle);
    return { ...s, cost, banks, stall, startCycle: cycle, sm: this.index, warp: pick, stackDepth: ref.stack.length, maskAfter: ref.mask };
  }

  /** Let the warps go once every warp that is not done waits at the barrier. */
  private release(cycle: number): void {
    const live = this.warps.filter((x) => x.state !== "done");
    if (live.length === 0 || !live.every((x) => x.state === "barrier")) return;
    for (const x of live) { x.state = "ready"; x.nextIssue = cycle + 1; }
  }
}

/** The shape every SM engine is built from. */
export interface SmEngineShape {
  sms: number;
  warps: number;
  lanes: number;
  memBytes: number;
  banks: number;
  mem: Omit<GpuMemConfig, "banks" | "sms">;
}

/** One or more SMs on one card memory, stepped together one cycle at a time (SM 0 first). */
export class SmEngine implements GpuEngine {
  readonly lanes: number;
  readonly banks: number;
  readonly mem: Uint32Array;
  readonly memsys: GpuMemSystem;
  readonly cores: SmCore[];
  /** Instructions issued in the last cycle, one per SM that issued. */
  issuedNow: GpuStep[] = [];
  cycles = 0;
  private readonly all: Warp[];
  private readonly regsOut: Int32Array[];
  private last = 0;
  private started = false;

  constructor(shape: SmEngineShape) {
    const { sms, warps, lanes } = shape;
    if (!Number.isInteger(warps) || warps < 1 || !Number.isInteger(sms) || sms < 1 || lanes % (sms * warps) !== 0) throw new RangeError(`${lanes} lanes do not split into ${sms} SMs of ${warps} warps`);
    this.lanes = lanes;
    this.banks = Math.max(1, shape.banks);
    this.mem = new Uint32Array(shape.memBytes / 4);
    this.memsys = new GpuMemSystem({ ...shape.mem, banks: this.banks, sms });
    const warpLanes = lanes / (sms * warps);
    this.cores = Array.from({ length: sms }, (_, k) => new SmCore(k, this.mem, this.memsys, warps, warpLanes, k * warps * warpLanes, this.banks));
    this.all = this.cores.flatMap((c) => c.warps);
    this.regsOut = Array.from({ length: this.all[0]!.ref.regs.length }, () => new Int32Array(lanes));
    this.reset();
  }

  get warps(): number { return this.cores[0]!.nWarps; }
  get warpLanes(): number { return this.cores[0]!.warpLanes; }
  get instructions(): number { return this.cores.reduce((n, c) => n + c.instructions, 0); }
  get conflictCycles(): number { return this.cores.reduce((n, c) => n + c.conflictCycles, 0); }
  get idleLaneSlots(): number { return this.cores.reduce((n, c) => n + c.idleLaneSlots, 0); }
  /** Cycles in which an SM had live warps and issued nothing (summed over SMs). */
  get stallCycles(): number { return this.cores.reduce((n, c) => n + c.stallCycles, 0); }

  get regs(): Int32Array[] {
    const wl = this.warpLanes;
    this.all.forEach((wp, k) => wp.ref.regs.forEach((r, n) => this.regsOut[n]!.set(r, k * wl)));
    return this.regsOut;
  }
  /** The warps' masks side by side (warp k of the card in bits k*warpLanes..). */
  get mask(): number {
    const wl = this.warpLanes;
    return this.all.reduce((m, wp, k) => (m | (wp.ref.mask << (k * wl))) >>> 0, 0);
  }
  get stack(): readonly number[] {
    const wl = this.warpLanes;
    const depth = Math.max(...this.all.map((wp) => wp.ref.stack.length));
    return Array.from({ length: depth }, (_, d) => this.all.reduce((m, wp, k) => (m | ((wp.ref.stack[d] ?? 0) << (k * wl))) >>> 0, 0));
  }
  get pc(): number { return this.all[this.last]!.ref.pc; }
  get halted(): boolean {
    return this.started && this.cores.every((c) => c.done) && this.cycles >= Math.max(...this.cores.map((c) => c.drainAt));
  }

  reset(pc = 0, activeLanes = this.lanes): void {
    const per = this.cores[0]!.lanes;
    this.cores.forEach((c, k) => c.reset(pc, Math.max(0, Math.min(per, activeLanes - k * per))));
    this.memsys.invalidate();
    this.cycles = 0;
    this.last = 0;
    this.issuedNow = [];
    this.started = true;
  }

  smViews(): GpuSmView[] {
    return this.cores.map((c) => c.views());
  }

  step(): GpuStep | null {
    this.issuedNow = [];
    if (this.halted) return null;
    const cycle = this.cycles++;
    for (const c of this.cores) {
      const s = c.step(cycle);
      if (s) {
        this.issuedNow.push(s);
        this.last = c.index * c.nWarps + (s.warp ?? 0);
      }
    }
    return this.issuedNow[0] ?? null;
  }
}

/** gpu2: one SM, no caches. */
export class WarpEngine extends SmEngine {
  constructor(cfg: WarpConfig) {
    super({ sms: 1, warps: cfg.warps, lanes: cfg.lanes, memBytes: cfg.memBytes, banks: cfg.banks, mem: { lineWords: cfg.lineWords, globalLatency: cfg.globalLatency } });
  }
  /** Instructions issued by each warp. */
  get issued(): number[] { return this.cores[0]!.issued; }
}
