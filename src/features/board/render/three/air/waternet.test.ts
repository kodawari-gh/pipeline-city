import { describe, expect, it } from 'vitest';
import { radiatorSpan } from '@/features/room/render/desk/props/case';
import { radiatorFit } from '../../cooler';
import { COOLER, setLayoutTier } from '../../layout/layout';
import { COOLER_AIR, LoopHoses, hoseEnds, radiatorFlow, radiatorTubeLayout } from '../cooler3d';
import type { V3 } from './grid';
import { KNOTS } from './water';
import { levelAt, smooth, waterAt, waterNet, WATER_R, type WaterNet } from './waternet';

/** The loop of a real machine's radiator on `side`: the hoses as the 3D model seats them and the radiator's own flow. */
function loop(side: 'top' | 'front') {
  setLayoutTier(3, 3);
  const span = radiatorSpan(side)!, fit = radiatorFit(span, COOLER.x + COOLER.w / 2), hoses = new LoopHoses(hoseEnds(fit), { planes: [], solids: [] }).paths();
  const rad = radiatorFlow(fit), net = waterNet(hoses, rad, COOLER_AIR.pump)!;
  return { hoses, rad, net };
}

const near = (a: readonly number[], b: readonly number[], tol = 1e-6): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

describe('the radiator\'s flow', () => {
  it('the tubes are the model\'s: one row across its depth, and the ports on the inboard face, the core\'s middle plane a reach inboard of them', () => {
    for (const side of ['top', 'front'] as const) {
      const { rad } = loop(side), lay = radiatorTubeLayout();
      expect(rad.tubes.length, side).toBe(lay.n);
      expect(rad.ports.length, side).toBe(2);
      // the ports are one either side of the middle depth, the one nearer the board first
      expect(rad.ports[0]![2], side).toBeLessThan(rad.ports[1]![2]);
      // a tube starts at the near tank (where the ports are) and runs to the far one: along the radiator, in the core's middle plane
      const t0 = rad.tubes[0]!;
      for (const p of rad.ports) {
        const back: V3 = [p[0] - rad.inward[0] * rad.reach, p[1] - rad.inward[1] * rad.reach, p[2]];
        expect(near(back.slice(0, 2), t0.a.slice(0, 2), 1), side).toBe(true);
      }
      expect(Math.hypot(t0.b[0] - t0.a[0], t0.b[1] - t0.a[1]), side).toBeGreaterThan(2000);
      // the tubes lie at their pitch across the depth, in order
      rad.tubes.forEach((t, k) => { expect(t.a[2], side).toBeCloseTo(lay.z0 + (k + 0.5) * lay.pitch, 5); expect(t.b[2], side).toBeCloseTo(t.a[2], 5); });
      expect(rad.half, side).toBeGreaterThan(200);
    }
  });
});

describe('the water\'s net', () => {
  it('runs from the pump along the hot hose, through the radiator and back on the cold hose, and closes where it began', () => {
    for (const side of ['top', 'front'] as const) {
      const { hoses, net } = loop(side);
      expect(net, side).not.toBeNull();
      expect(net.stops.length, side).toBe(KNOTS);
      expect(net.level.length, side).toBe(KNOTS);
      for (let i = 1; i < net.stops.length; i++) expect(net.stops[i]!, side).toBeGreaterThanOrEqual(net.stops[i - 1]!);
      expect(net.stops[net.stops.length - 1], side).toBeCloseTo(net.length, 5);
      for (const r of net.runs) { expect(r.sb, side).toBeGreaterThan(r.sa); expect(r.r, side).toBeGreaterThan(0); }
      // the first run leaves the cold hose's pump end; the last arrives at it
      expect(near(net.runs[0]!.a, hoses[1]![0]!, 1e-6), side).toBe(true);
      expect(near(net.runs[net.runs.length - 1]!.b, hoses[1]![0]!, 1e-6), side).toBe(true);
      // along the main run each piece starts where the one before it ended (the lanes and the tanks branch)
      const hot = net.runs.filter((r) => r.r === WATER_R.hose);
      expect(hot.length, side).toBeGreaterThan(20);
    }
  });

  it('is cold to the plate, heated across it, hot to the radiator, cooled along its lanes (to the middle at the far tank), and cold on the way back', () => {
    const { net } = loop('front');
    const at = (s: number) => waterAt(net, s, 60, 40);
    expect(at(0)).toBeCloseTo(40, 5);
    expect(at(net.length)).toBeCloseTo(40, 5);
    // (the plate's crossing is the second stage: after it the water is hot)
    expect(levelAt(net, net.stops[2]!)).toBe(1);
    expect(levelAt(net, net.stops[3]!)).toBe(1);
    expect(at(net.stops[4]!)).toBeCloseTo(50, 5);
    expect(at(net.stops[5]!)).toBeCloseTo(50, 5);
    expect(at(net.stops[6]!)).toBeCloseTo(40, 5);
    // a lane of the first half cools from the hot side toward the middle, a lane of the second from the middle toward the cold
    const lanes = net.runs.filter((r) => r.r === WATER_R.lane);
    expect(lanes.length).toBe(6);
    for (const l of lanes.slice(0, 3)) { expect(levelAt(net, l.sa)).toBeCloseTo(1, 5); expect(levelAt(net, l.sb)).toBeCloseTo(0.5, 5); }
    for (const l of lanes.slice(3)) { expect(levelAt(net, l.sa)).toBeCloseTo(0.5, 5); expect(levelAt(net, l.sb)).toBeCloseTo(0, 5); }
  });

  it('draws the lanes along the radiator, the water in and the water out set apart across the core so each shows from the glass', () => {
    for (const side of ['top', 'front'] as const) {
      const { rad, net } = loop(side), lanes = net.runs.filter((r) => r.r === WATER_R.lane), across = rad.inward;
      const len = Math.hypot(rad.tubes[0]!.b[0] - rad.tubes[0]!.a[0], rad.tubes[0]!.b[1] - rad.tubes[0]!.a[1]);
      for (const l of lanes) expect(Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]), side).toBeCloseTo(len, 3);
      // the offset of a lane from the tubes' line, along the way a fitting points: in is inboard (+), out is outboard (-), each half the core's half thickness
      const off = (p: V3): number => (p[0] - rad.tubes[0]!.a[0]) * across[0] + (p[1] - rad.tubes[0]!.a[1]) * across[1];
      for (const l of lanes.slice(0, 3)) expect(off(l.a), side).toBeCloseTo(rad.half * 0.5, 3);
      for (const l of lanes.slice(3)) expect(off(l.a), side).toBeCloseTo(-rad.half * 0.5, 3);
      // the lanes are at depths inside the radiator's tubes
      const zs = rad.tubes.map((t) => t.a[2]);
      for (const l of lanes) { expect(l.a[2], side).toBeGreaterThanOrEqual(Math.min(...zs) - 1e-6); expect(l.a[2], side).toBeLessThanOrEqual(Math.max(...zs) + 1e-6); }
      // the in lanes lie at the hot port's half of the depth, the out lanes at the cold port's
      const zm = (rad.ports[0]![2] + rad.ports[1]![2]) / 2;
      for (const l of lanes.slice(0, 3)) expect(l.a[2], side).toBeLessThan(zm);
      for (const l of lanes.slice(3)) expect(l.a[2], side).toBeGreaterThan(zm);
    }
  });

  it('crosses the pump\'s cold plate between the two ports', () => {
    const { hoses, net } = loop('front');
    const block = net.runs.filter((r) => r.r === WATER_R.block);
    expect(block.length).toBe(5);
    // the middle run lies on the plate, from one port's x to the other's
    const mid = block[2]!;
    expect(mid.a[2]).toBeCloseTo(COOLER_AIR.pump.plate, 5);
    expect(mid.b[2]).toBeCloseTo(COOLER_AIR.pump.plate, 5);
    expect(Math.abs(mid.a[0] - hoses[1]![0]![0])).toBeLessThan(1e-6);
    expect(Math.abs(mid.b[0] - hoses[0]![0]![0])).toBeLessThan(1e-6);
  });

  it('is no loop without two hoses or a radiator', () => {
    const { hoses, rad } = loop('front');
    expect(waterNet([hoses[0]!], rad, COOLER_AIR.pump)).toBeNull();
    expect(waterNet(hoses, null, COOLER_AIR.pump)).toBeNull();
    expect(waterNet([], rad, COOLER_AIR.pump)).toBeNull();
  });

  it('keeps its knots in the order the shader takes them, whatever the radiator\'s tube count', () => {
    const { hoses, rad } = loop('top');
    for (const n of [1, 2, 3, 14]) {
      const net: WaterNet = waterNet(hoses, { ...rad, tubes: rad.tubes.slice(0, n) }, COOLER_AIR.pump)!;
      expect(net, `${n}`).not.toBeNull();
      expect(net.stops.length, `${n}`).toBe(KNOTS);
      for (let i = 1; i < KNOTS; i++) expect(net.stops[i]!, `${n}`).toBeGreaterThanOrEqual(net.stops[i - 1]!);
    }
  });
});

describe('smooth', () => {
  it('cuts each span into pieces along a curve through the points, the ends where they were', () => {
    const pts: V3[] = [[0, 0, 0], [1000, 0, 0], [1000, 1000, 0], [2000, 1000, 500]];
    const s = smooth(pts, 3);
    expect(s.length).toBe((pts.length - 1) * 3 + 1);
    expect(s[0]).toEqual(pts[0]);
    expect(s[s.length - 1]).toEqual(pts[pts.length - 1]);
    // it passes through every given point
    pts.forEach((p, i) => expect(near(s[i * 3]!, p, 1e-6)).toBe(true));
    // (two points are a line)
    expect(smooth([[0, 0, 0], [5, 0, 0]]).length).toBe(2);
  });
});
