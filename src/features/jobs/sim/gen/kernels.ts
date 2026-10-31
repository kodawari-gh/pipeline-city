// Kernel library: small assembly subroutines following the call convention in docs/ISA.md.
//
// Convention: args in a0..a3, result in a0, return with `ret` (link register ra).
// Kernels may clobber a0-a3 and t0-t4; they preserve s0-s3, sp and ra's caller state (they are leaves, so
// they never touch the stack). Every kernel takes a label namespace `ns`: its entry label is `ns` and all
// internal labels are `ns_*`, so any set of kernels composes without collisions.

import { STATUS_BASE } from "@/core/sim/memmap";

/** Instruction-mix tags, for the economy and the fast model. */
export type Mix = "alu" | "mul" | "mem" | "branch" | "io";

export interface Kernel {
  /** Kernel kind, e.g. "print_dec". */
  name: string;
  /** Label namespace; also the entry label. */
  ns: string;
  /** Rough instruction-mix tags. */
  mix: Mix[];
  /** Static memory the kernel touches (display bytes, status words); runtime-sized regions are added by the template. */
  footprintBytes: number;
  /** Function text: entry label, body, `ret`. */
  asm: string;
}

export function k(name: string, ns: string, mix: Mix[], footprintBytes: number, body: string[]): Kernel {
  return { name, ns, mix, footprintBytes, asm: [`${ns}:`, ...body.map((l) => `  ${l}`)].join("\n") };
}

/**
 * Print `a1` as exactly `width` zero-padded decimal digits at byte address `a0`; returns a0 + width.
 * Needs 0 <= a1 < 10^width and a1 <= 1028 at every division step (divide by 10 is `(n*205)>>11`).
 */
export function printDec(ns: string, width: number): Kernel {
  if (!Number.isInteger(width) || width < 2 || width > 4) throw new RangeError(`printDec width ${width}`);
  const body = ["li t0, 205", "li t4, 10"];
  let cur = "a1"; // register holding the remaining quotient
  for (let i = width - 1; i >= 1; i--) {
    const q = cur === "t1" ? "t2" : "t1";
    body.push(
      `mul ${q}, ${cur}, t0`,
      `srli ${q}, ${q}, 11`, // q = n / 10
      `mul t3, ${q}, t4`,
      `sub t3, ${cur}, t3`, // r = n - 10q
      "addi t3, t3, 48",
      `sb t3, ${i}(a0)`,
    );
    cur = q;
  }
  body.push(`addi ${cur}, ${cur}, 48`, `sb ${cur}, 0(a0)`, `addi a0, a0, ${width}`, "ret");
  return k("print_dec", ns, ["mul", "alu", "mem", "io"], width, body);
}

/** Copy the NUL-terminated string at a1 to a0 (stores go to the display when a0 is a display address). Returns a0 = end. */
export function printStr(ns: string): Kernel {
  return k("print_str", ns, ["mem", "branch", "io"], 0, [
    `${ns}_loop:`,
    "lbu t0, 0(a1)",
    `beq t0, zero, ${ns}_done`,
    "sb t0, 0(a0)",
    "addi a0, a0, 1",
    "addi a1, a1, 1",
    `j ${ns}_loop`,
    `${ns}_done:`,
    "ret",
  ]);
}

/** memcpy(dst=a0, src=a1, n=a2 bytes, n >= 1). Returns a0 = dst + n. */
export function memcpy(ns: string): Kernel {
  return k("memcpy", ns, ["mem", "alu", "branch"], 0, [
    `${ns}_loop:`,
    "lbu t0, 0(a1)",
    "sb t0, 0(a0)",
    "addi a0, a0, 1",
    "addi a1, a1, 1",
    "addi a2, a2, -1",
    `bne a2, zero, ${ns}_loop`,
    "ret",
  ]);
}

/** Word hash over a2 words at a1 (a2 >= 1): h = h*33 ^ w, from 5381. Result in a0. alu + mem, no multiplier. */
export function checksum(ns: string): Kernel {
  return k("checksum", ns, ["mem", "alu", "branch"], 0, [
    "li a0, 5381",
    `${ns}_loop:`,
    "lw t1, 0(a1)",
    "slli t2, a0, 5",
    "add a0, a0, t2",
    "xor a0, a0, t1",
    "addi a1, a1, 4",
    "addi a2, a2, -1",
    `bne a2, zero, ${ns}_loop`,
    "ret",
  ]);
}

/**
 * Sum a1 words starting at a0, `strideBytes` apart (multiple of 4). Result in a0.
 * Stride below the cache line (16 B) is cache-friendly; a multiple of the cache size (128 B) is hostile.
 */
export function arraySum(ns: string, strideBytes: number): Kernel {
  checkStride(strideBytes);
  return k("array_sum", ns, ["mem", "alu", "branch"], 0, [
    "li t0, 0",
    `${ns}_loop:`,
    "lw t1, 0(a0)",
    "add t0, t0, t1",
    `addi a0, a0, ${strideBytes}`,
    "addi a1, a1, -1",
    `bne a1, zero, ${ns}_loop`,
    "mv a0, t0",
    "ret",
  ]);
}

/** Store a1 words `strideBytes` apart from a0: values a2, a2+3, a2+6, ... (the producer for arraySum). */
export function fillStride(ns: string, strideBytes: number): Kernel {
  checkStride(strideBytes);
  return k("fill_stride", ns, ["mem", "alu", "branch"], 0, [
    `${ns}_loop:`,
    "sw a2, 0(a0)",
    "addi a2, a2, 3",
    `addi a0, a0, ${strideBytes}`,
    "addi a1, a1, -1",
    `bne a1, zero, ${ns}_loop`,
    "ret",
  ]);
}

/**
 * The table of the in-memory index job: store a value in the first word of each of the a1 rows (256 bytes each, a page) from a0: row i holds i*7 + 3.
 * Touching one word per row touches every page, so the job claims its whole table.
 */
export function indexFill(ns: string): Kernel {
  return k("index_fill", ns, ["mem", "alu", "branch"], 0, [
    "li t0, 3",
    `${ns}_loop:`,
    "sw t0, 0(a0)",
    "addi t0, t0, 7",
    "addi a0, a0, 256",
    "addi a1, a1, -1",
    `bne a1, zero, ${ns}_loop`,
    "ret",
  ]);
}

/**
 * Point lookups into that table: a2 probes, probe j reads row (j * a3) mod a1 (a1 is a power of two, a3 odd, so the reads scatter over the whole table and
 * hit every page, row and bank). Returns the sum of what it read in a0.
 */
export function indexProbe(ns: string): Kernel {
  return k("index_probe", ns, ["mem", "mul", "alu", "branch"], 0, [
    "addi t3, a1, -1", // the mask
    "li t0, 0", // the sum
    "li t1, 0", // j
    `${ns}_loop:`,
    "mul t2, t1, a3",
    "and t2, t2, t3",
    "slli t2, t2, 8",
    "add t2, t2, a0",
    "lw t4, 0(t2)",
    "add t0, t0, t4",
    "addi t1, t1, 1",
    `bne t1, a2, ${ns}_loop`,
    "mv a0, t0",
    "ret",
  ]);
}

/** a1 rounds (>= 1) of x = x*mul + add starting from x = a0 (wraps at 32 bits). Result in a0. */
export function mulLoop(ns: string, mul: number, add: number): Kernel {
  return k("mul_loop", ns, ["mul", "alu", "branch"], 0, [
    `li t0, ${mul}`,
    `${ns}_loop:`,
    "mul a0, a0, t0",
    `addi a0, a0, ${add}`,
    "addi a1, a1, -1",
    `bne a1, zero, ${ns}_loop`,
    "ret",
  ]);
}

/**
 * Spin while the status word at STATUS_BASE + offset has any bit of `mask` set (a busy flag), then return.
 * Status is plain storage today, so it reads 0 and falls through after one poll; a real device can hold it busy.
 */
export function pollIdle(ns: string, offset = 0, mask = 1): Kernel {
  return k("poll_idle", ns, ["io", "branch", "alu"], 4, [
    `li t0, ${STATUS_BASE}`,
    `${ns}_loop:`,
    `lw t1, ${offset}(t0)`,
    `andi t1, t1, ${mask}`,
    `bne t1, zero, ${ns}_loop`,
    "ret",
  ]);
}

function checkStride(s: number): void {
  if (!Number.isInteger(s) || s < 4 || s % 4 !== 0 || s > 4096) throw new RangeError(`stride ${s}`);
}
