import { assert, describe, expect, it } from 'vitest';
import { NpuOp } from '@/core/sim/memmap';
import type { Rect } from '../../cpu/render/core/cpuplan';
import {
  arrayGeom,
  cellKind,
  cellsOfRange,
  ctlGeom,
  ctlRowOf,
  descGeom,
  hostGeom,
  memGeom,
  npuGlyphArea,
  npuLive,
  operand,
  regionsOf,
  wavefront,
} from './npuglyph';
import type * as npuglyphTypes from './npuglyph';
import { npuPlan } from './npuplans';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const plan = npuPlan({ grid: 4, memBytes: 8192, lanes: 4 });
const block = (id: string) => {
  const foundBlock = plan.blocks.find((b) => b.id === id);
  assert.exists(foundBlock);
  return foundBlock;
};
/** The glyph area of a block of the plan. */
const areaOf = (id: string): Rect => must(npuGlyphArea(block(id)));
const live = (id: string, s: npuglyphTypes.NpuShow) => npuLive(block(id), areaOf(id), s);
const show = (o: Partial<npuglyphTypes.NpuShow> = {}): npuglyphTypes.NpuShow => ({
  phase: 'run',
  progress: 1,
  grid: 4,
  memBytes: 8192,
  descAt: 0x10_00,
  count: 3,
  list: [
    { op: NpuOp.Load, a: 0, b: 0 },
    { op: NpuOp.Matmul, a: 0, b: 1 },
    { op: NpuOp.Store, a: 0, b: 0x2_00 },
  ],
  index: 1,
  step: { op: NpuOp.Matmul, a: 0, b: 1, progress: 0.4, cost: 14, fault: false, reads: [], writes: [], n: 0 },
  acc: Array.from({ length: 16 }, (_, k) => k),
  prevAcc: Array.from({ length: 16 }, () => 7),
  tiles: [true, true, false, false],
  cycles: 9,
  busy: true,
  error: false,
  done: false,
  fault: 0,
  fill: Array.from({ length: 128 }, () => 0),
  regions: [],
  touch: null,
  replay: false,
  ms: 0,
  ...o,
});
const hits = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// the geometry functions return fresh rectangles: compare them by value
const eq = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const has = (list: Rect[], r: Rect): boolean => list.some((x) => eq(x, r));

type Lit = npuglyphTypes.NpuLive['lit'][number];
type Label = npuglyphTypes.NpuLive['texts'][number];
/** A lit glyph on one of `cells`, brighter than 0.8. */
const brightOn = (i: Lit, cells: Rect[]): boolean => i.a > 0.8 && has(cells, i.rect);
/** A lit glyph on one of `cells`, dimmer than 0.3. */
const dimOn = (i: Lit, cells: Rect[]): boolean => i.a < 0.3 && has(cells, i.rect);
/** A glyph lit on `rect` in `color`. */
const litAs = (i: Lit, rect: Rect, color: string): boolean => eq(i.rect, rect) && i.color === color;
/** A label on `rect` that reads `words`. */
const labelSays = (t: Label, rect: Rect, words: string): boolean => eq(t.rect, rect) && t.top.includes(words);
const isRing = (i: Lit): boolean => i.ring === true;
/** Old sums of a relu: negative in every other cell. */
const alternating = (k: number): number => (k % 2 ? -3 : 3);
/** A glyph lit as a product on the pins of the lane `name`. */
const onLane = (i: Lit, lanes: { name: string; cells: Rect[] }[], name: string): boolean =>
  i.color === 'mul' && must(lanes.find((p) => p.name === name)).cells.some((c) => eq(c, i.rect));
/** Layer `l` of a two-layer network: the first reads 0 and writes 0x100, the second reads 0x100 and writes 0. */
const layerAt = (l: number) => ({
  w: 0x2_00 + l * 256,
  x: l ? 0x1_00 : 0,
  out: l ? 0 : 0x1_00,
  bias: 0x8_00 + l * 32,
  n: 8,
});

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
    const K = 4,
      q = arrayGeom(areaOf('array'), K),
      l = live('array', show());
    const { front } = wavefront(NpuOp.Matmul, 0.4, K, 0);
    const bright = l.lit.filter((i) => brightOn(i, q.cells));
    expect(bright.length).toBeGreaterThan(0);
    for (const b of bright) {
      const k = q.cells.findIndex((c) => eq(c, b.rect));
      expect(Math.abs(Math.floor(k / K) + (k % K) - front)).toBeLessThan(1.3);
    }
    expect(l.lit.some((i) => has(q.east, i.rect))).toBe(true);
    expect(l.lit.some((i) => has(q.south, i.rect))).toBe(true);
    expect(l.lit.filter((i) => dimOn(i, q.cells)).length).toBeGreaterThan(0);
    // the sums the wave has not reached yet are still the old ones
    const text = (k: number) =>
      l.texts.find((t) => {
        const cell = q.cells[k];
        assert.exists(cell);
        return eq(t.rect, cell);
      })?.top;
    expect(text(15)).toBe('7');
    expect(text(0)).toBe('0');
    expect(l.texts.some((t) => labelSays(t, q.cap, 't0 x t1'))).toBe(true);
  });
  it('relu flashes the negative sums, a store sweeps the rows out, an idle array just holds its sums', () => {
    const K = 4,
      q = arrayGeom(areaOf('array'), K);
    const prev = Array.from({ length: 16 }, (_, k) => alternating(k));
    const relu = live(
      'array',
      show({
        prevAcc: prev,
        step: { op: NpuOp.Relu, a: 0, b: 0, progress: 1, cost: 2, fault: false, reads: [], writes: [], n: 0 },
      }),
    );
    expect(relu.lit.filter((i) => i.color === 'bad')).toHaveLength(8);
    const store = live(
      'array',
      show({
        step: { op: NpuOp.Store, a: 0, b: 0, progress: 0.3, cost: 5, fault: false, reads: [], writes: [[0, 64]], n: 0 },
      }),
    );
    expect(store.lit.filter((i) => i.color === 'st')).toHaveLength(8); // rows 0 and 1 of 4
    const idle = live('array', show({ phase: 'idle', step: null, index: -1, busy: false }));
    expect(idle.lit).toStrictEqual([]);
    expect(idle.texts.filter((t) => has(q.cells, t.rect))).toHaveLength(15); // the zero cell is left blank
  });
});

describe('what the other blocks show', () => {
  it('marks the row of the queue being run, the ones done, and the operands of each', () => {
    const q = descGeom(areaOf('desc')),
      l = live('desc', show());
    expect(
      l.lit.filter((i) => {
        assert.exists(q.rows[1]);
        return eq(i.rect, q.rows[1].row);
      }),
    ).toHaveLength(1);
    expect(l.lit.some((i) => litAs(i, must(q.rows[0]).row, 'st'))).toBe(true);
    expect(
      l.lit.some((i) => {
        assert.exists(q.rows[2]);
        return eq(i.rect, q.rows[2].row);
      }),
    ).toBe(false);
    const foundText = l.texts.find((t) => {
      assert.exists(q.rows[1]);
      return eq(t.rect, q.rows[1].op);
    });
    assert.exists(foundText);
    expect(foundText.top).toBe('MATMUL');
    const foundText2 = l.texts.find((t) => {
      assert.exists(q.rows[2]);
      return eq(t.rect, q.rows[2].b);
    });
    assert.exists(foundText2);
    expect(foundText2.top).toBe('@0200');
    expect(operand(NpuOp.Relu, 'a', 0)).toBe('');
  });
  it('lights the tile registers that were loaded, and the two a product reads', () => {
    const l = live('tiles', show());
    expect(l.lit.some((i) => i.color === 'ld')).toBe(true);
    expect(l.lit.some((i) => i.color === 'mul')).toBe(true);
    expect(
      live('tiles', show({ tiles: [false, false, false, false], step: null, phase: 'idle', index: -1 })).lit,
    ).toStrictEqual([]);
  });
  it('maps card memory in cells: tinted by what lives there, as strong as full, outlined where the card or the CPU reads and writes', () => {
    const A = must(npuGlyphArea(block('cardmem'))),
      q = memGeom(A, 8192);
    expect(q.cells).toHaveLength(8192 / 4 / 16);
    expect(cellsOfRange(0x4_00, 0x4_40, 8192)).toStrictEqual([16, 16]);
    expect(cellsOfRange(0x4_00, 0x4_c0, 8192)).toStrictEqual([16, 18]);
    expect(cellsOfRange(8000, 99_999, 8192)).toStrictEqual([125, 127]);
    const fill = Array.from({ length: 128 }, () => 0);
    fill[16] = 1;
    fill[17] = 0.5;
    const regions = regionsOf([{ op: NpuOp.Load, a: 0, b: 0x4_00 }], 4, 0x10_00, 3);
    expect(cellKind(16, regions)).toBe('x');
    expect(cellKind(64, regions)).toBe('list'); // 0x1000 / 64
    expect(cellKind(30, regions)).toBeNull();
    const l = live(
      'cardmem',
      show({
        fill,
        regions,
        step: {
          op: NpuOp.Load,
          a: 0,
          b: 0x4_00,
          progress: 0.5,
          cost: 5,
          fault: false,
          reads: [[0x4_00, 0x4_40]],
          writes: [],
          n: 0,
        },
      }),
    );
    const at = (r: Rect) => l.lit.filter((i) => eq(i.rect, r));
    assert.exists(q.cells[16]);
    expect(at(q.cells[16]).filter((i) => !isRing(i))).toMatchObject([{ color: 'alu' }]);
    assert.exists(q.cells[17]);
    const foundAt = at(q.cells[16]).find((i) => !isRing(i));
    assert.exists(foundAt);
    expect(foundAt.a).toBeGreaterThan(must(at(q.cells[17]).find((i) => !isRing(i))).a);
    assert.exists(q.cells[64]);
    expect(at(q.cells[64]).find((i) => !isRing(i))).toMatchObject({ color: 'br' }); // named by the descriptors, not filled yet: faint
    const foundAt2 = at(q.cells[64]).find((i) => !isRing(i));
    assert.exists(foundAt2);
    expect(foundAt2.a).toBeLessThan(0.1);
    assert.exists(q.cells[30]);
    expect(at(q.cells[30])).toStrictEqual([]);
    expect(at(q.cells[16]).filter((i) => isRing(i))).toMatchObject([{ color: 'alu' }]); // the card reads this cell
    expect(l.texts.some((t) => t.top === 'card reads 64 B')).toBe(true);
  });
  it("shows what the CPU does through the window: the cells it wrote, on the link's transmit lanes and the register it hit", () => {
    const writing = show({
      phase: 'idle',
      step: null,
      index: -1,
      busy: false,
      touch: { store: true, reg: -1, lo: 0x80, hi: 0x1_00, fresh: 1 },
    });
    const mem = live('cardmem', writing),
      q = memGeom(areaOf('cardmem'), 8192);
    expect(mem.lit.filter((i) => isRing(i)).map((i) => i.color)).toStrictEqual(['br', 'br']); // 0x80 .. 0x100: two cells, a write is magenta
    expect(
      mem.lit
        .filter((i) => isRing(i))
        .every((i) => {
          assert.exists(q.cells[2]);
          assert.exists(q.cells[3]);
          return has([q.cells[2], q.cells[3]], i.rect);
        }),
    ).toBe(true);
    expect(mem.texts.some((t) => t.top === 'cpu writes 128 B')).toBe(true);
    const host = live('host', writing);
    assert.exists(host.texts[0]);
    expect(host.texts[0].top).toBe('cpu writes');
    const hostNpuGlyphArea = npuGlyphArea(block('host'));
    assert.exists(hostNpuGlyphArea);
    const lanes = hostGeom(hostNpuGlyphArea).pins;
    const lit = (name: string) => host.lit.filter((i) => onLane(i, lanes, name)).length;
    expect(lit('tx0')).toBeGreaterThan(0);
    expect(lit('rx0')).toBe(0);
    const reading = live(
      'host',
      show({
        phase: 'idle',
        busy: false,
        step: null,
        index: -1,
        touch: { store: false, reg: 0, lo: 0, hi: 0, fresh: 1 },
      }),
    );
    assert.exists(reading.texts[0]);
    expect(reading.texts[0].top).toBe('cpu reads');
    const status = live('ctl', show({ touch: { store: false, reg: ctlRowOf(0x00), lo: 0, hi: 0, fresh: 1 } }));
    const [statusRow] = ctlGeom(areaOf('ctl'));
    assert.exists(statusRow);
    expect(status.lit.some((i) => litAs(i, statusRow.value, 'alu'))).toBe(true);
    expect([0x00, 0x04, 0x08, 0x0c, 0x10, 0x1c, 0x20].map((a) => ctlRowOf(a))).toStrictEqual([0, 0, 1, 2, 5, 3, 4]);
    // a touch that has faded away lights nothing
    expect(
      live(
        'cardmem',
        show({ phase: 'idle', step: null, index: -1, touch: { store: true, reg: -1, lo: 0, hi: 64, fresh: 0 } }),
      ).lit.some((i) => isRing(i)),
    ).toBe(false);
  });
  it('names the regions the descriptors give: weights, biases, the data in, the result out of the last layer', () => {
    const layers = [0, 1].map((l) => ({
      op: NpuOp.Layer,
      a: 0,
      b: 0,
      layer: layerAt(l),
    }));
    const r = regionsOf(layers, 4, 0x9_00, 2);
    const kind = (b: number) => cellKind(b / 64, r);
    expect(kind(0x9_00)).toBe('list');
    expect(kind(0x2_00)).toBe('w');
    expect(kind(0x8_00)).toBe('bias');
    expect(kind(0x0)).toBe('out'); // the last layer writes where the first read: the result wins
    expect(kind(0x1_00)).toBe('x'); // the buffer between the layers
    expect(regionsOf([], 4, 0, 0)).toStrictEqual([]);
  });
  it('the link and the registers follow the phase', () => {
    const into = live('host', show({ phase: 'in', progress: 0.5, step: null, index: -1 }));
    expect(into.lit.some((i) => i.color === 'mul')).toBe(true);
    assert.exists(into.texts[0]);
    expect(into.texts[0].top).toBe('launch in');
    const ctl = live('ctl', show({ error: true, fault: 2 }));
    expect(ctl.lit.some((i) => i.color === 'bad')).toBe(true);
    expect(ctl.texts.some((t) => t.top === 'STEP FAULT')).toBe(true);
    expect(ctl.texts.some((t) => t.top === '4 x 4')).toBe(true);
    assert.exists(ctl.texts[0]);
    assert.exists(ctl.texts[1]);
    expect(hits(ctl.texts[0].rect, ctl.texts[1].rect)).toBe(false);
  });
});
