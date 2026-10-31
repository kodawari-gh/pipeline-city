import { describe, expect, it } from "vitest";
import { assembleGpu } from "./asm";
import { GPU_BASE, GPU_MEM, GPU_REG, GPU_STRIDE, GpuStatus } from "@/core/sim/memmap";
import { Operator } from "../../economy/sim/operator";
import { econ } from "@/worker/game/testkit";
import { Game } from "@/worker/game/game";

// A GPU installed in a Game appears on the bus in its PCIe slot and runs launches (the CPU side of a launch is T77's job template).
const maxed = () => new Game({ seed: 3, sandbox: true, preassembled: true, maxed: true, economy: econ() });
const buy = (g: Game, id: string): string => {
  const r = g.purchase(id);
  if (!r.ok) throw new Error(`${id}: ${r.reason}`);
  return r.invId;
};
const status = (g: Game, slot = 0) => g.machine.bus.load32(GPU_BASE + slot * GPU_STRIDE + GPU_REG.STATUS);

describe("a GPU in the machine", () => {
  it("is on the bus once installed, reports its card, and drops off when taken out", () => {
    const g = maxed();
    expect(status(g)).toBe(0);
    const inv = buy(g, "gpu1");
    const put = g.install(inv);
    expect(put).toMatchObject({ ok: true });
    g.advanceBaseTick(); // the bus follows the board on the next tick
    const slot = g.board.devices.find((d) => d.spec === "gpu1")!.slot;
    const idx = Number(slot.slice(4));
    expect(status(g, idx)).toBe(GpuStatus.Present);
    expect(g.machine.bus.load32(GPU_BASE + idx * GPU_STRIDE + GPU_REG.LANES_MAX)).toBe(8);
    expect(g.uninstall(g.board.devices.find((d) => d.spec === "gpu1")!.id)).toMatchObject({ ok: true });
    g.advanceBaseTick();
    expect(status(g, idx)).toBe(0);
  });

  it("without its PCIe lead the machine will not POST; with it, a launch runs and the card shows load", () => {
    const g = maxed();
    g.install(buy(g, "gpu1"));
    expect(g.snapshot().cables.find((c) => c.id === "pcie")).toMatchObject({ connected: false });
    expect(g.snapshot().postBlocker).toMatch(/PCIe power lead/);
    expect(g.connectCable("pcie")).toMatchObject({ ok: true });
    expect(g.snapshot().postBlocker).toBeNull();
    expect(g.powerButton().ok).toBe(true);
    const slot = g.board.devices.find((d) => d.spec === "gpu1")!.slot;
    const base = GPU_BASE + Number(slot.slice(4)) * GPU_STRIDE;
    const bus = g.machine.bus;
    assembleGpu("lane v1\nvaddi v1, v1, 100\nlane v2\nvslli v2, v2, 2\nvst v1, 1024(v2)\nhalt").program.forEach((w, k) => bus.store32(base + GPU_MEM + 4 * k, w));
    bus.store32(base + GPU_REG.CMD, 1);
    let idleTicks = 0;
    while (bus.load32(base + GPU_REG.STATUS) & GpuStatus.Busy) { g.advanceBaseTick(); if (++idleTicks > 2000) throw new Error("the card never finished"); }
    expect(bus.load32(base + GPU_REG.STATUS) & GpuStatus.Done).toBeTruthy();
    expect([0, 1, 7].map((k) => bus.load32(base + GPU_MEM + 1024 + 4 * k))).toEqual([100, 101, 107]);
    // the snapshot carries the card's insides: shape, slot, and the instructions the launch ran
    const card = g.snapshot().gpus?.find((x) => x.slot === slot);
    expect(card).toMatchObject({ lanes: 8, phase: "idle", launches: 1 });
    expect(card!.trace.map((s) => s.name)).toEqual(["lane", "vaddi", "lane", "vslli", "vst", "halt"]);
  });

  it("the snapshot lists a card only while the machine is on", () => {
    const g = maxed();
    expect(g.snapshot().gpus).toBeUndefined();
    g.install(buy(g, "gpu1"));
    g.connectCable("pcie");
    expect(g.snapshot().gpus).toBeUndefined(); // installed but off
    expect(g.powerButton().ok).toBe(true);
    g.advanceBaseTick();
    expect(g.snapshot().gpus).toHaveLength(1);
  });
});

describe("a gpu job in the machine", () => {
  /** Serve one `gpu` class job with the bot, with or without a card; returns the ticks it took and what the card did. */
  function serve(card: boolean) {
    const g = maxed();
    if (card) {
      expect(g.install(buy(g, "gpu1")).ok).toBe(true);
      expect(g.connectCable("pcie").ok).toBe(true);
    }
    g.clearQueue();
    expect(g.spawnKey("gpu").ok).toBe(true);
    const key = g.snapshot().tray.find((k) => k.cls === "gpu")!;
    expect(key.runnable).toBe(true); // no card needed
    const op = new Operator(g, 1);
    let ticks = 0;
    while (g.completed < 1 && ticks < 5_000_000) { g.advanceBaseTick(); op.step(); ticks++; }
    expect(g.completed).toBe(1);
    expect(g.errors).toBe(0);
    return { ticks, snap: g.snapshot() };
  }

  it("runs on the CPU alone and faster with a card (the job and its class pay are the same either way: the key is the same)", () => {
    const cpu = serve(false), gpu = serve(true);
    expect(gpu.ticks).toBeLessThan(cpu.ticks);
    // the log marks only the card run: without a card the CPU stalls are the job's own
    expect(gpu.snap.jobLog!.at(-1)!.gpu).toBe(true);
    expect(cpu.snap.jobLog!.at(-1)!.gpu).toBeUndefined();
  }, 120_000);
});

describe("stepping a paused card", () => {
  it("ticks the card by 1 and then 10 cycles, and the card's trace grows to the cycle reached", () => {
    const g = maxed();
    g.install(buy(g, "gpu1"));
    g.connectCable("pcie");
    expect(g.powerButton().ok).toBe(true);
    const slot = g.board.devices.find((d) => d.spec === "gpu1")!.slot;
    const base = GPU_BASE + Number(slot.slice(4)) * GPU_STRIDE;
    const bus = g.machine.bus;
    const loop = ["lane v1", ...Array(40).fill("vaddi v1, v1, 1"), "halt"].join("\n");
    assembleGpu(loop).program.forEach((w, k) => bus.store32(base + GPU_MEM + 4 * k, w));
    bus.store32(base + GPU_REG.CMD, 1);
    const card = () => g.snapshot().gpus!.find((x) => x.slot === slot)!;
    expect(g.stepGpu("pcie9", 5)).toBe(0); // no such card
    // through the hop onto the card, then instructions
    let ran = 0;
    while (card().phase !== "run") ran += g.stepGpu(slot, 1);
    expect(ran).toBeGreaterThan(0);
    expect(card().trace).toHaveLength(0);
    expect(g.stepGpu(slot, 1)).toBe(1);
    expect(card().trace).toHaveLength(1);
    expect(g.stepGpu(slot, 10)).toBe(10);
    expect(card().trace).toHaveLength(11);
    expect(card().stats.cycles).toBe(11);
  });

  it("an idle card runs the machine to the CPU's next launch first, and steps its cycles from there", () => {
    const g = maxed();
    g.install(buy(g, "gpu1"));
    g.connectCable("pcie");
    g.clearQueue();
    g.spawnKey("gpu");
    expect(g.powerButton().ok).toBe(true);
    const slot = g.board.devices.find((d) => d.spec === "gpu1")!.slot;
    const card = () => g.snapshot().gpus!.find((x) => x.slot === slot)!;
    const op = new Operator(g, 1);
    // until the OS has the job running: the CPU is copying the kernel into the card, nothing has been launched
    for (let k = 0; k < 3_000_000 && !g.snapshot().os?.queue?.some((j) => j.state === "running"); k++) { g.advanceBaseTick(); op.step(); }
    expect(g.snapshot().os?.queue?.some((j) => j.state === "running")).toBe(true);
    expect(card()).toMatchObject({ phase: "idle", launches: 0 });
    // one step on the idle card: the machine runs until the launch starts, and stops there
    expect(g.stepGpu(slot, 1)).toBe(1);
    expect(card().phase).not.toBe("idle");
    expect(card().trace).toHaveLength(0);
    // from there it steps card cycles as before
    for (let k = 0; k < 100 && card().phase !== "run"; k++) g.stepGpu(slot, 1);
    expect(card().phase).toBe("run");
    expect(g.stepGpu(slot, 3)).toBe(3);
    expect(card().trace).toHaveLength(3);
    expect(card().code!.length).toBeGreaterThan(20); // the kernel the CPU copied in is on show
  }, 120_000);
});
