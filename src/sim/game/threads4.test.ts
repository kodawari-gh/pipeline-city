// Threaded programs on the multicore OS 4 (docs/MULTICORE.md section 7, docs/OS.md "Threaded programs"): T contexts per job, one page table, a0 = k, a1 = T, the job is done when its last thread ends.
import { afterAll, describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { generate, TEMPLATES } from "../gen";
import { parSum } from "../gen/threadtest";
import { BLOCK_BYTES, JOB_ROW, JobState, KDATA_BASE, KERNEL_BASE, KSLOT, KSLOT_BYTES, PCH_RESULT_WORDS } from "../isa/memmap";
import { FMAP, FRAME_END, FRAME_FIRST, getOsSpec, kernelImageFor, KERNEL_IMAGE_PRE_SMP, KERNEL_IMAGE_THR, PCB, PCBS, RESERVED_FRAME, SPOOL_BLOCKS_PER_JOB } from "../os";
import { ECONOMY } from "./economy";
import { Game } from "./game";
import { econ } from "./testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

TEMPLATES["test.par2"] = parSum(2);
TEMPLATES["test.par3"] = parSum(3);
TEMPLATES["test.par4"] = parSum(4);
TEMPLATES["test.par8"] = parSum(8);
afterAll(() => { delete TEMPLATES["test.par2"]; delete TEMPLATES["test.par3"]; delete TEMPLATES["test.par4"]; delete TEMPLATES["test.par8"]; });

/** Cores seen running a thread of a program (the claim word of a context holds its core plus one). */
const ran = new Set<number>();
const until = (g: Game, done: () => boolean, max = 9000): number => {
  const dv = new DataView(g.machine.ram.buffer);
  let t = 0;
  for (; t < max && !done(); t++) {
    g.advanceBaseTick();
    for (let c = 0; c < 8; c++) { const w = dv.getUint32(PCBS + c * PCB.BYTES + PCB.CORE, true); if (w) ran.add(w - 1); }
  }
  expect(done()).toBe(true);
  return t;
};

/** The Enthusiast board with `cpu`, a cooler, 256K of RAM, a drive and OS 4, powered off. */
function machine(cpu: string): Game {
  const g = new Game({ seed: 7, preassembled: true, economy: { ...econ([]), levelGating: false, caseGating: false } });
  g.money = 1_000_000;
  g.powerButton();
  for (const id of ["board1", "board2", "board3", "psu2", cpu, "cooler2", "rad1"]) {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
  }
  for (const d of g.board.devices.filter((x) => x.spec.startsWith("ram"))) g.uninstall(d.id);
  for (const id of ["ram4", "nvme2", "os4"]) {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
  }
  return g;
}

function submit(g: Game, programs: Uint32Array[]) {
  const priv = g as unknown as { os: { deviceId: string }; diskFor(d: unknown): { poke(block: number, bytes: Uint8Array): void } };
  const disk = priv.diskFor(g.board.devices.find((d) => d.id === priv.os.deviceId));
  const spool = Math.ceil(getOsSpec("os4")!.diskBytes / BLOCK_BYTES);
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
const framesInUse = (dv: DataView): number => Array.from({ length: FRAME_END - FRAME_FIRST }, (_, f) => dv.getUint32(FMAP + 4 * (FRAME_FIRST + f), true)).filter((w) => w !== 0 && w !== RESERVED_FRAME).length;
const claimedContexts = (dv: DataView): number => Array.from({ length: 8 }, (_, c) => dv.getUint32(PCBS + c * PCB.BYTES + PCB.SLOT, true)).filter((w) => w !== 0).length;

function run(cpu: string, templates: string[], seeds: number[], scale = 2) {
  ran.clear();
  const g = machine(cpu);
  g.powerButton();
  until(g, () => g.currentPhase() === "idle-os");
  const gens = templates.map((t, k) => generate(t, seeds[k]!, { row: JOB_ROW, scale: scale + k, hosted: true }));
  const { dv, states } = submit(g, gens.map((x) => x.program));
  const took = until(g, () => states().every((x) => x === JobState.Result), 80000);
  until(g, () => g.currentPhase() === "idle-os");
  const texts = gens.map((_, k) => resultText(dv, k)), expected = gens.map((x) => lastLine(x.meta.expectedText));
  const signature = [g.snapshot().cycle, ...g.machine.cores.map((c) => `${c.intc.taken}/${c.mmu.hits}/${c.mmu.misses}`)].join(",");
  return { g, dv, texts, expected, signature, took };
}

describe("threaded programs on the multicore OS 4", { timeout: 120_000 }, () => {
  it("is its own kernel image, on the spec with 256K of RAM", () => {
    expect(kernelImageFor(4, true)).toBe(KERNEL_IMAGE_THR);
    expect(KERNEL_IMAGE_THR).not.toBe(KERNEL_IMAGE_PRE_SMP);
    expect(getOsSpec("os4")!.later).toBeFalsy();
    expect(getOsSpec("os4")!.minRamBytes).toBe(256 * 1024);
  });

  it("runs a two-thread job on a dual-core CPU with the reference's text, on both cores", () => {
    const r = run("cpu2d", ["test.par2"], [11]);
    expect(r.texts).toEqual(r.expected);
    expect(r.g.snapshot().faults).toBe(0);
    expect([...ran].sort()).toEqual([0, 1]);
    expect(framesInUse(r.dv)).toBe(0);
    expect(claimedContexts(r.dv)).toBe(0);
  });

  it("runs threaded and plain jobs together on four logical cores", () => {
    const r = run("cpu3t", ["test.par4", "test.par3", "cli.calc", "test.par2"], [12, 13, 14, 15]);
    expect(r.texts).toEqual(r.expected);
    expect(r.g.snapshot().faults).toBe(0);
    expect(framesInUse(r.dv)).toBe(0);
    expect(claimedContexts(r.dv)).toBe(0);
  });

  it("runs four threads on the HPC part (two out-of-order cores with full SMT) with the reference's text", () => {
    const r = run("cpu5h", ["test.par4"], [20]);
    expect(r.g.cpuLogicalCores()).toBe(4);
    expect(r.texts).toEqual(r.expected);
    expect(r.g.snapshot().faults).toBe(0);
    expect([...ran].sort()).toEqual([0, 1, 2, 3]);
    expect(framesInUse(r.dv)).toBe(0);
  });

  it("runs eight threads on the server part (eight logical cores)", () => {
    const r = run("cpu5s", ["test.par8"], [21]);
    expect(r.g.cpuLogicalCores()).toBe(8);
    expect(r.texts).toEqual(r.expected);
    expect(r.g.snapshot().faults).toBe(0);
    expect(framesInUse(r.dv)).toBe(0);
  });

  it("time-shares more threads than cores", () => {
    const r = run("cpu2d", ["test.par4", "test.par3"], [16, 17]);
    expect(r.texts).toEqual(r.expected);
    expect(framesInUse(r.dv)).toBe(0);
  });

  it("is deterministic per seed", () => {
    expect(run("cpu2d", ["test.par3"], [18]).signature).toBe(run("cpu2d", ["test.par3"], [18]).signature);
  });

  it("kills the whole job when one thread faults, and frees its contexts", () => {
    ran.clear();
    const g = machine("cpu2d");
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    // thread 1 stores into the kernel, thread 0 spins on a flag thread 1 never sets
    const bad = assemble(`addi zero, zero, 2
  beq a0, zero, wait
  li s0, ${KERNEL_BASE}
  sw zero, 0(s0)
wait:
  j wait`).program;
    const good = generate("test.par2", 19, { row: JOB_ROW, scale: 2, hosted: true });
    const { dv, states } = submit(g, [bad, good.program]);
    until(g, () => states().every((x) => x === JobState.Result), 60000);
    expect(resultText(dv, 0)).toBe("SEGFAULT");
    expect(resultText(dv, 1)).toBe(lastLine(good.meta.expectedText));
    until(g, () => g.currentPhase() === "idle-os");
    expect(framesInUse(dv)).toBe(0);
    expect(claimedContexts(dv)).toBe(0);
  });
});

describe("the hpc kinds on the multicore OS 4", { timeout: 240_000 }, () => {
  const WHERE: [string, string][] = [
    ["hpc.reduce", "cpu2d"], ["hpc.matmul", "cpu2d"], ["hpc.nbody", "cpu2d"], // 2 threads on 2 logical cores
    ["hpc.montecarlo", "cpu3t"], ["hpc.sort", "cpu5h"], // 4 threads on 4 logical cores (two cores with two threads each)
    ["hpc.bfs", "cpu5s"], ["hpc.fft", "cpu5s"], // 8 threads on 8 logical cores
  ];
  it.each(WHERE)("%s runs on %s with the generator's text and no fault", (kind, cpu) => {
    const r = run(cpu, [kind], [31]);
    expect(r.texts).toEqual(r.expected);
    expect(r.g.snapshot().faults).toBe(0);
    expect(framesInUse(r.dv)).toBe(0);
    expect(claimedContexts(r.dv)).toBe(0);
  });

  it("an 8-thread kind shares fewer cores, correctly and slower", () => {
    const few = run("cpu2d", ["hpc.fft"], [32], 8), many = run("cpu5s", ["hpc.fft"], [32], 8);
    expect(few.texts).toEqual(few.expected);
    expect(many.texts).toEqual(many.expected);
    expect(many.took).toBeLessThan(few.took);
  });

  it("an 8-thread kind is faster on eight logical cores than on two (short jobs are still dominated by the kernel's own work)", () => {
    const two = run("cpu2d", ["hpc.fft"], [33], 16), eight = run("cpu5s", ["hpc.fft"], [33], 16);
    expect(two.texts).toEqual(two.expected);
    expect(eight.texts).toEqual(eight.expected);
    expect(eight.took).toBeLessThan(two.took * 0.6);
  });
  it("the snapshot has every logical core live, with the job thread on it, and follows the core that is selected", () => {
    const g = machine("cpu5s");
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.snapshot().cores?.live.length).toBe(8);
    const gen = generate("hpc.fft", 33, { row: JOB_ROW, scale: 16, hosted: true });
    const { states } = submit(g, [gen.program]);
    let busy = 0;
    const seen = new Set<number>();
    until(g, () => {
      const c = g.snapshot().cores!;
      busy = Math.max(busy, c.live.filter((x) => x.job !== 0).length);
      for (const x of c.live) if (x.job !== 0) seen.add(x.thread);
      return states()[0] === JobState.Result;
    }, 80000);
    const c = g.snapshot().cores!;
    expect(c.tiles.length).toBe(4); // eight logical cores on four hardware cores
    expect(c.live.map((x) => x.hw)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(busy).toBe(8); // every core held a thread of the job at once
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(c.tiles.every((t) => (t.trace?.rows.length ?? 0) > 0)).toBe(true);
    // every tile carries its stored state (each core runs live on the die); the detailed view (`pipe`) is the selected core's hardware core's
    expect(c.selected).toBe(0);
    expect(c.tiles.every((t) => t.stored !== undefined)).toBe(true);
    expect(g.snapshot().pipe?.trace?.end).toBe(c.tiles[0]!.trace!.end);
    expect(g.setViewCore(6)).toBe(6);
    const d = g.snapshot().cores!;
    expect(d.selected).toBe(6);
    expect(g.snapshot().pipe?.trace?.end).toBe(d.tiles[2]!.trace!.end);
    expect(g.setViewCore(99)).toBe(7);
  });
});
