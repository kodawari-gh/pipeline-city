import { describe, expect, it } from "vitest";
import { getOsSpec, MAX_QUEUE_SLOTS, OS_SPECS, tableSlots } from ".";
import { ECONOMY } from "../../economy/sim/economy";
import type { Game } from "@/worker/game/game";
import { rig } from "@/worker/game/testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const until = (g: Game, done: () => boolean, max = 6000): void => { for (let t = 0; t < max && !done(); t++) g.advanceBaseTick(); expect(done()).toBe(true); };

/** The paged OS on an SSD, plus a second drive, formatted clean: the OS machine with room for the spool elsewhere. */
function twoDrives(os = "os2", ram = "ram2"): Game {
  const g = rig("ssd1", { cpu: "cpu2", os: false, keys: [{ template: "cli.log" }, { template: "cli.log" }] });
  for (const d of g.board.devices.filter((x) => x.spec.startsWith("ram"))) g.uninstall(d.id);
  for (const id of [ram, os, "hdd0"]) {
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
    expect(g.snapshot().os!.config).toMatchObject({ spoolWanted: 3, spoolMax: 16 });
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

describe("the disk allocation page", () => {
  it("a drive holds exactly the slots asked for, and the rest follows the others", () => {
    const g = twoDrives();
    const [ssd, hdd] = ["ssd1", "hdd0"].map((s) => g.board.devices.find((d) => d.spec === s)!);
    expect(g.setSpoolAlloc(hdd!.id, 3).ok).toBe(true);
    expect(g.setSpoolAlloc(ssd!.id, 2).ok).toBe(true);
    const drives = g.snapshot().os!.config!.drives;
    expect(drives.find((d) => d.deviceId === hdd!.id)!.slots).toBe(3);
    expect(drives.find((d) => d.deviceId === ssd!.id)!.slots).toBe(2);
    expect(g.snapshot().os!.queueSlots).toBe(5);
  });

  it("an allocation beyond the room is cut to what fits, and a bad value is refused", () => {
    const g = twoDrives();
    const hdd = g.board.devices.find((d) => d.spec === "hdd0")!;
    expect(g.setSpoolAlloc(hdd.id, 99).ok).toBe(true);
    const d = g.snapshot().os!.config!.drives.find((x) => x.deviceId === hdd.id)!;
    expect(d.slots).toBeLessThanOrEqual(d.maxSlots);
    expect(g.snapshot().os!.queueSlots).toBeLessThanOrEqual(MAX_QUEUE_SLOTS);
    expect(g.setSpoolAlloc(hdd.id, -1).ok).toBe(false);
    expect(g.setSpoolAlloc(hdd.id, null).ok).toBe(true);
  });
});

describe("the queue beyond the old limit", () => {
  it("the job table of a tier with a frame map holds more slots than 16, so only the drives and RAM limit the queue", () => {
    expect(tableSlots(getOsSpec("os2")!)).toBe(16);
    expect(tableSlots(getOsSpec("os3")!)).toBeGreaterThan(16);
    expect(tableSlots(getOsSpec("os4")!)).toBe(MAX_QUEUE_SLOTS);
  });

  it("a queue of 20 slots on an OS 3 machine boots, and a job spooled in a slot past the 16th runs and is delivered", () => {
    const g = twoDrives("os3", "ram4");
    const hdd = g.board.devices.find((d) => d.spec === "hdd0")!;
    g.os!.homeSlots = 0;
    expect(g.setSpoolAlloc(hdd.id, 20).ok).toBe(true);
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.snapshot().os!.queueSlots).toBe(20);
    expect(g.plugKey(g.trayKeyIds()[0]!).ok).toBe(true);
    until(g, () => g.completed === 1 && g.pluggedKey() === null);
  });
});
