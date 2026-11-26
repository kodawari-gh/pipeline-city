/* oxlint-disable import/max-dependencies -- the cooler test checks the cooler against the case, the board, the layout and the specs */
import { afterEach, describe, expect, it } from 'vitest';
import * as three from 'three';
import { setLowDetail } from '@/core/render/three/detail';
import { radiatorBay, radiatorSpan } from '@/features/room/render/desk/props/case';
import { BOARD_Z, CASE_D, CASE_Z, FAN_ZC } from '@/features/room/render/three/roomplan';
import { radiatorCore, radiatorFit, radiatorRect } from '../cooler';
import { COOLER, COOLER_HOLES, LAYOUT_CASE, PCIE_RAILS, RAD_T, fanLen, setLayoutTier } from '../layout/layout';
import { coolerFanBox, coolerModel, hose, hoseEnds, radiatorDepth, radiatorModel, radiatorPorts3d } from './cooler3d';
import * as specs from '../../sim/specs';
import { findById } from '@/core/render/three/pick';
import type { FanFit } from './fans3d';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): three.Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a Mesh');
  }
  return o;
}

const rad = (side: 'top' | 'front') => {
  const span = must(radiatorSpan(side));
  return { span, fit: radiatorFit(span, COOLER.x + COOLER.w / 2), count: span.ids.length };
};
/** The fan size of the current case's mounts. */
const LAYOUT_CASE_FAN = () => must(specs.CASE_TIERS[LAYOUT_CASE]).fanSize;
/** The fan spec of an id, or fails the test when the id is not a fan's. */
function fanSpec(id: string): specs.FanSpec {
  const spec = specs.getSpec(id);
  if (spec?.kind !== 'fan') {
    throw new Error(`expected a fan spec: ${id}`);
  }
  return spec;
}
const fit = (spec: string, slot: string): FanFit => ({
  id: `d-${slot}`,
  slot,
  spec: fanSpec(spec),
});

/** Where a cooler must stay at its real size: behind the board only its backplate, north of the first card's backplate, under the glass, clear of the RAM's tops. */
const inRoom = (_visual: string, b: three.Box3) => {
  expect(b.min.z).toBeGreaterThanOrEqual(BOARD_Z - 130);
  expect(-b.min.y).toBeLessThan(must(PCIE_RAILS[0]).y);
  expect(b.max.z).toBeLessThan(CASE_Z + CASE_D - 200);
  expect(b.max.x).toBeLessThan(1250);
};

function assert_mounts_every_cooler_on_the_board_s_cooler_holes_(): void {
  for (const t of [0, 3]) {
    setLayoutTier(t, t);
    for (const [visual, spins] of [
      ['cooler-stock', 0],
      ['cooler-tower', 0],
      ['cooler-liquid', 1],
    ] as const) {
      const m = coolerModel(visual),
        b = new three.Box3().setFromObject(m.root);
      expect(m.spins).toHaveLength(spins);
      inRoom(visual, b);
      // the backplate reaches every hole
      for (const [x, y] of COOLER_HOLES) {
        expect(b.containsPoint(new three.Vector3(x, -y, BOARD_Z))).toBe(true);
      }
    }
  }
}

function assert_shows_the_fans_fitted_on_a_heatsink_each_on_the_(): void {
  setLayoutTier(3, 3);
  for (const [visual, fans] of [
    ['cooler-stock', [fit('fan92', 'cooler0.fan0')]],
    ['cooler-tower', [fit('fan120', 'cooler0.fan0'), fit('fan120x', 'cooler0.fan1')]],
  ] as const) {
    const m = coolerModel(visual, fans),
      b = new three.Box3().setFromObject(m.root);
    expect(m.spins.map((s) => s.needs)).toStrictEqual(fans.map(() => 'cpufan'));
    inRoom(visual, b);
    for (const [k, f] of fans.entries()) {
      // (its light stands a little proud of its face)
      const o = must(findById(m.root, f.id)),
        c = new three.Box3().setFromObject(o, true),
        spot = must(coolerFanBox(visual, k)),
        proud = 32;
      expect(c.min.x).toBeGreaterThanOrEqual(spot.r.x - proud);
      expect(c.max.x).toBeLessThanOrEqual(spot.r.x + spot.r.w + proud);
      expect(c.min.z).toBeGreaterThanOrEqual(spot.z0 - proud);
      expect(c.max.z).toBeLessThanOrEqual(spot.z1 + proud);
    }
  }
}

function assert_hangs_the_loop_s_two_hoses_from_the_pump_s_fittings(): void {
  setLayoutTier(3, 3);
  for (const side of ['top', 'front'] as const) {
    const r = rad(side),
      ends = hoseEnds(r.fit),
      ports = radiatorPorts3d(r.fit);
    expect(ends).toHaveLength(2);
    // the hoses do not cross: the pump port nearer the radiator's tank goes to the radiator port nearer the board
    expect(Math.abs(must(ends[0])[0].at[0] - must(ports[0]).at[0])).toBeLessThan(
      Math.abs(must(ends[1])[0].at[0] - must(ports[0]).at[0]),
    );
    expect(must(ends[0])[1].at[2]).toBeLessThan(must(ends[1])[1].at[2]);
    for (const [k, [a, b]] of ends.entries()) {
      // the sleeve's first and last rings (its two caps follow them, a centre and a ring each): their centres are the hose's ends
      const t = asMesh(hose(a, b, { planes: [], solids: [] }).children[0]),
        pos = t.geometry.getAttribute('position'),
        ring = 15,
        caps = 2 * (ring + 1);
      const centre = (first: number) => {
        const sum = new three.Vector3();
        for (let j = 0; j < ring - 1; j++) {
          sum.add(new three.Vector3().fromBufferAttribute(pos, first + j));
        }
        return sum.divideScalar(ring - 1);
      };
      expect(centre(0).distanceTo(new three.Vector3(...a.at))).toBeLessThan(2);
      expect(centre(pos.count - caps - ring).distanceTo(new three.Vector3(...b.at))).toBeLessThan(40);
      // the hose ends in its fitting's collar, on the port's axis
      const p = must(ports[k]),
        off = new three.Vector3(...b.at).sub(new three.Vector3(...p.at));
      expect(off.dot(new three.Vector3(...p.dir))).toBeGreaterThan(200);
      expect(off.cross(new three.Vector3(...p.dir)).length()).toBeLessThan(1);
    }
    // the ports sit inside the radiator's depth, either side of its middle
    for (const p of ports) {
      expect(Math.abs(p.at[2] - FAN_ZC)).toBeLessThan(radiatorDepth() / 2 - 400);
    }
  }
}

function assert_bolts_the_radiator_inboard_of_its_side_s_fans_as(): void {
  for (const tier of [1, 2, 3]) {
    setLayoutTier(tier, tier);
    for (const side of ['top', 'front'] as const) {
      const span = radiatorSpan(side);
      if (!span) {
        continue;
      }
      for (const grade of [1, 2, 3] as const) {
        const f = radiatorFit(span, COOLER.x + COOLER.w / 2, grade),
          m = radiatorModel(f, grade, span.ids),
          b = new three.Box3().setFromObject(m.root);
        expect(m.spins).toStrictEqual([]);
        expect(radiatorCore(f).v1 - radiatorCore(f).v0).toBe(RAD_T[grade - 1]);
        // in the case's depth, a fan's side and its side plates
        expect(b.max.z - b.min.z).toBeGreaterThanOrEqual(fanLen(LAYOUT_CASE_FAN()));
        expect(b.min.z).toBeGreaterThan(CASE_Z);
        expect(b.max.z).toBeLessThan(CASE_Z + CASE_D);
        // clear of the fans: wholly inboard of their inner face, and inside the room the side keeps for it (the fittings reach past it)
        const r = span.rect,
          bay = must(radiatorBay(side)),
          body = radiatorRect(f);
        // (inboard is down from the top fans and west of the front fans)
        const inboard = { top: -b.max.y - (r.y + r.h), front: r.x - b.max.x }[side];
        expect(inboard, `${side} fans`).toBeGreaterThan(0);
        // (the tanks stand 10 proud of the core)
        expect(body.x).toBeGreaterThanOrEqual(bay.x - 10);
        expect(body.x + body.w).toBeLessThanOrEqual(bay.x + bay.w + 10);
        expect(body.y).toBeGreaterThanOrEqual(bay.y - 10);
        expect(body.y + body.h).toBeLessThanOrEqual(bay.y + bay.h + 10);
      }
    }
  }
}

describe('the 3D coolers', () => {
  afterEach(() => {
    setLowDetail(false);
  });

  it("mounts every cooler on the board's cooler holes over the CPU, a bare heatsink with nothing to spin (and on the loop the pump's light ring)", () => {
    expect.hasAssertions();
    assert_mounts_every_cooler_on_the_board_s_cooler_holes_();
  });

  it('shows the fans fitted on a heatsink, each on the CPU fan cable, inside its spot and picked as itself', () => {
    expect.hasAssertions();
    assert_shows_the_fans_fitted_on_a_heatsink_each_on_the_();
  });

  it('has no fan spot on the liquid block', () => {
    expect(coolerFanBox('cooler-liquid', 0)).toBeNull();
  });

  it("hangs the loop's two hoses from the pump's fittings to the radiator's, whichever side it is bolted on", () => {
    expect.hasAssertions();
    assert_hangs_the_loop_s_two_hoses_from_the_pump_s_fittings();
  });

  it("bolts the radiator inboard of its side's fans, as deep as a fan and its core as thick as its grade, with no fans of its own", () => {
    expect.hasAssertions();
    assert_bolts_the_radiator_inboard_of_its_side_s_fans_as();
  });
});
