// A threaded program on bare cores of every engine: each core runs the program as one thread (a0 = k, a1 = T, a stack of its own), and the text equals the reference's.
import { afterAll, describe, expect, it } from "vitest";
import { createEngine, type EngineConfig } from "./engines";
import { generate, TEMPLATES } from "../../jobs/sim/gen";
import { parSum } from "../../jobs/sim/gen/threadtest";
import { REG_NAMES } from "./isa/isa";
import { RefThreads } from "./ref";
import { Machine } from "@/core/sim/index";

TEMPLATES["test.parM2"] = parSum(2);
TEMPLATES["test.parM3"] = parSum(3);
afterAll(() => { delete TEMPLATES["test.parM2"]; delete TEMPLATES["test.parM3"]; });

const ENGINES: [string, EngineConfig][] = [
  ["unpipelined", { kind: "unpipelined" }],
  ["inorder", { kind: "inorder", forwarding: true, cacheLines: 4 }],
  ["inorder wide", { kind: "inorder", forwarding: true, cacheLines: 4, width: 2 }],
  ["ooo", { kind: "ooo", width: 2, robSize: 16, schedSize: 8, fetchQueue: 8 }],
];
const A0 = REG_NAMES.indexOf("a0"), A1 = REG_NAMES.indexOf("a1");

function runThreads(cfg: EngineConfig, template: string, threads: number): { text: string; cycles: number[]; expected: string } {
  const g = generate(template, 5, { row: 0, jobId: 3, scale: 2 });
  const m = new Machine({ cores: threads });
  const top = m.ram.length;
  for (let k = 0; k < threads; k++) {
    if (k === 0) m.attach(createEngine(cfg), g.program);
    else m.attachCore(k, createEngine(cfg), g.program, { entry: 0, stackTop: top - k * 0x1000 });
    m.cores[k]!.regs[A0] = k;
    m.cores[k]!.regs[A1] = threads;
    m.cores[k]!.regs[2] = top - k * 0x1000;
  }
  for (let i = 0; i < 400_000 && m.cores.some((c) => !c.engine!.halted); i++) m.stepCpu();
  expect(m.cores.every((c) => c.engine!.halted), "every thread ended").toBe(true);
  for (let i = 0; i < 2000; i++) m.stepCpu(); // the display drains
  return { text: m.display.text(), cycles: m.cores.map((c) => c.engine!.cycle), expected: g.meta.expectedText };
}

describe.each(ENGINES)("a threaded program on bare %s cores", (_name, cfg) => {
  it.each([["test.parM2", 2], ["test.parM3", 3]] as const)("%s: the text equals the reference's", (template, threads) => {
    const got = runThreads(cfg, template, threads);
    const g = generate(template, 5, { row: 0, jobId: 3, scale: 2 });
    const ref = new RefThreads(g.program, threads).run({ kind: "random", seed: 9 });
    expect(got.text).toBe(ref);
    expect(got.text).toBe(got.expected);
  });

  it("is deterministic", () => {
    expect(runThreads(cfg, "test.parM2", 2).cycles).toEqual(runThreads(cfg, "test.parM2", 2).cycles);
  });
});
