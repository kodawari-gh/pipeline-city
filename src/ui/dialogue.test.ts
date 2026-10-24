import { describe, expect, it } from 'vitest';
import { pagesOf } from './dialogue';

describe('dialogue pages', () => {
  it('keeps a short text as one page', () => {
    expect(pagesOf('Plug in the next key.')).toEqual(['Plug in the next key.']);
  });

  it('packs whole sentences up to the page size and never cuts one', () => {
    const a = 'A'.repeat(70) + '.', b = 'B'.repeat(70) + '.', c = 'C'.repeat(10) + '.';
    expect(pagesOf(`${a} ${b} ${c}`)).toEqual([a, `${b} ${c}`]);
    const long = 'L'.repeat(300) + '.';
    expect(pagesOf(long)).toEqual([long]);
  });

  it('survives text without a final stop and an empty text', () => {
    expect(pagesOf('No stop here')).toEqual(['No stop here']);
    expect(pagesOf('')).toEqual(['']);
  });
});
