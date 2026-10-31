// The GPU jobs (docs/ACCEL.md "GPU"): every one draws a 64 x 40 picture (16:10) on the graphics display, several frames of it. The scene is made by a small
// integer shader from the element number alone (no input arrays, so a picture is 10 KB of card memory and fits the smallest card), then the job's own step
// is applied to it: brightness (`vadd`), contrast (`saxpy`), blur (`blur3`), a threshold mask (`thresh`), a tone curve (`poly`). `mandel` and `sphere` are
// the shaders themselves. Each kernel exists three times that must agree: the GPU assembly, the CPU twin (the job's path with no card) and the plain-JS
// `pixel` here. A frame is one launch; the program sets the two parameter words (`phase`: how far the scene has moved, `level`: the job's own number) before it.
//
// Every kernel walks the picture in chunks of `lanes` elements (lane l of chunk k handles element k*lanes + l) and ends with `halt`.
// Register convention: v1 is the element index; fixed point is Q12; pixel values are 0..255 (what the display scales to).

import type { Kernel } from "../../jobs/sim/gen/kernels";

export const GPU_KERNEL_NAMES = ["vadd", "saxpy", "blur3", "mandel"] as const;
/** Every kernel a GPU job can be about: the four the mixed `gpu.render` job picks from, and three more that only their own jobs use. */
export const GPU_TASK_KERNELS = [...GPU_KERNEL_NAMES, "thresh", "poly", "sphere"] as const;
export type GpuKernelName = (typeof GPU_TASK_KERNELS)[number];

/** The picture: 64 x 40 words, 16:10. */
export const PICTURE_COLS = 64;
export const PICTURE_ROWS = 40;
export const PICTURE_LEN = PICTURE_COLS * PICTURE_ROWS;
/** Byte addresses in card memory: the code, the two parameter words (phase, level), the picture (to 0x3000, inside the smallest card's 16K). */
export const KERNEL_LAYOUT = { code: 0, param: 0x700, out: 0x800, maxPicture: PICTURE_LEN } as const;
/** Where the CPU twins find the same two words in RAM (below the thread sync page, above the scan buffer the picture uses). */
export const CPU_PARAM = 0x7000;

export interface GpuKernelParams {
  /** Lanes of the card the kernel runs on. */
  lanes: number;
  /** Elements to draw: a multiple of `lanes`, at most `PICTURE_LEN`. */
  len: number;
  /** How far the scene has moved (the card kernels read it from `param`, the CPU twins from `CPU_PARAM`). */
  phase?: number;
  /** The job's own number for this frame: brightness, gain, blur width, threshold, curve, iteration budget. */
  level?: number;
}

// ---------- the animation: frames, and what changes from one to the next ----------

/** Frames of a job: a request of scale 1 shows two, the others four. */
export const framesOf = (scale: number): number => (scale < 2 ? 2 : 4);
/** The level of each of four frames, a sweep of the job's own number. */
const LEVELS: Record<GpuKernelName, readonly number[]> = {
  vadd: [-60, -20, 20, 60], saxpy: [8, 12, 18, 24], blur3: [1, 2, 3, 4], thresh: [60, 90, 120, 150], poly: [0, 80, 160, 240], mandel: [3, 6, 10, 15], sphere: [0, 0, 0, 0],
};
/** Frame `k` of `frames`: the scene moves a whole loop over the frames (the plasma repeats every 64, the checker of a ball every 16) and the level sweeps. */
export function frameParams(name: GpuKernelName, phase0: number, k: number, frames: number): { phase: number; level: number } {
  const loop = name === "sphere" ? 16 : 64;
  return { phase: phase0 + (loop / frames) * k, level: LEVELS[name][frames === 4 ? k : k * 3]! };
}

// ---------- the scene and the shaders, in plain JS ----------

const tri = (a: number): number => Math.abs((a & 63) - 32);
/** The scene the image jobs work on, 0..192: three moving triangle waves, a plasma. */
export function scene(i: number, phase: number): number {
  const x = i & 63, y = i >> 6;
  return 2 * (tri(2 * y - phase) + tri(3 * x + phase) + tri(x + y + 2 * phase));
}

/** mandel: Q12 window, real part from `xMin` in steps of `dx`, imaginary part from `yMin` in steps of `dy` (the rows are centred on the real axis, off it by half a step). */
export const MANDEL = { xMin: -2 * 4096, dx: 192, yMin: -20 * 192 + 96, dy: 192 } as const;

/** Escape count of point i within `maxIter` rounds, with the kernel's exact fixed-point steps. */
export function mandelCount(i: number, maxIter: number): number {
  const m = MANDEL;
  const cx = Math.imul(i & 63, m.dx) + m.xMin | 0;
  const cy = Math.imul(i >> 6, m.dy) + m.yMin | 0;
  let zr = 0, zi = 0, count = 0;
  for (;;) {
    const zr2 = Math.imul(zr, zr) >> 12, zi2 = Math.imul(zi, zi) >> 12;
    if ((zr2 + zi2) >>> 14 !== 0) return count; // escaped before this step
    zi = (Math.imul(zr, zi) >> 11) + cy | 0;
    zr = zr2 - zi2 + cx | 0;
    count++;
    if (count >= maxIter) return count;
  }
}

/**
 * sphere: eight shaded balls, two bands of four (each 16 columns by 20 rows). A point's place on its ball is (x, y) in half cells, -15..15; it is on the ball
 * when `225 - x*x - y*y` is above 0. `(row * 205) >> 12` is row / 20 without a divide. Mirrors the kernel exactly.
 */
export function ballPixel(i: number, phase: number): number {
  const col = i & 63, r = i >> 6, band = (r * 205) >> 12, row = r - 20 * band;
  const ball = (col >> 4) + 2 * band;
  const x = 2 * (col & 15) - 15, y = ((2 * row - 19) * 205) >> 8;
  const d2 = x * x + y * y, hp = Math.max(225 - d2, 0);
  const s = x + ((x * d2) >> 8) + phase + ball * 21; // the texture slides faster toward the rim, as it does on a sphere
  const chk = ((s >> 3) ^ (y >> 3)) & 1;
  return hp > 0 ? 40 + 36 * chk - x - y + (hp >> 2) : 0; // a checker, lit from the upper left, brightest at the middle
}

const clamp255 = (v: number): number => Math.max(0, Math.min(255, v));

/** One pixel of a frame. */
export function pixel(name: GpuKernelName, i: number, phase: number, level: number): number {
  switch (name) {
    case "vadd": return clamp255(scene(i, phase) + level); // brightness
    case "saxpy": return clamp255(((scene(i, phase) - 96) * level >> 3) + 96); // contrast: gain level/8 around the middle grey
    case "blur3": return Math.imul(scene(i - level, phase) + scene(i, phase) + scene(i + level, phase), 21846) >>> 16; // a box blur `level` wide
    case "thresh": return scene(i, phase) >= level ? 255 : 0; // a mask
    case "poly": { const v = scene(i, phase); return (v * (256 - level) + ((v * v >> 8) * level)) >> 8; } // blend toward the square: darker midtones
    case "mandel": return mandelCount(i, level) << 4;
    case "sphere": return ballPixel(i, phase);
  }
}

function check(p: GpuKernelParams): void {
  if (!Number.isInteger(p.lanes) || p.lanes < 1 || p.lanes > 32) throw new RangeError(`lanes ${p.lanes}`);
  if (!Number.isInteger(p.len) || p.len < p.lanes || p.len % p.lanes !== 0 || p.len > PICTURE_LEN) throw new RangeError(`len ${p.len}`);
}

/** What the kernel computes for one frame, in plain JS (the same integer arithmetic). */
export function gpuKernelExpected(name: GpuKernelName, p: GpuKernelParams): number[] {
  check(p);
  return Array.from({ length: p.len }, (_, i) => pixel(name, i, p.phase ?? 0, p.level ?? 0));
}

// ---------- the shaders on the card ----------

const P = KERNEL_LAYOUT.param, OUT = KERNEL_LAYOUT.out;

/** |z - 32| of the low six bits of `z`, in place (`t` is scratch). */
const gTri = (z: string, t: string): string => `        vandi ${z}, ${z}, 63\n        vaddi ${z}, ${z}, -32\n        vli ${t}, 0\n        vsub ${t}, ${t}, ${z}\n        vmax ${z}, ${z}, ${t}\n`;

/** The scene at element `I` into `S`; v7 holds the phase, `w1..w3` are scratch. */
function gScene(I: string, S: string, w1: string, w2: string, w3: string): string {
  return `        vsrli ${w1}, ${I}, 6
        vslli ${w1}, ${w1}, 1
        vsub ${w1}, ${w1}, v7
${gTri(w1, w2)}        vmv ${S}, ${w1}
        vandi ${w1}, ${I}, 63
        vslli ${w2}, ${w1}, 1
        vadd ${w2}, ${w2}, ${w1}
        vadd ${w2}, ${w2}, v7
${gTri(w2, w3)}        vadd ${S}, ${S}, ${w2}
        vsrli ${w2}, ${I}, 6
        vadd ${w2}, ${w2}, ${w1}
        vadd ${w2}, ${w2}, v7
        vadd ${w2}, ${w2}, v7
${gTri(w2, w3)}        vadd ${S}, ${S}, ${w2}
        vslli ${S}, ${S}, 1
`;
}

const gClamp = (r: string, t: string): string => `        vli ${t}, 0\n        vmax ${r}, ${r}, ${t}\n        vli ${t}, 255\n        vmin ${r}, ${r}, ${t}\n`;

/** The kernel's assembly (GPU ISA) for one frame. */
export function gpuKernelSource(name: GpuKernelName, p: GpuKernelParams): string {
  check(p);
  const n = p.lanes, len = p.len;
  const head = `        lane v1\n        vli v6, 0\n        vld v7, ${P}(v6)\n        mpush\n      loop:\n`;
  const tail = (res: string) => `        vslli v0, v1, 2\n        vst ${res}, ${OUT}(v0)\n        vaddi v1, v1, ${n}\n        vli v2, ${len}\n        msetlt v1, v2\n        bany loop\n        mpop\n        halt`;
  const level = `        vli v6, 0\n        vld v6, ${P + 4}(v6)\n`;
  switch (name) {
    case "vadd": // brightness: scene + level, clamped
      return head + gScene("v1", "v2", "v3", "v4", "v5") + level + `        vadd v2, v2, v6\n` + gClamp("v2", "v3") + tail("v2");
    case "saxpy": // contrast: (scene - 96) * level / 8 + 96, clamped
      return head + gScene("v1", "v2", "v3", "v4", "v5") + level + `        vaddi v2, v2, -96\n        vmul v2, v2, v6\n        vsrai v2, v2, 3\n        vaddi v2, v2, 96\n` + gClamp("v2", "v3") + tail("v2");
    case "thresh": // a mask: an if and an else under the execution mask, so lanes diverge
      return head + gScene("v1", "v2", "v3", "v4", "v5") + level + `        mpush\n        msetge v2, v6\n        vli v4, 255\n        melse\n        vli v4, 0\n        mpop\n` + tail("v4");
    case "poly": // a tone curve: blend of the scene and its square, level/256 toward the square
      return head + gScene("v1", "v2", "v3", "v4", "v5") + level
        + `        vmul v3, v2, v2\n        vsrai v3, v3, 8\n        vmul v3, v3, v6\n        vli v4, 256\n        vsub v4, v4, v6\n        vmul v4, v4, v2\n        vadd v3, v3, v4\n        vsrai v3, v3, 8\n` + tail("v3");
    case "blur3": // a box blur `level` wide: three scenes, the running sum parked in the picture's own word
      return head + level
        + `        vsub v1, v1, v6\n` + gScene("v1", "v2", "v3", "v4", "v5") + `        vadd v1, v1, v6\n        vslli v3, v1, 2\n        vst v2, ${OUT}(v3)\n`
        + gScene("v1", "v2", "v3", "v4", "v5") + `        vslli v3, v1, 2\n        vld v4, ${OUT}(v3)\n        vadd v2, v2, v4\n        vst v2, ${OUT}(v3)\n`
        + `        vadd v1, v1, v6\n` + gScene("v1", "v2", "v3", "v4", "v5") + `        vsub v1, v1, v6\n        vslli v3, v1, 2\n        vld v4, ${OUT}(v3)\n        vadd v2, v2, v4\n        vli v4, 21846\n        vmul v2, v2, v4\n        vsrli v2, v2, 16\n`
        + tail("v2");
    case "sphere": { // eight lit, checkered balls; every lane runs the same straight-line code
      return `
        lane v1
        mpush
      loop:
        vandi v2, v1, 15
        vslli v2, v2, 1
        vaddi v2, v2, -15
        vsrli v3, v1, 6
        vli v7, 205
        vmul v4, v3, v7
        vsrli v4, v4, 12
        vli v7, 20
        vmul v5, v4, v7
        vsub v3, v3, v5
        vslli v3, v3, 1
        vaddi v3, v3, -19
        vli v7, 205
        vmul v3, v3, v7
        vsrai v3, v3, 8
        vmul v4, v2, v2
        vmul v5, v3, v3
        vadd v4, v4, v5
        vmul v5, v2, v4
        vsrai v5, v5, 8
        vadd v5, v5, v2
        vsrli v6, v1, 6
        vli v7, 205
        vmul v6, v6, v7
        vsrli v6, v6, 12
        vslli v6, v6, 1
        vsrli v7, v1, 4
        vandi v7, v7, 3
        vadd v6, v6, v7
        vli v7, 21
        vmul v6, v6, v7
        vadd v5, v5, v6
        vli v6, 0
        vld v7, ${P}(v6)
        vadd v5, v5, v7
        vsrai v5, v5, 3
        vsrai v6, v3, 3
        vxor v5, v5, v6
        vandi v5, v5, 1
        vli v7, 36
        vmul v5, v5, v7
        vsub v5, v5, v2
        vsub v5, v5, v3
        vaddi v5, v5, 40
        vli v6, 225
        vsub v6, v6, v4
        vli v7, 0
        vmax v6, v6, v7
        vsrli v4, v6, 2
        vadd v5, v5, v4
        vli v7, 1
        vmin v6, v6, v7
        vmul v5, v5, v6
        vslli v2, v1, 2
        vst v5, ${OUT}(v2)
        vaddi v1, v1, ${n}
        vli v5, ${len}
        msetlt v1, v5
        bany loop
        mpop
        halt`;
    }
    case "mandel": // escape iterations of c = (xMin + col * dx, yMin + row * dy), at most `level`: lanes leave the inner loop at different times
      return `
        lane v0
        vslli v0, v0, 8
        vli v7, 0
        mpush
      outer:
        vsrli v1, v0, 8
        vandi v1, v1, 63
        vli v6, ${MANDEL.dx}
        vmul v1, v1, v6
        vaddi v1, v1, ${MANDEL.xMin}
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
        vsrli v6, v0, 14
        vslli v6, v6, 6
        vadd v3, v3, v6
        vslli v6, v6, 1
        vadd v3, v3, v6
        vaddi v3, v3, ${MANDEL.yMin}
        vsub v2, v4, v5
        vadd v2, v2, v1
        vaddi v0, v0, 1
        vandi v6, v0, 255
        vli v4, 0
        vld v4, ${P + 4}(v4)
        msetlt v6, v4
        bany inner
        mpop
        vsrli v6, v0, 8
        vslli v5, v6, 2
        vandi v4, v0, 255
        vslli v4, v4, 4
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

/** A checksum of a frame: what the CPU fallback and the card must both reach. */
export function outputChecksum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s = (s + x) | 0;
  return s & 63;
}

// ---------- the same kernels on the CPU (the job's path when no card is installed) ----------

const kernel = (name: string, ns: string, mix: Kernel["mix"], body: string[]): Kernel =>
  ({ name, ns, mix, footprintBytes: 0, asm: [`${ns}:`, ...body.map((l) => `  ${l}`)].join("\n") });

const cTri = (z: string): string[] => [`andi ${z}, ${z}, 63`, `addi ${z}, ${z}, -32`, `srai t4, ${z}, 31`, `xor ${z}, ${z}, t4`, `sub ${z}, ${z}, t4`];
/** The scene at element `I` into `S`; a2 holds the phase; t0, t1 and t4 are scratch. */
function cScene(I: string, S: string): string[] {
  return [
    `srli t0, ${I}, 6`, "slli t0, t0, 1", "sub t0, t0, a2", ...cTri("t0"), `mv ${S}, t0`,
    `andi t1, ${I}, 63`, "slli t0, t1, 1", "add t0, t0, t1", "add t0, t0, a2", ...cTri("t0"), `add ${S}, ${S}, t0`,
    `srli t0, ${I}, 6`, "add t0, t0, t1", "add t0, t0, a2", "add t0, t0, a2", ...cTri("t0"), `add ${S}, ${S}, t0`,
    `slli ${S}, ${S}, 1`,
  ];
}
const cClamp = (r: string, ns: string): string[] => [`bge ${r}, zero, ${ns}_c0`, `li ${r}, 0`, `${ns}_c0:`, "li t0, 255", `bge t0, ${r}, ${ns}_c1`, `mv ${r}, t0`, `${ns}_c1:`];

/**
 * The CPU version of a kernel, a leaf following the kernel call convention (kernels.ts): a0 = the output, the count is baked in, the phase and the level
 * are read from the two words at `CPU_PARAM`. It clobbers only a0-a3 and t0-t4.
 */
export function cpuKernel(name: GpuKernelName, ns: string, p: GpuKernelParams): Kernel {
  const loadParams = ["li t0, " + CPU_PARAM, "lw a2, 0(t0)", "lw a3, 4(t0)", "li a1, 0"];
  const next = [`sw t3, 0(a0)`, "addi a0, a0, 4", "addi a1, a1, 1", `li t0, ${p.len}`, `bne a1, t0, ${ns}_o`, "ret"];
  switch (name) {
    case "vadd": return kernel("gpu_vadd", ns, ["mem", "alu", "branch"], [...loadParams, `${ns}_o:`, ...cScene("a1", "t3"), "add t3, t3, a3", ...cClamp("t3", ns), ...next]);
    case "saxpy": return kernel("gpu_saxpy", ns, ["mem", "mul", "alu", "branch"], [...loadParams, `${ns}_o:`, ...cScene("a1", "t3"), "addi t3, t3, -96", "mul t3, t3, a3", "srai t3, t3, 3", "addi t3, t3, 96", ...cClamp("t3", ns), ...next]);
    case "thresh": return kernel("gpu_thresh", ns, ["mem", "alu", "branch"], [...loadParams, `${ns}_o:`, ...cScene("a1", "t3"), "li t2, 0", `blt t3, a3, ${ns}_s`, "li t2, 255", `${ns}_s:`, "mv t3, t2", ...next]);
    case "poly": return kernel("gpu_poly", ns, ["mem", "mul", "alu", "branch"], [
      ...loadParams, `${ns}_o:`, ...cScene("a1", "t3"),
      "mul t2, t3, t3", "srai t2, t2, 8", "mul t2, t2, a3", "li t1, 256", "sub t1, t1, a3", "mul t1, t1, t3", "add t3, t2, t1", "srai t3, t3, 8", ...next]);
    case "blur3": return kernel("gpu_blur3", ns, ["mem", "mul", "alu", "branch"], [
      ...loadParams, `${ns}_o:`,
      "sub t2, a1, a3", ...cScene("t2", "t3"), "sw t3, 0(a0)",
      ...cScene("a1", "t3"), "lw t2, 0(a0)", "add t3, t3, t2", "sw t3, 0(a0)",
      "add t2, a1, a3", ...cScene("t2", "t3"), "lw t2, 0(a0)", "add t3, t3, t2", "li t2, 21846", "mul t3, t3, t2", "srli t3, t3, 16", ...next]);
    case "sphere": return kernel("gpu_sphere", ns, ["mem", "mul", "alu", "branch"], [
      "li t0, " + CPU_PARAM, "lw a3, 0(t0)", "li a1, 0",
      `${ns}_o:`, "andi t0, a1, 15", "slli t0, t0, 1", "addi t0, t0, -15",
      "srli t1, a1, 6", "li a2, 205", "mul t4, t1, a2", "srli t4, t4, 12", "li a2, 20", "mul a2, t4, a2", "sub t1, t1, a2", "slli t1, t1, 1", "addi t1, t1, -19", "li a2, 205", "mul t1, t1, a2", "srai t1, t1, 8",
      "mul t2, t0, t0", "mul a2, t1, t1", "add t2, t2, a2",
      "mul t3, t0, t2", "srai t3, t3, 8", "add t3, t3, t0",
      "srli t4, a1, 6", "li a2, 205", "mul t4, t4, a2", "srli t4, t4, 12", "slli t4, t4, 1", "srli a2, a1, 4", "andi a2, a2, 3", "add t4, t4, a2", "li a2, 21", "mul t4, t4, a2", "add t3, t3, t4", "add t3, t3, a3",
      "srai t3, t3, 3", "srai t4, t1, 3", "xor t3, t3, t4", "andi t3, t3, 1", "li a2, 36", "mul t3, t3, a2",
      "sub t3, t3, t0", "sub t3, t3, t1", "addi t3, t3, 40",
      "li a2, 225", "sub a2, a2, t2", `bge zero, a2, ${ns}_z`, "srli a2, a2, 2", "add t3, t3, a2", `beq zero, zero, ${ns}_s`,
      `${ns}_z:`, "li t3, 0",
      `${ns}_s:`, "sw t3, 0(a0)", "addi a0, a0, 4", "addi a1, a1, 1", `li a2, ${p.len}`, `bne a1, a2, ${ns}_o`, "ret",
    ]);
    case "mandel": return kernel("gpu_mandel", ns, ["mem", "mul", "alu", "branch"], [
      "li a1, 0",
      `${ns}_o:`, "andi t0, a1, 63", `li t4, ${MANDEL.dx}`, "mul t0, t0, t4", `li t4, ${MANDEL.xMin}`, "add t0, t0, t4",
      "li t1, 0", "li t2, 0", "li t3, 0",
      `${ns}_n:`, "mul t4, t1, t1", "srai t4, t4, 12", "mul a3, t2, t2", "srai a3, a3, 12",
      "add a2, t4, a3", "srli a2, a2, 14", `bne a2, zero, ${ns}_d`,
      "mul t2, t1, t2", "srai t2, t2, 11", "srli a2, a1, 6", "slli a2, a2, 6", "add t2, t2, a2", "slli a2, a2, 1", "add t2, t2, a2", `addi t2, t2, ${MANDEL.yMin}`, "sub t1, t4, a3", "add t1, t1, t0",
      "addi t3, t3, 1", `li a2, ${CPU_PARAM + 4}`, "lw a2, 0(a2)", `bne t3, a2, ${ns}_n`,
      `${ns}_d:`, "slli t3, t3, 4", "sw t3, 0(a0)", "addi a0, a0, 4", "addi a1, a1, 1", `li a2, ${p.len}`, `bne a1, a2, ${ns}_o`, "ret",
    ]);
  }
}

/** tpm_cmd, copy_words and roundUp16 stay in gpukernels.ts with the other helpers the GPU jobs share. */
