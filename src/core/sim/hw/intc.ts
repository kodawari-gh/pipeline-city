// Interrupt controller (docs/CPU.md "Interrupts"): lines devices raise, a mask, the vector the CPU jumps to, and the return
// address. The Machine owns one. The CPU takes an interrupt only between instructions (the engine is drained), so the
// state a handler sees is precise. Nothing here is saved: a loaded game starts powered off.

import { INTC_BASE, INTC_REG, INTC_ROUTES, INTC_SIZE, IRQ } from "../memmap";
import type { Device } from "./device";

/** What the cores' controller banks share: who they are (for IPIs) and which core takes each device line. */
export class IntcHub {
  readonly banks: Intc[] = [];
  /** The core that takes each device line, as written to the ROUTE registers (a bad core number means core 0). */
  readonly routes = new Uint32Array(INTC_ROUTES);

  routeOf(line: number): number {
    const r = this.routes[line] ?? 0;
    return r < this.banks.length ? r : 0;
  }

  /** A device raises `line`: the core its route names takes it. Per-core lines (the timer, IPIs) are raised on a bank directly. */
  raise(line: number): void {
    this.banks[this.routeOf(line)]!.raise(line);
  }

  /** Raise `IRQ.IPI` on every core whose bit is set in `mask`. */
  ipi(mask: number): void {
    for (let k = 0; k < this.banks.length && k < 32; k++) if ((mask >>> k) & 1) this.banks[k]!.raise(IRQ.IPI);
  }
}

export class Intc implements Device {
  readonly name = "intc";
  readonly base = INTC_BASE;
  readonly size = INTC_SIZE;
  /** Set by a write to PARK: the machine does not step this core until a line that is not masked is pending. */
  parked = false;
  /** CPU cycles spent parked. */
  parkedCycles = 0;
  /** Display row base of this core (see `INTC_REG.ROW_BASE`). */
  rowBase = 0;
  /** Lines raised and not yet acknowledged. */
  pending = 0;
  /** Lines allowed to interrupt. */
  mask = 0;
  /** Global enable: cleared on entry, set by iret. */
  ie = false;
  vector = 0;
  epc = 0;
  cause = 0;
  /** Interrupts taken so far. */
  taken = 0;
  /** CPU cycles from an interrupt becoming deliverable to the handler's first fetch (the last one, and the worst). */
  lastLatency = 0;
  maxLatency = 0;

  /** Bank `index` of `hub` (a controller on its own is a one-core machine's). */
  constructor(readonly index = 0, readonly hub: IntcHub = new IntcHub()) {
    hub.banks[index] = this;
  }

  /** Power-on reset: nothing pending, nothing enabled, no vector, interrupts off, not parked. Routes are the hub's and are reset with core 0. */
  reset(): void {
    this.pending = this.mask = this.vector = this.epc = this.cause = this.taken = this.lastLatency = this.maxLatency = 0;
    this.ie = false;
    this.parked = false;
    this.parkedCycles = 0;
    this.rowBase = 0;
    if (this.index === 0) this.hub.routes.fill(0);
  }

  /** Whether a parked core wakes now: a line that is not masked is pending (the interrupt is taken, if interrupts are on, as usual). */
  get wakes(): boolean {
    return (this.pending & this.mask) !== 0;
  }

  /** A device asks for service. Stays pending until the handler acknowledges it. */
  raise(line: number): void {
    this.pending = (this.pending | (1 << line)) >>> 0;
  }

  /** Clear lines (the ACK register). */
  ack(bits: number): void {
    this.pending = (this.pending & ~bits) >>> 0;
  }

  /** The line to take now, or -1: interrupts on, and a pending line that is not masked. The lowest line wins. */
  next(): number {
    if (!this.ie) return -1;
    const m = (this.pending & this.mask) >>> 0;
    return m === 0 ? -1 : 31 - Math.clz32(m & -m);
  }

  /** The CPU takes `line`: remember where to come back to and switch interrupts off. */
  enter(line: number, epc: number, latency: number): void {
    this.epc = epc >>> 0;
    this.cause = line;
    this.ie = false;
    this.taken++;
    this.lastLatency = latency;
    if (latency > this.maxLatency) this.maxLatency = latency;
  }

  /** iret retired: interrupts are on again. */
  leave(): void {
    this.ie = true;
  }

  private word(reg: number): number {
    switch (reg) {
      case INTC_REG.PENDING: return this.pending;
      case INTC_REG.MASK: return this.mask;
      case INTC_REG.VECTOR: return this.vector;
      case INTC_REG.EPC: return this.epc;
      case INTC_REG.CAUSE: return this.cause;
      case INTC_REG.CTRL: return this.ie ? 1 : 0;
      case INTC_REG.COUNT: return this.taken;
      case INTC_REG.ROW_BASE: return this.rowBase;
      case INTC_REG.CORE_ID: return this.index;
      case INTC_REG.CORES: return this.hub.banks.length;
      case INTC_REG.PARK: return this.parked ? 1 : 0;
      default: {
        const line = (reg - INTC_REG.ROUTE) >> 2;
        return reg >= INTC_REG.ROUTE && line < INTC_ROUTES ? this.hub.routes[line]! : 0;
      }
    }
  }

  read(addr: number): number {
    return (this.word(addr & ~3) >>> (8 * (addr & 3))) & 0xff;
  }

  /** Byte write (the bus composes a word store from four, low byte first). */
  write(addr: number, val: number): void {
    const reg = addr & ~3;
    const shift = 8 * (addr & 3);
    const byte = (val & 0xff) << shift;
    const merge = (old: number): number => (((old & ~(0xff << shift)) | byte) >>> 0);
    switch (reg) {
      case INTC_REG.MASK: this.mask = merge(this.mask); break;
      case INTC_REG.ACK: this.ack(byte >>> 0); break;
      case INTC_REG.VECTOR: this.vector = merge(this.vector); break;
      case INTC_REG.EPC: this.epc = merge(this.epc); break;
      case INTC_REG.CTRL: if (shift === 0) this.ie = (val & 1) !== 0; break;
      case INTC_REG.ROW_BASE: this.rowBase = merge(this.rowBase) | 0; break;
      case INTC_REG.IPI: this.hub.ipi(byte >>> 0); break;
      case INTC_REG.PARK: if (val & 0xff) this.parked = true; break;
      default: {
        const line = (reg - INTC_REG.ROUTE) >> 2;
        if (reg >= INTC_REG.ROUTE && line < INTC_ROUTES) this.hub.routes[line] = merge(this.hub.routes[line]!);
      }
    }
  }

  tick(): void {}
}
