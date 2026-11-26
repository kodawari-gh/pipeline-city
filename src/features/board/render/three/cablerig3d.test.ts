import { Group, Quaternion } from 'three';
import { describe, expect, it } from 'vitest';
import * as rope from '@/core/render/three/rope';
import * as cablerig3d from './cablerig3d';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** No rest the plug came to: a loose plug that has not settled yet. */
const NO_REST: Parameters<typeof cablerig3d.looseState>[2] = undefined;

/** A two-strand lead out of a grommet at the origin (facing +z) into a socket 600 up and 300 out, which it pulls out of along +z. */
function rig(): cablerig3d.CableRig {
  const fixed: rope.RopeEnd[] = [
    { at: [-40, 0, 0], dir: [0, 0, 1] },
    { at: [40, 0, 0], dir: [0, 0, 1] },
  ];
  const exits: rope.RopeEnd[] = [
    { at: [-40, 600, 360], dir: [0, 0, 1] },
    { at: [40, 600, 360], dir: [0, 0, 1] },
  ];
  return {
    id: 'x',
    name: 'the socket',
    target: null,
    look: { r: 10, base: '#000000', accent: null },
    env: { planes: [], solids: [] },
    fixed,
    model: () => ({ root: new Group(), strands: exits }),
    seat: { at: [0, 600, 300], axis: [0, 0, 1] },
    canSeat: true,
    engage: 60,
    // seated, each strand runs out of the grommet, up over the socket and back down into the plug
    seated: (ex) =>
      ex.map((e, i): rope.V3[] => [must(fixed[i]).at, [must(fixed[i]).at[0], 0, 700], [e.at[0], 600, 1000], e.at]),
    deck: { n: [0, 0, 1], d: 0 },
    n: 16,
    stiff: 0.5,
    lead: 25,
  };
}

function assert_hangs_a_loose_cable_from_its_grommet_each_strand(): void {
  const r = rig(),
    ex = r.model().strands,
    L = cablerig3d.lengthsOf(r, ex),
    { rest, strands } = cablerig3d.looseState(r, ex, NO_REST);
  for (const [i, s] of strands.entries()) {
    expect(Math.abs(rope.lengthOf(s) / must(L[i]) - 1), `strand ${i}`).toBeLessThan(0.03);
  }
  expect(rest.pose.at[1]).toBeLessThan(-must(L[0]) * 0.5);
  // a plug that came to rest keeps its strands as they lay
  const kept = cablerig3d.looseState(r, ex, { pose: rest.pose, strands });
  expect(kept.strands).toBe(strands);
}

const home = (r: cablerig3d.CableRig) => r.seated(r.model().strands),
  end = (r: cablerig3d.CableRig) => ({ at: [...r.seat.at] as rope.V3, q: new Quaternion() });

function assert_takes_the_first_part_of_a_polyline_by_length_spr(): void {
  const p: rope.V3[] = [
    [0, 0, 0],
    [100, 0, 0],
    [100, 300, 0],
  ];
  expect(cablerig3d.along(p, 50)).toStrictEqual({ at: [50, 0, 0], dir: [1, 0, 0] });
  expect(cablerig3d.along(p, 250).at).toStrictEqual([100, 150, 0]);
  expect(cablerig3d.along(p, 250).dir).toStrictEqual([0, 1, 0]);
  // held to its ends
  expect(cablerig3d.along(p, -5).at).toStrictEqual([0, 0, 0]);
  expect(cablerig3d.along(p, 9999).at).toStrictEqual([100, 300, 0]);
  const half = cablerig3d.prefixOf(p, 0.5, 5);
  expect(half).toHaveLength(5);
  expect(half[0]).toStrictEqual([0, 0, 0]);
  expect(rope.lengthOf(half)).toBeCloseTo(200);
  expect(cablerig3d.prefixOf(p, 0, 4).every((q) => q[0] === 0 && q[1] === 0)).toBe(true);
  expect(rope.lengthOf(cablerig3d.prefixOf(p, 1, 9))).toBeCloseTo(rope.lengthOf(p));
}

function assert_starts_with_the_plug_small_in_its_hole_every_str(): void {
  const r = rig(),
    ex = r.model().strands,
    a = cablerig3d.reelAt(r, ex, home(r), end(r), 0);
  expect(a.size).toBe(0);
  for (const [i, s] of a.strands.entries()) {
    expect(s[0], `strand ${i}`).toStrictEqual(must(r.fixed[i]).at);
  }
  expect(rope.lengthOf(must(a.strands[0]))).toBeLessThan(150);
}

function assert_ends_as_the_built_cable_stands_the_plug_seated_f(): void {
  const r = rig(),
    ex = r.model().strands,
    path = home(r),
    z = cablerig3d.reelAt(r, ex, path, end(r), 1);
  expect(z.size).toBe(1);
  expect(rope.dist(z.pose.at, r.seat.at)).toBeLessThan(1e-6);
  expect(z.pose.q.angleTo(new Quaternion())).toBeLessThan(1e-6);
  for (const [i, s] of z.strands.entries()) {
    const homePath = must(path[i]);
    const startAt = must(s[0]);
    const endAt = must(s.at(-1));
    const homeEnd = must(homePath.at(-1));
    expect(rope.dist(startAt, must(homePath[0]))).toBeLessThan(1e-6);
    expect(rope.dist(endAt, homeEnd)).toBeLessThan(1e-6);
    // (evenly spaced points cut the sharp corners of this crude path a little)
    expect(Math.abs(rope.lengthOf(s) / rope.lengthOf(homePath) - 1)).toBeLessThan(0.05);
  }
}

function assert_keeps_the_cable_whole_on_the_way_each_strand_end(): void {
  const r = rig(),
    ex = r.model().strands,
    path = home(r);
  let last = 0;
  for (const f of [0.35, 0.5, 0.7, 0.9]) {
    const a = cablerig3d.reelAt(r, ex, path, end(r), f);
    expect(a.size).toBe(1);
    for (const [i, s] of a.strands.entries()) {
      const endAt = must(s.at(-1));
      const exitAt = cablerig3d.exitAt(must(ex[i]), r.seat, a.pose).at;
      expect(rope.dist(endAt, exitAt), `strand ${i} at ${f}`).toBeLessThan(1e-6);
    }
    expect(rope.lengthOf(must(a.strands[0]))).toBeGreaterThan(last);
    last = rope.lengthOf(must(a.strands[0]));
  }
}

describe('a cable rig', () => {
  it('keeps a point within reach of another', () => {
    const from: rope.V3 = [100, 200, 300];
    expect(cablerig3d.withinReach([150, 200, 300], from, 500)).toStrictEqual([150, 200, 300]);
    const p = cablerig3d.withinReach([100, 200, 2300], from, 500);
    expect(rope.dist(p, from)).toBeCloseTo(500);
    expect(p[0]).toBeCloseTo(100);
    expect(p[2]).toBeCloseTo(800);
  });

  it('keeps a plug held over the board at its height when its cable pulls it in (never down toward the grommet behind)', () => {
    // the grommet 300 behind the plane the plug moves on, the plug 1000 out along it
    const from: rope.V3 = [0, 0, 0],
      p = cablerig3d.withinReach([1000, 0, 300], from, 500, [0, 0, 1]);
    expect(p[2]).toBeCloseTo(300);
    expect(rope.dist(p, from)).toBeCloseTo(500);
    expect(p[0]).toBeCloseTo(400);
    expect(cablerig3d.withinReach([300, 0, 300], from, 500, [0, 0, 1])).toStrictEqual([300, 0, 300]);
  });

  it('lets a plug go only as far as its cable reaches: the length each strand has seated', () => {
    const r = rig(),
      ex = r.model().strands,
      L = cablerig3d.lengthsOf(r, ex),
      q = new Quaternion();
    const seated0 = must(r.seated(ex)[0]);
    expect(L[0]).toBeCloseTo(rope.lengthOf(seated0));
    // what each strand spans between its leads with the plug's pivot at p
    const span = (p: rope.V3, i: number) =>
      rope.dist(
        [must(ex[i]).at[0] + p[0], must(ex[i]).at[1] - 600 + p[1], must(ex[i]).at[2] - 300 + p[2] + 25],
        [must(r.fixed[i]).at[0], 0, 25],
      );
    expect(cablerig3d.withinCable(r, ex, L, [0, 600, 300], q)).toStrictEqual([0, 600, 300]);
    // far off: pulled back until its strands are taut
    const p = cablerig3d.withinCable(r, ex, L, [0, 9000, 300], q),
      most = Math.max(span(p, 0), span(p, 1));
    expect(most).toBeLessThanOrEqual(must(L[0]) - 50 + 1e-6);
    expect(most).toBeGreaterThan(must(L[0]) - 50 - 20);
    // held with some slack, at its height over the deck
    const h = cablerig3d.withinCable(r, ex, L, [0, 9000, 300], q, 0.5, [0, 0, 1]);
    expect(h[2]).toBeCloseTo(300);
    expect(Math.max(span(h, 0), span(h, 1))).toBeLessThanOrEqual((must(L[0]) - 50) * 0.5 + 1e-6);
  });

  it('hangs a loose cable from its grommet, each strand at the length it has seated and reaching its plug', () => {
    expect.hasAssertions();
    assert_hangs_a_loose_cable_from_its_grommet_each_strand();
  });
});

describe('a cable run out of its hole', () => {
  it('takes the first part of a polyline by length, spread evenly, and the point and the way at a length along it', () => {
    expect.hasAssertions();
    assert_takes_the_first_part_of_a_polyline_by_length_spr();
  });

  it('starts with the plug small in its hole, every strand on its fixed end', () => {
    expect.hasAssertions();
    assert_starts_with_the_plug_small_in_its_hole_every_str();
  });

  it('ends as the built cable stands: the plug seated, full size, the strands along their paths', () => {
    expect.hasAssertions();
    assert_ends_as_the_built_cable_stands_the_plug_seated_f();
  });

  it('keeps the cable whole on the way: each strand ends on its exit of the plug, and the cable grows with the run', () => {
    expect.hasAssertions();
    assert_keeps_the_cable_whole_on_the_way_each_strand_end();
  });

  it('reels back along the way it was run: the same cable at the same place of the run', () => {
    const r = rig(),
      ex = r.model().strands,
      path = home(r),
      a = cablerig3d.reelAt(r, ex, path, end(r), 0.6),
      b = cablerig3d.reelAt(r, ex, path, end(r), 0.6);
    expect(a.pose.at).toStrictEqual(b.pose.at);
    expect(a.strands).toStrictEqual(b.strands);
  });

  it('brings a loose plug to rest as it lies: its place and its turn at the end of the run', () => {
    const r = rig(),
      ex = r.model().strands,
      { rest, strands } = cablerig3d.looseState(r, ex, NO_REST),
      z = cablerig3d.reelAt(r, ex, strands, rest.pose, 1);
    expect(rope.dist(z.pose.at, rest.pose.at)).toBeLessThan(1e-3);
    expect(z.pose.q.angleTo(rest.pose.q)).toBeLessThan(1e-6);
    expect(z.size).toBe(1);
  });
});
