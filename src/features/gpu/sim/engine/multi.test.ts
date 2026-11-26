import { assert, describe, expect, it } from 'vitest';
import { assembleGpu } from '../isa/asm';
import { GPU_TASK_KERNELS, gpuKernelExpected, gpuKernelSource, KERNEL_LAYOUT } from '../kernels';
import * as isaRef from '../isa/ref';
import * as gpu from '../index';
import { SmEngine } from './warp';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const MEM = 16_384;
const multi = (o: Partial<gpu.MultiConfig> = {}): gpu.MultiConfig => ({
  kind: 'multi',
  lanes: 32,
  sms: 2,
  warps: 2,
  memBytes: MEM,
  banks: 4,
  lineWords: 8,
  globalLatency: 6,
  l1Lines: 8,
  l1Hit: 2,
  l2Lines: 64,
  l2Hit: 4,
  ...o,
});
const warp = (o: Partial<gpu.WarpConfig> = {}): gpu.WarpConfig => ({
  kind: 'warp',
  lanes: 16,
  warps: 2,
  memBytes: MEM,
  banks: 2,
  lineWords: 8,
  globalLatency: 6,
  ...o,
});

/** `eng` as the SM engine a multi or warp config builds, failing the test when it is another one. */
function smEngine(eng: gpu.GpuEngine): SmEngine {
  assert.instanceOf(eng, SmEngine);
  return eng;
}

/** The output words of a kernel run, read as signed 32-bit values. */
const outWords = (m: Uint32Array, len: number): number[] => [
  ...new Int32Array(m.subarray(KERNEL_LAYOUT.out / 4, KERNEL_LAYOUT.out / 4 + len)),
];

function runAll(eng: gpu.GpuEngine, max = 2_000_000): isaRef.GpuStep[] {
  const steps: isaRef.GpuStep[] = [];
  const sm = smEngine(eng);
  while (!eng.halted) {
    eng.step();
    steps.push(...sm.issuedNow);
    if (eng.cycles > max) {
      throw new Error('never halted');
    }
  }
  return steps;
}

function boot(cfg: gpu.MultiConfig, src: string, data: Record<number, number[]> = {}): gpu.GpuEngine {
  const eng = gpu.createGpu(cfg);
  eng.mem.set(assembleGpu(src).program);
  for (const [at, ws] of Object.entries(data)) {
    eng.mem.set(ws, Number(at) / 4);
  }
  eng.reset();
  return eng;
}

/** The last cycle SM `sm` issued an instruction named `name` on. */
function lastStart(steps: isaRef.GpuStep[], sm: number, name: string): number {
  const last = must(steps.findLast((s) => s.sm === sm && s.name === name));
  return must(last.startCycle);
}

/** Runs blur3 over 64 elements on a card built from `cfg`, checks its output and returns the card cycles it took. */
function blurCycles(cfg: gpu.GpuConfig): number {
  const p = { lanes: cfg.lanes, len: 64, phase: 3, level: 2 };
  const eng = gpu.createGpu(cfg);
  eng.mem.set(assembleGpu(gpuKernelSource('blur3', p)).program, KERNEL_LAYOUT.code / 4);
  eng.mem.set([p.phase, p.level], KERNEL_LAYOUT.param / 4);
  eng.reset();
  runAll(eng);
  expect(outWords(eng.mem, 64)).toStrictEqual(gpuKernelExpected('blur3', p));
  return eng.cycles;
}

const SHAPES = [
  [32, 2, 2],
  [16, 2, 1],
  [32, 4, 1],
  [16, 2, 2],
] as const;
const EQUIVALENCE = GPU_TASK_KERNELS.flatMap((name) =>
  SHAPES.map(([lanes, sms, warps]) => ({ name, lanes, sms, warps })),
);

describe('functional equivalence with the reference interpreter', () => {
  it.each(EQUIVALENCE)('$name on $lanes lanes in $sms SMs of $warps warp(s)', ({ name, lanes, sms, warps }) => {
    const p = { lanes, len: 64, phase: 5, level: 3 };
    const src = assembleGpu(gpuKernelSource(name, p)).program;
    const eng = gpu.createGpu(multi({ lanes, sms, warps }));
    eng.mem.set(src, KERNEL_LAYOUT.code / 4);
    eng.mem.set([p.phase, p.level], KERNEL_LAYOUT.param / 4);
    eng.reset();
    runAll(eng);
    const ref = new isaRef.GpuRef({ lanes, memBytes: MEM, banks: 1 });
    ref.load(src, KERNEL_LAYOUT.code);
    ref.load([p.phase, p.level], KERNEL_LAYOUT.param);
    ref.run();
    expect(outWords(eng.mem, p.len)).toStrictEqual(outWords(ref.mem, p.len));
    expect(outWords(eng.mem, p.len)).toStrictEqual(gpuKernelExpected(name, p));
  });

  it('rejects lanes that do not split over the SMs', () => {
    expect(() => gpu.createGpu(multi({ lanes: 12, sms: 2, warps: 4 }))).toThrow(
      '12 lanes do not split into 2 SMs of 4 warps',
    );
  });

  it('a launch with few lanes leaves the later SMs idle', () => {
    const eng = boot(multi(), 'lane v1\nvli v2, 9\nvslli v1, v1, 2\nvst v2, 1024(v1)\nhalt');
    eng.reset(0, 5);
    const steps = runAll(eng);
    expect(steps.every((x) => x.sm === 0)).toBe(true);
    expect(must(smEngine(eng).smViews()[1]).warps.every((w) => w.state === 'done')).toBe(true);
    expect([...eng.mem.subarray(256, 262)]).toStrictEqual([9, 9, 9, 9, 9, 0]);
  });
});

describe('SMs and the shared L2', () => {
  it('both SMs issue in the same cycle and have their own views', () => {
    const eng = boot(multi(), 'lane v1\nvli v2, 1\nhalt');
    const rows: number[] = [];
    const sm = smEngine(eng);
    while (!eng.halted) {
      eng.step();
      rows.push(sm.issuedNow.length);
    }
    expect(Math.max(...rows)).toBe(2);
    expect(sm.smViews()).toHaveLength(2);
    expect(must(sm.smViews()[0]).warps).toHaveLength(2);
  });

  it('the second SM hits the L2 line the first one fetched', () => {
    // every lane loads the same word: SM 0 and SM 1 each ask for line 128
    const eng = boot(multi({ warps: 1 }), 'vli v1, 0\nvld v2, 1024(v1)\nhalt', { 1024: [7] });
    runAll(eng);
    const m = smEngine(eng).memsys;
    expect(m.l1Misses).toBe(2);
    expect(m.l2Hits + m.l2Misses).toBeGreaterThan(0);
    expect([...must(eng.regs[2])].every((x) => x === 7)).toBe(true);
  });

  it('a barrier only holds the warps of its own SM', () => {
    // SM 1 never reaches a long loop SM 0 spins in; both have a bar after it
    const eng = boot(
      multi(),
      'lane v1\nvsrli v2, v1, 4\nvli v3, 0\nvli v4, 6\nvli v5, 0\nmpush\nmseteq v2, v3\nloop: vaddi v4, v4, -1\nmsetne v4, v5\nbany loop\nmpop\nbar\nvli v6, 1\nhalt',
    );
    const steps = runAll(eng);
    expect(lastStart(steps, 1, 'vli')).toBeLessThan(lastStart(steps, 0, 'vli'));
  });
});

describe('against the single SM', () => {
  it("blur3 over 64 elements takes fewer card cycles on two SMs than on gpu2's one", () => {
    expect(blurCycles(multi())).toBeLessThan(blurCycles(warp()));
  });
});
