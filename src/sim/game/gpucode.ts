// The GPU side of the almanac's code view (docs/JOBS.md "Reading the code", docs/GPU.md "The kernel"): a graphics job's kernel is GPU assembly the CPU copies
// into card memory, so the listing of the CPU program only shows it as data. Here the kernel is assembled for a card of some lane count and run once on the
// reference card, counting how often each instruction ran. Pure: no sim state, nothing is changed by looking.

import { assembleGpu } from "../asm/gpu";
import { frameParams, framesOf, GPU_TASK_KERNELS, gpuKernelSource, KERNEL_LAYOUT, PICTURE_LEN, type GpuKernelName } from "../gen/gpukernels";
import { gpuDecode, gpuDisassemble } from "../isa/gpu";
import { GpuRef } from "../ref/gpuref";
import type { CodeLine, OpClass } from "./jobcode";

/** The kernel a job template runs on the card (`gpu.blur3` -> `blur3`), or null for a job that has none. */
export const gpuKernelOf = (template: string): GpuKernelName | null => GPU_TASK_KERNELS.find((k) => template === `gpu.${k}`) ?? null;

/** What a GPU instruction is for the listing's colours (the CPU's classes): the multiply, memory, mask and branch instructions stand out from plain arithmetic. */
export function gpuOpClass(name: string): OpClass {
  if (name === "vld") return "ld";
  if (name === "vst") return "st";
  if (name === "vmul") return "mul";
  if (/^(mset|mpush|mpop|melse|bany|jmp)/.test(name)) return "br";
  if (name === "bar" || name === "halt") return "sys";
  return "alu";
}

/**
 * Words of GPU code as listing lines: address, word, the instruction (a branch shows the label it goes to) and the labels at each address. `symbols` are the
 * assembler's names; a branch target without one is named `L` and its address. `counts` (per word) fills how often each instruction ran.
 */
export function gpuListing(words: readonly number[], symbols?: ReadonlyMap<string, number>, counts?: ArrayLike<number>): CodeLine[] {
  const names = new Map<number, string[]>();
  for (const [n, a] of symbols ?? []) { const l = names.get(a) ?? []; l.push(n); names.set(a, l); }
  const target = (k: number, imm: number): number => 4 * k + imm;
  words.forEach((w, k) => {
    const i = gpuDecode(w);
    if (i && (i.name === "bany" || i.name === "jmp")) { const t = target(k, i.imm); if (t >= 0 && t < 4 * words.length && !names.has(t)) names.set(t, [`L${t.toString(16)}`]); }
  });
  return words.map((w, k) => {
    const i = gpuDecode(w);
    let text = gpuDisassemble(w);
    if (i && (i.name === "bany" || i.name === "jmp")) { const t = names.get(target(k, i.imm)); if (t) text = `${i.name} ${t[0]}`; }
    return { addr: 4 * k, word: w >>> 0, text, cls: i ? gpuOpClass(i.name) : "alu", count: counts?.[k] ?? 0, labels: names.get(4 * k) ?? [] };
  });
}

/** One kernel for one lane count: its assembly, the listing with the counts of one frame, and what the frame did. */
export interface GpuKernelProfile {
  kernel: GpuKernelName;
  lanes: number;
  /** The assembly source the generator wrote. */
  asm: string;
  lines: CodeLine[];
  /** Instructions run in one frame, by class. */
  mix: Record<OpClass, number>;
  instructions: number;
  /** Lane slots that did work, 0..1: below 1 where lanes sat out a branch. */
  laneUse: number;
}

const cache = new Map<string, GpuKernelProfile | null>();

/** Assemble the kernel of `template` for `lanes` lanes and run its first frame on the reference card, counting what each instruction does. Null when the job has no kernel. */
export function gpuKernelProfile(template: string, lanes: number): GpuKernelProfile | null {
  const kernel = gpuKernelOf(template);
  if (!kernel) return null;
  const key = `${kernel}|${lanes}`;
  if (cache.has(key)) return cache.get(key)!;
  const asm = gpuKernelSource(kernel, { lanes, len: PICTURE_LEN });
  const { program, symbols } = assembleGpu(asm);
  const ref = new GpuRef({ lanes, banks: Math.max(1, lanes >> 3), memBytes: KERNEL_LAYOUT.out + 4 * PICTURE_LEN + 64 });
  ref.load(program, KERNEL_LAYOUT.code);
  const f = frameParams(kernel, 0, 0, framesOf(1));
  ref.load([f.phase, f.level], KERNEL_LAYOUT.param);
  ref.reset(0, lanes);
  const counts = new Uint32Array(program.length), mix: Record<OpClass, number> = { alu: 0, ld: 0, st: 0, mul: 0, br: 0, sys: 0 };
  let out: GpuKernelProfile | null = null;
  try {
    for (let n = 0; !ref.halted && n < 2_000_000; n++) {
      ref.step();
      const s = ref.lastStep!;
      counts[s.pc >>> 2]!++;
      mix[gpuOpClass(s.name)]++;
    }
    out = {
      kernel, lanes, asm, lines: gpuListing(Array.from(program), symbols, counts), mix, instructions: ref.instructions,
      laneUse: ref.instructions === 0 ? 1 : 1 - ref.idleLaneSlots / (ref.instructions * lanes),
    };
  } catch { out = null; }
  cache.set(key, out);
  return out;
}
