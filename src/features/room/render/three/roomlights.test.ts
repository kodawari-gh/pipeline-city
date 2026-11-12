import { describe, expect, it } from 'vitest';
import { ALWAYS_CASTS, CAPPED_BOUNCE, LAMP_CASTERS, LIGHT_ORDER, WINDOW_LIGHTS, bounceLift, chooseLights, type LightId } from './roomlights';

/** The room as built: six strips under the shelves. */
const count = (id: LightId): number => (id === 'strips' ? 6 : 1);
const total = (live: Set<LightId>): number => [...live].reduce((n, id) => n + count(id), 0);

describe('chooseLights', () => {
  it('keeps the window, the arc lamp and the desk lamp at a cap of 4', () => {
    const c = chooseLights(4, true, count);
    expect([...c.live]).toEqual(['key', 'sun', 'arc', 'desk']);
    expect(total(c.live)).toBe(4);
  });
  it('adds the two lanterns and the sconce at a cap of 8', () => {
    const c = chooseLights(8, true, count);
    expect([...c.live]).toEqual(['key', 'sun', 'arc', 'desk', 'floor', 'bedside', 'sconceUp', 'sconceDown']);
    expect(total(c.live)).toBe(8);
  });
  it('keeps every light with no cap', () => {
    const c = chooseLights(0, true, count);
    expect([...c.live]).toEqual([...LIGHT_ORDER]);
    expect(total(c.live)).toBe(20);
  });
  it('never passes the cap, and a higher cap only adds lights', () => {
    let last = new Set<LightId>();
    for (let cap = 1; cap <= 24; cap++) {
      const { live } = chooseLights(cap, true, count);
      expect(total(live)).toBeLessThanOrEqual(cap);
      for (const id of last) expect(live.has(id)).toBe(true);
      last = live;
    }
  });
  it('takes the strips whole or not at all', () => {
    expect(chooseLights(19, true, count).live.has('strips')).toBe(false);
    expect(chooseLights(20, true, count).live.has('strips')).toBe(true);
  });
  it('lets every live caster cast with the lamps\' shadows on', () => {
    expect([...chooseLights(0, true, count).shadows].sort()).toEqual([...WINDOW_LIGHTS, ...LAMP_CASTERS].sort());
    expect([...chooseLights(4, true, count).shadows]).toEqual(['key', 'sun', 'arc', 'desk']);
    // (High and Ultra: each lamp at its level's own map size)
    for (const cap of [4, 8, 0]) expect(chooseLights(cap, true, count).small.size).toBe(0);
  });
  it('keeps the bedside lantern\'s shadow, at the smallest map, with the lamps\' shadows off (Medium)', () => {
    for (const cap of [8, 0]) {
      const c = chooseLights(cap, false, count);
      expect([...c.shadows]).toEqual(['key', 'sun', 'bedside']);
      expect([...c.small]).toEqual(['bedside']);
    }
  });
  it('casts nothing for a capped bedside lantern (Low): only the window\'s shadows', () => {
    const c = chooseLights(4, false, count);
    expect(c.live.has('bedside')).toBe(false);
    expect([...c.shadows]).toEqual(['key', 'sun']);
    expect(c.small.size).toBe(0);
  });
  it('lets only lamps with a map cast always', () => {
    for (const id of ALWAYS_CASTS) expect(LAMP_CASTERS).toContain(id);
  });
  it('names each light once, the window first', () => {
    expect(new Set(LIGHT_ORDER).size).toBe(LIGHT_ORDER.length);
    expect(LIGHT_ORDER.slice(0, 2)).toEqual(WINDOW_LIGHTS);
    for (const id of LAMP_CASTERS) expect(LIGHT_ORDER).toContain(id);
  });
});

describe('bounceLift', () => {
  it('leaves a live group as baked and lifts a capped one', () => {
    expect(bounceLift(0, 2)).toBe(1);
    expect(bounceLift(2, 2)).toBe(CAPPED_BOUNCE);
    expect(bounceLift(1, 2)).toBeCloseTo((1 + CAPPED_BOUNCE) / 2);
    expect(bounceLift(0, 0)).toBe(1);
  });
});
