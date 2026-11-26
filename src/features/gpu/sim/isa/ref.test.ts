import { describe, expect, it } from 'vitest';
import { assembleGpu } from './asm';
import * as kernels from '../kernels';
import { bankCycles, bankLoad, GpuFault, GpuRef } from './ref';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const card = (lanes = 8, banks = 1, kb = 8) => new GpuRef({ lanes, memBytes: kb * 1024, banks });

/** Assemble and run a snippet on a card of `lanes` lanes (8) and `banks` banks (1), `active` of the lanes launched (all); returns the card. */
function runAsm(src: string, o: { lanes?: number; banks?: number; active?: number } = {}): GpuRef {
  const { lanes = 8, banks = 1, active = lanes } = o;
  const g = card(lanes, banks);
  g.load(assembleGpu(src).program);
  g.reset(0, active);
  g.run();
  return g;
}

interface KernelRun {
  lanes: number;
  len: number;
  banks?: number;
  kb?: number;
  phase?: number;
  level?: number;
}

/** Run a kernel over `len` elements on a card of `lanes` lanes, `banks` banks (1) and `kb` KiB (16), at `phase` (5) and `level` (3). */
function runKernel(name: kernels.GpuKernelName, o: KernelRun) {
  const { lanes, len, banks = 1, kb = 16, phase = 5, level = 3 } = o;
  const p = { lanes, len, phase, level };
  const g = card(lanes, banks, kb);
  g.load(assembleGpu(kernels.gpuKernelSource(name, p)).program, kernels.KERNEL_LAYOUT.code);
  g.load([phase, level], kernels.KERNEL_LAYOUT.param);
  g.reset();
  g.run();
  return { g, out: g.read(kernels.KERNEL_LAYOUT.out, len), want: kernels.gpuKernelExpected(name, p) };
}

/** A snippet that loads the word at lane << `shift` into every lane. */
const strided = (shift: number) => `lane v1\nvslli v2, v1, ${shift}\nvld v3, 1024(v2)\nhalt`;

/** The plain-JS result of a kernel over 64 elements at `level`. */
const levelAt = (name: kernels.GpuKernelName, level: number) =>
  kernels.gpuKernelExpected(name, { lanes: 1, len: 64, phase: 0, level });

const KERNEL_CASES = kernels.GPU_KERNEL_NAMES.flatMap((name) =>
  (
    [
      [8, 32],
      [4, 64],
      [16, 48],
    ] as const
  ).map(([lanes, len]) => ({ name, lanes, len })),
);

/** The kernels that draw the whole picture, and the level each draws it at. */
const PICTURE_LEVELS = [
  ['vadd', 120],
  ['saxpy', 120],
  ['blur3', 4],
  ['thresh', 120],
  ['poly', 120],
  ['sphere', 120],
] as const;

describe('GPU reference interpreter: kernels', () => {
  it.each(KERNEL_CASES)(
    '$name with $lanes lanes over $len elements matches the plain-JS result',
    ({ name, lanes, len }) => {
      const { out, want } = runKernel(name, { lanes, len });
      expect(out).toStrictEqual(want);
    },
  );

  it('every kernel draws the whole 64 x 40 picture like the plain-JS pixel, on the smallest card', () => {
    for (const [name, level] of PICTURE_LEVELS) {
      const { out, want } = runKernel(name, { lanes: 16, len: kernels.PICTURE_LEN, phase: 9, level });
      expect(out, `${name} picture`).toStrictEqual(want);
    }
  });

  it('the brightness, contrast and threshold levels do what they say', () => {
    expect(levelAt('vadd', 40).every((v, i) => v === Math.min(255, must(levelAt('vadd', 0)[i]) + 40))).toBe(true);
    expect(new Set(levelAt('thresh', 100))).toStrictEqual(new Set([0, 255]));
    expect(Math.max(...levelAt('saxpy', 24))).toBeGreaterThan(Math.max(...levelAt('saxpy', 8)));
  });

  it('thresh diverges: the two sides of the branch run under the mask', () => {
    const { g } = runKernel('thresh', { lanes: 8, len: 64, phase: 0, level: 100 });
    expect(g.idleLaneSlots).toBeGreaterThan(0);
  });

  it('mandel is heavily divergent: lanes finish at different times and the loop runs for the slowest', () => {
    const { g, out } = runKernel('mandel', { lanes: 8, len: 256, phase: 0, level: 10 });
    expect(new Set(out).size).toBeGreaterThan(3);
    expect(out.some((c) => c === 160)).toBe(true); // inside the set: runs to the iteration cap (10), drawn as 16 a count
    expect(out.some((c) => c < 80)).toBe(true); // far outside: escapes early
    expect(out).toStrictEqual(Array.from({ length: 256 }, (_, i) => kernels.mandelCount(i, 10) << 4));
    expect(g.idleLaneSlots / (g.instructions * 8)).toBeGreaterThan(0.1);
  });

  it('mandel draws an image: every row has its own imaginary part', () => {
    const { out } = runKernel('mandel', { lanes: 16, len: kernels.PICTURE_LEN, phase: 0, level: 6 });
    const rows = Array.from({ length: 40 }, (_, r) => out.slice(r * 64, r * 64 + 64).join(','));
    expect(new Set(rows).size).toBeGreaterThan(15);
  });

  it('sphere draws eight lit, checkered balls and the spin moves the checker', () => {
    const { out } = runKernel('sphere', { lanes: 16, len: kernels.PICTURE_LEN, phase: 0 });
    expect(out).toStrictEqual(Array.from({ length: kernels.PICTURE_LEN }, (_, i) => kernels.ballPixel(i, 0)));
    expect(out[0]).toBe(0); // the corner is off the ball
    expect(out.filter((v) => v > 0).length).toBeGreaterThan(1000);
    expect(new Set(out).size).toBeGreaterThan(30); // shading, not flat colour
    const band = (b: number) => out.slice(b * 20 * 64, (b + 1) * 20 * 64).join(',');
    expect(band(0)).not.toBe(band(1)); // the lower balls are turned differently
    expect(kernels.ballPixel((20 * 64) / 2 + 8, 0)).not.toBe(kernels.ballPixel((20 * 64) / 2 + 8, 8)); // the checker slides when the phase moves
  });

  it('is deterministic and counts cycles', () => {
    const a = runKernel('saxpy', { lanes: 8, len: 32 }).g,
      b = runKernel('saxpy', { lanes: 8, len: 32 }).g;
    expect(a.cycles).toBe(b.cycles);
    expect(a.cycles).toBeGreaterThanOrEqual(a.instructions);
    expect(a.halted).toBe(true);
  });
});

describe('GPU reference interpreter: divergence and the mask', () => {
  it('a branch runs both sides, each under the mask, and restores it', () => {
    const g = runAsm(`
      lane v1
      vli v2, 3
      vli v6, 0
      mpush
      msetlt v1, v2        # lanes 0..2
      vli v3, 100
      melse                # lanes 3..7
      vli v3, 200
      mpop
      vslli v4, v1, 2
      vst v3, 1024(v4)
      halt`);
    expect(g.read(1024, 8)).toStrictEqual([100, 100, 100, 200, 200, 200, 200, 200]);
    expect(g.mask).toBe(0xff);
    expect(g.idleLaneSlots).toBeGreaterThan(0);
  });

  it('nested ifs narrow and restore', () => {
    const g = runAsm(`
      lane v1
      vli v2, 6
      vli v3, 2
      vli v5, 1
      mpush
      msetlt v1, v2        # 0..5
      mpush
      msetge v1, v3        # 2..5
      vli v4, 7
      mpop
      mpop
      vslli v6, v1, 2
      vst v4, 1024(v6)
      halt`);
    expect(g.read(1024, 8)).toStrictEqual([0, 0, 7, 7, 7, 7, 0, 0]);
  });

  it('bany loops until the last lane is done: each lane counts down its own lane id', () => {
    const g = runAsm(`
      lane v1
      vli v2, 0
      vli v3, 0
      mpush
      msetne v1, v2        # lane 0 is done at once
    loop:
      vaddi v3, v3, 1
      vaddi v1, v1, -1
      msetne v1, v2
      bany loop
      mpop
      lane v4
      vslli v4, v4, 2
      vst v3, 1024(v4)
      halt`);
    expect(g.read(1024, 8)).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('only the lanes the launch asked for run', () => {
    const g = runAsm('lane v1\nvaddi v1, v1, 1\nvslli v2, v1, 2\nvst v1, 1020(v2)\nhalt', { active: 3 });
    expect(g.read(1024, 8)).toStrictEqual([1, 2, 3, 0, 0, 0, 0, 0]);
  });

  it('a plain jmp skips instructions', () => {
    const g = runAsm('vli v1, 1\njmp over\nvli v1, 99\nover: vli v2, 5\nvst v1, 1024(v0)\nhalt');
    expect(g.read(1024, 1)).toStrictEqual([1]);
  });
});

describe('GPU reference interpreter: card memory banks', () => {
  it("counts the busiest bank's distinct addresses", () => {
    expect(bankCycles([0, 4, 8, 12], 4)).toBe(1); // one word per bank
    expect(bankCycles([0, 16, 32, 48], 4)).toBe(4); // all in bank 0
    expect(bankCycles([0, 0, 0, 0], 4)).toBe(1); // a broadcast shares one access
    expect(bankCycles([0, 4, 16], 4)).toBe(2);
    expect(bankCycles([], 2)).toBe(1);
  });

  it('bankLoad lists the distinct addresses of every bank and agrees with bankCycles', () => {
    expect(bankLoad([0, 4, 16], 4)).toStrictEqual([2, 1, 0, 0]);
    expect(bankLoad([0, 0, 0, 0], 4)).toStrictEqual([1, 0, 0, 0]);
    expect(bankLoad([], 2)).toStrictEqual([0, 0]);
    for (const a of [[0, 4, 8, 12], [0, 16, 32, 48], [0, 4, 16], []]) {
      expect(bankCycles(a, 4)).toBe(Math.max(1, ...bankLoad(a, 4)));
    }
  });

  it('lastStep reports the instruction, its mask, its cost and (for vld / vst) the bank loads', () => {
    const g = card(8, 4);
    g.load(assembleGpu('lane v1\nvslli v2, v1, 4\nmseteq v1, v0\nvld v3, 1024(v2)\nhalt').program);
    g.reset();
    expect(g.lastStep).toBeNull();
    g.step();
    expect(g.lastStep).toMatchObject({ pc: 0, name: 'lane', kind: 'alu', mask: 0xff, cost: 1, banks: null, dest: 1 });
    g.step();
    g.step();
    expect(g.lastStep).toMatchObject({ pc: 8, name: 'mseteq', kind: 'mask', mask: 0xff });
    g.step();
    // only lane 0 is left active, so one address in one bank
    expect(g.lastStep).toMatchObject({
      pc: 12,
      name: 'vld',
      kind: 'ld',
      mask: 1,
      cost: 1,
      banks: [1, 0, 0, 0],
      dest: 3,
    });
    g.reset();
    g.load(assembleGpu('lane v1\nvslli v2, v1, 4\nvld v3, 1024(v2)\nhalt').program);
    g.reset();
    g.step();
    g.step();
    g.step();
    expect(g.lastStep).toMatchObject({ name: 'vld', cost: 8, banks: [8, 0, 0, 0] }); // all eight lanes in bank 0
    g.step();
    expect(g.lastStep).toMatchObject({ name: 'halt', kind: 'sys', dest: null });
  });

  it('a strided access serializes and an in-order one does not', () => {
    const unit = runAsm(strided(2), { banks: 4 }); // words 0..7 across 4 banks: two words per bank
    const wide = runAsm(strided(4), { banks: 4 }); // every 4th word: all in bank 0
    expect(unit.conflictCycles).toBe(1);
    expect(wide.conflictCycles).toBe(7);
    expect(wide.cycles - unit.cycles).toBe(6);
    // more banks, no conflict for the unit stride
    expect(runAsm(strided(2), { banks: 8 }).conflictCycles).toBe(0);
  });

  it('masked-off lanes do not take part in a conflict', () => {
    const g = runAsm('lane v1\nvslli v2, v1, 4\nvli v3, 1\nmpush\nmseteq v1, v0\nvld v4, 1024(v2)\nmpop\nhalt', {
      banks: 4,
    });
    expect(g.conflictCycles).toBe(0);
  });
});

describe('GPU reference interpreter: faults', () => {
  it('faults on a misaligned or out-of-range access', () => {
    expect(() => runAsm('vli v1, 2\nvld v2, 0(v1)\nhalt')).toThrow(GpuFault);
    expect(() => runAsm('vli v1, 4\nvli v2, 16000\nvld v3, 16000(v2)\nhalt')).toThrow(/outside card memory/u);
    expect(() => runAsm('vli v1, -4\nvld v2, 0(v1)\nhalt')).toThrow(GpuFault);
  });

  it('faults on a mask stack underflow, overflow and a stray melse', () => {
    expect(() => runAsm('mpop\nhalt')).toThrow(/empty mask stack/u);
    expect(() => runAsm('melse\nhalt')).toThrow(/empty mask stack/u);
    expect(() => runAsm(`${'mpush\n'.repeat(9)}halt`)).toThrow(/overflow/u);
  });

  it('faults on an illegal instruction, a runaway fetch and a kernel that never halts', () => {
    const g = card();
    g.mem[0] = 0xff_ff_ff_fe;
    expect(() => {
      g.run();
    }).toThrow(/illegal instruction/u);
    expect(() => runAsm('jmp 1000000')).toThrow(/fetch outside/u);
    const loop = card();
    loop.load(assembleGpu('l: jmp l').program);
    expect(() => {
      loop.run(1000);
    }).toThrow(/no halt/u);
  });
});
