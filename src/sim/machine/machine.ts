import { REG_SP } from "../isa/isa";
import { KERNEL_FAULT, RAM_DEFAULT_SIZE, STATUS_BASE, STATUS_SIZE } from "../isa/memmap";
import type { MemSystem } from "../engines/memsys";
import { Bus } from "./bus";
import { ClockScheduler, type Rate } from "./clock";
import { BankedDevice, Core } from "./core";
import { RamDevice, type Device } from "./device";
import { Display } from "./display";
import type { Engine } from "./engine";
import { Prng } from "./prng";

export interface MachineConfig {
  ramSize?: number;
  seed?: number;
  /** Cores (default 1). Each has its own registers, interrupt controller, timer, protection unit and MMU, at the same bus addresses. */
  cores?: number;
  /** The L2 and DRAM the cores share (docs/MULTICORE.md); handed to every engine of a multicore machine. A single core keeps its engine's own. */
  mem?: MemSystem;
  /** CPU clock relative to the base tick (ticks per base tick = mul/div). Default 1/1. */
  cpuRate?: Rate;
  displayRate?: Rate;
  /** Display ticks per landed write; 0 = instant. */
  displayLatency?: number;
}

/**
 * Owns RAM, the bus with its devices, the clock scheduler and the PRNG, and the cores. Engines own only their pipeline state.
 * `regs`, `intc`, `mpu`, `timer`, `mmu` and `engine` are core 0's (the only core of a single-core machine).
 */
export class Machine {
  readonly ram: Uint8Array;
  readonly cores: Core[];
  readonly bus: Bus;
  readonly clock = new ClockScheduler();
  readonly prng: Prng;
  readonly display: Display;
  readonly status: RamDevice;
  /** The L2 and DRAM the cores share, if the machine was given one. */
  readonly mem: MemSystem | null;
  /** Core 0's register file. */
  readonly regs: Core["regs"];
  /** Interrupt controller, always on the bus at INTC_BASE (banked per core on a multicore machine). */
  readonly intc: Core["intc"];
  /** Memory protection, always on the bus at MPU_BASE (off until the kernel enables it for a job). */
  readonly mpu: Core["mpu"];
  readonly timer: Core["timer"];
  /** Memory management unit (docs/VM.md), always on the bus at MMU_BASE; a CPU without one leaves it `tlbEntries` 0. */
  readonly mmu: Core["mmu"];

  get engine(): Engine | null { return this.cores[0]!.engine; }
  set engine(e: Engine | null) { this.cores[0]!.engine = e; }

  constructor(cfg: MachineConfig = {}) {
    this.ram = new Uint8Array(cfg.ramSize ?? RAM_DEFAULT_SIZE);
    this.bus = new Bus(this.ram);
    this.prng = new Prng(cfg.seed ?? 1);
    this.mem = cfg.mem ?? null;
    const n = cfg.cores ?? 1;
    if (!Number.isInteger(n) || n < 1) throw new RangeError("a machine needs at least one core");
    this.cores = Array.from({ length: n }, (_, k) => new Core(k, this.ram));
    const c0 = this.cores[0]!;
    this.regs = c0.regs; this.intc = c0.intc; this.mpu = c0.mpu; this.timer = c0.timer; this.mmu = c0.mmu;
    this.display = new Display(cfg.displayRate, cfg.displayLatency ?? 0);
    this.status = new RamDevice("status", STATUS_BASE, STATUS_SIZE);
    this.addDevice(this.display);
    this.addDevice(this.status);
    // The per-core devices sit at the same addresses for every core; with several cores a banked device answers for the core the bus is serving.
    const per = <T extends Device>(pick: (c: Core) => T): Device => (n === 1 ? pick(c0) : new BankedDevice(pick(c0).name, this.cores.map(pick), this.bus));
    this.addDevice(per((c) => c.intc));
    this.addDevice(per((c) => c.mpu));
    this.addDevice(per((c) => c.timer));
    for (const c of this.cores) c.mmu.onSpace = (table) => c.engine?.note?.(10, table, 0, 0); // Ev.Space
    this.addDevice(per((c) => c.mmu));
    this.bus.mpu = this.mpu;
    // Registered after devices, so devices tick before the CPU within the same sub-tick.
    this.clock.addDomain("cpu", cfg.cpuRate ?? { mul: 1, div: 1 }, () => this.stepCpu());
  }

  /** One CPU cycle: every core in index order, so the same save gives the same cycles. */
  stepCpu(): void {
    const cores = this.cores;
    if (cores.length === 1) { this.stepCore(cores[0]!); return; }
    for (let k = 0; k < cores.length; k++) {
      const c = cores[k]!;
      this.bus.serve(k, c.mpu);
      this.stepCore(c);
    }
  }

  /**
   * One CPU cycle of a core: take a deliverable interrupt if the engine is between instructions, otherwise stop fetching so it gets
   * there (the pipeline drains, which is the interrupt latency), then step the engine. A handler starts at `intc.vector`
   * and returns with `iret`. A halted engine (ecall) takes none.
   */
  private stepCore(c: Core): void {
    const e = c.engine;
    if (!e || e.halted) return;
    const { intc, mpu, mmu } = c;
    c.timer.step();
    // Protected mode charges extra cycles per RAM access (the TPM's encryption): the CPU waits them out.
    if (c.cpuStall > 0) { c.cpuStall--; return; }
    if (e.drained !== undefined && e.holdFetch && e.redirect) {
      const line = intc.next();
      if (line < 0) {
        e.holdFetch(false);
        c.irqWait = 0;
      } else if (e.drained) {
        intc.enter(line, e.pc, c.irqWait);
        e.note?.(8, line, e.pc, intc.vector); // Ev.Irq
        mmu.enterKernel(); // the handler runs on physical addresses
        e.redirect(intc.vector);
        e.holdFetch(false);
        c.irqWait = 0;
      } else {
        e.holdFetch(true);
        c.irqWait++;
      }
    }
    // A job wrote to protected memory: stop fetching until the pipeline is empty, then send the CPU to the kernel's fault handler (the OS ends the job).
    if (mpu.tripped && e.drained !== undefined && e.holdFetch && e.redirect) {
      if (e.drained) {
        mpu.tripped = false;
        mpu.enabled = false;
        e.redirect(KERNEL_FAULT);
        e.holdFetch(false);
      } else e.holdFetch(true);
    }
    this.bus.guardOn = true;
    try {
      e.step();
    } finally {
      this.bus.guardOn = false;
    }
    if (this.bus.stallCycles > 0) { c.cpuStall += this.bus.stallCycles; this.bus.stallCycles = 0; }
  }

  /** Map a device on the bus; if it has clock settings it gets a domain named after it. */
  addDevice(d: Device): void {
    this.bus.attach(d);
    if (d.clock) this.clock.addDomain(d.name, d.clock, () => d.tick());
  }

  /** Zero a core's registers (sp = its stack top, the top of RAM for core 0) and copy the program into RAM at the core's entry. Does not touch devices. */
  loadProgram(program: Uint32Array, core: Core = this.cores[0]!): void {
    core.regs.fill(0);
    core.regs[REG_SP] = core.stackTop | 0;
    program.forEach((w, k) => this.bus.store32(core.entry + 4 * k, w));
  }

  /** Install an engine on core 0 and reset it with a program. A new engine is a power-on: every core's interrupt controller starts blank too. */
  attach(engine: Engine, program: Uint32Array): void {
    for (const c of this.cores) c.powerOn();
    this.bus.stallCycles = 0;
    this.mem?.reset();
    this.install(this.cores[0]!, engine, program);
  }

  /**
   * Install an engine on core `k` (after `attach` has powered the machine on) and start `program` there: it is loaded at `entry` and starts
   * at `entry` with its stack at `stackTop` (both must not overlap what the other cores use). Programs are position independent except for
   * their data addresses.
   */
  attachCore(k: number, engine: Engine, program: Uint32Array, opts: { entry?: number; stackTop?: number } = {}): void {
    const c = this.cores[k];
    if (!c) throw new RangeError(`no core ${k}`);
    c.powerOn();
    c.entry = opts.entry ?? 0;
    c.stackTop = opts.stackTop ?? this.ram.length;
    if (k > 0) c.mmu.configure(this.mmu.tlbEntries);
    this.install(c, engine, program);
  }

  private install(c: Core, engine: Engine, program: Uint32Array): void {
    c.engine = engine;
    if (this.mem && this.cores.length > 1) engine.useMemSystem?.(this.mem);
    engine.reset(this, program, c);
  }

  advanceBaseTick(): void {
    this.clock.advanceBaseTick();
  }
}
