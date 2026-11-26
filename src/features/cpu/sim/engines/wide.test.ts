// Correctness of the wide engines (inorder2 / inorder4 / ooo with several sizes) against the reference interpreter.
import { describe, expect, it } from 'vitest';
import { assemble } from '../asm';
import { RefCpu } from '../ref';
import { generate, runReference, TEMPLATE_NAMES } from '@/features/jobs/sim/gen';
import { genData, genProgram } from './testgen';
import { WIDE_CONFIGS, firstMemDiff, runEngine, runProgram, runRef } from './testutil';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const HAND: Record<string, string> = {
  sum: `
    li a0, 0
    li a1, 1
    li a2, 11
  loop:
    add a0, a0, a1
    addi a1, a1, 1
    blt a1, a2, loop
    ecall`,
  callRet: `
    li a0, 5
    call fact
    ecall
  fact:
    addi sp, sp, -8
    sw ra, 4(sp)
    sw a0, 0(sp)
    li t0, 2
    blt a0, t0, base
    addi a0, a0, -1
    call fact
    lw t1, 0(sp)
    mul a0, a0, t1
    j out
  base:
    li a0, 1
  out:
    lw ra, 4(sp)
    addi sp, sp, 8
    ret`,
  memcpy: `
    li s3, 4096
    li t0, 0
    li t1, 40
  fill:
    add t2, t0, t0
    addi t2, t2, 3
    add t3, s3, t0
    sb t2, 0(t3)
    addi t0, t0, 1
    bne t0, t1, fill
    li t0, 0
    li t4, 100
  copy:
    add t3, s3, t0
    lbu t2, 0(t3)
    add t3, t3, t4
    sb t2, 0(t3)
    lw a0, 0(s3)
    add a1, a1, a0
    addi t0, t0, 1
    bne t0, t1, copy
    ecall`,
  loadUse: `
    li s3, 4096
    sw s3, 0(s3)
    lw t0, 0(s3)
    add t1, t0, t0
    lw t2, 0(t0)
    sw t2, 8(s3)
    lw t3, 8(s3)
    mul t4, t3, t3
    ecall`,
  // store-to-load forwarding: word, byte-in-word, byte-to-byte, partial overlap (sb then lw), sw then sb then lw
  forwarding: `
    li s3, 4096
    li t0, 0x12345678
    sw t0, 0(s3)
    lw t1, 0(s3)
    lbu t2, 1(s3)
    lb t3, 3(s3)
    li t4, -3
    sb t4, 8(s3)
    lb a0, 8(s3)
    lbu a1, 8(s3)
    lw a2, 8(s3)
    sw t0, 12(s3)
    sb t4, 13(s3)
    lw a3, 12(s3)
    ecall`,
  jalrAndLui: `
    lui a0, 3
    auipc a1, 1
    la a2, target
    jalr ra, a2, 0
    li a3, 99
  target:
    sub a3, a0, a1
    slt t0, a3, zero
    sltu t1, a3, zero
    sra t2, a3, t0
    ecall`,
  // a mispredicted branch whose wrong path stores, loads from a device-ish address and divides nothing
  wrongPath: `
    li s3, 4096
    li t0, 1
    li t1, 7
    bne t0, zero, skip
    sw t1, 0(s3)
    lw t2, 0(s3)
    lui a0, 0x80000
    lw a1, 0(a0)
    skip:
    lw t3, 0(s3)
    ecall`,
  display: `
    lui a0, 0x80000
    li a1, 72
    sb a1, 0(a0)
    li a1, 105
    sb a1, 1(a0)
    ecall`,
};

/**
 * A run of `src` on the engine `make` builds, next to the reference on the same data (with cache invalidations and predictor
 * flips when `chaos`): what the engine ended with, and what it should have (its registers, the first byte of memory that
 * differs, the instructions it retired).
 */
function vsReference(run: {
  src: string;
  make: () => ReturnType<(typeof WIDE_CONFIGS)[number]['make']>;
  seed: number;
  chaos: boolean;
}) {
  const data = genData(run.seed);
  const ref = runRef(run.src, data);
  const got = runEngine(run.make(), run.src, data, run.chaos ? { seed: run.seed + 1, p: 0.15 } : undefined);
  return {
    got: { regs: got.regs, firstDifferingMemByte: firstMemDiff(got.mem, ref.mem), retired: got.counters[1] },
    want: { regs: ref.regs, firstDifferingMemByte: -1, retired: ref.cycles },
  };
}

const HAND_COMPUTED = Object.entries(HAND).filter(([name]) => name !== 'display');

/** Whether template `t` runs on a bare CPU in reasonable time. */
const runsBare = (t: string) => !t.startsWith('secure.') && !t.startsWith('gpu.');

describe.each(WIDE_CONFIGS)('wide correctness vs reference: $name', ({ make }) => {
  it.each(HAND_COMPUTED)('hand-written: %s', (name, src) => {
    for (const [seed, chaos] of [
      [7, false],
      [8, true],
    ] as const) {
      const r = vsReference({ src, make, seed, chaos });
      expect(r.got, `${name} seed ${seed}`).toStrictEqual(r.want);
    }
  });

  it('hand-written: display', () => {
    const src = must(HAND['display']);
    const cpu = new RefCpu();
    cpu.load(assemble(src).program);
    cpu.run();
    const out = runEngine(make(), src);
    expect(out.regs).toStrictEqual([...cpu.regs]);
    expect(out.machine.display.text()).toBe('Hi');
  });

  it('random programs', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = vsReference({ src: genProgram(seed), make, seed, chaos: false });
      expect(r.got, `seed ${seed}`).toStrictEqual(r.want);
    }
  });

  it('random programs with cache invalidations and predictor flips', () => {
    for (let seed = 100; seed < 140; seed++) {
      const r = vsReference({ src: genProgram(seed, 45), make, seed, chaos: true });
      expect(r.got, `seed ${seed}`).toStrictEqual(r.want);
    }
  });

  it('zero-penalty and tiny caches stay correct', () => {
    for (let seed = 200; seed < 210; seed++) {
      const src = genProgram(seed);
      const data = genData(seed);
      const ref = runRef(src, data);
      for (const extra of [{ missPenalty: 0 }, { cacheLines: 1, cacheLineBytes: 4, missPenalty: 7 }]) {
        const got = runEngine(make(extra), src, data, { seed, p: 0.1 });
        expect(got.regs).toStrictEqual(ref.regs);
        expect(firstMemDiff(got.mem, ref.mem)).toBe(-1);
      }
    }
  });

  it('generated game programs (cli, scan, every template; text on the display)', () => {
    // the secure.* jobs talk to a TPM this bare machine does not have (securejob.test.ts and gen.test.ts run it against one)
    const names = [...new Set(['cli', 'cli.scan', ...TEMPLATE_NAMES])].filter((t) => runsBare(t)); // the gpu.* picture jobs run 0.2 to 1.3M instructions on the CPU: gen.test.ts runs them on the in-order engines
    for (const t of names) {
      for (let s = 0; s < 6; s++) {
        const g = generate(t, s * 37 + 5, { scale: 1 + (s % 3) });
        const ref = runReference(g);
        const e = make();
        const m = runProgram(e, g.program);
        expect([...m.regs], `${t} #${s} regs`).toStrictEqual([...ref.cpu.regs]);
        expect(firstMemDiff(m.ram, ref.cpu.mem.ram.bytes), `${t} #${s} ram`).toBe(-1);
        expect(m.display.text(), `${t} #${s} display`).toBe(ref.text);
        expect(m.display.text()).toBe(g.meta.expectedText);
        expect(e.view.counters[1], `${t} #${s} retired`).toBe(ref.steps);
      }
    }
  }, 60_000);

  it('generated programs survive random cache invalidations and predictor flips', () => {
    for (const t of ['cli', 'cli.scan']) {
      for (let s = 0; s < 4; s++) {
        const g = generate(t, s * 13 + 2, { scale: 2 });
        const ref = runReference(g);
        const m = runProgram(make(), g.program, { seed: s + 1, p: 0.1 });
        expect([...m.regs], `${t} #${s} regs`).toStrictEqual([...ref.cpu.regs]);
        expect(firstMemDiff(m.ram, ref.cpu.mem.ram.bytes), `${t} #${s} ram`).toBe(-1);
        expect(m.display.text()).toBe(ref.text);
      }
    }
  });
});
