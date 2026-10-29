// Out-of-order engine, ported in behaviour from legacy/src/b2.js (EngOoO):
//   fetch queue -> decode -> dispatch (rename via RAT, allocate ROB + scheduler slots) -> scheduler -> units -> ROB -> in-order commit
// Units: ALU0, ALU1 (1 cycle), MUL (3), LSU (load hit 2, miss 2 + missPenalty, forwarded 2, store 1; one memory op at a time).
// Per step (one cycle), back to front: COMMIT (up to `width` finished instructions, in order; stores write memory here),
// EXECUTE (units count down; finished results become visible, control ops resolve and squash younger work),
// ISSUE (oldest ready scheduler entry first), DISPATCH, decode refill, FETCH.
//
// Architectural state (registers, memory) changes only at commit, so it is precise at every halt:
//  - loads that could have side effects or fault (device addresses, unaligned or out of range) wait until they are the
//    oldest instruction in the ROB; wrong-path work can never touch a device;
//  - loads wait for every older store to have executed (conservative disambiguation), then forward from the youngest
//    older store that fully covers them, or wait for the store to commit if it only partly overlaps (or is a device store);
//  - ecall halts when it commits; younger work is squashed.
//
// Full SMT (docs/MULTICORE.md section 5): a core with `threads: 2` runs both threads in the pipeline at once. Each thread is a "lane" with its own fetch queue
// (half of the configured one), decode slots, RAT and half of the ROB; the scheduler, the units, the load/store unit and the caches are shared. Fetch serves one lane
// per cycle (the one with fewer instructions in flight), dispatch and commit take from either lane, issue picks the oldest ready entry of both. A mispredict or a page
// fault squashes only its own lane; an ecall ends only its thread. With one lane every step is the plain engine's.
//
// Internals use pool slots (allocated from a free list, because ids of squashed wrong-path instructions leave gaps);
// `slotId[slot]` is the dynamic instruction id shown in the view. The view's id arrays are derived from the slot
// queues once per cycle (snapshot).

import { MMU_BASE, MMU_SIZE } from "../isa/memmap";
import type { Core } from "../machine/core";
import { F, F_MEM, OPF, OP_ECALL, OP_IRET, OP_LB, OP_LW, OP_MUL, OP_SW, St, EngineBase, type EngineSettings } from "./common";
import {
  CommitStall, Counter, DispatchStall, FetchStall, Fate, OooPart, OooViewState, Occ, RobState, SchedWhy, StageCode, Unit,
  UNIT_COUNT, type OooView,
} from "./view";

export interface OooSettings extends EngineSettings {
  /** Reorder buffer entries. Default 8. */
  robSize?: number;
  /** Scheduler (reservation station) entries. Default 6. */
  schedSize?: number;
  /** Fetch queue entries. Default 4. */
  fetchQueue?: number;
  /** Fetch / dispatch width. Default 2. */
  width?: number;
  /** Instructions that can commit per cycle. Default = width. Wider than `width` lets the ROB drain a backlog quickly. */
  commitWidth?: number;
  /** Threads the core can hold at once (full SMT, 1..`MAX_SMT_THREADS`): the pool and the view are sized for them. Default 1. */
  threads?: number;
}

/** Threads one out-of-order core can hold. */
export const MAX_SMT_THREADS = 2;

/** Per-slot lifecycle. */
const Os = { Free: 0, Fetched: 1, Decoded: 2, Wait: 3, Issued: 4, Done: 5, Committed: 6 } as const;
const F_CTRL = F.Branch | F.Jal | F.Jalr;
const HIT_LAT = 2;

/** One thread's front end and ROB partition. */
class Lane {
  readonly fq: Int32Array;
  readonly dq: Int32Array;
  readonly rob: Int32Array;
  /** Rename table: slot of the newest in-flight writer of each register, or -1. */
  readonly rat = new Int32Array(16);
  /** The instruction fetch in progress for this thread (see `EngineBase.swapFetchWait`). */
  readonly fw = new Int32Array(3);
  fqN = 0;
  dqN = 0;
  robN = 0;
  robHead = 0;
  /** The next pc to fetch. */
  pc = 0;
  stopped = false;
  hold = false;
  halted = false;
  constructor(readonly t: number, fq: number, width: number, rob: number) {
    this.fq = new Int32Array(fq); this.dq = new Int32Array(width); this.rob = new Int32Array(rob);
  }
  reset(pc: number): void {
    this.fq.fill(-1); this.dq.fill(-1); this.rob.fill(-1); this.rat.fill(-1);
    this.fw[0] = -1; this.fw[1] = 0; this.fw[2] = 0;
    this.fqN = this.dqN = this.robN = this.robHead = 0;
    this.pc = pc >>> 0;
    this.stopped = this.hold = this.halted = false;
  }
  get inflight(): number { return this.fqN + this.dqN + this.robN; }
}

export class OooEngine extends EngineBase {
  readonly width: number;
  readonly commitWidth: number;
  readonly robSize: number;
  readonly schedSize: number;
  readonly fetchQueueSize: number;
  private readonly ov: OooViewState;
  // Per pool slot.
  private readonly slotId: Int32Array;
  private readonly ost: Uint8Array;
  /** Producer of each source operand: slot and the id that was in it (valid while slotId[slot] still matches), or -1. */
  private readonly prodSA: Int32Array;
  private readonly prodIA: Int32Array;
  private readonly prodSB: Int32Array;
  private readonly prodIB: Int32Array;
  private readonly rsPos: Int32Array;
  private readonly actual: Uint32Array;
  private readonly freeSlots: Int32Array;
  private freeN = 0;
  // Structures, as slots (-1 = empty).
  private readonly lanes: Lane[];
  private readonly rsS: Int32Array;
  private readonly unitS = new Int32Array(UNIT_COUNT);
  private readonly finU = new Int32Array(UNIT_COUNT);
  private readonly finId = new Int32Array(UNIT_COUNT);
  /** The ROB entries of every lane in age order, for the issue stage: slot, lane and position in its ROB. */
  private readonly ordS: Int32Array;
  private readonly ordL: Int32Array;
  private readonly ordK: Int32Array;
  private readonly seen = new Uint8Array(MAX_SMT_THREADS);
  private rsN = 0;
  /** ROB entries and fetch queue entries each lane may use with the threads it has now. */
  private rcap: number;
  private fqCap: number;
  /** The thread `drained`, `pc`, `holdFetch` and `redirect` speak for. */
  private cur = 0;
  private why = 0;

  constructor(settings: OooSettings = {}) {
    const width = settings.width ?? 2;
    const robSize = settings.robSize ?? 8;
    const schedSize = settings.schedSize ?? 6;
    const fq = settings.fetchQueue ?? 4;
    const commitWidth = settings.commitWidth ?? width;
    const threads = settings.threads ?? 1;
    if (!Number.isInteger(width) || width < 1 || width > 4) throw new RangeError("width must be 1..4");
    if (!Number.isInteger(commitWidth) || commitWidth < 1 || commitWidth > 8) throw new RangeError("commitWidth must be 1..8");
    if (!Number.isInteger(robSize) || robSize < 2 || robSize > 256) throw new RangeError("robSize must be 2..256");
    if (!Number.isInteger(schedSize) || schedSize < 1 || schedSize > 128) throw new RangeError("schedSize must be 1..128");
    if (!Number.isInteger(fq) || fq < width || fq > 64) throw new RangeError("fetchQueue must be width..64");
    if (!Number.isInteger(threads) || threads < 1 || threads > MAX_SMT_THREADS) throw new RangeError(`threads must be 1..${MAX_SMT_THREADS}`);
    if (threads > 1 && (robSize < 2 * threads || fq < width * threads)) throw new RangeError("the ROB and the fetch queue have to split between the threads");
    const size = fq + width * threads + robSize; // at most this many instructions are in flight
    const view = new OooViewState(settings.timelineRows ?? Math.max(32, 2 * size), settings.timelineCols ?? 64, width, robSize, schedSize, fq, threads);
    super(settings, size, view);
    this.ov = view;
    this.width = width; this.commitWidth = commitWidth; this.robSize = robSize; this.schedSize = schedSize; this.fetchQueueSize = fq;
    this.rcap = robSize; this.fqCap = fq;
    this.slotId = new Int32Array(size); this.ost = new Uint8Array(size);
    this.prodSA = new Int32Array(size); this.prodIA = new Int32Array(size);
    this.prodSB = new Int32Array(size); this.prodIB = new Int32Array(size);
    this.rsPos = new Int32Array(size); this.actual = new Uint32Array(size);
    this.freeSlots = new Int32Array(size);
    this.lanes = Array.from({ length: threads }, (_, t) => new Lane(t, fq, width, robSize));
    this.rsS = new Int32Array(schedSize);
    this.ordS = new Int32Array(robSize); this.ordL = new Int32Array(robSize); this.ordK = new Int32Array(robSize);
  }

  override get view(): OooView { return this.ov; }

  /** Nothing in the fetch queue, decode, or the ROB (units and the scheduler only hold ROB entries): of the thread chosen with `selectThread`. */
  get drained(): boolean {
    const L = this.lanes[this.cur]!;
    return L.robN === 0 && L.fqN === 0 && L.dqN === 0;
  }

  override get pc(): number { return this.lanes[this.cur]!.pc; }
  override holdFetch(on: boolean): void { this.lanes[this.cur]!.hold = on; }
  override redirect(pc: number): void { this.lanes[this.cur]!.pc = pc >>> 0; }

  // ---- threads (full SMT) ----

  get concurrent(): boolean { return true; }
  selectThread(t: number): void { this.cur = t; }
  threadHalted(t: number): boolean { return this.lanes[t]!.halted; }

  override addThread(core: Core): void {
    const t = this.cores.length;
    if (t >= this.lanes.length) throw new RangeError(`at most ${this.lanes.length} threads on this core (the engine was built for ${this.lanes.length})`);
    this.cores.push(core);
    this.lanes[t]!.reset(core.entry);
    this.rcap = Math.floor(this.robSize / this.cores.length);
    this.fqCap = Math.floor(this.fetchQueueSize / this.cores.length);
    this.ov.lanes = this.cores.length; this.ov.robCap = this.rcap; this.ov.fetchCap = this.fqCap;
  }

  /** Make thread `t` the one the helpers (registers, MMU, interrupt state, the protection unit) act for. A core with one thread has nothing to switch. */
  private on(t: number): void {
    if (this.cores.length < 2) return;
    this.useThread(t);
    const c = this.cores[t]!;
    this.bus.serve(c.index, c.mpu);
  }

  protected override onReset(): void {
    this.slotId.fill(-1); this.ost.fill(0); this.prodSA.fill(-1); this.prodSB.fill(-1); this.rsPos.fill(-1);
    this.rsS.fill(-1); this.unitS.fill(-1);
    for (const L of this.lanes) L.reset(this.fetchPc);
    for (let i = 0; i < this.freeSlots.length; i++) this.freeSlots[i] = i;
    this.freeN = this.freeSlots.length;
    this.rsN = 0;
    this.rcap = this.robSize; this.fqCap = this.fetchQueueSize; this.cur = 0;
    this.snapshot();
  }

  override flipPredictor(pc?: number): void { this.pred.flip(pc); }

  /** The lane whose oldest instruction is finished, the older one if both are; null when none can retire. */
  private commitLane(): Lane | null {
    let best: Lane | null = null, bid = 0;
    for (let i = 0; i < this.cores.length; i++) {
      const L = this.lanes[i]!;
      if (L.robN === 0) continue;
      const s = L.rob[L.robHead]!;
      if (this.ost[s] !== Os.Done) continue;
      const id = this.slotId[s]!;
      if (best === null || id < bid) { best = L; bid = id; }
    }
    return best;
  }

  private robTotal(): number {
    let n = 0;
    for (let i = 0; i < this.cores.length; i++) n += this.lanes[i]!.robN;
    return n;
  }

  step(): void {
    if (this.isHalted) return;
    const v = this.ov, p = this.pool, c = v.counters, W = this.width, rs = this.rcap, nl = this.cores.length, lanes = this.lanes;
    const slotId = this.slotId, ost = this.ost;
    this.cycleNo++;
    c[Counter.Cycles]!++;
    v.beginCycle(this.cycleNo);
    v.stall.fill(0);

    // COMMIT: up to `commitWidth` finished instructions retire, each lane in program order.
    for (let n = 0; n < this.commitWidth; n++) {
      const L = this.commitLane();
      if (!L) {
        if (n === 0) v.stall[OooPart.Commit] = this.robTotal() === 0 ? CommitStall.Empty : CommitStall.HeadPending;
        break;
      }
      const s = L.rob[L.robHead]!;
      const id = slotId[s]!;
      const op = p.op[s]!;
      if (p.fault[s]) { this.faultAtCommit(L, s, id); return; } // a page fault, now known to be on the right path: it is the oldest of its thread, everything older has retired
      if (op === 0) this.execute(s); // illegal instruction reached commit: throws RangeError
      this.on(L.t);
      L.rob[L.robHead] = -1;
      L.robHead = (L.robHead + 1) % rs;
      L.robN--;
      const f = OPF[op]!;
      let mmuWrite = false;
      if (f & F.Amo) {
        // the read and the write were done when it issued as the oldest entry (nothing older was pending); only the register is left
        if (p.rd[s] !== 0) {
          this.writeReg(p.rd[s]!, p.res[s]!);
          if (L.rat[p.rd[s]!] === s) L.rat[p.rd[s]!] = -1;
        }
      } else if (f & F.Store) {
        if (op === OP_SW) this.bus.store32(p.addr[s]!, p.b[s]!);
        else this.bus.store8(p.addr[s]!, p.b[s]!);
        this.logMem(1, p.addr[s]!, p.b[s]!);
        mmuWrite = p.addr[s]! - MMU_BASE >>> 0 < MMU_SIZE;
      } else if (f & F.Writes && p.rd[s] !== 0) {
        this.writeReg(p.rd[s]!, p.res[s]!);
        if (L.rat[p.rd[s]!] === s) L.rat[p.rd[s]!] = -1;
      }
      ost[s] = Os.Committed;
      this.freeSlots[this.freeN++] = s;
      this.retire(id, op);
      v.threadRetired[L.t]!++;
      v.mark(id, StageCode.C);
      if (mmuWrite) {
        // the translation state just changed: everything younger was fetched and translated under the old one, so it is thrown away and fetched again
        this.squashAfter(L, id);
        L.pc = (p.pc[s]! + 4) >>> 0;
        L.stopped = false;
        c[Counter.Flushes]!++;
      }
      if (op === OP_ECALL) {
        L.halted = true;
        L.pc = (p.pc[s]! + 4) >>> 0;
        this.squashAfter(L, id);
        let all = true;
        for (let i = 0; i < nl; i++) if (!lanes[i]!.halted && !this.cores[i]!.intc.parked) all = false; // a parked thread has nothing left to run
        if (all) {
          this.isHalted = true;
          this.fetchPc = L.pc;
          this.snapshot();
          return;
        }
      }
    }

    // EXECUTE: units count down; finished results become visible; control transfers resolve.
    let nf = 0;
    for (let u = 0; u < UNIT_COUNT; u++) {
      const s = this.unitS[u]!;
      if (s < 0) continue;
      if (u === Unit.LSU && p.state[s]! & St.Missing) c[Counter.StallCache]!++;
      const left = v.unitLeft[u]! - 1;
      v.unitLeft[u] = left;
      if (left > 0) continue;
      // insertion sort by id (oldest first)
      const id = slotId[s]!;
      let k = nf++;
      while (k > 0 && this.finId[k - 1]! > id) { this.finId[k] = this.finId[k - 1]!; this.finU[k] = this.finU[k - 1]!; k--; }
      this.finId[k] = id; this.finU[k] = u;
    }
    for (let k = 0; k < nf; k++) {
      const u = this.finU[k]!;
      const s = this.unitS[u]!;
      if (s < 0 || slotId[s] !== this.finId[k]) continue; // squashed by an older branch finishing in this same cycle
      this.unitS[u] = -1;
      const id = slotId[s]!;
      ost[s] = Os.Done;
      v.mark(id, StageCode.R);
      const f = OPF[p.op[s]!]!;
      if (p.state[s]! & St.Missing) { this.dFill(p.addr[s]!); p.state[s]! &= ~St.Missing; }
      if (f & F_CTRL) {
        const next = this.actual[s]!;
        if (f & F.Branch) {
          c[Counter.Branches]!++;
          this.trainPred(p.pc[s]!, next !== ((p.pc[s]! + 4) >>> 0));
        }
        if (next !== p.predNext[s]) {
          const L = lanes[p.thread[s]!]!;
          c[Counter.Flushes]!++;
          if (f & F.Branch) c[Counter.BranchMispredicts]!++;
          this.squashAfter(L, id);
          L.pc = next;
          L.stopped = false;
        }
      }
    }

    // ISSUE: oldest ready scheduler entry first (of both lanes), onto a free unit.
    const total = this.agedEntries();
    for (let i = 0; i < total; i++) {
      const s = this.ordS[i]!, L = lanes[this.ordL[i]!]!, k = this.ordK[i]!;
      if (ost[s] !== Os.Wait) continue;
      const pos = this.rsPos[s]!;
      if (!this.ready(this.prodSA[s]!, this.prodIA[s]!) || !this.ready(this.prodSB[s]!, this.prodIB[s]!)) { v.schedWhy[pos] = SchedWhy.Operands; continue; }
      const op = p.op[s]!;
      // iret reads the interrupt controller's EPC, which older stores may still be writing: it runs when it is the oldest.
      if (op === OP_IRET && k !== 0) { v.schedWhy[pos] = SchedWhy.Head; continue; }
      const f = OPF[op]!;
      // an atomic reads and writes memory in one step, so it waits until it is the oldest (every older store has committed): never speculative
      if (f & F.Amo && k !== 0) { v.schedWhy[pos] = SchedWhy.Head; continue; }
      let u: number;
      if (f & F_MEM) u = this.unitS[Unit.LSU]! < 0 ? Unit.LSU : -1;
      else if (op === OP_MUL) u = this.unitS[Unit.MUL]! < 0 ? Unit.MUL : -1;
      else u = this.unitS[Unit.ALU0]! < 0 ? Unit.ALU0 : this.unitS[Unit.ALU1]! < 0 ? Unit.ALU1 : -1;
      if (u < 0) {
        v.schedWhy[pos] = SchedWhy.Unit;
        if (nl > 1 && this.heldByOther(f, op, L.t)) c[Counter.SmtUnitConflicts]!++;
        continue;
      }
      this.on(L.t);
      p.a[s] = f & F.Rs1 ? this.value(this.prodSA[s]!, this.prodIA[s]!, p.rs1[s]!) : 0;
      p.b[s] = f & F.Rs2 ? this.value(this.prodSB[s]!, this.prodIB[s]!, p.rs2[s]!) : 0;
      this.actual[s] = this.execute(s);
      let lat = 1;
      if (p.fault[s]) { /* the MMU refused the access: it completes as nothing and the fault is taken at commit */ }
      else if (f & F.Amo) {
        // always through the L2 (never the L1): the access costs the miss cost; the word is read and written now
        this.amoCheck(p.addr[s]!, p.pc[s]!);
        this.amoApply(s);
        lat = HIT_LAT + this.missCost(p.addr[s]!);
      } else if (f & F.Load) {
        lat = this.issueLoad(L, k, s);
        if (lat < 0) { v.schedWhy[pos] = this.why; c[Counter.LoadWaits]!++; continue; }
      } else if (op === OP_MUL) lat = 3;
      this.rsS[pos] = -1; v.schedWhy[pos] = SchedWhy.None;
      this.rsN--;
      this.unitS[u] = s; v.unitLeft[u] = lat; v.unitTotal[u] = lat;
      ost[s] = Os.Issued;
      v.mark(slotId[s]!, StageCode.X);
      c[Counter.Issued]!++;
      v.threadIssued[L.t]!++;
    }

    // DISPATCH (rename): ROB slot + scheduler slot, operand sources through the lane's RAT. Each slot goes to the first lane (in turn) that can take its next instruction.
    this.seen.fill(0);
    for (let n = 0; n < W; n++) {
      let did = false, anyDq = false, why = 0;
      for (let i = 0; i < nl && !did; i++) {
        const L = lanes[(this.cycleNo + n + i) % nl]!;
        if (L.dqN === 0) continue;
        anyDq = true;
        const s = L.dq[0]!;
        const op = p.op[s]!;
        const instant = op === 0 || op === OP_ECALL; // nothing to execute: done on arrival (ecall halts / illegal throws at commit)
        if (L.robN >= rs) {
          if (!this.seen[L.t]) { this.seen[L.t] = 1; c[Counter.StallRobFull]!++; }
          why = DispatchStall.RobFull;
          continue;
        }
        if (!instant && this.rsN >= this.schedSize) {
          if (!this.seen[L.t]) { this.seen[L.t] = 1; c[Counter.StallSchedFull]!++; }
          why ||= DispatchStall.SchedFull;
          continue;
        }
        for (let l = 1; l < L.dqN; l++) L.dq[l - 1] = L.dq[l]!;
        L.dq[--L.dqN] = -1;
        const f = OPF[op]!;
        const pa = f & F.Rs1 && p.rs1[s] !== 0 ? L.rat[p.rs1[s]!]! : -1;
        const pb = f & F.Rs2 && p.rs2[s] !== 0 ? L.rat[p.rs2[s]!]! : -1;
        this.prodSA[s] = pa; this.prodIA[s] = pa >= 0 ? slotId[pa]! : -1;
        this.prodSB[s] = pb; this.prodIB[s] = pb >= 0 ? slotId[pb]! : -1;
        if (f & F.Writes && p.rd[s] !== 0) L.rat[p.rd[s]!] = s;
        L.rob[(L.robHead + L.robN) % rs] = s;
        L.robN++;
        if (instant) ost[s] = Os.Done;
        else {
          let pos = 0;
          while (this.rsS[pos]! >= 0) pos++;
          this.rsS[pos] = s; v.schedWhy[pos] = SchedWhy.None;
          this.rsPos[s] = pos;
          this.rsN++;
          ost[s] = Os.Wait;
        }
        v.mark(slotId[s]!, StageCode.S);
        did = true;
      }
      if (!did) {
        if (!anyDq) { if (n === 0) v.stall[OooPart.Dispatch] = DispatchStall.Empty; }
        else v.stall[OooPart.Dispatch] = why;
        break;
      }
    }

    // Decode refill from the fetch queues.
    for (let i = 0; i < nl; i++) {
      const L = lanes[i]!;
      while (L.dqN < W && L.fqN > 0) {
        const s = L.fq[0]!;
        for (let l = 1; l < L.fqN; l++) L.fq[l - 1] = L.fq[l]!;
        L.fq[--L.fqN] = -1;
        L.dq[L.dqN++] = s;
        ost[s] = Os.Decoded;
      }
    }

    // FETCH: a group of up to `width` for one lane, ended by any control instruction. The lane with fewer instructions in flight goes first; one that cannot fetch (stopped, queue full, waiting for the instruction cache) leaves the turn to the other.
    const first = nl > 1 && (lanes[1]!.inflight < lanes[0]!.inflight || (lanes[1]!.inflight === lanes[0]!.inflight && (this.cycleNo & 1) === 1)) ? 1 : 0;
    let fetched = false;
    for (let i = 0; i < nl && !fetched; i++) {
      const L = lanes[(first + i) % nl]!;
      if (L.halted) continue;
      if (L.stopped || L.hold) { v.stall[OooPart.Fetch] = FetchStall.Stopped; continue; }
      if (L.fqN + W > this.fqCap) { v.stall[OooPart.Fetch] = FetchStall.QueueFull; continue; }
      v.stall[OooPart.Fetch] = 0;
      this.on(L.t);
      if (nl > 1) this.swapFetchWait(L.fw);
      for (let l = 0; l < W; l++) {
        if (!this.fetchReady(L.pc)) { v.stall[OooPart.Fetch] = FetchStall.ICache; break; }
        fetched = true;
        if (this.fetchOne(L)) break;
      }
      if (nl > 1) this.swapFetchWait(L.fw);
    }

    // Timeline: everything in flight shows where it is this cycle (explicit marks above win).
    for (let t = 0; t < nl; t++) {
      const L = lanes[t]!;
      for (let i = 0; i < L.fqN; i++) v.mark(slotId[L.fq[i]!]!, StageCode.F);
      for (let i = 0; i < L.dqN; i++) v.mark(slotId[L.dq[i]!]!, StageCode.D);
      for (let k = 0; k < L.robN; k++) {
        const s = L.rob[(L.robHead + k) % rs]!;
        const st = ost[s];
        if (st === Os.Wait) v.markIfEmpty(slotId[s]!, StageCode.S);
        else if (st === Os.Issued) v.mark(slotId[s]!, StageCode.X);
        else v.markIfEmpty(slotId[s]!, StageCode.R);
      }
    }
    c[Counter.RobOccupancySum]! += this.robTotal();
    c[Counter.SchedOccupancySum]! += this.rsN;
    this.snapshot();
  }

  /** Fill `ordS`/`ordL`/`ordK` with every ROB entry of every lane, oldest first, and return how many. */
  private agedEntries(): number {
    const nl = this.cores.length, rs = this.rcap, lanes = this.lanes;
    let total = 0;
    if (nl === 1) {
      const L = lanes[0]!;
      for (let k = 0; k < L.robN; k++) { this.ordS[total] = L.rob[(L.robHead + k) % rs]!; this.ordL[total] = 0; this.ordK[total] = k; total++; }
      return total;
    }
    const at = [0, 0];
    for (;;) {
      let best = -1, bid = 0;
      for (let t = 0; t < nl; t++) {
        const L = lanes[t]!;
        if (at[t]! >= L.robN) continue;
        const id = this.slotId[L.rob[(L.robHead + at[t]!) % rs]!]!;
        if (best < 0 || id < bid) { best = t; bid = id; }
      }
      if (best < 0) return total;
      const L = lanes[best]!;
      this.ordS[total] = L.rob[(L.robHead + at[best]!) % rs]!; this.ordL[total] = best; this.ordK[total] = at[best]!; total++;
      at[best]!++;
    }
  }

  /** A ready instruction found its unit busy: whether the instruction holding it (or one of the two ALUs) belongs to the other thread. */
  private heldByOther(f: number, op: number, t: number): boolean {
    const p = this.pool, held = (u: number): boolean => { const s = this.unitS[u]!; return s >= 0 && p.thread[s] !== t; };
    if (f & F_MEM) return held(Unit.LSU);
    if (op === OP_MUL) return held(Unit.MUL);
    return held(Unit.ALU0) || held(Unit.ALU1);
  }

  /** Operand availability: no in-flight producer (value in the register file), or the producer has executed. */
  private ready(ps: number, pid: number): boolean {
    if (ps < 0) return true;
    if (this.slotId[ps] !== pid || this.ost[ps] === Os.Committed) return true;
    return this.ost[ps] === Os.Done;
  }

  private value(ps: number, pid: number, r: number): number {
    if (ps >= 0 && this.slotId[ps] === pid && this.ost[ps] === Os.Done) return this.pool.res[ps]!;
    return r === 0 ? 0 : this.regs[r]!;
  }

  /**
   * Load issue for position k of lane `L`'s ROB: returns the unit latency, or -1 if it must wait (cause in this.why).
   * Fills res (and the Missing state for cache misses). Only the thread's own older stores are looked at (the other thread's land in memory when they commit).
   */
  private issueLoad(L: Lane, k: number, s: number): number {
    const p = this.pool, c = this.ov.counters, rs = this.rcap;
    const op = p.op[s]!, addr = p.addr[s]!;
    const size = op === OP_LW ? 4 : 1;
    const ramSafe = op === OP_LW ? (addr & 3) === 0 && addr + 4 <= this.ramSize : addr < this.ramSize;
    if (!ramSafe) {
      // Device / faulting access: only when it is the oldest instruction of its thread, so it is never speculative.
      if (k !== 0) { this.why = SchedWhy.Head; return -1; }
      p.res[s] = this.load(op, addr);
      return HIT_LAT;
    }
    let fwd = -1;
    for (let j = 0; j < k; j++) {
      const js = L.rob[(L.robHead + j) % rs]!;
      if (!(OPF[p.op[js]!]! & F.Store)) continue;
      if (this.ost[js] !== Os.Done || p.addr[js]! >= this.ramSize) { this.why = SchedWhy.Memory; return -1; }
      if (OPF[p.op[js]!]! & F.Amo) continue; // an atomic has already written RAM: read it from there, never forward its operand
      const sz = p.op[js] === OP_SW ? 4 : 1;
      if (p.addr[js]! < addr + size && addr < p.addr[js]! + sz) fwd = js; // youngest overlapping older store wins
    }
    if (fwd >= 0) {
      const sa = p.addr[fwd]!, sz = p.op[fwd] === OP_SW ? 4 : 1;
      if (!(sa <= addr && addr + size <= sa + sz)) { this.why = SchedWhy.Memory; return -1; } // partial overlap: wait for the commit
      const word = p.b[fwd]!;
      if (op === OP_LW) p.res[s] = word | 0;
      else {
        const byte = (word >>> (8 * (addr - sa))) & 0xff;
        p.res[s] = op === OP_LB ? (byte << 24) >> 24 : byte;
      }
      c[Counter.LoadForwards]!++;
      return HIT_LAT;
    }
    p.res[s] = this.load(op, addr);
    this.logMem(0, addr, p.res[s]!);
    if (this.dHit(addr)) { c[Counter.CacheHits]!++; return HIT_LAT; }
    c[Counter.CacheMisses]!++;
    p.state[s]! |= St.Missing;
    return HIT_LAT + this.missCost(addr);
  }

  /** The oldest instruction of a thread carries a page fault: it and everything younger in that thread are squashed (nothing of it has happened), the OS takes over. */
  private faultAtCommit(L: Lane, s: number, id: number): void {
    this.on(L.t);
    this.takeFault(s);
    L.pc = this.fetchPc;
    this.squashAfter(L, id - 1);
    L.stopped = false;
    this.ov.counters[Counter.Flushes]!++;
    this.snapshot();
  }

  /** Squash everything of lane `L` younger than id `bid`: ROB tail, queues, units; rebuild the RAT from what remains. */
  private squashAfter(L: Lane, bid: number): void {
    const v = this.ov, p = this.pool, rs = this.rcap;
    while (L.robN > 0) {
      const idx = (L.robHead + L.robN - 1) % rs;
      const s = L.rob[idx]!;
      if (this.slotId[s]! <= bid) break;
      if (this.ost[s] === Os.Wait) { const pos = this.rsPos[s]!; this.rsS[pos] = -1; v.schedWhy[pos] = SchedWhy.None; this.rsN--; }
      this.kill(s);
      L.rob[idx] = -1;
      L.robN--;
    }
    for (let i = 0; i < L.dqN; i++) { this.kill(L.dq[i]!); L.dq[i] = -1; }
    for (let i = 0; i < L.fqN; i++) { this.kill(L.fq[i]!); L.fq[i] = -1; }
    L.dqN = L.fqN = 0;
    for (let u = 0; u < UNIT_COUNT; u++) {
      const s = this.unitS[u]!;
      if (s >= 0 && p.thread[s] === L.t && this.slotId[s]! > bid) this.unitS[u] = -1;
    }
    L.rat.fill(-1);
    for (let k = 0; k < L.robN; k++) {
      const s = L.rob[(L.robHead + k) % rs]!;
      if (OPF[p.op[s]!]! & F.Writes && p.rd[s] !== 0) L.rat[p.rd[s]!] = s;
    }
  }

  private kill(s: number): void {
    const v = this.ov, id = this.slotId[s]!;
    v.mark(id, StageCode.Flushed);
    v.setFate(id, Fate.Flushed);
    v.counters[Counter.FlushedInstrs]!++;
    this.ost[s] = Os.Free;
    this.freeSlots[this.freeN++] = s;
  }

  /** Fetch one instruction of lane `L` into its fetch queue; returns true if the fetch group ends (control instruction). */
  private fetchOne(L: Lane): boolean {
    const v = this.ov, p = this.pool;
    const s = this.freeSlots[--this.freeN]!;
    const id = v.nextId++;
    const pc = L.pc;
    this.fetchInto(s, pc);
    p.decodeSlot(s);
    p.thread[s] = L.t;
    v.startRow(id, pc, p.word[s]!, L.t);
    const f = OPF[p.op[s]!]!;
    let next = (pc + 4) >>> 0;
    if (f & F.Branch) {
      if (this.pred.predict(pc)) next = (pc + p.imm[s]!) >>> 0;
    } else if (f & F.Jal) {
      next = (pc + p.imm[s]!) >>> 0;
    }
    p.predNext[s] = next;
    L.pc = next;
    this.slotId[s] = id;
    this.ost[s] = Os.Fetched;
    this.prodSA[s] = this.prodSB[s] = -1;
    L.fq[L.fqN++] = s;
    if (p.op[s] === OP_ECALL) { L.stopped = true; return true; }
    return (f & F_CTRL) !== 0;
  }

  /** Fill the view arrays (ids, pcs, states, counts) from the slot structures. Thread t's part of each array starts at t times its share (see `OooView.lanes`). */
  private snapshot(): void {
    const v = this.ov, p = this.pool, nl = this.cores.length, lanes = this.lanes;
    const fc = this.fqCap, W = this.width, rc = this.rcap;
    for (let i = 0; i < v.fetchId.length; i++) {
      const t = Math.floor(i / fc), s = t < nl ? lanes[t]!.fq[i % fc]! : -1;
      v.fetchId[i] = s >= 0 ? this.slotId[s]! : -1; v.fetchPc[i] = s >= 0 ? p.pc[s]! : 0;
    }
    for (let i = 0; i < v.decodeId.length; i++) {
      const t = Math.floor(i / W), s = t < nl ? lanes[t]!.dq[i % W]! : -1;
      v.decodeId[i] = s >= 0 ? this.slotId[s]! : -1; v.decodePc[i] = s >= 0 ? p.pc[s]! : 0;
    }
    for (let i = 0; i < v.robId.length; i++) {
      const t = Math.floor(i / rc), s = t < nl ? lanes[t]!.rob[i % rc]! : -1;
      if (s < 0) { v.robId[i] = -1; v.robPc[i] = 0; v.robState[i] = RobState.Empty; continue; }
      v.robId[i] = this.slotId[s]!;
      v.robPc[i] = p.pc[s]!;
      const st = this.ost[s];
      v.robState[i] = st === Os.Wait ? RobState.Waiting : st === Os.Issued ? RobState.Executing : RobState.Done;
    }
    for (let i = 0; i < v.schedId.length; i++) {
      const s = this.rsS[i]!;
      v.schedId[i] = s >= 0 ? this.slotId[s]! : -1; v.schedPc[i] = s >= 0 ? p.pc[s]! : 0;
      if (s < 0) v.schedWhy[i] = SchedWhy.None;
    }
    let busy = 0;
    for (let u = 0; u < UNIT_COUNT; u++) {
      const s = this.unitS[u]!;
      v.unitId[u] = s >= 0 ? this.slotId[s]! : -1; v.unitPc[u] = s >= 0 ? p.pc[s]! : 0;
      if (s < 0) { v.unitLeft[u] = 0; v.unitTotal[u] = 0; } else busy++;
    }
    const L0 = lanes[0]!;
    v.occ[Occ.Fetch] = L0.fqN; v.occ[Occ.Decode] = L0.dqN; v.occ[Occ.Rob] = L0.robN;
    v.occ[Occ.Sched] = this.rsN; v.occ[Occ.Units] = busy; v.occ[Occ.RobHead] = L0.robHead;
    for (let t = 0; t < nl; t++) {
      const L = lanes[t]!;
      v.laneOcc[4 * t] = L.fqN; v.laneOcc[4 * t + 1] = L.dqN; v.laneOcc[4 * t + 2] = L.robN; v.laneOcc[4 * t + 3] = L.robHead;
    }
  }
}
