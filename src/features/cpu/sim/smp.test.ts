// The paged OS on a dual-core CPU (docs/MULTICORE.md section 6): core 0 stays the kernel core and hands jobs to core 1, under the big kernel lock.
import { describe, expect, it } from "vitest";
import { assemble } from "./asm";
import { generate } from "../../jobs/sim/gen";
import { BLOCK_BYTES, JOB_ROW, JobState, KDATA_BASE, KERNEL_BASE, KSLOT, KSLOT_BYTES, PCH_RESULT_WORDS, ROM_DONE_VECTOR } from "@/core/sim/memmap";
import { ARENA1, bootBlocksFor, getOsSpec, KERNEL_IMAGE_PAGED, KERNEL_IMAGE_SMP, kernelImageFor, KFAULTS, SPOOL_BLOCKS_PER_JOB } from "../../os/sim";
import { ECONOMY } from "../../economy/sim/economy";
import { Game } from "@/worker/game/game";
import { econ } from "@/worker/game/testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const until = (g: Game, done: () => boolean, max = 9000): void => { for (let t = 0; t < max && !done(); t++) g.advanceBaseTick(); expect(done()).toBe(true); };

/** A machine for the paged OS on `cpu`: the Enthusiast board (the Duo needs its 120 A), a cooler, `ram` of RAM, a drive, `os` installed, powered off. */
function machine(opts: { cpu?: string; ram?: string; os?: string } = {}): Game {
  const g = new Game({ seed: 7, preassembled: true, economy: { ...econ([]), levelGating: false, caseGating: false } });
  g.money = 1_000_000;
  g.powerButton();
  for (const id of ["board1", "board2", "board3", "psu2", opts.cpu ?? "cpu2d", "cooler2", "rad2"]) { // the liquid loop and its radiator: two busy cores would otherwise crash the machine on the stock heatsink
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
  }
  for (const d of g.board.devices.filter((x) => x.spec.startsWith("ram"))) g.uninstall(d.id);
  for (const id of [opts.ram ?? "ram2", "ssd1", opts.os ?? "os2"]) {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
  }
  return g;
}

/** Put programs into the kernel's table as if they had been ingested (the spool is on the drive, the table in RAM). */
function submit(g: Game, programs: Uint32Array[], os = "os2") {
  const priv = g as unknown as { os: { deviceId: string }; diskFor(d: unknown): { poke(block: number, bytes: Uint8Array): void } };
  const disk = priv.diskFor(g.board.devices.find((d) => d.id === priv.os.deviceId));
  const spool = Math.ceil(getOsSpec(os)!.diskBytes / BLOCK_BYTES);
  const dv = new DataView(g.machine.ram.buffer);
  programs.forEach((program, k) => {
    const lba = spool + k * SPOOL_BLOCKS_PER_JOB, at = KDATA_BASE + k * KSLOT_BYTES;
    disk.poke(lba, new Uint8Array(program.buffer, program.byteOffset, program.length * 4));
    dv.setUint32(at + KSLOT.KEY, 100 + k, true);
    dv.setUint32(at + KSLOT.LEN, program.length, true);
    dv.setUint32(at + KSLOT.LBA, lba, true);
    dv.setUint32(at + KSLOT.SEQ, k + 1, true);
    dv.setUint32(at + KSLOT.STATE, JobState.Queued, true);
  });
  return { dv, states: () => programs.map((_, k) => dv.getUint32(KDATA_BASE + k * KSLOT_BYTES + KSLOT.STATE, true)) };
}

const resultText = (dv: DataView, k: number): string => {
  const at = KDATA_BASE + k * KSLOT_BYTES + KSLOT.RESULT;
  return Array.from({ length: PCH_RESULT_WORDS * 4 }, (_, i) => dv.getUint8(at + i)).map((c) => (c ? String.fromCharCode(c) : " ")).join("").trim();
};
const lastLine = (text: string): string => text.split("\n").filter((l) => l.trim()).pop()!.trim();
/** A job that only burns cycles (the generated ones are over in a few hundred, so the OS's own time hides what a second core saves). */
const burn = (iterations: number): Uint32Array => assemble(`li t0, ${iterations}
spin:
  addi t0, t0, -1
  bne t0, zero, spin
  li t0, ${ROM_DONE_VECTOR}
  jalr zero, t0, 0`).program;
const calc = (seed: number, scale = 16) => generate("cli.calc", seed, { row: JOB_ROW, scale, hosted: true });

describe("the paged OS on a dual core", { timeout: 60_000 }, () => {
  it("runs two jobs at once, one on each core, and both end with their own result", () => {
    const g = machine();
    expect(g.cpuCores()).toBe(2);
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.machine.cores).toHaveLength(2);
    const gens = [calc(11), calc(12)];
    const { dv, states } = submit(g, gens.map((x) => x.program));
    let most = 0;
    until(g, () => { most = Math.max(most, states().filter((x) => x === JobState.Running).length); return states().every((x) => x === JobState.Result); }, 60000);
    expect(most).toBe(2);
    gens.forEach((gen, k) => expect(resultText(dv, k)).toBe(lastLine(gen.meta.expectedText)));
    expect(g.snapshot().faults).toBe(0);
    expect(g.errors).toBe(0);
    const c1 = g.machine.cores[1]!;
    expect(c1.engine!.cycle).toBeGreaterThan(100); // core 1 really ran the first job
    expect(c1.intc.taken).toBe(1); // woken by the IPI once; afterwards it parks and wakes by polling
    expect(c1.intc.parked).toBe(true);
    const cores = g.snapshot().cores!; // the die's tiles: the counters of each hardware core ride along
    expect(cores.stats).toHaveLength(cores.tiles.length);
    expect(cores.stats![1]!.retired).toBeGreaterThan(0);
    expect(cores.stats![1]!.cycles).toBeGreaterThanOrEqual(cores.stats![1]!.retired / 2);
    expect(cores.stats![0]!.stalls).toBeGreaterThanOrEqual(0);
  });

  it("two jobs together finish sooner than one after the other on a single core", () => {
    const both = (cpu: string, ram: string): number => {
      const g = machine({ cpu, ram });
      g.powerButton();
      until(g, () => g.currentPhase() === "idle-os");
      const { states } = submit(g, [burn(3000), burn(3000)]);
      const t0 = g.baseTick;
      until(g, () => states().every((x) => x === JobState.Result), 120000);
      return g.baseTick - t0;
    };
    const duo = both("cpu2d", "ram2"), single = both("cpu2", "ram2");
    expect(duo).toBeLessThan(single * 0.8);
  });

  it("a job that touches the OS is killed on either core, and the other job carries on", () => {
    const g = machine();
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    const bad = assemble(`li s0, ${KERNEL_BASE}\n  sw zero, 0(s0)\n  li t0, 77\n  sw t0, 0x3000(zero)\nspin:\n  j spin`).program;
    const good = calc(31);
    const orders: Uint32Array[][] = [[bad, good.program], [good.program, bad]];
    for (const order of orders) {
      const { dv, states } = submit(g, order);
      until(g, () => states().every((x) => x === JobState.Result), 60000);
      order.forEach((p, k) => expect(resultText(dv, k)).toBe(p === bad ? "SEGFAULT" : lastLine(good.meta.expectedText)));
      new DataView(g.machine.ram.buffer).setUint32(KDATA_BASE + 0 * KSLOT_BYTES + KSLOT.STATE, 0, true);
      new DataView(g.machine.ram.buffer).setUint32(KDATA_BASE + 1 * KSLOT_BYTES + KSLOT.STATE, 0, true);
    }
    expect(new DataView(g.machine.ram.buffer).getUint32(KFAULTS, true)).toBe(2);
    expect(g.currentPhase()).not.toBe("error");
  });

  it("the lock is free and core 1 is idle once everything has ended", () => {
    const g = machine();
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    const { states } = submit(g, [calc(41).program, calc(42).program]);
    until(g, () => states().every((x) => x === JobState.Result), 60000);
    until(g, () => g.currentPhase() === "idle-os");
    const dv = new DataView(g.machine.ram.buffer);
    const KD_END = KDATA_BASE + 8 * KSLOT_BYTES + 56; // the multicore words follow the paged kernel's data: lock, mailbox, busy flag
    expect([0, 4, 8].map((o) => dv.getUint32(KD_END + o, true))).toEqual([0, 0, 0]);
  });

  it("is deterministic", () => {
    const run = (): string => {
      const g = machine();
      g.powerButton();
      until(g, () => g.currentPhase() === "idle-os");
      const { states } = submit(g, [calc(51).program, calc(52).program]);
      until(g, () => states().every((x) => x === JobState.Result), 60000);
      return [g.baseTick, ...g.machine.cores.map((c) => c.engine!.cycle)].join(",");
    };
    expect(run()).toBe(run());
  });

  it("with too little RAM for core 1's arena the jobs run one after the other on core 0 and core 1 sleeps", () => {
    const g = machine({ ram: "ram1b" }); // 64K
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    const gens = [calc(61), calc(62)];
    const { dv, states } = submit(g, gens.map((x) => x.program));
    let most = 0;
    until(g, () => { most = Math.max(most, states().filter((x) => x === JobState.Running).length); return states().every((x) => x === JobState.Result); }, 60000);
    expect(most).toBe(1);
    gens.forEach((gen, k) => expect(resultText(dv, k)).toBe(lastLine(gen.meta.expectedText)));
    expect(g.machine.cores[1]!.intc.taken).toBe(0);
    expect(g.machine.cores[1]!.engine!.cycle).toBe(0);
  });
});

describe("the Duo-T: two cores of two threads", () => {
  it("has four logical cores, os2 uses the first thread of each core, and the second threads stay parked", () => {
    const g = machine({ cpu: "cpu3t" });
    expect(g.cpuCores()).toBe(2);
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.machine.cores).toHaveLength(4);
    expect(g.machine.hardwareCores()).toBe(2);
    const gens = [calc(81), calc(82)];
    const { dv, states } = submit(g, gens.map((x) => x.program));
    let most = 0;
    until(g, () => { most = Math.max(most, states().filter((x) => x === JobState.Running).length); return states().every((x) => x === JobState.Result); }, 60000);
    expect(most).toBe(2);
    gens.forEach((gen, k) => expect(resultText(dv, k)).toBe(lastLine(gen.meta.expectedText)));
    expect(g.errors).toBe(0);
    expect(g.machine.cores[1]!.engine!.cycle).toBeGreaterThan(100);
    expect(g.machine.cores[2]!.intc.parked).toBe(true);
    expect(g.machine.cores[3]!.intc.parked).toBe(true);
    expect(g.machine.cores[2]!.intc.taken).toBe(0);
  });
});

describe("a multicore CPU under the other kernels", () => {
  it("os1 runs on core 0 alone: core 1 stays parked, and a key's job completes", () => {
    const g = machine({ os: "os1", ram: "ram1b" });
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    const { states } = submit(g, [calc(71).program], "os1");
    until(g, () => states().every((x) => x === JobState.Result), 60000);
    expect(g.machine.cores[1]!.engine!.cycle).toBe(0);
    expect(g.machine.cores[1]!.intc.parked).toBe(true);
  });
});

describe("the kernel images", () => {
  it("a single core keeps the paged kernel: the multicore one is only chosen for tier 2 with a second core", () => {
    expect(kernelImageFor(2)).toBe(KERNEL_IMAGE_PAGED);
    expect(kernelImageFor(2, true)).toBe(KERNEL_IMAGE_SMP);
    expect(kernelImageFor(1, true)).not.toBe(KERNEL_IMAGE_SMP);
    expect(kernelImageFor(3, true)).not.toBe(KERNEL_IMAGE_SMP);
    expect(bootBlocksFor(2, true)).toBeGreaterThanOrEqual(bootBlocksFor(2));
    expect(ARENA1).toBe(0x10000);
  });

  it("the boot area on the drive follows the CPU: swapping to a single core brings the plain kernel back", () => {
    const g = machine();
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    const dv = () => new DataView(g.machine.ram.buffer);
    expect(dv().getUint32(KERNEL_BASE + 20 - 20, true)).toBe(KERNEL_IMAGE_SMP[0]);
    expect(g.snapshot().os!.programSlots).toBe(2);
    expect(g.osProgramSlots(g.os!.spec)).toBe(2);
  });
});
