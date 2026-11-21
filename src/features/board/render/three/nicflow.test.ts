import { describe, expect, it } from 'vitest';
import { BD, NIC_LEN, nicY, setLayoutTier } from '../layout/layout';
import { STAND } from './card3d';
import type { CardFrame } from './gpu3d';
import { nicLanes, TRACE_BAND } from './nicflow';
import { NIC_LANES, nicCopper, type NicCopper, type Trace } from './niccopper';
import { tabOf } from './pcie';

const frame = (visual: string): CardFrame => {
  const y0 = nicY(0), x1 = BD.x + NIC_LEN[visual]!;
  return { x0: BD.x, x1, xe: x1, y0, end: y0 + STAND.nic };
};
const copper = (visual: string): NicCopper => { const f = frame(visual); return nicCopper(visual, f, tabOf(0, f.x1, NIC_LANES[visual]!)); };
const VISUALS = ['nic-gbe', 'nic-10g', 'nic-40g'];
/** The copper's run of a net on the component side. */
const run = (cu: NicCopper, net: string): Trace => cu.traces.find((t) => t.layer === 'top' && t.net === net)!;

describe("the network card's lit lanes", () => {
  it('has the first jack\'s four pairs, one lane a wire, and one lane a wire of the slot\'s receive pairs of the link\'s width', () => {
    setLayoutTier(3, 3);
    for (const visual of VISUALS) {
      const cu = copper(visual), l = nicLanes(cu, 0);
      // (the 40G card's second jack carries no cable: it has none)
      expect(l.media, visual).toHaveLength(8);
      expect(l.host, visual).toHaveLength(2 * cu.lanes);
      expect(l.host.length, visual).toBe(2 * Math.min(NIC_LANES[visual]!, cu.lanes));
    }
  });

  it('runs each wire on its own copper, from its source to the controller, in the card\'s own drawing (its layout, in the card\'s band)', () => {
    setLayoutTier(3, 3);
    for (const visual of VISUALS) {
      const cu = copper(visual), slot = 2, l = nicLanes(cu, slot), west = Math.min(...cu.outline.map((p) => p[0]));
      expect(l.off, visual).toBe(slot * TRACE_BAND - west);
      // (a lane is its net's trace as the drawing has it: shifted into the band)
      const back = (lane: (typeof l.media)[number]) => lane.pts.map(([x, y]) => [x - l.off, y] as const);
      const jack = back(l.media[0]!), t = run(cu, 'J1MDI0+');
      expect(jack, visual).toHaveLength(t.pts.length);
      jack.forEach(([x, y], i) => { expect(x, visual).toBeCloseTo(t.pts[i]![0], 6); expect(y, visual).toBeCloseTo(t.pts[i]![1], 6); });
      for (const lane of l.media) {
        // the cable's pairs start at the jack (the west end) and run east to the controller
        const p = back(lane);
        expect(p[0]![0], visual).toBeLessThan(cu.at.chip.x);
        expect(p[p.length - 1]![0], visual).toBeGreaterThan(p[0]![0]);
        expect(lane.len, visual).toBeGreaterThan(100);
      }
      for (const lane of l.host) {
        // the slot's pairs start on a gold finger, north of the slot's line (y smaller), and run south to the controller
        const p = back(lane);
        expect(p[0]![1], visual).toBeLessThan(cu.at.chip.y);
        expect(p[p.length - 1]![1], visual).toBeGreaterThan(p[0]![1]);
      }
    }
  });

  it('starts a slot pair in the middle of its finger, which the run goes on from', () => {
    setLayoutTier(3, 3);
    const cu = copper('nic-gbe'), l = nicLanes(cu, 0), nets = cu.traces.filter((t) => t.layer === 'top' && /^PET\d[+-]$/.test(t.net)).map((t) => t.net);
    expect(nets).toHaveLength(2);
    for (const net of nets) {
      const finger = cu.pads.find((p) => p.edge && p.face === 'top' && p.net === net)!, t = run(cu, net);
      const lane = l.host.find((x) => Math.abs(x.pts[0]![0] - l.off - finger.c[0]) < 1e-6 && Math.abs(x.pts[0]![1] - finger.c[1]) < 1e-6);
      expect(lane, net).toBeDefined();
      // (the finger's middle, then the run's own start on the same line)
      expect(lane!.pts[1]![1]).toBeCloseTo(t.pts[0]![1], 6);
      expect(lane!.pts[1]![0] - l.off).toBeCloseTo(t.pts[0]![0], 6);
    }
  });

  it('lights nothing that is not on the component side: the way back to the host runs on the solder side, so it has no lane', () => {
    setLayoutTier(3, 3);
    for (const visual of VISUALS) {
      const cu = copper(visual), l = nicLanes(cu, 0);
      // every lane is one of the component side's own runs (a net's top-layer run), none of the card's other nets
      const tops = new Set(cu.traces.filter((t) => t.layer === 'top' && (/^J1MDI\d[+-]$/.test(t.net) || /^PET\d[+-]$/.test(t.net))).map((t) => t.net));
      expect(l.media.length + l.host.length, visual).toBe(tops.size);
      expect(cu.traces.some((t) => t.layer === 'bottom' && /^PER\d/.test(t.net)), visual).toBe(true);
    }
  });

  it('keeps each card in its own band, and its rectangle holds every lane', () => {
    setLayoutTier(3, 3);
    for (const visual of VISUALS) {
      const cu = copper(visual), a = nicLanes(cu, 0), b = nicLanes(cu, 1);
      expect(b.off - a.off, visual).toBe(TRACE_BAND);
      expect(b.rect.x - a.rect.x, visual).toBeCloseTo(TRACE_BAND, 6);
      // (the card is shorter than its band: two cards never share a drawing)
      expect(a.rect.w, visual).toBeLessThan(TRACE_BAND);
      for (const lane of [...a.media, ...a.host]) for (const [x, y] of lane.pts) {
        expect(x, visual).toBeGreaterThanOrEqual(a.rect.x);
        expect(x, visual).toBeLessThanOrEqual(a.rect.x + a.rect.w);
        expect(y, visual).toBeGreaterThanOrEqual(a.rect.y);
        expect(y, visual).toBeLessThanOrEqual(a.rect.y + a.rect.h);
      }
    }
  });

  it('has no lane and an empty rectangle for copper with no such run', () => {
    setLayoutTier(3, 3);
    const cu = copper('nic-gbe'), bare: NicCopper = { ...cu, traces: cu.traces.filter((t) => !/^J1MDI|^PET/.test(t.net)) }, l = nicLanes(bare, 3);
    expect([l.media.length, l.host.length]).toEqual([0, 0]);
    expect(l.rect).toEqual({ x: 3 * TRACE_BAND, y: 0, w: 0, h: 0 });
  });
});
