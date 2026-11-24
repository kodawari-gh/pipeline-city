import { afterAll, describe, expect, it } from 'vitest';
import { lengthOf } from '@/core/render/three/rope';
import { LAYOUT_TIER, setLayoutTier } from '../layout/layout';
import { TIER_GEO } from '../layout/boardlayout';
import { looseState, reelAt, rigBuild } from './cablerig3d';
import { PANEL_IDS, isPanelId, leadHole, panelId, panelRigs } from './casetray3d';

// The case's front-panel leads as rigs (Build my PC's hand runs them out and plugs them when the board goes in): one per header a board has.

const was = LAYOUT_TIER;
afterAll(() => setLayoutTier(was));

const tiers = Object.keys(TIER_GEO).map(Number);
const env = { planes: [], solids: [] };

describe("the case's front-panel leads", () => {
  it('has a rig for each header the board has, west to east', () => {
    for (const t of tiers) {
      setLayoutTier(t);
      const rigs = panelRigs(env);
      expect(
        rigs.map((r) => r.id),
        `tier ${t}`,
      ).toEqual(expect.arrayContaining([panelId('F_PANEL'), panelId('USB_2')]));
      expect(
        rigs.some((r) => r.id === panelId('USB_3')),
        `tier ${t} USB 3`,
      ).toBe(t >= 2);
      expect(
        rigs.some((r) => r.id === panelId('ARGB')),
        `tier ${t} ARGB`,
      ).toBe(t >= 3);
      const xs = rigs.map((r) => r.seat.at[0]);
      expect(xs, `tier ${t} order`).toEqual([...xs].sort((a, b) => a - b));
      for (const r of rigs) expect(isPanelId(r.id) && PANEL_IDS.includes(r.id)).toBe(true);
    }
  });

  it("is the case's, not the game's: nothing to pick, no run of the power lens, and no id the sim knows", () => {
    setLayoutTier(tiers[tiers.length - 1]!);
    for (const r of panelRigs(env)) {
      expect(r.inert).toBe(true);
      expect(r.power).toBeUndefined();
      expect(isPanelId(r.id)).toBe(true);
    }
    expect(isPanelId('atx')).toBe(false);
    expect(isPanelId('fan:fan0')).toBe(false);
  });

  it('runs each strand from its share of the hole to its plug, one strand for each wire the lead has', () => {
    for (const t of tiers) {
      setLayoutTier(t);
      const hole = leadHole(),
        strands = new Set<string>();
      let total = 0;
      for (const r of panelRigs(env)) {
        const ex = r.model().strands,
          seated = r.seated(ex);
        expect(seated.length, r.id).toBe(r.fixed.length);
        expect(ex.length, r.id).toBe(r.fixed.length);
        expect(r.looks?.length, r.id).toBe(r.fixed.length);
        for (const [i, s] of seated.entries()) {
          // (the hole lies under the board's south edge: each strand leaves it, and none shares a place with another's)
          const f = r.fixed[i]!.at;
          expect(f[0], r.id).toBeGreaterThanOrEqual(hole.x);
          expect(f[0], r.id).toBeLessThanOrEqual(hole.x + hole.w);
          expect(lengthOf(s), r.id).toBeGreaterThan(300);
          strands.add(f.join(','));
          total++;
        }
      }
      expect(strands.size, `tier ${t}: every strand has a place of its own in the hole`).toBe(total);
    }
  });

  it("builds seated and loose, the case's leads with their own look for each wire", () => {
    setLayoutTier(tiers[tiers.length - 1]!);
    for (const r of panelRigs(env)) {
      const on = rigBuild(r, true, undefined),
        off = rigBuild(r, false, undefined);
      expect(on.seated, r.id).toBe(true);
      expect(off.seated, r.id).toBe(false);
      expect(on.strands.length).toBe(r.fixed.length);
      expect(off.strands.length).toBe(r.fixed.length);
      expect(on.group.userData.rig).toBe(true);
    }
  });

  it('can be run out of the hole and taken back like any cable', () => {
    setLayoutTier(tiers[tiers.length - 1]!);
    for (const r of panelRigs(env)) {
      const model = r.model(),
        path = r.seated(model.strands),
        end = {
          at: [...r.seat.at] as [number, number, number],
          q: looseState(r, model.strands, undefined).rest.pose.q,
        };
      const start = reelAt(r, model.strands, path, { at: end.at, q: end.q.clone().identity() }, 0),
        done = reelAt(r, model.strands, path, { at: end.at, q: end.q.clone().identity() }, 1);
      // (at the start the plug is a speck at the hole, at the end it is whole at its header)
      expect(start.size, r.id).toBeLessThan(0.1);
      expect(done.size, r.id).toBeCloseTo(1, 5);
      expect(done.pose.at[0], r.id).toBeCloseTo(r.seat.at[0], 0);
      expect(done.pose.at[1], r.id).toBeCloseTo(r.seat.at[1], 0);
    }
  });
});
