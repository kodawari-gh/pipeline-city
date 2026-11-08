import { describe, expect, it } from 'vitest';
import { Box3, type Mesh, Vector3 } from 'three';
import { radiatorSpan } from '@/features/room/render/desk/props/case';
import { BOARD_Z, CASE_D, CASE_Z } from '@/features/room/render/three/roomplan';
import { radiatorFit, radiatorPorts } from '../cooler';
import { COOLER, COOLER_HOLES, PCIE_RAILS, setLayoutTier } from '../layout/layout';
import { barbZ, coolerFanBox, coolerModel, hose, hoseEnds, radiatorFanSpot, radiatorModel } from './cooler3d';
import { FAN_MAX, FAN_ZC } from '@/features/room/render/three/roomplan';
import { getSpec, type FanSpec } from '../../sim/specs';
import { findById } from '@/core/render/three/pick';
import type { FanFit } from './fans3d';

const rad = (side: 'top' | 'front') => {
  const span = radiatorSpan(side)!;
  return { span, fit: radiatorFit(span, COOLER.x + COOLER.w / 2), count: span.ids.length };
};
const fit = (spec: string, slot: string): FanFit => ({ id: `d-${slot}`, slot, spec: getSpec(spec) as FanSpec });

/** Where a cooler must stay at its real size: behind the board only its backplate, north of the first card's backplate, under the glass, clear of the RAM's tops. */
const inRoom = (visual: string, b: Box3) => {
  expect(b.min.z, visual).toBeGreaterThanOrEqual(BOARD_Z - 130);
  expect(-b.min.y, visual).toBeLessThan(PCIE_RAILS[0]!.y);
  expect(b.max.z, visual).toBeLessThan(CASE_Z + CASE_D - 200);
  expect(b.max.x, visual).toBeLessThan(1250);
};

describe('the 3D coolers', () => {
  it('mounts every cooler on the board\'s cooler holes over the CPU, a bare heatsink with nothing to spin (and on the loop the ring light and the impeller)', () => {
    for (const t of [0, 3]) {
      setLayoutTier(t, t);
      for (const [visual, spins] of [['cooler-stock', 0], ['cooler-tower', 0], ['cooler-liquid', 2]] as const) {
        const m = coolerModel(visual), b = new Box3().setFromObject(m.root);
        expect(m.spins.length, visual).toBe(spins);
        inRoom(visual, b);
        // the backplate reaches every hole
        for (const [x, y] of COOLER_HOLES) expect(b.containsPoint(new Vector3(x, -y, BOARD_Z)), visual).toBe(true);
      }
    }
  });

  it('shows the fans fitted on a heatsink, each on the CPU fan cable, inside its spot and picked as itself', () => {
    setLayoutTier(3, 3);
    for (const [visual, fans] of [['cooler-stock', [fit('fan92', 'cooler0.fan0')]], ['cooler-tower', [fit('fan120', 'cooler0.fan0'), fit('fan120x', 'cooler0.fan1')]]] as const) {
      const m = coolerModel(visual, fans), b = new Box3().setFromObject(m.root);
      expect(m.spins.map((s) => s.needs), visual).toEqual(fans.map(() => 'cpufan'));
      inRoom(visual, b);
      fans.forEach((f, k) => {
        // (its light stands a little proud of its face)
        const o = findById(m.root, f.id)!, c = new Box3().setFromObject(o, true), spot = coolerFanBox(visual, k)!, proud = 32;
        expect(c.min.x, f.slot).toBeGreaterThanOrEqual(spot.r.x - proud);
        expect(c.max.x, f.slot).toBeLessThanOrEqual(spot.r.x + spot.r.w + proud);
        expect(c.min.z, f.slot).toBeGreaterThanOrEqual(spot.z0 - proud);
        expect(c.max.z, f.slot).toBeLessThanOrEqual(spot.z1 + proud);
      });
    }
  });

  it('has no fan spot on the liquid block', () => {
    expect(coolerFanBox('cooler-liquid', 0)).toBeNull();
  });

  it('hangs the loop\'s two hoses from the pump\'s ports to the radiator\'s barbs, whichever side it is bolted on', () => {
    setLayoutTier(3, 3);
    for (const side of ['top', 'front'] as const) {
      const r = rad(side), ends = hoseEnds(r);
      expect(ends.length, side).toBe(2);
      const tips = radiatorPorts(r.fit).tips.map((t) => new Vector3(t[0], -t[1], barbZ(r)));
      for (const [a, b] of ends) {
        // the sleeve's first and last rings (its two caps follow them, a centre and a ring each): their centres are the hose's ends
        const t = hose(a, b, { planes: [], solids: [] }).children[0] as Mesh, pos = t.geometry.getAttribute('position'), ring = 15, caps = 2 * (ring + 1);
        const centre = (first: number) => Array.from({ length: ring - 1 }, (_, j) => new Vector3().fromBufferAttribute(pos, first + j)).reduce((s, p) => s.add(p), new Vector3()).divideScalar(ring - 1);
        expect(centre(0).distanceTo(new Vector3(...a.at)), side).toBeLessThan(2);
        expect(Math.min(...tips.map((p) => p.distanceTo(centre(pos.count - caps - ring)))), side).toBeLessThan(40);
      }
      // the barbs sit inside the radiator's depth
      expect(barbZ(r)).toBeGreaterThan(FAN_ZC - FAN_MAX / 2);
      expect(barbZ(r)).toBeLessThan(FAN_ZC);
    }
  });

  it('shows a radiator bare, and a fan only on the mounts that have one, each on its mount\'s cable', () => {
    setLayoutTier(3, 3);
    for (const side of ['top', 'front'] as const) {
      const r = rad(side), ids = r.span.ids, bare = radiatorModel(r.fit, 2, ids);
      expect(bare.spins, side).toEqual([]);
      const full = radiatorModel(r.fit, 2, ids, ids.map((id) => fit('fan140', id)));
      expect(full.spins.map((s) => s.needs), side).toEqual(ids.map((id) => 'fan:' + id));
      const one = radiatorModel(r.fit, 2, ids, [fit('fan140', ids[ids.length - 1]!)]), o = findById(one.root, `d-${ids[ids.length - 1]}`)!;
      expect(one.spins.map((s) => s.needs), side).toEqual(['fan:' + ids[ids.length - 1]]);
      const spot = radiatorFanSpot(r.fit, ids.length - 1, ids.length).r;
      expect(o.position.x, side).toBeCloseTo(spot.x + spot.w / 2, 3);
      expect(-o.position.y, side).toBeCloseTo(spot.y + spot.h / 2, 3);
    }
  });
});
