import { describe, expect, it } from "vitest";
import { getSpec } from "../board/specs";
import type { CardSpec } from "../board/specs";
import { createEngine } from "../engines";
import { GPU_BASE } from "../isa/memmap";
import { GpuPort, Machine } from "../machine";
import { generate } from "./index";
import { GPU_KERNEL_NAMES } from "./gpukernels";

// The job text depends on the seed alone: every card tier prints the CPU path's line, and a faster tier finishes in fewer base ticks.
function runOn(specId: string | null, seed: number): { ticks: number; text: string } {
  const spec = specId ? (getSpec(specId) as CardSpec) : null;
  const gpu = spec?.gpu ? { base: GPU_BASE, lanes: spec.gpu.lanes, memBytes: spec.gpu.memBytes } : undefined;
  const g = generate("gpu.render", seed, { scale: 1, ...(gpu ? { gpu } : {}) });
  const m = new Machine({ ramSize: 64 * 1024 });
  const port = new GpuPort("pcie0", 0);
  m.addDevice(port);
  if (spec?.gpu) {
    m.clock.setRate("pcie0", { mul: spec.clock!.base, div: 1 });
    port.configure(spec.gpu);
  }
  m.attach(createEngine({ kind: "unpipelined" }), g.program);
  let ticks = 0;
  while (!m.engine!.halted) {
    m.advanceBaseTick();
    if (++ticks > 40_000_000) throw new Error("program never halted");
  }
  expect(m.display.text()).toBe(g.meta.expectedText);
  return { ticks, text: m.display.text() };
}

describe("one seed on every GPU tier", { timeout: 300_000 }, () => {
  it("prints the same line on gpu1, gpu2 and gpu3, and each tier is faster than the last", () => {
    let seed = 1;
    for (; seed < 400; seed++) if (generate("gpu.render", seed, { scale: 1 }).meta.expectedText.includes(` ${GPU_KERNEL_NAMES[0]} `)) break;
    const a = runOn("gpu1", seed), b = runOn("gpu2", seed), c = runOn("gpu3", seed);
    expect(b.text).toBe(a.text);
    expect(c.text).toBe(a.text);
    expect(b.ticks).toBeLessThan(a.ticks);
    expect(c.ticks).toBeLessThan(b.ticks);
  });
});
