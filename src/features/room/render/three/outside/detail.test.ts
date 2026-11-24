import { describe, expect, it, vi } from 'vitest';
import { CITY_CUTS, cityCuts, parseCityCuts } from './detail';

const on = (s: string, d: 'low' | 'high' = 'low'): string[] =>
  Object.entries(parseCityCuts(s, d))
    .filter(([, v]) => v)
    .map(([k]) => k);

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
    for (const s of [
      '',
      '?citycuts=far',
      '?citycuts=none',
      '?citycuts=cadence,far,streets,furniture,trees,steam,fleet,palette',
    ])
      expect(on(s, 'high')).toEqual([]);
  });
});

describe('no browser gate (cityCuts)', () => {
  const agent = (ua: string) => vi.stubGlobal('navigator', { userAgent: ua });
  it("Low takes every cut on Firefox as on Chrome: the page's cuts do not read the user agent (CITY-05)", () => {
    agent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0');
    const fox = cityCuts('low');
    agent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36');
    expect(cityCuts('low')).toEqual(fox);
    expect(Object.values(fox).every(Boolean)).toBe(true);
    expect(fox.facade && fox.sky && fox.clock && fox.cadence).toBe(true);
    vi.unstubAllGlobals();
  });
  it('High takes none on any browser', () => {
    agent('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0');
    expect(Object.values(cityCuts('high')).some(Boolean)).toBe(false);
    vi.unstubAllGlobals();
  });
});
