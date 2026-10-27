import { describe, expect, it } from 'vitest';
import { assemble } from '../sim/asm';
import type { RamRegion } from '../sim/game/ramregions';
import { CHIPS_PER_STICK, PAGE, TILE, chipLayout, isCodeAt, lensRows, ownerMap, pixelOf, regionColor, sizeText, spanOutline } from './ramlayout';
import type { Theme } from './theme';

const chips = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i * 150, y: 0, w: 116, h: 112 }));
const reg = (o: Partial<RamRegion> & { id: string; kind: RamRegion['kind']; lo: number; hi: number }): RamRegion => ({ name: o.id, note: '', ...o });

describe('which addresses a chip stands for', () => {
  it('one 64K stick is four chips of 16K; sticks follow their slot numbers', () => {
    const l = chipLayout(chips(8), [{ idx: 1, bytes: 65536 }, { idx: 0, bytes: 65536 }], 65536);
    expect(l).toHaveLength(8);
    // stick 0 (listed second) holds the lowest addresses, and the memory the sim has (64K) is all in it
    expect(l[4]!.lo).toBe(0);
    expect(l[7]!.hi).toBe(65536);
    expect(l[0]!.lo).toBe(65536);
    expect(l[7]!.hi - l[4]!.lo).toBe(65536);
    for (const c of l) expect(c.hi - c.lo).toBe(16384);
  });

  it('chips cut the address space without gaps or overlaps', () => {
    for (const [n, bytes, ram] of [[4, 16384, 65536], [8, 32768, 65536], [32, 65536, 65536], [12, 16384, 65536]] as const) {
      const sticks = Array.from({ length: n / CHIPS_PER_STICK }, (_, i) => ({ idx: i, bytes }));
      const l = chipLayout(chips(n), sticks, ram).sort((a, b) => a.lo - b.lo);
      expect(l[0]!.lo).toBe(0);
      for (let i = 1; i < l.length; i++) expect(l[i]!.lo).toBe(l[i - 1]!.hi);
      expect(l[l.length - 1]!.hi).toBeGreaterThanOrEqual(ram);
      for (const c of l) expect(((c.hi - c.lo) % PAGE)).toBe(0);
    }
  });

  it('less memory installed than the sim has: the 64K is spread over the chips there are', () => {
    const l = chipLayout(chips(4), [{ idx: 0, bytes: 16384 }], 65536);
    expect(l[3]!.hi).toBe(65536);
  });

  it('a page is a 16 x 16 tile and the pixel of a byte follows from it', () => {
    const slot = chipLayout(chips(4), [{ idx: 0, bytes: 65536 }], 65536)[1]!; // 0x4000..0x7fff, 64 pages
    expect(slot.tilesX).toBe(8);
    expect(slot.tilesY).toBe(8);
    expect(pixelOf(slot, slot.lo)).toEqual({ x: 0, y: 0 });
    expect(pixelOf(slot, slot.lo + 1)).toEqual({ x: 1, y: 0 });
    expect(pixelOf(slot, slot.lo + TILE)).toEqual({ x: 0, y: 1 }); // the next 16 bytes (a cache line) are the next row
    expect(pixelOf(slot, slot.lo + PAGE)).toEqual({ x: TILE, y: 0 }); // the next page is the next tile
    expect(pixelOf(slot, slot.lo + 8 * PAGE)).toEqual({ x: 0, y: TILE });
    // every byte of the chip lands on its own pixel
    const seen = new Set<number>();
    for (let a = slot.lo; a < slot.hi; a++) { const p = pixelOf(slot, a); seen.add(p.y * slot.tilesX * TILE + p.x); }
    expect(seen.size).toBe(slot.hi - slot.lo);
  });
});

describe('what the colours say', () => {
  const T: Theme = { dark: true, bg: '#000', board: '#001', trace: '#002', sub: '#003', die: '#111111', pin: '#d4af5f', tile: '#222222', ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a', alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78' };
  it('the OS, the ROM and the programs look different, and one kind of program always looks the same', () => {
    const rom = regionColor(reg({ id: 'rom', kind: 'rom', lo: 0, hi: 1 }), T);
    const os = regionColor(reg({ id: 'k', kind: 'os', lo: 0, hi: 1 }), T);
    const a1 = regionColor(reg({ id: 'a', kind: 'app', lo: 0, hi: 1, owner: 1, type: 'calc' }), T);
    const a2 = regionColor(reg({ id: 'b', kind: 'app', lo: 0, hi: 1, owner: 9, type: 'calc' }), T);
    expect(a1).toBe(a2);
    expect(new Set([rom, os, a1]).size).toBe(3);
  });
});

describe('outlines of an address range', () => {
  it('a range inside one row is a rectangle', () => {
    expect(spanOutline(2, 5, 0, 64, 8)).toEqual([[2, 0], [5, 0], [5, 1], [2, 1]]);
  });
  it('a range over several rows is the shape of a selected block of text', () => {
    expect(spanOutline(3, 20, 0, 64, 8)).toEqual([[3, 0], [8, 0], [8, 2], [4, 2], [4, 3], [0, 3], [0, 1], [3, 1]]);
  });
  it('a range outside the chip has no outline, and one that starts before it starts at its first byte', () => {
    expect(spanOutline(100, 200, 0, 64, 8)).toEqual([]);
    expect(spanOutline(0, 10, 4, 64, 8)).toEqual([[0, 0], [6, 0], [6, 1], [0, 1]]);
  });
});

describe('the owner map and the magnifier', () => {
  const { program } = assemble('main:\n  li a0, 1\n  add a0, a0, a0\n  ecall\ndata:\n  .word 0x64636261\n  .word 0');
  const img = new Uint8Array(0x2000);
  program.forEach((w, i) => new DataView(img.buffer).setUint32(0x1000 + 4 * i, w, true));
  const regions = [reg({ id: 'rom', kind: 'rom', lo: 0, hi: 0x1000 }), reg({ id: 'app', kind: 'app', lo: 0x1000, hi: 0x1000 + program.length * 4, codeEnd: 0x1000 + (program.length - 2) * 4, owner: 3, type: 'calc' })];

  it('every byte has the region it belongs to, a later region winning', () => {
    const own = ownerMap(regions, img.length);
    expect(own[0]).toBe(1);
    expect(own[0xfff]).toBe(1);
    expect(own[0x1000]).toBe(2);
    expect(own[0x1000 + program.length * 4]).toBe(0);
  });

  it('instructions are disassembled in code, words are text in data', () => {
    expect(isCodeAt(regions, 0x1000)).toBe(true);
    expect(isCodeAt(regions, 0x1000 + (program.length - 2) * 4)).toBe(false);
    const rows = lensRows(img, regions, 0x1004, 5);
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.current)).toHaveLength(1);
    expect(rows.find((r) => r.current)!.addr).toBe(0x1004);
    expect(rows.find((r) => r.addr === 0x1004)!.text).toMatch(/^add /);
    const data = lensRows(img, regions, 0x1000 + (program.length - 2) * 4, 3).find((r) => r.current)!;
    expect(data.code).toBe(false);
    expect(data.text).toBe('abcd');
  });

  it('the magnifier stays inside the memory', () => {
    const top = lensRows(img, regions, 0, 9);
    expect(top[0]!.addr).toBe(0);
    const end = lensRows(img, regions, img.length - 4, 9);
    expect(end[end.length - 1]!.addr).toBe(img.length - 4);
    expect(end).toHaveLength(9);
  });

  it('sizes read as bytes or kilobytes', () => {
    expect(sizeText(180)).toBe('180B');
    expect(sizeText(4096)).toBe('4K');
    expect(sizeText(1100)).toBe('1.1K');
    expect(sizeText(65536)).toBe('64K');
  });
});
