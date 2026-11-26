import { describe, expect, it } from 'vitest';
import {
  ALWAYS_CASTS,
  CAPPED_BOUNCE,
  LAMP_CASTERS,
  LIGHT_ORDER,
  MACHINE_LIGHTS,
  WINDOW_LIGHTS,
  bounceLift,
  chooseLights,
} from './roomlights';
import type * as roomlightsTypes from './roomlights';

/** The scene as built: the sconce's two spots, six strips under the shelves. */
function count(id: roomlightsTypes.LightId): number {
  if (id === 'strips') {
    return 6;
  }
  return id === 'sconce' ? 2 : 1;
}
const total = (live: Set<roomlightsTypes.LightId>): number => [...live].reduce((n, id) => n + count(id), 0);

describe('chooseLights', () => {
  it("keeps the window's key, the arc lamp and the case's two RGB lights at a cap of 4 (Low: GFX-04)", () => {
    const c = chooseLights(4, true, count);
    expect([...c.live]).toStrictEqual(['key', 'arc', 'case', 'spill']);
    expect(total(c.live)).toBe(4);
  });
  it('adds the sun, the desk lamp and the two lanterns at a cap of 8', () => {
    const c = chooseLights(8, true, count);
    expect([...c.live]).toStrictEqual(['key', 'arc', 'case', 'spill', 'sun', 'desk', 'floor', 'bedside']);
    expect(total(c.live)).toBe(8);
  });
  it('keeps every light with no cap', () => {
    const c = chooseLights(0, true, count);
    expect([...c.live]).toStrictEqual([...LIGHT_ORDER]);
    expect(total(c.live)).toBe(22);
  });
  it("counts the machine's two lights in the cap", () => {
    for (const id of MACHINE_LIGHTS) {
      expect(LIGHT_ORDER).toContain(id);
    }
    expect(chooseLights(2, true, count).live.has('case')).toBe(false);
    expect(chooseLights(3, true, count).live.has('spill')).toBe(false);
    expect(chooseLights(4, true, count).live.has('sun')).toBe(false);
  });
  it('never passes the cap, and a higher cap only adds lights', () => {
    let last = new Set<roomlightsTypes.LightId>();
    for (let cap = 1; cap <= 24; cap++) {
      const { live } = chooseLights(cap, true, count);
      expect(total(live)).toBeLessThanOrEqual(cap);
      for (const id of last) {
        expect(live.has(id)).toBe(true);
      }
      last = live;
    }
  });
  it('takes the sconce and the strips whole or not at all', () => {
    expect(chooseLights(9, true, count).live.has('sconce')).toBe(false);
    expect(chooseLights(10, true, count).live.has('sconce')).toBe(true);
    expect(chooseLights(21, true, count).live.has('strips')).toBe(false);
    expect(chooseLights(22, true, count).live.has('strips')).toBe(true);
  });
  it("lets every live caster cast with the lamps' shadows on", () => {
    expect([...chooseLights(0, true, count).shadows].toSorted()).toStrictEqual(
      [...WINDOW_LIGHTS, ...LAMP_CASTERS].toSorted(),
    );
    expect([...chooseLights(4, true, count).shadows]).toStrictEqual(['key', 'arc']);
    // (High and Ultra: each lamp at its level's own map size)
    for (const cap of [4, 8, 0]) {
      expect(chooseLights(cap, true, count).small.size).toBe(0);
    }
  });
  it("keeps the bedside lantern's shadow, at the smallest map, with the lamps' shadows off (Medium)", () => {
    for (const cap of [8, 0]) {
      const c = chooseLights(cap, false, count);
      expect([...c.shadows]).toStrictEqual(['key', 'sun', 'bedside']);
      expect([...c.small]).toStrictEqual(['bedside']);
    }
  });
  it("casts nothing for a capped bedside lantern (Low): only the window's key may cast", () => {
    const c = chooseLights(4, false, count);
    expect(c.live.has('bedside')).toBe(false);
    expect([...c.shadows]).toStrictEqual(['key']);
    expect(c.small.size).toBe(0);
  });
  it('lets only lamps with a map cast always', () => {
    for (const id of ALWAYS_CASTS) {
      expect(LAMP_CASTERS).toContain(id);
    }
  });
  it("names each light once, the window's key first", () => {
    expect(new Set(LIGHT_ORDER).size).toBe(LIGHT_ORDER.length);
    expect(LIGHT_ORDER[0]).toBe('key');
    for (const id of WINDOW_LIGHTS) {
      expect(LIGHT_ORDER).toContain(id);
    }
    for (const id of LAMP_CASTERS) {
      expect(LIGHT_ORDER).toContain(id);
    }
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
