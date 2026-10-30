import { describe, expect, it } from 'vitest';
import { NpuOp } from '../../sim/isa/memmap';
import type { Rect } from '../die/cpuplan';
import { arrayGeom, descGeom, memWindow, npuGlyphArea, npuLive, operand, wavefront, type NpuShow } from './npuglyph';
import { npuPlan } from './npuplans';

const plan = npuPlan({ grid: 4, memBytes: 8192, lanes: 4 });
const block = (id: string) => plan.blocks.find((b) => b.id === id)!;
const live = (id: string, s: NpuShow) => npuLive(block(id), npuGlyphArea(block(id))!, s);
const show = (o: Partial<NpuShow> = {}): NpuShow => ({
  phase: 'run', progress: 1, grid: 4, memBytes: 8192, descAt: 0x1000, count: 3, list: [{ op: NpuOp.Load, a: 0, b: 0 }, { op: NpuOp.Matmul, a: 0, b: 1 }, { op: NpuOp.Store, a: 0, b: 0x200 }], index: 1,
  step: { op: NpuOp.Matmul, a: 0, b: 1, progress: 0.4, cost: 14, fault: false, reads: [], writes: [], n: 0 }, acc: Array.from({ length: 16 }, (_, k) => k), prevAcc: new Array<number>(16).fill(7),
  tiles: [true, true, false, false], cycles: 9, busy: true, error: false, done: false, fault: 0, replay: false, ms: 0, ...o,
});
const hits = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// the geometry functions return fresh rectangles: compare them by value
const eq = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const has = (list: Rect[], r: Rect): boolean => list.some((x) => eq(x, r));

describe('wavefront', () => {
  it('sweeps the diagonals of the array during a product, and a layer sweeps once per tile', () => {
    expect(wavefront(NpuOp.Matmul, 0, 4, 0).front).toBe(0);
    expect(wavefront(NpuOp.Matmul, 0.5, 4, 0).front).toBeCloseTo(4);
    expect(wavefront(NpuOp.Layer, 0.5, 4, 8)).toMatchObject({ tile: 2, tiles: 4 });
    expect(wavefront(NpuOp.Layer, 0.5, 4, 8).front).toBeCloseTo(0);
    expect(wavefront(NpuOp.Layer, 0.999, 4, 8).tile).toBe(3);
  });
});

describe('what the array shows in a product', () => {
  it('lights the cells on the wavefront and the data running right and down, the ones behind it dim', () => {
    const K = 4, q = arrayGeom(npuGlyphArea(block('array'))!, K), l = live('array', show());
    const front = wavefront(NpuOp.Matmul, 0.4, K, 0).front;
    const bright = l.lit.filter((i) => i.a > 0.8 && has(q.cells, i.rect));
    expect(bright.length).toBeGreaterThan(0);
    for (const b of bright) { const k = q.cells.findIndex((c) => eq(c, b.rect)); expect(Math.abs((Math.floor(k / K) + (k % K)) - front)).toBeLessThan(1.3); }
    expect(l.lit.some((i) => has(q.east, i.rect))).toBe(true);
    expect(l.lit.some((i) => has(q.south, i.rect))).toBe(true);
    expect(l.lit.filter((i) => i.a < 0.3 && has(q.cells, i.rect)).length).toBeGreaterThan(0);
    // the sums the wave has not reached yet are still the old ones
    const text = (k: number) => l.texts.find((t) => eq(t.rect, q.cells[k]!))?.top;
    expect(text(15)).toBe('7');
    expect(text(0)).toBe('0');
    expect(l.texts.some((t) => eq(t.rect, q.cap) && /t0 x t1/.test(t.top))).toBe(true);
  });
  it('relu flashes the negative sums, a store sweeps the rows out, an idle array just holds its sums', () => {
    const K = 4, q = arrayGeom(npuGlyphArea(block('array'))!, K);
    const prev = Array.from({ length: 16 }, (_, k) => (k % 2 ? -3 : 3));
    const relu = live('array', show({ prevAcc: prev, step: { op: NpuOp.Relu, a: 0, b: 0, progress: 1, cost: 2, fault: false, reads: [], writes: [], n: 0 } }));
    expect(relu.lit.filter((i) => i.color === 'bad').length).toBe(8);
    const store = live('array', show({ step: { op: NpuOp.Store, a: 0, b: 0, progress: 0.3, cost: 5, fault: false, reads: [], writes: [[0, 64]], n: 0 } }));
    expect(store.lit.filter((i) => i.color === 'st').length).toBe(8); // rows 0 and 1 of 4
    const idle = live('array', show({ phase: 'idle', step: null, index: -1, busy: false }));
    expect(idle.lit).toEqual([]);
    expect(idle.texts.filter((t) => has(q.cells, t.rect)).length).toBe(15); // the zero cell is left blank
  });
});

describe('what the other blocks show', () => {
  it('marks the row of the queue being run, the ones done, and the operands of each', () => {
    const q = descGeom(npuGlyphArea(block('desc'))!), l = live('desc', show());
    expect(l.lit.filter((i) => eq(i.rect, q.rows[1]!.row)).length).toBe(1);
    expect(l.lit.some((i) => eq(i.rect, q.rows[0]!.row) && i.color === 'st')).toBe(true);
    expect(l.lit.some((i) => eq(i.rect, q.rows[2]!.row))).toBe(false);
    expect(l.texts.find((t) => eq(t.rect, q.rows[1]!.op))!.top).toBe('MATMUL');
    expect(l.texts.find((t) => eq(t.rect, q.rows[2]!.b))!.top).toBe('@0200');
    expect(operand(NpuOp.Relu, 'a', 0)).toBe('');
  });
  it('lights the tile registers that were loaded, and the two a product reads', () => {
    const l = live('tiles', show());
    expect(l.lit.some((i) => i.color === 'ld')).toBe(true);
    expect(l.lit.some((i) => i.color === 'mul')).toBe(true);
    expect(live('tiles', show({ tiles: [false, false, false, false], step: null, phase: 'idle', index: -1 })).lit).toEqual([]);
  });
  it('puts the windows a step reads and writes on the ruler of card memory', () => {
    const A = npuGlyphArea(block('cardmem'))!, ruler = { x: A.x, y: A.y + 14, w: A.w, h: 18 };
    const l = live('cardmem', show({ step: { op: NpuOp.Load, a: 0, b: 0x400, progress: 0.5, cost: 5, fault: false, reads: [[0x400, 0x440]], writes: [], n: 0 } }));
    expect(l.lit.some((i) => i.color === 'ld' && Math.abs(i.rect.x - (ruler.x + ruler.w * (0x400 / 8192))) < 0.01)).toBe(true);
    expect(l.lit.some((i) => i.color === 'br')).toBe(true); // the descriptor list
    expect(l.texts.some((t) => t.top === 'read 64 B')).toBe(true);
    expect(memWindow(ruler, 0, 1, 8192).w).toBe(2);
    expect(memWindow(ruler, 8000, 99999, 8192).x + memWindow(ruler, 8000, 99999, 8192).w).toBeLessThanOrEqual(ruler.x + ruler.w + 0.01);
  });
  it('the link and the registers follow the phase', () => {
    const into = live('host', show({ phase: 'in', progress: 0.5, step: null, index: -1 }));
    expect(into.lit.some((i) => i.color === 'mul')).toBe(true);
    expect(into.texts[0]!.top).toBe('launch in');
    const ctl = live('ctl', show({ error: true, fault: 2 }));
    expect(ctl.lit.some((i) => i.color === 'bad')).toBe(true);
    expect(ctl.texts.some((t) => t.top === 'STEP FAULT')).toBe(true);
    expect(ctl.texts.some((t) => t.top === '4 x 4')).toBe(true);
    expect(hits(ctl.texts[0]!.rect, ctl.texts[1]!.rect)).toBe(false);
  });
});
