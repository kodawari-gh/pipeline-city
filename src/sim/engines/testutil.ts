// Test-only helpers shared by the engine tests.

import { assemble } from "../asm";
import { disassemble } from "../isa";
import { Machine } from "../machine";
import { RefCpu } from "../ref";
import { InOrderEngine, type InOrderSettings } from "./inorder";
import { STAGE_CODE_CHARS, type EngineView } from "./view";
import { UnpipelinedEngine } from "./unpipelined";
import type { PipelineEngine } from "./common";
import { DATA_BASE, DATA_SIZE } from "./testgen";
import { Prng } from "../machine/prng";

export interface Config {
  name: string;
  make: (extra?: InOrderSettings) => PipelineEngine;
}

export const CONFIGS: Config[] = [
  { name: "unpipelined", make: (x) => new UnpipelinedEngine(x) },
  { name: "inorder fwd shared=off", make: (x) => new InOrderEngine({ forwarding: true, sharedPort: false, ...x }) },
  { name: "inorder fwd shared=on", make: (x) => new InOrderEngine({ forwarding: true, sharedPort: true, ...x }) },
  { name: "inorder nofwd shared=off", make: (x) => new InOrderEngine({ forwarding: false, sharedPort: false, ...x }) },
  { name: "inorder nofwd shared=on", make: (x) => new InOrderEngine({ forwarding: false, sharedPort: true, ...x }) },
];

export const COMPARE_BYTES = DATA_BASE + DATA_SIZE;

export interface Outcome {
  regs: number[];
  mem: Uint8Array;
  cycles: number;
  counters: number[];
}

export function runRef(src: string, data?: Uint8Array): Outcome {
  const cpu = new RefCpu();
  cpu.load(assemble(src).program);
  if (data) data.forEach((b, i) => cpu.mem.store8(DATA_BASE + i, b));
  cpu.run(1_000_000);
  return { regs: Array.from(cpu.regs), mem: cpu.mem.ram.bytes.slice(0, COMPARE_BYTES), cycles: cpu.steps, counters: [] };
}

export interface Chaos {
  seed: number;
  /** Per-cycle probability of a cache invalidation / predictor flip. */
  p: number;
}

export function runEngine(engine: PipelineEngine, src: string, data?: Uint8Array, chaos?: Chaos, maxCycles = 500_000): Outcome & { machine: Machine } {
  const machine = new Machine();
  machine.attach(engine, assemble(src).program);
  if (data) data.forEach((b, i) => (machine.ram[DATA_BASE + i] = b));
  const r = chaos ? new Prng(chaos.seed) : null;
  while (!engine.halted) {
    if (engine.cycle >= maxCycles) throw new Error("did not halt");
    if (r && chaos) {
      if (r.next() < chaos.p) engine.invalidateCache();
      if (r.next() < chaos.p) engine.flipPredictor(r.next() < 0.5 ? undefined : 4 * r.nextInt(64));
    }
    engine.step();
  }
  return {
    machine,
    regs: Array.from(machine.regs),
    mem: machine.ram.slice(0, COMPARE_BYTES),
    cycles: engine.cycle,
    counters: Array.from(engine.view.counters),
  };
}

export function firstMemDiff(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** Run to halt and render the per-cycle stage chart read back from the timeline ring buffer. */
export function chart(engine: PipelineEngine, src: string, summary?: (counters: Float64Array) => string): string {
  const machine = new Machine();
  machine.attach(engine, assemble(src).program);
  const v: EngineView = engine.view;
  const t = v.timeline;
  const cells = new Map<number, string[]>();
  const info = new Map<number, string>();
  while (!engine.halted && engine.cycle < 2000) {
    engine.step();
    const c = engine.cycle;
    for (let r = 0; r < t.rows; r++) {
      const id = t.id[r]!;
      if (id < 0) continue;
      if (!cells.has(id)) {
        cells.set(id, []);
        info.set(id, `${t.pc[r]!.toString(16).padStart(2, "0")} ${disassemble(t.word[r]!)}`);
      }
      const code = t.codes[r * t.cols + (c % t.cols)]!;
      cells.get(id)![c - 1] = code ? STAGE_CODE_CHARS[code]! : ".";
    }
  }
  const n = engine.cycle;
  const w = Math.max(...[...info.values()].map((s) => s.length));
  const lines: string[] = [];
  for (const id of [...cells.keys()].sort((a, b) => a - b)) {
    const row = cells.get(id)!;
    let s = "";
    for (let i = 0; i < n; i++) s += row[i] ?? ".";
    lines.push(`${info.get(id)!.padEnd(w)} |${s}`);
  }
  const c = v.counters;
  if (summary) lines.push(summary(c));
  else lines.push(`cycles=${c[0]} retired=${c[1]} load=${c[2]} data=${c[3]} flush=${c[4]} struct=${c[5]} cache=${c[6]} flushes=${c[7]} hits=${c[11]} misses=${c[12]}`);
  return "\n" + lines.join("\n") + "\n";
}

// ---- Wide engines (inorder2, ooo) ----

import { OooEngine, type OooSettings } from "./ooo";
import type { EngineSettings } from "./common";

export interface WideConfig {
  name: string;
  make: (extra?: EngineSettings) => PipelineEngine;
}

export const OOO_SIZES: Record<string, OooSettings> = {
  default: {},
  tiny: { robSize: 2, schedSize: 1, fetchQueue: 2 },
  small: { robSize: 4, schedSize: 3, fetchQueue: 2 },
  mid: { robSize: 16, schedSize: 8, fetchQueue: 6 },
  big: { robSize: 32, schedSize: 16, fetchQueue: 8 },
  wide4: { robSize: 16, schedSize: 8, fetchQueue: 8, width: 4, commitWidth: 6 },
  commit4: { robSize: 32, schedSize: 16, fetchQueue: 8, commitWidth: 4 },
  scalar: { robSize: 8, schedSize: 4, fetchQueue: 2, width: 1 },
};

export const WIDE_CONFIGS: WideConfig[] = [
  { name: "inorder2 fwd shared=off", make: (x) => new InOrderEngine({ width: 2, forwarding: true, sharedPort: false, ...x }) },
  { name: "inorder2 fwd shared=on", make: (x) => new InOrderEngine({ width: 2, forwarding: true, sharedPort: true, ...x }) },
  { name: "inorder2 nofwd shared=off", make: (x) => new InOrderEngine({ width: 2, forwarding: false, sharedPort: false, ...x }) },
  { name: "inorder2 nofwd shared=on", make: (x) => new InOrderEngine({ width: 2, forwarding: false, sharedPort: true, ...x }) },
  { name: "inorder4", make: (x) => new InOrderEngine({ width: 4, ...x }) },
  ...Object.entries(OOO_SIZES).map(([name, o]) => ({ name: `ooo ${name}`, make: (x?: EngineSettings) => new OooEngine({ ...o, ...x }) })),
];

/** Run a program on the engine to halt; returns the machine (regs, ram, display) and the engine. */
export function runProgram(engine: PipelineEngine, program: Uint32Array, chaos?: Chaos, maxCycles = 200_000): Machine {
  const m = new Machine();
  m.attach(engine, program);
  const r = chaos ? new Prng(chaos.seed) : null;
  while (!engine.halted) {
    if (engine.cycle >= maxCycles) throw new Error("did not halt");
    if (r && chaos) {
      if (r.next() < chaos.p) engine.invalidateCache();
      if (r.next() < chaos.p) engine.flipPredictor(r.next() < 0.5 ? undefined : 4 * r.nextInt(64));
    }
    engine.step();
  }
  return m;
}
