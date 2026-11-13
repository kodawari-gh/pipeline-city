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

  it('Low: draws under 15% of the High triangles', () => {
    expect(total(withDetail(bs, [], 'low'))).toBeLessThan(total(high) * 0.15);
  }, 60000);

  it('Low: the far mesh holds every far building as a plain block, of more than one height', () => {
    const low = withDetail(bs, [], 'low'), far = low[low.length - 1]!, maxTiers = Math.max(...bs.map((b) => b.tiers.length));
    // (the ring edge: ring 1 ends at 300 m)
    expect(far.balls.length).toBe(bs.filter((b) => away(b) >= 300).length);
    // each building is at most a box a tier (36 vertices)
    for (let i = 0; i < far.balls.length; i++) expect(far.at[i + 1]! - far.at[i]!).toBeLessThanOrEqual(36 * maxTiers);
    const pos = far.geometry.attributes.position!, tops = new Set<number>();
    for (let i = 0; i < far.balls.length; i++) {
      let top = -Infinity;
      for (let v = far.at[i]!; v < far.at[i + 1]!; v++) top = Math.max(top, pos.getY(v));
      tops.add(Math.round(top));
    }
    expect(tops.size).toBeGreaterThan(1);
  }, 60000);
});
