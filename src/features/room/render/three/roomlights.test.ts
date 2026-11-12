import { describe, expect, it } from 'vitest';
import { BED, NIGHTSTAND } from './roomplan';
import { CAPPED_BOUNCE, LAMP_CASTERS, LIGHT_ORDER, SHADOWLESS_CONE, WINDOW_LIGHTS, bounceLift, chooseLights, shadowlessCone, type LightId } from './roomlights';

/** The room as built: six strips under the shelves. */
const count = (id: LightId): number => (id === 'strips' ? 6 : 1);
const total = (live: Set<LightId>): number => [...live].reduce((n, id) => n + count(id), 0);

describe('shadowlessCone', () => {
  const cone = (cap: number, lampShadows: boolean, id: LightId = 'bedside') => {
    const c = chooseLights(cap, lampShadows, count);
    return shadowlessCone(id, c.live.has(id), c.shadows.has(id));
  };
  it('gives the bedside lantern its cone only with the lamps\' shadows off, and the point light back with them on', () => {
    expect(cone(0, false)).toBe(SHADOWLESS_CONE.bedside);
    expect(cone(0, true)).toBeNull();
    expect(cone(8, false)).toBe(SHADOWLESS_CONE.bedside);
    expect(cone(8, true)).toBeNull();
  });
  it('gives none to a capped lantern (Low), nor to a lamp that needs none', () => {
    expect(cone(4, false)).toBeNull();
    for (const id of LIGHT_ORDER) if (id !== 'bedside') expect(cone(0, false, id)).toBeNull();
  });
  it('takes it when the shadow level frees the map of a lamp that may cast', () => {
    expect(shadowlessCone('bedside', true, false)).toBe(SHADOWLESS_CONE.bedside);
  });
  it('cuts under the drawer\'s top and keeps the mattress\'s top: zero below the nearest edge\'s shadow line, full to the bed', () => {
    const { x, w, z0, z1, top, lamp } = NIGHTSTAND, { angle, penumbra } = SHADOWLESS_CONE.bedside!;
    const lx = x + lamp.dx, lz = (z0 + z1) / 2 + lamp.dz, up = 300 + (lamp.h - 300) / 2;
    const deg = (rad: number) => (rad * 180) / Math.PI, under = (reach: number, drop: number) => deg(Math.atan(drop / reach));
    const end = deg(angle) - 90, full = deg(angle * (1 - penumbra)) - 90;
    // the wall and the floor under the drawer, and the bed's side from the drawer's foot down: no light
    expect(under(lz - z0, up + NIGHTSTAND.h)).toBeGreaterThan(end);
    expect(under(BED.x - lx, up + NIGHTSTAND.h)).toBeGreaterThan(end);
    // the cone ends inside the top's own shadow on three sides (the east edge's line is the flattest: the book lies there)
    for (const reach of [lx - x, lz - z0, z1 - lz]) expect(under(reach, up)).toBeGreaterThan(end - 2);
    // the mattress's top, from the bed's near edge on: the point light's full level
    expect(under(BED.x - lx, up + (BED.top - top))).toBeLessThan(full + 2.5);
    expect(under(BED.x + 3000 - lx, up + (BED.top - top))).toBeLessThan(full);
    expect(full).toBeGreaterThan(0);
  });
});

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
  });
  it('leaves only the window\'s shadows with the lamps\' shadows off', () => {
    for (const cap of [4, 8, 0]) expect([...chooseLights(cap, false, count).shadows]).toEqual(['key', 'sun']);
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
