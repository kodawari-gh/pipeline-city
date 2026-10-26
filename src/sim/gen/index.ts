// Program generator: generate(template, seed, params) -> real assembly + assembled program.
// Same (template, seed, params) always gives byte-identical assembly. See docs/GEN.md.

import { assemble } from "../asm";
import { Prng } from "../machine/prng";
import { ROM_DONE_VECTOR } from "../isa/memmap";
import { RefCpu } from "../ref";
import type { Kernel, Mix } from "./kernels";
import { MAX_CODE_BYTES, TEMPLATES, type GenParams, type ResolvedParams } from "./templates";

export * from "./kernels";
export { TEMPLATES, BUF_BASE, type GenParams, type GpuTarget, type NpuTarget, type ResolvedParams, type TemplateFn } from "./templates";

export interface KernelInfo {
  kernel: string;
  ns: string;
  mix: Mix[];
  footprintBytes: number;
}

export interface GenMeta {
  template: string;
  seed: number;
  params: ResolvedParams;
  kernels: KernelInfo[];
  /** Union of the kernels' mix tags (plus "branch"/"alu" for main). */
  mix: Mix[];
  /** Display text the program should leave on the screen (computed independently of the interpreter). */
  expectedText: string;
  /** Total static memory the kernels declare (display bytes, status words, scan tables). */
  footprintBytes: number;
  /** Program size in words. */
  codeWords: number;
}

export interface Generated {
  asm: string;
  program: Uint32Array;
  symbols: Map<string, number>;
  meta: GenMeta;
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

export function generate(template: string, seed: number, params: GenParams = {}): Generated {
  const fn = TEMPLATES[template];
  if (!fn) throw new RangeError(`unknown template '${template}'`);
  const scale = params.scale ?? 1;
  if (!Number.isInteger(scale) || scale < 1 || scale > 16) throw new RangeError(`scale ${scale}`);
  const rng = new Prng(seed);
  const jobId = params.jobId ?? rng.nextInt(100);
  if (!Number.isInteger(jobId) || jobId < 0 || jobId > 99) throw new RangeError(`jobId ${jobId}`);
  const resolved: ResolvedParams = { scale, row: params.row ?? 0, jobId, ...(params.gpu ? { gpu: params.gpu } : {}), ...(params.npu ? { npu: params.npu } : {}) };
  const built = fn(rng, resolved);
  // Builder.finish ends main with a lone `ecall` line; a hosted program returns to the ROM instead.
  const asm = params.hosted ? built.asm.replace("\n  ecall\n", `\n  li t0, ${ROM_DONE_VECTOR}\n  jalr zero, t0, 0\n`) : built.asm;
  const { program, symbols } = assemble(asm);
  if (program.length * 4 > MAX_CODE_BYTES) throw new RangeError("generated program too large");
  const kernels: KernelInfo[] = built.kernels.map((k: Kernel) => ({ kernel: k.name, ns: k.ns, mix: k.mix, footprintBytes: k.footprintBytes }));
  const mix = [...new Set<Mix>(["alu", "branch", ...kernels.flatMap((k) => k.mix)])];
  return {
    asm,
    program,
    symbols,
    meta: {
      template,
      seed,
      params: resolved,
      kernels,
      mix,
      expectedText: built.expectedText,
      footprintBytes: kernels.reduce((s, k) => s + k.footprintBytes, 0),
      codeWords: program.length,
    },
  };
}

/** Run a generated program on the reference interpreter. `steps` is the dynamic instruction count (ecall included). */
export function runReference(g: Generated, maxSteps = 100_000): { steps: number; text: string; cpu: RefCpu } {
  const cpu = new RefCpu();
  cpu.load(g.program);
  const steps = cpu.run(maxSteps);
  return { steps, text: cpu.mem.displayText(), cpu };
}
