import { Group, Quaternion } from 'three';
import { describe, expect, it } from 'vitest';
import { dist, lengthOf, type RopeEnd, type V3 } from '@/core/render/three/rope';
import { along, exitAt, lengthsOf, looseState, prefixOf, reelAt, withinCable, withinReach, type CableRig } from './cablerig3d';

/** A two-strand lead out of a grommet at the origin (facing +z) into a socket 600 up and 300 out, which it pulls out of along +z. */
function rig(): CableRig {
  const fixed: RopeEnd[] = [{ at: [-40, 0, 0], dir: [0, 0, 1] }, { at: [40, 0, 0], dir: [0, 0, 1] }];
  const exits: RopeEnd[] = [{ at: [-40, 600, 360], dir: [0, 0, 1] }, { at: [40, 600, 360], dir: [0, 0, 1] }];
  return {
    id: 'x', name: 'the socket', target: null, look: { r: 10, base: '#000000', accent: null }, env: { planes: [], solids: [] }, fixed,
    model: () => ({ root: new Group(), strands: exits }), seat: { at: [0, 600, 300], axis: [0, 0, 1] }, canSeat: true, engage: 60,
    // seated, each strand runs out of the grommet, up over the socket and back down into the plug
    seated: (ex) => ex.map((e, i): V3[] => [fixed[i]!.at, [fixed[i]!.at[0], 0, 700], [e.at[0], 600, 1000], e.at]),
    deck: { n: [0, 0, 1], d: 0 }, n: 16, stiff: 0.5, lead: 25,
  };
}

describe('a cable rig', () => {
  it('keeps a point within reach of another', () => {
    const from: V3 = [100, 200, 300];
    expect(withinReach([150, 200, 300], from, 500)).toEqual([150, 200, 300]);
    const p = withinReach([100, 200, 2300], from, 500);
    expect(dist(p, from)).toBeCloseTo(500);
    expect(p[0]).toBeCloseTo(100);
    expect(p[2]).toBeCloseTo(800);
  });

  it('keeps a plug held over the board at its height when its cable pulls it in (never down toward the grommet behind)', () => {
    // the grommet 300 behind the plane the plug moves on, the plug 1000 out along it
    const from: V3 = [0, 0, 0], p = withinReach([1000, 0, 300], from, 500, [0, 0, 1]);
    expect(p[2]).toBeCloseTo(300);
    expect(dist(p, from)).toBeCloseTo(500);
    expect(p[0]).toBeCloseTo(400);
    expect(withinReach([300, 0, 300], from, 500, [0, 0, 1])).toEqual([300, 0, 300]);
  });

  it('lets a plug go only as far as its cable reaches: the length each strand has seated', () => {
    const r = rig(), ex = r.model().strands, L = lengthsOf(r, ex), q = new Quaternion();
    expect(L[0]).toBeCloseTo(lengthOf(r.seated(ex)[0]!));
    // what each strand spans between its leads with the plug's pivot at p
    const span = (p: V3, i: number) => dist([ex[i]!.at[0] + p[0], ex[i]!.at[1] - 600 + p[1], ex[i]!.at[2] - 300 + p[2] + 25], [r.fixed[i]!.at[0], 0, 25]);
    expect(withinCable(r, ex, L, [0, 600, 300], q)).toEqual([0, 600, 300]);
    // far off: pulled back until its strands are taut
    const p = withinCable(r, ex, L, [0, 9000, 300], q), most = Math.max(span(p, 0), span(p, 1));
    expect(most).toBeLessThanOrEqual(L[0]! - 50 + 1e-6);
    expect(most).toBeGreaterThan(L[0]! - 50 - 20);
    // held with some slack, at its height over the deck
    const h = withinCable(r, ex, L, [0, 9000, 300], q, 0.5, [0, 0, 1]);
    expect(h[2]).toBeCloseTo(300);
    expect(Math.max(span(h, 0), span(h, 1))).toBeLessThanOrEqual((L[0]! - 50) * 0.5 + 1e-6);
  });

  it('hangs a loose cable from its grommet, each strand at the length it has seated and reaching its plug', () => {
    const r = rig(), ex = r.model().strands, L = lengthsOf(r, ex), { rest, strands } = looseState(r, ex, undefined);
    strands.forEach((s, i) => expect(Math.abs(lengthOf(s) / L[i]! - 1), `strand ${i}`).toBeLessThan(0.03));
    expect(rest.pose.at[1]).toBeLessThan(-L[0]! * 0.5);
    // a plug that came to rest keeps its strands as they lay
    const kept = looseState(r, ex, { pose: rest.pose, strands });
    expect(kept.strands).toBe(strands);
  });
});

describe('a cable run out of its hole', () => {
  const home = (r: CableRig) => r.seated(r.model().strands), end = (r: CableRig) => ({ at: [...r.seat.at] as V3, q: new Quaternion() });

  it('takes the first part of a polyline by length, spread evenly, and the point and the way at a length along it', () => {
    const p: V3[] = [[0, 0, 0], [100, 0, 0], [100, 300, 0]];
    expect(along(p, 50)).toEqual({ at: [50, 0, 0], dir: [1, 0, 0] });
    expect(along(p, 250).at).toEqual([100, 150, 0]);
    expect(along(p, 250).dir).toEqual([0, 1, 0]);
    // held to its ends
    expect(along(p, -5).at).toEqual([0, 0, 0]);
    expect(along(p, 9999).at).toEqual([100, 300, 0]);
    const half = prefixOf(p, 0.5, 5);
    expect(half).toHaveLength(5);
    expect(half[0]).toEqual([0, 0, 0]);
    expect(lengthOf(half)).toBeCloseTo(200);
    expect(prefixOf(p, 0, 4).every((q) => q[0] === 0 && q[1] === 0)).toBe(true);
    expect(lengthOf(prefixOf(p, 1, 9))).toBeCloseTo(lengthOf(p));
  });

  it('starts with the plug small in its hole, every strand on its fixed end', () => {
    const r = rig(), ex = r.model().strands, a = reelAt(r, ex, home(r), end(r), 0);
    expect(a.size).toBe(0);
    a.strands.forEach((s, i) => expect(s[0], `strand ${i}`).toEqual(r.fixed[i]!.at));
    expect(lengthOf(a.strands[0]!)).toBeLessThan(150);
  });

  it('ends as the built cable stands: the plug seated, full size, the strands along their paths', () => {
    const r = rig(), ex = r.model().strands, path = home(r), z = reelAt(r, ex, path, end(r), 1);
    expect(z.size).toBe(1);
    expect(dist(z.pose.at, r.seat.at)).toBeLessThan(1e-6);
    expect(z.pose.q.angleTo(new Quaternion())).toBeLessThan(1e-6);
    z.strands.forEach((s, i) => {
      expect(dist(s[0]!, path[i]![0]!)).toBeLessThan(1e-6);
      expect(dist(s[s.length - 1]!, path[i]![path[i]!.length - 1]!)).toBeLessThan(1e-6);
      // (evenly respaced points cut the sharp corners of this crude path a little)
      expect(Math.abs(lengthOf(s) / lengthOf(path[i]!) - 1)).toBeLessThan(0.05);
    });
  });

  it('keeps the cable whole on the way: each strand ends on its exit of the plug, and the cable grows with the run', () => {
    const r = rig(), ex = r.model().strands, path = home(r);
    let last = 0;
    for (const f of [0.35, 0.5, 0.7, 0.9]) {
      const a = reelAt(r, ex, path, end(r), f);
      expect(a.size).toBe(1);
      a.strands.forEach((s, i) => expect(dist(s[s.length - 1]!, exitAt(ex[i]!, r.seat, a.pose).at), `strand ${i} at ${f}`).toBeLessThan(1e-6));
      expect(lengthOf(a.strands[0]!)).toBeGreaterThan(last);
      last = lengthOf(a.strands[0]!);
    }
  });

  it('reels back along the way it was run: the same cable at the same place of the run', () => {
    const r = rig(), ex = r.model().strands, path = home(r), a = reelAt(r, ex, path, end(r), 0.6), b = reelAt(r, ex, path, end(r), 0.6);
    expect(a.pose.at).toEqual(b.pose.at);
    expect(a.strands).toEqual(b.strands);
  });

  it('brings a loose plug to rest as it lies: its place and its turn at the end of the run', () => {
    const r = rig(), ex = r.model().strands, { rest, strands } = looseState(r, ex, undefined), z = reelAt(r, ex, strands, rest.pose, 1);
    expect(dist(z.pose.at, rest.pose.at)).toBeLessThan(1e-3);
    expect(z.pose.q.angleTo(rest.pose.q)).toBeLessThan(1e-6);
    expect(z.size).toBe(1);
  });
});
