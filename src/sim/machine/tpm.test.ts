import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { TPM_BASE, TPM_HOP_TICKS, TPM_REG, TPM_SEAL_TICKS, TpmCmd, TpmFault, TpmStatus } from "../isa/memmap";
import { Machine } from "./machine";
import { RefEngine } from "./refEngine";
import { TpmPort, wordHash, type TpmConfig } from "./tpm";

const TPM1: TpmConfig = { measureTicks: 4, attestTicks: 60, surcharge: 2 };
const TPM2: TpmConfig = { measureTicks: 1, attestTicks: 20, surcharge: 1 };
const R = (r: number) => TPM_BASE + r;

/** A machine with a module at one tick per base tick, so `advanceBaseTick` is one module tick. */
function rig(cfg: TpmConfig | null = TPM1, seed = 1) {
  const m = new Machine({ ramSize: 16 * 1024, seed });
  const tpm = new TpmPort(m.bus, m.ram, m.prng);
  m.addDevice(tpm);
  m.clock.setRate("tpm", { mul: 1, div: 1 });
  tpm.configure(cfg);
  const status = () => m.bus.load32(R(TPM_REG.STATUS));
  /** Run a command and tick until it is done; returns the ticks it took. */
  const run = (cmd: number, a0 = 0, a1 = 0): number => {
    m.bus.store32(R(TPM_REG.ARG0), a0);
    m.bus.store32(R(TPM_REG.ARG1), a1);
    m.bus.store32(R(TPM_REG.CMD), cmd);
    let n = 0;
    while (status() & TpmStatus.Busy) { m.advanceBaseTick(); if (++n > 100000) throw new Error("tpm never finished"); }
    return n;
  };
  const result = () => m.bus.load32(R(TPM_REG.RESULT));
  const fault = () => m.bus.load32(R(TPM_REG.FAULT));
  return { m, tpm, status, run, result, fault };
}

describe("TPM on the bus", () => {
  it("reports presence and an idle status; an empty header reads as nothing", () => {
    expect(rig().status()).toBe(TpmStatus.Present);
    const none = rig(null);
    expect(none.status()).toBe(0);
    none.m.bus.store32(R(TPM_REG.CMD), TpmCmd.Attest);
    expect(none.fault()).toBe(TpmFault.BadCommand);
  });

  it("measure hashes a RAM range with the checksum kernel's hash, one hop each way plus measureTicks per word", () => {
    const { m, run, result, status } = rig();
    const words = [7, 0xdeadbeef, 3, 99, 12345];
    words.forEach((w, k) => m.bus.store32(0x1000 + 4 * k, w));
    const ticks = run(TpmCmd.Measure, 0x1000, words.length);
    expect(result()).toBe(wordHash(words));
    expect(ticks).toBe(TPM_HOP_TICKS + 4 * words.length + TPM_HOP_TICKS);
    expect(status() & TpmStatus.Done).toBeTruthy();
    expect(run(TpmCmd.Measure, 0x1000, 10)).toBe(2 * TPM_HOP_TICKS + 40); // cost scales with the range
  });

  it("the better module measures and attests faster", () => {
    const a = rig(TPM1), b = rig(TPM2);
    expect(a.run(TpmCmd.Measure, 0x1000, 8)).toBe(2 * TPM_HOP_TICKS + 32);
    expect(b.run(TpmCmd.Measure, 0x1000, 8)).toBe(2 * TPM_HOP_TICKS + 8);
    expect(a.run(TpmCmd.Attest, 5)).toBe(2 * TPM_HOP_TICKS + 60);
    expect(b.run(TpmCmd.Attest, 5)).toBe(2 * TPM_HOP_TICKS + 20);
  });

  it("the quote is deterministic per machine seed and follows the nonce", () => {
    const quote = (seed: number, nonce: number) => { const r = rig(TPM1, seed); r.run(TpmCmd.Attest, nonce); return r.result(); };
    expect(quote(5, 100)).toBe(quote(5, 100));
    expect(quote(5, 100)).not.toBe(quote(6, 100));
    expect((quote(5, 100) ^ quote(5, 101)) >>> 0).toBe(100 ^ 101);
  });

  it("attest is the only command that touches the machine PRNG", () => {
    const { m, run } = rig(TPM1, 9);
    const before = m.prng.getState();
    run(TpmCmd.Measure, 0x1000, 4);
    run(TpmCmd.Seal, 1, 2);
    run(TpmCmd.Unseal, 1);
    run(TpmCmd.Protect, 0, 16);
    run(TpmCmd.Unprotect);
    expect(m.prng.getState()).toBe(before);
    run(TpmCmd.Attest, 0);
    expect(m.prng.getState()).not.toBe(before);
  });

  it("seal and unseal keep a value under a handle, across a power cycle; an unknown handle is refused", () => {
    const { tpm, run, result, status, fault } = rig();
    expect(run(TpmCmd.Seal, 7, 0xabcd)).toBe(2 * TPM_HOP_TICKS + TPM_SEAL_TICKS);
    tpm.reset();
    run(TpmCmd.Unseal, 7);
    expect(result()).toBe(0xabcd);
    run(TpmCmd.Unseal, 8);
    expect(fault()).toBe(TpmFault.NoSuchKey);
    expect(status() & TpmStatus.Error).toBeTruthy();
    tpm.configure(null);
    tpm.configure(TPM1);
    run(TpmCmd.Unseal, 7);
    expect(fault()).toBe(TpmFault.NoSuchKey); // taking the module out loses its secrets
  });

  it("refuses a bad range, an unknown command and a command while busy", () => {
    const { m, run, fault, status } = rig();
    run(TpmCmd.Measure, 0x1000, 0);
    expect(fault()).toBe(TpmFault.BadRange);
    run(TpmCmd.Measure, 0x1002, 4);
    expect(fault()).toBe(TpmFault.BadRange);
    run(TpmCmd.Measure, 0x3ff0, 100); // past the end of RAM
    expect(fault()).toBe(TpmFault.BadRange);
    run(99);
    expect(fault()).toBe(TpmFault.BadCommand);
    m.bus.store32(R(TPM_REG.ARG0), 0x1000);
    m.bus.store32(R(TPM_REG.ARG1), 4);
    m.bus.store32(R(TPM_REG.CMD), TpmCmd.Measure);
    m.bus.store32(R(TPM_REG.CMD), TpmCmd.Attest); // while the first is in flight
    expect(fault()).toBe(TpmFault.BadCommand);
    expect(status() & TpmStatus.Busy).toBeTruthy();
  });
});

describe("TPM protected mode", () => {
  /** Protect [0x1000, 0x1100) and return the rig. */
  function protectedRig(cfg = TPM1) {
    const r = rig(cfg);
    r.run(TpmCmd.Protect, 0x1000, 64);
    return r;
  }

  it("is on after Protect and off after Unprotect, and shows in the status", () => {
    const r = protectedRig();
    expect(r.status() & TpmStatus.Protected).toBeTruthy();
    r.run(TpmCmd.Unprotect);
    expect(r.status() & TpmStatus.Protected).toBe(0);
    expect(r.m.bus.guard).toBeNull();
  });

  it("charges the surcharge per RAM access inside the range, and nothing for devices", () => {
    const r = protectedRig();
    r.m.bus.guardOn = true; // as while the CPU runs
    r.m.bus.stallCycles = 0;
    r.m.bus.store32(0x1000, 5);
    r.m.bus.load32(0x1004);
    r.m.bus.load8(0x1008);
    expect(r.m.bus.stallCycles).toBe(3 * 2);
    r.m.bus.stallCycles = 0;
    r.m.bus.load32(R(TPM_REG.STATUS)); // a device, not RAM
    expect(r.m.bus.stallCycles).toBe(0);
    const better = protectedRig(TPM2);
    better.m.bus.guardOn = true;
    better.m.bus.stallCycles = 0;
    better.m.bus.load32(0x1000);
    expect(better.m.bus.stallCycles).toBe(1);
  });

  it("refuses RAM access outside the range: reads give 0, writes are dropped, and the job is marked for death", () => {
    const r = protectedRig();
    r.m.bus.guardOn = true;
    r.m.ram[0x2000] = 0xaa;
    expect(r.m.bus.load8(0x2000)).toBe(0);
    r.m.bus.store32(0x2000, 0x12345678);
    expect(r.m.ram[0x2000]).toBe(0xaa);
    expect(r.tpm.takeViolation()).toBe(true);
    expect(r.tpm.takeViolation()).toBe(false);
    expect(r.fault()).toBe(TpmFault.Violation);
    expect(r.status() & TpmStatus.Error).toBeTruthy();
  });

  it("the machine waits out the surcharge: a CPU loop touching RAM in protected mode runs slower", () => {
    const prog = assemble("li t0, 4096\nli t1, 50\nloop: lw t2, 0(t0)\naddi t1, t1, -1\nbne t1, zero, loop\necall").program;
    const ticks = (guarded: boolean): number => {
      const r = rig();
      if (guarded) r.run(TpmCmd.Protect, 0x0, 16 * 1024 / 4 - 1);
      r.m.attach(new RefEngine(), prog);
      const t0 = r.m.clock.baseTicks;
      while (!r.m.engine!.halted) r.m.advanceBaseTick();
      return r.m.clock.baseTicks - t0;
    };
    const free = ticks(false), slow = ticks(true);
    expect(slow).toBeGreaterThan(free);
    expect(slow - free).toBeGreaterThanOrEqual(2 * 50); // every load pays its two extra cycles at least
  });

  it("a reset (power-on) ends protected mode", () => {
    const r = protectedRig();
    r.tpm.reset();
    expect(r.status()).toBe(TpmStatus.Present);
    expect(r.m.bus.guard).toBeNull();
  });
});

describe("the reference interpreter's fake TPM (instant)", () => {
  it("finishes at once with the same results", () => {
    const m = new Machine({ ramSize: 16 * 1024, seed: 4 });
    const tpm = new TpmPort(null, m.ram, m.prng, true);
    tpm.configure(TPM1);
    [1, 2, 3].forEach((w, k) => m.bus.store32(0x1000 + 4 * k, w));
    const word = (reg: number) => (tpm.read(reg) | (tpm.read(reg + 1) << 8) | (tpm.read(reg + 2) << 16) | (tpm.read(reg + 3) << 24)) >>> 0;
    const put = (reg: number, v: number) => { for (let k = 0; k < 4; k++) tpm.write(reg + k, (v >>> (8 * k)) & 0xff); };
    put(TPM_REG.ARG0, 0x1000);
    put(TPM_REG.ARG1, 3);
    put(TPM_REG.CMD, TpmCmd.Measure);
    expect(tpm.read(TPM_REG.STATUS) & TpmStatus.Busy).toBe(0);
    expect(tpm.read(TPM_REG.STATUS) & TpmStatus.Done).toBeTruthy();
    expect(word(TPM_REG.RESULT)).toBe(wordHash([1, 2, 3]));
  });
});
