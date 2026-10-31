import { describe, expect, it } from "vitest";
import { INTC_BASE, INTC_REG, IRQ, TIMER_BASE, TIMER_REG } from "./memmap";
import { Machine } from "./machine";
import { RefEngine } from "../../features/cpu/sim/refEngine";
import { assemble } from "../../features/cpu/sim/asm";

describe("interval timer", () => {
  it("is off until programmed, then raises the timer line every INTERVAL cycles", () => {
    const m = new Machine();
    m.attach(new RefEngine(), assemble("spin:\n  j spin").program);
    for (let i = 0; i < 50; i++) m.stepCpu();
    expect(m.intc.pending).toBe(0);
    m.bus.store32(TIMER_BASE + TIMER_REG.INTERVAL, 10);
    for (let i = 0; i < 25; i++) m.stepCpu();
    expect(m.bus.load32(TIMER_BASE + TIMER_REG.COUNT)).toBe(2);
    expect(m.intc.pending & (1 << IRQ.TIMER)).not.toBe(0);
    m.bus.store32(INTC_BASE + INTC_REG.ACK, 1 << IRQ.TIMER);
    expect(m.intc.pending).toBe(0);
    m.bus.store32(TIMER_BASE + TIMER_REG.INTERVAL, 0);
    for (let i = 0; i < 50; i++) m.stepCpu();
    expect(m.intc.pending).toBe(0);
  });

  it("a power-on resets it", () => {
    const m = new Machine();
    m.bus.store32(TIMER_BASE + TIMER_REG.INTERVAL, 5);
    m.attach(new RefEngine(), new Uint32Array(1));
    expect(m.timer.interval).toBe(0);
  });
});
