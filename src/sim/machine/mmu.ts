// Memory management unit (docs/VM.md): the MMU a CPU may have, with its TLB. While it is on, the CPU's instruction fetches and its loads and stores
// use virtual addresses: a 20-bit space (1 MiB) of 256-byte pages, translated through a two-level page table the OS keeps in RAM. Addresses from
// 0x4000_0000 up are devices and are never translated. A translation missing from the TLB is a table walk: two RAM reads, paid by the engine through its
// L2 and DRAM. A translation that cannot be made, or an access the page does not allow, is a page fault: the engine takes it precisely (the faulting
// instruction has done nothing, everything older has finished, everything younger is gone), the MMU leaves translation off for the OS, and `iret`
// goes back to the faulting instruction with translation on again.
//
//   virtual address: [ level 1 index (6) | level 2 index (6) | offset (8) ]
//   table entry:     bit 0 valid, bit 1 write, bit 2 execute, bits 8.. the frame (the physical address of the page or of the next table >> 8)
//
// A CPU without an MMU has `tlbEntries` 0: the unit is on the bus but cannot be switched on.

import { MMU_BASE, MMU_REG, MMU_SIZE, DEVICE_BASE, PteBit, VmFault } from "../isa/memmap";
import type { Device } from "./device";

export const VA_BITS = 20;
export const PAGE_BYTES = 256;

export class Mmu implements Device {
  readonly name = "mmu";
  readonly base = MMU_BASE;
  readonly size = MMU_SIZE;

  /** TLB entries (0: this CPU has no MMU). Set when the CPU is installed. */
  tlbEntries = 0;
  /** Translation is on (the OS switches it on to run a program; a trap or an interrupt switches it off). */
  enabled = false;
  /** Told when the page table register is written (a new address space). */
  onSpace?: (table: number) => void;
  /** Translation was on when the CPU last entered the OS: `iret` turns it back on. */
  private saved = false;
  /** Physical address of the level 1 table. */
  table = 0;
  /** Where the CPU goes on a page fault. */
  vector = 0;
  cause = 0;
  faultAddr = 0;
  /** Faults taken, TLB hits and misses since power-on. */
  faults = 0;
  hits = 0;
  misses = 0;

  // TLB: virtual page number, the entry's flags, frame, last use.
  private tVpn: Int32Array = new Int32Array(0);
  private tFlags: Uint8Array = new Uint8Array(0);
  private tFrame: Int32Array = new Int32Array(0);
  private tUsed: Float64Array = new Float64Array(0);
  private useClock = 0;

  /** Results of the last `lookup`: the physical address, whether the TLB had it, the table reads the walk needed (physical addresses), and the slot the entry sits in. */
  pa = 0;
  hit = false;
  walkN = 0;
  readonly walkAt = [0, 0];
  slot = -1;

  constructor(private readonly ram: Uint8Array) {}

  configure(tlbEntries: number): void {
    if (tlbEntries === this.tlbEntries && this.tVpn.length === tlbEntries) return;
    this.tlbEntries = tlbEntries;
    this.tVpn = new Int32Array(tlbEntries).fill(-1);
    this.tFlags = new Uint8Array(tlbEntries);
    this.tFrame = new Int32Array(tlbEntries);
    this.tUsed = new Float64Array(tlbEntries);
    if (tlbEntries === 0) this.enabled = false;
  }

  reset(): void {
    this.enabled = false;
    this.saved = false;
    this.table = this.vector = this.cause = this.faultAddr = this.faults = this.hits = this.misses = 0;
    this.flush();
  }

  flush(): void {
    this.tVpn.fill(-1);
    this.useClock = 0;
  }

  /** The TLB as the die shows it: the virtual page and the frame of every entry (-1: empty). */
  dump(): { vpn: number[]; frame: number[] } {
    return { vpn: Array.from(this.tVpn), frame: Array.from(this.tFrame, (f, i) => (this.tVpn[i]! < 0 ? -1 : f)) };
  }

  /** Entering the OS (a trap or an interrupt): translation off, remembered. */
  enterKernel(): void {
    if (this.enabled) { this.saved = true; this.enabled = false; }
  }

  /** `iret`: back to the program, with translation on if it was. */
  leaveKernel(): void {
    if (this.saved && this.tlbEntries > 0) this.enabled = true;
    this.saved = false;
  }

  private word(pa: number): number {
    const r = this.ram;
    return pa + 4 <= r.length ? (r[pa]! | (r[pa + 1]! << 8) | (r[pa + 2]! << 16) | (r[pa + 3]! << 24)) >>> 0 : 0;
  }

  /**
   * Translate virtual address `va` for a read (write = false), a write, or an instruction fetch (exec). Returns 0 and sets `pa`, or a `VmFault` code.
   * Addresses at or above DEVICE_BASE pass unchanged. The TLB changes only on a successful walk; the walk's table reads are in `walkAt` (`walkN` of them).
   */
  lookup(va: number, write: boolean, exec: boolean): number {
    this.hit = true;
    this.walkN = 0;
    this.slot = -1;
    if (va >= DEVICE_BASE) { this.pa = va; return 0; }
    if (va >>> VA_BITS !== 0) return VmFault.Range;
    const vpn = va >>> 8;
    let flags = 0, frame = 0;
    const n = this.tlbEntries;
    for (let i = 0; i < n; i++) {
      if (this.tVpn[i] === vpn) { flags = this.tFlags[i]!; frame = this.tFrame[i]!; this.slot = i; this.tUsed[i] = ++this.useClock; break; }
    }
    if (this.slot < 0) {
      this.hit = false;
      const l1 = (this.table + ((va >>> 14) & 63) * 4) >>> 0;
      this.walkAt[0] = l1; this.walkN = 1;
      const e1 = this.word(l1);
      if (!(e1 & PteBit.Valid)) return VmFault.NotPresent;
      const l2 = ((e1 >>> 8) * 256 + ((va >>> 8) & 63) * 4) >>> 0;
      this.walkAt[1] = l2; this.walkN = 2;
      const e2 = this.word(l2);
      if (!(e2 & PteBit.Valid)) return VmFault.NotPresent;
      flags = e2 & 0xff;
      frame = e2 >>> 8;
      // fill: an empty entry, else the least recently used
      let v = 0, best = Infinity;
      for (let i = 0; i < n; i++) {
        if (this.tVpn[i]! < 0) { v = i; best = -1; break; }
        if (this.tUsed[i]! < best) { best = this.tUsed[i]!; v = i; }
      }
      if (n > 0) { this.tVpn[v] = vpn; this.tFlags[v] = flags; this.tFrame[v] = frame; this.tUsed[v] = ++this.useClock; this.slot = v; }
    }
    if (write && !(flags & PteBit.Write)) return VmFault.Write;
    if (exec && !(flags & PteBit.Exec)) return VmFault.Exec;
    this.pa = (frame * 256 + (va & 255)) >>> 0;
    return 0;
  }

  /** A translation without side effects (the die and the game read it): the physical address of `va`, or -1. */
  peek(va: number): number {
    if (va >= DEVICE_BASE) return va;
    if (va >>> VA_BITS !== 0) return -1;
    const e1 = this.word((this.table + ((va >>> 14) & 63) * 4) >>> 0);
    if (!(e1 & PteBit.Valid)) return -1;
    const e2 = this.word(((e1 >>> 8) * 256 + ((va >>> 8) & 63) * 4) >>> 0);
    return e2 & PteBit.Valid ? ((e2 >>> 8) * 256 + (va & 255)) >>> 0 : -1;
  }

  /** A fault is taken: record it for the OS. */
  recordFault(cause: number, va: number): void {
    this.cause = cause;
    this.faultAddr = va >>> 0;
    this.faults++;
  }

  private reg(off: number): number {
    switch (off) {
      case MMU_REG.STATUS: return (this.tlbEntries > 0 ? 1 : 0) | (this.enabled ? 2 : 0);
      case MMU_REG.TABLE: return this.table;
      case MMU_REG.VECTOR: return this.vector;
      case MMU_REG.FAULT_ADDR: return this.faultAddr;
      case MMU_REG.FAULT_CAUSE: return this.cause;
      case MMU_REG.TLB_ENTRIES: return this.tlbEntries;
      case MMU_REG.FAULTS: return this.faults;
      default: return 0;
    }
  }

  read(off: number): number {
    return (this.reg(off & ~3) >>> (8 * (off & 3))) & 0xff;
  }

  private bytes = new Map<number, number>();

  write(off: number, val: number): void {
    // a word register is written one byte at a time, low byte first: apply it on the last
    const reg = off & ~3, k = off & 3;
    const next = (((this.bytes.get(reg) ?? 0) & ~(0xff << (8 * k))) | ((val & 0xff) << (8 * k))) >>> 0;
    this.bytes.set(reg, next);
    if (k !== 3) return;
    this.bytes.delete(reg);
    switch (reg) {
      case MMU_REG.CONTROL:
        // bit 0: translation on (ignored without an MMU); bit 1: flush the TLB
        if (this.tlbEntries > 0) { this.enabled = (next & 1) !== 0; if (this.saved) this.saved = this.enabled; }
        if (next & 2) this.flush();
        break;
      case MMU_REG.TABLE: this.table = next; this.flush(); this.onSpace?.(next); break; // a new address space: nothing translated before holds
      case MMU_REG.VECTOR: this.vector = next; break;
    }
  }

  tick(): void {}
}
