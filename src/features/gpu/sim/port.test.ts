import { describe, expect, it } from 'vitest';
import { assembleGpu } from './isa/asm';
import {
  GPU_BASE,
  GPU_FRAME,
  GPU_HOP_TICKS,
  GPU_MEM,
  GPU_PORTS,
  GPU_REG,
  GPU_STRIDE,
  GpuFaultCode,
  GpuStatus,
} from '@/core/sim/memmap';
import * as isaRef from './isa/ref';
import * as kernels from './kernels';
import { specsOfKind } from '../../board/sim/specs';
import { GpuPort } from './port';
import { Machine } from '@/core/sim/machine';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const R = (r: number) => GPU_BASE + r;
const W = (k: number) => GPU_BASE + GPU_MEM + 4 * k;

/** A machine with one card in pcie0 at one device tick per base tick, so `advanceBaseTick` is one card tick. */
function rig(lanes = 8, banks = 1, memBytes = 8192) {
  const m = new Machine({ ramSize: 4096 });
  const port = new GpuPort('pcie0', 0);
  m.addDevice(port);
  m.clock.setRate('pcie0', { mul: 1, div: 1 });
  port.configure({ lanes, memBytes, banks });
  const put = (at: number, words: ArrayLike<number>) => {
    for (let k = 0; k < words.length; k++) {
      m.bus.store32(GPU_BASE + GPU_MEM + at + 4 * k, must(words[k]));
    }
  };
  const get = (at: number, n: number) => [
    ...new Int32Array(Array.from({ length: n }, (_, k) => m.bus.load32(GPU_BASE + GPU_MEM + at + 4 * k))),
  ];
  const status = () => m.bus.load32(R(GPU_REG.STATUS));
  /** Launch and tick until the card is not busy; returns the ticks it took. */
  const go = (kernel = 0, lanesArg = 0): number => {
    m.bus.store32(R(GPU_REG.KERNEL), kernel);
    m.bus.store32(R(GPU_REG.LANES), lanesArg);
    m.bus.store32(R(GPU_REG.CMD), 1);
    let n = 0;
    while (status() & GpuStatus.Busy) {
      m.advanceBaseTick();
      n++;
      if (n > 1_000_000) {
        throw new Error('card never finished');
      }
    }
    return n;
  };
  return { m, port, put, get, status, go };
}

/** Run a kernel over `len` elements on a rig of `lanes` lanes and `banks` banks (1), and on the reference interpreter. */
function runKernel(name: kernels.GpuKernelName, o: { lanes: number; len: number; banks?: number }) {
  const { lanes, len, banks = 1 } = o;
  const p = { lanes, len, phase: 5, level: 3 };
  const r = rig(lanes, banks);
  r.put(kernels.KERNEL_LAYOUT.code, assembleGpu(kernels.gpuKernelSource(name, p)).program);
  r.put(kernels.KERNEL_LAYOUT.param, [p.phase, p.level]);
  const ticks = r.go();
  // the same kernel on the reference interpreter
  const ref = new isaRef.GpuRef({ lanes, memBytes: 8192, banks });
  ref.load(assembleGpu(kernels.gpuKernelSource(name, p)).program, kernels.KERNEL_LAYOUT.code);
  ref.load([p.phase, p.level], kernels.KERNEL_LAYOUT.param);
  ref.run();
  return { ...r, ticks, ref, out: r.get(kernels.KERNEL_LAYOUT.out, len), want: kernels.gpuKernelExpected(name, p) };
}

/** The GPU card spec of a tier. */
const gpuSpec = (id: string) => must(specsOfKind('gpu').find((s) => s.id === id));

/** Runs blur3 over 64 elements on a tier at its clock: the card cycles it counted and the base ticks it took. */
function tierRun(id: string): { cycles: number; baseTicks: number } {
  const spec = gpuSpec(id),
    gpu = must(spec.gpu),
    clock = must(spec.clock);
  const p = { lanes: gpu.lanes, len: 64, phase: 3, level: 2 };
  const r = rig(gpu.lanes, gpu.banks, gpu.memBytes);
  r.m.clock.setRate('pcie0', { mul: clock.base, div: 1 });
  r.put(kernels.KERNEL_LAYOUT.code, assembleGpu(kernels.gpuKernelSource('blur3', p)).program);
  r.put(kernels.KERNEL_LAYOUT.param, [p.phase, p.level]);
  const ticks = r.go();
  expect(r.get(kernels.KERNEL_LAYOUT.out, 64)).toStrictEqual(kernels.gpuKernelExpected('blur3', p));
  return { cycles: r.m.bus.load32(R(GPU_REG.CYCLES)), baseTicks: ticks / clock.base };
}

/** The first load in a trace that moved memory. */
const firstMemLoad = (trace: isaRef.GpuStep[]) => must(trace.find((s) => s.name === 'vld' && s.mem !== undefined));

/** The first step in a trace that is neither a load nor a store. */
const firstNonMem = (trace: isaRef.GpuStep[]) => must(trace.find((s) => s.name !== 'vld' && s.name !== 'vst'));

describe('GPU tiers', () => {
  it('each tier beats the one below on blur3: fewer card cycles, and fewer base ticks at its faster clock', () => {
    const [g1, g2, g3] = [tierRun('gpu1'), tierRun('gpu2'), tierRun('gpu3')];
    expect(g2.cycles).toBeLessThan(g1.cycles);
    expect(g3.cycles).toBeLessThan(g2.cycles);
    expect(g2.baseTicks).toBeLessThan(g1.baseTicks);
    expect(g3.baseTicks).toBeLessThan(g2.baseTicks);
  });
});

describe('GPU card on the bus', () => {
  it('reports what it is and an idle status', () => {
    const { m, status } = rig(8, 2, 8192);
    expect(status()).toBe(GpuStatus.Present);
    expect(m.bus.load32(R(GPU_REG.LANES_MAX))).toBe(8);
    expect(m.bus.load32(R(GPU_REG.MEM_BYTES))).toBe(8192);
    expect(m.bus.load32(R(GPU_REG.BANKS))).toBe(2);
  });

  it('sits at a fixed window per PCIe slot', () => {
    expect(GPU_PORTS).toStrictEqual(['pcie0', 'pcie1', 'pcie2', 'pcie3']);
    expect(new GpuPort('pcie2', 2).base).toBe(GPU_BASE + 2 * GPU_STRIDE);
  });

  it('card memory is readable and writable through the window, byte by byte', () => {
    const { m, put, get } = rig();
    put(0, [0x11_22_33_44, -1]);
    expect(get(0, 2)).toStrictEqual([0x11_22_33_44, -1]);
    expect(m.bus.load8(GPU_BASE + GPU_MEM + 1)).toBe(0x33);
    m.bus.store8(GPU_BASE + GPU_MEM + 1, 0xaa);
    expect(get(0, 1)).toStrictEqual([0x11_22_aa_44]);
    expect(m.bus.load32(W(2048))).toBe(0); // past the end of an 8K card reads as zero
  });

  it.each(['vadd', 'saxpy', 'blur3', 'mandel'] as const)(
    '%s: same result as the reference interpreter, in the cycles it counts plus a PCIe hop each way',
    (name) => {
      const { out, want, ref, ticks, port } = runKernel(name, { lanes: 8, len: 32 });
      expect(out).toStrictEqual(want);
      expect(ticks).toBe(2 * GPU_HOP_TICKS + ref.cycles);
      expect(port.lastStats).toStrictEqual({
        instructions: ref.instructions,
        idleLaneSlots: ref.idleLaneSlots,
        conflictCycles: ref.conflictCycles,
      });
    },
  );

  it('bank conflicts cost ticks, exactly as in the reference', () => {
    const one = runKernel('vadd', { lanes: 8, len: 32, banks: 1 });
    const four = runKernel('vadd', { lanes: 8, len: 32, banks: 4 });
    expect(four.out).toStrictEqual(four.want);
    expect(four.ticks).toBe(2 * GPU_HOP_TICKS + four.ref.cycles);
    expect(one.ref.conflictCycles).toBeGreaterThan(0); // one bank: every access of 8 distinct words queues
    expect(four.ref.conflictCycles).toBeLessThan(one.ref.conflictCycles);
  });

  it('golden trace: blur3 on 8 lanes over 32 elements', () => {
    const { ref, ticks, port } = runKernel('blur3', { lanes: 8, len: 32 });
    expect({
      instructions: ref.instructions,
      cycles: ref.cycles,
      conflictCycles: ref.conflictCycles,
      ticks,
      idle: port.lastStats.idleLaneSlots,
    }).toStrictEqual({ instructions: 462, cycles: 602, conflictCycles: 140, ticks: 618, idle: 16 });
  });

  it('Busy while the launch is in flight, Done afterwards, until the next launch', () => {
    const r = rig();
    r.put(0, assembleGpu('halt').program);
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    expect(r.status() & GpuStatus.Busy).not.toBe(0);
    expect(r.status() & GpuStatus.Done).toBe(0);
    for (let i = 0; i < GPU_HOP_TICKS; i++) {
      r.m.advanceBaseTick();
    } // the launch has crossed the link
    expect(r.status() & GpuStatus.Busy).not.toBe(0);
    while (r.status() & GpuStatus.Busy) {
      r.m.advanceBaseTick();
    }
    expect(r.status()).toBe(GpuStatus.Present | GpuStatus.Done);
    expect(r.m.bus.load32(R(GPU_REG.CYCLES))).toBe(1);
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    expect(r.status() & GpuStatus.Done).toBe(0);
  });

  it('LANES limits how many lanes run', () => {
    const r = rig();
    r.put(0, assembleGpu('lane v1\nvaddi v1, v1, 1\nvslli v2, v1, 2\nvst v1, 2044(v2)\nhalt').program);
    r.go(0, 3);
    expect(r.get(2048, 8)).toStrictEqual([1, 2, 3, 0, 0, 0, 0, 0]);
  });

  it('flags a bad launch instead of hanging: busy, no card, too many lanes, a bad kernel address', () => {
    const r = rig();
    r.put(0, assembleGpu('halt').program);
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    r.m.bus.store32(R(GPU_REG.CMD), 1); // while the first is in flight
    expect(r.status() & GpuStatus.Error).not.toBe(0);
    expect(r.m.bus.load32(R(GPU_REG.FAULT))).toBe(GpuFaultCode.BadLaunch);
    while (r.status() & GpuStatus.Busy) {
      r.m.advanceBaseTick();
    }
    r.m.bus.store32(R(GPU_REG.LANES), 9);
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    expect(r.status() & GpuStatus.Error).not.toBe(0);
    expect(r.status() & GpuStatus.Busy).toBe(0);
    r.m.bus.store32(R(GPU_REG.LANES), 0);
    r.m.bus.store32(R(GPU_REG.KERNEL), 2); // misaligned
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    expect(r.m.bus.load32(R(GPU_REG.FAULT))).toBe(GpuFaultCode.BadLaunch);
    r.m.bus.store32(R(GPU_REG.KERNEL), 0x1_00_00); // outside the 8K card
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    expect(r.status() & GpuStatus.Error).not.toBe(0);

    const empty = new Machine({ ramSize: 4096 });
    const none = new GpuPort('pcie0', 0);
    empty.addDevice(none);
    expect(empty.bus.load32(R(GPU_REG.STATUS))).toBe(0);
    empty.bus.store32(R(GPU_REG.CMD), 1);
    expect(empty.bus.load32(R(GPU_REG.STATUS))).toBe(GpuStatus.Error);
  });

  it('a kernel that faults ends the launch with Error and the Kernel fault code', () => {
    const r = rig();
    r.put(0, assembleGpu('vli v1, 2\nvld v2, 0(v1)\nhalt').program); // misaligned gather
    r.go();
    expect(r.status()).toBe(GpuStatus.Present | GpuStatus.Error | GpuStatus.Done);
    expect(r.m.bus.load32(R(GPU_REG.FAULT))).toBe(GpuFaultCode.Kernel);
    r.put(0, assembleGpu('halt').program);
    r.go(); // the card recovers
    expect(r.status()).toBe(GpuStatus.Present | GpuStatus.Done);
  });

  it('a reset (power-on) wipes card memory and forgets the launch', () => {
    const r = rig();
    r.put(0, assembleGpu('halt').program);
    r.go();
    r.port.reset();
    expect(r.get(0, 1)).toStrictEqual([0]);
    expect(r.status()).toBe(GpuStatus.Present);
  });

  it('takeActivity is true for a launch and false once it has finished', () => {
    const r = rig();
    r.put(0, assembleGpu('halt').program);
    expect(r.port.takeActivity()).toBe(false);
    r.go();
    expect(r.port.takeActivity()).toBe(true);
    expect(r.port.takeActivity()).toBe(false);
  });

  it('view() shows the last instructions of a launch (at most 64), clears them at the next launch, and is null without a card', () => {
    const r = rig(8, 4);
    expect(r.port.view()).toMatchObject({
      lanes: 8,
      banks: 4,
      memBytes: 8192,
      phase: 'idle',
      trace: [],
      regs: [],
      launches: 0,
    });
    r.put(0, assembleGpu(`${'vli v1, 1\n'.repeat(70)}lane v2\nvslli v3, v2, 4\nvld v4, 1024(v3)\nhalt`).program);
    r.go();
    const v = must(r.port.view());
    expect(v.launches).toBe(1);
    expect(v.trace).toHaveLength(64);
    expect(v.trace.at(-1)).toMatchObject({ name: 'halt', kind: 'sys' });
    expect(v.trace.at(-2)).toMatchObject({ name: 'vld', kind: 'ld', banks: [8, 0, 0, 0] });
    expect(v.regs).toHaveLength(8);
    expect(v.regs[2]).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(v.stats).toMatchObject({ instructions: 74, conflictCycles: 7 });
    // a second launch starts a fresh window
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    expect(must(r.port.view()).trace).toStrictEqual([]);
    r.port.configure(null);
    expect(r.port.view()).toBeNull();
  });

  it('view().frame is the output region of card memory: empty before a launch, the kernel output after it, blank after a reset', () => {
    const r = runKernel('mandel', { lanes: 8, len: 64 });
    expect(must(r.port.view()).frame.length).toBeGreaterThanOrEqual(64); // as much of the region as the card's memory holds
    expect(must(r.port.view()).frame.length).toBeLessThanOrEqual(GPU_FRAME.words);
    expect(must(r.port.view()).frame.slice(0, 64)).toStrictEqual(r.want.map((v) => v >>> 0));
    r.port.reset(); // card memory is volatile: the frame is blank again
    expect(must(r.port.view()).frame.every((w) => w === 0)).toBe(true);
    expect(must(rig(8, 1).port.view()).frame).toStrictEqual([]);
  });

  it('a stopped clock freezes a launch, and removing the card takes it off the bus status', () => {
    const r = rig();
    r.put(0, assembleGpu('halt').program);
    r.m.clock.setRate('pcie0', { mul: 0, div: 1 });
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    for (let i = 0; i < 50; i++) {
      r.m.advanceBaseTick();
    }
    expect(r.status() & GpuStatus.Busy).not.toBe(0);
    r.port.configure(null);
    expect(r.status()).toBe(0);
  });
});

describe('the kernel a card can show', () => {
  it('the view reads the kernel back from card memory, up to its last word, and nothing before one is copied in', () => {
    const r = rig(8, 1);
    expect(must(r.port.view()).code).toStrictEqual([]);
    const { program } = assembleGpu(['  lane v1', '  vli v2, 5', '  vadd v3, v1, v2', '  halt'].join('\n'));
    r.put(kernels.KERNEL_LAYOUT.code, program);
    expect(must(r.port.view()).code).toStrictEqual([...program]);
    r.go();
    expect(must(r.port.view()).code).toStrictEqual([...program]);
  });
});

describe("GPU memory popups' data", () => {
  it('a load or store step names the addresses and words it moved, and the words around the first', () => {
    const r = runKernel('blur3', { lanes: 8, len: 16 });
    const v = must(r.port.view());
    const ld = firstMemLoad(v.trace);
    expect(must(ld.mem).addrs.length).toBeGreaterThan(0);
    expect(must(ld.mem).data).toHaveLength(must(ld.mem).addrs.length);
    expect(must(ld.mem).around).toHaveLength(9);
    const first = must(must(ld.mem).addrs[0]);
    expect(must(ld.mem).around[(first - must(ld.mem).at) / 4]).toBe(must(must(ld.mem).data[0]) >>> 0);
    expect(firstNonMem(v.trace).mem).toBeUndefined();
  });

  it('a card with caches lists the lines each holds with their words from card memory', () => {
    const cfg = must(gpuSpec('gpu3').gpu);
    const m = new Machine({ ramSize: 4096 });
    const port = new GpuPort('pcie0', 0);
    m.addDevice(port);
    m.clock.setRate('pcie0', { mul: 1, div: 1 });
    port.configure(cfg);
    const p = { lanes: cfg.lanes, len: cfg.lanes * 2, phase: 5, level: 3 };
    const put = (at: number, words: ArrayLike<number>) => {
      for (let k = 0; k < words.length; k++) {
        m.bus.store32(GPU_BASE + GPU_MEM + at + 4 * k, must(words[k]));
      }
    };
    put(kernels.KERNEL_LAYOUT.code, assembleGpu(kernels.gpuKernelSource('blur3', p)).program);
    put(kernels.KERNEL_LAYOUT.param, [p.phase, p.level]);
    m.bus.store32(R(GPU_REG.KERNEL), 0);
    m.bus.store32(R(GPU_REG.LANES), 0);
    m.bus.store32(R(GPU_REG.CMD), 1);
    while (m.bus.load32(R(GPU_REG.STATUS)) & GpuStatus.Busy) {
      m.advanceBaseTick();
    }
    const caches = must(must(port.view()).caches);
    expect(caches.map((c) => c.level)).toStrictEqual(['L1', 'L1', 'L2']);
    const l2 = must(caches[2]);
    const held = l2.lines.filter((l) => l !== null);
    expect(held.length).toBeGreaterThan(0);
    for (const l of held) {
      expect(l.words).toStrictEqual([
        ...must(port.memory).subarray(l.line * l.words.length, (l.line + 1) * l.words.length),
      ]);
    }
  });
});
