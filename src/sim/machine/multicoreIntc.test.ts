// The interrupt controller's per-core bank (docs/MULTICORE.md section 4): CORE_ID, CORES, IPI, PARK, ROUTE and the display row base.
import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { createEngine, type EngineConfig } from "../engines";
import { DISPLAY_BASE, DISPLAY_COLS, INTC_BASE, INTC_REG, IRQ } from "../isa/memmap";
import { Machine } from "./machine";

const reg = (r: number) => INTC_BASE + r;
/** Read or write a core's own bank through the bus, as that core would. */
function as<T>(m: Machine, k: number, f: () => T): T {
  m.bus.serve(k, m.cores[k]!.mpu);
  return f();
}

describe("per-core interrupt bank", () => {
  it("each core reads its own number and the core count", () => {
    const m = new Machine({ cores: 3 });
    for (let k = 0; k < 3; k++) {
      expect(as(m, k, () => m.bus.load32(reg(INTC_REG.CORE_ID)))).toBe(k);
      expect(as(m, k, () => m.bus.load32(reg(INTC_REG.CORES)))).toBe(3);
    }
    const one = new Machine();
    expect(one.bus.load32(reg(INTC_REG.CORE_ID))).toBe(0);
    expect(one.bus.load32(reg(INTC_REG.CORES))).toBe(1);
  });

  it("the banks are separate: a mask written by one core is not seen by another", () => {
    const m = new Machine({ cores: 2 });
    as(m, 1, () => m.bus.store32(reg(INTC_REG.MASK), 0x12));
    expect(as(m, 0, () => m.bus.load32(reg(INTC_REG.MASK)))).toBe(0);
    expect(as(m, 1, () => m.bus.load32(reg(INTC_REG.MASK)))).toBe(0x12);
  });

  it("IPI raises the IPI line on exactly the cores in the mask", () => {
    const m = new Machine({ cores: 4 });
    as(m, 0, () => m.bus.store32(reg(INTC_REG.IPI), 0b1010));
    expect(m.cores.map((c) => c.intc.pending)).toEqual([0, 1 << IRQ.IPI, 0, 1 << IRQ.IPI]);
    // a core may signal itself, and a bit past the last core is ignored
    as(m, 2, () => m.bus.store32(reg(INTC_REG.IPI), (1 << 2) | (1 << 9)));
    expect(m.cores[2]!.intc.pending).toBe(1 << IRQ.IPI);
  });

  it("device lines go to core 0 until ROUTE says otherwise", () => {
    const m = new Machine({ cores: 2 });
    m.raise(IRQ.NIC);
    expect(m.cores.map((c) => c.intc.pending)).toEqual([1 << IRQ.NIC, 0]);
    as(m, 0, () => m.bus.store32(reg(INTC_REG.ROUTE + 4 * IRQ.DISK), 1));
    expect(as(m, 1, () => m.bus.load32(reg(INTC_REG.ROUTE + 4 * IRQ.DISK)))).toBe(1); // shared by the cores
    m.raise(IRQ.DISK);
    expect(m.cores.map((c) => c.intc.pending)).toEqual([1 << IRQ.NIC, 1 << IRQ.DISK]);
    // a route to a core that does not exist falls back to core 0
    as(m, 0, () => m.bus.store32(reg(INTC_REG.ROUTE + 4 * IRQ.USB), 9));
    m.raise(IRQ.USB);
    expect(m.cores[0]!.intc.pending).toBe((1 << IRQ.NIC) | (1 << IRQ.USB));
  });

  it("a power-on clears the routes and the row bases", () => {
    const m = new Machine({ cores: 2 });
    as(m, 0, () => m.bus.store32(reg(INTC_REG.ROUTE), 1));
    as(m, 1, () => m.bus.store32(reg(INTC_REG.ROW_BASE), 5));
    for (const c of m.cores) c.powerOn();
    expect(m.hub.routeOf(0)).toBe(0);
    expect(m.cores[1]!.intc.rowBase).toBe(0);
  });
});

describe("display row base", () => {
  it("a core's display writes land that many rows lower and its reads come from there", () => {
    const m = new Machine({ cores: 2 });
    as(m, 1, () => m.bus.store32(reg(INTC_REG.ROW_BASE), 3));
    expect(as(m, 1, () => m.bus.load32(reg(INTC_REG.ROW_BASE)))).toBe(3);
    expect(as(m, 0, () => m.bus.load32(reg(INTC_REG.ROW_BASE)))).toBe(0);
    as(m, 1, () => m.bus.store8(DISPLAY_BASE + 1, 65));
    as(m, 0, () => m.bus.store8(DISPLAY_BASE + 2, 66));
    expect(m.display.cells[3 * DISPLAY_COLS + 1]).toBe(65);
    expect(m.display.cells[2]).toBe(66);
    expect(as(m, 1, () => m.bus.load8(DISPLAY_BASE + 1))).toBe(65);
    expect(as(m, 0, () => m.bus.load8(DISPLAY_BASE + 1))).toBe(0);
  });

  it("a write pushed off the screen is dropped", () => {
    const m = new Machine({ cores: 2 });
    as(m, 1, () => m.bus.store32(reg(INTC_REG.ROW_BASE), 1000));
    as(m, 1, () => m.bus.store8(DISPLAY_BASE, 65));
    expect(m.display.text()).toBe("");
  });

  it("a queued write keeps the row it was made for", () => {
    const m = new Machine({ cores: 2, displayLatency: 2 });
    as(m, 1, () => m.bus.store32(reg(INTC_REG.ROW_BASE), 2));
    as(m, 1, () => m.bus.store8(DISPLAY_BASE, 65));
    as(m, 1, () => m.bus.store32(reg(INTC_REG.ROW_BASE), 0));
    for (let i = 0; i < 4; i++) m.display.tick();
    expect(m.display.cells[2 * DISPLAY_COLS]).toBe(65);
  });

  it("one core has no shift unless the row base is set", () => {
    const m = new Machine();
    m.bus.store8(DISPLAY_BASE, 72);
    expect(m.display.cells[0]).toBe(72);
  });
});

const ENGINES: [string, EngineConfig][] = [
  ["ref", { kind: "ref" }],
  ["inorder", { kind: "inorder", forwarding: true, cacheLines: 4 }],
  ["ooo", { kind: "ooo", width: 2, robSize: 16, schedSize: 8, fetchQueue: 8 }],
];
const B_AT = 0x1000;
const SEEN = 0x3000;

// Core 1 installs a handler, enables the IPI line and parks in an idle loop; the handler records that it ran and ends the program.
const SLEEPER = assemble(`
    la t0, handler
    li s3, ${INTC_BASE}
    sw t0, ${INTC_REG.VECTOR}(s3)
    li t0, ${1 << IRQ.IPI}
    sw t0, ${INTC_REG.MASK}(s3)
    li t0, 1
    sw t0, ${INTC_REG.CTRL}(s3)
  idle:
    sw t0, ${INTC_REG.PARK}(s3)
    j idle
  handler:
    li t3, ${1 << IRQ.IPI}
    sw t3, ${INTC_REG.ACK}(s3)
    li t1, ${SEEN}
    li t2, 77
    sw t2, 0(t1)
    ecall`, { origin: B_AT }).program;

// The same with interrupts left off: the masked line only wakes the core, which carries on after the park.
const NAPPER = assemble(`
    li s3, ${INTC_BASE}
    li t0, ${1 << IRQ.IPI}
    sw t0, ${INTC_REG.MASK}(s3)
    sw t0, ${INTC_REG.PARK}(s3)
    nop
    nop
    li t1, ${SEEN}
    li t2, 5
    sw t2, 4(t1)
    ecall`, { origin: B_AT }).program;

// Core 0 waits a while, then sends the IPI.
const WAKER = assemble(`
    li s3, ${INTC_BASE}
    li t0, 2
    li t1, 200
  wait:
    addi t1, t1, -1
    bne t1, zero, wait
    sw t0, ${INTC_REG.IPI}(s3)
    ecall`).program;

// An idle loop with nothing to wake it (what the kernel runs on a core with no work).
const SNOOZER = assemble(`
    li s3, ${INTC_BASE}
    li t0, 1
  idle:
    sw t0, ${INTC_REG.PARK}(s3)
    j idle`, { origin: B_AT }).program;

describe.each(ENGINES)("park and wake on %s", (_n, cfg) => {
  function run(second: Uint32Array, early = false): Machine {
    const m = new Machine({ cores: 2 });
    m.attach(createEngine(cfg), WAKER);
    m.attachCore(1, createEngine(cfg), second, { entry: B_AT, stackTop: m.ram.length - 0x1000 });
    if (early) m.cores[1]!.intc.raise(IRQ.IPI); // already pending when the core masks it in
    for (let i = 0; i < 20_000 && m.cores.some((c) => !c.engine!.halted); i++) m.stepCpu();
    return m;
  }

  it("a parked core stays still until an IPI, then runs its handler", () => {
    const m = run(SLEEPER);
    expect(m.cores.every((c) => c.engine!.halted)).toBe(true);
    expect(new DataView(m.ram.buffer).getUint32(SEEN, true)).toBe(77);
    expect(m.cores[1]!.intc.taken).toBe(1);
    expect(m.cores[1]!.intc.parkedCycles).toBeGreaterThan(100); // it waited out core 0's loop
    expect(m.cores[0]!.intc.parkedCycles).toBe(0);
    expect(m.cores[1]!.intc.parked).toBe(false);
  });

  it("a line pending before the park wakes the core at once, so the wake is not lost", () => {
    const m = run(NAPPER, true);
    expect(m.cores.every((c) => c.engine!.halted)).toBe(true);
    expect(new DataView(m.ram.buffer).getUint32(SEEN + 4, true)).toBe(5);
    expect(m.cores[1]!.intc.parkedCycles).toBe(0);
    expect(m.cores[1]!.intc.taken).toBe(0); // interrupts were off: it only woke
  });

  it("without a wake the core sleeps on", () => {
    const m = new Machine({ cores: 2 });
    m.attach(createEngine(cfg), assemble("ecall").program);
    m.attachCore(1, createEngine(cfg), SNOOZER, { entry: B_AT, stackTop: m.ram.length - 0x1000 });
    for (let i = 0; i < 2000; i++) m.stepCpu();
    expect(m.cores[1]!.engine!.halted).toBe(false);
    expect(m.cores[1]!.intc.parked).toBe(true);
    expect(m.cores[1]!.intc.parkedCycles).toBeGreaterThan(1900);
  });
});
