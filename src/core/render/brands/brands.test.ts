import { describe, expect, it } from 'vitest';
import { BRANDS, BRAND_IDS, MAKER, lockupWidth, wordWidth } from './index';
import type { Ctx } from './kit';
import { hasGlyphs, setType, typeWidth } from './type';

// docs/art-style.md §2: the neons a brand may light its mark with (and hako's plain white)
const NEONS = [
  '#3be3ff',
  '#a68bff',
  '#ff55dc',
  '#9ab8ff',
  '#a8ff55',
  '#8fd9e6',
  '#6dffa6',
  '#ffc247',
  '#ff5a78',
  '#ffc27d',
  '#e2eaff',
];
const HEX = /^#[0-9a-f]{6}$/;

/** A canvas context that draws nothing and keeps each fill colour it is given (the marks only fill, stroke and erase). */
function recorder(): { c: Ctx; fills: string[] } {
  const fills: string[] = [];
  const state: Record<string, unknown> = {};
  const c = new Proxy(state, {
    get: (t, k) => (k in t ? t[k as string] : () => undefined),
    set: (t, k, v) => {
      if (k === 'fillStyle' || k === 'strokeStyle') fills.push(String(v));
      t[k as string] = v;
      return true;
    },
  }) as unknown as Ctx;
  return { c, fills };
}

describe('the brands', () => {
  it('has a module for each id, keyed by its own id', () => {
    for (const id of BRAND_IDS) expect(BRANDS[id].id).toBe(id);
    expect(BRAND_IDS).toHaveLength(13);
  });

  it('each maker is a known brand', () => {
    for (const id of Object.values(MAKER)) expect(BRAND_IDS).toContain(id);
  });

  it('each scheme is six hex colours, its accent a palette neon', () => {
    for (const id of BRAND_IDS) {
      const k = BRANDS[id].colors;
      for (const v of Object.values(k)) expect(v, id).toMatch(HEX);
      expect(NEONS, id).toContain(k.accent);
    }
  });

  it('no two makers whose parts share the board light their marks with the same neon', () => {
    const board = ['cpu', 'gpu', 'npu', 'tpm', 'ram', 'storage', 'psu', 'cooler', 'board', 'nic'] as const;
    const makers = [...new Set(board.map((k) => MAKER[k]))];
    const accents = makers.map((id) => BRANDS[id].colors.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it('the brand type has a glyph for every letter of every word, and the word has a width', () => {
    for (const id of BRAND_IDS) {
      const b = BRANDS[id];
      expect(hasGlyphs(b.word), id).toBe(true);
      expect(typeWidth(b.word, b.type), id).toBeGreaterThan(0);
      expect(wordWidth(id, 10)).toBeCloseTo(typeWidth(b.word, b.type) * 10, 6);
    }
  });

  it('a lockup is the mark, the gap and the word', () => {
    for (const id of BRAND_IDS) {
      const b = BRANDS[id],
        h = 20;
      expect(lockupWidth(id, h)).toBeCloseTo(h * b.aspect + h * b.lockup.gap + wordWidth(id, h * b.lockup.cap), 6);
      expect(lockupWidth(id, h, { word: false })).toBeCloseTo(h * b.aspect, 6);
    }
  });

  it('a mark fills with the ink and the accent only (the print sets both)', () => {
    for (const id of BRAND_IDS) {
      const { c, fills } = recorder();
      BRANDS[id].mark(c, '#111111', '#222222');
      expect(fills.length, id).toBeGreaterThan(0);
      expect(
        fills.every((f) => f === '#111111' || f === '#222222'),
        `${id}: ${fills.join(' ')}`,
      ).toBe(true);
      expect(fills, id).toContain('#222222');
    }
  });

  it('a word sets in its ink and lights only the letters its style lights', () => {
    for (const id of BRAND_IDS) {
      const b = BRANDS[id],
        { c, fills } = recorder();
      setType(c, b.word, b.type, 0, 0, 10, '#111111', { acc: '#222222', lit: b.type.lit, litDots: b.type.litDots });
      expect(
        fills.every((f) => f === '#111111' || f === '#222222'),
        id,
      ).toBe(true);
      expect(fills.includes('#222222'), id).toBe(!!(b.type.lit?.length || (b.type.litDots && /[ij]/.test(b.word))));
    }
  });
});
