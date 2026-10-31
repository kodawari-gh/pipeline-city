import { describe, expect, it } from 'vitest';
import { assembleGpu } from '../sim/asm';
import { getSpec, type CardSpec } from '../../board/sim/specs';
import { gpuKernelSource, KERNEL_LAYOUT } from '../sim/kernels';
import { gpuEncode, gpuInstr } from '../sim/isa';
import { GPU_BASE, GPU_MEM, GPU_REG, GpuStatus } from '@/core/sim/memmap';
import { GpuPort } from '../sim/port';
import { Machine } from '@/core/sim/machine';
import type { GpuStep } from '../sim/ref';
import { gpuPlan } from './gpulayout';
import { gpuGlyphArea } from './gpuglyph';
import { bankGeom, dramCellRect, dramFill, dramGeom, gpuLensRows, gpuMemLive, gpuRegion, type MemCtx } from './gpumem';
import { gpuCells } from './gpuplans';

const blockOf = (visual: string, kind: string) => gpuPlan(visual).die.blocks.find((b) => b.kind === kind)!;
const areaOf = (b: ReturnType<typeof blockOf>) => gpuGlyphArea({ kind: b.kind, rect: b.rect })!;
const ctx = (o: Partial<MemCtx> = {}): MemCtx => ({ step: null, memStep: null, sm: 0, perSm: 16, banks: 2, lineWords: 8, round: 0, ...o });
const load = (addrs: number[], data: number[], at = 2040): GpuStep => ({
  pc: 8, name: 'vld', kind: 'ld', mask: 0xffff, cost: 1, banks: null, dest: 3, word: gpuEncode(gpuInstr('vld', { rd: 3, rs1: 2, imm: 0 })),
  mem: { addrs, data, at, around: [0, 12, 15, 17, 21, 30, 41, 44, 49] },
});

describe('card memory', () => {
  it('the map tints the cells that hold words by what lives there, as strong as they are full', () => {
    const b = blockOf('gpu-2', 'dram'), a = areaOf(b), g = dramGeom(a);
    const fill = Array.from({ length: b.bytes! / 16 }, (_, k) => (k < 112 ? 4 : k >= 160 && k < 170 ? 2 : 0));
    const cells = dramFill(a, b.bytes!, fill);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(g.total);
    expect(cells.some((c) => c.color === 'alu' && c.a > 0.85)).toBe(true); // the kernel's code, full
    expect(cells.some((c) => c.color === 'st' && c.a < 0.6)).toBe(true); // the picture, half full
    expect(dramFill(a, b.bytes!, undefined)).toEqual([]);
    expect([gpuRegion(0), gpuRegion(0x700), gpuRegion(0x800), gpuRegion(0x9000)]).toEqual(['code', 'args', 'frame', 'work']);
  });

  it('a load lights the cells it reached and reads the row it opened out in the row buffer, code as mnemonics', () => {
    const b = blockOf('gpu-2', 'dram'), a = areaOf(b), g = dramGeom(a), s = load([2048, 2052], [12, 15]);
    const live = gpuMemLive(b, a, ctx({ step: s, memStep: s }));
    expect(live.texts).toHaveLength(9);
    expect(live.texts[1]).toMatchObject({ top: '07fc', bottom: '12' });
    expect(live.lit.filter((l) => l.a >= 0.9)).toHaveLength(2); // two cells
    expect(live.lit.filter((l) => l.rect.h === 22 && l.a >= 0.8)).toHaveLength(2); // two slots
    expect(g.slots).toHaveLength(9);
    const code = load([4], [0]);
    code.mem!.at = 0;
    code.mem!.around = [gpuEncode(gpuInstr('vld', { rd: 1, rs1: 2, imm: 4 })), 0, 0, 0, 0, 0, 0, 0, 0];
    expect(gpuMemLive(b, a, ctx({ step: code, memStep: code })).texts[0]!.bottom).toBe('vld');
  });

  it('after the instruction the row buffer keeps the words of the last access, dimmer', () => {
    const b = blockOf('gpu-2', 'dram'), a = areaOf(b), s = load([2048], [12]);
    const later: GpuStep = { pc: 12, name: 'vadd', kind: 'alu', mask: 1, cost: 1, banks: null, dest: 1 };
    const fresh = gpuMemLive(b, a, ctx({ step: s, memStep: s })), kept = gpuMemLive(b, a, ctx({ step: later, memStep: s }));
    expect(kept.texts).toHaveLength(9);
    expect(Math.max(...kept.lit.map((l) => l.a))).toBeLessThan(Math.max(...fresh.lit.map((l) => l.a)));
    expect(gpuMemLive(b, a, ctx({ step: later, memStep: null })).texts).toHaveLength(0);
  });
});

describe('the magnifier on card memory', () => {
  it('reads the words around the touched address, the touched ones marked, the region named', () => {
    const s = load([2048, 2052, 2056], [12, 15, 17]);
    const lens = gpuLensRows(s)!;
    expect(lens.rows).toHaveLength(9);
    expect(lens.tag).toBe('vld v3, 0(v2)  @0x0800');
    expect(lens.note).toBe('output frame · 3 lane accesses');
    expect(lens.rows.filter((r) => r.current).map((r) => r.addr)).toEqual([2048, 2052, 2056]);
    expect(lens.rows[1]).toMatchObject({ addr: 2044, hex: '0000000c', text: '12', cls: null });
    expect(gpuLensRows({ ...s, mem: undefined })).toBeNull();
    expect(gpuLensRows(null)).toBeNull();
  });

  it('code reads as its instruction with a class pill', () => {
    const s = load([8], [0]);
    s.mem!.at = 0;
    s.mem!.around = [0, gpuEncode(gpuInstr('vld', { rd: 1, rs1: 2, imm: 4 })), gpuEncode(gpuInstr('vmul', { rd: 1, rs1: 1, rs2: 2 })), gpuEncode(gpuInstr('vst', { rs1: 2, rs2: 1, imm: 8 })), 0, 0, 0, 0, 0];
    const rows = gpuLensRows(s)!.rows;
    expect(rows.map((r) => r.text.split(' ')[0])).toEqual(['', 'vld', 'vmul', 'vst', '', '', '', '', '']);
    expect(rows.map((r) => r.cls)).toEqual([null, 'ld', 'mul', 'st', null, null, null, null, null]);
    expect(gpuLensRows(s)!.note).toMatch(/^kernel code/);
  });

  it('the thread line ends in the cell of the map the address falls in', () => {
    const b = blockOf('gpu-2', 'dram'), a = areaOf(b), g = dramGeom(a);
    const r = dramCellRect(a, b.bytes!, 2048), k = Math.floor((2048 / b.bytes!) * g.total);
    expect(r).toEqual({ x: a.x + (k % g.cols) * g.cw + 1, y: a.y + Math.floor(k / g.cols) * g.cw + 1, w: g.cw - 2, h: g.cw - 2 });
  });
});

describe('banks', () => {
  it('each bank lights the word line of the line it serves, with the word beside it, one round at a time', () => {
    const b = blockOf('gpu-2', 'banks'), a = areaOf(b), s = load([2048, 2052, 2112, 2116], [1, 2, 3, 4]); // lines 64 and 66, both bank 0
    const first = gpuMemLive(b, a, ctx({ step: s, memStep: s, round: 0 })), second = gpuMemLive(b, a, ctx({ step: s, memStep: s, round: 1 }));
    expect(first.texts.map((t) => t.top)).toEqual(['0800 1']);
    expect(second.texts.map((t) => t.top)).toEqual(['0800 1', '0840 3']);
    expect(first.lit.filter((l) => l.a >= 0.7)).toHaveLength(1);
    expect(bankGeom(gpuCells(b)[0]!).n).toBeGreaterThan(8);
  });
});

describe('caches', () => {
  it('a cache lists its lines by tag, and the line an access hit lights up with its words', () => {
    const b = blockOf('gpu-3', 'l2'), a = areaOf(b), s = load([2048, 2052], [1, 2]);
    const cache = { level: 'L2' as const, lineWords: 8, lines: Array.from({ length: 64 }, (_, k) => (k < 3 ? { line: 64 + k, words: [90, 80, 70, 60, 50, 40, 30, 20] } : null)) };
    const live = gpuMemLive(b, a, ctx({ step: s, memStep: s, cache }));
    expect(live.texts.filter((t) => t.grp === 'tag').map((t) => t.top)).toEqual(['0800', '0820', '0840']);
    expect(live.texts.filter((t) => t.grp === 'words').map((t) => t.top)).toEqual(['90', '80', '70', '60', '50', '40', '30', '20']); // line 64 = slot 0 was hit
    expect(Math.max(...live.lit.map((l) => l.a))).toBeGreaterThanOrEqual(0.6);
    expect(gpuMemLive(b, a, ctx({ step: s, memStep: s })).texts).toHaveLength(0); // no cache view, nothing to show
  });
});

describe('registers', () => {
  it('the rows an instruction names print the lanes it reads and writes, the masked-off lanes left out', () => {
    const b = blockOf('gpu-2', 'regfile'), a = areaOf(b);
    const s: GpuStep = {
      pc: 4, name: 'vadd', kind: 'alu', mask: 0b1011, cost: 1, banks: null, dest: 3, word: gpuEncode(gpuInstr('vadd', { rd: 3, rs1: 1, rs2: 2 })), lane0: 0,
      vals: { a: [1, 2, 3, 4], b: [10, 20, 30, 40], d: [11, 22, 33, 44] },
    };
    const live = gpuMemLive(b, a, ctx({ step: s }));
    expect(live.texts.map((t) => t.top).sort()).toEqual(['1', '10', '11', '2', '20', '22', '4', '40', '44'].sort()); // lane 2 is off
    // the second warp of the card writes the lanes after the first's
    const w1 = gpuMemLive(b, a, ctx({ step: { ...s, lane0: 8 } })), cells = gpuCells(b), cols = b.grid!.cols;
    expect(w1.texts.some((t) => t.rect.x === cells[3 * cols + 8]!.x && t.rect.y === cells[3 * cols + 8]!.y)).toBe(true);
  });
});

describe('with a real run', () => {
  it('a card that ran blur3 has steps that carry what the parts need', () => {
    const spec = getSpec('gpu3') as CardSpec, cfg = spec.gpu!, m = new Machine({ ramSize: 4096 }), port = new GpuPort('pcie0', 0);
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
    const v = port.view()!, visual = spec.visual, step = v.trace.find((s) => s.name === 'vld' && s.mem)!;
    expect(v.fill!.some((n) => n > 0)).toBe(true);
    const l2 = v.caches!.find((c) => c.level === 'L2')!, b = blockOf(visual, 'l2');
    const live = gpuMemLive(b, areaOf(b), ctx({ step, memStep: step, cache: l2 }));
    expect(live.texts.some((t) => t.grp === 'tag')).toBe(true);
    const add = v.trace.find((s) => s.vals?.d && s.vals.a)!, rb = blockOf(visual, 'regfile');
    expect(gpuMemLive(rb, areaOf(rb), ctx({ step: add })).texts.length).toBeGreaterThan(0);
  });
});
