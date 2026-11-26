import { assert, describe, expect, it } from 'vitest';
import { FLOOR_Y, WALL_T, WINDOW } from '../roomplan';
import {
  FLOOR_UP,
  GRID,
  M,
  STYLES,
  avenueX,
  blockRect,
  buildings,
  downtown,
  lamps,
  onCrossing,
  parked,
  streetZ,
  toOutside,
  topOf,
  trees,
} from './plan';
import type * as planTypes from './plan';

/** Is a point (x, z) on a road or a pavement: in a street's or an avenue's width? */
const inStreet = (x: number, z: number): boolean => {
  const i = Math.round((x - GRID.av0) / GRID.px),
    j = Math.round((-z - GRID.street / 2) / GRID.pz);
  return Math.abs(x - avenueX(i)) < GRID.avenue / 2 || Math.abs(z - streetZ(j)) < GRID.street / 2;
};

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The middle of a building's first tier. */
const mid = (b: planTypes.Building) => {
  assert.exists(b.tiers[0]);
  return [(b.tiers[0].x0 + b.tiers[0].x1) / 2, (b.tiers[0].z0 + b.tiers[0].z1) / 2] as const;
};

/** The mean. */
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** How far a one-tier building's height is from a whole number of storeys (0 for a stacked one). */
const storeyOff = (b: planTypes.Building, storey: number): number =>
  b.tiers.length === 1 ? Math.abs(topOf(b) / storey - Math.round(topOf(b) / storey)) : 0;

/** Whether a block stands across our street, near the window. */
const acrossOurStreet = (b: planTypes.Building): boolean => {
  assert.exists(b.tiers[0]);
  return b.tiers[0].z1 > -90 && Math.abs(mid(b)[0] - GRID.av0) < 300;
};

/** Whether a tree stands on the pavement (a shrub, or one taller than 13.5 m, may stand in a park). */
const kerbTree = (t: { kind: string; h: number }): boolean => t.kind !== 'shrub' && t.h < 13.5;

/** Whether a place is on a pavement, or off the streets (in a park). */
function standsRight(p: { x: number; z: number }): boolean {
  const i = Math.round((p.x - GRID.av0) / GRID.px),
    j = Math.round((-p.z - GRID.street / 2) / GRID.pz);
  const dx = Math.abs(p.x - avenueX(i)),
    dz = Math.abs(p.z - streetZ(j));
  const onWalk =
    (dx > GRID.avenue / 2 - GRID.walk && dx < GRID.avenue / 2) ||
    (dz > GRID.street / 2 - GRID.walk && dz < GRID.street / 2);
  const inPark = !inStreet(p.x, p.z);
  return onWalk || inPark;
}

describe('outside plan', () => {
  it('puts the room on the fifteenth floor, its outer wall face on the street side at z = 0', () => {
    expect(toOutside(0, -FLOOR_Y, 0)[1]).toBeCloseTo(FLOOR_UP);
    expect(toOutside(0, 0, -WALL_T)[2]).toBeCloseTo(0);
    expect(toOutside(M, 0, 0)[0]).toBeCloseTo(1);
    // (the glass starts on a low upstand over the floor)
    expect(toOutside(0, -(WINDOW.y + WINDOW.h), 0)[1]).toBeGreaterThan(FLOOR_UP);
  });

  it('lays the grid: our street under the window, blocks between the streets and avenues', () => {
    expect(streetZ(0) + GRID.street / 2).toBeCloseTo(0);
    const b = blockRect(0, 0);
    expect(b.z1).toBeCloseTo(-GRID.street);
    expect(b.x0).toBeCloseTo(avenueX(0) + GRID.avenue / 2);
    expect(b.x1 - b.x0).toBeCloseTo(GRID.px - GRID.avenue);
    expect(onCrossing(avenueX(1), streetZ(3))).toBe(true);
    expect(onCrossing(avenueX(1) + 40, streetZ(3))).toBe(false);
  });

  it('keeps every building on its block, its tiers stacked and set in, a whole number of storeys', () => {
    const bs = buildings();
    expect(bs.length).toBeGreaterThan(1500);
    for (const b of bs) {
      const s = STYLES[b.style];
      for (const t of b.tiers) {
        expect(t.x1).toBeGreaterThan(t.x0);
        expect(t.z1).toBeGreaterThan(t.z0);
        expect(inStreet((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2)).toBe(false);
        expect(t.z1).toBeLessThanOrEqual(-GRID.street + 1e-6);
      }
      expect(must(b.tiers[0]).y0).toBe(0);
      for (let i = 1; i < b.tiers.length; i++) {
        const t = must(b.tiers[i]),
          below = must(b.tiers[i - 1]);
        expect(t.y0).toBeCloseTo(below.y1);
        expect(t.x0).toBeGreaterThanOrEqual(below.x0);
        expect(t.x1).toBeLessThanOrEqual(below.x1);
      }
      expect(storeyOff(b, s.storey)).toBeLessThan(1e-6);
    }
  });

  it('builds tall downtown and lower out in the city', () => {
    const bs = buildings();
    const core = bs.filter((b) => downtown(...mid(b)) > 0.6).map((b) => topOf(b)),
      out = bs.filter((b) => downtown(...mid(b)) < 0.05).map((b) => topOf(b));
    expect(avg(core)).toBeGreaterThan(avg(out) * 2.5);
    expect(Math.max(...core)).toBeGreaterThan(350);
    // the blocks across our street are below the window; a few further on rise over it
    const across = bs.filter((b) => acrossOurStreet(b)).map((b) => topOf(b));
    expect(Math.max(...across)).toBeLessThan(FLOOR_UP);
    const near = bs.filter((b) => Math.hypot(mid(b)[0] - GRID.av0, mid(b)[1]) < 700).map((b) => topOf(b));
    expect(near.filter((h) => h > FLOOR_UP).length).toBeGreaterThan(5);
  });

  it('stands the trees and lamps on pavements, off the roads and the crossings', () => {
    for (const p of [...trees().filter((t) => kerbTree(t)), ...lamps()]) {
      expect(standsRight(p)).toBe(true);
    }
  });

  it('parks the cars on the roads, clear of the crossings', () => {
    const cs = parked();
    expect(cs.length).toBeGreaterThan(80);
    for (const c of cs) {
      expect(inStreet(c.x, c.z)).toBe(true);
      expect(onCrossing(c.x, c.z)).toBe(false);
    }
  });
});
