// Placeholder engine: the reference interpreter at one instruction per CPU tick, going through the Machine bus.

import { RefCpu, RefMemory } from "../ref/ref";
import type { Core } from "./core";
import type { Engine } from "./engine";
import type { Machine } from "./machine";

/** RefMemory whose accesses are forwarded to the machine bus (its own regions are unused). */
class BusMemory extends RefMemory {
  constructor(private readonly m: Machine) {
    super(0);
  }
  override isRamWord(a: number): boolean { return a % 4 === 0 && a + 4 <= this.m.ram.length; }
  override load8(a: number): number { return this.m.bus.load8(a); }
  override load32(a: number): number { return this.m.bus.load32(a); }
  override store8(a: number, v: number): void { this.m.bus.store8(a, v); }
  override store32(a: number, v: number): void { this.m.bus.store32(a, v); }
}

export class RefEngine implements Engine {
  private cpu: RefCpu | null = null;

  reset(machine: Machine, program: Uint32Array, core: Core = machine.cores[0]!): void {
    machine.loadProgram(program, core);
    const cpu = new RefCpu(new BusMemory(machine));
    // Share the core's register file (readonly is TS-only).
    (cpu as { regs: Int32Array }).regs = core.regs;
    cpu.pc = core.entry;
    cpu.intc = core.intc;
    this.cpu = cpu;
  }

  step(): void {
    this.cpu?.step();
  }

  /** Between instructions all the time: an interrupt is taken at once. */
  get drained(): boolean { return true; }
  holdFetch(_on: boolean): void {}
  redirect(pc: number): void {
    if (this.cpu) this.cpu.pc = pc >>> 0;
  }

  get halted(): boolean { return this.cpu?.halted ?? true; }
  get pc(): number { return this.cpu?.pc ?? 0; }
  get cycle(): number { return this.cpu?.steps ?? 0; }
}
