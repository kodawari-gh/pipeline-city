import { describe, expect, it } from 'vitest';
import { BD, NIC_LEN, nicY, setLayoutTier } from '../layout/layout';
import { STAND } from './card3d';
import type { CardFrame } from './gpu3d';
import { nicLanes, TRACE_BAND } from './nicflow';
import * as niccopper from './niccopper';
import { tabOf } from './pcie';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const frame = (visual: string): CardFrame => {
  const y0 = nicY(0),
    x1 = BD.x + must(NIC_LEN[visual]);
  return { x0: BD.x, x1, xe: x1, y0, end: y0 + STAND.nic };
};
const copper = (visual: string): niccopper.NicCopper => {
  const f = frame(visual);
  return niccopper.nicCopper(visual, f, tabOf(0, f.x1, must(niccopper.NIC_LANES[visual])));
};
const VISUALS = ['nic-gbe', 'nic-10g', 'nic-40g'];
/** The copper's run of a net on the component side. */
const run = (cu: niccopper.NicCopper, net: string): niccopper.Trace =>
  must(cu.traces.find((t) => t.layer === 'top' && t.net === net));

function assert_has_the_first_jack_s_four_pairs_one_lane_a_wire_(): void {
  setLayoutTier(3, 3);
  for (const visual of VISUALS) {
    const cu = copper(visual),
      l = nicLanes(cu, 0);
    // (the 40G card's second jack carries no cable: it has none)
    expect(l.media).toHaveLength(8);
    expect(l.host).toHaveLength(2 * cu.lanes);
    expect(l.host).toHaveLength(2 * Math.min(must(niccopper.NIC_LANES[visual]), cu.lanes));
  }
}

function assert_runs_each_wire_on_its_own_copper_from_its_source(): void {
  setLayoutTier(3, 3);
  for (const visual of VISUALS) {
    const cu = copper(visual),
      slot = 2,
      l = nicLanes(cu, slot),
      west = Math.min(...cu.outline.map((p) => p[0]));
    expect(l.off).toBe(slot * TRACE_BAND - west);
    // (a lane is its net's trace as the drawing has it: shifted into the band)
    const back = (lane: (typeof l.media)[number]) => lane.pts.map(([x, y]) => [x - l.off, y] as const);
    const jack = back(must(l.media[0])),
      t = run(cu, 'J1MDI0+');
    expect(jack).toHaveLength(t.pts.length);
    for (const [i, [x, y]] of jack.entries()) {
      expect(x).toBeCloseTo(must(t.pts[i])[0], 6);
      expect(y).toBeCloseTo(must(t.pts[i])[1], 6);
    }
    for (const lane of l.media) {
      // the cable's pairs start at the jack (the west end) and run east to the controller
      const p = back(lane);
      expect(must(p[0])[0]).toBeLessThan(cu.at.chip.x);
      expect(must(p.at(-1))[0]).toBeGreaterThan(must(p[0])[0]);
      expect(lane.len).toBeGreaterThan(100);
    }
    for (const lane of l.host) {
      // the slot's pairs start on a gold finger, north of the slot's line (y smaller), and run south to the controller
      const p = back(lane);
      expect(must(p[0])[1]).toBeLessThan(cu.at.chip.y);
      expect(must(p.at(-1))[1]).toBeGreaterThan(must(p[0])[1]);
    }
  }
}

function assert_starts_a_slot_pair_in_the_middle_of_its_finger_w(): void {
  setLayoutTier(3, 3);
  const cu = copper('nic-gbe'),
    l = nicLanes(cu, 0),
    nets = cu.traces.filter((t) => t.layer === 'top' && /^PET\d[+-]$/u.test(t.net)).map((t) => t.net);
  expect(nets).toHaveLength(2);
  for (const net of nets) {
    const finger = must(cu.pads.find((p) => p.edge === true && p.face === 'top' && p.net === net)),
      t = run(cu, net);
    const lane = l.host.find(
      (x) =>
        Math.abs(must(x.pts[0])[0] - l.off - finger.c[0]) < 1e-6 && Math.abs(must(x.pts[0])[1] - finger.c[1]) < 1e-6,
    );
    expect(lane).toBeDefined();
    // (the finger's middle, then the run's own start on the same line)
    expect(must(must(lane).pts[1])[1]).toBeCloseTo(must(t.pts[0])[1], 6);
    expect(must(must(lane).pts[1])[0] - l.off).toBeCloseTo(must(t.pts[0])[0], 6);
  }
}

function assert_lights_nothing_that_is_not_on_the_component_side(): void {
  setLayoutTier(3, 3);
  for (const visual of VISUALS) {
    const cu = copper(visual),
      l = nicLanes(cu, 0);
    // every lane is one of the component side's own runs (a net's top-layer run), none of the card's other nets
    const tops = new Set(
      cu.traces
        .filter((t) => t.layer === 'top' && (/^J1MDI\d[+-]$/u.test(t.net) || /^PET\d[+-]$/u.test(t.net)))
        .map((t) => t.net),
    );
    expect(l.media.length + l.host.length).toBe(tops.size);
    expect(cu.traces.some((t) => t.layer === 'bottom' && /^PER\d/u.test(t.net))).toBe(true);
  }
}

function assert_keeps_each_card_in_its_own_band_and_its_rectangle(): void {
  setLayoutTier(3, 3);
  for (const visual of VISUALS) {
    const cu = copper(visual),
      a = nicLanes(cu, 0),
      b = nicLanes(cu, 1);
    expect(b.off - a.off).toBe(TRACE_BAND);
    expect(b.rect.x - a.rect.x).toBeCloseTo(TRACE_BAND, 6);
    // (the card is shorter than its band: two cards never share a drawing)
    expect(a.rect.w).toBeLessThan(TRACE_BAND);
    for (const lane of [...a.media, ...a.host]) {
      for (const [x, y] of lane.pts) {
        expect(x).toBeGreaterThanOrEqual(a.rect.x);
        expect(x).toBeLessThanOrEqual(a.rect.x + a.rect.w);
        expect(y).toBeGreaterThanOrEqual(a.rect.y);
        expect(y).toBeLessThanOrEqual(a.rect.y + a.rect.h);
      }
    }
  }
}

describe("the network card's lit lanes", () => {
  it("has the first jack's four pairs, one lane a wire, and one lane a wire of the slot's receive pairs of the link's width", () => {
    expect.hasAssertions();
    assert_has_the_first_jack_s_four_pairs_one_lane_a_wire_();
  });

  it("runs each wire on its own copper, from its source to the controller, in the card's own drawing (its layout, in the card's band)", () => {
    expect.hasAssertions();
    assert_runs_each_wire_on_its_own_copper_from_its_source();
  });

  it('starts a slot pair in the middle of its finger, which the run goes on from', () => {
    expect.hasAssertions();
    assert_starts_a_slot_pair_in_the_middle_of_its_finger_w();
  });

  it('lights nothing that is not on the component side: the way back to the host runs on the solder side, so it has no lane', () => {
    expect.hasAssertions();
    assert_lights_nothing_that_is_not_on_the_component_side();
  });

  it('keeps each card in its own band, and its rectangle holds every lane', () => {
    expect.hasAssertions();
    assert_keeps_each_card_in_its_own_band_and_its_rectangle();
  });

  it('has no lane and an empty rectangle for copper with no such run', () => {
    setLayoutTier(3, 3);
    const cu = copper('nic-gbe'),
      bare: niccopper.NicCopper = { ...cu, traces: cu.traces.filter((t) => !/^J1MDI|^PET/u.test(t.net)) },
      l = nicLanes(bare, 3);
    expect([l.media.length, l.host.length]).toStrictEqual([0, 0]);
    expect(l.rect).toStrictEqual({ x: 3 * TRACE_BAND, y: 0, w: 0, h: 0 });
  });
});
