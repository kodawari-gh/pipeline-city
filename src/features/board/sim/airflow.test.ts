import { describe, expect, it } from "vitest";
import { Prng } from "@/core/sim";
import { AIR_ZONES, MAX_TRAPPED, QUALITY, zoneAir, zoneOf } from "./airflow";
import { basicFan, caseMounts, CASE_TIERS, getSpec } from "./specs";
import { createBoard, findDevices, install, setClock, ThermalModel } from "./index";
import { CARD_FAN_START_C, CASE_FAN_K, CASE_HEAT_C_PER_W, cardFan, FANS_ON, type FanPower } from "./thermal";

const all = (tier: number) => caseMounts(tier);
const without = (tier: number, ...ids: string[]) => all(tier).filter((m) => !ids.includes(m));
const air = (tier: number, turning: string[] | undefined, cardW = 0) => zoneAir(tier, turning, turning?.length ?? 0, cardW, CASE_HEAT_C_PER_W);

describe("airflow zones", () => {
  it("every part that breathes the case air is in an area; a cooler, a sink, the PSU and the monitor are not", () => {
    expect(["cpu", "ram"].map((k) => zoneOf(k as never))).toEqual(["north", "north"]);
    expect(["gpu", "npu", "nic", "tpm"].map((k) => zoneOf(k as never))).toEqual(["cards", "cards", "cards", "cards"]);
    expect(zoneOf("storage")).toBe("bay");
    for (const k of ["cooler", "psu", "display", "vrm-sink", "ram-sink", "radiator"]) expect(zoneOf(k as never)).toBeNull();
  });

  it("with no fan layout known every area gets the fan count and the cards' heat, as before zones", () => {
    const a = zoneAir(2, undefined, 3, 180, CASE_HEAT_C_PER_W);
    for (const z of AIR_ZONES) expect(a[z]).toMatchObject({ fans: 3, flow: 1, riseC: 9 });
  });

  it("with a basic fan on every mount each area is as designed (flow 1) and the cooling is the fans' airflow times the area's quality", () => {
    for (let tier = 0; tier < CASE_TIERS.length; tier++) {
      const a = air(tier, all(tier));
      for (const z of AIR_ZONES) {
        expect(a[z].flow).toBeCloseTo(1, 6);
        expect(a[z].fans).toBeCloseTo(all(tier).length * basicFan(CASE_TIERS[tier]!.fanSize).airflow * QUALITY[z], 6);
      }
    }
    // high-airflow fans cool more, but the area is no better ventilated than designed
    const strong = zoneAir(2, all(2), 0, 0, CASE_HEAT_C_PER_W, Object.fromEntries(all(2).map((m) => [m, 1.5])));
    for (const z of AIR_ZONES) { expect(strong[z].flow).toBe(1); expect(strong[z].fans).toBeGreaterThan(all(2).length * 1.4 * QUALITY[z]); }
    // the average case is as it was
    const mean = AIR_ZONES.reduce((s, z) => s + QUALITY[z], 0) / AIR_ZONES.length;
    expect(mean).toBeGreaterThan(0.9);
    expect(mean).toBeLessThan(1.1);
  });

  it("the rear fan takes what crosses the case: without it the bay and the cards suffer most, the processor's area least", () => {
    for (const tier of [1, 2, 3]) {
      const a = air(tier, without(tier, "rear"));
      expect(a.bay.flow).toBeLessThan(a.north.flow);
      expect(a.cards.flow).toBeLessThan(a.north.flow);
      expect(a.bay.flow).toBeLessThan(0.7);
    }
  });

  it("the top fans are the processor's: without them the north area suffers most", () => {
    const tops = (t: number) => all(t).filter((m) => m.startsWith("top"));
    for (const tier of [2, 3]) {
      const a = air(tier, without(tier, ...tops(tier)));
      expect(a.north.flow).toBeLessThan(a.cards.flow);
      expect(a.north.flow).toBeLessThan(a.bay.flow);
      expect(a.north.flow).toBeLessThan(0.75);
    }
  });

  it("the front fans are level with what they cool: losing the bottom one hurts the drive bay and the cards more than the processor", () => {
    const a = air(3, without(3, "front2")), top = air(3, without(3, "front0"));
    expect(a.bay.flow).toBeLessThan(a.north.flow);
    expect(top.north.flow).toBeLessThan(top.bay.flow);
  });

  it("air goes through an area only with both an intake and an exhaust: front fans alone, or rear and top alone, leave only a little stirring", () => {
    const frontOnly = air(3, all(3).filter((m) => m.startsWith("front"))), exhaustOnly = air(3, all(3).filter((m) => !m.startsWith("front")));
    for (const z of AIR_ZONES) {
      expect(frontOnly[z].flow).toBeLessThan(0.45);
      expect(exhaustOnly[z].flow).toBeLessThan(0.55);
    }
    for (const z of AIR_ZONES) expect(air(3, [])[z].flow).toBeLessThan(0.1); // no fan: the shell's vents alone
  });

  it("the Mini tower (no rear fan, two front fans) still ventilates through its vents, but never as well as a bigger case", () => {
    const mini = air(0, all(0));
    for (const z of AIR_ZONES) { expect(mini[z].flow).toBeGreaterThan(0.2); expect(mini[z].flow).toBeLessThanOrEqual(1); }
  });

  it("the cards' heat piles up where the air does not move: more with the rear fan out, never beyond MAX_TRAPPED times", () => {
    const good = air(3, all(3), 200), bad = air(3, without(3, "rear", "top0", "top1", "top2"), 200), none = air(3, [], 200);
    expect(bad.north.riseC).toBeGreaterThan(good.north.riseC);
    expect(none.north.riseC).toBeLessThanOrEqual(good.north.riseC * MAX_TRAPPED + 1e-9);
    // the processor's side feels the cards more than the bay, which is clear of their air
    expect(good.north.riseC).toBeGreaterThan(good.bay.riseC);
    expect(air(3, all(3), 0).north.riseC).toBe(0);
  });
});

describe("the thermal model by area", () => {
  function rig() {
    const b = createBoard(2);
    for (const s of ["cpu1", "ram0", "display0", "cooler1", "psu2"]) expect(install(b, s).ok).toBe(true);
    expect(setClock(b, findDevices(b, "cpu")[0]!.id, 1).ok).toBe(true);
    return b;
  }
  const settle = (fans: FanPower) => {
    const b = rig(), th = new ThermalModel(new Prng(1));
    for (let k = 0; k < 600; k++) th.step(b, { cpu: 1 }, true, fans);
    return { cpu: th.state(findDevices(b, "cpu")[0]!.id)!.tempC, vrm: th.vrm.tempC, th };
  };
  const mounts = caseMounts(2);

  it("losing the top fans heats the processor and the VRM more than losing a bottom front fan (one fan less either way)", () => {
    const base = { ...FANS_ON, caseFans: mounts.length, mounts }, noTop = without(2, "top0"), noFront = without(2, "front2");
    const full = settle(base), a = settle({ ...base, caseFans: noTop.length, mounts: noTop }), b = settle({ ...base, caseFans: noFront.length, mounts: noFront });
    expect(a.cpu).toBeGreaterThan(full.cpu);
    expect(a.cpu).toBeGreaterThan(b.cpu);
    expect(a.vrm).toBeGreaterThan(b.vrm);
  });

  it("a fan layout that matches the old count cools about as the old uniform model did (the average case is unchanged)", () => {
    const layout = settle({ ...FANS_ON, caseFans: mounts.length, mounts }), legacy = settle({ ...FANS_ON, caseFans: mounts.length });
    expect(Math.abs(layout.cpu - legacy.cpu)).toBeLessThan(CASE_FAN_K * mounts.length * 0.3 * 200);
  });

  it("the model keeps the last tick's air by area for the snapshot", () => {
    const { th } = settle({ ...FANS_ON, caseFans: mounts.length, mounts });
    for (const z of AIR_ZONES) expect(th.air[z].flow).toBeCloseTo(1, 6);
    expect(th.air.north.fans).toBeGreaterThan(th.air.cards.fans);
  });
});

describe("the weights", () => {
  it("rebalancing guard: the areas' qualities average about 1, so the average case cools as it did before zones", () => {
    const mean = AIR_ZONES.reduce((a, z) => a + QUALITY[z], 0) / AIR_ZONES.length;
    expect(mean).toBeGreaterThan(0.9);
    expect(mean).toBeLessThan(1.1);
    for (const z of AIR_ZONES) expect(QUALITY[z]).toBeGreaterThan(0);
  });

  it("with every fan out, no area is hotter than MAX_TRAPPED times the cards' heat, and none is cooler than with the fans on", () => {
    for (let tier = 0; tier < CASE_TIERS.length; tier++) {
      const on = air(tier, all(tier), 100), off = air(tier, [], 100);
      for (const z of AIR_ZONES) { expect(off[z].riseC).toBeGreaterThanOrEqual(on[z].riseC); expect(off[z].fans).toBeLessThan(on[z].fans); }
    }
  });
});

describe("a card's own fans", () => {
  const gpuRig = () => {
    const b = createBoard(2);
    for (const s of ["cpu1", "ram0", "display0", "cooler1", "psu2", "gpu1"]) expect(install(b, s, s === "gpu1" ? "pcie0" : undefined).ok).toBe(true);
    return b;
  };
  const mounts = caseMounts(2);
  const settle = (fans: FanPower, k0 = 800) => {
    const b = gpuRig(), th = new ThermalModel(new Prng(1)), id = findDevices(b, "gpu")[0]!.id;
    for (let k = 0; k < k0; k++) th.step(b, { cpu: 1, gpu: 1 }, true, fans);
    return th.state(id)!;
  };

  it("the fan is still when the card is cool, and runs from CARD_FAN_START_C up to full at its throttle limit", () => {
    expect(cardFan(25, 80)).toBe(0);
    expect(cardFan(CARD_FAN_START_C, 80)).toBe(0);
    expect(cardFan(60, 80)).toBeCloseTo(0.5, 6);
    expect(cardFan(120, 80)).toBe(1);
  });

  it("a working card spins its fans and runs cooler than the same card with its fans stuck", () => {
    const real = settle({ ...FANS_ON, caseFans: mounts.length, mounts });
    expect(real.fan).toBeGreaterThan(0);
    const spec = getSpec("gpu1")!, saved = spec.thermal.fanPerC;
    spec.thermal.fanPerC = 0;
    const stuck = settle({ ...FANS_ON, caseFans: mounts.length, mounts });
    spec.thermal.fanPerC = saved;
    expect(stuck.fan).toBe(0);
    expect(real.tempC).toBeLessThan(stuck.tempC);
  });

  it("the fans do less in a case with no air moving, and stop when the machine is off", () => {
    const good = settle({ ...FANS_ON, caseFans: mounts.length, mounts }), starved = settle({ ...FANS_ON, caseFans: 0, mounts: [] });
    expect(starved.tempC).toBeGreaterThan(good.tempC);
    const b = gpuRig(), th = new ThermalModel(new Prng(1));
    for (let k = 0; k < 300; k++) th.step(b, { gpu: 1 }, true, { ...FANS_ON, caseFans: mounts.length, mounts });
    th.step(b, { gpu: 1 }, false);
    expect(th.state(findDevices(b, "gpu")[0]!.id)!.fan).toBe(0);
  });
});
