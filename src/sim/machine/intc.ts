// Interrupt controller (docs/CPU.md "Interrupts"): lines devices raise, a mask, the vector the CPU jumps to, and the return
// address. The Machine owns one. The CPU takes an interrupt only between instructions (the engine is drained), so the
// state a handler sees is precise. Nothing here is saved: a loaded game starts powered off.

import { INTC_BASE, INTC_REG, INTC_SIZE } from "../isa/memmap";
import type { Device } from "./device";

export class Intc implements Device {
  readonly name = "intc";
  readonly base = INTC_BASE;
  readonly size = INTC_SIZE;
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

  /** Power-on reset: nothing pending, nothing enabled, no vector, interrupts off. */
  reset(): void {
    this.pending = this.mask = this.vector = this.epc = this.cause = this.taken = this.lastLatency = this.maxLatency = 0;
    this.ie = false;
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
      default: return 0;
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
    }
  }

  tick(): void {}
}
