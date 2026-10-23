import { describe, expect, it } from "vitest";
import { Game } from "../game/game";
import { generate, runReference } from "../gen";
import { disassemble } from "../isa";
import { JOB_ROW, PCH_BASE, PCH_REG, PchPhase, ROM_DONE_VECTOR, USER_BASE } from "../isa/memmap";
import { Display } from "../machine/display";
import { Pch } from "./pch";
import { ROM_IMAGE, ROM_SYMBOLS } from "./rom";

describe("boot ROM image", () => {
  it("is a small program with reset at 0, the done vector at ROM_DONE_VECTOR, and room below USER_BASE", () => {
    expect(ROM_SYMBOLS.get("reset")).toBe(0);
    expect(ROM_SYMBOLS.get("done")).toBe(ROM_DONE_VECTOR);
    expect(ROM_IMAGE.length * 4).toBeLessThan(USER_BASE);
    expect(disassemble(ROM_IMAGE[0]!)).toMatch(/^jal zero/);
    expect(disassemble(ROM_IMAGE[ROM_DONE_VECTOR / 4]!)).toMatch(/^jal zero/);
  });
});

describe("hosted programs", () => {
  it("end by jumping to the ROM done vector instead of ecall, and are otherwise the standalone program", () => {
    for (const t of ["cli.log", "cli.calc", "cli.checksum", "cli.scan"]) {
      const alone = generate(t, 5, { scale: 2 });
      const hosted = generate(t, 5, { scale: 2, hosted: true });
      expect(hosted.program.length).toBe(alone.program.length + 1);
      expect(hosted.meta.expectedText).toBe(alone.meta.expectedText);
      const text = Array.from(hosted.program).map(disassemble);
      const at = text.indexOf(`addi t0, zero, ${ROM_DONE_VECTOR}`);
      expect(at).toBeGreaterThan(0);
      expect(text[at + 1]).toBe("jalr zero, t0, 0");
      expect(text).not.toContain("ecall");
      expect(Array.from(alone.program).map(disassemble)).toContain("ecall");
      expect(runReference(alone).steps).toBeGreaterThan(10);
    }
  });
});

describe("PCH device", () => {
  function pch() {
    const display = new Display();
    const p = new Pch(display);
    p.powerOn(32, 1);
    return { p, display };
  }
  const word = (p: Pch, off: number) => (p.read(off) | (p.read(off + 1) << 8) | (p.read(off + 2) << 16) | (p.read(off + 3) << 24)) >>> 0;

  it("reports key status, length and the hardware facts", () => {
    const { p } = pch();
    expect(word(p, PCH_REG.STATUS)).toBe(0);
    expect(word(p, PCH_REG.RAM_KB)).toBe(32);
    expect(word(p, PCH_REG.CPU_TIER)).toBe(1);
    expect(word(p, PCH_REG.PHASE)).toBe(PchPhase.Posting);
    p.plug({ program: new Uint32Array([0x11223344, 5]), done: false, result: "" });
    expect(word(p, PCH_REG.STATUS)).toBe(1);
    expect(word(p, PCH_REG.KEY_LEN)).toBe(2);
    expect(word(p, 0x1000)).toBe(0x11223344); // key window
    expect(word(p, 0x1004)).toBe(5);
    expect(p.wordsRead).toBe(2);
    p.unplug();
    expect(word(p, PCH_REG.STATUS)).toBe(4); // gone, and the removal is latched until acknowledged
    p.write(PCH_REG.CTRL, 2);
    expect(word(p, PCH_REG.STATUS)).toBe(0);
  });

  it("CTRL blanks the display and DONE captures the result text from the result window", () => {
    const { p, display } = pch();
    display.cells[3] = 65;
    p.write(PCH_REG.CTRL, 1);
    expect(display.cells[3]).toBe(0);
    const key = { program: new Uint32Array(1), done: false, result: "" };
    p.plug(key);
    "OK 7".split("").forEach((c, i) => p.write(0x4000 + i, c.charCodeAt(0)));
    p.write(PCH_REG.RESULT_LEN, 2);
    p.write(PCH_REG.DONE, 1);
    expect(key).toMatchObject({ done: true, result: "OK 7" });
    expect(word(p, PCH_REG.STATUS)).toBe(3);
  });

  it("is mapped at PCH_BASE on the machine bus", () => {
    const g = new Game({ seed: 1, preassembled: true });
    expect(g.machine.bus.load32(PCH_BASE + PCH_REG.RAM_KB)).toBe(16);
  });
});

describe("the loader on the real engine", () => {
  it("copies the key's program into RAM at USER_BASE with load/store instructions, then runs it", () => {
    const g = new Game({ seed: 3, preassembled: true, economy: { baseDemandPerTick: 0 } });
    while (g.currentPhase() !== "waiting-for-key") g.advanceBaseTick();
    const key = g.toSave().tray[0]!;
    g.plugKey(key.id);
    while (g.currentPhase() !== "running") g.advanceBaseTick();
    const want = generate(key.template, key.seed, { scale: key.scale, row: JOB_ROW, hosted: true }).program;
    const ram = new Uint32Array(g.machine.ram.buffer, USER_BASE, want.length);
    expect(Array.from(ram)).toEqual(Array.from(want));
    // the engine really executed the copy: far more retired instructions than the program has
    expect(g.snapshot().counters.retired).toBeGreaterThan(want.length * 4);
  });
});
