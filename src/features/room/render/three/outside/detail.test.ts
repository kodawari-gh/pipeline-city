import { describe, expect, it } from 'vitest';
import { CITY_CUTS, parseCityCuts } from './detail';

const on = (s: string, d: 'low' | 'high' = 'low'): string[] => Object.entries(parseCityCuts(s, d)).filter(([, v]) => v).map(([k]) => k);

describe('parseCityCuts', () => {
  it('Low with no flag: every cut (today)', () => {
    expect(on('')).toEqual([...CITY_CUTS]);
    expect(on('?tier=low&debug')).toEqual([...CITY_CUTS]);
  });
  it('Low with the flag: only the named cuts', () => {
    expect(on('?citycuts=far,steam')).toEqual(['far', 'steam']);
    expect(on('citycuts=Palette, fleet')).toEqual(['fleet', 'palette']);
  });
  it('none, an empty list or unknown names: no cut', () => {
    expect(on('?citycuts=none')).toEqual([]);
    expect(on('?citycuts=')).toEqual([]);
    expect(on('?citycuts=bogus')).toEqual([]);
  });
  it('High ignores the flag', () => {
    for (const s of ['', '?citycuts=far', '?citycuts=none', '?citycuts=cadence,far,streets,furniture,trees,steam,fleet,palette']) expect(on(s, 'high')).toEqual([]);
  });
});
