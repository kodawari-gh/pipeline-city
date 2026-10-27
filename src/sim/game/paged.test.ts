import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { KDATA_BASE, KERNEL_BASE, PAGED_SHIFT, PAGED_TABLES, USER_BASE } from "../isa/memmap";
import { ECONOMY } from "./economy";
import type { Game } from "./game";
import { rig } from "./testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const until = (g: Game, done: () => boolean, max = 6000): void => { for (let t = 0; t < max && !done(); t++) g.advanceBaseTick(); expect(done()).toBe(true); };

/** A machine for the paged OS: an MMU CPU, 64K of RAM, a drive, the OS installed and powered off. */
function paged(opts: { cpu?: string; keys?: { template: string; scale?: number }[]; install?: boolean } = {}): Game {
  const g = rig("ssd1", { cpu: opts.cpu ?? "cpu2", os: false, keys: opts.keys });
  for (const d of g.board.devices.filter((x) => x.spec.startsWith("ram"))) g.uninstall(d.id);
  const ram = g.purchase("ram2");
  if (!ram.ok) throw new Error(ram.reason);
  g.install(ram.invId);
  if (opts.install !== false) {
    const os = g.purchase("os2");
    if (!os.ok) throw new Error(os.reason);
    const r = g.install(os.invId);
    if (!r.ok) throw new Error(r.reason);
  }
  return g;
}

describe("the paged OS", () => {
  it("needs a CPU with an MMU: refused on one without, accepted on one with", () => {
    const g = paged({ cpu: "cpu1", install: false });
    const os = g.purchase("os2");
    expect(os.ok).toBe(true);
    if (os.ok) expect(g.install(os.invId)).toMatchObject({ ok: false, reason: expect.stringMatching(/MMU/) });
    expect(g.cpuHasMmu()).toBe(false);
    expect(paged({ cpu: "cpu2" }).snapshot().os).toMatchObject({ spec: "os2", tier: 2 });
  });

  it("boots, runs a job in its own address space and delivers the result", () => {
    const g = paged();
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.snapshot().display + "").toMatch(/OS READY|/);
    expect(g.plugKey(g.trayKeyIds()[0]!).ok).toBe(true);
    until(g, () => g.completed === 1 && g.pluggedKey() === null);
    expect(g.snapshot().faults).toBe(0);
    expect(g.errors).toBe(0);
  });

  it("the program claims its heap by touching it: the kernel maps a frame for each new page, and gives them back at the end", () => {
    const g = paged({ keys: [{ template: "cli.scan", scale: 3 }] });
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    g.plugKey(g.trayKeyIds()[0]!);
    let claimed = 0;
    until(g, () => { claimed = Math.max(claimed, (g.snapshot().ram?.regions ?? []).filter((r) => r.kind === "work").reduce((n, r) => n + (r.hi - r.lo) / 256, 0)); return g.completed === 1 && g.pluggedKey() === null; });
    expect(claimed).toBeGreaterThanOrEqual(5); // the scan's buffer, about 1.5K
    expect(g.snapshot().mmu).toMatchObject({ tlb: 4 });
    expect(g.snapshot().mmu!.faults).toBeGreaterThanOrEqual(5);
    expect(g.snapshot().mmu!.misses).toBeGreaterThan(0);
    expect(g.snapshot().faults).toBe(0); // page faults the kernel fixed are not job faults
    expect(g.snapshot().ram!.regions.some((r) => r.kind === "app" || r.kind === "work")).toBe(false);
  });

  it("shows the program where its page table puts it: the image at physical + PAGED_SHIFT, and the tables as OS memory", () => {
    const g = paged();
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    g.plugKey(g.trayKeyIds()[0]!);
    until(g, () => (g.snapshot().ram?.regions ?? []).some((r) => r.kind === "app"));
    const regions = g.snapshot().ram!.regions;
    expect(regions.find((r) => r.kind === "app")!.lo).toBe(USER_BASE + PAGED_SHIFT);
    expect(regions.find((r) => r.id === "os-tables")).toMatchObject({ lo: PAGED_TABLES, kind: "osdata" });
  });

  it("a job that writes to the OS, or reaches for memory it has no right to, is killed", () => {
    for (const body of [
      `li s0, ${KERNEL_BASE}\n  sw zero, 0(s0)`, // the kernel: mapped read-only
      `li s0, ${KDATA_BASE}\n  sw zero, 0(s0)`, // the job table
      `li s0, 36864\n  lw a0, 0(s0)`, // 0x9000: nothing of the program's
      `li s0, 0\n  sw zero, 0(s0)`, // the ROM
    ]) {
      const g = paged();
      g.powerButton();
      until(g, () => g.currentPhase() === "idle-os");
      const dv = () => new DataView(g.machine.ram.buffer);
      g.plugKey(g.trayKeyIds()[0]!);
      until(g, () => g.currentPhase() === "running-os" && dv().getUint32(USER_BASE + PAGED_SHIFT, true) !== 0);
      assemble(`${body}\n  li t0, 77\n  sw t0, 0x3000(zero)\nspin:\n  j spin`).program.forEach((w, i) => dv().setUint32(USER_BASE + PAGED_SHIFT + 4 * i, w, true));
      until(g, () => (g.snapshot().faults ?? 0) === 1);
      expect(g.currentPhase()).not.toBe("error");
      // the kernel carries on: it ends the job and goes back to waiting for work
      until(g, () => g.snapshot().plugged?.stage !== "running" && g.snapshot().plugged?.stage !== "queued");
    }
  });

  it("is deterministic", () => {
    const run = () => {
      const g = paged({ keys: [{ template: "cli.scan", scale: 3 }] });
      g.powerButton();
      until(g, () => g.currentPhase() === "idle-os");
      g.plugKey(g.trayKeyIds()[0]!);
      until(g, () => g.completed === 1 && g.pluggedKey() === null);
      return [g.snapshot().cycle, g.snapshot().mmu!.faults, g.snapshot().mmu!.hits, g.snapshot().mmu!.misses].join(",");
    };
    expect(run()).toBe(run());
  });
});
