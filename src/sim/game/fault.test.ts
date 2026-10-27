import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { KDATA_BASE, KERNEL_BASE, USER_BASE } from "../isa/memmap";
import { KERNEL_IMAGE } from "../os";
import { ECONOMY } from "./economy";
import type { Game } from "./game";
import { rig } from "./testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const until = (g: Game, done: () => boolean, max = 4000): void => { for (let t = 0; t < max && !done(); t++) g.advanceBaseTick(); expect(done()).toBe(true); };

/** A job that scribbles over the kernel and the job table. */
const SCRIBBLER = assemble(`
  li s0, ${KERNEL_BASE}
  li s1, ${KDATA_BASE}
  li t0, 0
  sw t0, 0(s0)
  sw t0, 4(s0)
  sw t0, 0(s1)
  sw t0, 8(s1)
  li t0, 77
  sw t0, 0x3000(zero)   # after the fault: must not land
spin:
  j spin`).program;

describe("a job that writes to OS memory", () => {
  it("is killed by the OS: the write is refused, the job ends with a fault result, the fault is counted, and the machine goes on", () => {
    const g = rig("ssd1");
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.snapshot().faults).toBe(0);
    const dv = () => new DataView(g.machine.ram.buffer);
    expect(g.plugKey(g.trayKeyIds()[0]!).ok).toBe(true);
    until(g, () => g.currentPhase() === "running-os" && dv().getUint32(USER_BASE, true) !== 0);
    SCRIBBLER.forEach((w, i) => dv().setUint32(USER_BASE + 4 * i, w, true)); // the "program" the CPU runs from here on
    until(g, () => (g.snapshot().faults ?? 0) === 1);
    // nothing of the OS was touched
    expect(Array.from(KERNEL_IMAGE).every((w, i) => dv().getUint32(KERNEL_BASE + 4 * i, true) === w)).toBe(true);
    expect(dv().getUint32(0x3000, true)).toBe(0);
    // the kernel took the job off the CPU, recorded the fault as the result, and carried on: it flashes the result to the key
    until(g, () => g.snapshot().plugged?.stage === "flashing" || g.snapshot().plugged?.stage === "done" || g.pluggedKey() === null);
    expect(g.snapshot().log.some((l) => l.kind === "fault" && /protected memory/.test(l.text))).toBe(true);
    expect(g.currentPhase()).not.toBe("error");
  });

  it("normal jobs never fault", () => {
    const g = rig("ssd1", { keys: [{ template: "cli.scan", scale: 3 }, { template: "cli.calc" }] });
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.plugKey(g.trayKeyIds()[0]!).ok).toBe(true);
    until(g, () => g.completed === 1 && g.pluggedKey() === null);
    expect(g.snapshot().faults).toBe(0);
  });
});
