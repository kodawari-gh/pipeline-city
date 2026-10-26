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

import {
  CAUSE_COUNTER, Cause, Counter, Fate, SlotKind, Stage, StageCode, ViewState,
} from "./view";
import { EngineBase, F, F_MEM, OPF, OP_ECALL, OP_IRET, St, type EngineSettings } from "./common";

export interface InOrderSettings extends EngineSettings {
  /** Bypass EX operands from the MEM latch; only load-use stalls remain. Off: wait until the producer has written back. Default true. */
  forwarding?: boolean;
  /** One memory port: fetch loses to a load/store in MEM (struct bubble). Default false. */
  sharedPort?: boolean;
  /** Instructions per cycle (1..4). Default 1. */
  width?: number;
}

const PRED_SIZE = 64;
const F_CTRL = F.Branch | F.Jal | F.Jalr;

export class InOrderEngine extends EngineBase {
  /** Live options; may be toggled between steps. */
  readonly options: { forwarding: boolean; sharedPort: boolean };
  readonly width: number;
  /** 1-bit predictor, indexed by (pc >> 2) % 64. 1 = predict taken. */
  private readonly pred = new Uint8Array(PRED_SIZE);
  private fetchStopped = false;
  private readonly mask: number;

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
    this.pred.fill(0);
    this.fetchStopped = false;
    for (let s = 0; s < 5 * this.width; s++) this.v.clearStage(s);
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
    const W = this.width, mask = this.mask;
    const v = this.v, p = this.pool, c = v.counters;
    const kind = v.stageKind, sid = v.stageId, cause = v.stageCause, stalled = v.stageStalled;
    const wb = Stage.WB * W, mem = Stage.MEM * W, ex = Stage.EX * W, id = Stage.ID * W, iff = Stage.IF * W;
    this.cycleNo++;
    c[Counter.Cycles]!++;
    v.beginCycle(this.cycleNo);
    stalled.fill(0);

    // WB: results land in the register file (before this cycle's register reads).
    this.writeback();
    for (let l = 0; l < W; l++) v.clearStage(wb + l);

    // MEM: a data cache miss holds the whole pipe.
    let frozen = false;
    for (let l = 0; l < W; l++) {
      if (kind[mem + l] === SlotKind.Instr && !this.memStep(sid[mem + l]! & mask)) frozen = true;
    }

    // EX: operands, ALU, address generation, control-transfer resolution.
    for (let l = 0; l < W; l++) {
      if (kind[ex + l] !== SlotKind.Instr) continue;
      const s = sid[ex + l]! & mask;
      if (!(p.state[s]! & St.ExDone)) {
        p.state[s]! |= St.ExDone;
        this.exStage(s);
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
    if (kind[iff] === SlotKind.Empty && !this.fetchStopped && !this.hold) {
      let memOp = false;
      for (let l = 0; l < W; l++) {
        if (kind[mem + l] === SlotKind.Instr && OPF[p.op[sid[mem + l]! & mask]!]! & F_MEM) memOp = true;
      }
      if (this.options.sharedPort && memOp) {
        v.setStage(iff, SlotKind.Bubble, -1, 0, Cause.Struct);
        c[Counter.StallStruct]!++;
      } else {
        for (let l = 0; l < W; l++) if (this.fetch(l)) break;
      }
    }

    // ecall in WB: everything older has retired (the rest of its bundle retires now) and everything younger was squashed.
    for (let l = 0; l < W; l++) {
      if (kind[wb + l] === SlotKind.Instr && p.op[sid[wb + l]! & mask] === OP_ECALL) {
        this.writeback();
        this.isHalted = true;
        break;
      }
    }
    this.log();
  }

  /** Register writes and retirement for the WB occupants (the stage is not cleared). */
  private writeback(): void {
    const v = this.v, p = this.pool, W = this.width, wb = Stage.WB * W;
    for (let l = 0; l < W; l++) {
      if (v.stageKind[wb + l] !== SlotKind.Instr) continue;
      const id = v.stageId[wb + l]!;
      const s = id & this.mask;
      if (OPF[p.op[s]!]! & F.Writes && p.rd[s] !== 0) this.regs[p.rd[s]!] = p.res[s]!;
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

  private exStage(s: number): void {
    const p = this.pool, v = this.v, c = v.counters;
    const op = p.op[s]!;
    const f = OPF[op]!;
    p.a[s] = f & F.Rs1 ? this.operand(p.rs1[s]!) : 0;
    p.b[s] = f & F.Rs2 ? this.operand(p.rs2[s]!) : 0;
    const next = this.execute(s);
    if (op === OP_ECALL) {
      // Stop fetching and squash anything fetched behind it.
      this.squash(Stage.IF, false);
      this.squash(Stage.ID, false);
      this.fetchStopped = true;
      this.fetchPc = next;
      return;
    }
    if (!(f & F_CTRL)) return;
    const isBranch = (f & F.Branch) !== 0;
    if (isBranch) {
      c[Counter.Branches]!++;
      this.pred[(p.pc[s]! >>> 2) % PRED_SIZE] = this.taken ? 1 : 0;
    }
    if (next !== p.predNext[s]) {
      c[Counter.Flushes]!++;
      if (isBranch) c[Counter.BranchMispredicts]!++;
      this.squash(Stage.IF, true);
      this.squash(Stage.ID, true);
      c[Counter.StallFlush]! += 2;
      this.fetchPc = next;
    }
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
