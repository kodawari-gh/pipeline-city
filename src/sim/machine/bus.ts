import type { Device } from "./device";

/** Routes addresses to RAM (default, at base 0) or to a device range. Unmapped/misaligned access throws RangeError. */
export class Bus {
  readonly devices: Device[] = [];
  private readonly ramView: DataView;

  constructor(private readonly ram: Uint8Array) {
    this.ramView = new DataView(ram.buffer, ram.byteOffset, ram.byteLength);
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

  load8(addr: number): number {
    if (addr < this.ram.length) return this.ram[addr]!;
    const d = this.find(addr, 1);
    return d ? d.read(addr - d.base) : this.unmapped("load8 from", addr);
  }

  store8(addr: number, v: number): void {
    if (addr < this.ram.length) {
      this.ram[addr] = v & 0xff;
      return;
    }
    const d = this.find(addr, 1);
    if (!d) this.unmapped("store8 to", addr);
    d.write(addr - d.base, v & 0xff);
  }

  load32(addr: number): number {
    if (addr % 4 !== 0) throw new RangeError(`misaligned word access at 0x${addr.toString(16)}`);
    if (addr + 4 <= this.ram.length) return this.ramView.getUint32(addr, true);
    const d = this.find(addr, 4);
    if (!d) this.unmapped("load32 from", addr);
    const o = addr - d.base;
    return (d.read(o) | (d.read(o + 1) << 8) | (d.read(o + 2) << 16) | (d.read(o + 3) << 24)) >>> 0;
  }

  store32(addr: number, v: number): void {
    if (addr % 4 !== 0) throw new RangeError(`misaligned word access at 0x${addr.toString(16)}`);
    if (addr + 4 <= this.ram.length) {
      this.ramView.setUint32(addr, v >>> 0, true);
      return;
    }
    const d = this.find(addr, 4);
    if (!d) this.unmapped("store32 to", addr);
    const o = addr - d.base;
    for (let k = 0; k < 4; k++) d.write(o + k, (v >>> (8 * k)) & 0xff);
  }
}
