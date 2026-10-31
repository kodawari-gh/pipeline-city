import { describe, expect, it } from "vitest";
import { specsOfKind, type CpuSpec } from "../../board/sim/specs";
import { cpuProfile } from "./cpuprofile";

// The CPU tree (docs/TECHTREE.md): every branch must be worth buying for what it leans on, measured on the real engine.

const P = (id: string) => cpuProfile(id)!;

describe("cpuProfile", () => {
  it("is null for a part that is not a CPU, and deterministic", () => {
    expect(cpuProfile("ram0")).toBeNull();
    expect(cpuProfile("nope")).toBeNull();
    expect(cpuProfile("cpu2")).toEqual(cpuProfile("cpu2"));
  });

  it("the trunk gets faster at everything: cpu0 < cpu1 < cpu2", () => {
    for (const k of ["compute", "memory", "branchy"] as const) {
      expect(P("cpu1")[k], k).toBeGreaterThan(P("cpu0")[k]);
      expect(P("cpu2")[k], k).toBeGreaterThan(P("cpu1")[k]);
    }
  });

  it("the front-end branch wins on branchy code, the memory branch on big data, each over the plain part they build on", () => {
    expect(P("cpu2f").branchy).toBeGreaterThan(P("cpu2").branchy);
    expect(P("cpu2m").memory).toBeGreaterThan(P("cpu2").memory);
    expect(P("cpu3f").branchy).toBeGreaterThan(P("cpu3").branchy);
    expect(P("cpu3m").memory).toBeGreaterThan(P("cpu3").memory);
    expect(P("cpu4f").branchy).toBeGreaterThan(P("cpu4").branchy);
    expect(P("cpu4m").memory).toBeGreaterThan(P("cpu4").memory);
  });

  it("a specialist is not worse than its parent anywhere (it only adds parts)", () => {
    for (const [child, parent] of [["cpu2f", "cpu2"], ["cpu2m", "cpu2"], ["cpu3f", "cpu2f"], ["cpu3m", "cpu2m"], ["cpu4w", "cpu4"]]) {
      for (const k of ["compute", "memory", "branchy"] as const) expect(P(child!)[k], `${child} ${k}`).toBeGreaterThanOrEqual(P(parent!)[k] * 0.97);
    }
  });

  it("the specialists differ: the front-end part is not the best at memory work, the memory part not the best at branches", () => {
    expect(P("cpu2f").branchy - P("cpu2").branchy).toBeGreaterThan(P("cpu2m").branchy - P("cpu2").branchy);
    expect(P("cpu2m").memory - P("cpu2").memory).toBeGreaterThan(P("cpu2f").memory - P("cpu2").memory);
  });

  it("the wide out-of-order part is the fastest of all at every kind of work", () => {
    for (const k of ["compute", "memory", "branchy"] as const) {
      for (const s of specsOfKind("cpu")) if (s.id !== "cpu4w") expect(P("cpu4w")[k], `${k} vs ${s.id}`).toBeGreaterThanOrEqual(P(s.id)[k]);
    }
  });

  it("deeper in the tree is faster at its own lean, and costs more", () => {
    expect(P("cpu3f").branchy).toBeGreaterThan(P("cpu2f").branchy);
    expect(P("cpu4f").branchy).toBeGreaterThan(P("cpu3f").branchy);
    expect(P("cpu3m").memory).toBeGreaterThan(P("cpu2m").memory);
    expect(P("cpu4m").memory).toBeGreaterThan(P("cpu3m").memory);
    const by = (id: string) => (specsOfKind("cpu").find((s) => s.id === id) as CpuSpec).price;
    expect(by("cpu3f")).toBeGreaterThan(by("cpu2f"));
    expect(by("cpu4f")).toBeGreaterThan(by("cpu3f"));
    expect(by("cpu4w")).toBeGreaterThan(by("cpu4"));
  });
});
