// The "inference" job's pieces (docs/ACCEL.md "Job classes"): a small network of dense layers, X <- relu(W X + b), on an 8 x 8 batch,
// and three ways to run it: as NPU descriptors, as a GPU kernel launched once per layer, or as a CPU loop. All three compute the same
// numbers; `networkExpected` is the plain-JS answer. Matrices are int32, row-major unless a function says tile-major.

import { assembleGpu } from "../../gpu/sim/asm";
import { NPU_DESC_WORDS, NPU_LAYER_WORDS, NpuOp } from "@/core/sim/memmap";
import { Prng } from "@/core/sim/prng";
import type { Kernel } from "../../jobs/sim/gen/kernels";

/** The batch and the layers are `M` x `M`. A grid of 4 or 8 divides it. */
export const M = 8;

export interface Network {
  layers: number;
  /** x0[i * M + j]: the input batch, column j is one example. */
  x0: number[];
  /** w[l][i * M + k]. */
  w: number[][];
  /** b[l][i]: one bias per output row. */
  b: number[][];
}

/** A seeded network with small weights, so the numbers stay well inside 32 bits. */
export function makeNetwork(rng: Prng, layers: number): Network {
  const small = (span: number) => rng.nextInt(2 * span + 1) - span;
  return {
    layers,
    x0: Array.from({ length: M * M }, () => small(3)),
    w: Array.from({ length: layers }, () => Array.from({ length: M * M }, () => small(2))),
    b: Array.from({ length: layers }, () => Array.from({ length: M }, () => small(8))),
  };
}

/** The activations after each layer; the last one is the answer. */
export function networkExpected(n: Network): number[] {
  let x = n.x0;
  for (let l = 0; l < n.layers; l++) {
    const out = new Array<number>(M * M);
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < M; j++) {
        let s = n.b[l]![i]!;
        for (let k = 0; k < M; k++) s = (s + Math.imul(n.w[l]![i * M + k]!, x[k * M + j]!)) | 0;
        out[i * M + j] = Math.max(0, s);
      }
    }
    x = out;
  }
  return x;
}

/** What the job prints: the sum of the final activations, low 6 bits. */
export const networkChecksum = (n: Network): number => networkExpected(n).reduce((s, v) => (s + v) | 0, 0) & 63;

// ---------- NPU path: one Layer descriptor per layer ----------

/** Card memory plan for the NPU path (byte addresses). Row-major, like the other paths. */
export const NPU_LAYOUT = { x: [0x0, 0x100] as const, w: 0x200, b: 0x800, desc: 0x900 } as const;

/**
 * The NPU's whole program: `layers` Layer descriptors (4 words each) followed by their parameter blocks (NPU_LAYER_WORDS each), as
 * one word list to copy to NPU_LAYOUT.desc. The activations ping-pong between the two buffers; the last layer's output is `finalAt`.
 */
export function npuProgram(n: Network): { words: number[]; count: number; finalAt: number } {
  const words: number[] = [];
  const blockAt = (l: number) => NPU_LAYOUT.desc + n.layers * NPU_DESC_WORDS * 4 + l * NPU_LAYER_WORDS * 4;
  for (let l = 0; l < n.layers; l++) words.push(NpuOp.Layer, blockAt(l), 0, 0);
  for (let l = 0; l < n.layers; l++) {
    words.push(NPU_LAYOUT.w + l * M * M * 4, NPU_LAYOUT.x[l % 2]!, NPU_LAYOUT.x[(l + 1) % 2]!, NPU_LAYOUT.b + l * M * 4, M, 1);
  }
  return { words, count: n.layers, finalAt: NPU_LAYOUT.x[n.layers % 2]! };
}

/** Bytes of card memory the NPU path needs. */
export const npuBytes = (n: Network): number => NPU_LAYOUT.desc + 4 * npuProgram(n).words.length;

// ---------- GPU path: one kernel, one launch per layer ----------

/** Card memory plan for the GPU path: 4 argument words just under the arrays, code below them. */
export const GPU_NET_LAYOUT = { args: 0x1f0, x: [0x200, 0x300] as const, w: 0x400, b: 0xa00 } as const;

/** The layer kernel: reads W, X, OUT and bias addresses from the argument words, so one upload serves every layer. */
export function gpuLayerSource(lanes: number): string {
  const A = GPU_NET_LAYOUT.args;
  let k = "";
  for (let i = 0; i < M; i++) k += `        vld v5, ${4 * i}(v2)\n        vld v6, ${32 * i}(v3)\n        vmul v5, v5, v6\n        vadd v4, v4, v5\n`;
  return `
        lane v1
        mpush
      loop:
        vld v5, ${A}(v0)
        vld v6, ${A + 4}(v0)
        vsrli v2, v1, 3
        vslli v2, v2, 5
        vadd v2, v2, v5
        vandi v3, v1, 7
        vslli v3, v3, 2
        vadd v3, v3, v6
        vli v4, 0
${k}        vsrli v5, v1, 3
        vslli v5, v5, 2
        vld v6, ${A + 12}(v0)
        vadd v5, v5, v6
        vld v5, 0(v5)
        vadd v4, v4, v5
        vmax v4, v4, v0
        vld v6, ${A + 8}(v0)
        vslli v5, v1, 2
        vadd v5, v5, v6
        vst v4, 0(v5)
        vaddi v1, v1, ${lanes}
        vli v5, ${M * M}
        msetlt v1, v5
        bany loop
        mpop
        halt`;
}

export const gpuLayerCode = (lanes: number): Uint32Array => assembleGpu(gpuLayerSource(lanes)).program;

// ---------- CPU path ----------

/** cpu_layer(W = a0, X = a1, OUT = a2, bias = a3): one dense layer with relu, row-major. */
export function cpuLayer(ns: string): Kernel {
  const body: string[] = ["li t4, 8", `${ns}_i:`, "mv t3, a1", `${ns}_j:`, "li t0, 0"];
  for (let k = 0; k < M; k++) body.push(`lw t2, ${4 * k}(a0)`, `lw t1, ${32 * k}(t3)`, "mul t2, t2, t1", "add t0, t0, t2");
  body.push(
    "lw t1, 0(a3)", "add t0, t0, t1", `bge t0, zero, ${ns}_p`, "li t0, 0", `${ns}_p:`, "sw t0, 0(a2)", "addi a2, a2, 4",
    "addi t3, t3, 4", "addi t1, a1, 32", `bne t3, t1, ${ns}_j`,
    "addi a0, a0, 32", "addi a3, a3, 4", "addi t4, t4, -1", `bne t4, zero, ${ns}_i`, "ret",
  );
  return { name: "npu_layer", ns, mix: ["mem", "mul", "alu", "branch"], footprintBytes: 0, asm: [`${ns}:`, ...body.map((l) => `  ${l}`)].join("\n") };
}
