import { describe, expect, it } from "vitest";
import { allCables, bootCheck, cableBlocked, cableNeeded, cablesOf, caseMounts, connectCable, createBoard, disconnectCable, install, noCables, pruneCables, uninstall, type Board, type Cables } from "./index";

const ok = <T extends { ok: boolean }>(r: T): T => { expect(r.ok).toBe(true); return r; };

/** A bare machine that passes POST on the big board, with the given PSU and extras. */
function rig(psu: string, extras: string[] = []): Board {
  const b = createBoard(3);
  for (const id of [psu, "cpu0", "ram0", "cooler0", ...extras]) ok(install(b, id));
  return b;
}
const basics = (): Cables => ({ ...noCables(), atx: true, cpu: true, cpufan: true, pcmains: true });

describe("pcie power lead", () => {
  it("is refused when the PSU has no lead, or there is no PSU", () => {
    for (const psu of ["psu0", "psu1"]) {
      const r = connectCable(rig(psu), noCables(), "pcie");
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toBe("this PSU has no PCIe power lead");
    }
    const none = connectCable(createBoard(3), noCables(), "pcie");
    expect(none.ok).toBe(false);
    expect(!none.ok && none.reason).toContain("no PSU installed");
  });

  it("plugs into a PSU that has one", () => {
    const cables = noCables();
    ok(connectCable(rig("psu2"), cables, "pcie"));
    expect(cables.pcie).toBe(true);
    expect(connectCable(rig("psu3"), { ...noCables(), pcie: true }, "pcie").ok).toBe(false); // already connected
  });

  it("comes off when the PSU goes, or is swapped for one without a lead", () => {
    const b = rig("psu2");
    const cables = noCables();
    ok(connectCable(b, cables, "pcie"));
    const psuId = b.devices.find((d) => d.spec === "psu2")!.id;
    ok(uninstall(b, psuId));
    expect(pruneCables(b, cables)).toEqual(["pcie"]);
    ok(install(b, "psu3"));
    ok(connectCable(b, cables, "pcie"));
    ok(uninstall(b, b.devices.find((d) => d.spec === "psu3")!.id));
    ok(install(b, "psu1"));
    expect(pruneCables(b, cables)).toEqual(["pcie"]);
    expect(cables.pcie).toBe(false);
  });

  it("is needed only by a card that asks for it", () => {
    expect(cableNeeded(rig("psu3"), "pcie")).toBe(false);
    expect(cableNeeded(rig("psu3", ["npu1"]), "pcie")).toBe(false); // slot-powered
    expect(cableNeeded(rig("psu3", ["gpu1"]), "pcie")).toBe(true);
    expect(cableNeeded(rig("psu3"), "atx")).toBe(true);
  });

  it("a GPU without its lead fails POST with 'GPU power cable', not noPower", () => {
    const b = rig("psu3", ["gpu1"]);
    const cables = basics();
    const chk = bootCheck(b, cables);
    expect(chk.noPower).toBeNull();
    expect(chk.post).toMatchObject({ short: "GPU power cable" });
    ok(connectCable(b, cables, "pcie"));
    expect(bootCheck(b, cables).post).toBeNull();
  });

  it("a slot-powered NPU, or no card at all, needs no lead to boot", () => {
    expect(bootCheck(rig("psu3", ["npu1"]), basics()).post).toBeNull();
    expect(bootCheck(rig("psu3"), basics()).post).toBeNull();
  });

  it("a burnt GPU no longer asks for the lead", () => {
    const b = rig("psu3", ["gpu1"]);
    b.devices.find((d) => d.spec === "gpu1")!.burnt = true;
    expect(bootCheck(b, basics()).post).toBeNull();
  });
});

describe("fan cables", () => {
  it("every case has a hub cable and one per fan mount; the CPU fan cable needs the cooler", () => {
    for (const t of [0, 1, 2, 3]) {
      const b = createBoard(t);
      const ids = cablesOf(b).map((c) => c.id).filter((id) => id.startsWith("fan:"));
      expect(ids, `case ${t}`).toEqual(caseMounts(t).map((m) => `fan:${m}`));
      expect(ids.length).toBeGreaterThanOrEqual(2);
      expect(cableBlocked(b, "sysfan")).toBeNull();
      expect(cableBlocked(b, "cpufan")).toMatch(/no CPU cooler/);
      expect(cableNeeded(b, "cpufan")).toBe(false);
    }
    expect(caseMounts(0)).toEqual(["front0", "front1"]); // the Mini has a grille at the back, not a fan
    expect(caseMounts(3)).toEqual(["front0", "front1", "front2", "front3", "top0", "top1", "top2", "rear"]);
  });

  it("a missing CPU fan cable stops POST; the other fans never do", () => {
    const b = rig("psu2");
    const cables: Cables = { ...basics(), cpufan: false };
    expect(bootCheck(b, cables).post).toMatchObject({ short: "NO CPU FAN" });
    ok(connectCable(b, cables, "cpufan"));
    expect(bootCheck(b, cables).post).toBeNull();
    expect(cables.sysfan).toBeFalsy();
    expect(cables["fan:rear"]).toBeFalsy();
  });

  it("a case fan's cable plugs and unplugs; one the case does not have is refused", () => {
    const b = createBoard(1);
    const cables = noCables();
    ok(connectCable(b, cables, "fan:top0"));
    expect(cables["fan:top0"]).toBe(true);
    expect(connectCable(b, cables, "fan:top0").ok).toBe(false); // already
    expect(connectCable(b, cables, "fan:top1").ok).toBe(false); // the Micro tower has one top fan
    ok(disconnectCable(cables, "fan:top0", b));
    expect(cables["fan:top0"]).toBe(false);
  });

  it("the heatsink fans' cables exist only with a fan version, and come off with it", () => {
    expect(cableBlocked(rig("psu2", ["vsink0"]), "vrmfan")).toMatch(/with a fan/);
    const b = rig("psu2", ["vsink2"]);
    expect(cableBlocked(b, "vrmfan")).toBeNull();
    expect(cableNeeded(b, "vrmfan")).toBe(true);
    const cables = noCables();
    ok(connectCable(b, cables, "vrmfan"));
    ok(uninstall(b, b.devices.find((d) => d.spec === "vsink2")!.id));
    expect(pruneCables(b, cables)).toEqual(["vrmfan"]);
  });

  it("allCables plugs the fans a board has and leaves the ones it has no part for", () => {
    const b = rig("psu2", ["vsink2"]);
    const c = allCables(b);
    expect(c.cpufan && c.sysfan && c.vrmfan && c["fan:rear"] && c["fan:top2"]).toBe(true);
    expect(c.ramfan).toBe(false); // no RAM VRM heatsink with a fan
  });
});
