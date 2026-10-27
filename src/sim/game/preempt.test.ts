import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { generate, TEMPLATES } from "../gen";
import { BLOCK_BYTES, JOB_ROW, JobState, KDATA_BASE, KERNEL_BASE, KSLOT, KSLOT_BYTES, PCH_RESULT_WORDS } from "../isa/memmap";
import { FMAP, FRAME_END, FRAME_FIRST, getOsSpec, RESERVED_FRAME, SPOOL_BLOCKS_PER_JOB } from "../os";
import { ECONOMY } from "./economy";
import type { Game } from "./game";
import { rig } from "./testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

// long compute jobs, so that several are alive together (the generator's calc job with many more rounds)
const calc = TEMPLATES["cli.calc"]!;
TEMPLATES["cli.calc"] = (rng, p) => calc(rng, { ...p, scale: p.scale * 500 });

const until = (g: Game, done: () => boolean, max = 9000): void => { for (let t = 0; t < max && !done(); t++) g.advanceBaseTick(); expect(done()).toBe(true); };

/** A machine for the preemptive OS: an MMU CPU, 64K of RAM, a drive, the OS installed and powered off. */
function pre(opts: { cpu?: string; keys?: { template: string; scale?: number }[] } = {}): Game {
  const g = rig("ssd1", { cpu: opts.cpu ?? "cpu2", os: false, keys: opts.keys });
  for (const d of g.board.devices.filter((x) => x.spec.startsWith("ram"))) g.uninstall(d.id);
  const ram = g.purchase("ram4");
  if (!ram.ok) throw new Error(ram.reason);
  g.install(ram.invId);
  const os = g.purchase("os3");
  if (!os.ok) throw new Error(os.reason);
  const r = g.install(os.invId);
  if (!r.ok) throw new Error(r.reason);
  return g;
}


type Rig = { g: Game; dv: DataView; states: () => number[] };

/** Put programs into the kernel's table as if they had been ingested (the spool is on the drive, the table in RAM). */
function submit(g: Game, programs: Uint32Array[]): Rig {
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
  return { g, dv, states: () => programs.map((_, k) => dv.getUint32(KDATA_BASE + k * KSLOT_BYTES + KSLOT.STATE, true)) };
}

const resultText = (dv: DataView, k: number): string => {
  const at = KDATA_BASE + k * KSLOT_BYTES + KSLOT.RESULT;
  return Array.from({ length: PCH_RESULT_WORDS * 4 }, (_, i) => dv.getUint8(at + i)).map((c) => (c ? String.fromCharCode(c) : " ")).join("").trim();
};
const lastLine = (text: string): string => text.split("\n").filter((l) => l.trim()).pop()!.trim();
const framesInUse = (dv: DataView): number => Array.from({ length: FRAME_END - FRAME_FIRST }, (_, f) => dv.getUint32(FMAP + 4 * (FRAME_FIRST + f), true)).filter((w) => w !== 0 && w !== RESERVED_FRAME).length;

describe("the preemptive OS", { timeout: 60_000 }, () => { // several long programs on a loaded machine
  it("needs a CPU with an MMU", () => {
    expect(() => pre({ cpu: "cpu1" })).toThrow(/MMU/);
  });

  it("boots and runs a job to its result", () => {
    const g = pre({ keys: [{ template: "cli.scan", scale: 3 }] });
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    g.plugKey(g.trayKeyIds()[0]!);
    until(g, () => g.completed === 1 && g.pluggedKey() === null);
    expect(g.snapshot().faults).toBe(0);
    expect(g.errors).toBe(0);
  });

  it("runs several programs at once, each in its own address space, and every one ends with its own result", () => {
    const g = pre();
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    const gens = [generate("cli.calc", 11, { row: JOB_ROW, scale: 16, hosted: true }), generate("cli.calc", 12, { row: JOB_ROW, scale: 16, hosted: true }), generate("cli.scan", 13, { row: JOB_ROW, scale: 4, hosted: true })];
    const { dv, states } = submit(g, gens.map((x) => x.program));
    let most = 0, apps = 0;
    until(g, () => { most = Math.max(most, states().filter((x) => x === JobState.Running).length); apps = Math.max(apps, (g.snapshot().ram?.regions ?? []).filter((r) => r.kind === "app").length); return states().every((x) => x === JobState.Result); }, 60000);
    expect(most).toBeGreaterThanOrEqual(2);
    expect(apps).toBeGreaterThanOrEqual(2); // the RAM view shows every program that is loaded
    gens.forEach((gen, k) => expect(resultText(dv, k)).toBe(lastLine(gen.meta.expectedText)));
    expect(g.snapshot().faults).toBe(0);
    expect(g.errors).toBe(0);
    expect(g.machine.timer.fired).toBeGreaterThan(0);
    expect(g.snapshot().mmu!.faults).toBeGreaterThan(0); // heap and stack frames claimed by faults
    // everything is given back: no frames, and the timer rests when nothing runs
    until(g, () => g.currentPhase() === "idle-os");
    expect(framesInUse(dv)).toBe(0);
    expect(g.machine.timer.interval).toBe(0);
  });

  it("a program that touches the OS is killed while the others carry on and finish", () => {
    const g = pre();
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    const good = generate("cli.calc", 21, { row: JOB_ROW, scale: 16, hosted: true });
    const bad = assemble(`li s0, ${KERNEL_BASE}
  sw zero, 0(s0)
  li t0, 77
  sw t0, 0x3000(zero)
spin:
  j spin`).program;
    const { dv, states } = submit(g, [good.program, bad, good.program]);
    until(g, () => states().every((x) => x === JobState.Result), 60000);
    expect(resultText(dv, 0)).toBe(lastLine(good.meta.expectedText));
    expect(resultText(dv, 1)).toBe("SEGFAULT");
    expect(resultText(dv, 2)).toBe(lastLine(good.meta.expectedText));
    expect(g.snapshot().faults).toBe(1);
    expect(g.currentPhase()).not.toBe("error");
    until(g, () => g.currentPhase() === "idle-os");
    expect(framesInUse(dv)).toBe(0);
  });

  it("is deterministic", () => {
    const run = (): string => {
      const g = pre();
      g.powerButton();
      until(g, () => g.currentPhase() === "idle-os");
      const { states } = submit(g, [1, 2].map((k) => generate("cli.calc", 30 + k, { row: JOB_ROW, scale: 16, hosted: true }).program));
      until(g, () => states().every((x) => x === JobState.Result), 60000);
      return [g.snapshot().cycle, g.machine.timer.fired, g.snapshot().mmu!.hits, g.snapshot().mmu!.misses].join(",");
    };
    expect(run()).toBe(run());
  });

  it("the health lines stay quiet on a healthy machine and name a frame the kernel forgot to free", () => {
    const g = pre();
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    const { dv, states } = submit(g, [generate("cli.calc", 11, { row: JOB_ROW, scale: 16, hosted: true }).program]);
    for (let i = 0; i < 200 && !states().every((x) => x === JobState.Result); i++) {
      g.advanceBaseTick();
      for (const h of g.snapshot().health ?? []) expect(h.level).not.toBe("bad");
    }
    until(g, () => states().every((x) => x === JobState.Result), 60000);
    until(g, () => g.currentPhase() === "idle-os");
    // a frame owned by job slot 5, which is not running
    dv.setUint32(FMAP + 4 * 1000, 5 + 1, true);
    for (let i = 0; i < 4; i++) g.snapshot();
    expect(g.snapshot().health!.some((h) => h.level === "bad" && /not give them back/.test(h.text))).toBe(true);
  });

  it("the snapshot carries each running program's page table: the ROM, its image and the pages it claimed, with their bits", () => {
    const g = pre({ keys: [{ template: "cli.scan", scale: 3 }] });
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    g.plugKey(g.trayKeyIds()[0]!);
    let best: number[] = [];
    until(g, () => { const sp = g.snapshot().ram?.vm?.spaces[0]; if (sp && sp.pages.length > best.length) best = sp.pages; return g.completed === 1 && g.pluggedKey() === null; });
    const pages = new Map<number, [number, number]>();
    for (let i = 0; i < best.length; i += 3) pages.set(best[i]!, [best[i + 1]!, best[i + 2]!]);
    expect(pages.get(0)![1]).toBe(5);
    expect(pages.get(0x10)![1]).toBe(7);
    expect([...pages.keys()].some((v) => v >= 0x40 && v < 0x80 && pages.get(v)![1] === 3)).toBe(true);
    expect(pages.get(0xc1)![1]).toBe(5);
  });
});
