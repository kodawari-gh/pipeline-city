import { describe, expect, it } from "vitest";
import { ECONOMY } from "./economy";
import { rig } from "./testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

describe("stepping the paused machine", () => {
  it("runs exactly the cycles asked for, and does nothing while the machine is off", () => {
    const g = rig("ssd1", { cpu: "cpu2" });
    expect(g.stepCycles(5)).toBe(0); // off
    g.powerButton();
    for (let i = 0; i < 40 && g.currentPhase() !== "idle-os"; i++) g.advanceBaseTick();
    const e = g.machine.engine!;
    const c0 = e.cycle;
    expect(g.stepCycles(1)).toBe(1);
    expect(e.cycle).toBe(c0 + 1);
    expect(g.stepCycles(250)).toBe(250);
    expect(e.cycle).toBe(c0 + 251);
  });

  it("stepping whole ticks and then cycles gives the same machine as running ticks", () => {
    const make = () => { const g = rig("ssd1", { cpu: "cpu2" }); g.powerButton(); return g; };
    const a = make(), b = make();
    for (let i = 0; i < 30; i++) a.advanceBaseTick();
    for (let i = 0; i < 30; i++) b.advanceBaseTick();
    const before = a.machine.engine!.cycle;
    a.advanceBaseTick();
    // one tick is a number of cycles; stepping that many cycles gets to the same cycle count
    const per = a.machine.engine!.cycle - before;
    b.stepCycles(per);
    expect(b.machine.engine!.cycle).toBe(a.machine.engine!.cycle);
    expect(Array.from(b.machine.ram.slice(0, 0x2000))).toEqual(Array.from(a.machine.ram.slice(0, 0x2000)));
  });
});
