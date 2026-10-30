// The memory popups of a graphics card (docs/GPU.md section 7, docs/DIE.md "Memory"): what the RAM sticks' magnifier does for the CPU's memory, one for each
// memory part of the card. Beside the part an instruction touched, a small panel names the instruction in flight and lists what the part holds right there: the
// words of card memory around the address, the words each bank serves and in which round, the lines the coalescer made, the lines a cache holds with their
// words, the lanes of the register the instruction writes. Pure data, no Pixi: `gpuLenses` is what the view draws and what the tests read.

import { gpuDisassemble } from '../../sim/isa/gpu';
import { GPU_CODE, GPU_FRAME } from '../../sim/isa/memmap';
import { gpuOpClass } from '../../sim/game/gpucode';
import type { OpClass } from '../../sim/game/jobcode';
import type { GpuSnap } from '../../sim/game/types';
import type { GpuStep } from '../../sim/ref/gpuref';
import type { GpuBlockKind } from './gpuplan';

/** Rows a popup shows. */
export const LENS_ROWS = 9;

export interface GpuLensRow {
  /** Left column: an address, a bank and round, a slot, a lane. */
  at: string;
  /** The value, in hex. */
  hex: string;
  /** What it reads as: the instruction when the word is code, else the number or a note. */
  text: string;
  /** The class pill of an instruction, null for data. */
  cls: OpClass | null;
  /** The row the instruction on show touched. */
  current: boolean;
}

export interface GpuLens {
  /** The block the popup belongs to. */
  block: string;
  kind: GpuBlockKind;
  title: string;
  /** Right of the title: the instruction in flight. */
  tag: string;
  rows: GpuLensRow[];
  note: string;
}

/** The parts of the plan the popups need. */
export interface LensBlock { id: string; kind: GpuBlockKind; sm?: number }

const h4 = (n: number): string => (n >>> 0).toString(16).padStart(4, '0');
const h8 = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');

/** Where a byte address of card memory is: the kernel's code, the two launch words, the output frame, or the rest. */
export function gpuRegionOf(addr: number): string {
  if (addr < GPU_CODE.words * 4) return 'kernel code';
  if (addr < GPU_FRAME.at) return 'launch arguments';
  if (addr < GPU_FRAME.at + GPU_FRAME.words * 4) return 'output frame';
  return 'work memory';
}

/** The instruction as the tag shows it. */
export const lensInstr = (s: GpuStep): string => (s.word !== undefined ? gpuDisassemble(s.word) : s.name);

/** A word of memory as a row: code reads as its instruction (with a pill), anything else as the number. */
function wordRow(addr: number, w: number, current: boolean): GpuLensRow {
  const code = addr < GPU_CODE.words * 4 && w !== 0;
  const text = code ? gpuDisassemble(w) : w === 0 ? '' : String(w | 0);
  return { at: h4(addr), hex: h8(w), text, cls: code ? gpuOpClass(text.split(' ')[0]!) : null, current };
}

/** Distinct words a vld / vst touched with the lane that got each, in lane order (lanes on one word share it: a broadcast). */
function touched(m: NonNullable<GpuStep['mem']>): { addr: number; data: number; lanes: number[] }[] {
  const out = new Map<number, { addr: number; data: number; lanes: number[] }>();
  m.addrs.forEach((a, k) => {
    const e = out.get(a);
    if (e) e.lanes.push(k);
    else out.set(a, { addr: a, data: m.data[k]!, lanes: [k] });
  });
  return [...out.values()];
}

const laneText = (lanes: number[]): string => (lanes.length === 1 ? `L${lanes[0]}` : `L${lanes[0]}..L${lanes[lanes.length - 1]}`);

/** Rows of a list around the focus one, so the focus row stays in view. */
function window9<T>(rows: T[], focus: number): T[] {
  const first = Math.max(0, Math.min(focus - (LENS_ROWS >> 1), rows.length - LENS_ROWS));
  return rows.slice(first, first + LENS_ROWS);
}

/**
 * The popups for the memory parts of the card. `step` is the instruction on show; a part that only a load or store reaches keeps the last such step
 * of the trace after it (like the RAM magnifier keeps the last address), while the register file shows the instruction on show only.
 */
export function gpuLenses(blocks: readonly LensBlock[], snap: GpuSnap, step: GpuStep | null, lineWords: number, banks: number): GpuLens[] {
  const memStep = step?.mem ? step : [...snap.trace].reverse().find((s) => s.mem) ?? null;
  const out: GpuLens[] = [];
  for (const b of blocks) {
    const sm = b.sm ?? 0;
    if (b.kind === 'regfile') {
      if (!step || step.dest === null) continue;
      const vals = snap.regs[step.dest];
      if (!vals) continue;
      const per = Math.max(1, Math.ceil(vals.length / Math.max(1, snap.sms?.length ?? 1)));
      const lo = (b.sm ?? 0) * per, lanes = vals.slice(lo, lo + per);
      const rows: GpuLensRow[] = window9(lanes.map((v, l): GpuLensRow => ({ at: `L${lo + l}`, hex: h8(v), text: ((step.mask >>> (lo + l)) & 1) === 1 ? String(v | 0) : 'masked off', cls: null, current: ((step.mask >>> (lo + l)) & 1) === 1 })), 0);
      out.push({ block: b.id, kind: b.kind, title: `Registers · v${step.dest}`, tag: lensInstr(step), rows, note: `v${step.dest} holds one word per lane; lanes the mask turned off keep their old value.` });
      continue;
    }
    if (b.kind !== 'dram' && b.kind !== 'banks' && b.kind !== 'coalescer' && b.kind !== 'l1' && b.kind !== 'l2') continue;
    const m = memStep?.mem;
    if (!memStep || !m) continue;
    const tag = `${lensInstr(memStep)}`;
    const t = touched(m);
    const first = m.addrs[0]!;
    if (b.kind === 'dram') {
      const rows = m.around.map((w, k) => wordRow(m.at + 4 * k, w, t.some((e) => e.addr === m.at + 4 * k)));
      out.push({ block: b.id, kind: b.kind, title: 'Card memory', tag, rows, note: `${gpuRegionOf(first)} · ${m.addrs.length} lane access${m.addrs.length === 1 ? '' : 'es'} at ${h4(first)}` });
    } else if (b.kind === 'banks') {
      const order = [...t].sort((a, c) => ((a.addr >>> 2) % banks) - ((c.addr >>> 2) % banks) || a.addr - c.addr);
      const served = new Map<number, number>();
      const rows = order.map((e): GpuLensRow => {
        const bank = (e.addr >>> 2) % banks, round = served.get(bank) ?? 0;
        served.set(bank, round + 1);
        return { at: `b${bank}.r${round}`, hex: h8(e.data), text: `@${h4(e.addr)}  ${laneText(e.lanes)}  ${e.data | 0}`, cls: null, current: round === 0 };
      });
      const worst = Math.max(...served.values());
      out.push({ block: b.id, kind: b.kind, title: banks > 1 ? `Banks · ${banks}` : 'Bank', tag, rows: rows.slice(0, LENS_ROWS), note: `${t.length} word${t.length === 1 ? '' : 's'} in ${worst} round${worst === 1 ? '' : 's'}${worst > 1 ? ' · a conflict: one word a round per bank' : ''}${rows.length > LENS_ROWS ? ` · +${rows.length - LENS_ROWS} more` : ''}` });
    } else if (b.kind === 'coalescer') {
      const lines = new Map<number, { lanes: number[]; first: number }>();
      m.addrs.forEach((a, k) => {
        const line = Math.floor(a / (lineWords * 4)), e = lines.get(line);
        if (e) e.lanes.push(k); else lines.set(line, { lanes: [k], first: a });
      });
      const rows = [...lines].map(([line, e]): GpuLensRow => ({ at: `line ${h4(line * lineWords * 4)}`, hex: String(e.lanes.length).padStart(2, ' '), text: `${e.lanes.length} lane${e.lanes.length === 1 ? '' : 's'}  ${laneText(e.lanes)}`, cls: null, current: false }));
      out.push({ block: b.id, kind: b.kind, title: 'Coalescer', tag, rows: rows.slice(0, LENS_ROWS), note: `${m.addrs.length} lane addresses → ${lines.size} line${lines.size === 1 ? '' : 's'} of ${lineWords} words` });
    } else {
      const cache = snap.caches?.find((c) => c.level === (b.kind === 'l1' ? 'L1' : 'L2') && (b.kind === 'l2' || c.sm === sm));
      if (!cache) continue;
      const slots = cache.lines.length, line = Math.floor(first / (cache.lineWords * 4)), slot = line & (slots - 1);
      const rows = window9(cache.lines.map((l, k): GpuLensRow => l
        ? { at: `#${k.toString(16)}`, hex: h4(l.line * cache.lineWords * 4), text: l.words.map((w) => w | 0).join(' '), cls: null, current: k === slot }
        : { at: `#${k.toString(16)}`, hex: '', text: 'empty', cls: null, current: k === slot }), slot);
      const held = cache.lines.filter((l) => l).length;
      out.push({ block: b.id, kind: b.kind, title: b.kind === 'l1' ? `L1 cache${(snap.sms?.length ?? 1) > 1 ? ` · SM ${sm}` : ''}` : 'L2 cache', tag, rows, note: `${held} of ${slots} lines valid · ${cache.lineWords} words each · write-through, memory is always up to date` });
    }
  }
  return out;
}
