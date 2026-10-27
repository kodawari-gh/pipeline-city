// Unpipelined engine: one instruction at a time through IF ID EX MEM WB (5 cycles each, plus cache-miss freezes in MEM).
// No prediction: branches resolve in EX with no penalty. Work happens as the instruction enters each stage:
// IF reads the word through the bus, ID decodes, EX reads registers and computes, MEM does the data access, WB writes back.

import { EngineBase, F, OPF, OP_ECALL, POOL_MASK, type EngineSettings } from "./common";
import { Cause, Counter, SlotKind, Stage } from "./view";

export class UnpipelinedEngine extends EngineBase {
  private active = false;
  private stage = 0;
  private curId = 0;
  private memDone = true;

  constructor(settings: EngineSettings = {}) {
    super(settings);
  }

  protected override onReset(): void {
    this.active = false;
    this.stage = 0;
    this.memDone = true;
  }

  /** Between instructions: idle, or the last one has retired (it retires on entering WB). */
  get drained(): boolean {
    return !this.active || this.stage === Stage.WB;
  }

  step(): void {
    if (this.isHalted) return;
    const v = this.v;
    this.cycleNo++;
    v.counters[Counter.Cycles]!++;
    v.beginCycle(this.cycleNo);
    v.stageStalled.fill(0);
    if (this.active && this.stage === Stage.WB) this.active = false; // retired on entry to WB
    if (!this.active) {
      this.fetch();
    } else if (this.stage === Stage.MEM && !this.memDone) {
      this.memDone = this.memStep(this.curId & POOL_MASK);
    } else {
      this.stage++;
      this.enter(this.stage);
    }
    for (let s = 0; s < 5; s++) v.clearStage(s);
    const s = this.stage;
    v.setStage(s, SlotKind.Instr, this.curId, this.pool.pc[this.curId & POOL_MASK]!, Cause.None);
    if (s === Stage.MEM && !this.memDone) v.stageStalled[s] = 1;
    v.mark(this.curId, s + 1);
  }

  private fetch(): void {
    const id = this.v.nextId++;
    const slot = id & POOL_MASK;
    this.curId = id;
    this.active = true;
    this.stage = Stage.IF;
    this.memDone = true;
    this.pool.fetch(this.bus, this.ramSize, slot, this.fetchPc);
    this.v.startRow(id, this.fetchPc, this.pool.word[slot]!);
  }

  private enter(stage: number): void {
    const p = this.pool;
    const s = this.curId & POOL_MASK;
    switch (stage) {
      case Stage.ID:
        p.decodeSlot(s);
        break;
      case Stage.EX: {
        const f = OPF[p.op[s]!]!;
        p.a[s] = f & F.Rs1 ? this.regs[p.rs1[s]!]! : 0;
        p.b[s] = f & F.Rs2 ? this.regs[p.rs2[s]!]! : 0;
        const next = this.execute(s);
        if (f & F.Branch) this.v.counters[Counter.Branches]!++;
        this.fetchPc = next;
        break;
      }
      case Stage.MEM:
        this.memDone = this.memStep(s);
        break;
      case Stage.WB: {
        const op = p.op[s]!;
        if (OPF[op]! & F.Writes && p.rd[s] !== 0) this.writeReg(p.rd[s]!, p.res[s]!);
        this.retire(this.curId, op);
        if (op === OP_ECALL) this.isHalted = true;
        break;
      }
    }
  }
}
