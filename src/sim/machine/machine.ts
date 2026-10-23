import { REG_COUNT, REG_SP } from "../isa/isa";
import { RAM_DEFAULT_SIZE, STATUS_BASE, STATUS_SIZE } from "../isa/memmap";
import { Bus } from "./bus";
import { ClockScheduler, type Rate } from "./clock";
import { RamDevice, type Device } from "./device";
import { Display } from "./display";
import type { Engine } from "./engine";
import { Prng } from "./prng";

export interface MachineConfig {
  ramSize?: number;
  seed?: number;
  /** CPU clock relative to the base tick (ticks per base tick = mul/div). Default 1/1. */
  cpuRate?: Rate;
  displayRate?: Rate;
  /** Display ticks per landed write; 0 = instant. */
  displayLatency?: number;
}

/** Owns RAM, registers, the bus with its devices, the clock scheduler and the PRNG. Engines own only their pipeline state. */
export class Machine {
  readonly ram: Uint8Array;
  readonly regs = new Int32Array(REG_COUNT);
  readonly bus: Bus;
  readonly clock = new ClockScheduler();
  readonly prng: Prng;
  readonly display: Display;
  readonly status: RamDevice;
  engine: Engine | null = null;

  constructor(cfg: MachineConfig = {}) {
    this.ram = new Uint8Array(cfg.ramSize ?? RAM_DEFAULT_SIZE);
    this.bus = new Bus(this.ram);
    this.prng = new Prng(cfg.seed ?? 1);
    this.display = new Display(cfg.displayRate, cfg.displayLatency ?? 0);
    this.status = new RamDevice("status", STATUS_BASE, STATUS_SIZE);
    this.addDevice(this.display);
    this.addDevice(this.status);
    // Registered after devices, so devices tick before the CPU within the same sub-tick.
    this.clock.addDomain("cpu", cfg.cpuRate ?? { mul: 1, div: 1 }, () => {
      const e = this.engine;
      if (e && !e.halted) e.step();
    });
  }

  /** Map a device on the bus; if it has clock settings it gets a domain named after it. */
  addDevice(d: Device): void {
    this.bus.attach(d);
    if (d.clock) this.clock.addDomain(d.name, d.clock, () => d.tick());
  }

  /** Zero registers (sp = top of RAM) and copy the program into RAM at `addr`. Does not touch devices. */
  loadProgram(program: Uint32Array, addr = 0): void {
    this.regs.fill(0);
    this.regs[REG_SP] = this.ram.length | 0;
    program.forEach((w, k) => this.bus.store32(addr + 4 * k, w));
  }

  /** Install an engine and reset it with a program. */
  attach(engine: Engine, program: Uint32Array): void {
    this.engine = engine;
    engine.reset(this, program);
  }

  advanceBaseTick(): void {
    this.clock.advanceBaseTick();
  }
}
