// GPU kernels (docs/ACCEL.md "GPU"): assembly for the GPU ISA plus a plain-JS reference of what each computes, so a launch can be
// checked and the CPU fallback prints the same checksum. All sizes are baked in as immediates, so a kernel needs no argument block:
// the CPU copies the input arrays into card memory at KERNEL_LAYOUT, uploads the code at `code`, launches and reads `out` back.
//
// Every kernel walks the arrays in chunks of `lanes` elements (lane l of chunk k handles element k*lanes + l) and ends with `halt`.
// Register convention: v0 is only written where a kernel says so; the others are scratch. Integers are 32-bit, fixed point is Q12.

export const GPU_KERNEL_NAMES = ["vadd", "saxpy", "blur3", "mandel"] as const;
export type GpuKernelName = (typeof GPU_KERNEL_NAMES)[number];

/** Byte addresses in card memory. Arrays hold up to `maxLen` words. */
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
export const MANDEL = { logW: 5, xMin: -2 * 4096, dx: 3 * 4096 / 32 | 0, cy: Math.round(0.35 * 4096), maxIter: 48 } as const;

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
    case "vadd": // out[i] = a[i] + b[i]
      return `
        lane v1
        mpush
      loop:
        vslli v2, v1, 2
        vld v3, ${A}(v2)
        vld v4, ${B}(v2)
        vadd v3, v3, v4
        vst v3, ${OUT}(v2)
        vaddi v1, v1, ${n}
        vli v5, ${len}
        msetlt v1, v5
        bany loop
        mpop
        halt`;
    case "saxpy": // out[i] = scale * a[i] + b[i]
      return `
        lane v1
        vli v6, ${p.scale ?? 3}
        mpush
      loop:
        vslli v2, v1, 2
        vld v3, ${A}(v2)
        vld v4, ${B}(v2)
        vmul v3, v3, v6
        vadd v3, v3, v4
        vst v3, ${OUT}(v2)
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
      case "vadd": out.push((a[i]! + b[i]!) | 0); break;
      case "saxpy": out.push((Math.imul(a[i]!, p.scale ?? 3) + b[i]!) | 0); break;
      case "blur3": {
        const l = i === 0 ? a[i]! : a[i - 1]!, r = i === p.len - 1 ? a[i]! : a[i + 1]!;
        out.push(Math.imul(l + a[i]! + r, 21846) >>> 16);
        break;
      }
      case "mandel": out.push(mandelCount(i)); break;
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

/** A cheap checksum of an output array (what the job prints). */
export function arrayChecksum(xs: readonly number[]): number {
  let h = 0;
  for (const x of xs) h = (Math.imul(h, 31) + x) & 0xffff;
  return h;
}
