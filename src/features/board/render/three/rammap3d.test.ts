import { describe, expect, it } from 'vitest';
import { pagesOnDie } from './rammap3d';

describe('where the pages of a chip lie on its die', () => {
  it('spreads consecutive pages over the banks the controller drives, a bank filling its cells in turn', () => {
    const { at, rows } = pagesOnDie(64, 1, 16, 16);
    expect(at.slice(0, 16).map((a) => a.bank)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(at.slice(16, 32).map((a) => a.k)).toEqual(new Array(16).fill(1));
    expect(rows).toBe(4);
  });

  it('keeps every page in its own cell, with two channels as with one', () => {
    for (const ch of [1, 2, 4]) {
      const { at } = pagesOnDie(128, ch, 8, 16),
        cells = new Set(at.map((a) => `${a.bank}:${a.k}`));
      expect(cells.size, `${ch} channels`).toBe(128);
    }
  });

  it("leaves the banks the controller does not drive clear (it drives the weakest stick's)", () => {
    const { at } = pagesOnDie(64, 1, 4, 16);
    expect(Math.max(...at.map((a) => a.bank))).toBeLessThan(4);
  });
});
