import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { KDATA_BASE, KERNEL_BASE, OS_HEADER_BASE, USER_BASE } from "../isa/memmap";
import { KERNEL_IMAGE } from "../os";
import { ECONOMY } from "./economy";
import type { Game } from "./game";
import { codeEndOf, protectedPage, ramRegionsOf, type RamRegion } from "./ramregions";
import { rig } from "./testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const until = (g: Game, done: () => boolean, max = 3000): void => { for (let t = 0; t < max && !done(); t++) g.advanceBaseTick(); expect(done()).toBe(true); };

describe("what lives where in RAM", () => {
  const ram = new Uint8Array(64 * 1024);

  it("the boot ROM is always there; the OS and a program only when they are", () => {
    expect(ramRegionsOf(ram, { os: null, job: null }).map((r) => r.id)).toEqual(["rom"]);
    const r = ramRegionsOf(ram, { os: { name: "Resident OS 1.0" }, job: { key: 7, label: "#07 calc", type: "calc", words: 40 } });
    expect(r.map((x) => x.id)).toEqual(["rom", "os-header", "os-kernel", "os-table", "app-7"]);
    expect(r.find((x) => x.id === "os-header")).toMatchObject({ lo: OS_HEADER_BASE, hi: KERNEL_BASE });
    expect(r.find((x) => x.id === "os-kernel")).toMatchObject({ lo: KERNEL_BASE, hi: KERNEL_BASE + KERNEL_IMAGE.length * 4, name: "Resident OS 1.0" });
    expect(r.find((x) => x.id === "os-table")!.lo).toBe(KDATA_BASE);
    expect(r.find((x) => x.id === "app-7")).toMatchObject({ kind: "app", lo: USER_BASE, hi: USER_BASE + 160, owner: 7, type: "calc" });
  });

  it("regions never overlap and stay inside the memory", () => {
    const small = new Uint8Array(0xd000);
    const r = ramRegionsOf(small, { os: { name: "OS" }, job: { key: 1, label: "#01 x", type: "x", words: 1_000_000 } });
    for (const a of r) { expect(a.hi).toBeLessThanOrEqual(small.length); expect(a.hi).toBeGreaterThan(a.lo); }
    const sorted = [...r].sort((a, b) => a.lo - b.lo);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.lo).toBeGreaterThanOrEqual(sorted[i - 1]!.hi);
  });

  it("the code of a program ends after its last return; what follows is data", () => {
    const { program } = assemble("main:\n  li a0, 1\n  ecall\nf:\n  addi a0, a0, 1\n  ret\ntable:\n  .word 5\n  .word 6");
    const img = new Uint8Array(64);
    new DataView(img.buffer).setUint32(0, 0, true);
    program.forEach((w, i) => new DataView(img.buffer).setUint32(4 * i, w, true));
    const end = codeEndOf(img, 0, program.length * 4);
    expect(end).toBe(4 * (program.length - 2));
  });

  it("a running machine reports the OS and the program it loaded, with the program's bytes in the image", () => {
    const g = rig("ssd1");
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    let s = g.snapshot();
    expect(s.ram!.regions.map((r) => r.id)).toEqual(["rom", "os-header", "os-kernel", "os-table"]);
    expect(s.ram!.image).toHaveLength(g.machine.ram.length);
    const id = g.trayKeyIds()[0]!;
    expect(g.plugKey(id).ok).toBe(true);
    until(g, () => (g.snapshot().ram?.regions ?? []).some((r) => r.kind === "app"));
    // the region is announced when the kernel starts the job; the program arrives a little after (the kernel copies it in from the spool)
    until(g, () => new DataView(g.machine.ram.buffer).getUint32(USER_BASE, true) !== 0);
    s = g.snapshot();
    const app = s.ram!.regions.find((r) => r.kind === "app")!;
    expect(app.owner).toBe(id);
    expect(app.lo).toBe(USER_BASE);
    expect(app.name).toMatch(/^#\d\d /);
    expect(app.codeEnd).toBeGreaterThan(app.lo);
    expect(app.codeEnd).toBeLessThanOrEqual(app.hi);
    // the image is the memory: the program is in it where the region says
    const dv = new DataView(s.ram!.image.buffer, s.ram!.image.byteOffset);
    expect(dv.getUint32(app.lo, true)).not.toBe(0);
    expect(dv.getUint32(KERNEL_BASE, true)).toBe(KERNEL_IMAGE[0]);
    // when the job is done the program leaves the map
    until(g, () => g.completed === 1 && g.pluggedKey() === null, 4000);
    expect(g.snapshot().ram!.regions.some((r) => r.kind === "app")).toBe(false);
  });

  it("a program claims the memory it writes to, never the OS's, and gives it back when it ends", () => {
    // a scan builds a table in memory it was not given (a log only uses registers and claims nothing)
    const g = rig("ssd1", { keys: [{ template: "cli.scan", scale: 3 }] });
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os");
    expect(g.plugKey(g.trayKeyIds()[0]!).ok).toBe(true);
    let seen: RamRegion[] = [];
    until(g, () => { seen = (g.snapshot().ram?.regions ?? []).filter((r) => r.kind === "work"); return seen.length > 0; }, 4000);
    const snap = g.snapshot().ram!;
    const app = snap.regions.find((r) => r.kind === "app")!;
    for (const w of seen) {
      expect(w.owner).toBe(app.owner);
      expect(w.name).toBe(`${app.name} data`);
      expect(w.lo % 256).toBe(0);
      expect(w.lo >= app.hi || w.hi <= app.lo).toBe(true); // outside the program's own image
      for (const o of snap.regions.filter((r) => r.kind === "rom" || r.kind === "os" || r.kind === "osdata")) expect(w.hi <= o.lo || w.lo >= o.hi).toBe(true);
    }
    until(g, () => g.completed === 1 && g.pluggedKey() === null, 4000);
    expect(g.snapshot().ram!.regions.some((r) => r.kind === "work" || r.kind === "app")).toBe(false);
  });

  it("protected pages: the ROM, the OS and the program's own image", () => {
    expect(protectedPage(0, 40)).toBe(true);
    expect(protectedPage(USER_BASE >> 8, 40)).toBe(true);
    expect(protectedPage((USER_BASE >> 8) + 1, 40)).toBe(false);
    expect(protectedPage((USER_BASE >> 8) + 1, 100)).toBe(true);
    expect(protectedPage(KERNEL_BASE >> 8, 40)).toBe(true);
    expect(protectedPage(KDATA_BASE >> 8, 40)).toBe(true);
    expect(protectedPage(0xf0, 40)).toBe(false);
  });

  it("without an OS the key's program is the application, and the OS regions are absent", () => {
    const g = rig("hdd0", { os: false });
    expect(g.plugKey(g.trayKeyIds()[0]!).ok).toBe(true);
    g.powerButton();
    until(g, () => (g.snapshot().ram?.regions ?? []).some((r) => r.kind === "app"), 4000);
    const ids = g.snapshot().ram!.regions.map((r) => r.kind);
    expect(ids).toContain("rom");
    expect(ids).toContain("app");
    expect(ids).not.toContain("os");
  });

  it("the preemptive OS: every owned frame is a region of its program (image, data, page tables), by the OS's frame map", () => {
    const frames = new Array<number>(176).fill(0);
    // job slot 0 (owner 1): tables at 16..19, image at 20..22, data at 40; job slot 2 (owner 3): image at 23..24
    for (let f = 16; f < 20; f++) frames[f] = 0x20 | 1;
    for (let f = 20; f < 23; f++) frames[f] = 1;
    frames[40] = 0x10 | 1;
    for (let f = 23; f < 25; f++) frames[f] = 3;
    const r = ramRegionsOf(new Uint8Array(65536), { os: { name: "Preemptive OS 3.0", tier: 3 }, job: null, frames, procs: [{ key: 7, label: "#07 calc", type: "calc" }, undefined, { key: 9, label: "#09 scan", type: "scan" }] });
    const find = (kind: string, owner?: number) => r.filter((x) => x.kind === kind && (owner === undefined || x.owner === owner));
    expect(find("app", 7)).toMatchObject([{ lo: 20 * 256, hi: 23 * 256 }]);
    expect(find("app", 9)).toMatchObject([{ lo: 23 * 256, hi: 25 * 256 }]);
    expect(find("work", 7)).toMatchObject([{ lo: 40 * 256, hi: 41 * 256 }]);
    expect(r.find((x) => x.id.startsWith("ptab-0"))).toMatchObject({ kind: "osdata", lo: 16 * 256, hi: 20 * 256 });
    expect(r.some((x) => x.id === "os-ktable")).toBe(true);
  });
});
