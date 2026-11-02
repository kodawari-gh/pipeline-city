import { Group, Quaternion } from 'three';
import { describe, expect, it } from 'vitest';
import { dist, lengthOf, type RopeEnd, type V3 } from '@/core/render/three/rope';
import { lengthsOf, looseState, withinCable, withinReach, type CableRig } from './cablerig3d';

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
