// Trivial functional reference interpreter: one instruction per step, no timing.
// Ground truth for the timed engines.

import { decode, REG_COUNT, REG_SP } from "../isa/isa";
import {
  DISPLAY_BASE, DISPLAY_COLS, DISPLAY_ROWS, DISPLAY_SIZE,
  RAM_BASE, RAM_DEFAULT_SIZE, STATUS_BASE, STATUS_SIZE,
} from "../isa/memmap";

import type { Device } from "../machine/device";
import { Prng } from "../machine/prng";
import { TpmPort } from "../machine/tpm";

export class RefFault extends Error {
  constructor(public pc: number, msg: string) {
    super(`pc=0x${pc.toString(16)}: ${msg}`);
    this.name = "RefFault";
  }
}

interface Region {
  base: number;
  bytes: Uint8Array;
  view: DataView;
}

function region(base: number, size: number): Region {
  const bytes = new Uint8Array(size);
  return { base, bytes, view: new DataView(bytes.buffer) };
}

/** Byte-addressable little-endian memory made of RAM, display and device-status regions (all plain storage for now). */
export class RefMemory {
  readonly ram: Region;
  readonly display: Region;
  readonly status: Region;
  private readonly regions: Region[];
  /** Devices with behaviour (byte access through `read` / `write`). The reference has one: an instant TPM, so a job that talks to the TPM runs here. */
  private readonly devices: Device[] = [];

  constructor(ramSize = RAM_DEFAULT_SIZE) {
    this.ram = region(RAM_BASE, ramSize);
    this.display = region(DISPLAY_BASE, DISPLAY_SIZE);
    this.status = region(STATUS_BASE, STATUS_SIZE);
    this.regions = [this.ram, this.display, this.status];
    const tpm = new TpmPort(null, this.ram.bytes, new Prng(1), true);
    tpm.configure({ measureTicks: 0, attestTicks: 0, surcharge: 0 });
    this.devices.push(tpm);
  }

  private device(addr: number, n: number): Device | null {
    for (const d of this.devices) if (addr >= d.base && addr + n <= d.base + d.size) return d;
    return null;
  }

  private find(addr: number, n: number): Region | null {
    for (const r of this.regions) {
      const o = addr - r.base;
      if (o >= 0 && o + n <= r.bytes.length) return r;
    }
    return null;
  }

  /** Throws RangeError for unmapped or (word) misaligned addresses; callers wrap it into a fault. */
  load8(addr: number): number {
    const r = this.find(addr, 1);
    if (!r) {
      const d = this.device(addr, 1);
      if (d) return d.read(addr - d.base);
      throw new RangeError(`load8 from unmapped address 0x${addr.toString(16)}`);
    }
    return r.bytes[addr - r.base]!;
  }
  load32(addr: number): number {
    if (addr % 4 !== 0) throw new RangeError(`misaligned word access at 0x${addr.toString(16)}`);
    const r = this.find(addr, 4);
    if (!r) {
      const d = this.device(addr, 4);
      if (d) return (d.read(addr - d.base) | (d.read(addr - d.base + 1) << 8) | (d.read(addr - d.base + 2) << 16) | (d.read(addr - d.base + 3) << 24)) >>> 0;
      throw new RangeError(`load32 from unmapped address 0x${addr.toString(16)}`);
    }
    return r.view.getUint32(addr - r.base, true);
  }
  store8(addr: number, v: number): void {
    const r = this.find(addr, 1);
    if (!r) {
      const d = this.device(addr, 1);
      if (d) return d.write(addr - d.base, v & 0xff);
      throw new RangeError(`store8 to unmapped address 0x${addr.toString(16)}`);
    }
    r.bytes[addr - r.base] = v & 0xff;
  }
  store32(addr: number, v: number): void {
    if (addr % 4 !== 0) throw new RangeError(`misaligned word access at 0x${addr.toString(16)}`);
    const r = this.find(addr, 4);
    if (!r) {
      const d = this.device(addr, 4);
      if (d) {
        for (let k = 0; k < 4; k++) d.write(addr - d.base + k, (v >>> (8 * k)) & 0xff);
        return;
      }
      throw new RangeError(`store32 to unmapped address 0x${addr.toString(16)}`);
    }
    r.view.setUint32(addr - r.base, v >>> 0, true);
  }

  loadWords(addr: number, words: Uint32Array): void {
    words.forEach((w, k) => this.store32(addr + 4 * k, w));
  }

  /** Display contents as rows of text (trailing NULs/spaces trimmed, trailing empty rows dropped). */
  displayText(): string {
    const rows: string[] = [];
    for (let y = 0; y < DISPLAY_ROWS; y++) {
      let s = "";
      for (let x = 0; x < DISPLAY_COLS; x++) {
        const b = this.display.bytes[y * DISPLAY_COLS + x]!;
        s += b === 0 ? " " : String.fromCharCode(b);
      }
      rows.push(s.trimEnd());
    }
    while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
    return rows.join("\n");
  }
}

export class RefCpu {
  /** Registers as signed 32-bit; x0 is kept at 0. */
  readonly regs = new Int32Array(REG_COUNT);
  pc = RAM_BASE;
  halted = false;
  steps = 0;
  readonly mem: RefMemory;
  /** Interrupt controller hook for `iret` (set by the machine's RefEngine; a bare RefCpu has none). */
  intc: { epc: number; leave(): void } | null = null;

  constructor(mem: RefMemory = new RefMemory()) {
    this.mem = mem;
    // Stack starts at the top of RAM and grows down.
    this.regs[REG_SP] = (mem.ram.base + mem.ram.bytes.length) | 0;
  }

  /** Load a program at `addr` (default RAM_BASE) and point the PC at it. */
  load(program: Uint32Array, addr = RAM_BASE): void {
    this.mem.loadWords(addr, program);
    this.pc = addr;
  }

  /** Execute one instruction. No-op once halted. */
  step(): void {
    if (this.halted) return;
    const pc = this.pc;
    try {
      this.exec(pc);
    } catch (e) {
      if (e instanceof RangeError) throw new RefFault(pc, e.message);
      throw e;
    }
    this.steps++;
  }

  /** Run until ecall; throws RefFault if maxSteps is exceeded. Returns instructions executed. */
  run(maxSteps = 1_000_000): number {
    const start = this.steps;
    while (!this.halted) {
      if (this.steps - start >= maxSteps) throw new RefFault(this.pc, `exceeded ${maxSteps} steps`);
      this.step();
    }
    return this.steps - start;
  }

  private exec(pc: number): void {
    const i = decode(this.mem.load32(pc));
    if (!i) throw new RefFault(pc, `illegal instruction 0x${this.mem.load32(pc).toString(16)}`);
    const R = this.regs;
    const a = R[i.rs1]!;
    const b = R[i.rs2]!;
    let next = (pc + 4) >>> 0;
    let res: number | null = null; // value to write to rd

    switch (i.name) {
      case "add": res = a + b; break;
      case "sub": res = a - b; break;
      case "and": res = a & b; break;
      case "or": res = a | b; break;
      case "xor": res = a ^ b; break;
      case "sll": res = a << (b & 31); break;
      case "srl": res = a >>> (b & 31); break;
      case "sra": res = a >> (b & 31); break;
      case "slt": res = a < b ? 1 : 0; break;
      case "sltu": res = a >>> 0 < b >>> 0 ? 1 : 0; break;
      case "mul": res = Math.imul(a, b); break;
      case "addi": res = a + i.imm; break;
      case "andi": res = a & i.imm; break;
      case "ori": res = a | i.imm; break;
      case "xori": res = a ^ i.imm; break;
      case "slli": res = a << i.imm; break;
      case "srli": res = a >>> i.imm; break;
      case "srai": res = a >> i.imm; break;
      case "slti": res = a < i.imm ? 1 : 0; break;
      case "sltiu": res = a >>> 0 < i.imm >>> 0 ? 1 : 0; break;
      case "lw": res = this.mem.load32((a + i.imm) >>> 0); break;
      case "lb": res = (this.mem.load8((a + i.imm) >>> 0) << 24) >> 24; break;
      case "lbu": res = this.mem.load8((a + i.imm) >>> 0); break;
      case "sw": this.mem.store32((a + i.imm) >>> 0, b); break;
      case "sb": this.mem.store8((a + i.imm) >>> 0, b); break;
      case "beq": if (a === b) next = (pc + i.imm) >>> 0; break;
      case "bne": if (a !== b) next = (pc + i.imm) >>> 0; break;
      case "blt": if (a < b) next = (pc + i.imm) >>> 0; break;
      case "bge": if (a >= b) next = (pc + i.imm) >>> 0; break;
      case "bltu": if (a >>> 0 < b >>> 0) next = (pc + i.imm) >>> 0; break;
      case "bgeu": if (a >>> 0 >= b >>> 0) next = (pc + i.imm) >>> 0; break;
      case "lui": res = i.imm << 11; break;
      case "auipc": res = pc + (i.imm << 11); break;
      case "jal": res = pc + 4; next = (pc + i.imm) >>> 0; break;
      case "jalr": res = pc + 4; next = ((a + i.imm) & ~3) >>> 0; break;
      case "ecall": this.halted = true; break;
      case "iret":
        if (!this.intc) throw new RefFault(pc, "iret without an interrupt controller");
        next = this.intc.epc >>> 0;
        this.intc.leave();
        break;
      default: throw new RefFault(pc, `unimplemented '${i.name}'`);
    }
    if (res !== null && i.rd !== 0) R[i.rd] = res; // Int32Array wraps to 32 bits
    this.pc = next;
  }
}
