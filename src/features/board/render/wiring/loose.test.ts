import { describe, expect, it } from 'vitest';
import { PORT_Y, setLayoutTier } from '../layout/layout';
import { plugRect } from '../devices';
import { buildCables, looseCable, type Cable } from './routes';
import { cordPath, cordPlan, cordRoute, cordSlack } from './cords';
import { CORD_END } from './cords';
import { fanCordPlans, cordLen } from './fancords';
import { pathLen } from '@/core/render/cable';
import { roomGeo } from '@/features/room/render/shell/room';

describe('loose cables lie where they would', () => {
  it('every loose PSU lead lies on the roof of the PSU: its plug stands on it, no plug overlaps another, the cable never goes below the roof', () => {
    setLayoutTier(3, 3);
    const loose = buildCables([{ kind: 'pcie', x: -1500, top: 980, plug: 0 }, { kind: 'pcie2', x: -1700, top: 980, plug: 1 }]).filter((c) => c.kind !== 'video').map((c: Cable) => ({ c, lo: looseCable(c) }));
    expect(loose.length).toBeGreaterThanOrEqual(4);
    for (const { lo, c } of loose) {
      const r = plugRect(lo.plug);
      expect(r.y + r.h, c.kind).toBeLessThanOrEqual(PORT_Y);
      for (const p of lo.path.pts) expect(p[1], c.kind).toBeLessThanOrEqual(PORT_Y);
      const end = lo.path.pts[lo.path.pts.length - 1]!;
      expect(Math.abs(end[0] - (r.x + r.w / 2)), c.kind).toBeLessThan(2);
    }
    for (const a of loose) for (const b of loose) {
      if (a === b) continue;
      const p = plugRect(a.lo.plug), q = plugRect(b.lo.plug);
      expect(p.x + p.w <= q.x || q.x + q.w <= p.x, `${a.c.kind} / ${b.c.kind}`).toBe(true);
    }
  });

  it('a fan cord that is out hangs on a cord a little longer than the way from its fixed end to its rest place', () => {
    setLayoutTier(3, 3);
    for (const p of fanCordPlans()) expect(cordLen(p), p.id).toBeGreaterThan(Math.hypot(p.rest[0] - p.anchor[0], p.rest[1] - p.anchor[1]));
  });

  it('a wall cord seated runs straight into its boot; out, it keeps its run and hangs to the plug', () => {
    const geo = roomGeo();
    const plan = cordPlan(geo).pcmains;
    expect(cordPath(plan, plan.outlet, true).length).toBeGreaterThan(plan.route.length);
    const out = cordPath(plan, plan.rest, false), boot = [plan.rest[0], plan.rest[1] - CORD_END];
    expect(out[out.length - 1]![0]).toBeCloseTo(boot[0]!, 3);
    expect(out[out.length - 1]![1]).toBeCloseTo(boot[1]!, 3);
    expect(pathLen(out)).toBeGreaterThan(pathLen(cordRoute(plan, plan.rest)) * 0.9);
    expect(cordSlack(plan)).toBeGreaterThan(0);
  });
});
