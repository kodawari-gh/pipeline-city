import { describe, expect, it } from "vitest";
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
