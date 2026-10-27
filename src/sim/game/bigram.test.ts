// Big memory (docs/RAM.md "How much RAM the OS uses"): the in-memory index job keeps a table at 0x10000 up, which every OS has to give it: physical memory on
// OS 1, demand-paged frames (and level 2 tables) on OS 2 and 3.
import { describe, expect, it } from "vitest";
import { indexBytes } from "../gen";
import { ECONOMY } from "./economy";
import type { Game } from "./game";
import { rig } from "./testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const until = (g: Game, done: () => boolean, max = 20000): void => { for (let t = 0; t < max && !done(); t++) g.advanceBaseTick(); expect(done()).toBe(true); };

function machine(os: string, ram: string, scale: number, cpu = "cpu2"): Game {
  const g = rig("ssd1", { cpu, os: false, keys: [{ template: "db.index", scale }] });
  for (const d of g.board.devices.filter((x) => x.spec.startsWith("ram"))) g.uninstall(d.id);
  const r = g.purchase(ram);
  if (!r.ok) throw new Error(r.reason);
  g.install(r.invId);
  const o = g.purchase(os);
  if (!o.ok) throw new Error(o.reason);
  const i = g.install(o.invId);
  if (!i.ok) throw new Error(i.reason);
  return g;
}

describe("a job with a big table", () => {
  it("is 64K at scale 3, and grows by powers of two to 512K", () => {
    expect([1, 2, 3, 4, 8, 16].map((s) => indexBytes(s) / 1024)).toEqual([32, 64, 64, 128, 256, 512]);
  });

  for (const [os, ram, scale, cpu] of [["os1", "ram2", 3, "cpu1"], ["os2", "ram2", 3, "cpu2"], ["os3", "ram4", 4, "cpu2"]] as const) {
    it(`runs on ${os} with ${ram}: the table is claimed and the answer is right`, () => {
      const g = machine(os, ram, scale, cpu);
      g.powerButton();
      until(g, () => g.currentPhase() === "idle-os");
      expect(g.plugKey(g.trayKeyIds()[0]!)).toMatchObject({ ok: true });
      let claimed = 0;
      until(g, () => { claimed = Math.max(claimed, (g.snapshot().ram?.regions ?? []).filter((r) => r.kind === "work").reduce((n, r) => n + (r.hi - r.lo), 0)); return g.completed === 1 && g.pluggedKey() === null; }, 40000);
      expect(g.snapshot().faults).toBe(0);
      expect(g.errors).toBe(0);
      if (os !== "os1") expect(claimed).toBeGreaterThanOrEqual(indexBytes(scale) / 2); // the paged OSes hand out the frames as the program touches them
    }, 120_000);
  }

  it("is refused where the RAM does not reach past the table", () => {
    const g = machine("os1", "ram1b", 3, "cpu1"); // 64K: the table at 0x10000 is not there
    expect(g.plugKey(g.snapshot().tray[0]!.id)).toMatchObject({ ok: false, reason: expect.stringMatching(/96K of RAM|128K of RAM/) });
  });
});
