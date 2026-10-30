// The GPU engine contract (docs/GPU.md section 3), the counterpart of machine/engine.ts for the CPU. An engine runs the GPU ISA with a
// timing model; `GpuRef` (src/sim/ref/gpuref.ts) is the functional ground truth every engine is tested against. One `step()` is ONE card
// cycle, so the port counts cycles itself instead of stalling after a multi-cycle instruction.

import type { GpuStep } from "../ref/gpuref";

/** Lockstep SIMD unit, unpipelined (gpu1; the model `GpuRef` has always had). `kind` may be left out in spec data. */
export interface SimdConfig {
  kind?: "simd";
  /** Lanes that run in lockstep, 1..32. */
  lanes: number;
  /** Card memory in bytes (a multiple of 4). Kernel code and data share it. */
  memBytes: number;
  /** Memory banks; word `w` lives in bank `w % banks`. */
  banks: number;
}

/** An SM with `warps` warps of `lanes / warps` lanes, a scoreboard, a round-robin scheduler and a coalescing memory path (gpu2). */
export interface WarpConfig {
  kind: "warp";
  /** Lanes on the card, 1..32; a multiple of `warps`. */
  lanes: number;
  warps: number;
  memBytes: number;
  banks: number;
  /** Words per line the coalescer groups lanes into (a power of two). */
  lineWords: number;
  /** Cycles from the last memory round of a load to its result. */
  globalLatency: number;
}

/** One card's microarchitecture as plain data, so a spec or a save can hold it. The multi-SM kind joins with its engine. */
export type GpuConfig = SimdConfig | WarpConfig;

/** A warp as the view shows it: where it is, its mask and stack, and whether it can issue (docs/GPU.md section 6). */
export interface GpuWarpView {
  pc: number;
  mask: number;
  stack: number[];
  state: "ready" | "wait-mem" | "barrier" | "done";
}

/** One streaming multiprocessor: its warps. The unpipelined unit is one SM with one warp. */
export interface GpuSmView {
  warps: GpuWarpView[];
}

export interface GpuEngine {
  readonly lanes: number;
  readonly banks: number;
  /** Card memory as words, shared with the port's window. */
  readonly mem: Uint32Array;
  /** Vector registers `regs[r][lane]`. */
  readonly regs: Int32Array[];
  /** Execution mask now, bit n = lane n. */
  readonly mask: number;
  /** The mask stack, oldest first. */
  readonly stack: readonly number[];
  readonly pc: number;
  readonly halted: boolean;
  /** Cycles elapsed since `reset`. */
  readonly cycles: number;
  readonly instructions: number;
  /** Cycles lost to memory conflicts (already inside `cycles`). */
  readonly conflictCycles: number;
  /** Lane slots idle through divergence, summed over instructions. */
  readonly idleLaneSlots: number;
  /** Registers zero, `activeLanes` lanes active, pc and counters back at the start. Memory is left as it is. */
  reset(pc?: number, activeLanes?: number): void;
  /** SMs and warps for the view; engines without warps leave it out and the port shows one SM with one warp. */
  smViews?(): GpuSmView[];
  /** Run ONE card cycle. Returns the instruction issued in it, or null when the cycle was spent waiting. Throws `GpuFault` on a kernel fault. */
  step(): GpuStep | null;
}

/** Whether two configs describe the same card (every field, not a chosen few), so a new field cannot silently keep the old core. */
export function sameGpuConfig(a: GpuConfig | null, b: GpuConfig | null): boolean {
  if (!a || !b) return a === b;
  const ra = { ...a, kind: a.kind ?? "simd" } as unknown as Record<string, unknown>, rb = { ...b, kind: b.kind ?? "simd" } as unknown as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined).sort();
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined).sort();
  return ka.length === kb.length && ka.every((k, n) => k === kb[n] && ra[k] === rb[k]);
}
