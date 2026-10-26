import { describe, expect, it } from "vitest";
import { InOrderEngine, OooEngine } from "../engines";
import { getSpec } from "../board/specs";
import { createBoard, install } from "../board/board";
import { isPlannedItem, unlockLevelOf } from "./levels";
import { engineConfigFor } from "../board/apply";
import { ECONOMY } from "./economy";
import { rig } from "./testkit";

// Hardware tests: every item is buyable.
ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

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

describe("accelerator specs (docs/ACCEL.md tables)", () => {
  it("tpm1, gpu1, npu1 and psu3 are real parts with the table's numbers, no longer planned", () => {
    expect(getSpec("tpm1")).toMatchObject({ kind: "tpm", slot: "tpm", idleW: 0.2, loadW: 0.5 });
    expect(getSpec("gpu1")).toMatchObject({ kind: "gpu", slot: "pcie", idleW: 4, loadW: 40, needsPcieCable: true, clock: { base: 2 } });
    expect(getSpec("npu1")).toMatchObject({ kind: "npu", slot: "pcie", idleW: 2, loadW: 15, needsPcieCable: false });
    expect(getSpec("psu3")).toMatchObject({ kind: "psu", slot: "atx-plus", watts: 500, pcieLeads: 2 });
    for (const id of ["tpm1", "gpu1", "npu1", "psu3"]) expect(isPlannedItem(id)).toBe(false);
  });

  it("unlock levels match PROGRESSION.md", () => {
    expect(["tpm1", "gpu1", "psu3", "npu1"].map(unlockLevelOf)).toEqual([9, 10, 10, 12]);
  });

  it("each installs on an Enthusiast board with the 500 W supply", () => {
    const b = createBoard(3);
    for (const id of ["psu3", "tpm1", "gpu1", "npu1"]) expect(install(b, id).ok, id).toBe(true);
  });
});
