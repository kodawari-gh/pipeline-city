// Memory protection unit (docs/OS.md "Memory protection"): the kernel programs two protected ranges of RAM and switches the unit on while
// a job runs. A store into a protected range is dropped and trips the unit; the machine then sends the CPU to the kernel's fault handler,
// which ends the job (the OS kills the process; the machine goes on). Off by default, and off whenever the kernel itself is running.

import { MPU_BASE, MPU_REG, MPU_SIZE } from "../isa/memmap";
import type { Device } from "./device";

export class Mpu implements Device {
  readonly name = "mpu";
  readonly base = MPU_BASE;
  readonly size = MPU_SIZE;
  enabled = false;
  /** Two protected ranges [lo, hi). */
  readonly lo = [0, 0];
  readonly hi = [0, 0];
  /** A store was refused and the CPU has not been sent to the handler yet. */
  tripped = false;
  /** Faults since power-on, and the address of the last one. */
  faults = 0;
  faultAddr = 0;

  reset(): void {
    this.enabled = false;
    this.lo[0] = this.lo[1] = this.hi[0] = this.hi[1] = 0;
    this.tripped = false;
    this.faults = 0;
    this.faultAddr = 0;
  }

  /** Whether a store to `addr` must be refused: the unit is on and the address is in a protected range, or a fault is waiting for the CPU to drain (what the job still has in flight does not land). */
  denies(addr: number): boolean {
    return this.tripped || this.enabled && ((addr >= this.lo[0]! && addr < this.hi[0]!) || (addr >= this.lo[1]! && addr < this.hi[1]!));
  }

  /** A store was refused. */
  trip(addr: number): void {
    if (!this.tripped) { this.faults++; this.faultAddr = addr >>> 0; }
    this.tripped = true;
  }

  private word(off: number): number {
    switch (off & ~3) {
      case MPU_REG.ENABLE: return this.enabled ? 1 : 0;
      case MPU_REG.R0_LO: return this.lo[0]!;
      case MPU_REG.R0_HI: return this.hi[0]!;
      case MPU_REG.R1_LO: return this.lo[1]!;
      case MPU_REG.R1_HI: return this.hi[1]!;
      case MPU_REG.FAULTS: return this.faults;
      case MPU_REG.FAULT_ADDR: return this.faultAddr;
      default: return 0;
    }
  }

  read(off: number): number {
    return (this.word(off) >>> (8 * (off & 3))) & 0xff;
  }

  private bytes = new Map<number, number>();

  write(off: number, val: number): void {
    // word registers written a byte at a time: assemble, apply on the last byte
    const reg = off & ~3, k = off & 3;
    const cur = this.bytes.get(reg) ?? 0;
    const next = ((cur & ~(0xff << (8 * k))) | ((val & 0xff) << (8 * k))) >>> 0;
    this.bytes.set(reg, next);
    if (k !== 3) return;
    this.bytes.delete(reg);
    switch (reg) {
      case MPU_REG.ENABLE: this.enabled = (next & 1) !== 0; break;
      case MPU_REG.R0_LO: this.lo[0] = next; break;
      case MPU_REG.R0_HI: this.hi[0] = next; break;
      case MPU_REG.R1_LO: this.lo[1] = next; break;
      case MPU_REG.R1_HI: this.hi[1] = next; break;
    }
  }

  tick(): void {}
}
