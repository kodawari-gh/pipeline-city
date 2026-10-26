// Placeholder engine: the reference interpreter at one instruction per CPU tick, going through the Machine bus.

import { RefCpu, RefMemory } from "../ref/ref";
import type { Engine } from "./engine";
import type { Machine } from "./machine";

/** RefMemory whose accesses are forwarded to the machine bus (its own regions are unused). */
class BusMemory extends RefMemory {
  constructor(private readonly m: Machine) {
    super(0);
  }
  override load8(a: number): number { return this.m.bus.load8(a); }
  override load32(a: number): number { return this.m.bus.load32(a); }
  override store8(a: number, v: number): void { this.m.bus.store8(a, v); }
  override store32(a: number, v: number): void { this.m.bus.store32(a, v); }
}

export class RefEngine implements Engine {
  private cpu: RefCpu | null = null;

  reset(machine: Machine, program: Uint32Array): void {
    machine.loadProgram(program);
    const cpu = new RefCpu(new BusMemory(machine));
    // Share the machine's register file (readonly is TS-only).
    (cpu as { regs: Int32Array }).regs = machine.regs;
    cpu.pc = 0;
    cpu.intc = machine.intc;
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
