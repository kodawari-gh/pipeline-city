import { describe, expect, it } from "vitest";
import { INTC_BASE, INTC_REG, IRQ } from "../isa/memmap";
import { Machine } from "./machine";
import { RefEngine } from "./refEngine";

describe("interrupt controller", () => {
  it("sits on every machine's bus and resets quiet", () => {
    const m = new Machine();
    expect(m.bus.load32(INTC_BASE + INTC_REG.PENDING)).toBe(0);
    expect(m.bus.load32(INTC_BASE + INTC_REG.MASK)).toBe(0);
    expect(m.bus.load32(INTC_BASE + INTC_REG.CTRL)).toBe(0);
    expect(m.intc.next()).toBe(-1);
  });

  it("a raised line is pending until acknowledged, and only deliverable when masked in and interrupts are on", () => {
    const m = new Machine();
    m.intc.raise(IRQ.NIC);
    expect(m.bus.load32(INTC_BASE + INTC_REG.PENDING)).toBe(2);
    expect(m.intc.next()).toBe(-1); // nothing enabled
    m.bus.store32(INTC_BASE + INTC_REG.MASK, 2);
    expect(m.intc.next()).toBe(-1); // global enable still off
    m.bus.store32(INTC_BASE + INTC_REG.CTRL, 1);
    expect(m.intc.next()).toBe(IRQ.NIC);
    m.bus.store32(INTC_BASE + INTC_REG.ACK, 2);
    expect(m.intc.pending).toBe(0);
    expect(m.intc.next()).toBe(-1);
  });

  it("ack clears only the bits written; the lowest line wins", () => {
    const m = new Machine();
    m.intc.mask = 0xff;
    m.intc.ie = true;
    m.intc.raise(3);
    m.intc.raise(1);
    m.intc.raise(6);
    expect(m.intc.next()).toBe(1);
    m.bus.store32(INTC_BASE + INTC_REG.ACK, 1 << 1);
    expect(m.intc.pending).toBe((1 << 3) | (1 << 6));
    expect(m.intc.next()).toBe(3);
  });

  it("word stores and byte stores reach the registers", () => {
    const m = new Machine();
    m.bus.store32(INTC_BASE + INTC_REG.VECTOR, 0x1234_5678);
    expect(m.intc.vector).toBe(0x1234_5678);
    m.bus.store8(INTC_BASE + INTC_REG.VECTOR + 1, 0xab);
    expect(m.intc.vector).toBe(0x1234_ab78);
    m.bus.store32(INTC_BASE + INTC_REG.EPC, 0x40);
    expect(m.bus.load32(INTC_BASE + INTC_REG.EPC)).toBe(0x40);
    // Read-only registers ignore writes.
    m.bus.store32(INTC_BASE + INTC_REG.PENDING, 0xff);
    m.bus.store32(INTC_BASE + INTC_REG.COUNT, 9);
    expect(m.intc.pending).toBe(0);
    expect(m.intc.taken).toBe(0);
  });

  it("attaching an engine (a power-on) resets it", () => {
    const m = new Machine();
    m.intc.raise(IRQ.NIC);
    m.intc.mask = 2;
    m.intc.vector = 0x100;
    m.intc.ie = true;
    m.intc.enter(IRQ.NIC, 8, 4);
    m.intc.ie = true;
    m.attach(new RefEngine(), new Uint32Array(1));
    expect([m.intc.pending, m.intc.mask, m.intc.vector, m.intc.epc, m.intc.taken, m.intc.maxLatency]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(m.intc.ie).toBe(false);
  });

  it("entry records the return address and the cause, turns interrupts off, and counts latency", () => {
    const m = new Machine();
    m.intc.ie = true;
    m.intc.enter(IRQ.NIC, 0x80, 5);
    expect(m.intc.epc).toBe(0x80);
    expect(m.bus.load32(INTC_BASE + INTC_REG.CAUSE)).toBe(IRQ.NIC);
    expect(m.intc.ie).toBe(false);
    expect(m.bus.load32(INTC_BASE + INTC_REG.COUNT)).toBe(1);
    m.intc.enter(IRQ.NIC, 0x90, 3);
    expect([m.intc.lastLatency, m.intc.maxLatency]).toEqual([3, 5]);
    m.intc.leave();
    expect(m.intc.ie).toBe(true);
  });
});
