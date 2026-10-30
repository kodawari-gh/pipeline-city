import { REG_SP } from "../isa/isa";
import { IRQ, KERNEL_FAULT, RAM_DEFAULT_SIZE, STATUS_BASE, STATUS_SIZE } from "../isa/memmap";
import type { MemSystem } from "../engines/memsys";
import { Bus } from "./bus";
import { ClockScheduler, type Rate } from "./clock";
import { BankedDevice, Core } from "./core";
import { RamDevice, type Device } from "./device";
import { Display } from "./display";
import type { Engine } from "./engine";
import { IntcHub } from "./intc";
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
  /** The cores; `setCores` grows or shrinks the list in place. */
  readonly cores: Core[];
  /** What the cores' interrupt controllers share: IPIs and the device-line routes. */
  readonly hub: IntcHub;
  readonly bus: Bus;
  readonly clock = new ClockScheduler();
  readonly prng: Prng;
  readonly display: Display;
  readonly status: RamDevice;
  /** The L2 and DRAM the cores share, if the machine was given one (the game gives a multicore CPU's before `attach`). */
  mem: MemSystem | null;
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
    if (this.mem && n > 1) this.mem.shared = true;
    this.hub = new IntcHub();
    this.cores = Array.from({ length: n }, (_, k) => new Core(k, this.ram, this.hub));
    const c0 = this.cores[0]!;
    this.regs = c0.regs; this.intc = c0.intc; this.mpu = c0.mpu; this.timer = c0.timer; this.mmu = c0.mmu;
    this.display = new Display(cfg.displayRate, cfg.displayLatency ?? 0);
    // A display access lands `rowBase` rows lower for the core making it (0 unless the OS sets it, so one core is unchanged).
    this.display.rowShift = () => this.cores[this.bus.core]!.intc.rowBase;
    this.status = new RamDevice("status", STATUS_BASE, STATUS_SIZE);
    this.addDevice(this.display);
    this.addDevice(this.status);
    // The per-core devices sit at the same addresses for every core; with several cores a banked device answers for the core the bus is serving.
    this.perCore = ([(c) => c.intc, (c) => c.mpu, (c) => c.timer, (c) => c.mmu] as ((c: Core) => Device)[]).map((pick) => ({ pick, dev: this.deviceFor(pick) }));
    for (const c of this.cores) c.mmu.onSpace = (table) => c.engine?.note?.(10, table, 0, 0); // Ev.Space
    for (const e of this.perCore) this.addDevice(e.dev);
    this.bus.mpu = this.mpu;
    // Protected mode (the TPM) guards the address space that asked for it: its page table while translation is on, else physical (-1).
    this.bus.spaceOf = (k) => { const m = this.cores[k]!.mmu; return m.enabled ? m.table : -1; };
    this.bus.translate = (k, va) => this.cores[k]!.mmu.peek(va);
    // Registered after devices, so devices tick before the CPU within the same sub-tick.
    this.clock.addDomain("cpu", cfg.cpuRate ?? { mul: 1, div: 1 }, () => this.stepCpu());
  }

  private readonly perCore: { pick: (c: Core) => Device; dev: Device }[];

  /** The bus device for one per-core unit: the unit itself on a single core, else a banked device that answers for the core being served. */
  private deviceFor(pick: (c: Core) => Device): Device {
    const n = this.cores.length;
    return n === 1 ? pick(this.cores[0]!) : new BankedDevice(pick(this.cores[0]!).name, this.cores.map(pick), this.bus);
  }

  /**
   * Make the machine have `n` cores (the game calls this when the CPU is swapped; no engines are attached to new cores yet). Core 0 and its devices
   * stay; the per-core devices on the bus are swapped for banked ones (or back for a single core), and a shared L2 is switched on for more than one.
   */
  setCores(n: number): void {
    if (!Number.isInteger(n) || n < 1) throw new RangeError("a machine needs at least one core");
    if (n !== this.cores.length) {
      while (this.cores.length < n) {
        const c = new Core(this.cores.length, this.ram, this.hub);
        c.mmu.onSpace = (table) => c.engine?.note?.(10, table, 0, 0);
        this.cores.push(c);
      }
      while (this.cores.length > n) this.cores.pop();
      this.hub.banks.length = n;
      for (const e of this.perCore) {
        const at = this.bus.devices.indexOf(e.dev);
        e.dev = this.deviceFor(e.pick);
        this.bus.devices[at] = e.dev;
      }
    }
    if (this.mem) this.mem.shared = n > 1;
  }

  /** Hardware cores: the engines (a core that runs several threads is one). */
  hardwareCores(): number {
    let n = 0;
    for (const c of this.cores) if (this.isPrimary(c)) n++;
    return n;
  }

  /** The first logical core of its hardware core, the one the machine steps for it. */
  private isPrimary(c: Core): boolean {
    const t = c.engine?.threads;
    return !t || t[0] === c;
  }

  /**
   * The power model's busy cores, in hardware cores: an engine that has not halted and has a thread that is not parked counts one, plus 15 percent of a
   * core for each core whose second thread is busy too (more of the core switches).
   */
  busyCores(): number {
    let n = 0;
    for (const c of this.cores) {
      const e = c.engine;
      if (!e || e.halted || !this.isPrimary(c)) continue;
      const ts = e.threads ?? [c];
      const live = ts.filter((t) => !t.intc.parked).length;
      if (live > 0) n += 1 + 0.15 * (live - 1);
    }
    return n;
  }

  /**
   * Put core `k` in the state a secondary core powers on in: parked, interrupts on, only the IPI line unmasked and its vector at `vector`. The first IPI
   * sends it to `vector` (as a reset vector would); the kernel's secondary entry sets the core up from there. Call after `attachCore`.
   */
  parkCore(k: number, vector: number): void {
    const intc = this.cores[k]!.intc;
    intc.vector = vector >>> 0;
    intc.mask = (1 << IRQ.IPI) >>> 0;
    intc.ie = true;
    intc.parked = true;
  }

  /** A device raises `line`: the core its ROUTE register names takes it (core 0 by default). */
  raise(line: number): void {
    this.hub.raise(line);
  }

  /** One CPU cycle: every core in turn (index order, rotating with a shared L2), so the same save gives the same cycles. */
  stepCpu(): void {
    const cores = this.cores;
    if (cores.length === 1) { this.stepCore(cores[0]!); return; }
    // With a shared L2 the cores that miss in the same cycle are served one per cycle in rotation, starting at cycle % cores: the step order rotates so no core is starved.
    const mem = this.mem, n = cores.length, first = mem ? mem.now % n : 0;
    for (let i = 0; i < n; i++) {
      const k = (first + i) % n, c = cores[k]!;
      if (!this.isPrimary(c)) continue; // a thread is stepped with its core
      this.bus.serve(k, c.mpu);
      this.stepCore(c);
    }
    if (mem) mem.now++;
  }

  /**
   * One CPU cycle of a core: take a deliverable interrupt if the engine is between instructions, otherwise stop fetching so it gets
   * there (the pipeline drains, which is the interrupt latency), then step the engine. A handler starts at `intc.vector`
   * and returns with `iret`. A halted engine (ecall) takes none.
   */
  private stepCore(p: Core): void {
    const e = p.engine;
    if (!e || e.halted) return;
    if (e.concurrent && e.threads) { this.stepSmt(p, e, e.threads); return; }
    // With threads, the core being served is the one the engine fetches for; a core with nothing to fetch for still counts its misses down.
    let c = p;
    if (e.threads) {
      const a = this.pickThread(p, e, e.threads);
      if (!a) return;
      c = a;
      this.bus.serve(c.index, c.mpu);
    } else c.timer.step();
    const { intc } = c;
    // A parked core stops fetching, lets what is already in the pipeline finish, and then is not stepped at all (it draws idle power) until a
    // line that is not masked is pending; the interrupt itself is taken below, if interrupts are on.
    let draining = false;
    if (intc.parked) {
      if (intc.wakes) intc.parked = false;
      else {
        e.holdFetch?.(true);
        if (e.drained !== false) {
          intc.parkedCycles++;
          if (e.threads) { e.yieldThread?.(); if (e.waiting) this.runEngine(e, p); } // another thread takes the core
          return;
        }
        draining = true;
      }
    }
    // Protected mode charges extra cycles per RAM access (the TPM's encryption): the CPU waits them out.
    if (p.cpuStall > 0) { p.cpuStall--; return; }
    this.trap(e, c, draining);
    this.runEngine(e, p);
  }

  /**
   * One cycle of a core whose threads all run at once (full SMT): every thread's timer counts and a parked one wakes if a line is pending, then each thread
   * takes its own interrupt once its share of the pipeline has drained (the other thread goes on meanwhile), and the engine steps once. A core with every
   * thread parked and drained is not stepped at all.
   */
  private stepSmt(p: Core, e: Engine, ts: readonly Core[]): void {
    for (const t of ts) {
      t.timer.step();
      if (t.intc.parked && t.intc.wakes) t.intc.parked = false;
    }
    if (p.cpuStall > 0) { p.cpuStall--; return; }
    let busy = false;
    for (let t = 0; t < ts.length; t++) {
      if (e.threadHalted?.(t)) continue;
      const c = ts[t]!;
      e.selectThread!(t);
      this.bus.serve(c.index, c.mpu);
      let draining = false;
      if (c.intc.parked) {
        e.holdFetch?.(true);
        if (e.drained !== false) { c.intc.parkedCycles++; continue; }
        draining = true;
      }
      busy = true;
      this.trap(e, c, draining);
    }
    if (busy) this.runEngine(e, p);
  }

  /**
   * An interrupt for core `c` if the engine is between instructions (otherwise stop fetching so it gets there), and the jump to the kernel's fault handler after
   * a write to protected memory (the OS ends the job). `draining` is a parked core finishing what it has in flight: it takes neither.
   */
  private trap(e: Engine, c: Core, draining: boolean): void {
    const { intc, mpu, mmu } = c;
    if (!draining && e.drained !== undefined && e.holdFetch && e.redirect) {
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
  }

  /** One engine step with the guard on; the stall it asked for is its hardware core's. */
  private runEngine(e: Engine, p: Core): void {
    this.bus.guardOn = true;
    try {
      e.step();
    } finally {
      this.bus.guardOn = false;
    }
    if (this.bus.stallCycles > 0) { p.cpuStall += this.bus.stallCycles; this.bus.stallCycles = 0; }
  }

  /**
   * The threads of one hardware core for this cycle: every thread's timer counts and a parked one wakes if a line is pending; a thread that has an
   * interrupt to take asks for the core. Returns the thread the engine fetches for, or null (every thread waits: parked, ended or on a miss).
   */
  private pickThread(p: Core, e: Engine, ts: readonly Core[]): Core | null {
    for (const t of ts) {
      t.timer.step();
      if (t.intc.parked && t.intc.wakes) t.intc.parked = false;
    }
    const a = e.activeCore ?? null;
    for (const t of ts) if (t !== a && !t.intc.parked && t.intc.next() >= 0) { e.switchTo?.(t); break; }
    if (a) return a;
    if (e.waiting || ts.some((t) => !t.intc.parked)) this.runEngine(e, p);
    else for (const t of ts) t.intc.parkedCycles++;
    return null;
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

  /**
   * Make logical core `k` another thread of the engine of hardware core `of` (an `attachCore` call has installed it): the thread has its own registers,
   * interrupt controller, timer and MMU and shares the engine's pipeline and caches. With a `program` it is loaded at `entry` and the thread runs it at
   * once (a test); without, the caller parks the thread like a secondary core (see `parkCore`) for the OS to start.
   */
  attachThread(k: number, of: number, program?: Uint32Array, opts: { entry?: number; stackTop?: number } = {}): void {
    const c = this.cores[k], e = this.cores[of]?.engine;
    if (!c || !e?.addThread) throw new RangeError(`no core ${k} or no threads on core ${of}`);
    c.powerOn();
    c.entry = opts.entry ?? 0;
    c.stackTop = opts.stackTop ?? this.ram.length;
    if (k > 0) c.mmu.configure(this.mmu.tlbEntries);
    c.engine = e;
    e.addThread(c);
    if (program) this.loadProgram(program, c);
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
