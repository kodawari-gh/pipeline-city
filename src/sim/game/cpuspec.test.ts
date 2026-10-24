import { describe, expect, it } from "vitest";
import { InOrderEngine, OooEngine } from "../engines";
import { getSpec } from "../board/specs";
import { engineConfigFor } from "../board/apply";
import { ECONOMY } from "./economy";
import { rig } from "./testkit";

// Hardware tests: every item is buyable.
ECONOMY.levelGating = false;

describe("cpu3 (inorder2)", () => {
  it("is a CPU spec whose engine config is the 2-wide in-order engine", () => {
    expect(getSpec("cpu3")).toMatchObject({ kind: "cpu", tier: 3, engine: { kind: "inorder2" } });
  });

  it("builds a machine with a 2-wide engine and runs a job to completion", () => {
    const g = rig("hdd0", { os: false, cpu: "cpu3" });
    expect(engineConfigFor(g.board)).toMatchObject({ kind: "inorder2", forwarding: true });
    expect(g.plugKey(g.trayKeyIds()[0]!).ok).toBe(true);
    g.powerButton();
    for (let i = 0; i < 6000 && g.currentPhase() !== "halted"; i++) g.advanceBaseTick();
    expect(g.currentPhase()).toBe("halted");
    expect(g.snapshot().haltReason).toBe("job-done");
    expect((g.machine!.engine as InOrderEngine).width).toBe(2);
    expect(g.ejectKey()).toMatchObject({ ok: true, done: true });
  });
});

describe("cpu4 (ooo, ROB 8, 4-wide commit)", () => {
  it("is a CPU spec whose engine config is the out-of-order engine", () => {
    expect(getSpec("cpu4")).toMatchObject({ kind: "cpu", tier: 4, engine: { kind: "ooo", robSize: 8, commitWidth: 4 } });
  });

  it("builds a machine with an ooo engine and runs a job to completion", () => {
    const g = rig("hdd0", { os: false, cpu: "cpu4" });
    expect(engineConfigFor(g.board)).toMatchObject({ kind: "ooo", robSize: 8, commitWidth: 4 });
    expect(g.plugKey(g.trayKeyIds()[0]!).ok).toBe(true);
    g.powerButton();
    for (let i = 0; i < 6000 && g.currentPhase() !== "halted"; i++) g.advanceBaseTick();
    expect(g.currentPhase()).toBe("halted");
    expect(g.snapshot().haltReason).toBe("job-done");
    const e = g.machine!.engine as OooEngine;
    expect(e.robSize).toBe(8);
    expect(e.commitWidth).toBe(4);
    expect(g.ejectKey()).toMatchObject({ ok: true, done: true });
  });
});
