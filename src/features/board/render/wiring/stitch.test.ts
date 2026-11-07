import { describe, expect, it } from 'vitest';
import { TIER_GEO } from '../layout/boardlayout';
import { GEO, setLayoutTier } from '../layout/layout';
import { buildBuses, pointAt } from './routes';
import { STITCH_HOLE, STITCH_LANE, stitchVias } from './stitch';

describe.each(TIER_GEO.map((g) => g.tier))('board tier %i ground stitching', (tier) => {
  const setup = () => {
    setLayoutTier(tier, tier);
    return { g: GEO, lanes: buildBuses().flatMap((b) => b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : [])) };
  };

  it('scatters vias through the free plane, all on the board', () => {
    const { g, lanes } = setup(), vias = stitchVias(g, lanes);
    expect(vias.length).toBeGreaterThan(150);
    for (const [x, y] of vias) expect(x > g.bd.x && x < g.bd.x + g.bd.w && y > g.bd.y && y < g.bd.y + g.bd.h).toBe(true);
  });

  it('keeps every via off the lanes, on any layer, and off the mounting holes', () => {
    const { g, lanes } = setup(), vias = stitchVias(g, lanes);
    for (const [x, y] of vias) {
      let d = Infinity;
      for (const l of lanes) for (let s = 0; s < l.len; s += 10) { const p = pointAt(l, s); d = Math.min(d, Math.hypot(p[0] - x, p[1] - y)); }
      expect(d, `via at ${x},${y}`).toBeGreaterThan(STITCH_LANE - 12);
      for (const [hx, hy] of g.holes) expect(Math.hypot(hx - x, hy - y)).toBeGreaterThanOrEqual(STITCH_HOLE);
    }
  }, 30000); // (about 5 s alone: the full suite's load made it time out at the default)
});
