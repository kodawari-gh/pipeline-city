import { describe, expect, it } from "vitest";
import { Prng } from "../machine";
import { boardSlots, createBoard, findDevices, fittedRadiator, install, legacyRadiatorSlots, setClock, sideMounts, ThermalModel, upgradeCase, type Board } from "./index";
import { CASE_FAN_K, FANS_ON, type FanPower } from "./thermal";

const ok = <T extends { ok: boolean }>(r: T): T => { expect(r.ok).toBe(true); return r; };

function rig(sink?: string, cooler = "cooler1"): Board {
  const b = createBoard(2);
  for (const s of ["cpu1", "ram0", "display0", cooler, "psu2", ...(sink ? [sink] : [])]) ok(install(b, s));
  ok(setClock(b, findDevices(b, "cpu")[0]!.id, 1));
  return b;
}
/** Run a loaded machine to a steady state with the given fans and read the CPU and VRM temperatures. */
function settle(b: Board, fans: FanPower, ticks = 600) {
  const th = new ThermalModel(new Prng(1));
  for (let k = 0; k < ticks; k++) th.step(b, { cpu: 1 }, true, fans);
  return { cpu: th.state(findDevices(b, "cpu")[0]!.id)!.tempC, vrm: th.vrm.tempC };
}

describe("fans in the thermal model", () => {
  it("case fans that turn cool every part a little, in proportion to their number", () => {
    const b = rig();
    const none = settle(b, FANS_ON), two = settle(b, { ...FANS_ON, caseFans: 2 }), eight = settle(b, { ...FANS_ON, caseFans: 8 });
    expect(two.cpu).toBeLessThan(none.cpu);
    expect(eight.cpu).toBeLessThan(two.cpu);
    expect(eight.vrm).toBeLessThan(none.vrm);
    expect(none.cpu - eight.cpu).toBeLessThan(8 * CASE_FAN_K * 200); // a little: never the CPU cooler's job
  });

  it("a fanned VRM heatsink with its fan unplugged cools less, but more than none", () => {
    const fanned = settle(rig("vsink2"), FANS_ON).vrm;
    const stopped = settle(rig("vsink2"), { ...FANS_ON, vrm: false }).vrm;
    const bare = settle(rig(), FANS_ON).vrm;
    expect(stopped).toBeGreaterThan(fanned);
    expect(stopped).toBeLessThan(bare);
  });

  it("a plain heatsink does not care about the VRM fan cable", () => {
    expect(settle(rig("vsink1"), { ...FANS_ON, vrm: false }).vrm).toBeCloseTo(settle(rig("vsink1"), FANS_ON).vrm, 6);
  });

  it("an unplugged CPU fan takes the cooler's work (and the air it blows on the VRM) away", () => {
    const b = rig();
    const on = settle(b, FANS_ON), off = settle(b, { ...FANS_ON, cpu: false });
    expect(off.cpu).toBeGreaterThan(on.cpu + 5);
    expect(off.vrm).toBeGreaterThan(on.vrm);
  });
});

describe("radiators on a liquid loop", () => {
  it("a radiator bolts onto the front or the top of the case and spans every fan mount of that side (never the rear)", () => {
    const b = createBoard(2);
    expect(boardSlots(b).filter((s) => s.type === "radiator").map((s) => s.id)).toEqual(["rad-front", "rad-top"]);
    expect(install(b, "rad2", "rad-top").ok).toBe(true);
    expect(fittedRadiator(b)?.side).toBe("top");
    expect(fittedRadiator(b)?.mounts).toEqual(sideMounts(b.caseTier, "top"));
    expect(fittedRadiator(b)!.mounts.length).toBeGreaterThan(1);
    expect(install(b, "rad1", "rad-top").ok).toBe(false); // taken
    expect(install(b, "rad1", "rad-front").ok).toBe(false); // one radiator per loop
    expect(install(b, "rad1", "rad-rear").ok).toBe(false); // no radiator on the rear
    expect(install(b, "rad1", "rad-top1").ok).toBe(false); // a side, not a single mount
    expect(install(b, "rad1", "cpu0").ok).toBe(false); // not a radiator slot
  });

  it("the Mini tower has a front to bolt one to, and no top", () => {
    expect(boardSlots(createBoard(0)).filter((s) => s.type === "radiator").map((s) => s.id)).toEqual(["rad-front"]);
  });

  it("the loop is the pump alone without a radiator, and a bigger radiator cools more", () => {
    const pump = settle(rig(undefined, "cooler2"), FANS_ON);
    const slim = settle(rig(undefined, "cooler2"), { ...FANS_ON, loopK: 1.4 });
    const big = settle(rig(undefined, "cooler2"), { ...FANS_ON, loopK: 2.6 });
    expect(slim.cpu).toBeLessThan(pump.cpu);
    expect(big.cpu).toBeLessThan(slim.cpu);
    // the pump alone is poorer than the air tower
    expect(pump.cpu).toBeGreaterThan(settle(rig(), FANS_ON).cpu);
  });

  it("a case with fewer mounts refuses to take a radiator's mount away", () => {
    const b = createBoard(1);
    ok(install(b, "rad1", "rad-top"));
    ok(upgradeCase(b, 2)); // a bigger case keeps the side
    expect(upgradeCase(b, 0).ok).toBe(false); // the Mini has no top mounts
  });

  it("a save from when a radiator took one mount keeps it on that mount's side (the rear goes to the top)", () => {
    const b = createBoard(2);
    for (const [from, to] of [["rad-top1", "rad-top"], ["rad-front2", "rad-front"], ["rad-rear", "rad-top"]] as const) {
      b.devices = [{ id: "dev9", spec: "rad1", slot: from }];
      legacyRadiatorSlots(b);
      expect(b.devices[0]!.slot).toBe(to);
    }
  });
});
