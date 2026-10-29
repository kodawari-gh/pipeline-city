// Classic 5-stage in-order pipeline (IF ID EX MEM WB), scalar or `width`-wide superscalar (default 1; inorder2 is width 2).
//
// Per step (one cycle), evaluated back to front like the legacy engine: WB, MEM (cache; a miss freezes everything behind
// it), EX (operands, ALU, branch resolution, flush), then ID hazard check / issue, shift, fetch.
// Stage latches are the typed arrays in `view` (kind/id/pc/cause, `width` lanes per stage, stage * width + lane, lane 0
// oldest); the fields of the live instructions sit in the instruction pool, keyed by id & mask.
//
// Width > 1: ID holds up to `width` instructions in program order and issues them together (a bundle) when
//  - none has a data hazard against the previous bundle (same rules as width 1),
//  - no instruction reads or writes a register an earlier one in the bundle writes (RAW / WAW),
//  - at most one is a load/store,
//  - a branch/jal/jalr/ecall ends the bundle (nothing issues behind it).
// Fetch brings in up to `width` instructions per cycle and ends a group after any control instruction.
//
// Threads (width 1 only; docs/MULTICORE.md section 5): a core can run several logical cores, one at a time. When the thread in MEM misses the data
// cache and another thread could run, the load leaves MEM for that thread's miss buffer (it writes its register when the miss ends), the thread's
// younger instructions in EX, ID and IF are squashed, and fetch goes on at the other thread's pc. A thread is picked again when it is the next one
// that is ready. With one thread none of this runs and the cycles are the plain engine's.

import {
  CAUSE_COUNTER, Cause, Counter, Fate, SlotKind, Stage, StageCode, ViewState,
} from "./view";
import type { Core } from "../machine/core";
import { EngineBase, F, F_MEM, OPF, OP_ECALL, OP_IRET, St, type EngineSettings } from "./common";

export interface InOrderSettings extends EngineSettings {
  /** Bypass EX operands from the MEM latch; only load-use stalls remain. Off: wait until the producer has written back. Default true. */
  forwarding?: boolean;
  /** One memory port: fetch loses to a load/store in MEM (struct bubble). Default false. */
  sharedPort?: boolean;
  /** Instructions per cycle (1..4). Default 1. */
  width?: number;
}

const F_CTRL = F.Branch | F.Jal | F.Jalr;
/** Threads a core can hold. */
export const MAX_THREADS = 4;

export class InOrderEngine extends EngineBase {
  /** Live options; may be toggled between steps. */
  readonly options: { forwarding: boolean; sharedPort: boolean };
  readonly width: number;
  private fetchStopped = false;
  private readonly mask: number;
  // Per thread: where it resumes fetching, whether it ended, and its outstanding load miss (at most one).
  private readonly resume = new Uint32Array(MAX_THREADS);
  private readonly tHalted = new Uint8Array(MAX_THREADS);
  private readonly missOn = new Uint8Array(MAX_THREADS);
  private readonly missWait = new Int32Array(MAX_THREADS);
  private readonly missAddr = new Uint32Array(MAX_THREADS);
  private readonly missOp = new Uint8Array(MAX_THREADS);
  private readonly missRd = new Uint8Array(MAX_THREADS);
  private readonly missId = new Int32Array(MAX_THREADS);
  /** The thread a switch to waits for (the pipeline must empty first), or -1. */
  private want = -1;

  override get waiting(): boolean { for (let t = 0; t < this.cores.length; t++) if (this.missOn[t]) return true; return false; }

  override addThread(core: Core): void {
    if (this.width !== 1) throw new RangeError("threads need the scalar in-order pipeline");
    if (this.cores.length >= MAX_THREADS) throw new RangeError(`at most ${MAX_THREADS} threads on a core`);
    this.resume[this.cores.length] = core.entry;
    this.cores.push(core);
  }

  private ready(t: number): boolean { return !this.missOn[t] && !this.tHalted[t] && !this.cores[t]!.intc.parked; }

  /** The first thread after `from` (`from` itself last) that can run, or -1. */
  private pickNext(from: number): number {
    const n = this.cores.length;
    for (let i = 1; i <= n; i++) { const t = (from + i) % n; if (this.ready(t)) return t; }
    return -1;
  }

  /** Fetch for thread `t` from where it left off (its pc is in `resume`; the caller saved the old thread's). */
  private switchFetch(t: number): void {
    if (t !== this.fetchThread) this.v.counters[Counter.ThreadSwitches]!++;
    this.fetchThread = t;
    this.fetchIdle = false;
    this.fetchPc = this.resume[t]!;
    this.fetchStopped = false;
    this.want = -1;
    this.resetFetchWait();
  }

  override switchTo(core: Core): boolean {
    const t = this.cores.indexOf(core);
    if (t < 0) return false;
    if (t === this.fetchThread && !this.fetchIdle) return true;
    if (this.ready(t)) this.want = t;
    return false;
  }

  override yieldThread(): void {
    const ft = this.fetchThread;
    this.resume[ft] = this.fetchPc;
    const n = this.pickNext(ft);
    if (n >= 0) this.switchFetch(n); else this.fetchIdle = true;
  }

  /** Per cycle, before the stages: outstanding misses count down and land; a wanted switch happens once the pipeline is empty; an idle core finds a thread. */
  private threadTick(): void {
    for (let t = 0; t < this.cores.length; t++) {
      if (!this.missOn[t]) continue;
      if (this.missWait[t]! > 0) this.missWait[t]!--; else this.completeMiss(t);
    }
    if (this.want >= 0 && this.drained) {
      if (!this.fetchIdle) this.resume[this.fetchThread] = this.fetchPc;
      if (this.ready(this.want)) this.switchFetch(this.want);
      this.want = -1;
    }
    if (this.fetchIdle) {
      const n = this.pickNext(this.fetchThread);
      if (n >= 0) this.switchFetch(n);
    }
  }

  /** The miss of thread `t` ends: the line fills, the load writes its register and retires, the thread can run again. */
  private completeMiss(t: number): void {
    this.useThread(t);
    const addr = this.missAddr[t]!, op = this.missOp[t]!, rd = this.missRd[t]!, id = this.missId[t]!;
    this.dFill(addr);
    if (rd !== 0) this.writeReg(rd, this.load(op, addr));
    this.v.mark(id, StageCode.W);
    this.retire(id, op);
    this.missOn[t] = 0;
  }

  /**
   * The load of slot `s` missed in MEM. If another thread could run, move it to its thread's miss buffer, squash the thread's younger instructions and
   * switch fetch to the other thread; true when it did (the load has left MEM). False: the miss freezes the pipeline as usual.
   */
  private tryBuffer(s: number): boolean {
    const p = this.pool, v = this.v, mask = this.mask, t = p.thread[s]!;
    const op = p.op[s]!, f = OPF[op]!;
    if (!(f & F.Load) || f & F.Amo || !(p.state[s]! & St.Missing)) return false;
    let other = false;
    for (let u = 0; u < this.cores.length; u++) if (u !== t && !this.tHalted[u] && !this.cores[u]!.intc.parked) other = true;
    if (!other) return false;
    if (v.stageKind[Stage.EX] === SlotKind.Instr && p.thread[v.stageId[Stage.EX]! & mask] === t) {
      const eop = p.op[v.stageId[Stage.EX]! & mask];
      if (eop === OP_IRET || eop === OP_ECALL) return false; // already acted at EX: cannot be taken back
    }
    this.missOn[t] = 1;
    this.missWait[t] = p.wait[s]!;
    this.missAddr[t] = p.addr[s]!;
    this.missOp[t] = op;
    this.missRd[t] = p.rd[s]!;
    this.missId[t] = v.stageId[Stage.MEM]!;
    this.resume[t] = (p.pc[s]! + 4) >>> 0;
    for (const st of [Stage.EX, Stage.ID, Stage.IF]) {
      if (v.stageKind[st] !== SlotKind.Instr) continue;
      const id = v.stageId[st]!;
      if (p.thread[id & mask] !== t) continue;
      v.mark(id, StageCode.Flushed); v.setFate(id, Fate.Flushed);
      v.counters[Counter.FlushedInstrs]!++;
      v.clearStage(st);
    }
    if (this.fetchThread === t && !this.fetchIdle) {
      const n = this.pickNext(t);
      if (n >= 0) this.switchFetch(n); else this.fetchIdle = true;
      v.setStage(Stage.IF, SlotKind.Bubble, -1, 0, Cause.Switch);
      v.counters[Counter.StallSwitch]! += 2;
    }
    v.clearStage(Stage.MEM);
    return true;
  }

  /** Nothing in any stage (bubbles do not count), and none still waiting in WB to write back. */
  get drained(): boolean {
    const k = this.v.stageKind;
    for (let i = 0; i < 5 * this.width; i++) if (k[i] === SlotKind.Instr) return false;
    return true;
  }

  constructor(settings: InOrderSettings = {}) {
    const w = settings.width ?? 1;
    if (!Number.isInteger(w) || w < 1 || w > 4) throw new RangeError("width must be 1..4");
    // In flight: 5 stages x w lanes; round up to a power of two.
    let size = 8;
    while (size < 5 * w) size *= 2;
    super(settings, size, new ViewState(settings.timelineRows ?? 32, settings.timelineCols ?? 64, w));
    this.width = w;
    this.mask = size - 1;
    this.options = { forwarding: settings.forwarding ?? true, sharedPort: settings.sharedPort ?? false };
  }

  protected override onReset(): void {
    this.fetchStopped = false;
    this.resume.fill(0); this.tHalted.fill(0); this.missOn.fill(0); this.want = -1;
    for (let s = 0; s < 5 * this.width; s++) this.v.clearStage(s);
  }

  override flipPredictor(pc?: number): void { this.pred.flip(pc); }

  step(): void {
    if (this.isHalted) return;
    const W = this.width, mask = this.mask;
    const v = this.v, p = this.pool, c = v.counters;
    const kind = v.stageKind, sid = v.stageId, cause = v.stageCause, stalled = v.stageStalled;
    const wb = Stage.WB * W, mem = Stage.MEM * W, ex = Stage.EX * W, id = Stage.ID * W, iff = Stage.IF * W;
    this.cycleNo++;
    c[Counter.Cycles]!++;
    v.beginCycle(this.cycleNo);
    stalled.fill(0);
    const multi = this.cores.length > 1;
    if (multi) this.threadTick();

    // WB: results land in the register file (before this cycle's register reads).
    this.writeback();
    for (let l = 0; l < W; l++) v.clearStage(wb + l);

    // MEM: a data cache miss holds the whole pipe.
    let frozen = false;
    for (let l = 0; l < W; l++) {
      if (kind[mem + l] === SlotKind.Instr && !this.memStep(sid[mem + l]! & mask)) {
        if (multi && this.tryBuffer(sid[mem + l]! & mask)) continue;
        frozen = true;
      }
    }

    // EX: operands, ALU, address generation, control-transfer resolution.
    for (let l = 0; l < W; l++) {
      if (kind[ex + l] !== SlotKind.Instr) continue;
      const s = sid[ex + l]! & mask;
      if (multi) this.useThread(p.thread[s]!);
      if (!(p.state[s]! & St.ExDone)) {
        p.state[s]! |= St.ExDone;
        if (this.exStage(s, l)) break; // a page fault: this and everything younger is gone
      }
    }

    if (frozen) {
      stalled.fill(1, 0, mem + W);
      this.log();
      return;
    }

    // ID: hazard check and issue (n = instructions leaving ID for EX this cycle).
    let n = 0, why: number = Cause.None, idCount = 0;
    const passBubble = kind[id] === SlotKind.Bubble;
    if (passBubble) {
      n = 1;
    } else {
      for (let l = 0; l < W; l++) {
        if (kind[id + l] !== SlotKind.Instr) break;
        idCount++;
        if (l !== n) continue; // stopped issuing; just count
        const s = sid[id + l]! & mask;
        const h = this.hazard(s);
        if (h !== Cause.None) { why = h; continue; }
        if (l > 0 && !this.canPair(s, l)) { c[Counter.PairBreaks]!++; continue; }
        n++;
      }
      if (n >= 2) c[Counter.DualIssues]!++;
    }

    // Shift WB <- MEM <- EX <- ID.
    for (let l = 0; l < W; l++) {
      v.moveStage(wb + l, mem + l);
      v.moveStage(mem + l, ex + l);
    }
    if (passBubble) {
      v.moveStage(ex, id);
      for (let l = 1; l < W; l++) v.clearStage(ex + l);
      v.clearStage(id);
    } else if (n > 0) {
      for (let l = 0; l < W; l++) {
        if (l < n) v.moveStage(ex + l, id + l);
        else v.clearStage(ex + l);
      }
    } else if (idCount > 0 && why !== Cause.None) {
      v.setStage(ex, SlotKind.Bubble, -1, 0, why);
      for (let l = 1; l < W; l++) v.clearStage(ex + l);
      c[CAUSE_COUNTER[why]!]!++;
    } else {
      for (let l = 0; l < W; l++) v.clearStage(ex + l);
    }

    // Remaining ID occupants move to the front; IF refills ID behind them.
    const rest = passBubble ? 0 : idCount - n;
    for (let l = 0; l < rest; l++) { v.moveStage(id + l, id + n + l); stalled[id + l] = 1; }
    for (let l = rest; l < W; l++) v.clearStage(id + l);
    if (kind[iff] === SlotKind.Bubble) {
      if (rest === 0) { v.moveStage(id, iff); v.clearStage(iff); }
    } else {
      let ifCount = 0;
      while (ifCount < W && kind[iff + ifCount] === SlotKind.Instr) ifCount++;
      const mc = Math.min(W - rest, ifCount);
      for (let l = 0; l < mc; l++) v.moveStage(id + rest + l, iff + l);
      for (let l = 0; l < W; l++) {
        if (l + mc < W) v.moveStage(iff + l, iff + l + mc);
        else v.clearStage(iff + l);
      }
    }
    for (let l = 0; l < W; l++) if (kind[iff + l] !== SlotKind.Empty) stalled[iff + l] = 1;

    // Fetch.
    if (multi) this.useThread(this.fetchThread);
    if (kind[iff] === SlotKind.Empty && !this.fetchStopped && !this.hold && !this.fetchIdle && this.want < 0) {
      let memOp = false;
      for (let l = 0; l < W; l++) {
        if (kind[mem + l] === SlotKind.Instr && OPF[p.op[sid[mem + l]! & mask]!]! & F_MEM) memOp = true;
      }
      if (this.options.sharedPort && memOp) {
        v.setStage(iff, SlotKind.Bubble, -1, 0, Cause.Struct);
        c[Counter.StallStruct]!++;
      } else {
        for (let l = 0; l < W; l++) {
          if (!this.fetchReady(this.fetchPc)) break;
          if (this.fetch(l)) break;
        }
      }
    }

    // ecall in WB: everything older has retired (the rest of its bundle retires now) and everything younger was squashed.
    for (let l = 0; l < W; l++) {
      if (kind[wb + l] === SlotKind.Instr && p.op[sid[wb + l]! & mask] === OP_ECALL) {
        this.writeback();
        if (multi) this.endThread(p.thread[sid[wb + l]! & mask]!);
        else this.isHalted = true;
        break;
      }
    }
    this.log();
  }

  /** The ecall of thread `t` retired: the thread is done; the core halts when all are, else fetch goes to one that can run. */
  private endThread(t: number): void {
    this.tHalted[t] = 1;
    this.fetchStopped = false;
    let all = true;
    for (let u = 0; u < this.cores.length; u++) if (!this.tHalted[u] && !this.cores[u]!.intc.parked) all = false; // a parked thread has nothing left to run
    if (all) { this.isHalted = true; return; }
    if (this.fetchThread === t && !this.fetchIdle) {
      const n = this.pickNext(t);
      if (n >= 0) this.switchFetch(n); else this.fetchIdle = true;
    }
  }

  /** Register writes and retirement for the WB occupants (the stage is not cleared). */
  private writeback(): void {
    const v = this.v, p = this.pool, W = this.width, wb = Stage.WB * W;
    for (let l = 0; l < W; l++) {
      if (v.stageKind[wb + l] !== SlotKind.Instr) continue;
      const id = v.stageId[wb + l]!;
      const s = id & this.mask;
      if (this.cores.length > 1) this.useThread(p.thread[s]!);
      if (OPF[p.op[s]!]! & F.Writes && p.rd[s] !== 0) this.writeReg(p.rd[s]!, p.res[s]!);
      this.retire(id, p.op[s]!);
    }
  }

  /** Newest write to register r in MEM (non-load) is bypassed; otherwise the register file. */
  private operand(r: number): number {
    if (r === 0) return 0;
    const v = this.v, p = this.pool, W = this.width, mem = Stage.MEM * W;
    for (let l = 0; l < W; l++) {
      if (v.stageKind[mem + l] !== SlotKind.Instr) continue;
      const m = v.stageId[mem + l]! & this.mask;
      const f = OPF[p.op[m]!]!;
      if (f & F.Writes && !(f & F.Load) && p.rd[m] === r) return p.res[m]!;
    }
    return this.regs[r]!;
  }

  /** EX work for slot `s` in lane `lane`; true when it took a page fault (nothing of it or of anything younger survives). */
  private exStage(s: number, lane: number): boolean {
    const p = this.pool, v = this.v, c = v.counters;
    const op = p.op[s]!;
    const f = OPF[op]!;
    if (p.fault[s]) return this.fault(s, lane); // a fetch fault, now known to be on the right path (EX is never speculative here)
    p.a[s] = f & F.Rs1 ? this.operand(p.rs1[s]!) : 0;
    p.b[s] = f & F.Rs2 ? this.operand(p.rs2[s]!) : 0;
    const next = this.execute(s);
    if (p.fault[s]) return this.fault(s, lane); // a load or store the MMU refused
    if (op === OP_ECALL) {
      // Stop fetching and squash anything fetched behind it.
      this.squash(Stage.IF, false);
      this.squash(Stage.ID, false);
      this.fetchStopped = true;
      this.fetchPc = next;
      return false;
    }
    if (!(f & F_CTRL)) return false;
    const isBranch = (f & F.Branch) !== 0;
    if (isBranch) {
      c[Counter.Branches]!++;
      this.trainPred(p.pc[s]!, this.taken);
    }
    if (next !== p.predNext[s]) {
      c[Counter.Flushes]!++;
      if (isBranch) c[Counter.BranchMispredicts]!++;
      this.squash(Stage.IF, true);
      this.squash(Stage.ID, true);
      c[Counter.StallFlush]! += 2;
      this.fetchPc = next;
    }
    return false;
  }

  /** A page fault at EX: this instruction and the ones behind it (the younger lanes of EX, ID and IF) are squashed; the older ones in MEM and WB finish. */
  private fault(s: number, lane: number): boolean {
    const v = this.v, W = this.width, ex = Stage.EX * W;
    this.takeFault(s);
    for (let l = lane; l < W; l++) {
      const i = ex + l;
      if (v.stageKind[i] === SlotKind.Instr) {
        const id = v.stageId[i]!;
        v.mark(id, StageCode.Flushed); v.setFate(id, Fate.Flushed);
        v.counters[Counter.FlushedInstrs]!++;
      }
      v.clearStage(i);
    }
    this.squash(Stage.IF, true);
    this.squash(Stage.ID, true);
    this.fetchStopped = false;
    v.counters[Counter.Flushes]!++;
    return true;
  }

  /** Kill every occupant of a front-end stage; with `bubble` lane 0 becomes a flush bubble. */
  private squash(stage: number, bubble: boolean): void {
    const v = this.v, W = this.width;
    for (let l = 0; l < W; l++) {
      const i = stage * W + l;
      if (v.stageKind[i] === SlotKind.Instr) {
        const id = v.stageId[i]!;
        v.mark(id, StageCode.Flushed);
        v.setFate(id, Fate.Flushed);
        v.counters[Counter.FlushedInstrs]!++;
      }
      v.clearStage(i);
    }
    if (bubble) v.setStage(stage * W, SlotKind.Bubble, -1, 0, Cause.Flush);
  }

  /** Cause of the stall the ID instruction in slot `s` must take this cycle (vs. the bundles in EX and MEM), or Cause.None. */
  private hazard(s: number): number {
    const v = this.v, p = this.pool, W = this.width;
    const f = OPF[p.op[s]!]!;
    const fwd = this.options.forwarding;
    for (let n = 0; n < 2; n++) {
      const r = n === 0 ? (f & F.Rs1 ? p.rs1[s]! : 0) : f & F.Rs2 ? p.rs2[s]! : 0;
      if (r === 0) continue;
      for (let l = 0; l < W; l++) {
        const i = Stage.EX * W + l;
        if (v.stageKind[i] !== SlotKind.Instr) continue;
        const e = v.stageId[i]! & this.mask;
        const fe = OPF[p.op[e]!]!;
        if (fe & F.Writes && p.rd[e] === r) {
          if (!fwd) return Cause.Data;
          if (fe & F.Load) return Cause.Load;
        }
      }
      if (!fwd) {
        for (let l = 0; l < W; l++) {
          const i = Stage.MEM * W + l;
          if (v.stageKind[i] !== SlotKind.Instr) continue;
          const m = v.stageId[i]! & this.mask;
          if (OPF[p.op[m]!]! & F.Writes && p.rd[m] === r) return Cause.Data;
        }
      }
    }
    return Cause.None;
  }

  /** May ID lane `lane` (slot s) issue in the same bundle as the lanes before it? */
  private canPair(s: number, lane: number): boolean {
    const v = this.v, p = this.pool, W = this.width;
    const f = OPF[p.op[s]!]!;
    if (p.op[s] === OP_IRET) return false; // reads EPC in EX: an older store to it must have reached memory first
    for (let q = 0; q < lane; q++) {
      const e = v.stageId[Stage.ID * W + q]! & this.mask;
      const fe = OPF[p.op[e]!]!;
      if (fe & (F_CTRL) || p.op[e] === OP_ECALL) return false;
      if (fe & F_MEM && f & F_MEM) return false;
      if (fe & F.Writes && p.rd[e] !== 0) {
        const rd = p.rd[e]!;
        if (f & F.Rs1 && p.rs1[s] === rd) return false;
        if (f & F.Rs2 && p.rs2[s] === rd) return false;
        if (f & F.Writes && p.rd[s] === rd) return false;
      }
    }
    return true;
  }

  /**
   * Fetch one instruction into IF lane `lane` with a BTB-like predecode: conditional branches use the 1-bit predictor,
   * jal is always predicted taken, jalr not taken. Returns true if the fetch group ends here (control instruction).
   */
  private fetch(lane: number): boolean {
    const v = this.v, p = this.pool;
    const id = v.nextId++;
    const s = id & this.mask;
    const pc = this.fetchPc;
    this.fetchInto(s, pc);
    p.decodeSlot(s);
    v.startRow(id, pc, p.word[s]!);
    const f = OPF[p.op[s]!]!;
    let next = (pc + 4) >>> 0;
    if (f & F.Branch) {
      if (this.pred.predict(pc)) next = (pc + p.imm[s]!) >>> 0;
    } else if (f & F.Jal) {
      next = (pc + p.imm[s]!) >>> 0;
    }
    p.predNext[s] = next;
    p.thread[s] = this.fetchThread;
    this.fetchPc = next;
    v.setStage(Stage.IF * this.width + lane, SlotKind.Instr, id, pc, Cause.None);
    return (f & F_CTRL) !== 0 || p.op[s] === OP_ECALL;
  }

  private log(): void {
    const v = this.v;
    for (let s = 0; s < 5; s++) {
      for (let l = 0; l < this.width; l++) {
        const i = s * this.width + l;
        if (v.stageKind[i] === SlotKind.Instr) v.mark(v.stageId[i]!, s + 1);
      }
    }
  }
}
