import { describe, expect, it } from "vitest";
import { bootCheck, cableNeeded, connectCable, createBoard, install, noCables, pruneCables, uninstall, type Board } from "./index";

const ok = <T extends { ok: boolean }>(r: T): T => { expect(r.ok).toBe(true); return r; };

/** A bare machine that passes POST on the big board, with the given PSU and extras. */
function rig(psu: string, extras: string[] = []): Board {
  const b = createBoard(3);
  for (const id of [psu, "cpu0", "ram0", "cooler0", ...extras]) ok(install(b, id));
  return b;
}
const basics = () => ({ ...noCables(), atx: true, cpu: true, pcmains: true });

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
