import { describe, expect, it } from "vitest";
import { Prng } from "@/core/sim";
import { checkCompat, compatProblems, cpuFullLoad, cpuVrmRatio, createBoard, findDevices, install, deviceSpec, safeCpuClock, setClock, ThermalModel, type CpuSpec } from "./index";
import { FANS_ON } from "./thermal";

function build(tier: number, parts: string[]) {
  const b = createBoard(tier);
  for (const s of parts) expect(install(b, s).ok, s).toBe(true);
  return b;
}
const ids = (b: ReturnType<typeof createBoard>) => checkCompat(b).map((i) => i.id);

describe("compatibility checks", () => {
  it("a plain starter-class build has no problems", () => {
    expect(compatProblems(build(1, ["cpu1", "ram0", "display0", "cooler1", "psu1"]))).toEqual([]);
  });

  it("the static VRM ratio matches what the thermal model sees at full load", () => {
    const b = build(3, ["cpu5h", "ram0", "display0", "cooler2", "psu2"]), cpu = findDevices(b, "cpu")[0]!;
    const th = new ThermalModel(new Prng(1));
    th.step(b, { cpu: cpuFullLoad(deviceSpec(cpu) as CpuSpec) }, true, { ...FANS_ON, caseFans: 0 });
    expect(cpuVrmRatio(b, cpu.id)).toBeCloseTo(th.vrm.loadRatio, 2);
  });

  it("a CPU too big for its board's regulator is a warning, names the part and gives a safe clock that clears it", () => {
    const b = build(3, ["cpu5h", "ram0", "display0", "cooler2", "psu2"]), cpu = findDevices(b, "cpu")[0]!;
    expect(cpuVrmRatio(b, cpu.id)).toBeGreaterThan(1);
    const issue = checkCompat(b).find((i) => i.id === "vrm-overload");
    expect(issue).toMatchObject({ severity: "warn", part: cpu.id });
    expect(issue!.message).toContain("crashes");
    const safe = issue!.fix!.clock;
    expect(safe).toBe(safeCpuClock(b, cpu.id));
    expect(setClock(b, cpu.id, safe).ok).toBe(true);
    expect(cpuVrmRatio(b, cpu.id)).toBeLessThanOrEqual(1);
    expect(ids(b)).not.toContain("vrm-overload");
  });

  it("a build that crashes in the sim is exactly one the check warns about, and the safe clock stops the crashes", () => {
    const run = (b: ReturnType<typeof createBoard>) => {
      const th = new ThermalModel(new Prng(1)), load = cpuFullLoad(deviceSpec(findDevices(b, "cpu")[0]!) as CpuSpec);
      let unstable = false;
      for (let i = 0; i < 5; i++) { th.step(b, { cpu: load }, true, { ...FANS_ON, caseFans: 0 }); unstable ||= th.vrm.unstable; } // the first ticks: the CPU has not heated up and throttled yet
      return unstable;
    };
    const b = build(3, ["cpu5h", "ram0", "display0", "cooler2", "psu2"]), cpu = findDevices(b, "cpu")[0]!;
    expect(run(b)).toBe(true);
    setClock(b, cpu.id, safeCpuClock(b, cpu.id)!);
    expect(run(b)).toBe(false);
  });

  it("errors come before warnings and tips, and a loop with no radiator is a tip", () => {
    const b = build(3, ["cpu5h", "ram0", "display0", "cooler2", "psu2"]);
    const order = checkCompat(b).map((i) => i.severity), rank = { error: 0, warn: 1, tip: 2 } as const;
    expect(order).toEqual([...order].sort((a, c) => rank[a] - rank[c]));
    expect(ids(b)).toContain("loop-no-radiator");
  });

  it("every issue is self-describing: id, severity and a plain sentence", () => {
    for (const i of checkCompat(build(3, ["cpu5h", "ram0", "display0", "cooler2", "psu2"]))) {
      expect(i.id).toMatch(/^[a-z-]+$/);
      expect(["error", "warn", "tip"]).toContain(i.severity);
      expect(i.message.length).toBeGreaterThan(20);
    }
  });
});
