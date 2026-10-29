// One CPU core's own state (docs/MULTICORE.md section 1): the register file, the interrupt controller, the interval timer, the memory protection
// unit and the MMU, plus the engine that runs it. Everything else (RAM, the other devices, the L2 and DRAM) is shared. `Machine` has one core
// unless it is built with more; the fields of core 0 are also on the Machine itself (`machine.regs`, `machine.intc`, ...).

import { REG_COUNT } from "../isa/isa";
import type { Bus } from "./bus";
import type { Device } from "./device";
import type { Engine } from "./engine";
import { Intc, type IntcHub } from "./intc";
import { Mmu } from "./mmu";
import { Mpu } from "./mpu";
import { Timer } from "./timer";

export class Core {
  readonly regs = new Int32Array(REG_COUNT);
  readonly intc: Intc;
  readonly mpu = new Mpu();
  readonly timer: Timer;
  readonly mmu: Mmu;
  engine: Engine | null = null;
  /** Where this core's program is loaded and starts (0 for core 0), and its initial stack pointer (the top of RAM unless given). */
  entry = 0;
  stackTop: number;
  /** Cycles an interrupt has been deliverable and waiting for the pipeline to drain. */
  irqWait = 0;
  /** CPU cycles still to wait for the guard's surcharge. */
  cpuStall = 0;

  constructor(readonly index: number, ram: Uint8Array, hub?: IntcHub) {
    this.intc = new Intc(index, hub);
    this.timer = new Timer(this.intc);
    this.mmu = new Mmu(ram);
    this.stackTop = ram.length | 0;
  }

  /** Power-on of this core's own devices. */
  powerOn(): void {
    this.intc.reset();
    this.mpu.reset();
    this.timer.reset();
    this.mmu.reset();
    this.irqWait = 0;
    this.cpuStall = 0;
  }
}

/** A device with one bank per core at the same address: an access goes to the bank of the core the bus is serving (`bus.core`). */
export class BankedDevice implements Device {
  readonly base: number;
  readonly size: number;
  constructor(readonly name: string, private readonly banks: Device[], private readonly bus: Bus) {
    this.base = banks[0]!.base;
    this.size = banks[0]!.size;
  }
  read(addr: number): number { return this.banks[this.bus.core]!.read(addr); }
  write(addr: number, val: number): void { this.banks[this.bus.core]!.write(addr, val); }
  tick(): void {}
}
