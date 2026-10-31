// Interval timer (docs/OS.md "Preemption"): counts CPU cycles and raises the TIMER interrupt line every INTERVAL cycles. The preemptive
// OS programs it and runs its scheduler in the handler. Off by default; counting is in CPU cycles, so it is deterministic.

import { IRQ, TIMER_BASE, TIMER_REG, TIMER_SIZE } from "./memmap";
import type { Device } from "./device";
import type { Intc } from "./intc";

export class Timer implements Device {
  readonly name = "timer";
  readonly base = TIMER_BASE;
  readonly size = TIMER_SIZE;
  /** Cycles between interrupts; 0 = off. */
  interval = 0;
  /** Cycles since the last interrupt. */
  count = 0;
  /** Interrupts raised since power-on. */
  fired = 0;

  constructor(private readonly intc: Intc) {}

  reset(): void {
    this.interval = this.count = this.fired = 0;
  }

  /** One CPU cycle. */
  step(): void {
    if (this.interval === 0) return;
    if (++this.count >= this.interval) {
      this.count = 0;
      this.fired++;
      this.intc.raise(IRQ.TIMER);
    }
  }

  private bytes = new Map<number, number>();

  read(off: number): number {
    const v = (off & ~3) === TIMER_REG.INTERVAL ? this.interval : (off & ~3) === TIMER_REG.COUNT ? this.fired : 0;
    return (v >>> (8 * (off & 3))) & 0xff;
  }

  write(off: number, val: number): void {
    const reg = off & ~3, k = off & 3;
    const next = (((this.bytes.get(reg) ?? 0) & ~(0xff << (8 * k))) | ((val & 0xff) << (8 * k))) >>> 0;
    this.bytes.set(reg, next);
    if (k !== 3) return;
    this.bytes.delete(reg);
    if (reg === TIMER_REG.INTERVAL) { this.interval = next; this.count = 0; }
    else if (reg === TIMER_REG.KICK) { this.count = 0; this.fired++; this.intc.raise(IRQ.TIMER); }
  }

  tick(): void {}
}
