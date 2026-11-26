import { describe, expect, it } from 'vitest';
import { pagesOf } from './dialogue';

describe('dialogue pages', () => {
  it('keeps a short text as one page', () => {
    expect(pagesOf('Plug in the next key.')).toStrictEqual(['Plug in the next key.']);
  });

  it('packs whole sentences up to the page size and never cuts one', () => {
    const a = `${'A'.repeat(70)}.`,
      b = `${'B'.repeat(70)}.`,
      c = `${'C'.repeat(10)}.`;
    expect(pagesOf(`${a} ${b} ${c}`)).toStrictEqual([a, `${b} ${c}`]);
    const long = `${'L'.repeat(300)}.`;
    expect(pagesOf(long)).toStrictEqual([long]);
  });

  it('survives text without a final stop and an empty text', () => {
    expect(pagesOf('No stop here')).toStrictEqual(['No stop here']);
    expect(pagesOf('')).toStrictEqual(['']);
  });
});
