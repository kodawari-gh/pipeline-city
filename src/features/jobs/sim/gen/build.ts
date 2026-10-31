// What every template is built from: the parameter and result types, the program builder and the helpers that lay a result line out on the display.
// Split from templates.ts so the task files (tasks.*.ts) can share it without importing the registry.

import { DISPLAY_BASE, DISPLAY_COLS, DISPLAY_ROWS } from "@/core/sim/memmap";
import type { Prng } from "@/core/sim/prng";
import type { Kernel } from "./kernels";

export interface GenParams {
  /** Work multiplier (default 1): more log lines, more hash words, more scan elements, more multiply rounds. */
  scale?: number;
  /** Display row where the request's output starts (default 0). */
  row?: number;
  /** Job id shown on the display, 0..99 (default: from the seed). */
  jobId?: number;
  /**
   * Hosted program (a USB key's job): instead of `ecall` it ends by jumping to the boot ROM's done vector, so the
   * ROM epilogue writes the result back to the key. Default false (standalone: ends with ecall, runs on the
   * reference interpreter). The two differ only in that last instruction.
   */
  hosted?: boolean;
  /** A working GPU the job may use (`gpu.render` offloads its kernel to it; without one it runs the same work on the CPU). */
  gpu?: GpuTarget;
  /** A working NPU the job may use (`npu.infer` runs its network on it; without one it falls back to the GPU, then the CPU). */
  npu?: NpuTarget;
}

/** Where an NPU sits on the bus and what it has. */
export interface NpuTarget {
  base: number;
  /** The array is `grid` x `grid`. */
  grid: number;
  memBytes: number;
}

/** Where a card sits on the bus and what it has: the part of the hardware a program may be generated for. */
export interface GpuTarget {
  /** Bus address of the card's window (`GPU_BASE + k * GPU_STRIDE`). */
  base: number;
  lanes: number;
  memBytes: number;
}

/** Where a threaded program keeps its shared words: the arrival counter at the barrier, then one partial result per thread. Inside the heap the OS maps on demand. */
export const THREAD_SYNC = 0x7f00;
export const THREAD_PARTS = 0x7f40;

export interface ResolvedParams {
  scale: number;
  row: number;
  jobId: number;
  gpu?: GpuTarget;
  npu?: NpuTarget;
}

/** What a template returns. */
export interface Built {
  /** Assembly for the whole program (code, kernels, data). */
  asm: string;
  /** Kernels instantiated in the program, with the footprint the template knows about added. */
  kernels: Kernel[];
  /** Display text the program should produce, computed in TypeScript independently of the interpreter. */
  expectedText: string;
  /** Threads the program wants (default 1): it starts with the nop `addi zero, zero, T` and every thread runs it from the entry with a0 = k, a1 = T. */
  threads?: number;
}

export type TemplateFn = (rng: Prng, p: ResolvedParams) => Built;

/** Scratch RAM for templates that need a data buffer (well above any generated code, well below the stack). */
export const BUF_BASE = 0x4000;
/** Hosted programs load at USER_BASE (0x1000), so code must end before the scan buffer at BUF_BASE. */
export const MAX_CODE_BYTES = BUF_BASE - 0x1000;
export const BUF_LIMIT = 0xc000;

// ---------- program builder ----------

export class Builder {
  private n = 0;
  private readonly kernels: Kernel[] = [];
  private readonly body: string[] = [];
  private readonly data: string[] = [];

  /** A fresh label namespace for a kernel or data block. */
  ns(name: string): string {
    return `k${this.n++}_${name}`;
  }
  /** Register a kernel (its function text is appended after main) and return its entry label. `extraFootprint` is the runtime-sized region it touches. */
  add(kernel: Kernel, extraFootprint = 0): string {
    this.kernels.push({ ...kernel, footprintBytes: kernel.footprintBytes + extraFootprint });
    return kernel.ns;
  }
  emit(...lines: string[]): void {
    for (const l of lines) this.body.push(`  ${l}`);
  }
  addData(lines: string[]): void {
    this.data.push(...lines);
  }
  /** `threads` > 1 marks the program as threaded: the first instruction is the nop `addi zero, zero, T` (the OS 4 kernel reads T from it, docs/OS.md). A thread that is done jumps to `thread_end`. */
  finish(header: string, expectedText: string, threads?: number): Built {
    const asm = [
      `# ${header}`,
      "main:",
      ...(threads !== undefined && threads > 1 ? [`  addi zero, zero, ${threads}`] : []),
      ...this.body,
      ...(threads !== undefined ? ["thread_end:"] : []),
      "  ecall",
      "",
      ...this.kernels.map((k) => k.asm + "\n"),
      ...this.data,
      "",
    ].join("\n");
    return { asm, kernels: this.kernels, expectedText, ...(threads !== undefined && threads > 1 ? { threads } : {}) };
  }
}

// ---------- display lines ----------

/** A line is static text plus numeric fields filled in by print_dec at run time. */
export type Seg = string | { dyn: number };

export interface Line {
  bytes: (number | null)[]; // null = filled at run time
  fields: { off: number; width: number }[];
}

export function layoutLine(segs: Seg[]): Line {
  const bytes: (number | null)[] = [];
  const fields: Line["fields"] = [];
  for (const s of segs) {
    if (typeof s === "string") for (const ch of s) bytes.push(ch.charCodeAt(0));
    else {
      fields.push({ off: bytes.length, width: s.dyn });
      for (let i = 0; i < s.dyn; i++) bytes.push(null);
    }
  }
  if (bytes.length > DISPLAY_COLS) throw new RangeError("line too long");
  return { bytes, fields };
}

/** Text of a line with dynamic fields replaced by the given numbers (zero padded). */
export function renderLine(segs: Seg[], values: number[]): string {
  let v = 0;
  return segs.map((s) => (typeof s === "string" ? s : String(values[v++]!).padStart(s.dyn, "0"))).join("");
}

/** Static text goes out as packed word stores (about 3 instructions per 4 characters). Dynamic fields stay 0. */
export function emitStatic(b: Builder, line: Line, rowOff: number): void {
  for (let w = 0; w * 4 < line.bytes.length; w++) {
    let val = 0;
    let any = false;
    for (let i = 0; i < 4; i++) {
      const c = line.bytes[w * 4 + i];
      if (c !== undefined && c !== null) {
        val |= c << (8 * i);
        any = true;
      }
    }
    if (!any) continue;
    b.emit(`li t0, ${val >>> 0}`, `sw t0, ${rowOff + 4 * w}(s0)`);
  }
}

export function rowAddr(row: number): number {
  if (row < 0 || row >= DISPLAY_ROWS) throw new RangeError(`row ${row}`);
  return DISPLAY_BASE + row * DISPLAY_COLS;
}

export function blankRows(row: number): string {
  return "\n".repeat(row);
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
