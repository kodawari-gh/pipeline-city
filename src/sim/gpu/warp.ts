// The `warp` engine (gpu2, docs/GPU.md section 4): one SM whose lanes are split into warps. Every warp has its own pc, execution mask, mask
// stack and registers (a `GpuRef` of its lanes on the shared card memory, so the instruction semantics are the reference interpreter's);
// this class adds the timing around them:
//
//   issue      one instruction per cycle, from the next ready warp after the one that issued last (round robin)
//   pipeline   fetch, decode, issue, execute, memory / write-back. An instruction issued in cycle t was fetched in t-2, decoded in t-1,
//              executes in t+1 and writes back in t+2; the first issue is in cycle FILL and the card is done DRAIN cycles after the last
//   scoreboard a load marks its destination pending until its data is back; an instruction that reads or writes a pending register waits
//              (ALU results are forwarded, so ALU work never stalls); only that warp waits, the others keep issuing
//   memory     the coalescer and bank arbiter (memsys.ts) turn the lanes' addresses into rounds and a latency; the memory unit is busy
//              for the rounds, so a second memory instruction waits for it
//   branches   a taken branch is known at execute: the warp cannot issue for BRANCH_PENALTY cycles (another warp fills them)
//   bar        a warp that issues `bar` waits until every warp that is not done has reached it

import { GPU_OPS, gpuDecode, type GpuInstr } from "../isa/gpu";
import { GpuRef, type GpuStep } from "../ref/gpuref";
import type { GpuEngine, GpuSmView, GpuWarpView, WarpConfig } from "./engine";
import { GpuMemSystem } from "./memsys";

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

export class WarpEngine implements GpuEngine {
  readonly lanes: number;
  readonly banks: number;
  readonly mem: Uint32Array;
  readonly warps: number;
  readonly warpLanes: number;
  readonly memsys: GpuMemSystem;
  private readonly w: Warp[];
  private readonly regsOut: Int32Array[];
  private last = -1;
  private memFree = 0;
  private drainAt = 0;
  private started = false;
  cycles = 0;
  instructions = 0;
  conflictCycles = 0;
  idleLaneSlots = 0;
  /** Cycles in which no warp could issue (the pipeline had a bubble). */
  stallCycles = 0;
  /** Instructions issued by each warp. */
  issued: number[];

  constructor(cfg: WarpConfig) {
    if (!Number.isInteger(cfg.warps) || cfg.warps < 1 || cfg.lanes % cfg.warps !== 0) throw new RangeError(`${cfg.lanes} lanes do not split into ${cfg.warps} warps`);
    this.lanes = cfg.lanes;
    this.banks = Math.max(1, cfg.banks);
    this.warps = cfg.warps;
    this.warpLanes = cfg.lanes / cfg.warps;
    this.mem = new Uint32Array(cfg.memBytes / 4);
    this.memsys = new GpuMemSystem({ banks: this.banks, lineWords: cfg.lineWords, globalLatency: cfg.globalLatency });
    this.w = Array.from({ length: cfg.warps }, (_, k) => ({
      ref: new GpuRef({ lanes: this.warpLanes, memBytes: cfg.memBytes, banks: this.banks, mem: this.mem, laneBase: k * this.warpLanes }),
      state: "done" as State, nextIssue: 0, pending: new Array<number>(8).fill(0), blocked: null,
    }));
    this.regsOut = Array.from({ length: this.w[0]!.ref.regs.length }, () => new Int32Array(cfg.lanes));
    this.issued = new Array<number>(cfg.warps).fill(0);
    this.reset();
  }

  get regs(): Int32Array[] {
    this.w.forEach((wp, k) => wp.ref.regs.forEach((r, n) => this.regsOut[n]!.set(r, k * this.warpLanes)));
    return this.regsOut;
  }
  /** The warps' masks side by side (warp k in bits k*W..). */
  get mask(): number {
    return this.w.reduce((m, wp, k) => (m | (wp.ref.mask << (k * this.warpLanes))) >>> 0, 0);
  }
  get stack(): readonly number[] {
    const depth = Math.max(...this.w.map((wp) => wp.ref.stack.length));
    return Array.from({ length: depth }, (_, d) => this.w.reduce((m, wp, k) => (m | ((wp.ref.stack[d] ?? 0) << (k * this.warpLanes))) >>> 0, 0));
  }
  get pc(): number { return this.w[Math.max(0, this.last)]!.ref.pc; }
  get halted(): boolean { return this.started && this.w.every((x) => x.state === "done") && this.cycles >= this.drainAt; }

  reset(pc = 0, activeLanes = this.lanes): void {
    this.w.forEach((wp, k) => {
      const n = Math.max(0, Math.min(this.warpLanes, activeLanes - k * this.warpLanes));
      wp.ref.reset(pc, n);
      wp.state = n > 0 ? "ready" : "done";
      wp.nextIssue = WARP_FILL;
      wp.pending.fill(0);
      wp.blocked = null;
    });
    this.memsys.invalidate();
    this.last = -1;
    this.memFree = 0;
    this.drainAt = 0;
    this.started = true;
    this.cycles = this.instructions = this.conflictCycles = this.idleLaneSlots = this.stallCycles = 0;
    this.issued.fill(0);
  }

  smViews(): GpuSmView[] {
    const views: GpuWarpView[] = this.w.map((wp) => ({
      pc: wp.ref.pc, mask: wp.ref.mask, stack: [...wp.ref.stack],
      state: wp.state === "done" ? "done" : wp.state === "barrier" ? "barrier" : wp.blocked === "mem" ? "wait-mem" : "ready",
    }));
    return [{ warps: views }];
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

  step(): GpuStep | null {
    if (this.halted) return null;
    const cycle = this.cycles++;
    let pick = -1;
    for (let n = 1; n <= this.warps; n++) {
      const k = (this.last + n + this.warps) % this.warps;
      if (this.ready(this.w[k]!, cycle)) { pick = k; break; }
    }
    if (pick < 0) {
      if (this.w.some((x) => x.state !== "done")) this.stallCycles++;
      return null;
    }
    const wp = this.w[pick]!, ref = wp.ref;
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
      const acc = s.name === "vld" ? this.memsys.load(0, ref.lastAddrs, cycle) : this.memsys.store(ref.lastAddrs);
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
    return { ...s, cost, banks, stall, startCycle: cycle, sm: 0, warp: pick, stackDepth: ref.stack.length, maskAfter: ref.mask };
  }

  /** Let the warps go once every warp that is not done waits at the barrier. */
  private release(cycle: number): void {
    const live = this.w.filter((x) => x.state !== "done");
    if (live.length === 0 || !live.every((x) => x.state === "barrier")) return;
    for (const x of live) { x.state = "ready"; x.nextIssue = cycle + 1; }
  }
}
