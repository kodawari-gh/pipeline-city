import { describe, expect, it } from "vitest";
import { ECONOMY } from "../../economy/sim/economy";
import type { Game } from "@/worker/game/game";
import { rig } from "@/worker/game/testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const until = (g: Game, done: () => boolean, max = 4000): void => { for (let t = 0; t < max && !done(); t++) g.advanceBaseTick(); expect(done()).toBe(true); };

describe("bit flips in memory", () => {
  const scan = { keys: [{ template: "cli.scan", scale: 3 }] };

  it("never happen at rate 0 (the default)", () => {
    const g = rig("ssd1", scan);
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    g.plugKey(g.trayKeyIds()[0]!);
    until(g, () => g.completed === 1 && g.pluggedKey() === null);
    expect(g.snapshot().bitFlips).toBe(0);
    expect(g.snapshot().eccCorrected).toBe(0);
  });

  it("plain RAM keeps a flipped bit; the job's memory really changes", () => {
    const g = rig("ssd1", { ...scan, economy: { memoryFlipRate: 1 } });
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    g.plugKey(g.trayKeyIds()[0]!);
    until(g, () => (g.snapshot().bitFlips ?? 0) > 0);
    expect(g.eccInstalled()).toBe(false);
    expect(g.snapshot().eccCorrected).toBe(0);
    expect(g.snapshot().log.some((l) => l.kind === "fault" && /bit flipped/.test(l.text))).toBe(true);
  });

  it("ECC RAM corrects it and counts it: the memory is untouched", () => {
    const g = rig("ssd1", { ...scan, economy: { memoryFlipRate: 1 } });
    for (const d of g.board.devices.filter((x) => x.spec.startsWith("ram"))) g.uninstall(d.id);
    const b = g.purchase("ram3");
    if (!b.ok) throw new Error(b.reason);
    const ins = g.install(b.invId);
    expect(ins).toMatchObject({ ok: true });
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.eccInstalled()).toBe(true);
    g.plugKey(g.trayKeyIds()[0]!);
    until(g, () => g.completed === 1 && g.pluggedKey() === null);
    expect(g.snapshot().eccCorrected).toBeGreaterThan(0);
    expect(g.snapshot().bitFlips).toBe(0);
  });
});
