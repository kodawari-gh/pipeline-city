import type { BufferGeometry } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { LOW_NEAR_RINGS, type CityDetail } from './detail';
import { buildings, GRID, type Building } from './plan';
import { drawn } from './sweep';
import { massGeometries, type MassRing } from './towers';

/** `massGeometries` as the Low cut will call it (the third parameter does not exist yet). */
const withDetail = massGeometries as (bs: readonly Building[], washes: [], detail?: CityDetail) => MassRing[];

const sum = (g: BufferGeometry): number => Array.from(g.attributes.position!.array).reduce((s, v) => s + v, 0);
const total = (rs: MassRing[]): number => rs.reduce((n, r) => n + drawn(r.geometry), 0);
const away = (b: Building): number => Math.hypot((b.tiers[0]!.x0 + b.tiers[0]!.x1) / 2 - GRID.av0, b.tiers[0]!.z1);

describe('massGeometries detail', () => {
  let bs: Building[], high: MassRing[];
  beforeAll(() => { bs = buildings(); high = massGeometries(bs); }, 60000);

  it('lock: High is the same with the detail omitted or "high": rings, draws, positions', () => {
    const again = withDetail(bs, [], 'high');
    expect(again.length).toBe(high.length);
    expect(again.map((r) => drawn(r.geometry))).toEqual(high.map((r) => drawn(r.geometry)));
    expect(again.map((r) => sum(r.geometry))).toEqual(high.map((r) => sum(r.geometry)));
    expect(again.map((r) => r.balls.length)).toEqual(high.map((r) => r.balls.length));
  }, 60000);

  it('Low: the near rings stay and every ring past them is one mesh', () => {
    expect(withDetail(bs, [], 'low').length).toBe(LOW_NEAR_RINGS + 1);
  }, 60000);

  it('Low: draws under 16% of the High triangles', () => {
    // (15% was the plain-block cut; far night lights — flood, LED, signs, crowns — add a little)
    expect(total(withDetail(bs, [], 'low'))).toBeLessThan(total(high) * 0.16);
  }, 60000);

  it('Low: the far mesh holds every far building as a plain block, of more than one height', () => {
    const low = withDetail(bs, [], 'low'), far = low[low.length - 1]!;
    // (the ring edge: ring 1 ends at 300 m)
    expect(far.balls.length).toBe(bs.filter((b) => away(b) >= 300).length);
    // each far building is a block, plus optional night pieces (flood, LED, signs, crowns, beacons)
    for (let i = 0; i < far.balls.length; i++) expect(far.at[i + 1]! - far.at[i]!).toBeGreaterThan(0);
    const aux = far.geometry.attributes.aux!;
    const lights = new Set<number>();
    for (let i = 0; i < aux.count; i++) lights.add(Math.round(aux.getY(i)));
    expect([3, 4, 5, 8, 9].some((k) => lights.has(k)), 'far blocks keep live night-light kinds').toBe(true);
    const pos = far.geometry.attributes.position!, tops = new Set<number>();
    for (let i = 0; i < far.balls.length; i++) {
      let top = -Infinity;
      for (let v = far.at[i]!; v < far.at[i + 1]!; v++) top = Math.max(top, pos.getY(v));
      tops.add(Math.round(top));
    }
    expect(tops.size).toBeGreaterThan(1);
  }, 60000);
});
