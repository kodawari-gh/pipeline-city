// What a CPU is good at, measured: the real engine runs a small benchmark of each kind and the speed is its base clock times the
// instructions it finishes per cycle. The picker shows these instead of a guess, so the branches of the CPU tree (docs/TECHTREE.md)
// read as playstyles: a front-end part wins on branchy code, a memory part on big data, a wide part on everything.
//
// The benchmarks are written for this, not taken from the job templates: the current jobs read their data once (a scan is one sweep),
// so no job yet rewards a bigger data cache. The memory benchmark walks a table that fits a big cache but not a small one; the jobs
// that will lean on it (docs/MULTICORE.md "hpc", longer scans) come later.

import { assemble } from "./asm";
import { createEngine, type EngineConfig, type PipelineEngine } from "./engines";
import { Machine } from "@/core/sim";
import { getSpec, type CpuSpec } from "../../board/sim/specs";

export interface CpuProfile {
  /** Arithmetic with long dependent chains and few branches. */
  compute: number;
  /** Walks a 28-line table six times: the data cache (size, ways) and the L2 decide. */
  memory: number;
  /** Nested loops with a data-dependent branch inside: the predictor and the instruction cache decide. */
  branchy: number;
}

const BENCH: Record<keyof CpuProfile, string> = {
  compute: `
    li s0, 0
    li s1, 60
  loop:
    addi a0, a0, 1
    addi a1, a1, 2
    mul  a2, a0, a1
    add  a3, a2, a0
    addi t0, a3, 3
    xor  t1, t0, a1
    add  t2, t1, a2
    mul  t3, t2, a0
    sub  t4, t3, t1
    addi s0, s0, 1
    bne  s0, s1, loop
    ecall`,
  memory: `
    li s0, 4096
    li s1, 6
  pass:
    li t0, 0
    li t1, 448
  walk:
    add t2, s0, t0
    lw a0, 0(t2)
    add a1, a1, a0
    addi t0, t0, 16
    bne t0, t1, walk
    addi s1, s1, -1
    bne s1, zero, pass
    ecall`,
  branchy: `
    li s0, 0
    li s1, 60
  outer:
    li t0, 0
    li t1, 8
  inner:
    addi t0, t0, 1
    andi t2, t0, 3
    bne  t2, zero, skip
    addi a0, a0, 1
  skip:
    bne  t0, t1, inner
    addi s0, s0, 1
    bne  s0, s1, outer
    ecall`,
};
const PROGRAMS = Object.fromEntries(Object.entries(BENCH).map(([k, v]) => [k, assemble(v).program])) as Record<keyof CpuProfile, Uint32Array>;

const MISS_PENALTY = 6;
const MAX_CYCLES = 3_000_000;

const memo = new Map<string, CpuProfile>();

/** Instructions per cycle of one engine config on one benchmark. */
export function ipcOf(cfg: EngineConfig, kind: keyof CpuProfile): number {
  const engine = createEngine(cfg.kind === "ref" ? cfg : { ...cfg, missPenalty: MISS_PENALTY }) as PipelineEngine;
  const m = new Machine();
  m.attach(engine, PROGRAMS[kind]);
  while (!engine.halted && engine.cycle < MAX_CYCLES) engine.step();
  return engine.cycle > 0 ? engine.view.counters[1]! / engine.cycle : 0;
}

/** Measured speed of a CPU spec on the three kinds of work, in instructions per base tick (clock times IPC), to two decimals. Memoised. */
export function cpuProfile(specId: string): CpuProfile | null {
  const spec = getSpec(specId);
  if (!spec || spec.kind !== "cpu") return null;
  const hit = memo.get(specId);
  if (hit) return hit;
  const cpu = spec as CpuSpec;
  const out = {} as CpuProfile;
  for (const k of Object.keys(BENCH) as (keyof CpuProfile)[]) {
    out[k] = Math.round(cpu.clock.base * ipcOf(cpu.engine, k) * 100) / 100;
  }
  memo.set(specId, out);
  return out;
}
