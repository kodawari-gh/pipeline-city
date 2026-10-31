// The preemptive OS on every logical core (docs/MULTICORE.md section 7): per-core timers, one ready list under the big kernel lock, programs and the kernel's own context on any core.
import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { generate, TEMPLATES } from "@/features/jobs/sim/gen";
import { BLOCK_BYTES, JOB_ROW, JobState, KDATA_BASE, KERNEL_BASE, KSLOT, KSLOT_BYTES, PCH_RESULT_WORDS, ROM_DONE_VECTOR } from "@/core/sim/memmap";
import { bootBlocksFor, FMAP, FRAME_END, FRAME_FIRST, getOsSpec, kernelImageFor, KERNEL_IMAGE_PRE, KERNEL_IMAGE_PRE_SMP, PCB, PCBS, RESERVED_FRAME, SPOOL_BLOCKS_PER_JOB } from "@/features/os/sim";
import { ECONOMY } from "@/features/economy/sim/economy";
import { Game } from "@/worker/game/game";
import { econ } from "@/worker/game/testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

// long compute jobs, so that several are alive together (the generator's calc job with many more rounds)
const calcTemplate = TEMPLATES["cli.calc"]!;
TEMPLATES["cli.calc"] = (rng, p) => calcTemplate(rng, { ...p, scale: p.scale * 500 });

/** Cores seen running a program (the claim word of a program context holds its core plus one): filled while `until` steps. */
const ran = new Set<number>();
const until = (g: Game, done: () => boolean, max = 9000): void => {
  const dv = new DataView(g.machine.ram.buffer);
  for (let t = 0; t < max && !done(); t++) {
    g.advanceBaseTick();
    for (let c = 0; c < 8; c++) { const w = dv.getUint32(PCBS + c * PCB.BYTES + PCB.CORE, true); if (w) ran.add(w - 1); }
  }
  expect(done()).toBe(true);
};

/** A machine for the preemptive OS on `cpu`: the Enthusiast board, a cooler for the busy cores, 256K of RAM, a drive, OS 3 installed, powered off. */
function machine(cpu: string): Game {
  const g = new Game({ seed: 7, preassembled: true, economy: { ...econ([]), levelGating: false, caseGating: false } });
  g.money = 1_000_000;
  g.powerButton();
  for (const id of ["board1", "board2", "board3", "psu2", cpu, "cooler2", "rad2"]) {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
  }
  for (const d of g.board.devices.filter((x) => x.spec.startsWith("ram"))) g.uninstall(d.id);
  for (const id of ["ram4", "nvme2", "os3"]) {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
  }
  return g;
}

/** Put programs into the kernel's table as if they had been ingested (the spool is on the drive, the table in RAM). */
function submit(g: Game, programs: Uint32Array[]) {
  const priv = g as unknown as { os: { deviceId: string }; diskFor(d: unknown): { poke(block: number, bytes: Uint8Array): void } };
  const disk = priv.diskFor(g.board.devices.find((d) => d.id === priv.os.deviceId));
  const spool = Math.ceil(getOsSpec("os3")!.diskBytes / BLOCK_BYTES);
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
const framesInUse = (dv: DataView): number => Array.from({ length: FRAME_END - FRAME_FIRST }, (_, f) => dv.getUint32(FMAP + 4 * (FRAME_FIRST + f), true)).filter((w) => w !== 0 && w !== RESERVED_FRAME).length;
/** A job that only burns cycles, then writes its own marker as the result. */
const burn = (iterations: number): Uint32Array => assemble(`li t0, ${iterations}
spin:
  addi t0, t0, -1
  bne t0, zero, spin
  li t0, ${ROM_DONE_VECTOR}
  jalr zero, t0, 0`).program;

/** Eight programs on a four-logical-core machine; returns what happened (for the determinism check). */
function eight(): { texts: string[]; expected: string[]; signature: string; g: Game; dv: DataView } {
  const g = machine("cpu3t");
  g.powerButton();
  until(g, () => g.currentPhase() === "idle-os");
  const gens = Array.from({ length: 8 }, (_, k) => generate("cli.calc", 40 + k, { row: JOB_ROW, scale: 8 + k, hosted: true }));
  const { dv, states } = submit(g, gens.map((x) => x.program));
  until(g, () => states().every((x) => x === JobState.Result), 80000);
  const texts = gens.map((_, k) => resultText(dv, k));
  const expected = gens.map((x) => x.meta.expectedText.split("\n").filter((l) => l.trim()).pop()!.trim());
  const signature = [g.snapshot().cycle, ...g.machine.cores.map((c) => `${c.intc.taken}/${c.mmu.hits}/${c.mmu.misses}`)].join(",");
  return { texts, expected, signature, g, dv };
}

describe("the preemptive OS on every logical core", { timeout: 120_000 }, () => {
  it("is a different kernel image from the single-core one, and the boot blocks follow it", () => {
    expect(kernelImageFor(3, true)).toBe(KERNEL_IMAGE_PRE_SMP);
    expect(kernelImageFor(3)).toBe(KERNEL_IMAGE_PRE);
    expect(bootBlocksFor(3, true)).toBeGreaterThanOrEqual(bootBlocksFor(3));
  });

  it("runs eight programs on four logical cores, every one with the right text, on every core", () => {
    ran.clear();
    const { g, texts, expected, dv } = eight();
    expect(g.machine.cores).toHaveLength(4);
    expect(g.cpuLogicalCores()).toBe(4);
    expect(texts).toEqual(expected);
    expect(g.snapshot().faults).toBe(0);
    expect(g.errors).toBe(0);
    expect([...ran].sort(), "programs ran on every logical core").toEqual([0, 1, 2, 3]);
    // everything is given back: the frames, the claims on the contexts, the lock
    until(g, () => g.currentPhase() === "idle-os");
    expect(framesInUse(dv)).toBe(0);
  });

  it("is deterministic per seed", () => {
    expect(eight().signature).toBe(eight().signature);
  });

  it("kills a program that touches the OS on whichever core it runs, while the others finish", () => {
    const g = machine("cpu3t");
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    const good = generate("cli.calc", 21, { row: JOB_ROW, scale: 16, hosted: true });
    const bad = assemble(`li s0, ${KERNEL_BASE}
  sw zero, 0(s0)
  li t0, 77
  sw t0, 0x3000(zero)
spin:
  j spin`).program;
    const { dv, states } = submit(g, [good.program, bad, good.program, bad, burn(20000)]);
    until(g, () => states().every((x) => x === JobState.Result), 60000);
    const want = good.meta.expectedText.split("\n").filter((l) => l.trim()).pop()!.trim();
    expect([0, 1, 2, 3].map((k) => resultText(dv, k))).toEqual([want, "SEGFAULT", want, "SEGFAULT"]);
    expect(g.snapshot().faults).toBe(2);
    until(g, () => g.currentPhase() === "idle-os");
    expect(framesInUse(dv)).toBe(0);
  });

  it("a dual-core CPU shares its two cores between three programs", () => {
    ran.clear();
    const g = machine("cpu2d");
    expect(g.cpuLogicalCores()).toBe(2);
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    const gens = [50, 51, 52].map((s) => generate("cli.calc", s, { row: JOB_ROW, scale: 16, hosted: true }));
    const { dv, states } = submit(g, gens.map((x) => x.program));
    until(g, () => states().every((x) => x === JobState.Result), 60000);
    gens.forEach((x, k) => expect(resultText(dv, k)).toBe(x.meta.expectedText.split("\n").filter((l) => l.trim()).pop()!.trim()));
    expect([...ran].sort()).toEqual([0, 1]);
  });
});
