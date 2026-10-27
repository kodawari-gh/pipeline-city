// GPU kernels (docs/ACCEL.md "GPU"): assembly for the GPU ISA plus a plain-JS reference of what each computes, so a launch can be
// checked and the CPU fallback prints the same checksum. All sizes are baked in as immediates, so a kernel needs no argument block:
// the CPU copies the input arrays into card memory at KERNEL_LAYOUT, uploads the code at `code`, launches and reads `out` back.
//
// The job is "a batch": vadd and saxpy repeat their arithmetic ROUNDS times per element (unrolled, so both the GPU kernel and the CPU
// loop are straight-line there), blur3 and mandel are heavy per element. Copying the data to the card costs about as much as a few
// rounds on the CPU, so a card pays off by running many lanes of real work, not by adding two arrays once.
//
// Every kernel walks the arrays in chunks of `lanes` elements (lane l of chunk k handles element k*lanes + l) and ends with `halt`.
// Register convention: v0 is only written where a kernel says so; the others are scratch. Integers are 32-bit, fixed point is Q12.

export const GPU_KERNEL_NAMES = ["vadd", "saxpy", "blur3", "mandel"] as const;
/** Every kernel a GPU job can be about: the four the mixed `gpu.render` job picks from, and two more that only their own jobs use (a branch per element, a chain of multiplies). */
export const GPU_TASK_KERNELS = [...GPU_KERNEL_NAMES, "thresh", "poly"] as const;
export type GpuKernelName = (typeof GPU_TASK_KERNELS)[number];

/** Byte addresses in card memory. Arrays hold up to `maxLen` words. */
import { TPM_BASE, TPM_REG } from "../isa/memmap";
import type { Kernel } from "./kernels";

/** Unrolled repeats of the arithmetic in vadd and saxpy. */
export const ROUNDS = 12;
/** poly: the degree of the polynomial, one multiply and one add per power. thresh: the level a value has to reach, and what it becomes. */
export const POLY_ROUNDS = 8;
export const THRESH = { level: 500, high: 100 } as const;

export const KERNEL_LAYOUT = { code: 0, a: 0x200, b: 0x600, out: 0xa00, maxLen: 256 } as const;

export interface GpuKernelParams {
  /** Lanes of the card the kernel runs on. */
  lanes: number;
  /** Elements to process: a multiple of `lanes`, at most `KERNEL_LAYOUT.maxLen`. */
  len: number;
  /** saxpy: the scale. */
  scale?: number;
}

/** mandel: points along one row of the plane, `1 << logW` of them, wrapping every that many elements; Q12 window start `xMin`, step `dx`, imaginary part `cy`. */
export const MANDEL = { logW: 5, xMin: -2 * 4096, dx: 3 * 4096 / 32 | 0, cy: Math.round(0.35 * 4096), maxIter: 16 } as const;

function check(p: GpuKernelParams): void {
  if (!Number.isInteger(p.lanes) || p.lanes < 1 || p.lanes > 32) throw new RangeError(`lanes ${p.lanes}`);
  if (!Number.isInteger(p.len) || p.len < p.lanes || p.len % p.lanes !== 0 || p.len > KERNEL_LAYOUT.maxLen) throw new RangeError(`len ${p.len}`);
}

const A = KERNEL_LAYOUT.a, B = KERNEL_LAYOUT.b, OUT = KERNEL_LAYOUT.out;

/** The kernel's assembly (GPU ISA). */
export function gpuKernelSource(name: GpuKernelName, p: GpuKernelParams): string {
  check(p);
  const n = p.lanes, len = p.len;
  switch (name) {
    case "vadd": // out[i] = a[i] + ROUNDS * b[i]
      return `
        lane v1
        mpush
      loop:
        vslli v2, v1, 2
        vld v3, ${A}(v2)
        vld v4, ${B}(v2)
${"        vadd v3, v3, v4\n".repeat(ROUNDS)}        vst v3, ${OUT}(v2)
        vaddi v1, v1, ${n}
        vli v5, ${len}
        msetlt v1, v5
        bany loop
        mpop
        halt`;
    case "saxpy": // out[i] = b[i] + ROUNDS * (scale * a[i])
      return `
        lane v1
        vli v6, ${p.scale ?? 3}
        mpush
      loop:
        vslli v2, v1, 2
        vld v3, ${A}(v2)
        vld v4, ${B}(v2)
        vmul v5, v3, v6
        vmv v3, v4
${"        vadd v3, v3, v5\n".repeat(ROUNDS)}        vst v3, ${OUT}(v2)
        vaddi v1, v1, ${n}
        vli v5, ${len}
        msetlt v1, v5
        bany loop
        mpop
        halt`;
    case "blur3": // out[i] = (a[i-1] + a[i] + a[i+1]) / 3, the first and last element reusing their own value: the edge lanes diverge
      return `
        lane v1
        vli v7, ${len}
        mpush
      loop:
        vslli v2, v1, 2
        vld v5, ${A}(v2)
        vld v4, ${A - 4}(v2)
        vld v6, ${A + 4}(v2)
        mpush
        mseteq v1, v0
        vmv v4, v5
        mpop
        mpush
        vaddi v3, v7, -1
        mseteq v1, v3
        vmv v6, v5
        mpop
        vadd v4, v4, v5
        vadd v4, v4, v6
        vli v3, 21846
        vmul v4, v4, v3
        vsrli v4, v4, 16
        vst v4, ${OUT}(v2)
        vaddi v1, v1, ${n}
        msetlt v1, v7
        bany loop
        mpop
        halt`;
    case "thresh": // out[i] = a[i] >= level ? high : 0: an if and an else under the mask
      return `
        lane v1
        vli v7, ${len}
        vli v5, ${THRESH.level}
        mpush
      loop:
        vslli v2, v1, 2
        vld v3, ${A}(v2)
        mpush
        msetge v3, v5
        vli v4, ${THRESH.high}
        melse
        vli v4, 0
        mpop
        vst v4, ${OUT}(v2)
        vaddi v1, v1, ${n}
        msetlt v1, v7
        bany loop
        mpop
        halt`;
    case "poly": // out[i] = b + a * (b + a * (...)), POLY_ROUNDS times: a chain where each multiply needs the one before
      return `
        lane v1
        vli v7, ${len}
        mpush
      loop:
        vslli v2, v1, 2
        vld v3, ${A}(v2)
        vld v4, ${B}(v2)
        vmv v5, v4
${"        vmul v5, v5, v3\n        vadd v5, v5, v4\n".repeat(POLY_ROUNDS)}        vst v5, ${OUT}(v2)
        vaddi v1, v1, ${n}
        msetlt v1, v7
        bany loop
        mpop
        halt`;
    case "mandel": { // out[i] = escape iterations of c = (xMin + i * dx, cy): lanes leave the inner loop at different times
      const m = MANDEL;
      return `
        lane v0
        vslli v0, v0, 8
        vli v7, 0
        mpush
      outer:
        vsrli v1, v0, 8
        vandi v1, v1, ${(1 << m.logW) - 1}
        vli v6, ${m.dx}
        vmul v1, v1, v6
        vaddi v1, v1, ${m.xMin}
        vli v2, 0
        vli v3, 0
        mpush
      inner:
        vmul v4, v2, v2
        vsrai v4, v4, 12
        vmul v5, v3, v3
        vsrai v5, v5, 12
        vadd v6, v4, v5
        vsrli v6, v6, 14
        mseteq v6, v7
        vmul v3, v2, v3
        vsrai v3, v3, 11
        vaddi v3, v3, ${m.cy}
        vsub v2, v4, v5
        vadd v2, v2, v1
        vaddi v0, v0, 1
        vandi v6, v0, 255
        vli v4, ${m.maxIter}
        msetlt v6, v4
        bany inner
        mpop
        vsrli v6, v0, 8
        vslli v5, v6, 2
        vandi v4, v0, 255
        vst v4, ${OUT}(v5)
        vaddi v6, v6, ${n}
        vslli v0, v6, 8
        vli v4, ${len}
        msetlt v6, v4
        bany outer
        mpop
        halt`;
    }
  }
}

/** The input arrays a kernel reads, from a seed-free formula (a small deterministic pattern the CPU fallback also uses). */
export function kernelInputs(len: number, seed: number): { a: number[]; b: number[] } {
  let s = seed >>> 0 || 1;
  const next = (): number => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 16) % 1000; };
  return { a: Array.from({ length: len }, next), b: Array.from({ length: len }, next) };
}

/** What the kernel computes, in plain JS (the same integer arithmetic). */
export function gpuKernelExpected(name: GpuKernelName, p: GpuKernelParams, a: readonly number[], b: readonly number[]): number[] {
  check(p);
  const out: number[] = [];
  for (let i = 0; i < p.len; i++) {
    switch (name) {
      case "vadd": out.push((a[i]! + Math.imul(ROUNDS, b[i]!)) | 0); break;
      case "saxpy": out.push((b[i]! + Math.imul(ROUNDS, Math.imul(a[i]!, p.scale ?? 3))) | 0); break;
      case "blur3": {
        const l = i === 0 ? a[i]! : a[i - 1]!, r = i === p.len - 1 ? a[i]! : a[i + 1]!;
        out.push(Math.imul(l + a[i]! + r, 21846) >>> 16);
        break;
      }
      case "mandel": out.push(mandelCount(i)); break;
      case "thresh": out.push(a[i]! >= THRESH.level ? THRESH.high : 0); break;
      case "poly": {
        let r = b[i]!;
        for (let k = 0; k < POLY_ROUNDS; k++) r = (Math.imul(r, a[i]!) + b[i]!) | 0;
        out.push(r);
        break;
      }
    }
  }
  return out;
}

/** Escape count of point i, with the kernel's exact fixed-point steps. */
export function mandelCount(i: number): number {
  const m = MANDEL;
  const cx = Math.imul(i & ((1 << m.logW) - 1), m.dx) + m.xMin | 0;
  let zr = 0, zi = 0, count = 0;
  for (;;) {
    const zr2 = Math.imul(zr, zr) >> 12, zi2 = Math.imul(zi, zi) >> 12;
    if ((zr2 + zi2) >>> 14 !== 0) return count; // escaped before this step
    zi = (Math.imul(zr, zi) >> 11) + m.cy | 0;
    zr = zr2 - zi2 + cx | 0;
    count++;
    if (count >= m.maxIter) return count;
  }
}

/** What the job prints: the sum of the output words, low 6 bits. */
export function outputChecksum(xs: readonly number[]): number {
  let h = 0;
  for (const x of xs) h = (h + x) | 0;
  return h & 63;
}

// ---------- the same kernels on the CPU (the job's path when no card is installed) ----------

const kernel = (name: string, ns: string, mix: Kernel["mix"], body: string[]): Kernel =>
  ({ name, ns, mix, footprintBytes: 0, asm: [`${ns}:`, ...body.map((l) => `  ${l}`)].join("\n") });

/**
 * The CPU version of a kernel, a leaf following the kernel call convention (kernels.ts). vadd, saxpy, blur3: a0 = input a, a1 = input b,
 * a2 = output, a3 = element count. mandel: a0 = output, the count is baked in. blur3 reads one guard word on each side of `a`.
 */
export function cpuKernel(name: GpuKernelName, ns: string, p: GpuKernelParams): Kernel {
  switch (name) {
    case "vadd":
      return kernel("gpu_vadd", ns, ["mem", "alu", "branch"], [
        `${ns}_i:`, "lw t0, 0(a0)", "lw t1, 0(a1)", ...Array<string>(ROUNDS).fill("add t0, t0, t1"),
        "sw t0, 0(a2)", "addi a0, a0, 4", "addi a1, a1, 4", "addi a2, a2, 4", "addi a3, a3, -1", `bne a3, zero, ${ns}_i`, "ret",
      ]);
    case "saxpy":
      return kernel("gpu_saxpy", ns, ["mem", "mul", "alu", "branch"], [
        `li t3, ${p.scale ?? 3}`, `${ns}_i:`, "lw t0, 0(a0)", "lw t1, 0(a1)", "mul t0, t0, t3", ...Array<string>(ROUNDS).fill("add t1, t1, t0"),
        "sw t1, 0(a2)", "addi a0, a0, 4", "addi a1, a1, 4", "addi a2, a2, 4", "addi a3, a3, -1", `bne a3, zero, ${ns}_i`, "ret",
      ]);
    case "blur3":
      return kernel("gpu_blur3", ns, ["mem", "mul", "alu", "branch"], [
        "li t3, 21846", `${ns}_i:`, "lw t0, -4(a0)", "lw t1, 0(a0)", "lw t2, 4(a0)", "add t0, t0, t1", "add t0, t0, t2", "mul t0, t0, t3", "srli t0, t0, 16",
        "sw t0, 0(a2)", "addi a0, a0, 4", "addi a2, a2, 4", "addi a3, a3, -1", `bne a3, zero, ${ns}_i`, "ret",
      ]);
    case "thresh":
      return kernel("gpu_thresh", ns, ["mem", "alu", "branch"], [
        `li t3, ${THRESH.level}`, `${ns}_i:`, "lw t0, 0(a0)", "li t1, 0", `blt t0, t3, ${ns}_s`, `li t1, ${THRESH.high}`,
        `${ns}_s:`, "sw t1, 0(a2)", "addi a0, a0, 4", "addi a2, a2, 4", "addi a3, a3, -1", `bne a3, zero, ${ns}_i`, "ret",
      ]);
    case "poly":
      return kernel("gpu_poly", ns, ["mem", "mul", "alu", "branch"], [
        `${ns}_i:`, "lw t0, 0(a0)", "lw t1, 0(a1)", "mv t2, t1", ...Array.from({ length: POLY_ROUNDS }).flatMap(() => ["mul t2, t2, t0", "add t2, t2, t1"]),
        "sw t2, 0(a2)", "addi a0, a0, 4", "addi a1, a1, 4", "addi a2, a2, 4", "addi a3, a3, -1", `bne a3, zero, ${ns}_i`, "ret",
      ]);
    case "mandel": {
      const m = MANDEL;
      return kernel("gpu_mandel", ns, ["mem", "mul", "alu", "branch"], [
        "li a1, 0",
        `${ns}_o:`, `andi t0, a1, ${(1 << m.logW) - 1}`, `li t4, ${m.dx}`, "mul t0, t0, t4", `li t4, ${m.xMin}`, "add t0, t0, t4",
        "li t1, 0", "li t2, 0", "li t3, 0",
        `${ns}_n:`, "mul t4, t1, t1", "srai t4, t4, 12", "mul a3, t2, t2", "srai a3, a3, 12",
        "add a2, t4, a3", "srli a2, a2, 14", `bne a2, zero, ${ns}_d`,
        "mul t2, t1, t2", "srai t2, t2, 11", `addi t2, t2, ${m.cy}`, "sub t1, t4, a3", "add t1, t1, t0",
        "addi t3, t3, 1", `li a2, ${m.maxIter}`, `bne t3, a2, ${ns}_n`,
        `${ns}_d:`, "sw t3, 0(a0)", "addi a0, a0, 4", "addi a1, a1, 1", `li a2, ${p.len}`, `bne a1, a2, ${ns}_o`, "ret",
      ]);
    }
  }
}

/** tpm_cmd(cmd = a0, arg0 = a1, arg1 = a2): write the TPM registers, start the command, poll until it is done, return RESULT in a0. */
export function tpmCommand(ns: string): Kernel {
  return kernel("tpm_cmd", ns, ["io", "branch", "alu"], [
    `li t0, ${TPM_BASE}`, `sw a1, ${TPM_REG.ARG0}(t0)`, `sw a2, ${TPM_REG.ARG1}(t0)`, `sw a0, ${TPM_REG.CMD}(t0)`,
    `${ns}_poll:`, `lw t1, ${TPM_REG.STATUS}(t0)`, "andi t1, t1, 1", `bne t1, zero, ${ns}_poll`,
    `lw a0, ${TPM_REG.RESULT}(t0)`, "ret",
  ]);
}

/**
 * copy_words(dst = a0, src = a1, bytes = a2, a multiple of 16, >= 16): a word copy, four words a turn, used to fill card memory through
 * the bus window. Callers round the size up (`roundUp16`); the few extra bytes read and written are harmless.
 */
export function copyWords(ns: string): Kernel {
  return kernel("gpu_copy", ns, ["mem", "alu", "branch"], [
    `${ns}_loop:`, "lw t0, 0(a1)", "lw t1, 4(a1)", "lw t2, 8(a1)", "lw t3, 12(a1)", "sw t0, 0(a0)", "sw t1, 4(a0)", "sw t2, 8(a0)", "sw t3, 12(a0)",
    "addi a0, a0, 16", "addi a1, a1, 16", "addi a2, a2, -16", `bne a2, zero, ${ns}_loop`, "ret",
  ]);
}

/** Bytes rounded up to the 16 `copyWords` moves at a time. */
export const roundUp16 = (n: number): number => (n + 15) & ~15;
