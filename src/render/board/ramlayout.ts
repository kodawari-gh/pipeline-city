// How the memory sticks show RAM (docs/DIE.md "Memory"): which address range each DRAM chip stands for, what colour each program, the OS and the
// boot ROM get, and the lines the magnifier reads at an address. Pure data: ramview.ts draws it.

import { disassemble } from '../../sim/isa';
import type { RamRegion } from '../../sim/game/ramregions';
import type { Rect } from './layout';
import type { Theme } from '../theme';
import { mix } from '../ink';

/** A page is the unit a chip is cut into (a block of the storage, 256 bytes); it is drawn as a tile of 16 x 16 pixels, one per byte, a row of the tile being a 16-byte cache line. */
export const PAGE = 256, TILE = 16;

/** A DRAM chip as a window onto the address space: `tilesX` x `tilesY` pages, in reading order. */
export interface ChipSlot { rect: Rect; lo: number; hi: number; tilesX: number; tilesY: number }

export interface Stick { idx: number; bytes: number }

/** Chips per stick (ramArt draws four). */
export const CHIPS_PER_STICK = 4;

/**
 * The address range of each chip. The sim's RAM is 64 KiB whatever is installed; the sticks are the physical memory: with more installed than
 * that the extra shows as free, with less the 64 KiB is spread over the chips there are. Sticks hold ascending addresses by slot number.
 * `rects` are the chips in device order, four per stick, as `sticks` lists the sticks; the result is in the same order.
 */
export function chipLayout(rects: Rect[], sticks: Stick[], ramBytes: number): ChipSlot[] {
  const n = rects.length;
  if (n === 0) return [];
  const entries = rects.map((rect, i) => ({ rect, order: sticks[Math.floor(i / CHIPS_PER_STICK)]?.idx ?? 0, i, w: (sticks[Math.floor(i / CHIPS_PER_STICK)]?.bytes ?? ramBytes / Math.max(1, Math.ceil(n / CHIPS_PER_STICK))) / CHIPS_PER_STICK }));
  entries.sort((a, b) => a.order - b.order || a.i - b.i);
  const cap = entries.reduce((s, e) => s + e.w, 0) || 1;
  const space = Math.max(cap, ramBytes);
  const out: ChipSlot[] = new Array(n);
  let at = 0;
  entries.forEach((e, k) => {
    const size = k === entries.length - 1 ? Math.max(256, space - at) : Math.max(256, Math.round((space * e.w) / cap / 256) * 256);
    const pages = Math.ceil(size / PAGE), tilesX = Math.min(8, pages);
    out[e.i] = { rect: e.rect, lo: at, hi: at + size, tilesX, tilesY: Math.ceil(pages / tilesX) };
    at += size;
  });
  return out;
}

/** The area of a chip the pixel map covers (the rest is the chip's label strip and frame). */
export const chipContent = (r: Rect): Rect => ({ x: r.x + 8, y: r.y + 24, w: r.w - 16, h: r.h - 32 });

/** The colour a region gets: the OS one colour, the boot ROM grey, a program by its type (so one kind of program always looks the same). */
export function regionColor(r: RamRegion, T: Theme): string {
  switch (r.kind) {
    case 'rom': return T.mute;
    case 'os': return T.ink;
    case 'osdata': return mix(T.ink, T.mute, 0.45);
    default: {
      const palette = [T.alu, T.ld, T.st, T.mul, T.br];
      let h = 0;
      for (const ch of r.type ?? String(r.owner ?? 0)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const c = palette[h % palette.length]!;
      return r.kind === 'work' ? mix(c, T.die, 0.4) : c; // a program's working memory is its colour, duller
    }
  }
}

/** Per byte: the index + 1 of the region it belongs to (0: none). A later region wins where two overlap. */
export function ownerMap(regions: RamRegion[], length: number): Uint8Array {
  const own = new Uint8Array(length);
  regions.forEach((r, i) => own.fill(i + 1, Math.max(0, r.lo), Math.min(length, r.hi)));
  return own;
}

/** Where the byte at `addr` is in its chip's picture, in pixels (the picture is `tilesX * TILE` wide): pages in reading order, each a 16 x 16 tile. */
export function pixelOf(slot: ChipSlot, addr: number): { x: number; y: number } {
  const off = addr - slot.lo, page = Math.floor(off / PAGE), within = off % PAGE;
  return { x: (page % slot.tilesX) * TILE + (within % TILE), y: Math.floor(page / slot.tilesX) * TILE + Math.floor(within / TILE) };
}

/**
 * The outline of the range [lo, hi) laid out `cols` to a row starting at `chipLo` (any unit: pages for the chip's tiles), in units of that
 * grid (x 0..cols): a rectangle for a range inside one row, otherwise the shape of a selected text block. Empty when the range misses the chip.
 */
export function spanOutline(lo: number, hi: number, chipLo: number, chipHi: number, cols: number): [number, number][] {
  const a = Math.max(lo, chipLo) - chipLo, b = Math.min(hi, chipHi) - chipLo;
  if (b <= a) return [];
  const ra = Math.floor(a / cols), rb = Math.floor((b - 1) / cols), xa = a % cols, xb = ((b - 1) % cols) + 1;
  if (ra === rb) return [[xa, ra], [xb, ra], [xb, ra + 1], [xa, ra + 1]];
  return [[xa, ra], [cols, ra], [cols, rb], [xb, rb], [xb, rb + 1], [0, rb + 1], [0, ra + 1], [xa, ra + 1]];
}

/** One line of the magnifier: a word of RAM, as hex and, where it is code, as the instruction. */
export interface LensRow { addr: number; word: number; hex: string; text: string; code: boolean; current: boolean; region: RamRegion | null }

const word = (img: Uint8Array, a: number): number => (a + 4 <= img.length ? (img[a]! | (img[a + 1]! << 8) | (img[a + 2]! << 16) | (img[a + 3]! << 24)) >>> 0 : 0);
const hex8 = (w: number): string => w.toString(16).padStart(8, '0');
const ascii = (w: number): string => [0, 8, 16, 24].map((s) => { const c = (w >>> s) & 255; return c >= 32 && c < 127 ? String.fromCharCode(c) : '.'; }).join('');

export function regionAt(regions: RamRegion[], addr: number): RamRegion | null {
  let hit: RamRegion | null = null;
  for (const r of regions) if (addr >= r.lo && addr < r.hi) hit = r;
  return hit;
}

/** Whether the word at `addr` is an instruction: the boot ROM, the kernel's code and a program's code are; tables, data and the unclaimed are not. */
export function isCodeAt(regions: RamRegion[], addr: number): boolean {
  const r = regionAt(regions, addr);
  if (!r) return false;
  if (r.kind === 'rom') return true;
  if (r.kind === 'os') return r.id === 'os-kernel';
  if (r.kind === 'app') return addr < (r.codeEnd ?? r.hi);
  return false;
}

/** `count` words around the word at `addr` (the one the CPU touched is `current`), clamped to the memory. */
export function lensRows(img: Uint8Array, regions: RamRegion[], addr: number, count = 9): LensRow[] {
  const mid = addr & ~3;
  const first = Math.max(0, Math.min(mid - 4 * Math.floor(count / 2), img.length - 4 * count));
  const rows: LensRow[] = [];
  for (let k = 0; k < count; k++) {
    const a = first + 4 * k;
    if (a + 4 > img.length) break;
    const w = word(img, a), code = isCodeAt(regions, a) && w !== 0;
    rows.push({ addr: a, word: w, hex: hex8(w), text: code ? disassemble(w) : w === 0 ? '' : ascii(w), code, current: a === mid, region: regionAt(regions, a) });
  }
  return rows;
}

/** The process table the OS keeps of memory: what the system holds, what each program holds (its image and the memory it claimed), what is free. */
export interface MemTable { total: number; sys: number; procs: { owner: number; name: string; type: string; bytes: number; image: number; claimed: number }[]; free: number }
export function memoryTable(regions: RamRegion[], total: number): MemTable {
  let sys = 0;
  const procs: MemTable['procs'] = [];
  for (const r of regions) {
    const n = r.hi - r.lo;
    if (r.kind === 'rom' || r.kind === 'os' || r.kind === 'osdata') { sys += n; continue; }
    let p = procs.find((q) => q.owner === r.owner);
    if (!p) { p = { owner: r.owner ?? 0, name: r.name.replace(/ data$/, ''), type: r.type ?? '', bytes: 0, image: 0, claimed: 0 }; procs.push(p); }
    p.bytes += n;
    if (r.kind === 'work') p.claimed += n; else p.image += n;
  }
  return { total, sys, procs, free: Math.max(0, total - sys - procs.reduce((a, p) => a + p.bytes, 0)) };
}

/** Bytes as "4.0K" / "812B". */
export function sizeText(n: number): string {
  if (n < 1024) return `${n}B`;
  const k = n / 1024;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}K`;
}
