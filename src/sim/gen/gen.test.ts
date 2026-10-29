import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { createEngine, type EngineConfig } from "../engines";
import { DISPLAY_COLS } from "../isa/memmap";
import { Machine, TpmPort } from "../machine";
import { generate, runReference, TEMPLATE_NAMES } from "./index";
import * as K from "./kernels";

const DEFAULT_FAMILIES = ["cli.log", "cli.calc", "cli.checksum"];
/** Index of the first differing byte, or -1 (cheaper than toEqual on 64 KiB). */
function firstDiff(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : a.length;
}

const SEEDS = Array.from({ length: 50 }, (_, i) => i * 7919 + 1);

describe("determinism and variety", () => {
  it("same seed gives byte-identical assembly and program", () => {
    for (const t of TEMPLATE_NAMES) {
      const a = generate(t, 1234);
      const b = generate(t, 1234);
      expect(b.asm).toBe(a.asm);
      expect(Array.from(b.program)).toEqual(Array.from(a.program));
      expect(b.meta).toEqual(a.meta);
    }
  });

  it("different seeds vary", () => {
    for (const t of TEMPLATE_NAMES) {
      const asms = new Set(SEEDS.map((s) => generate(t, s).asm));
      expect(asms.size).toBeGreaterThan(25);
    }
    const fams = new Set(SEEDS.map((s) => generate("cli", s).meta.kernels.map((k) => k.kernel).join("+")));
    expect(fams.size).toBeGreaterThanOrEqual(3);
  });

  it("rejects bad input", () => {
    expect(() => generate("nope", 1)).toThrow();
    expect(() => generate("cli.log", 1, { scale: 0 })).toThrow();
    expect(() => generate("cli.log", 1, { scale: 20 })).toThrow();
    expect(() => generate("cli.log", 1, { scale: 4, row: 14 })).toThrow();
  });
});

describe("every generated program", () => {
  it("assembles, halts at ecall, prints the expected readable text, stays in mapped memory", () => {
    for (const t of TEMPLATE_NAMES) {
      for (const scale of [1, 3]) {
        for (let s = 0; s < 40; s++) {
          const seed = s * 104729 + scale;
          const g = generate(t, seed, { scale });
          expect(() => assemble(g.asm)).not.toThrow();
          const r = runReference(g, t.startsWith("gpu.") ? 150_000 : 30_000); // RefFault on unmapped access or step overrun
          expect(r.cpu.halted).toBe(true);
          expect(r.text.length).toBeGreaterThan(0);
          expect(r.text).toMatch(/^[\n\x20-\x7e]+$/);
          expect(r.text).toBe(g.meta.expectedText);
          for (const line of r.text.split("\n")) expect(line.length).toBeLessThanOrEqual(DISPLAY_COLS);
          expect(g.meta.kernels.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("honours row and jobId", () => {
    const g = generate("cli.calc", 5, { row: 3, jobId: 7 });
    const text = runReference(g).text;
    expect(text).toBe(g.meta.expectedText);
    expect(text.split("\n")[3]).toMatch(/^#07 mul=\d\d OK$/);
    expect(text.split("\n").slice(0, 3)).toEqual(["", "", ""]);
  });

  it("matches the reference on unpipelined and in-order engines", () => {
    const cfgs: EngineConfig[] = [
      { kind: "unpipelined" },
      { kind: "inorder", forwarding: true, sharedPort: false },
      { kind: "inorder", forwarding: false, sharedPort: true },
    ];
    for (const t of TEMPLATE_NAMES) {
      for (let s = 0; s < 4; s++) {
        const g = generate(t, s * 31 + 9, { scale: 1 + (s % 2) });
        const ref = runReference(g);
        for (const cfg of cfgs) {
          const m = new Machine({ ramSize: 1024 * 1024 }); // the reference has room for the big-heap jobs
          const tpm = new TpmPort(null, m.ram, m.prng, true); // the secure job talks to a TPM: an instant one, like the reference interpreter has
          tpm.configure({ measureTicks: 0, attestTicks: 0, surcharge: 0 });
          m.addDevice(tpm);
          const e = createEngine(cfg);
          m.attach(e, g.program);
          let guard = 0;
          while (!e.halted) {
            e.step();
            if (++guard > 400_000) throw new Error(`${t} seed ${s} ${cfg.kind} did not halt`);
          }
          expect(Array.from(m.regs)).toEqual(Array.from(ref.cpu.regs));
          expect(firstDiff(m.ram, ref.cpu.mem.ram.bytes)).toBe(-1);
          expect(m.display.text()).toBe(ref.text);
        }
      }
    }
  }, 60_000);
});

describe("pacing", () => {
  it("default CLI request families run 20..40 instructions at scale 1", () => {
    const counts: Record<string, number[]> = {};
    for (const t of DEFAULT_FAMILIES) {
      counts[t] = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => runReference(generate(t, s)).steps);
      for (const n of counts[t]!) {
        expect(n).toBeGreaterThanOrEqual(20);
        expect(n).toBeLessThanOrEqual(40);
      }
    }
    // Measured: log 20-22 (message length), calc 36 or 40 (1 or 2 multiply rounds), checksum 40.
    expect(counts["cli.checksum"]!.every((n) => n === 40)).toBe(true);
    for (let s = 1; s <= 30; s++) {
      const n = runReference(generate("cli", s)).steps;
      expect(n).toBeGreaterThanOrEqual(20);
      expect(n).toBeLessThanOrEqual(40);
    }
  });

  it("scale makes requests heavier", () => {
    for (const t of TEMPLATE_NAMES.filter((x) => x !== "cli")) {
      const a = runReference(generate(t, 3, { scale: 1 }), 300_000).steps;
      const b = runReference(generate(t, 3, { scale: 4 }), 300_000).steps;
      expect(b).toBeGreaterThan(a * 1.5);
    }
  });

  it("scan is the heavy family (documented ~96 at scale 1)", () => {
    const n = runReference(generate("cli.scan", 1)).steps;
    expect(n).toBeGreaterThan(40);
    expect(n).toBeLessThan(130);
  });
});

describe("kernels", () => {
  it("declare disjoint namespaces and mix tags", () => {
    const g = generate("cli.scan", 2);
    const nss = g.meta.kernels.map((k) => k.ns);
    expect(new Set(nss).size).toBe(nss.length);
    for (const k of g.meta.kernels) expect(k.mix.length).toBeGreaterThan(0);
    expect(g.meta.mix).toContain("mem");
    expect(g.meta.footprintBytes).toBeGreaterThan(0);
  });

  it("print_dec zero-pads, memcpy copies, print_str stops at NUL, poll_idle falls through", () => {
    const src = [
      "main:",
      "  li s0, 1073741824",
      "  addi a0, s0, 0", "  li a1, 7", "  call p3",
      "  addi a0, s0, 8", "  li a1, 1028", "  call p4",
      "  addi a0, s0, 16", "  la a1, msg", "  call ps",
      "  addi a0, s0, 32", "  la a1, msg", "  li a2, 3", "  call mc",
      "  call poll",
      "  ecall",
      K.printDec("p3", 3).asm, K.printDec("p4", 4).asm, K.printStr("ps").asm, K.memcpy("mc").asm, K.pollIdle("poll").asm,
      "msg:", '  .string "hello"', "  .align",
    ].join("\n");
    const { program } = assemble(src);
    const m = new Machine({ ramSize: 1024 * 1024 }); // the reference has room for the big-heap jobs
    m.attach(createEngine({ kind: "ref" }), program);
    let n = 0;
    while (!m.engine!.halted && n++ < 1000) m.engine!.step();
    const row = m.display.text().split("\n")[0]!;
    expect(row.slice(0, 3)).toBe("007");
    expect(row.slice(8, 12)).toBe("1028");
    expect(row.slice(16, 21)).toBe("hello");
    expect(row.slice(32, 35)).toBe("hel");
  });
});
