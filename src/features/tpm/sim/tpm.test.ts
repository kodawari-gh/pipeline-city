import { assert, describe, expect, it } from 'vitest';
import { assemble } from '../../cpu/sim/asm';
import { TPM_BASE, TPM_HOP_TICKS, TPM_REG, TPM_SEAL_TICKS, TpmCmd, TpmFault, TpmStatus } from '@/core/sim/memmap';
import { Machine } from '@/core/sim/machine';
import { RefEngine } from '../../cpu/sim/refEngine';
import { TpmPort, wordHash } from './tpm';
import type * as tpmTypes from './tpm';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const TPM1: tpmTypes.TpmConfig = { measureTicks: 4, attestTicks: 60, surcharge: 2 };
const TPM2: tpmTypes.TpmConfig = { measureTicks: 1, attestTicks: 20, surcharge: 1 };
const R = (r: number) => TPM_BASE + r;

/** A machine with a module at one tick per base tick, so `advanceBaseTick` is one module tick. */
function rig(cfg: tpmTypes.TpmConfig | null = TPM1, seed = 1) {
  const m = new Machine({ ramSize: 16 * 1024, seed });
  const tpm = new TpmPort(m.bus, m.ram, m.prng);
  m.addDevice(tpm);
  m.clock.setRate('tpm', { mul: 1, div: 1 });
  tpm.configure(cfg);
  const status = () => m.bus.load32(R(TPM_REG.STATUS));
  /** Run a command and tick until it is done; returns the ticks it took. */
  const run = (cmd: number, a0 = 0, a1 = 0): number => {
    m.bus.store32(R(TPM_REG.ARG0), a0);
    m.bus.store32(R(TPM_REG.ARG1), a1);
    m.bus.store32(R(TPM_REG.CMD), cmd);
    let n = 0;
    while (status() & TpmStatus.Busy) {
      m.advanceBaseTick();
      if (++n > 100_000) {
        throw new Error('tpm never finished');
      }
    }
    return n;
  };
  const result = () => m.bus.load32(R(TPM_REG.RESULT));
  const fault = () => m.bus.load32(R(TPM_REG.FAULT));
  return { m, tpm, status, run, result, fault };
}

/** The quote of an attestation on a fresh machine with this seed. */
function quote(seed: number, nonce: number) {
  const r = rig(TPM1, seed);
  r.run(TpmCmd.Attest, nonce);
  return r.result();
}

/** Protect [0x1000, 0x1100) and return the rig. */
function protectedRig(cfg = TPM1) {
  const r = rig(cfg);
  r.run(TpmCmd.Protect, 0x10_00, 64);
  return r;
}

/** Serve core k, in the address space `table` (null: translation off). */
function serveIn(m: Machine, k: number, table: number | null) {
  const c = m.cores[k];
  assert.exists(c);
  c.mmu.enabled = table !== null;
  c.mmu.table = table ?? 0;
  m.bus.serve(k, c.mpu);
}

/** Base ticks a program takes on a fresh rig, with all of RAM protected when `guarded`. */
function loopTicks(prog: Uint32Array, guarded: boolean): number {
  const r = rig();
  if (guarded) {
    r.run(TpmCmd.Protect, 0x0, (16 * 1024) / 4 - 1);
  }
  r.m.attach(new RefEngine(), prog);
  const t0 = r.m.clock.baseTicks;
  while (!must(r.m.engine).halted) {
    r.m.advanceBaseTick();
  }
  return r.m.clock.baseTicks - t0;
}

describe('TPM on the bus', () => {
  it('reports presence and an idle status; an empty header reads as nothing', () => {
    expect(rig().status()).toBe(TpmStatus.Present);
    const none = rig(null);
    expect(none.status()).toBe(0);
    none.m.bus.store32(R(TPM_REG.CMD), TpmCmd.Attest);
    expect(none.fault()).toBe(TpmFault.BadCommand);
  });

  it("measure hashes a RAM range with the checksum kernel's hash, one hop each way plus measureTicks per word", () => {
    const { m, run, result, status } = rig();
    const words = [7, 0xde_ad_be_ef, 3, 99, 12_345];
    for (const [k, w] of words.entries()) {
      m.bus.store32(0x10_00 + 4 * k, w);
    }
    const ticks = run(TpmCmd.Measure, 0x10_00, words.length);
    expect(result()).toBe(wordHash(words));
    expect(ticks).toBe(TPM_HOP_TICKS + 4 * words.length + TPM_HOP_TICKS);
    expect(status() & TpmStatus.Done).toBe(TpmStatus.Done);
    expect(run(TpmCmd.Measure, 0x10_00, 10)).toBe(2 * TPM_HOP_TICKS + 40); // cost scales with the range
  });

  it('the better module measures and attests faster', () => {
    const a = rig(TPM1),
      b = rig(TPM2);
    expect(a.run(TpmCmd.Measure, 0x10_00, 8)).toBe(2 * TPM_HOP_TICKS + 32);
    expect(b.run(TpmCmd.Measure, 0x10_00, 8)).toBe(2 * TPM_HOP_TICKS + 8);
    expect(a.run(TpmCmd.Attest, 5)).toBe(2 * TPM_HOP_TICKS + 60);
    expect(b.run(TpmCmd.Attest, 5)).toBe(2 * TPM_HOP_TICKS + 20);
  });

  it('the quote is deterministic per machine seed and follows the nonce', () => {
    expect(quote(5, 100)).toBe(quote(5, 100));
    expect(quote(5, 100)).not.toBe(quote(6, 100));
    expect((quote(5, 100) ^ quote(5, 101)) >>> 0).toBe(100 ^ 101);
  });

  it('attest is the only command that touches the machine PRNG', () => {
    const { m, run } = rig(TPM1, 9);
    const before = m.prng.getState();
    run(TpmCmd.Measure, 0x10_00, 4);
    run(TpmCmd.Seal, 1, 2);
    run(TpmCmd.Unseal, 1);
    run(TpmCmd.Protect, 0, 16);
    run(TpmCmd.Unprotect);
    expect(m.prng.getState()).toBe(before);
    run(TpmCmd.Attest, 0);
    expect(m.prng.getState()).not.toBe(before);
  });

  it('seal and unseal keep a value under a handle, across a power cycle; an unknown handle is refused', () => {
    const { tpm, run, result, status, fault } = rig();
    expect(run(TpmCmd.Seal, 7, 0xab_cd)).toBe(2 * TPM_HOP_TICKS + TPM_SEAL_TICKS);
    tpm.reset();
    run(TpmCmd.Unseal, 7);
    expect(result()).toBe(0xab_cd);
    run(TpmCmd.Unseal, 8);
    expect(fault()).toBe(TpmFault.NoSuchKey);
    expect(status() & TpmStatus.Error).toBe(TpmStatus.Error);
    tpm.configure(null);
    tpm.configure(TPM1);
    run(TpmCmd.Unseal, 7);
    expect(fault()).toBe(TpmFault.NoSuchKey); // taking the module out loses its secrets
  });

  it('refuses a bad range, an unknown command and a command while busy', () => {
    const { m, run, fault, status } = rig();
    run(TpmCmd.Measure, 0x10_00, 0);
    expect(fault()).toBe(TpmFault.BadRange);
    run(TpmCmd.Measure, 0x10_02, 4);
    expect(fault()).toBe(TpmFault.BadRange);
    run(TpmCmd.Measure, 0x3f_f0, 100); // past the end of RAM
    expect(fault()).toBe(TpmFault.BadRange);
    run(99);
    expect(fault()).toBe(TpmFault.BadCommand);
    m.bus.store32(R(TPM_REG.ARG0), 0x10_00);
    m.bus.store32(R(TPM_REG.ARG1), 4);
    m.bus.store32(R(TPM_REG.CMD), TpmCmd.Measure);
    m.bus.store32(R(TPM_REG.CMD), TpmCmd.Attest); // while the first is in flight
    expect(fault()).toBe(TpmFault.BadCommand);
    expect(status() & TpmStatus.Busy).toBe(TpmStatus.Busy);
  });
});

describe('TPM protected mode', () => {
  it('is on after Protect and off after Unprotect, and shows in the status', () => {
    const r = protectedRig();
    expect(r.status() & TpmStatus.Protected).toBe(TpmStatus.Protected);
    r.run(TpmCmd.Unprotect);
    expect(r.status() & TpmStatus.Protected).toBe(0);
    expect(r.m.bus.guard).toBeNull();
  });

  it('charges the surcharge per RAM access inside the range, and nothing for devices', () => {
    const r = protectedRig();
    r.m.bus.guardOn = true; // as while the CPU runs
    r.m.bus.stallCycles = 0;
    r.m.bus.store32(0x10_00, 5);
    r.m.bus.load32(0x10_04);
    r.m.bus.load8(0x10_08);
    expect(r.m.bus.stallCycles).toBe(3 * 2);
    r.m.bus.stallCycles = 0;
    r.m.bus.load32(R(TPM_REG.STATUS)); // a device, not RAM
    expect(r.m.bus.stallCycles).toBe(0);
    const better = protectedRig(TPM2);
    better.m.bus.guardOn = true;
    better.m.bus.stallCycles = 0;
    better.m.bus.load32(0x10_00);
    expect(better.m.bus.stallCycles).toBe(1);
  });

  it('guards only the address space that asked for it: the kernel and other programs on other cores read RAM freely', () => {
    // A multicore machine: core 0 runs the secure job in its own address space; the others run the kernel (translation off) and another job.
    const m = new Machine({ ramSize: 16 * 1024, seed: 1, cores: 3 });
    const tpm = new TpmPort(m.bus, m.ram, m.prng);
    m.addDevice(tpm);
    m.clock.setRate('tpm', { mul: 1, div: 1 });
    tpm.configure(TPM1);
    const as = (k: number, table: number | null) => {
      serveIn(m, k, table);
    };
    as(0, 0x10_00);
    m.bus.store32(R(TPM_REG.ARG0), 0x10_00);
    m.bus.store32(R(TPM_REG.ARG1), 64);
    m.bus.store32(R(TPM_REG.CMD), TpmCmd.Protect);
    while (m.bus.load32(R(TPM_REG.STATUS)) & TpmStatus.Busy) {
      m.advanceBaseTick();
    }
    m.bus.guardOn = true;
    m.ram[0x20_00] = 0xaa;
    m.bus.stallCycles = 0;
    // another core with translation off (the kernel), and another program's space: no refusal, no surcharge, no violation
    for (const space of [null, 0x20_00]) {
      as(1, space);
      expect(m.bus.load8(0x20_00)).toBe(0xaa);
      m.bus.load32(0x10_00);
      m.bus.store32(0x20_04, 7);
      expect(m.ram[0x20_04]).toBe(7);
    }
    expect(m.bus.stallCycles).toBe(0);
    expect(tpm.takeViolation()).toBe(false);
    // the protected program itself, on any core (the OS may move it), is still guarded
    as(2, 0x10_00);
    expect(m.bus.load8(0x20_00)).toBe(0);
    expect(tpm.takeViolation()).toBe(true);
  });

  it("in a paged space the range is virtual: the guard allows the job's frames, not the identity physical addresses; measure reads through the table", () => {
    const m = new Machine({ ramSize: 16 * 1024, seed: 1 });
    const tpm = new TpmPort(m.bus, m.ram, m.prng);
    m.addDevice(tpm);
    m.clock.setRate('tpm', { mul: 1, div: 1 });
    tpm.configure(TPM1);
    const L1 = 0x1_00,
      L2 = 0x2_00,
      RWX = 7;
    const pte = (frame: number) => ((frame << 8) | RWX) >>> 0;
    m.bus.store32(L1, ((L2 >> 8) << 8) | 1); // level 1 entry 0 -> the level 2 table
    const map = (vpn: number, frame: number) => {
      m.bus.store32(L2 + 4 * (vpn & 63), pte(frame));
    };
    map(0x10, 0x20); // virtual 0x1000 -> physical 0x2000
    map(0x11, 0x28); // virtual 0x1100 -> physical 0x2800 (not adjacent)
    assert.exists(m.cores[0]);
    const [{ mmu }] = m.cores;
    mmu.table = L1;
    mmu.enabled = true;
    const run = (cmd: number, a0 = 0, a1 = 0) => {
      m.bus.store32(R(TPM_REG.ARG0), a0);
      m.bus.store32(R(TPM_REG.ARG1), a1);
      m.bus.store32(R(TPM_REG.CMD), cmd);
      while (m.bus.load32(R(TPM_REG.STATUS)) & TpmStatus.Busy) {
        m.advanceBaseTick();
      }
    };
    // measure through the table: the words sit in the job's frames
    const words = [3, 1, 4, 1, 5];
    for (const [k, w] of words.entries()) {
      m.bus.store32(0x20_00 + 4 * k, w);
    }
    run(TpmCmd.Measure, 0x10_00, words.length);
    expect(m.bus.load32(R(TPM_REG.RESULT))).toBe(wordHash(words));
    // protect three pages; the third is not mapped yet
    run(TpmCmd.Protect, 0x10_00, 192);
    const viewResult = tpm.view();
    assert.exists(viewResult);
    expect(viewResult.range).toStrictEqual({ lo: 0x10_00, hi: 0x13_00 }); // the view keeps the virtual range
    m.bus.guardOn = true;
    m.bus.stallCycles = 0;
    m.bus.load8(0x20_00);
    m.bus.load32(0x20_fc);
    m.bus.load8(0x28_00);
    m.bus.store32(0x28_fc, 1);
    expect(m.bus.stallCycles).toBe(4 * 2);
    expect(tpm.takeViolation()).toBe(false);
    // the identity physical addresses and the gap between the frames are outside
    for (const pa of [0x10_00, 0x11_00, 0x24_00]) {
      expect(m.bus.load8(pa)).toBe(0);
      expect(tpm.takeViolation()).toBe(true);
    }
    // a page mapped after Protect is accepted
    m.bus.guardOn = false; // the OS writes the table, unguarded
    map(0x12, 0x30);
    m.bus.guardOn = true;
    m.bus.store32(0x30_00, 9);
    expect(tpm.takeViolation()).toBe(false);
    expect(m.ram[0x30_00]).toBe(9);
    // translation off: a physical range, as before
    m.bus.guardOn = false;
    run(TpmCmd.Unprotect);
    mmu.enabled = false;
    run(TpmCmd.Protect, 0x10_00, 64);
    m.bus.guardOn = true;
    m.bus.load8(0x10_00);
    expect(tpm.takeViolation()).toBe(false);
    m.bus.load8(0x20_00);
    expect(tpm.takeViolation()).toBe(true);
  });

  it('refuses RAM access outside the range: reads give 0, writes are dropped, and the job is marked for death', () => {
    const r = protectedRig();
    r.m.bus.guardOn = true;
    r.m.ram[0x20_00] = 0xaa;
    expect(r.m.bus.load8(0x20_00)).toBe(0);
    r.m.bus.store32(0x20_00, 0x12_34_56_78);
    expect(r.m.ram[0x20_00]).toBe(0xaa);
    expect(r.tpm.takeViolation()).toBe(true);
    expect(r.tpm.takeViolation()).toBe(false);
    expect(r.fault()).toBe(TpmFault.Violation);
    expect(r.status() & TpmStatus.Error).toBe(TpmStatus.Error);
  });

  it('the machine waits out the surcharge: a CPU loop touching RAM in protected mode runs slower', () => {
    const prog = assemble(
      'li t0, 4096\nli t1, 50\nloop: lw t2, 0(t0)\naddi t1, t1, -1\nbne t1, zero, loop\necall',
    ).program;
    const ticks = (guarded: boolean): number => loopTicks(prog, guarded);
    const free = ticks(false),
      slow = ticks(true);
    expect(slow).toBeGreaterThan(free);
    expect(slow - free).toBeGreaterThanOrEqual(2 * 50); // every load pays its two extra cycles at least
  });

  it('a reset (power-on) ends protected mode', () => {
    const r = protectedRig();
    r.tpm.reset();
    expect(r.status()).toBe(TpmStatus.Present);
    expect(r.m.bus.guard).toBeNull();
  });
});

describe("the reference interpreter's fake TPM (instant)", () => {
  it('finishes at once with the same results', () => {
    const m = new Machine({ ramSize: 16 * 1024, seed: 4 });
    const tpm = new TpmPort(null, m.ram, m.prng, true);
    tpm.configure(TPM1);
    for (const [k, w] of [1, 2, 3].entries()) {
      m.bus.store32(0x10_00 + 4 * k, w);
    }
    const word = (reg: number) =>
      (tpm.read(reg) | (tpm.read(reg + 1) << 8) | (tpm.read(reg + 2) << 16) | (tpm.read(reg + 3) << 24)) >>> 0;
    const put = (reg: number, v: number) => {
      for (let k = 0; k < 4; k++) {
        tpm.write(reg + k, (v >>> (8 * k)) & 0xff);
      }
    };
    put(TPM_REG.ARG0, 0x10_00);
    put(TPM_REG.ARG1, 3);
    put(TPM_REG.CMD, TpmCmd.Measure);
    expect(tpm.read(TPM_REG.STATUS) & TpmStatus.Busy).toBe(0);
    expect(tpm.read(TPM_REG.STATUS) & TpmStatus.Done).toBe(TpmStatus.Done);
    expect(word(TPM_REG.RESULT)).toBe(wordHash([1, 2, 3]));
  });
});

describe("the module's view", () => {
  it('has none without a module, and logs each command with its work time and result', () => {
    expect(rig(null).tpm.view()).toBeNull();
    const { m, tpm, run, result } = rig();
    for (const [k, w] of [5, 6, 7].entries()) {
      m.bus.store32(0x10_00 + 4 * k, w);
    }
    run(TpmCmd.Measure, 0x10_00, 3);
    run(TpmCmd.Seal, 9, 1234);
    const v = tpm.view();
    assert.exists(v);
    expect(v.log.map((e) => e.cmd)).toStrictEqual([TpmCmd.Measure, TpmCmd.Seal]);
    expect(v.log[0]).toMatchObject({
      seq: 1,
      arg0: 0x10_00,
      arg1: 3,
      result: wordHash([5, 6, 7]),
      ticks: 12,
      fault: TpmFault.None,
    });
    assert.exists(v.log[1]);
    expect(v.log[1].ticks).toBe(TPM_SEAL_TICKS);
    expect(v.sealed).toStrictEqual([{ handle: 9, value: 1234 }]);
    expect(result()).toBe(wordHash([5, 6, 7]));
    expect(v.busy).toBe(false);
  });

  it('shows the running hash while a measure is in its work phase', () => {
    const { m, tpm } = rig();
    const words = [11, 22, 33, 44];
    for (const [k, w] of words.entries()) {
      m.bus.store32(0x10_00 + 4 * k, w);
    }
    m.bus.store32(R(TPM_REG.ARG0), 0x10_00);
    m.bus.store32(R(TPM_REG.ARG1), words.length);
    m.bus.store32(R(TPM_REG.CMD), TpmCmd.Measure);
    for (let n = 0; n < TPM_HOP_TICKS + 9; n++) {
      m.advanceBaseTick();
    } // two words (8 ticks) into the work
    const v = tpm.view();
    assert.exists(v);
    expect(v.phase).toBe('work');
    expect(v.hashed).toBe(2);
    expect(v.partial).toBe(wordHash(words.slice(0, 2)));
    expect(v.span).toBe(16);
  });

  it('reports protected mode with its range, and logs a refused command with its fault', () => {
    const { tpm, run } = rig();
    run(TpmCmd.Protect, 0x20_00, 16);
    const viewResult2 = tpm.view();
    assert.exists(viewResult2);
    expect(viewResult2.range).toStrictEqual({ lo: 0x20_00, hi: 0x20_40 });
    run(TpmCmd.Measure, 0x20_02, 4); // not word aligned: refused at the door
    const viewResult3 = tpm.view();
    assert.exists(viewResult3);
    const last = viewResult3.log.at(-1);
    assert.exists(last);
    expect(last).toMatchObject({ cmd: TpmCmd.Measure, fault: TpmFault.BadRange, ticks: 0 });
    run(TpmCmd.Unprotect);
    const viewResult4 = tpm.view();
    assert.exists(viewResult4);
    expect(viewResult4.range).toBeNull();
  });
});
