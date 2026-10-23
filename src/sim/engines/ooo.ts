// Single-core out-of-order engine, ported in behaviour from legacy/src/b2.js (EngOoO):
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
// Internals use pool slots (allocated from a free list, because ids of squashed wrong-path instructions leave gaps);
// `slotId[slot]` is the dynamic instruction id shown in the view. The view's id arrays are derived from the slot
// queues once per cycle (snapshot).

import { F, F_MEM, OPF, OP_ECALL, OP_LB, OP_LW, OP_MUL, OP_SW, St, EngineBase, type EngineSettings } from "./common";
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
}

/** Per-slot lifecycle. */
const Os = { Free: 0, Fetched: 1, Decoded: 2, Wait: 3, Issued: 4, Done: 5, Committed: 6 } as const;
const PRED_SIZE = 64;
const F_CTRL = F.Branch | F.Jal | F.Jalr;
const HIT_LAT = 2;

export class OooEngine extends EngineBase {
  readonly width: number;
  readonly commitWidth: number;
  readonly robSize: number;
  readonly schedSize: number;
  readonly fetchQueueSize: number;
  private readonly ov: OooViewState;
  private readonly pred = new Uint8Array(PRED_SIZE);
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
  private readonly fqS: Int32Array;
  private readonly dqS: Int32Array;
  private readonly robS: Int32Array;
  private readonly rsS: Int32Array;
  private readonly unitS = new Int32Array(UNIT_COUNT);
  /** Rename table: slot of the newest in-flight writer of each register, or -1. */
  private readonly rat = new Int32Array(16);
  private readonly finU = new Int32Array(UNIT_COUNT);
  private readonly finId = new Int32Array(UNIT_COUNT);
  private fqN = 0;
  private dqN = 0;
  private robN = 0;
  private robHead = 0;
  private rsN = 0;
  private fetchStopped = false;
  private why = 0;

  constructor(settings: OooSettings = {}) {
    const width = settings.width ?? 2;
    const robSize = settings.robSize ?? 8;
    const schedSize = settings.schedSize ?? 6;
    const fq = settings.fetchQueue ?? 4;
    const commitWidth = settings.commitWidth ?? width;
    if (!Number.isInteger(width) || width < 1 || width > 4) throw new RangeError("width must be 1..4");
    if (!Number.isInteger(commitWidth) || commitWidth < 1 || commitWidth > 8) throw new RangeError("commitWidth must be 1..8");
    if (!Number.isInteger(robSize) || robSize < 2 || robSize > 256) throw new RangeError("robSize must be 2..256");
    if (!Number.isInteger(schedSize) || schedSize < 1 || schedSize > 128) throw new RangeError("schedSize must be 1..128");
    if (!Number.isInteger(fq) || fq < width || fq > 64) throw new RangeError("fetchQueue must be width..64");
    const size = fq + width + robSize; // at most this many instructions are in flight
    const view = new OooViewState(settings.timelineRows ?? Math.max(32, 2 * size), settings.timelineCols ?? 64, width, robSize, schedSize, fq);
    super(settings, size, view);
    this.ov = view;
    this.width = width; this.commitWidth = commitWidth; this.robSize = robSize; this.schedSize = schedSize; this.fetchQueueSize = fq;
    this.slotId = new Int32Array(size); this.ost = new Uint8Array(size);
    this.prodSA = new Int32Array(size); this.prodIA = new Int32Array(size);
    this.prodSB = new Int32Array(size); this.prodIB = new Int32Array(size);
    this.rsPos = new Int32Array(size); this.actual = new Uint32Array(size);
    this.freeSlots = new Int32Array(size);
    this.fqS = new Int32Array(fq); this.dqS = new Int32Array(width);
    this.robS = new Int32Array(robSize); this.rsS = new Int32Array(schedSize);
  }

  override get view(): OooView { return this.ov; }

  protected override onReset(): void {
    this.pred.fill(0);
    this.slotId.fill(-1); this.ost.fill(0); this.prodSA.fill(-1); this.prodSB.fill(-1); this.rsPos.fill(-1);
    this.fqS.fill(-1); this.dqS.fill(-1); this.robS.fill(-1); this.rsS.fill(-1); this.unitS.fill(-1);
    this.rat.fill(-1);
    for (let i = 0; i < this.freeSlots.length; i++) this.freeSlots[i] = i;
    this.freeN = this.freeSlots.length;
    this.fqN = this.dqN = this.robN = this.robHead = this.rsN = 0;
    this.fetchStopped = false;
    this.snapshot();
  }

  override flipPredictor(pc?: number): void {
    if (pc === undefined) for (let i = 0; i < PRED_SIZE; i++) this.pred[i] = this.pred[i]! ^ 1;
    else {
      const i = (pc >>> 2) % PRED_SIZE;
      this.pred[i] = this.pred[i]! ^ 1;
    }
  }

  step(): void {
    if (this.isHalted) return;
    const v = this.ov, p = this.pool, c = v.counters, W = this.width, rs = this.robSize;
    const slotId = this.slotId, ost = this.ost;
    this.cycleNo++;
    c[Counter.Cycles]!++;
    v.beginCycle(this.cycleNo);
    v.stall.fill(0);

    // COMMIT: up to `width` finished instructions retire in program order.
    for (let n = 0; n < this.commitWidth; n++) {
      if (this.robN === 0) { if (n === 0) v.stall[OooPart.Commit] = CommitStall.Empty; break; }
      const s = this.robS[this.robHead]!;
      if (ost[s] !== Os.Done) { if (n === 0) v.stall[OooPart.Commit] = CommitStall.HeadPending; break; }
      const id = slotId[s]!;
      const op = p.op[s]!;
      if (op === 0) this.execute(s); // illegal instruction reached commit: throws RangeError
      this.robS[this.robHead] = -1;
      this.robHead = (this.robHead + 1) % rs;
      this.robN--;
      const f = OPF[op]!;
      if (f & F.Store) {
        if (op === OP_SW) this.bus.store32(p.addr[s]!, p.b[s]!);
        else this.bus.store8(p.addr[s]!, p.b[s]!);
      } else if (f & F.Writes && p.rd[s] !== 0) {
        this.regs[p.rd[s]!] = p.res[s]!;
        if (this.rat[p.rd[s]!] === s) this.rat[p.rd[s]!] = -1;
      }
      ost[s] = Os.Committed;
      this.freeSlots[this.freeN++] = s;
      this.retire(id);
      v.mark(id, StageCode.C);
      if (op === OP_ECALL) {
        this.isHalted = true;
        this.fetchPc = (p.pc[s]! + 4) >>> 0;
        this.squashAfter(id);
        this.snapshot();
        return;
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
      if (p.state[s]! & St.Missing) { this.cache.fill(p.addr[s]!); p.state[s]! &= ~St.Missing; }
      if (f & F_CTRL) {
        const next = this.actual[s]!;
        if (f & F.Branch) {
          c[Counter.Branches]!++;
          this.pred[(p.pc[s]! >>> 2) % PRED_SIZE] = next !== ((p.pc[s]! + 4) >>> 0) ? 1 : 0;
        }
        if (next !== p.predNext[s]) {
          c[Counter.Flushes]!++;
          if (f & F.Branch) c[Counter.BranchMispredicts]!++;
          this.squashAfter(id);
          this.fetchPc = next;
          this.fetchStopped = false;
        }
      }
    }

    // ISSUE: oldest ready scheduler entry first, onto a free unit.
    for (let k = 0; k < this.robN; k++) {
      const s = this.robS[(this.robHead + k) % rs]!;
      if (ost[s] !== Os.Wait) continue;
      const pos = this.rsPos[s]!;
      if (!this.ready(this.prodSA[s]!, this.prodIA[s]!) || !this.ready(this.prodSB[s]!, this.prodIB[s]!)) { v.schedWhy[pos] = SchedWhy.Operands; continue; }
      const op = p.op[s]!;
      const f = OPF[op]!;
      let u: number;
      if (f & F_MEM) u = this.unitS[Unit.LSU]! < 0 ? Unit.LSU : -1;
      else if (op === OP_MUL) u = this.unitS[Unit.MUL]! < 0 ? Unit.MUL : -1;
      else u = this.unitS[Unit.ALU0]! < 0 ? Unit.ALU0 : this.unitS[Unit.ALU1]! < 0 ? Unit.ALU1 : -1;
      if (u < 0) { v.schedWhy[pos] = SchedWhy.Unit; continue; }
      p.a[s] = f & F.Rs1 ? this.value(this.prodSA[s]!, this.prodIA[s]!, p.rs1[s]!) : 0;
      p.b[s] = f & F.Rs2 ? this.value(this.prodSB[s]!, this.prodIB[s]!, p.rs2[s]!) : 0;
      this.actual[s] = this.execute(s);
      let lat = 1;
      if (f & F.Load) {
        lat = this.issueLoad(k, s);
        if (lat < 0) { v.schedWhy[pos] = this.why; c[Counter.LoadWaits]!++; continue; }
      } else if (op === OP_MUL) lat = 3;
      this.rsS[pos] = -1; v.schedWhy[pos] = SchedWhy.None;
      this.rsN--;
      this.unitS[u] = s; v.unitLeft[u] = lat; v.unitTotal[u] = lat;
      ost[s] = Os.Issued;
      v.mark(slotId[s]!, StageCode.X);
      c[Counter.Issued]!++;
    }

    // DISPATCH (rename): ROB slot + scheduler slot, operand sources through the RAT.
    for (let n = 0; n < W; n++) {
      if (this.dqN === 0) { if (n === 0) v.stall[OooPart.Dispatch] = DispatchStall.Empty; break; }
      const s = this.dqS[0]!;
      const op = p.op[s]!;
      const instant = op === 0 || op === OP_ECALL; // nothing to execute: done on arrival (ecall halts / illegal throws at commit)
      if (this.robN >= rs) { c[Counter.StallRobFull]!++; v.stall[OooPart.Dispatch] = DispatchStall.RobFull; break; }
      if (!instant && this.rsN >= this.schedSize) { c[Counter.StallSchedFull]!++; v.stall[OooPart.Dispatch] = DispatchStall.SchedFull; break; }
      for (let l = 1; l < this.dqN; l++) this.dqS[l - 1] = this.dqS[l]!;
      this.dqS[--this.dqN] = -1;
      const f = OPF[op]!;
      const pa = f & F.Rs1 && p.rs1[s] !== 0 ? this.rat[p.rs1[s]!]! : -1;
      const pb = f & F.Rs2 && p.rs2[s] !== 0 ? this.rat[p.rs2[s]!]! : -1;
      this.prodSA[s] = pa; this.prodIA[s] = pa >= 0 ? slotId[pa]! : -1;
      this.prodSB[s] = pb; this.prodIB[s] = pb >= 0 ? slotId[pb]! : -1;
      if (f & F.Writes && p.rd[s] !== 0) this.rat[p.rd[s]!] = s;
      this.robS[(this.robHead + this.robN) % rs] = s;
      this.robN++;
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
    }

    // Decode refill from the fetch queue.
    while (this.dqN < W && this.fqN > 0) {
      const s = this.fqS[0]!;
      for (let l = 1; l < this.fqN; l++) this.fqS[l - 1] = this.fqS[l]!;
      this.fqS[--this.fqN] = -1;
      this.dqS[this.dqN++] = s;
      ost[s] = Os.Decoded;
    }

    // FETCH: a group of up to `width`, ended by any control instruction.
    if (this.fetchStopped) v.stall[OooPart.Fetch] = FetchStall.Stopped;
    else if (this.fqN + W > this.fetchQueueSize) v.stall[OooPart.Fetch] = FetchStall.QueueFull;
    else for (let l = 0; l < W; l++) if (this.fetchOne()) break;

    // Timeline: everything in flight shows where it is this cycle (explicit marks above win).
    for (let i = 0; i < this.fqN; i++) v.mark(slotId[this.fqS[i]!]!, StageCode.F);
    for (let i = 0; i < this.dqN; i++) v.mark(slotId[this.dqS[i]!]!, StageCode.D);
    for (let k = 0; k < this.robN; k++) {
      const s = this.robS[(this.robHead + k) % rs]!;
      const st = ost[s];
      if (st === Os.Wait) v.markIfEmpty(slotId[s]!, StageCode.S);
      else if (st === Os.Issued) v.mark(slotId[s]!, StageCode.X);
      else v.markIfEmpty(slotId[s]!, StageCode.R);
    }
    c[Counter.RobOccupancySum]! += this.robN;
    c[Counter.SchedOccupancySum]! += this.rsN;
    this.snapshot();
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
   * Load issue for ROB position k: returns the unit latency, or -1 if it must wait (cause in this.why).
   * Fills res (and the Missing state for cache misses).
   */
  private issueLoad(k: number, s: number): number {
    const p = this.pool, c = this.ov.counters, rs = this.robSize;
    const op = p.op[s]!, addr = p.addr[s]!;
    const size = op === OP_LW ? 4 : 1;
    const ramSafe = op === OP_LW ? (addr & 3) === 0 && addr + 4 <= this.ramSize : addr < this.ramSize;
    if (!ramSafe) {
      // Device / faulting access: only when it is the oldest instruction, so it is never speculative.
      if (k !== 0) { this.why = SchedWhy.Head; return -1; }
      p.res[s] = this.load(op, addr);
      return HIT_LAT;
    }
    let fwd = -1;
    for (let j = 0; j < k; j++) {
      const js = this.robS[(this.robHead + j) % rs]!;
      if (!(OPF[p.op[js]!]! & F.Store)) continue;
      if (this.ost[js] !== Os.Done || p.addr[js]! >= this.ramSize) { this.why = SchedWhy.Memory; return -1; }
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
    if (this.cache.hit(addr)) { c[Counter.CacheHits]!++; return HIT_LAT; }
    c[Counter.CacheMisses]!++;
    p.state[s]! |= St.Missing;
    return HIT_LAT + this.cache.missPenalty;
  }

  /** Squash everything younger than id `bid`: ROB tail, queues, units; rebuild the RAT from what remains. */
  private squashAfter(bid: number): void {
    const v = this.ov, p = this.pool, rs = this.robSize;
    while (this.robN > 0) {
      const idx = (this.robHead + this.robN - 1) % rs;
      const s = this.robS[idx]!;
      if (this.slotId[s]! <= bid) break;
      if (this.ost[s] === Os.Wait) { const pos = this.rsPos[s]!; this.rsS[pos] = -1; v.schedWhy[pos] = SchedWhy.None; this.rsN--; }
      this.kill(s);
      this.robS[idx] = -1;
      this.robN--;
    }
    for (let i = 0; i < this.dqN; i++) { this.kill(this.dqS[i]!); this.dqS[i] = -1; }
    for (let i = 0; i < this.fqN; i++) { this.kill(this.fqS[i]!); this.fqS[i] = -1; }
    this.dqN = this.fqN = 0;
    for (let u = 0; u < UNIT_COUNT; u++) if (this.unitS[u]! >= 0 && this.slotId[this.unitS[u]!]! > bid) this.unitS[u] = -1;
    this.rat.fill(-1);
    for (let k = 0; k < this.robN; k++) {
      const s = this.robS[(this.robHead + k) % rs]!;
      if (OPF[p.op[s]!]! & F.Writes && p.rd[s] !== 0) this.rat[p.rd[s]!] = s;
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

  /** Fetch one instruction into the fetch queue; returns true if the fetch group ends (control instruction). */
  private fetchOne(): boolean {
    const v = this.ov, p = this.pool;
    const s = this.freeSlots[--this.freeN]!;
    const id = v.nextId++;
    const pc = this.fetchPc;
    p.fetch(this.bus, this.ramSize, s, pc);
    p.decodeSlot(s);
    v.startRow(id, pc, p.word[s]!);
    const f = OPF[p.op[s]!]!;
    let next = (pc + 4) >>> 0;
    if (f & F.Branch) {
      if (this.pred[(pc >>> 2) % PRED_SIZE]) next = (pc + p.imm[s]!) >>> 0;
    } else if (f & F.Jal) {
      next = (pc + p.imm[s]!) >>> 0;
    }
    p.predNext[s] = next;
    this.fetchPc = next;
    this.slotId[s] = id;
    this.ost[s] = Os.Fetched;
    this.prodSA[s] = this.prodSB[s] = -1;
    this.fqS[this.fqN++] = s;
    if (p.op[s] === OP_ECALL) { this.fetchStopped = true; return true; }
    return (f & F_CTRL) !== 0;
  }

  /** Fill the view arrays (ids, pcs, states, counts) from the slot structures. */
  private snapshot(): void {
    const v = this.ov, p = this.pool;
    for (let i = 0; i < v.fetchId.length; i++) {
      const s = this.fqS[i]!;
      v.fetchId[i] = s >= 0 ? this.slotId[s]! : -1; v.fetchPc[i] = s >= 0 ? p.pc[s]! : 0;
    }
    for (let i = 0; i < v.decodeId.length; i++) {
      const s = this.dqS[i]!;
      v.decodeId[i] = s >= 0 ? this.slotId[s]! : -1; v.decodePc[i] = s >= 0 ? p.pc[s]! : 0;
    }
    for (let i = 0; i < v.robId.length; i++) {
      const s = this.robS[i]!;
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
    v.occ[Occ.Fetch] = this.fqN; v.occ[Occ.Decode] = this.dqN; v.occ[Occ.Rob] = this.robN;
    v.occ[Occ.Sched] = this.rsN; v.occ[Occ.Units] = busy; v.occ[Occ.RobHead] = this.robHead;
  }
}
