import { describe, expect, it } from 'vitest';
import { assembleGpu } from '../../sim/asm/gpu';
import { getSpec, type CardSpec } from '../../sim/board/specs';
import { gpuKernelSource, KERNEL_LAYOUT } from '../../sim/gen/gpukernels';
import type { GpuSnap } from '../../sim/game/types';
import { GPU_BASE, GPU_MEM, GPU_REG, GpuStatus } from '../../sim/isa/memmap';
import { GpuPort } from '../../sim/machine/gpu';
import { Machine } from '../../sim/machine/machine';
import { gpuPlan } from '../board/gpulayout';
import { gpuLenses, gpuRegionOf, LENS_ROWS } from './gpulens';

/** A card of the given spec that has run blur3 once, seen the way the board sees it. */
function ran(id: string): { snap: GpuSnap; visual: string } {
  const spec = getSpec(id) as CardSpec, cfg = spec.gpu!;
  const m = new Machine({ ramSize: 4096 }), port = new GpuPort('pcie0', 0);
  m.addDevice(port);
  m.clock.setRate('pcie0', { mul: 1, div: 1 });
  port.configure(cfg);
  const p = { lanes: cfg.lanes, len: cfg.lanes * 2, phase: 5, level: 3 };
  const put = (at: number, words: ArrayLike<number>) => { for (let k = 0; k < words.length; k++) m.bus.store32(GPU_BASE + GPU_MEM + at + 4 * k, words[k]!); };
  put(KERNEL_LAYOUT.code, assembleGpu(gpuKernelSource('blur3', p)).program);
  put(KERNEL_LAYOUT.param, [p.phase, p.level]);
  m.bus.store32(GPU_BASE + GPU_REG.KERNEL, 0);
  m.bus.store32(GPU_BASE + GPU_REG.LANES, 0);
  m.bus.store32(GPU_BASE + GPU_REG.CMD, 1);
  while (m.bus.load32(GPU_BASE + GPU_REG.STATUS) & GpuStatus.Busy) m.advanceBaseTick();
  return { snap: { ...port.view()!, slot: 'pcie0' }, visual: spec.visual };
}

const blocksOf = (visual: string) => gpuPlan(visual).blocks.map((b) => ({ id: b.id, kind: b.kind, sm: b.sm }));

describe('GPU memory popups', () => {
  it('a load names the instruction and shows the words of card memory around the address, the touched ones marked', () => {
    const { snap, visual } = ran('gpu1');
    const ld = snap.trace.find((s) => s.name === 'vld' && s.mem)!;
    const lens = gpuLenses(blocksOf(visual), snap, ld, 1, 1).find((l) => l.kind === 'dram')!;
    expect(lens.tag).toMatch(/^vld /);
    expect(lens.rows).toHaveLength(LENS_ROWS);
    expect(lens.rows.filter((r) => r.current).length).toBeGreaterThan(0);
    expect(lens.note).toContain(gpuRegionOf(ld.mem!.addrs[0]!));
  });

  it('code in card memory reads as instructions with a class pill, data as numbers', () => {
    const { snap, visual } = ran('gpu1');
    const fake = { ...snap.trace.find((s) => s.name === 'vld' && s.mem)!, mem: { addrs: [4], data: [0], at: 0, around: snap.code!.slice(0, LENS_ROWS) } };
    const lens = gpuLenses(blocksOf(visual), snap, fake, 1, 1).find((l) => l.kind === 'dram')!;
    expect(lens.rows.some((r) => r.cls !== null && r.text !== '')).toBe(true);
    expect(gpuRegionOf(0x804)).toBe('output frame');
  });

  it('the banks list each word with its bank and round: one bank serves its words one round at a time', () => {
    const { snap, visual } = ran('gpu2');
    const ld = snap.trace.find((s) => s.name === 'vld' && s.mem)!;
    const lens = gpuLenses(blocksOf(visual), snap, ld, 8, 2).find((l) => l.kind === 'banks')!;
    expect(lens.rows.length).toBeGreaterThan(0);
    expect(lens.rows.every((r) => /^b\d\.r\d+$/.test(r.at))).toBe(true);
    expect(lens.note).toMatch(/round/);
  });

  it('the multi-SM card has an L1 per SM and a shared L2, listing the lines they hold with their words, and the coalescer\'s lines', () => {
    const { snap, visual } = ran('gpu3');
    const ld = snap.trace.find((s) => s.name === 'vld' && s.mem)!;
    const all = gpuLenses(blocksOf(visual), snap, ld, 8, 4);
    const l2 = all.find((l) => l.kind === 'l2')!, l1 = all.filter((l) => l.kind === 'l1');
    expect(l1.length).toBeGreaterThan(0);
    expect(l2.rows.some((r) => r.text !== 'empty' && r.hex !== '')).toBe(true);
    expect(all.find((l) => l.kind === 'coalescer')!.note).toMatch(/line/);
  });

  it('the register file shows the lanes of the register an instruction writes, and only while one does', () => {
    const { snap, visual } = ran('gpu1');
    const ld = snap.trace.find((s) => s.name === 'vld')!;
    const lens = gpuLenses(blocksOf(visual), snap, ld, 1, 1).find((l) => l.kind === 'regfile')!;
    expect(lens.title).toBe(`Registers · v${ld.dest}`);
    expect(lens.rows).toHaveLength(Math.min(LENS_ROWS, 8));
    expect(gpuLenses(blocksOf(visual), snap, snap.trace.find((s) => s.name === 'halt')!, 1, 1).some((l) => l.kind === 'regfile')).toBe(false);
  });
});
