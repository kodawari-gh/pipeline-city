import { describe, expect, it, vi } from 'vitest';
import { CITY_CUTS, cityCuts, firefox, parseCityCuts } from './detail';

const on = (s: string, d: 'low' | 'high' = 'low', ff = false): string[] => Object.entries(parseCityCuts(s, d, ff)).filter(([, v]) => v).map(([k]) => k);

describe('parseCityCuts', () => {
  it('Low with no flag: every cut (today)', () => {
    expect(on('')).toEqual([...CITY_CUTS]);
    expect(on('?tier=low&debug')).toEqual([...CITY_CUTS]);
  });
  it('Firefox Low with no flag: no cut (main\'s city path)', () => {
    expect(on('', 'low', true)).toEqual([]);
    expect(on('?tier=low&debug', 'low', true)).toEqual([]);
  });
  it('Firefox Low with the flag: the named cuts still apply', () => {
    expect(on('?citycuts=far,steam', 'low', true)).toEqual(['far', 'steam']);
    expect(on('?citycuts=cadence,fleet', 'low', true)).toEqual(['cadence', 'fleet']);
  });
  it('High on Firefox: no cut', () => {
    expect(on('', 'high', true)).toEqual([]);
    expect(on('?citycuts=far', 'high', true)).toEqual([]);
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

describe('the browser gate (cityCuts, firefox)', () => {
  const agent = (ua: string) => vi.stubGlobal('navigator', { userAgent: ua });
  it('Firefox is told by its user agent, and Low takes the Firefox cuts only there', () => {
    agent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0');
    expect(firefox()).toBe(true);
    expect(cityCuts('low')).toEqual(parseCityCuts('', 'low', true));
    agent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36');
    expect(firefox()).toBe(false);
    expect(cityCuts('low')).toEqual(parseCityCuts('', 'low', false));
    vi.unstubAllGlobals();
  });
  it('the facade, sky and clock cuts are off on Firefox with no flag', () => {
    agent('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0');
    const c = cityCuts('low');
    expect(c.facade || c.sky || c.clock).toBe(false);
    vi.unstubAllGlobals();
  });
});
