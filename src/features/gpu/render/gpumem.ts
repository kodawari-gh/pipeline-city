// The memory parts of a graphics card, alive (docs/DIE.md "Memory", docs/GPU.md section 7): the data an instruction moves is shown inside the parts it moves
// through, the way the RAM sticks show theirs (ramview.ts): card memory is a map of cells that fill as words are written, an access opens a row into the row
// buffer under the map and the words of that row read out in its slots; each bank lights the word line of the word it serves, round after round, with the word
// beside it; a cache lists the lines it holds, tag and words, and the line an access hit lights up; the register file prints the values of the lanes the
// instruction reads and writes in the rows it names. Pure geometry and data, no Pixi: `gpuMemLive` is what the view draws over the symbols, the tests read it.

import { gpuDecode, gpuDisassemble } from '../sim/isa/isa';
import { GPU_CODE, GPU_FRAME } from '@/core/sim/memmap';
import { KERNEL_LAYOUT } from '../sim/kernels';
import type { GpuCacheView } from '../sim/engine/engine';
import type { GpuStep } from '../sim/isa/ref';
import { gpuOpClass } from '../sim/gpucode';
import type { OpClass } from '../../jobs/sim/jobcode';
import type { LiveGlyph } from '../../cpu/render/die/blockart';
import type { Rect } from '../../cpu/render/core/cpuplan';
import type { GpuBlock } from './plan/gpuplan';
import { gpuCells } from './plan/gpuplans';

/** Words of card memory one entry of `GpuView.fill` covers (machine/gpu.ts `GPU_FILL_WORDS`). */
const FILL_WORDS = 4;
const SLOTS = 9;

type Colored = LiveGlyph['lit'][number]['color'];

/** A value as a cell can hold it: a small number as it is, a big one in hex. */
export const compact = (v: number): string => (Math.abs(v | 0) < 100000 ? String(v | 0) : `0x${(v >>> 0).toString(16)}`);
const h4 = (n: number): string => (n >>> 0).toString(16).padStart(4, '0');

/** The card memory's drawing: the map of cells (a square of `cw` per cell), the row buffer's slots under it and the controller. */
export function dramGeom(a: Rect) {
  const { x, y, w, h } = a, foot = h > 150 ? 46 : 0, cw = 9, cols = Math.min(64, Math.floor(w / cw)), rows = Math.min(40, Math.floor((h - foot) / cw));
  const by = y + rows * cw + 4, bw = cols * cw;
  const slots: Rect[] = foot ? Array.from({ length: SLOTS }, (_, k) => ({ x: x + (k * bw) / SLOTS + 1, y: by, w: bw / SLOTS - 2, h: 22 })) : [];
  return { cw, cols, rows, foot, by, bw, slots, total: cols * rows };
}

/** Which kind of memory an address is: the kernel's code, its launch words, the picture it draws, or the rest. */
export function gpuRegion(addr: number): 'code' | 'args' | 'frame' | 'work' {
  if (addr < KERNEL_LAYOUT.param) return 'code';
  if (addr < GPU_FRAME.at) return 'args';
  return addr < GPU_FRAME.at + GPU_FRAME.words * 4 ? 'frame' : 'work';
}
const REGION_COLOR: Record<ReturnType<typeof gpuRegion>, Colored> = { code: 'alu', args: 'br', frame: 'st', work: 'ld' };

/** The cells of the map that hold something: each tinted by what lives there, as strong as it is full (`fill`: non-zero words per `FILL_WORDS`). */
export function dramFill(a: Rect, bytes: number, fill: readonly number[] | undefined): { rect: Rect; color: Colored; a: number }[] {
  const out: { rect: Rect; color: Colored; a: number }[] = [];
  if (!fill || !bytes) return out;
  const g = dramGeom(a), per = bytes / g.total, blockBytes = FILL_WORDS * 4;
  for (let k = 0; k < g.total; k++) {
    const lo = k * per, i0 = Math.floor(lo / blockBytes), i1 = Math.max(i0, Math.floor((lo + per - 1) / blockBytes));
    let n = 0;
    for (let i = i0; i <= i1; i++) n += fill[i] ?? 0;
    if (n === 0) continue;
    const f = Math.min(1, n / ((i1 - i0 + 1) * FILL_WORDS));
    out.push({ rect: { x: a.x + (k % g.cols) * g.cw + 1, y: a.y + Math.floor(k / g.cols) * g.cw + 1, w: g.cw - 2, h: g.cw - 2 }, color: REGION_COLOR[gpuRegion(lo)], a: 0.2 + 0.7 * f });
  }
  return out;
}

/** The cell of the memory map that holds byte address `addr` of a card memory of `bytes`. */
export function dramCellRect(a: Rect, bytes: number, addr: number): Rect {
  const g = dramGeom(a), k = Math.max(0, Math.min(g.total - 1, Math.floor((addr / bytes) * g.total)));
  return { x: a.x + (k % g.cols) * g.cw + 1, y: a.y + Math.floor(k / g.cols) * g.cw + 1, w: g.cw - 2, h: g.cw - 2 };
}

/** Words the card memory's magnifier shows. */
export const LENS_ROWS = 9;

export interface GpuLensRow { addr: number; hex: string; text: string; /** The class pill of an instruction, null for data. */ cls: OpClass | null; /** An address the instruction touched. */ current: boolean }
export interface GpuLens { title: string; /** The instruction in flight and the address it went to. */ tag: string; rows: GpuLensRow[]; note: string; /** The first address touched, and the kind of access. */ addr: number; kind: GpuStep['kind'] }

const REGION_NAME: Record<ReturnType<typeof gpuRegion>, string> = { code: 'kernel code', args: 'launch arguments', frame: 'output frame', work: 'work memory' };

/**
 * What the magnifier on card memory reads, like the RAM's (ramview.ts): the words around the address a load or store touched, code as the instruction with
 * its class, data as the number, the touched words marked, the region named. Null for a step that touched nothing.
 */
export function gpuLensRows(step: GpuStep | null): GpuLens | null {
  const m = step?.mem;
  if (!step || !m || m.addrs.length === 0) return null;
  const touched = new Set(m.addrs), first = m.addrs[0]!;
  const rows = m.around.map((w, k): GpuLensRow => {
    const addr = m.at + 4 * k, code = addr < GPU_CODE.words * 4 && w !== 0, text = code ? gpuDisassemble(w) : w === 0 ? '' : String(w | 0);
    return { addr, hex: (w >>> 0).toString(16).padStart(8, '0'), text, cls: code ? gpuOpClass(text.split(' ')[0]!) : null, current: touched.has(addr) };
  });
  const n = m.addrs.length, ins = step.word !== undefined ? gpuDisassemble(step.word) : step.name;
  return { title: 'Card memory', tag: `${ins}  @0x${first.toString(16).padStart(4, '0')}`, rows, note: `${REGION_NAME[gpuRegion(first)]} · ${n} lane access${n === 1 ? '' : 'es'}`, addr: first, kind: step.kind };
}

/** A bank's array: the rows (or, for a wide one, the columns) its words fall into. */
export function bankGeom(r: Rect) {
  const horizontal = r.w >= r.h, head = horizontal ? 0 : Math.min(9, r.h * 0.08), foot = horizontal ? 0 : Math.min(8, r.h * 0.07);
  const by = r.y + head, bh = r.h - head - foot;
  if (horizontal) { const n = Math.max(1, Math.floor(r.w / 6)); return { horizontal, n, slot: (j: number): Rect => ({ x: r.x + (j * r.w) / n, y: r.y + 1.5, w: r.w / n, h: r.h - 3 }) }; }
  const n = Math.max(1, Math.floor(bh / 6)), dec = r.h >= 90 && r.w >= 60 ? 10 : 0;
  return { horizontal, n, slot: (j: number): Rect => ({ x: r.x + 1.5 + dec, y: by + (j * bh) / n, w: r.w - 3 - dec, h: bh / n }) };
}

/** What the memory parts need to know about the card and the instruction on show. */
export interface MemCtx {
  /** The instruction on show on this block's SM, and the newest load or store before it (the row buffer and the caches keep what that one touched). */
  step: GpuStep | null;
  memStep: GpuStep | null;
  /** This block's SM, the lanes of one SM, the banks and the words of a line. */
  sm: number;
  perSm: number;
  banks: number;
  lineWords: number;
  /** The cache this block is, if it is one. */
  cache?: GpuCacheView;
  /** Which of its cycles the instruction is in (the banks serve one round a cycle). */
  round: number;
}

/** A word as a row-buffer slot reads it: code as its mnemonic, data as the number. */
const wordText = (addr: number, w: number): string => (addr < GPU_CODE.words * 4 && w !== 0 ? gpuDisassemble(w).split(' ')[0]! : w === 0 ? '0' : compact(w));

/** Distinct lines a load / store touched, in lane order, with the first address and word that fell in each. */
function linesOf(s: GpuStep, lineWords: number): { line: number; addr: number; data: number }[] {
  const out = new Map<number, { line: number; addr: number; data: number }>();
  s.mem?.addrs.forEach((a, k) => { const line = Math.floor(a / (lineWords * 4)); if (!out.has(line)) out.set(line, { line, addr: a, data: s.mem!.data[k]! }); });
  return [...out.values()];
}

/** The live layer of one memory block: `b` its block with the rectangle in the coordinates `a` is in (the symbol's area). */
export function gpuMemLive(b: Pick<GpuBlock, 'kind' | 'rect' | 'grid' | 'bytes'>, a: Rect, ctx: MemCtx): LiveGlyph {
  const out: LiveGlyph = { texts: [], lit: [] };
  const { step, memStep } = ctx;
  const done = (): LiveGlyph => {
    // texts of a group are sized alike, to the longest
    const len = new Map<string, number>();
    for (const t of out.texts) if (t.small) len.set(t.grp ?? '', Math.max(len.get(t.grp ?? '') ?? 0, t.top.length));
    for (const t of out.texts) if (t.small) t.fit = len.get(t.grp ?? '');
    return out;
  };
  switch (b.kind) {
    case 'dram': {
      const ms = memStep?.mem ? memStep : null, g = dramGeom(a);
      if (!ms?.mem || !b.bytes) break;
      const fresh = ms === step, m = ms.mem, per = b.bytes / g.total;
      // the cells the access reached, and the row buffer: the words of the row it opened, the ones the instruction touched lit
      for (const addr of new Set(m.addrs)) {
        const k = Math.min(g.total - 1, Math.floor(addr / per));
        out.lit.push({ rect: { x: a.x + (k % g.cols) * g.cw + 1, y: a.y + Math.floor(k / g.cols) * g.cw + 1, w: g.cw - 2, h: g.cw - 2 }, color: ms.kind === 'st' ? 'st' : 'ld', a: fresh ? 0.95 : 0.45 });
      }
      const hit = new Set(m.addrs);
      g.slots.forEach((r, k) => {
        const addr = m.at + 4 * k, w = m.around[k];
        if (w === undefined) return;
        out.lit.push({ rect: r, color: ms.kind === 'st' ? 'st' : 'ld', a: hit.has(addr) ? (fresh ? 0.8 : 0.4) : 0.14 });
        out.texts.push({ rect: r, top: h4(addr), bottom: wordText(addr, w) });
      });
      break;
    }
    case 'banks': {
      // the word lines of the last access stay up after it, dimmer, like the row buffer's words
      const ms = step?.mem ? step : memStep?.mem ? memStep : null;
      if (!ms) break;
      const fresh = ms === step, cells = gpuCells(b as GpuBlock), L = ctx.lineWords;
      const per: { addr: number; data: number; line: number }[][] = Array.from({ length: ctx.banks }, () => []);
      for (const e of linesOf(ms, L)) per[e.line % ctx.banks]?.push(e);
      per.forEach((list, bi) => {
        const r = cells[bi];
        if (!r || list.length === 0) return;
        const geo = bankGeom(r), served = fresh ? Math.min(list.length, ctx.round + 1) : list.length;
        list.forEach((e, k) => {
          const slot = geo.slot(Math.floor(e.line / ctx.banks) % geo.n), done = k < served;
          out.lit.push({ rect: slot, color: ms.kind === 'st' ? 'st' : 'ld', a: done ? (fresh ? 0.75 : 0.4) : 0.25 });
          if (done && !geo.horizontal && slot.h >= 4) out.texts.push({ rect: slot, top: `${h4(e.addr)} ${compact(e.data)}`, bottom: '', small: true, ink: true });
        });
      });
      break;
    }
    case 'l1':
    case 'l2': {
      const cache = ctx.cache;
      if (!cache) break;
      const cells = gpuCells(b as GpuBlock), slots = cache.lines.length, touched = new Set<number>();
      const ms = memStep?.mem ? memStep : null;
      if (ms) for (const e of linesOf(ms, cache.lineWords)) touched.add(e.line & (slots - 1));
      const fresh = !!ms && ms === step;
      cache.lines.forEach((l, k) => {
        const r = cells[k];
        if (!r || !l) return;
        const hit = touched.has(k), tag = { x: r.x, y: r.y, w: r.w * 0.3, h: r.h }, data = { x: r.x + r.w * 0.3 + 1, y: r.y, w: r.w * 0.7 - 1, h: r.h };
        out.lit.push({ rect: r, color: 'ld', a: hit ? (fresh ? 0.6 : 0.35) : 0.16 });
        if (r.h >= 5) out.texts.push({ rect: tag, top: h4(l.line * cache.lineWords * 4), bottom: '', small: true, ink: true, grp: 'tag' });
        // a roomy line prints its words in two rows, a small one only the line an access hit
        const ws = l.words.map((w) => compact(w)), half = Math.ceil(ws.length / 2);
        if (data.h >= 26 && data.w >= 36) out.texts.push({ rect: data, top: ws.slice(0, half).join(' '), bottom: ws.slice(half).join(' ') });
        else if (hit && data.h >= 16 && data.w >= 14) {
          // a small line the access hit: its words in a grid of two columns
          const rowsN = Math.ceil(ws.length / 2), cw = data.w / 2, ch = data.h / rowsN;
          ws.forEach((w, n) => out.texts.push({ rect: { x: data.x + (n % 2) * cw, y: data.y + Math.floor(n / 2) * ch, w: cw, h: ch }, top: w, bottom: '', small: true, ink: true, grp: 'words' }));
        }
        else if (r.h >= 5 && hit) out.texts.push({ rect: data, top: ws.join(' '), bottom: '', small: true, ink: true, grp: 'words' });
      });
      break;
    }
    case 'regfile': {
      if (!step?.vals || !step.word) break;
      const i = gpuDecode(step.word), cells = gpuCells(b as GpuBlock), cols = b.grid?.cols ?? 1, rows = b.grid?.rows ?? 0;
      if (!i || rows === 0) break;
      const base = ctx.sm * ctx.perSm, lane0 = (step.lane0 ?? 0) - base;
      const show = (row: number, vals: number[] | undefined, color: Colored, text: boolean): void => {
        if (!vals || row < 0 || row >= rows) return;
        vals.forEach((v, n) => {
          const col = lane0 + n;
          if (col < 0 || col >= cols || ((step.mask >>> n) & 1) === 0) return;
          const r = cells[row * cols + col];
          if (!r) return;
          out.lit.push({ rect: r, color, a: 0.3 });
          if (text) out.texts.push({ rect: r, top: compact(v), bottom: '', small: true, ink: true });
        });
      };
      // the sources the read ports bring (A, B) and the result that comes back in, each as the lanes of its register's row
      show(i.rs2, step.vals.b, 'mul', true);
      show(i.rs1, step.vals.a, 'alu', true);
      show(i.rd, step.vals.d, 'st', true);
      break;
    }
    default: break;
  }
  return done();
}
