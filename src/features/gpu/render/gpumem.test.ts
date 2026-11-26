import { describe, expect, it } from 'vitest';
import { assembleGpu } from '../sim/isa/asm';
import { specsOfKind } from '../../board/sim/specs';
import { gpuKernelSource, KERNEL_LAYOUT } from '../sim/kernels';
import { GPU_BASE, GPU_MEM, GPU_REG, GpuStatus } from '@/core/sim/memmap';
import { GpuPort, Machine } from '@/core/sim';
import { gpuPlan } from './gpulayout';
import { gpuGlyphArea } from './glyph';
import * as gpumem from './gpumem';
import { gpuCells } from './plan/gpuplans';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const blockOf = (visual: string, kind: string) => must(gpuPlan(visual).die.blocks.find((b) => b.kind === kind));
const areaOf = (b: ReturnType<typeof blockOf>) => must(gpuGlyphArea({ kind: b.kind, rect: b.rect }));
type GpuStep = NonNullable<gpumem.MemCtx['step']>;
type Lit = ReturnType<typeof gpumem.gpuMemLive>['lit'][number];
type LiveText = ReturnType<typeof gpumem.gpuMemLive>['texts'][number];

/** The machine word of one GPU instruction. */
const word = (src: string): number => must(assembleGpu(src).program[0]);

/** The words a 16-byte cell of card memory holds in the fill fixture: the kernel's code full, a stretch of the picture half full. */
function fillOf(k: number): number {
  if (k < 112) {
    return 4;
  }
  if (k >= 160 && k < 170) {
    return 2;
  }
  return 0;
}

/** How strong the cells of the map tinted `color` are. */
const strengths = (cells: { color: string; a: number }[], color: string) =>
  cells.filter((c) => c.color === color).map((c) => c.a);

/** The lit row buffer slots (22 px high) at least as bright as 0.8. */
const brightSlots = (lit: Lit[]) => lit.filter((l) => l.rect.h === 22 && l.a >= 0.8);

/** A 64-line cache view whose first three lines hold lines 64.. with the same words. */
const cachedLines = () =>
  Array.from({ length: 64 }, (_, k) => {
    if (k < 3) {
      return { line: 64 + k, words: [90, 80, 70, 60, 50, 40, 30, 20] };
    }
    return null;
  });

/** The texts that are not in a group: the words. */
const ungrouped = (texts: LiveText[]) => texts.filter((t) => t.grp === undefined || t.grp === '');

/** Whether a text sits at the corner of a cell. */
const textAt = (texts: LiveText[], cell: { x: number; y: number }) =>
  texts.some((t) => t.rect.x === cell.x && t.rect.y === cell.y);

/** The first load in a trace that moved memory. */
const firstMemLoad = (trace: GpuStep[]) => must(trace.find((s) => s.name === 'vld' && s.mem !== undefined));

/** The first step in a trace that read an operand and wrote a result. */
const firstWithVals = (trace: GpuStep[]) => must(trace.find((s) => s.vals?.d !== undefined && s.vals.a !== undefined));

const ctx = (o: Partial<gpumem.MemCtx> = {}): gpumem.MemCtx => ({
  step: null,
  memStep: null,
  sm: 0,
  perSm: 16,
  banks: 2,
  lineWords: 8,
  round: 0,
  ...o,
});
const load = (addrs: number[], data: number[], at = 2040): GpuStep => ({
  pc: 8,
  name: 'vld',
  kind: 'ld',
  mask: 0xff_ff,
  cost: 1,
  banks: null,
  dest: 3,
  word: word('vld v3, 0(v2)'),
  mem: { addrs, data, at, around: [0, 12, 15, 17, 21, 30, 41, 44, 49] },
});

describe('card memory', () => {
  it('the map tints the cells that hold words by what lives there, as strong as they are full', () => {
    const b = blockOf('gpu-2', 'dram'),
      a = areaOf(b),
      g = gpumem.dramGeom(a);
    const fill = Array.from({ length: must(b.bytes) / 16 }, (_, k) => fillOf(k));
    const cells = gpumem.dramFill(a, must(b.bytes), fill);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(g.total);
    expect(Math.max(...strengths(cells, 'alu'))).toBeGreaterThan(0.85); // the kernel's code, full
    expect(Math.min(...strengths(cells, 'st'))).toBeLessThan(0.6); // the picture, half full
    const noFill: number[][] = [];
    expect(gpumem.dramFill(a, must(b.bytes), noFill.at(0))).toStrictEqual([]);
    expect([
      gpumem.gpuRegion(0),
      gpumem.gpuRegion(0x7_00),
      gpumem.gpuRegion(0x8_00),
      gpumem.gpuRegion(0x90_00),
    ]).toStrictEqual(['code', 'args', 'frame', 'work']);
  });

  it('a load lights the cells it reached and reads the row it opened out in the row buffer, code as mnemonics', () => {
    const b = blockOf('gpu-2', 'dram'),
      a = areaOf(b),
      g = gpumem.dramGeom(a),
      s = load([2048, 2052], [12, 15]);
    const live = gpumem.gpuMemLive(b, a, ctx({ step: s, memStep: s }));
    expect(live.texts).toHaveLength(9);
    expect(live.texts[1]).toMatchObject({ top: '07fc', bottom: '12' });
    expect(live.lit.filter((l) => l.a >= 0.9)).toHaveLength(2); // two cells
    expect(brightSlots(live.lit)).toHaveLength(2); // two slots
    expect(g.slots).toHaveLength(9);
    const code = load([4], [0]);
    must(code.mem).at = 0;
    must(code.mem).around = [word('vld v1, 4(v2)'), 0, 0, 0, 0, 0, 0, 0, 0];
    const codeTexts = gpumem.gpuMemLive(b, a, ctx({ step: code, memStep: code })).texts;
    expect(must(codeTexts[0]).bottom).toBe('vld');
  });

  it('after the instruction the row buffer keeps the words of the last access, dimmer', () => {
    const b = blockOf('gpu-2', 'dram'),
      a = areaOf(b),
      s = load([2048], [12]);
    const later: GpuStep = { pc: 12, name: 'vadd', kind: 'alu', mask: 1, cost: 1, banks: null, dest: 1 };
    const fresh = gpumem.gpuMemLive(b, a, ctx({ step: s, memStep: s })),
      kept = gpumem.gpuMemLive(b, a, ctx({ step: later, memStep: s }));
    expect(kept.texts).toHaveLength(9);
    expect(Math.max(...kept.lit.map((l) => l.a))).toBeLessThan(Math.max(...fresh.lit.map((l) => l.a)));
    expect(gpumem.gpuMemLive(b, a, ctx({ step: later, memStep: null })).texts).toHaveLength(0);
  });
});

describe('the magnifier on card memory', () => {
  it('reads the words around the touched address, the touched ones marked, the region named', () => {
    const s = load([2048, 2052, 2056], [12, 15, 17]);
    const lens = must(gpumem.gpuLensRows(s));
    expect(lens.rows).toHaveLength(9);
    expect(lens.tag).toBe('vld v3, 0(v2)  @0x0800');
    expect(lens.note).toBe('output frame · 3 lane accesses');
    expect(lens.rows.filter((r) => r.current).map((r) => r.addr)).toStrictEqual([2048, 2052, 2056]);
    expect(lens.rows[1]).toMatchObject({ addr: 2044, hex: '0000000c', text: '12', cls: null });
    expect(gpumem.gpuLensRows({ ...s, mem: undefined })).toBeNull();
    expect(gpumem.gpuLensRows(null)).toBeNull();
  });

  it('code reads as its instruction with a class pill', () => {
    const s = load([8], [0]);
    must(s.mem).at = 0;
    must(s.mem).around = [0, word('vld v1, 4(v2)'), word('vmul v1, v1, v2'), word('vst v1, 8(v2)'), 0, 0, 0, 0, 0];
    const { rows } = must(gpumem.gpuLensRows(s));
    expect(rows.map((r) => r.text.split(' ')[0])).toStrictEqual(['', 'vld', 'vmul', 'vst', '', '', '', '', '']);
    expect(rows.map((r) => r.cls)).toStrictEqual([null, 'ld', 'mul', 'st', null, null, null, null, null]);
    expect(must(gpumem.gpuLensRows(s)).note).toMatch(/^kernel code/u);
  });

  it('the thread line ends in the cell of the map the address falls in', () => {
    const b = blockOf('gpu-2', 'dram'),
      a = areaOf(b),
      g = gpumem.dramGeom(a);
    const r = gpumem.dramCellRect(a, must(b.bytes), 2048),
      k = Math.floor((2048 / must(b.bytes)) * g.total);
    expect(r).toStrictEqual({
      x: a.x + (k % g.cols) * g.cw + 1,
      y: a.y + Math.floor(k / g.cols) * g.cw + 1,
      w: g.cw - 2,
      h: g.cw - 2,
    });
  });
});

describe('banks', () => {
  it('each bank lights the word line of the line it serves, with the word beside it, one round at a time', () => {
    const b = blockOf('gpu-2', 'banks'),
      a = areaOf(b),
      s = load([2048, 2052, 2112, 2116], [1, 2, 3, 4]); // lines 64 and 66, both bank 0
    const first = gpumem.gpuMemLive(b, a, ctx({ step: s, memStep: s, round: 0 })),
      second = gpumem.gpuMemLive(b, a, ctx({ step: s, memStep: s, round: 1 }));
    expect(first.texts.map((t) => t.top)).toStrictEqual(['0800 1']);
    expect(second.texts.map((t) => t.top)).toStrictEqual(['0800 1', '0840 3']);
    expect(first.lit.filter((l) => l.a >= 0.7)).toHaveLength(1);
    const cell = must(gpuCells(b)[0]);
    expect(gpumem.bankGeom(cell).n).toBeGreaterThan(8);
  });
});

describe('caches', () => {
  it('a cache lists its lines by tag, and the line an access hit lights up with its words', () => {
    const b = blockOf('gpu-3', 'l2'),
      a = areaOf(b),
      s = load([2048, 2052], [1, 2]);
    const cache = {
      level: 'L2' as const,
      lineWords: 8,
      lines: cachedLines(),
    };
    const live = gpumem.gpuMemLive(b, a, ctx({ step: s, memStep: s, cache }));
    expect(live.texts.filter((t) => t.grp === 'tag').map((t) => t.top)).toStrictEqual(['0800', '0820', '0840']);
    // (the card's L2 is a roomy column of the main die: every cached line prints its words in two rows; a small cache prints the words of the line an access hit one by one)
    expect(ungrouped(live.texts).map((t) => [t.top, t.bottom])).toStrictEqual([
      ['90 80 70 60', '50 40 30 20'],
      ['90 80 70 60', '50 40 30 20'],
      ['90 80 70 60', '50 40 30 20'],
    ]);
    expect(Math.max(...live.lit.map((l) => l.a))).toBeGreaterThanOrEqual(0.6);
    expect(gpumem.gpuMemLive(b, a, ctx({ step: s, memStep: s })).texts).toHaveLength(0); // no cache view, nothing to show
  });
});

describe('registers', () => {
  it('the rows an instruction names print the lanes it reads and writes, the masked-off lanes left out', () => {
    const b = blockOf('gpu-2', 'regfile'),
      a = areaOf(b);
    const s: GpuStep = {
      pc: 4,
      name: 'vadd',
      kind: 'alu',
      mask: 0b1011,
      cost: 1,
      banks: null,
      dest: 3,
      word: word('vadd v3, v1, v2'),
      lane0: 0,
      vals: { a: [1, 2, 3, 4], b: [10, 20, 30, 40], d: [11, 22, 33, 44] },
    };
    const live = gpumem.gpuMemLive(b, a, ctx({ step: s }));
    expect(live.texts.map((t) => t.top).toSorted()).toStrictEqual(
      ['1', '10', '11', '2', '20', '22', '4', '40', '44'].toSorted(),
    ); // lane 2 is off
    // the second warp of the card writes the lanes after the first's
    const w1 = gpumem.gpuMemLive(b, a, ctx({ step: { ...s, lane0: 8 } })),
      cells = gpuCells(b),
      { cols } = must(b.grid);
    expect(textAt(w1.texts, must(cells[3 * cols + 8]))).toBe(true);
  });
});

describe('with a real run', () => {
  it('a card that ran blur3 has steps that carry what the parts need', () => {
    const spec = must(specsOfKind('gpu').find((x) => x.id === 'gpu3')),
      cfg = must(spec.gpu),
      m = new Machine({ ramSize: 4096 }),
      port = new GpuPort('pcie0', 0);
    m.addDevice(port);
    m.clock.setRate('pcie0', { mul: 1, div: 1 });
    port.configure(cfg);
    const p = { lanes: cfg.lanes, len: cfg.lanes * 2, phase: 5, level: 3 };
    const put = (at: number, words: ArrayLike<number>) => {
      for (let k = 0; k < words.length; k++) {
        m.bus.store32(GPU_BASE + GPU_MEM + at + 4 * k, must(words[k]));
      }
    };
    put(KERNEL_LAYOUT.code, assembleGpu(gpuKernelSource('blur3', p)).program);
    put(KERNEL_LAYOUT.param, [p.phase, p.level]);
    m.bus.store32(GPU_BASE + GPU_REG.KERNEL, 0);
    m.bus.store32(GPU_BASE + GPU_REG.LANES, 0);
    m.bus.store32(GPU_BASE + GPU_REG.CMD, 1);
    while (m.bus.load32(GPU_BASE + GPU_REG.STATUS) & GpuStatus.Busy) {
      m.advanceBaseTick();
    }
    const v = must(port.view()),
      { visual } = spec,
      step = firstMemLoad(v.trace);
    expect(must(v.fill).some((n) => n > 0)).toBe(true);
    const l2 = must(must(v.caches).find((c) => c.level === 'L2')),
      b = blockOf(visual, 'l2');
    const live = gpumem.gpuMemLive(b, areaOf(b), ctx({ step, memStep: step, cache: l2 }));
    expect(live.texts.some((t) => t.grp === 'tag')).toBe(true);
    const add = firstWithVals(v.trace),
      rb = blockOf(visual, 'regfile');
    expect(gpumem.gpuMemLive(rb, areaOf(rb), ctx({ step: add })).texts.length).toBeGreaterThan(0);
  });
});
