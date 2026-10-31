import { describe, expect, it } from "vitest";
import { assembleGpu } from "./asm";
import { GPU_TASK_KERNELS, gpuKernelSource, KERNEL_LAYOUT } from "./kernels";
import { GPU_NET_LAYOUT, gpuLayerSource } from "../../npu/sim/kernels";
import { GpuRef } from "./ref";
import { findRaces } from "./racecheck";

const card = (lanes: number, src: string): GpuRef => {
  const ref = new GpuRef({ lanes, memBytes: 16384, banks: 1 });
  ref.load(assembleGpu(src).program, KERNEL_LAYOUT.code);
  return ref;
};

describe("race checker", () => {
  // each lane writes its own word, then reads its neighbour's
  const neighbour = (bar: string) => `
    lane v1
    vslli v2, v1, 2
    vst v1, 1024(v2)
    ${bar}
    vaddi v3, v1, 1
    vandi v3, v3, 7
    vslli v3, v3, 2
    vld v4, 1024(v3)
    halt`;

  it("flags a lane reading a word another lane wrote in the same launch", () => {
    const races = findRaces(card(8, neighbour("")));
    expect(races).toHaveLength(8);
    expect(races[0]).toMatchObject({ reader: 0, writer: 1 });
  });
  it("a barrier between the write and the read orders them", () => {
    expect(findRaces(card(8, neighbour("bar")))).toEqual([]);
  });
  it("a lane reading what it wrote itself is fine, a broadcast read of an untouched word too", () => {
    expect(findRaces(card(8, "lane v1\nvslli v2, v1, 2\nvst v1, 1024(v2)\nvld v3, 1024(v2)\nvli v4, 0\nvld v5, 2048(v4)\nhalt"))).toEqual([]);
  });
  it("two lanes writing one word is a race too", () => {
    expect(findRaces(card(8, "lane v1\nvli v2, 0\nvst v1, 1024(v2)\nhalt")).length).toBeGreaterThan(0);
  });
});

describe("the real kernels have no cross-lane dependency inside a launch", () => {
  for (const name of GPU_TASK_KERNELS) {
    for (const lanes of [8, 16, 32]) {
      it(`${name} on ${lanes} lanes`, () => {
        const p = { lanes, len: 64, phase: 5, level: 3 };
        const ref = card(lanes, gpuKernelSource(name, p));
        ref.load([p.phase, p.level], KERNEL_LAYOUT.param);
        expect(findRaces(ref)).toEqual([]);
      });
    }
  }

  for (const lanes of [8, 16, 32]) {
    it(`the NPU-fallback layer kernel on ${lanes} lanes`, () => {
      const ref = new GpuRef({ lanes, memBytes: 16384, banks: 1 });
      ref.load(assembleGpu(gpuLayerSource(lanes)).program, 0);
      const L = GPU_NET_LAYOUT;
      ref.load([L.x[0], L.w, L.x[1], L.b], L.args);
      ref.load(Array.from({ length: 64 }, (_, k) => (k % 5) - 2), L.x[0]);
      expect(findRaces(ref)).toEqual([]);
    });
  }
});
