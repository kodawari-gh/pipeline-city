import { describe, expect, it } from "vitest";
import { GPU_OPS } from "./isa";
import { GPU_GROUP_ORDER, GPU_OP_DOC } from "./isadoc";
import { GPU_TASK_KERNELS, KERNEL_LAYOUT } from "./kernels";
import { GPU_CODE } from "@/core/sim/memmap";
import { gpuKernelOf, gpuKernelProfile, gpuListing, gpuOpClass } from "./gpucode";

describe("the GPU's instructions in words", () => {
  it("every instruction of the ISA is described, in a known group", () => {
    for (const o of GPU_OPS) {
      const d = GPU_OP_DOC[o.name];
      expect(d, o.name).toBeDefined();
      expect(GPU_GROUP_ORDER).toContain(d!.group);
      expect(d!.form.startsWith(o.name), o.name).toBe(true);
    }
    expect(Object.keys(GPU_OP_DOC).sort()).toEqual(GPU_OPS.map((o) => o.name).sort());
  });
  it("the code area of card memory ends where the kernel's parameters begin", () => {
    expect(GPU_CODE.words * 4).toBe(KERNEL_LAYOUT.param);
  });
});

describe("a GPU kernel in the almanac", () => {
  it("every graphics job names its kernel, and other jobs have none", () => {
    for (const k of GPU_TASK_KERNELS) expect(gpuKernelOf(`gpu.${k}`)).toBe(k);
    expect(gpuKernelOf("cli.log")).toBeNull();
    expect(gpuKernelProfile("cli.log", 8)).toBeNull();
  });

  it("the kernel is listed with a label on its loop, how often each instruction ran, and branches that name their target", () => {
    const p = gpuKernelProfile("gpu.blur3", 8)!;
    expect(p.lines.length).toBeGreaterThan(20);
    expect(p.lines.every((l, k) => l.addr === 4 * k)).toBe(true);
    expect(p.lines.some((l) => l.labels.includes("loop"))).toBe(true);
    expect(p.lines.find((l) => l.text.startsWith("bany"))!.text).toBe("bany loop");
    expect(p.lines.at(-1)!.text).toBe("halt");
    expect(p.lines.at(-1)!.count).toBe(1);
    // the picture is 2560 pixels: the loop body runs 2560 / lanes times
    const body = p.lines.find((l) => l.text.startsWith("vst"))!;
    expect(body.count).toBeGreaterThanOrEqual(2560 / 8);
    expect(p.instructions).toBe(p.lines.reduce((n, l) => n + l.count, 0));
    expect(Object.values(p.mix).reduce((a, b) => a + b, 0)).toBe(p.instructions);
    expect(p.laneUse).toBeGreaterThan(0.9);
  });

  it("the same kernel on more lanes runs fewer instructions, and a branching kernel leaves lanes idle", () => {
    expect(gpuKernelProfile("gpu.vadd", 32)!.instructions).toBeLessThan(gpuKernelProfile("gpu.vadd", 8)!.instructions);
    expect(gpuKernelProfile("gpu.thresh", 8)!.laneUse).toBeLessThan(gpuKernelProfile("gpu.vadd", 8)!.laneUse);
  });

  it("raw words (a kernel read back from card memory) list with labels made up for the branch targets", () => {
    const p = gpuKernelProfile("gpu.saxpy", 16)!;
    const lines = gpuListing(p.lines.map((l) => l.word));
    expect(lines.map((l) => l.word)).toEqual(p.lines.map((l) => l.word));
    const bany = lines.find((l) => l.text.startsWith("bany"))!;
    const to = bany.text.split(" ")[1]!;
    expect(lines.some((l) => l.labels.includes(to))).toBe(true);
  });

  it("the classes colour a load, a store, a multiply, a mask change and a branch apart from plain arithmetic", () => {
    expect([gpuOpClass("vld"), gpuOpClass("vst"), gpuOpClass("vmul"), gpuOpClass("msetlt"), gpuOpClass("bany"), gpuOpClass("halt"), gpuOpClass("vadd")]).toEqual(["ld", "st", "mul", "br", "br", "sys", "alu"]);
  });
});
