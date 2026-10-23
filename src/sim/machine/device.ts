import type { Rate } from "./clock";

/** A memory-mapped device. Access is byte-granular; addr is an offset from `base`. */
export interface Device {
  readonly name: string;
  readonly base: number;
  readonly size: number;
  read(addr: number): number;
  write(addr: number, val: number): void;
  /** Called once per tick of the device's own clock domain (named after the device). */
  tick(): void;
  /** Clock settings; omit for a passive device. */
  readonly clock?: Rate;
}

/** Plain byte storage mapped at a range (e.g. status registers). */
export class RamDevice implements Device {
  readonly bytes: Uint8Array;
  constructor(readonly name: string, readonly base: number, readonly size: number) {
    this.bytes = new Uint8Array(size);
  }
  read(addr: number): number {
    return this.bytes[addr]!;
  }
  write(addr: number, val: number): void {
    this.bytes[addr] = val & 0xff;
  }
  tick(): void {}
}
