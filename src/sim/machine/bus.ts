import type { Device } from "./device";
import type { Mpu } from "./mpu";

/** Routes addresses to RAM (default, at base 0) or to a device range. Unmapped/misaligned access throws RangeError. */
export class Bus {
  readonly devices: Device[] = [];
  private readonly ramView: DataView;
  /**
   * Protected mode (the TPM): asked for every access to RAM. Returns the extra CPU cycles the access costs, or -1 to refuse it (a read
   * then gives 0 and a write is dropped). Null = off.
   */
  guard: ((addr: number, write: boolean) => number) | null = null;
  /** True only while the CPU is executing (the machine sets it around the engine's step): the game's own peeks at RAM and the devices' DMA-free reads are never guarded. */
  guardOn = false;
  /** The address space of the core making the access in progress: its page table while translation is on, else -1 (physical: the kernel, or a machine without an MMU). Set by the machine. */
  spaceOf: ((core: number) => number) | null = null;
  /** The physical address `core`'s page table gives virtual address `va` (no side effects), or -1 when unmapped. Set by the machine; the TPM resolves its protected range through it. */
  translate: ((core: number, va: number) => number) | null = null;
  /** The address space the guard belongs to: the one that asked for protected mode. The other cores' accesses (the kernel, other programs) are not its business. */
  guardSpace = -1;
  /** Extra cycles the guard has charged since the machine last collected them. */
  stallCycles = 0;
  /** One flag per 256-byte page of RAM, set by every store the CPU (or the kernel) does; the game reads and clears it to see which pages a program claims. */
  readonly dirty: Uint8Array;
  /** Memory protection: a store the unit denies is dropped and trips it. Null = none. */
  mpu: Mpu | null = null;
  /** The logical core the access in progress comes from; the machine sets it before each core's step, so per-core devices answer per core. */
  core = 0;

  /** Serve core `index`, whose protection unit is `mpu`. */
  serve(index: number, mpu: Mpu): void {
    this.core = index;
    this.mpu = mpu;
  }

  constructor(private readonly ram: Uint8Array) {
    this.ramView = new DataView(ram.buffer, ram.byteOffset, ram.byteLength);
    this.dirty = new Uint8Array((ram.length + 255) >> 8);
  }

  attach(d: Device): void {
    const others = [...this.devices, { name: "ram", base: 0, size: this.ram.length }];
    for (const o of others) {
      if (d.base < o.base + o.size && o.base < d.base + d.size) throw new Error(`device '${d.name}' overlaps '${o.name}'`);
    }
    this.devices.push(d);
  }

  private find(addr: number, n: number): Device | null {
    for (const d of this.devices) {
      const o = addr - d.base;
      if (o >= 0 && o + n <= d.size) return d;
    }
    return null;
  }

  private unmapped(kind: string, addr: number): never {
    throw new RangeError(`${kind} unmapped address 0x${addr.toString(16)}`);
  }

  /** The address space of the core being served (see `spaceOf`). */
  space(): number {
    return this.spaceOf ? this.spaceOf(this.core) : -1;
  }

  /** Run the guard for a RAM access: true if it may go ahead. An access from another address space is not guarded: on a multicore machine the kernel and the other jobs run on during one job's protected mode. */
  private allowed(addr: number, write: boolean): boolean {
    if (this.space() !== this.guardSpace) return true;
    const c = this.guard!(addr, write);
    if (c < 0) return false;
    this.stallCycles += c;
    return true;
  }

  load8(addr: number): number {
    if (addr < this.ram.length) return this.guardOn && this.guard && !this.allowed(addr, false) ? 0 : this.ram[addr]!;
    const d = this.find(addr, 1);
    return d ? d.read(addr - d.base) : this.unmapped("load8 from", addr);
  }

  store8(addr: number, v: number): void {
    if (addr < this.ram.length) {
      if (this.mpu?.denies(addr)) { this.mpu.trip(addr); return; }
      if (this.guardOn && this.guard && !this.allowed(addr, true)) return;
      this.ram[addr] = v & 0xff;
      this.dirty[addr >> 8] = 1;
      return;
    }
    const d = this.find(addr, 1);
    if (!d) this.unmapped("store8 to", addr);
    d.write(addr - d.base, v & 0xff);
  }

  load32(addr: number): number {
    if (addr % 4 !== 0) throw new RangeError(`misaligned word access at 0x${addr.toString(16)}`);
    if (addr + 4 <= this.ram.length) return this.guardOn && this.guard && !this.allowed(addr, false) ? 0 : this.ramView.getUint32(addr, true);
    const d = this.find(addr, 4);
    if (!d) this.unmapped("load32 from", addr);
    const o = addr - d.base;
    return (d.read(o) | (d.read(o + 1) << 8) | (d.read(o + 2) << 16) | (d.read(o + 3) << 24)) >>> 0;
  }

  store32(addr: number, v: number): void {
    if (addr % 4 !== 0) throw new RangeError(`misaligned word access at 0x${addr.toString(16)}`);
    if (addr + 4 <= this.ram.length) {
      if (this.mpu?.denies(addr)) { this.mpu.trip(addr); return; }
      if (this.guardOn && this.guard && !this.allowed(addr, true)) return;
      this.ramView.setUint32(addr, v >>> 0, true);
      this.dirty[addr >> 8] = 1;
      return;
    }
    const d = this.find(addr, 4);
    if (!d) this.unmapped("store32 to", addr);
    const o = addr - d.base;
    for (let k = 0; k < 4; k++) d.write(o + k, (v >>> (8 * k)) & 0xff);
  }
}
