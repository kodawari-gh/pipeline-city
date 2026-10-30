// The `simd` engine (gpu1): the reference interpreter's timing rule, one cycle at a time. An instruction issues on the first cycle of
// its cost and the engine then waits out the rest (a conflicted vld / vst), so the totals equal `GpuRef.cycles`.

import { GpuRef, type GpuStep } from "../ref/gpuref";
import type { GpuEngine, SimdConfig } from "./engine";

export class SimdEngine implements GpuEngine {
  private readonly ref: GpuRef;
  private busy = 0;
  cycles = 0;

  constructor(cfg: SimdConfig) {
    this.ref = new GpuRef(cfg);
  }

  get lanes(): number { return this.ref.lanes; }
  get banks(): number { return this.ref.banks; }
  get mem(): Uint32Array { return this.ref.mem; }
  get regs(): Int32Array[] { return this.ref.regs; }
  get mask(): number { return this.ref.mask; }
  get stack(): readonly number[] { return this.ref.stack; }
  get pc(): number { return this.ref.pc; }
  get halted(): boolean { return this.ref.halted && this.busy === 0; }
  get instructions(): number { return this.ref.instructions; }
  get conflictCycles(): number { return this.ref.conflictCycles; }
  get idleLaneSlots(): number { return this.ref.idleLaneSlots; }

  reset(pc = 0, activeLanes = this.ref.lanes): void {
    this.ref.reset(pc, activeLanes);
    this.busy = 0;
    this.cycles = 0;
  }

  step(): GpuStep | null {
    if (this.halted) return null;
    this.cycles++;
    if (this.busy > 0) {
      this.busy--;
      return null;
    }
    this.ref.step();
    const s = this.ref.lastStep;
    this.busy = s ? s.cost - 1 : 0;
    return s;
  }
}
