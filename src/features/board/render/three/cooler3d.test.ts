import { describe, expect, it } from 'vitest';
import { Box3, type Mesh, Vector3 } from 'three';
import { radiatorBay, radiatorSpan } from '@/features/room/render/desk/props/case';
import { BOARD_Z, CASE_D, CASE_Z, FAN_ZC } from '@/features/room/render/three/roomplan';
import { radiatorCore, radiatorFit, radiatorRect } from '../cooler';
import { COOLER, COOLER_HOLES, LAYOUT_CASE, PCIE_RAILS, RAD_T, fanLen, setLayoutTier } from '../layout/layout';
import { coolerFanBox, coolerModel, hose, hoseEnds, radiatorDepth, radiatorModel, radiatorPorts3d } from './cooler3d';
import { CASE_TIERS, getSpec, type FanSpec } from '../../sim/specs';
import { findById } from '@/core/render/three/pick';
import type { FanFit } from './fans3d';

const rad = (side: 'top' | 'front') => {
  const span = radiatorSpan(side)!;
  return { span, fit: radiatorFit(span, COOLER.x + COOLER.w / 2), count: span.ids.length };
};
/** The fan size of the current case's mounts. */
const LAYOUT_CASE_FAN = () => CASE_TIERS[LAYOUT_CASE]!.fanSize;
const fit = (spec: string, slot: string): FanFit => ({ id: `d-${slot}`, slot, spec: getSpec(spec) as FanSpec });

/** Where a cooler must stay at its real size: behind the board only its backplate, north of the first card's backplate, under the glass, clear of the RAM's tops. */
const inRoom = (visual: string, b: Box3) => {
  expect(b.min.z, visual).toBeGreaterThanOrEqual(BOARD_Z - 130);
  expect(-b.min.y, visual).toBeLessThan(PCIE_RAILS[0]!.y);
  expect(b.max.z, visual).toBeLessThan(CASE_Z + CASE_D - 200);
  expect(b.max.x, visual).toBeLessThan(1250);
};

describe('the 3D coolers', () => {
  it('mounts every cooler on the board\'s cooler holes over the CPU, a bare heatsink with nothing to spin (and on the loop the pump\'s light ring)', () => {
    for (const t of [0, 3]) {
      setLayoutTier(t, t);
      for (const [visual, spins] of [['cooler-stock', 0], ['cooler-tower', 0], ['cooler-liquid', 1]] as const) {
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

  it('hangs the loop\'s two hoses from the pump\'s fittings to the radiator\'s, whichever side it is bolted on', () => {
    setLayoutTier(3, 3);
    for (const side of ['top', 'front'] as const) {
      const r = rad(side), ends = hoseEnds(r.fit), ports = radiatorPorts3d(r.fit);
      expect(ends.length, side).toBe(2);
      // the hoses do not cross: the pump port nearer the radiator's tank goes to the radiator port nearer the board
      expect(Math.abs(ends[0]![0].at[0] - ports[0]!.at[0]), side).toBeLessThan(Math.abs(ends[1]![0].at[0] - ports[0]!.at[0]));
      expect(ends[0]![1].at[2], side).toBeLessThan(ends[1]![1].at[2]);
      ends.forEach(([a, b], k) => {
        // the sleeve's first and last rings (its two caps follow them, a centre and a ring each): their centres are the hose's ends
        const t = hose(a, b, { planes: [], solids: [] }).children[0] as Mesh, pos = t.geometry.getAttribute('position'), ring = 15, caps = 2 * (ring + 1);
        const centre = (first: number) => Array.from({ length: ring - 1 }, (_, j) => new Vector3().fromBufferAttribute(pos, first + j)).reduce((s, p) => s.add(p), new Vector3()).divideScalar(ring - 1);
        expect(centre(0).distanceTo(new Vector3(...a.at)), side).toBeLessThan(2);
        expect(centre(pos.count - caps - ring).distanceTo(new Vector3(...b.at)), side).toBeLessThan(40);
        // the hose ends in its fitting's collar, on the port's axis
        const p = ports[k]!, off = new Vector3(...b.at).sub(new Vector3(...p.at));
        expect(off.dot(new Vector3(...p.dir)), side).toBeGreaterThan(200);
        expect(off.cross(new Vector3(...p.dir)).length(), side).toBeLessThan(1);
      });
      // the ports sit inside the radiator's depth, either side of its middle
      for (const p of ports) expect(Math.abs(p.at[2] - FAN_ZC), side).toBeLessThan(radiatorDepth() / 2 - 400);
    }
  });

  it('bolts the radiator inboard of its side\'s fans, as deep as a fan and its core as thick as its grade, with no fans of its own', () => {
    for (const tier of [1, 2, 3]) {
      setLayoutTier(tier, tier);
      for (const side of ['top', 'front'] as const) {
        const span = radiatorSpan(side);
        if (!span) continue;
        for (const grade of [1, 2, 3] as const) {
          const f = radiatorFit(span, COOLER.x + COOLER.w / 2, grade), m = radiatorModel(f, grade, span.ids), b = new Box3().setFromObject(m.root), key = `${tier} ${side} ${grade}`;
          expect(m.spins, key).toEqual([]);
          expect(radiatorCore(f).v1 - radiatorCore(f).v0, key).toBe(RAD_T[grade - 1]);
          // in the case's depth, a fan's side and its side plates
          expect(b.max.z - b.min.z, key).toBeGreaterThanOrEqual(fanLen(LAYOUT_CASE_FAN()));
          expect(b.min.z, key).toBeGreaterThan(CASE_Z);
          expect(b.max.z, key).toBeLessThan(CASE_Z + CASE_D);
          // clear of the fans: wholly inboard of their inner face, and inside the room the side keeps for it (the fittings reach past it)
          const r = span.rect, bay = radiatorBay(side)!, body = radiatorRect(f);
          if (side === 'top') expect(-b.max.y, key).toBeGreaterThan(r.y + r.h);
          else expect(b.max.x, key).toBeLessThan(r.x);
          // (the tanks stand 10 proud of the core)
          expect(body.x, key).toBeGreaterThanOrEqual(bay.x - 10); expect(body.x + body.w, key).toBeLessThanOrEqual(bay.x + bay.w + 10);
          expect(body.y, key).toBeGreaterThanOrEqual(bay.y - 10); expect(body.y + body.h, key).toBeLessThanOrEqual(bay.y + bay.h + 10);
        }
      }
    }
  });
});
