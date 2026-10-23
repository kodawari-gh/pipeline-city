// Classic 5-stage in-order pipeline, width 1 (IF ID EX MEM WB).
//
// Per step (one cycle), evaluated back to front like the legacy engine: WB, MEM (cache; a miss freezes everything behind
// it), EX (operands, ALU, branch resolution, flush), then ID hazard check / issue, shift, fetch.
// Stage latches are the typed arrays in `view` (kind/id/pc/cause); the fields of the (<= 5) live instructions sit in the
// instruction pool, keyed by id & 7.

import {
  CAUSE_COUNTER, Cause, Counter, Fate, SlotKind, Stage, StageCode,
} from "./view";
import { EngineBase, F, F_MEM, OPF, OP_ECALL, POOL_MASK, St, type EngineSettings } from "./common";

export interface InOrderSettings extends EngineSettings {
  /** Bypass EX operands from the MEM latch; only load-use stalls remain. Off: wait until the producer has written back. Default true. */
  forwarding?: boolean;
  /** One memory port: fetch loses to a load/store in MEM (struct bubble). Default false. */
  sharedPort?: boolean;
}

const PRED_SIZE = 64;

export class InOrderEngine extends EngineBase {
  /** Live options; may be toggled between steps. */
  readonly options: { forwarding: boolean; sharedPort: boolean };
  /** 1-bit predictor, indexed by (pc >> 2) % 64. 1 = predict taken. */
  private readonly pred = new Uint8Array(PRED_SIZE);
  private fetchStopped = false;

  constructor(settings: InOrderSettings = {}) {
    super(settings);
    this.options = { forwarding: settings.forwarding ?? true, sharedPort: settings.sharedPort ?? false };
  }

  protected override onReset(): void {
    this.pred.fill(0);
    this.fetchStopped = false;
    for (let s = 0; s < 5; s++) this.v.clearStage(s);
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
    const v = this.v, p = this.pool, c = v.counters;
    const kind = v.stageKind, sid = v.stageId, cause = v.stageCause, stalled = v.stageStalled;
    this.cycleNo++;
    c[Counter.Cycles]!++;
    v.beginCycle(this.cycleNo);
    stalled.fill(0);

    // WB: result lands in the register file (before this cycle's register reads).
    if (kind[Stage.WB] === SlotKind.Instr) {
      const s = sid[Stage.WB]! & POOL_MASK;
      if (OPF[p.op[s]!]! & F.Writes && p.rd[s] !== 0) this.regs[p.rd[s]!] = p.res[s]!;
      this.retire(sid[Stage.WB]!);
    }
    v.clearStage(Stage.WB);

    // MEM: a data cache miss holds the whole pipe.
    let frozen = false;
    if (kind[Stage.MEM] === SlotKind.Instr) frozen = !this.memStep(sid[Stage.MEM]! & POOL_MASK);

    // EX: operands, ALU, address generation, control-transfer resolution.
    if (kind[Stage.EX] === SlotKind.Instr) {
      const s = sid[Stage.EX]! & POOL_MASK;
      if (!(p.state[s]! & St.ExDone)) {
        p.state[s]! |= St.ExDone;
        this.exStage(s);
      }
    }

    if (frozen) {
      for (let s = 0; s <= Stage.MEM; s++) stalled[s] = 1;
      this.log();
      return;
    }

    // ID: hazard check and issue.
    let nKind: number = SlotKind.Empty, nId = -1, nPc = 0, nCause: number = Cause.None;
    let consumed = true;
    if (kind[Stage.ID] === SlotKind.Bubble) {
      nKind = SlotKind.Bubble; nCause = cause[Stage.ID]!;
    } else if (kind[Stage.ID] === SlotKind.Instr) {
      const h = this.hazard(sid[Stage.ID]! & POOL_MASK);
      if (h !== Cause.None) {
        nKind = SlotKind.Bubble; nCause = h;
        consumed = false;
        c[CAUSE_COUNTER[h]!]!++;
        stalled[Stage.ID] = 1;
        if (kind[Stage.IF] !== SlotKind.Empty) stalled[Stage.IF] = 1;
      } else {
        nKind = SlotKind.Instr; nId = sid[Stage.ID]!; nPc = v.stagePc[Stage.ID]!;
      }
    }

    // Shift.
    v.moveStage(Stage.WB, Stage.MEM);
    v.moveStage(Stage.MEM, Stage.EX);
    v.setStage(Stage.EX, nKind, nId, nPc, nCause);
    if (consumed) {
      v.moveStage(Stage.ID, Stage.IF);
      v.clearStage(Stage.IF);
    }

    // Fetch.
    if (kind[Stage.IF] === SlotKind.Empty && !this.fetchStopped) {
      if (this.options.sharedPort && kind[Stage.MEM] === SlotKind.Instr && OPF[p.op[sid[Stage.MEM]! & POOL_MASK]!]! & F_MEM) {
        v.setStage(Stage.IF, SlotKind.Bubble, -1, 0, Cause.Struct);
        c[Counter.StallStruct]!++;
      } else {
        this.fetch();
      }
    }

    // ecall in WB: everything older has retired and everything younger was squashed.
    if (kind[Stage.WB] === SlotKind.Instr && p.op[sid[Stage.WB]! & POOL_MASK] === OP_ECALL) {
      this.retire(sid[Stage.WB]!);
      this.isHalted = true;
    }
    this.log();
  }

  /** Newest write to register r in MEM (non-load) is bypassed; otherwise the register file. */
  private operand(r: number): number {
    if (r === 0) return 0;
    const v = this.v, p = this.pool;
    if (v.stageKind[Stage.MEM] === SlotKind.Instr) {
      const m = v.stageId[Stage.MEM]! & POOL_MASK;
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
    if (!(f & (F.Branch | F.Jal | F.Jalr))) return;
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

  /** Kill the occupant of a front-end stage; with `bubble` it becomes a flush bubble. */
  private squash(stage: number, bubble: boolean): void {
    const v = this.v;
    if (v.stageKind[stage] === SlotKind.Instr) {
      const id = v.stageId[stage]!;
      v.mark(id, StageCode.Flushed);
      v.setFate(id, Fate.Flushed);
      v.counters[Counter.FlushedInstrs]!++;
    }
    if (bubble) v.setStage(stage, SlotKind.Bubble, -1, 0, Cause.Flush);
    else v.clearStage(stage);
  }

  /** Cause of the stall the ID occupant must take this cycle, or Cause.None. */
  private hazard(s: number): number {
    const v = this.v, p = this.pool;
    const f = OPF[p.op[s]!]!;
    const fwd = this.options.forwarding;
    for (let n = 0; n < 2; n++) {
      const r = n === 0 ? (f & F.Rs1 ? p.rs1[s]! : 0) : f & F.Rs2 ? p.rs2[s]! : 0;
      if (r === 0) continue;
      if (v.stageKind[Stage.EX] === SlotKind.Instr) {
        const e = v.stageId[Stage.EX]! & POOL_MASK;
        const fe = OPF[p.op[e]!]!;
        if (fe & F.Writes && p.rd[e] === r) {
          if (!fwd) return Cause.Data;
          if (fe & F.Load) return Cause.Load;
        }
      }
      if (!fwd && v.stageKind[Stage.MEM] === SlotKind.Instr) {
        const m = v.stageId[Stage.MEM]! & POOL_MASK;
        if (OPF[p.op[m]!]! & F.Writes && p.rd[m] === r) return Cause.Data;
      }
    }
    return Cause.None;
  }

  /** Fetch into IF with a BTB-like predecode: conditional branches use the 1-bit predictor, jal is always predicted taken, jalr not taken. */
  private fetch(): void {
    const v = this.v, p = this.pool;
    const id = v.nextId++;
    const s = id & POOL_MASK;
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
    v.setStage(Stage.IF, SlotKind.Instr, id, pc, Cause.None);
  }

  private log(): void {
    const v = this.v;
    for (let s = 0; s < 5; s++) if (v.stageKind[s] === SlotKind.Instr) v.mark(v.stageId[s]!, s + 1);
  }
}
