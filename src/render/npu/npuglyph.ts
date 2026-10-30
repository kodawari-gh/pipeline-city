import type { Graphics } from 'pixi.js';
import type { Rect } from '../die/cpuplan';
import { glyphKit, type Put } from '../die/blockart';
import type { Theme } from '../theme';
import type { NpuBlock } from './npuplan';
import { GPU_HOP_TICKS, NPU_TILES, NpuOp } from '../../sim/isa/memmap';
import { NPU_LIST_SHOWN } from '../../sim/machine/npu';

// What is inside a block of the AI card's die (docs/ACCEL.md "NPU internal view", docs/DIE.md "Inside the blocks"): the schematic an engineer would draw
// for the part, drawn with the CPU die's own tools (`glyphKit`) so the two read as one family. The link is a ladder of lanes, the control block the
// registers the CPU writes, the descriptor queue the list being run with its current row, the tile registers four small K x K tiles, the array the
// K x K multiply-accumulate cells with the activations coming in from the west and the weights from the north (data pulses right and down), the bias
// and relu stage the row-wise add and max(0, x) the results pass on the way out, card memory a ruler with the windows a step reads and writes. Pure
// drawing into a Graphics (and a callback for the few labels); the rectangles the live layer lights are the `*Geom` functions below, shared by the
// drawing, by `npuLive` and by the hover table (the cells of the array have an id each).

export const NPU_GLYPH_KINDS = new Set<NpuBlock['kind']>(['host', 'ctl', 'desc', 'tiles', 'array', 'post', 'cardmem']);

/** The area a symbol may use: the block under its name (the area the CPU die's cell grids fill), or null when the block is too small. */
export function npuGlyphArea(b: Pick<NpuBlock, 'kind' | 'rect'>): Rect | null {
  if (!NPU_GLYPH_KINDS.has(b.kind)) return null;
  const r = b.rect, head = r.h >= 70 ? 44 : r.h * 0.55;
  const a = { x: r.x + 8, y: r.y + head, w: r.w - 16, h: r.y + r.h - 6 - (r.y + head) };
  return a.w > 8 && a.h > 6 ? a : null;
}

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const hex = (n: number, d = 8): string => (n >>> 0).toString(16).padStart(d, '0');

export const OP_NAMES = ['', 'LOAD', 'MATMUL', 'MACC', 'BIAS', 'RELU', 'STORE', 'LAYER'] as const;
export const CTL_NAMES = ['status', 'desc', 'count', 'cycles', 'fault', 'grid'] as const;
export const FLAGS = ['BSY', 'ERR', 'DNE', 'PRS'] as const;
export const HOST_PINS = ['clk', 'tx0', 'tx1', 'rx0', 'rx1'] as const;
export const FAULT_NAMES = ['', 'BAD LAUNCH', 'STEP FAULT'] as const;

// ---------------------------------------------------------------- the geometry the drawing, the live layer and the hover table share

/** The PCIe link: a lane per signal, each a row of cells the bits march along, and a meter for the ticks a hop takes. */
export function hostGeom(a: Rect) {
  const n = HOST_PINS.length, lw = 30, foot = 34, pitch = Math.min(34, (a.h - foot) / n);
  const pins = HOST_PINS.map((name, k) => {
    const cy = a.y + (k + 0.5) * pitch, lane = R(a.x + lw, cy - 4, a.w - lw, 8), cw = lane.w / 10;
    return { name, cy, lane, cells: Array.from({ length: 10 }, (_, j) => R(lane.x + j * cw + 1, lane.y + 1, cw - 2, lane.h - 2)) };
  });
  const meter = R(a.x, a.y + n * pitch + 6, a.w, 8);
  return { pins, meter, note: R(a.x, meter.y + 10, a.w, 14) };
}

/** The registers the CPU writes: the status as chips, then a name and a value each. */
export function ctlGeom(a: Rect) {
  const n = CTL_NAMES.length, pitch = a.h / n, nw = 44, h = Math.max(8, pitch - 8), vx = a.x + nw, vw = a.w - nw, cw = (vw - 3 * 3) / 4;
  return CTL_NAMES.map((name, k) => {
    const y = a.y + k * pitch + 4;
    return { name, y, h, value: R(vx, y, vw, h), chips: Array.from({ length: 4 }, (_, j) => R(vx + j * (cw + 3), y, cw, h)) };
  });
}

/** The descriptor queue: the first NPU_LIST_SHOWN rows of the list (index, operation, two operands), and a line under them for the rest. */
export function descGeom(a: Rect) {
  const pitch = Math.min(26, (a.h - 18) / NPU_LIST_SHOWN), h = Math.max(8, pitch - 4), iw = 18, ow = 66, aw = (a.w - iw - ow - 6) / 2;
  return {
    pitch,
    rows: Array.from({ length: NPU_LIST_SHOWN }, (_, k) => {
      const y = a.y + k * pitch + 2;
      return { row: R(a.x, y, a.w, h), idx: R(a.x, y, iw, h), op: R(a.x + iw + 2, y, ow, h), a: R(a.x + iw + ow + 4, y, aw, h), b: R(a.x + iw + ow + 6 + aw, y, aw, h) };
    }),
    foot: R(a.x, a.y + NPU_LIST_SHOWN * pitch + 4, a.w, 14),
  };
}

/** The tile registers: four boxes, each with a small K x K grid of cells (lit when the tile has been loaded). */
export function tilesGeom(a: Rect, K: number) {
  const gap = 10, tw = (a.w - (NPU_TILES - 1) * gap) / NPU_TILES, nw = 18;
  return Array.from({ length: NPU_TILES }, (_, t) => {
    const box = R(a.x + t * (tw + gap), a.y, tw, a.h), area = R(box.x + nw + 2, box.y + 2, box.w - nw - 4, box.h - 4);
    const p = Math.min(area.w / K, area.h / K), ox = area.x + (area.w - p * K) / 2, oy = area.y + (area.h - p * K) / 2;
    return { box, name: R(box.x + 2, box.y, nw, box.h), cells: Array.from({ length: K * K }, (_, k) => R(ox + (k % K) * p + 0.8, oy + Math.floor(k / K) * p + 0.8, p - 1.6, p - 1.6)) };
  });
}

/** The array: K x K cells with a gap the data runs in, the activation inputs on the west edge (one a row), the weight inputs on the north edge (one a column). */
export function arrayGeom(a: Rect, K: number) {
  const gx = 24, gy = 12, foot = 16, g = R(a.x + gx, a.y + gy, a.w - gx - 6, a.h - gy - foot);
  // a cell is wider than tall when the block is (the sum shows in it), but not by more than two and a bit
  const ph = g.h / K, pw = Math.min(g.w / K, ph * 2.2), ox = g.x + (g.w - pw * K) / 2, oy = g.y, iw = Math.max(4, pw - 8), ih = Math.max(4, ph - 8);
  const cells = Array.from({ length: K * K }, (_, k) => R(ox + (k % K) * pw + (pw - iw) / 2, oy + Math.floor(k / K) * ph + (ph - ih) / 2, iw, ih));
  return {
    p: ph, cells,
    /** The stubs from a cell to the next one east and the next one south. */
    east: cells.map((c) => R(c.x + c.w, c.y + c.h / 2 - 1.5, pw - iw, 3)),
    south: cells.map((c) => R(c.x + c.w / 2 - 1.5, c.y + c.h, 3, ph - ih)),
    rowIn: Array.from({ length: K }, (_, i) => R(a.x + 2, cells[i * K]!.y + cells[i * K]!.h / 2 - 1.5, ox + (pw - iw) / 2 - a.x - 2, 3)),
    colIn: Array.from({ length: K }, (_, j) => R(cells[j]!.x + cells[j]!.w / 2 - 1.5, a.y + 2, 3, oy + (ph - ih) / 2 - a.y - 2)),
    cap: R(a.x, a.y + a.h - foot + 2, a.w, 14),
  };
}

/** The bias and relu stage: a row of K accumulator values in, the adder with the bias, the max(0, x) unit, a row of K values out. */
export function postGeom(a: Rect, K: number) {
  const h = Math.min(22, a.h - 4), cy = a.y + a.h / 2, row = (x: number, w: number) => ({ box: R(x, cy - h / 2, w, h), cells: Array.from({ length: K }, (_, k) => R(x + 2 + k * ((w - 4) / K), cy - h / 2 + 2, (w - 4) / K - 1.5, h - 4)) });
  return { h, cy, inRow: row(a.x, a.w * 0.28), add: { cx: a.x + a.w * 0.38, cy, r: Math.min(9, h / 2) }, relu: R(a.x + a.w * 0.46, cy - h / 2, a.w * 0.16, h), outRow: row(a.x + a.w * 0.72, a.w * 0.28) };
}

/** Card memory: a ruler over all of it, the readout of what a step reads and writes, and the line for the descriptor list. */
export function memGeom(a: Rect) {
  const ruler = R(a.x, a.y + 14, a.w, 18);
  return { ruler, rd: R(a.x, ruler.y + 28, a.w / 2 - 4, 16), wr: R(a.x + a.w / 2 + 4, ruler.y + 28, a.w / 2 - 4, 16), note: R(a.x, ruler.y + 50, a.w, 16) };
}

/** The window a byte range cuts out of the ruler (card memory is `mem` bytes). */
export function memWindow(ruler: Rect, lo: number, hi: number, mem: number): Rect {
  const x0 = ruler.x + (Math.max(0, Math.min(mem, lo)) / mem) * ruler.w, x1 = ruler.x + (Math.max(0, Math.min(mem, hi)) / mem) * ruler.w;
  return R(x0, ruler.y, Math.max(2, x1 - x0), ruler.h);
}

// ---------------------------------------------------------------- the static symbols

/** Draw the symbol of block `b` into `g`; `put` adds a label. `K` is the array size. */
export function npuGlyph(g: Graphics, T: Theme, b: NpuBlock, c: string, put: Put, K: number): void {
  const a = npuGlyphArea(b);
  if (!a) return;
  const kit = glyphKit(g, T, c, put);
  const { solid, soft, line, rect, stub } = kit;
  const lab = (t: string, lx: number, ly: number, size = 7.5) => put(t, lx + (t.length * size * 0.6) / 2, ly, size);
  const outline = (r: Rect) => { g.roundRect(r.x, r.y, r.w, r.h, 1.5).stroke({ width: 1, color: line, alpha: 0.85 }); };
  const arrow = (x0: number, y0: number, x1: number, y1: number) => {
    stub(x0, y0, x1, y1);
    if (y0 === y1) g.poly([x1, y1, x1 - 3.5, y1 - 2.2, x1 - 3.5, y1 + 2.2]).fill({ color: line });
    else g.poly([x1, y1, x1 - 2.2, y1 - 3.5, x1 + 2.2, y1 - 3.5]).fill({ color: line });
  };
  switch (b.kind) {
    case 'host': {
      const q = hostGeom(a);
      for (const p of q.pins) {
        lab(p.name, a.x, p.cy, 7);
        rect(p.lane.x, p.lane.y, p.lane.w, p.lane.h, soft);
        for (const r of p.cells) g.rect(r.x, r.y, r.w, r.h).fill({ color: soft });
        outline(p.lane);
      }
      rect(q.meter.x, q.meter.y, q.meter.w, q.meter.h, soft); outline(q.meter);
      lab(`${GPU_HOP_TICKS} ticks each way`, q.note.x, q.note.y + 6, 7);
      break;
    }
    case 'ctl': {
      ctlGeom(a).forEach((row, k) => {
        lab(row.name, a.x, row.y + row.h / 2, 7.5);
        if (k === 0) row.chips.forEach((r, j) => { rect(r.x, r.y, r.w, r.h, soft); outline(r); put(FLAGS[j]!, r.x + r.w / 2, r.y + r.h / 2, Math.min(7, row.h * 0.5)); });
        else { rect(row.value.x, row.value.y, row.value.w, row.value.h, soft); outline(row.value); }
      });
      break;
    }
    case 'desc': {
      const q = descGeom(a);
      q.rows.forEach((r, k) => {
        for (const x of [r.idx, r.op, r.a, r.b]) { rect(x.x, x.y, x.w, x.h, soft); outline(x); }
        put(String(k), r.idx.x + r.idx.w / 2, r.idx.y + r.idx.h / 2, Math.min(7.5, r.idx.h * 0.6));
      });
      outline(q.foot);
      break;
    }
    case 'tiles': {
      tilesGeom(a, K).forEach((t, k) => {
        rect(t.box.x, t.box.y, t.box.w, t.box.h, T.die); outline(t.box);
        put(`t${k}`, t.name.x + t.name.w / 2, t.name.y + t.name.h / 2, Math.min(8, t.box.h * 0.4));
        for (const r of t.cells) g.rect(r.x, r.y, r.w, r.h).fill({ color: soft });
      });
      break;
    }
    case 'array': {
      const q = arrayGeom(a, K);
      q.cells.forEach((r, k) => {
        rect(r.x, r.y, r.w, r.h, soft); outline(r);
        if (r.w >= 20) {
          // the multiply inside a cell, a small cross in its corner (the product goes into the sum the cell holds)
          const s = Math.min(3, r.w * 0.07), mx = r.x + 2 + s, my = r.y + 2 + s;
          g.moveTo(mx - s, my - s).lineTo(mx + s, my + s).moveTo(mx + s, my - s).lineTo(mx - s, my + s).stroke({ width: 1, color: line, alpha: 0.8 });
        }
        stub(q.east[k]!.x, q.east[k]!.y + 1.5, q.east[k]!.x + q.east[k]!.w, q.east[k]!.y + 1.5);
        stub(q.south[k]!.x + 1.5, q.south[k]!.y, q.south[k]!.x + 1.5, q.south[k]!.y + q.south[k]!.h);
      });
      q.rowIn.forEach((r) => arrow(r.x, r.y + 1.5, r.x + r.w, r.y + 1.5));
      q.colIn.forEach((r) => arrow(r.x + 1.5, r.y, r.x + 1.5, r.y + r.h));
      lab('A', a.x, a.y + a.h / 2, 8);
      lab('B', a.x + a.w / 2, a.y + 4, 8);
      outline(q.cap);
      break;
    }
    case 'post': {
      const q = postGeom(a, K);
      for (const r of [q.inRow, q.outRow]) { rect(r.box.x, r.box.y, r.box.w, r.box.h, soft); outline(r.box); for (const c2 of r.cells) g.rect(c2.x, c2.y, c2.w, c2.h).fill({ color: soft }); }
      arrow(q.inRow.box.x + q.inRow.box.w, q.cy, q.add.cx - q.add.r - 1, q.cy);
      kit.adder(q.add.cx, q.add.cy, q.add.r, []);
      lab('bias', q.add.cx - 9, q.cy - q.h / 2 - 5, 7);
      arrow(q.add.cx + q.add.r + 7, q.cy, q.relu.x - 1, q.cy);
      rect(q.relu.x, q.relu.y, q.relu.w, q.relu.h, solid); outline(q.relu); put('max(0, x)', q.relu.x + q.relu.w / 2, q.cy, Math.min(7, q.relu.w / 8));
      arrow(q.relu.x + q.relu.w, q.cy, q.outRow.box.x - 1, q.cy);
      break;
    }
    case 'cardmem': {
      const q = memGeom(a);
      rect(q.ruler.x, q.ruler.y, q.ruler.w, q.ruler.h, soft); outline(q.ruler);
      for (let k = 1; k < 16; k++) stub(q.ruler.x + (q.ruler.w * k) / 16, q.ruler.y + q.ruler.h - 5, q.ruler.x + (q.ruler.w * k) / 16, q.ruler.y + q.ruler.h);
      lab('card memory, first byte to last', a.x, a.y + 5, 7.5);
      for (const r of [q.rd, q.wr]) { rect(r.x, r.y, r.w, r.h, soft); outline(r); }
      outline(q.note);
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------- the live symbols

/** The descriptor on show: what it is, how far through it the card is, the memory it touches, and (for a layer) the size of the matrices. */
export interface NpuStepShow {
  op: number;
  a: number;
  b: number;
  /** How far through the descriptor (0..1). */
  progress: number;
  cost: number;
  fault: boolean;
  reads: [number, number][];
  writes: [number, number][];
  /** A layer's matrix size n (0 for the other ops). */
  n: number;
}

/** What the card is doing, as the symbols need it: the snapshot, or a replay of a launch that finished before the player looked. */
export interface NpuShow {
  phase: 'idle' | 'in' | 'run' | 'out';
  /** How far through the hop of the phase (0..1; 1 when idle). */
  progress: number;
  grid: number;
  memBytes: number;
  descAt: number;
  count: number;
  list: { op: number; a: number; b: number }[];
  /** The descriptor on show (-1: none yet) and what it is. */
  index: number;
  step: NpuStepShow | null;
  /** The accumulator after the descriptor on show and before it (grid x grid). */
  acc: number[];
  prevAcc: number[];
  tiles: boolean[];
  cycles: number;
  busy: boolean;
  error: boolean;
  done: boolean;
  fault: number;
  /** A launch replayed after it finished (the registers are its), not the card's state now. */
  replay: boolean;
  /** The clock the motion runs on (ms). */
  ms: number;
}

export type LiveKey = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad';
export interface NpuLiveItem { rect: Rect; color: LiveKey; a: number }
export interface NpuLiveText { rect: Rect; top: string; ink?: boolean; small?: boolean; fit?: number }
export interface NpuLive { texts: NpuLiveText[]; lit: NpuLiveItem[] }

const wave = (ms: number, k: number, speed = 1): number => 0.5 + 0.5 * Math.sin(ms / (90 / speed) - k * 0.9);

/** The wavefront of a matrix product through the array: where on the diagonals (0 .. 2K) the data is at `progress`. A layer sweeps its T x T tiles one after the other. */
export function wavefront(op: number, progress: number, K: number, n: number): { front: number; tile: number; tiles: number } {
  const tiles = op === NpuOp.Layer && n > 0 ? (n / K) ** 2 : 1, q = Math.min(tiles - 1e-9, progress * tiles), tile = Math.floor(q);
  return { front: (q - tile) * 2 * K, tile, tiles };
}

/** The operand a descriptor shows in a column: a tile register, an address, a block, or nothing. */
export function operand(op: number, which: 'a' | 'b', v: number): string {
  switch (op) {
    case NpuOp.Load: return which === 'a' ? `t${v}` : `@${hex(v, 4)}`;
    case NpuOp.Matmul: case NpuOp.Macc: return `t${v}`;
    case NpuOp.Bias: case NpuOp.Store: return which === 'a' ? '' : `@${hex(v, 4)}`;
    case NpuOp.Layer: return which === 'a' ? `@${hex(v, 4)}` : '';
    default: return '';
  }
}

/** What a block shows now: the rectangles to light and the texts to put in them. */
export function npuLive(b: Pick<NpuBlock, 'kind' | 'rect'>, a: Rect, s: NpuShow): NpuLive {
  const out: NpuLive = { texts: [], lit: [] };
  const K = s.grid, st = s.step, op = st?.op ?? 0, running = s.phase === 'run' && !!st, moving = s.phase === 'in' || s.phase === 'out';
  const num = (r: Rect, t: string, ink = true) => out.texts.push({ rect: r, top: t, small: true, ink });
  switch (b.kind) {
    case 'host': {
      const q = hostGeom(a);
      q.pins.forEach((p, k) => {
        if (p.name === 'clk') p.cells.forEach((r, j) => { if ((j + Math.floor(s.ms / 160)) % 2 === 0) out.lit.push({ rect: r, color: 'alu', a: s.busy ? 0.7 : 0.28 }); });
        else if (moving) {
          // the launch comes in on the transmit lanes of the host, the answer goes out on the receive ones
          const mine = s.phase === 'in' ? p.name.startsWith('tx') : p.name.startsWith('rx');
          if (mine) p.cells.forEach((r, j) => { const jj = s.phase === 'in' ? j : 9 - j; if (Math.floor(wave(s.ms, jj + k) * 3) === 2) out.lit.push({ rect: r, color: 'mul', a: 0.8 }); });
        }
      });
      if (moving) out.lit.push({ rect: { ...q.meter, w: q.meter.w * s.progress }, color: 'mul', a: 0.75 });
      out.texts.push({ rect: q.note, top: s.phase === 'in' ? 'launch in' : s.phase === 'out' ? 'answer out' : s.busy ? 'working' : 'idle', small: true, ink: true, fit: 12 });
      break;
    }
    case 'ctl': {
      const rows = ctlGeom(a), word = [0, s.descAt, s.count, s.cycles, s.fault, K];
      const on = [s.busy, s.error, s.done, true];
      rows[0]!.chips.forEach((r, j) => { if (on[j]) out.lit.push({ rect: r, color: j === 1 ? 'bad' : 'st', a: 0.7 }); });
      rows.forEach((row, k) => {
        if (k === 0) return;
        if (s.phase === 'in' && k <= 2) out.lit.push({ rect: row.value, color: 'st', a: 0.25 + 0.2 * wave(s.ms, k) });
        if (k === 4 && s.fault !== 0) out.lit.push({ rect: row.value, color: 'bad', a: 0.35 });
        num(row.value, k === 1 ? `0x${hex(word[k]!, 4)}` : k === 5 ? `${K} x ${K}` : String(word[k]), true);
      });
      if (s.error && s.fault) out.texts.push({ rect: { ...rows[0]!.value, y: rows[0]!.y + rows[0]!.h + 1, h: 8 }, top: FAULT_NAMES[s.fault] ?? '', small: true, ink: true, fit: 12 });
      break;
    }
    case 'desc': {
      const q = descGeom(a);
      s.list.forEach((d, k) => {
        const r = q.rows[k];
        if (!r) return;
        const cur = k === s.index && s.phase !== 'idle', done = s.index > k || (s.index === k && !running && s.phase === 'out') || (s.done && s.phase === 'idle');
        if (cur) out.lit.push({ rect: r.row, color: 'br', a: 0.55 + 0.2 * wave(s.ms, 0) });
        else if (done) out.lit.push({ rect: r.row, color: 'st', a: 0.16 });
        if (cur && st) out.lit.push({ rect: { ...r.row, w: r.row.w * st.progress, y: r.row.y + r.row.h - 2, h: 2 }, color: 'br', a: 0.95 });
        num(r.op, OP_NAMES[d.op] ?? `OP ${d.op}`);
        const x = operand(d.op, 'a', d.a), y = operand(d.op, 'b', d.b);
        if (x) num(r.a, x);
        if (y) num(r.b, y);
      });
      if (s.count > 0) out.texts.push({ rect: q.foot, top: s.count > s.list.length ? `${s.list.length} of ${s.count} shown` : `${s.count} descriptor${s.count === 1 ? '' : 's'}`, small: true, ink: true, fit: 16 });
      else out.texts.push({ rect: q.foot, top: 'no list yet', small: true, ink: true, fit: 12 });
      break;
    }
    case 'tiles': {
      tilesGeom(a, K).forEach((t, k) => {
        const using = running && ((op === NpuOp.Matmul || op === NpuOp.Macc) && (st!.a === k || st!.b === k)), loading = running && op === NpuOp.Load && st!.a === k, layer = running && op === NpuOp.Layer;
        if (s.tiles[k]) out.lit.push({ rect: t.box, color: 'ld', a: 0.16 });
        const fill = loading ? Math.floor(st!.progress * K * K) : s.tiles[k] ? K * K : 0;
        t.cells.forEach((r, j) => {
          if (j < fill) out.lit.push({ rect: r, color: 'ld', a: loading && j >= fill - K ? 0.95 : 0.5 });
          if (using || (layer && Math.floor(wave(s.ms, j + k, 1.4) * 2) === 1)) out.lit.push({ rect: r, color: 'mul', a: using ? 0.8 : 0.4 });
        });
        if (using || loading) out.lit.push({ rect: t.box, color: using ? 'mul' : 'ld', a: 0.2 + 0.15 * wave(s.ms, k) });
      });
      break;
    }
    case 'array': {
      const q = arrayGeom(a, K), p = st?.progress ?? 0, product = running && (op === NpuOp.Matmul || op === NpuOp.Macc || op === NpuOp.Layer);
      const wf = product ? wavefront(op, p, K, st!.n) : null;
      q.cells.forEach((r, k) => {
        const i = Math.floor(k / K), j = k % K, d = i + j;
        let shown = s.acc[k] ?? 0;
        if (wf) {
          const diff = d - wf.front;
          // the value changes as the wave passes; before it a cell still holds the sum from before this step
          if (op !== NpuOp.Layer && diff + 2 > 0) shown = s.prevAcc[k] ?? 0;
          if (Math.abs(diff) < 1.3) {
            out.lit.push({ rect: r, color: 'mul', a: 0.9 });
            out.lit.push({ rect: q.east[k]!, color: 'alu', a: 0.95 }, { rect: q.south[k]!, color: 'ld', a: 0.95 });
          } else if (diff < 0) out.lit.push({ rect: r, color: 'mul', a: 0.22 });
        } else if (running && op === NpuOp.Relu) {
          const done = i < p * K;
          if (done && (s.prevAcc[k] ?? 0) < 0) out.lit.push({ rect: r, color: 'bad', a: 0.85 });
          else if (done) out.lit.push({ rect: r, color: 'mul', a: 0.2 });
          if (!done) shown = s.prevAcc[k] ?? 0;
        } else if (running && op === NpuOp.Bias) {
          if (i < p * K) out.lit.push({ rect: r, color: 'alu', a: i === Math.floor(p * K) ? 0.85 : 0.25 });
          else shown = s.prevAcc[k] ?? 0;
        } else if (running && op === NpuOp.Store) {
          if (i <= p * K) out.lit.push({ rect: r, color: 'st', a: i === Math.floor(p * K) ? 0.8 : 0.3 });
        }
        if (shown !== 0 || running) out.texts.push({ rect: r, top: String(shown), ink: shown !== 0, fit: Math.max(3, Math.min(7, String(shown).length)) });
      });
      if (wf) {
        // the inputs: the activation rows from the west and the weight columns from the north, each while its data is on the way in
        for (let i = 0; i < K; i++) if (wf.front > i - 1 && wf.front < i + K + 1) out.lit.push({ rect: q.rowIn[i]!, color: 'alu', a: 0.9 });
        for (let j = 0; j < K; j++) if (wf.front > j - 1 && wf.front < j + K + 1) out.lit.push({ rect: q.colIn[j]!, color: 'ld', a: 0.9 });
        out.texts.push({ rect: q.cap, top: op === NpuOp.Layer ? `layer ${st!.n} x ${st!.n}: tile ${wf.tile + 1} of ${wf.tiles}` : `t${st!.a} x t${st!.b}${op === NpuOp.Macc ? ' added to the sums' : ''}`, small: true, ink: true, fit: 30 });
      } else if (running) out.texts.push({ rect: q.cap, top: op === NpuOp.Relu ? 'negative sums become 0' : op === NpuOp.Bias ? 'one bias added to each row' : op === NpuOp.Store ? 'rows out to card memory' : 'array waits for the tile', small: true, ink: true, fit: 30 });
      break;
    }
    case 'post': {
      const q = postGeom(a, K), p = st?.progress ?? 0;
      if (running && (op === NpuOp.Matmul || op === NpuOp.Macc || op === NpuOp.Layer) && p > 0.55) q.inRow.cells.forEach((r, k) => { if (k / K < (p - 0.55) / 0.45) out.lit.push({ rect: r, color: 'mul', a: 0.6 }); });
      if (running && op === NpuOp.Bias) { out.lit.push({ rect: { x: q.add.cx - q.add.r, y: q.add.cy - q.add.r, w: 2 * q.add.r, h: 2 * q.add.r }, color: 'alu', a: 0.8 }, { rect: q.inRow.box, color: 'alu', a: 0.2 }); }
      if (running && op === NpuOp.Relu) out.lit.push({ rect: q.relu, color: 'mul', a: 0.8 });
      if (running && (op === NpuOp.Store || op === NpuOp.Layer)) {
        out.lit.push({ rect: q.relu, color: 'mul', a: op === NpuOp.Layer ? 0.4 : 0 });
        q.outRow.cells.forEach((r, k) => { if (k / K < p) out.lit.push({ rect: r, color: 'st', a: 0.7 }); });
      }
      break;
    }
    case 'cardmem': {
      const q = memGeom(a);
      if (s.count > 0) out.lit.push({ rect: memWindow(q.ruler, s.descAt, s.descAt + s.count * 16, s.memBytes), color: 'br', a: 0.3 });
      let rd = 0, wr = 0;
      if (running && st) {
        for (const [lo, hi] of st.reads) { out.lit.push({ rect: memWindow(q.ruler, lo, hi, s.memBytes), color: 'ld', a: 0.5 + 0.3 * wave(s.ms, 0) }); rd += hi - lo; }
        for (const [lo, hi] of st.writes) { out.lit.push({ rect: memWindow(q.ruler, lo, hi, s.memBytes), color: 'st', a: 0.5 + 0.3 * wave(s.ms, 1) }); wr += hi - lo; }
      }
      out.texts.push({ rect: q.rd, top: `read ${rd} B`, small: true, ink: rd > 0, fit: 12 }, { rect: q.wr, top: `write ${wr} B`, small: true, ink: wr > 0, fit: 12 });
      out.texts.push({ rect: q.note, top: s.count > 0 ? `list at 0x${hex(s.descAt, 4)}, ${s.count * 16} B` : `${Math.round(s.memBytes / 1024)}K, cleared at power-on`, small: true, ink: true, fit: 28 });
      break;
    }
    default: break;
  }
  return out;
}
