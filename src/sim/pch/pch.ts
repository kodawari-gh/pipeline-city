// The PCH device: USB host controller registers and key windows, display control and POST progress, all memory
// mapped on the bus (memmap.ts has the offsets). The boot ROM image lives in rom.ts. See docs/ASSEMBLY.md.

import {
  PCH_BASE, PCH_KEY_WINDOW, PCH_KEY_WINDOW_SIZE, PCH_REG, PCH_RESULT_WINDOW, PCH_RESULT_WORDS, PCH_SIZE, PchPhase,
} from "../isa/memmap";
import type { Device } from "../machine/device";
import type { Display } from "../machine/display";

/** A USB key as the controller sees it: the program to load and the result the ROM wrote back. */
export interface PchKey {
  /** The client's job number (what the kernel files the job under). */
  id: number;
  program: Uint32Array;
  /** The ROM wrote DONE: the key holds a result. */
  done: boolean;
  /** Result text read back from the result window (valid once done). */
  result: string;
}

const RESULT_BYTES = PCH_RESULT_WORDS * 4;

export class Pch implements Device {
  readonly name = "pch";
  readonly base = PCH_BASE;
  readonly size = PCH_SIZE;

  /** Plugged key, or null. */
  key: PchKey | null = null;
  /** Value of the PHASE register (the ROM writes it). */
  phase: number = PchPhase.Off;
  /** POST progress mark written by the ROM (0..4). */
  progress = 0;
  /** Words of the key program the CPU has read so far (loading progress). */
  wordsRead = 0;
  /** Hardware facts the ROM reads during POST (set by the game at power-on). */
  ramKB = 0;
  cpuTier = 0;
  /** Base address of the storage port that holds a bootable OS, or 0 (set by the game at power-on). */
  bootDev = 0;
  /** The ROM handed over to the kernel. */
  osMode = false;
  /** USB latency in base ticks (the game sets these when an OS is installed; 0 = instant, the key-per-boot flow). */
  enumTicks = 0;
  flashTicks = 0;
  /** The plugged key has finished enumerating (the kernel only touches ready keys). */
  ready = true;
  /** A result is being flashed onto the plugged key. */
  flashing = false;

  /** The key was pulled since the ROM last acknowledged (so a quick unplug and replug is not missed). */
  private removed = false;
  private enumLeft = 0;
  private flashLeft = 0;
  private flashText = "";
  private resultLen = 0;
  private readonly result = new Uint8Array(RESULT_BYTES);

  constructor(private readonly display: Display) {}

  /** Power-on reset: registers cleared, hardware phase = posting. Does not touch the key. */
  powerOn(ramKB: number, cpuTier: number): void {
    this.ramKB = ramKB;
    this.cpuTier = cpuTier;
    this.phase = PchPhase.Posting;
    this.progress = 0;
    this.wordsRead = 0;
    this.resultLen = 0;
    this.removed = false;
    this.osMode = false;
    this.flashing = false;
    this.flashLeft = 0;
    this.result.fill(0);
  }

  powerOff(): void {
    this.phase = PchPhase.Off;
    this.progress = 0;
    this.wordsRead = 0;
  }

  plug(key: PchKey): void {
    this.key = key;
    this.wordsRead = 0;
    this.enumLeft = this.enumTicks;
    this.ready = this.enumTicks <= 0;
    this.flashing = false;
    this.flashLeft = 0;
  }

  unplug(): void {
    if (this.key) this.removed = true;
    this.key = null;
    this.wordsRead = 0;
    this.ready = true;
    this.flashing = false;
    this.flashLeft = 0;
  }

  /** USB timers, once per base tick: the plugged key finishes enumerating, a flash lands on the key. */
  usbTick(): void {
    if (!this.key) return;
    if (!this.ready && --this.enumLeft <= 0) this.ready = true;
    if (this.flashing && --this.flashLeft <= 0) {
      this.flashing = false;
      this.key.done = true;
      this.key.result = this.flashText;
    }
  }

  private reg(off: number): number {
    switch (off) {
      case PCH_REG.STATUS:
        return (this.key ? 1 : 0) | (this.key?.done ? 2 : 0) | (this.removed ? 4 : 0) | (this.osMode && this.key && this.ready ? 8 : 0) | (this.flashing ? 16 : 0);
      case PCH_REG.BOOT_DEV: return this.bootDev;
      case PCH_REG.OS_MODE: return this.osMode ? 1 : 0;
      case PCH_REG.KEY_ID: return this.key?.id ?? 0;
      case PCH_REG.KEY_LEN: return this.key ? this.key.program.length : 0;
      case PCH_REG.PHASE: return this.phase;
      case PCH_REG.RAM_KB: return this.ramKB;
      case PCH_REG.CPU_TIER: return this.cpuTier;
      case PCH_REG.PROGRESS: return this.progress;
      default: return 0;
    }
  }

  read(addr: number): number {
    if (addr < PCH_KEY_WINDOW) {
      const w = this.reg(addr & ~3);
      return (w >>> (8 * (addr & 3))) & 0xff;
    }
    if (addr < PCH_KEY_WINDOW + PCH_KEY_WINDOW_SIZE) {
      const o = addr - PCH_KEY_WINDOW;
      const word = this.key?.program[o >> 2] ?? 0;
      if ((o & 3) === 0 && this.key && o >> 2 >= this.wordsRead) this.wordsRead = (o >> 2) + 1;
      return (word >>> (8 * (o & 3))) & 0xff;
    }
    return 0;
  }

  write(addr: number, val: number): void {
    // Register effects fire on the low byte of the word (store32 writes bytes 0..3 in order; all values are < 256).
    if (addr < PCH_KEY_WINDOW) {
      if ((addr & 3) !== 0) return;
      switch (addr) {
        case PCH_REG.PHASE: this.phase = val; break;
        case PCH_REG.PROGRESS: this.progress = val; break;
        case PCH_REG.CTRL:
          if (val & 1) this.display.clear();
          if (val & 2) this.removed = false;
          break;
        case PCH_REG.RESULT_LEN: this.resultLen = Math.min(val, PCH_RESULT_WORDS); break;
        case PCH_REG.OS_MODE: this.osMode = (val & 1) !== 0; break;
        case PCH_REG.DONE:
          if (val & 1 && this.key) {
            if (this.flashTicks > 0 && this.osMode) {
              // Under an OS the result takes a while to land on the key; pulling the key meanwhile loses it.
              this.flashing = true;
              this.flashLeft = this.flashTicks;
              this.flashText = this.resultText();
            } else {
              this.key.done = true;
              this.key.result = this.resultText();
            }
          }
          break;
      }
      return;
    }
    const o = addr - PCH_RESULT_WINDOW;
    if (o >= 0 && o < RESULT_BYTES) this.result[o] = val & 0xff;
  }

  tick(): void {}

  /** The text in the result window (up to the first NUL), as the epilogue copied it. */
  private resultText(): string {
    let s = "";
    for (let i = 0; i < this.resultLen * 4; i++) {
      const b = this.result[i]!;
      if (b === 0) break;
      s += String.fromCharCode(b);
    }
    return s.trimEnd();
  }
}
