import { describe, expect, it } from "vitest";
import { MAX_QUEUE_SLOTS, OS_SPECS } from "../os";
import { ECONOMY } from "./economy";
import type { Game } from "./game";
import { rig } from "./testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const until = (g: Game, done: () => boolean, max = 6000): void => { for (let t = 0; t < max && !done(); t++) g.advanceBaseTick(); expect(done()).toBe(true); };

/** The paged OS on an SSD, plus a second drive, formatted clean: the OS machine with room for the spool elsewhere. */
function twoDrives(os = "os2"): Game {
  const g = rig("ssd1", { cpu: "cpu2", os: false, keys: [{ template: "cli.log" }, { template: "cli.log" }] });
  for (const d of g.board.devices.filter((x) => x.spec.startsWith("ram"))) g.uninstall(d.id);
  for (const id of ["ram2", os, "hdd0"]) {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(b.reason);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(r.reason);
  }
  const hdd = g.board.devices.find((d) => d.spec === "hdd0")!;
  if (os !== "os1") expect(g.formatDrive(hdd.id).ok).toBe(true); // (the resident OS cannot format)
  return g;
}

describe("the spool on other drives", () => {
  it("the queue fills up from the other data drives when the OS drive has no room left", () => {
    const g = twoDrives();
    g.os!.homeSlots = 1; // (an OS drive that is nearly full)
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.snapshot().os!.queueSlots).toBe(8);
    expect(g.disks.get(g.board.devices.find((d) => d.spec === "hdd0")!.id)!.fs.list("spool")).toHaveLength(1);
  });

  it("a job whose spool area is on another drive is written there, read back and delivered", () => {
    const g = twoDrives();
    g.os!.homeSlots = 0;
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    const [os, data] = ["ssd1", "hdd0"].map((s) => g.snapshot().storage.find((x) => x.spec === s)!);
    const osWritten = os!.bytesWritten;
    expect(g.plugKey(g.trayKeyIds()[0]!).ok).toBe(true);
    until(g, () => g.completed === 1 && g.pluggedKey() === null);
    const after = (s: string) => g.snapshot().storage.find((x) => x.spec === s)!;
    expect(after("hdd0").bytesWritten).toBeGreaterThan(data!.bytesWritten); // the job went to the spool on the data drive
    expect(after("ssd1").bytesWritten).toBe(osWritten); // and not to the OS drive
  });

  it("the resident OS keeps its spool on its own drive", () => {
    const g = twoDrives("os1");
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.disks.get(g.board.devices.find((d) => d.spec === "hdd0")!.id)!.fs.list("spool")).toHaveLength(0);
  });
});

describe("the OS menu's spool settings", () => {
  it("fewer slots wanted: the queue shrinks at once while off, and `null` gives the most back", () => {
    const g = twoDrives();
    g.os!.homeSlots = 1;
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.snapshot().os!.queueSlots).toBe(8);
    g.powerButton();
    expect(g.setSpoolSlots(3).ok).toBe(true);
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.snapshot().os!.queueSlots).toBe(3);
    expect(g.snapshot().os!.config).toMatchObject({ spoolWanted: 3, spoolMax: 8 });
    expect(g.setSpoolSlots(0).ok).toBe(false);
  });

  it("a drive turned off holds no slots, and the choice is saved", () => {
    const g = twoDrives();
    g.os!.homeSlots = 1;
    const hdd = g.board.devices.find((d) => d.spec === "hdd0")!;
    expect(g.setSpoolDrive(hdd.id, false).ok).toBe(true);
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.snapshot().os!.queueSlots).toBe(1);
    expect(g.snapshot().os!.config!.drives.find((d) => d.deviceId === hdd.id)).toMatchObject({ on: false, why: null, slots: 0 });
    expect(g.toSave().osConfig).toMatchObject({ spoolOff: [hdd.id] });
  });

  it("the higher tiers allow more slots than the old table of eight, up to the kernel table", () => {
    expect(OS_SPECS.map((o) => o.queueSlots)).toEqual([4, 8, 12, 16]);
    expect(Math.max(...OS_SPECS.map((o) => o.queueSlots))).toBeLessThanOrEqual(MAX_QUEUE_SLOTS);
  });
});
