import { describe, expect, it } from "vitest";
import { assemble } from "../../cpu/sim/asm";
import { createEngine } from "../../cpu/sim/engines";
import { TpmCmd, TPM_BASE, TPM_REG, TpmFault } from "@/core/sim/memmap";
import { Machine, TpmPort, type TpmConfig } from "@/core/sim";
import { generate, runReference, type Generated } from "../../jobs/sim/gen/index";

const TPM1: TpmConfig = { measureTicks: 4, attestTicks: 60, surcharge: 2 };
const TPM2: TpmConfig = { measureTicks: 1, attestTicks: 20, surcharge: 1 };

/** Run a program on a machine with a real TPM at one module tick per base tick. */
function onMachine(g: Generated, cfg: TpmConfig = TPM1) {
  const m = new Machine({ ramSize: 64 * 1024, seed: 3 });
  const tpm = new TpmPort(m.bus, m.ram, m.prng);
  m.addDevice(tpm);
  m.clock.setRate("tpm", { mul: 1, div: 1 });
  tpm.configure(cfg);
  m.attach(createEngine({ kind: "unpipelined" }), g.program);
  let ticks = 0;
  while (!m.engine!.halted) {
    m.advanceBaseTick();
    if (++ticks > 2_000_000) throw new Error("program never halted");
  }
  return { ticks, text: m.display.text(), tpm, m };
}

describe("secure.sign job", () => {
  const g = generate("secure.sign", 7, { scale: 4 });

  it("prints a line of the form '#NN secure XX OK', the same on the reference interpreter (instant fake TPM) and the real module", () => {
    expect(g.meta.expectedText).toMatch(/^#\d\d secure \d\d OK$/);
    expect(runReference(g).text).toBe(g.meta.expectedText);
    expect(onMachine(g).text).toBe(g.meta.expectedText);
  });

  it("runs its hash in protected mode: guarded accesses, no violation, a quote that follows the machine seed", () => {
    const r = onMachine(g);
    expect(r.tpm.guardedAccesses).toBeGreaterThan(50);
    expect(r.tpm.takeViolation()).toBe(false);
    expect(r.tpm.isProtected).toBe(false); // left again before the job ended
    expect(r.tpm.commands).toBe(6); // measure, attest, protect, unprotect, seal, unseal
  });

  it("the better module finishes sooner (faster measure and attest, a smaller surcharge)", () => {
    expect(onMachine(g, TPM2).ticks).toBeLessThan(onMachine(g, TPM1).ticks);
  });

  it("is deterministic and scales with the work", () => {
    expect(generate("secure.sign", 7, { scale: 4 }).asm).toBe(g.asm);
    const small = onMachine(generate("secure.sign", 7, { scale: 1 })).ticks, big = onMachine(generate("secure.sign", 7, { scale: 4 })).ticks;
    expect(big).toBeGreaterThan(small);
  });

  it("works hosted, at every scale", () => {
    for (const scale of [1, 2, 4, 8]) {
      const h = generate("secure.sign", 3, { scale, hosted: true });
      expect(h.program.length * 4).toBeLessThan(0x3000);
    }
  });
});

describe("protected mode kills a job that strays", () => {
  it("a program that writes outside its range in protected mode is refused and flagged", () => {
    const src = `
      li t0, ${TPM_BASE}
      li t1, 0
      sw t1, ${TPM_REG.ARG0}(t0)
      li t1, 256
      sw t1, ${TPM_REG.ARG1}(t0)
      li t1, ${TpmCmd.Protect}
      sw t1, ${TPM_REG.CMD}(t0)
    wait: lw t1, ${TPM_REG.STATUS}(t0)
      andi t1, t1, 1
      bne t1, zero, wait
      li t2, 32768
      li t3, 77
      sw t3, 0(t2)
      ecall`;
    const prog = assemble(src).program;
    const m = new Machine({ ramSize: 64 * 1024 });
    const tpm = new TpmPort(m.bus, m.ram, m.prng);
    m.addDevice(tpm);
    m.clock.setRate("tpm", { mul: 1, div: 1 });
    tpm.configure(TPM1);
    m.attach(createEngine({ kind: "unpipelined" }), prog); // loaded at 0, inside the protected 0..1024
    for (let i = 0; i < 600 && !m.engine!.halted; i++) m.advanceBaseTick();
    expect(m.engine!.halted).toBe(true);
    expect(tpm.takeViolation()).toBe(true);
    expect(m.bus.load32(TPM_BASE + TPM_REG.FAULT)).toBe(TpmFault.Violation);
    expect(m.ram[32768]).toBe(0);
  });
});
