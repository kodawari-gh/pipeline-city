import { describe, expect, it } from 'vitest';
import { BLOCKS, routerRoute } from './routerroute';
import { routerPlan } from './routerplan';

const TIERS = [1, 2, 3, 4];

describe('the way a frame goes through the router SoC', () => {
  it('runs the wires from the WAN MAC to the switch for a download, in order, none run backward', () => {
    for (const t of TIERS) {
      const hops = routerRoute(routerPlan(t), 'rx');
      expect(
        hops.map((h) => h.link.id),
        `tier ${t}`,
      ).toEqual(['wanmac-pkt', 'pkt-sw']);
      expect(
        hops.every((h) => !h.reverse),
        `tier ${t}`,
      ).toBe(true);
    }
  });

  it('runs the same wires the other way for an upload, each from its far end', () => {
    for (const t of TIERS) {
      const rx = routerRoute(routerPlan(t), 'rx'),
        tx = routerRoute(routerPlan(t), 'tx');
      expect(
        tx.map((h) => h.link.id),
        `tier ${t}`,
      ).toEqual([...rx.map((h) => h.link.id)].reverse());
      expect(
        tx.every((h) => h.reverse),
        `tier ${t}`,
      ).toBe(true);
    }
  });

  it('joins end to end: each wire starts where the one before it ended', () => {
    for (const t of TIERS)
      for (const dir of ['rx', 'tx'] as const) {
        const hops = routerRoute(routerPlan(t), dir),
          ends = (h: (typeof hops)[number]) => ({
            a: h.reverse ? h.link.to : h.link.from,
            b: h.reverse ? h.link.from : h.link.to,
          });
        for (let i = 1; i < hops.length; i++)
          expect(ends(hops[i - 1]!).b, `tier ${t} ${dir} ${hops[i]!.link.id}`).toBe(ends(hops[i]!).a);
        // (the way starts in the block the frame comes in at and ends in the block it leaves by)
        expect(ends(hops[0]!).a, `tier ${t} ${dir}`).toBe(dir === 'rx' ? 'wanmac' : 'sw');
        expect(ends(hops[hops.length - 1]!).b, `tier ${t} ${dir}`).toBe(dir === 'rx' ? 'sw' : 'wanmac');
      }
  });

  it('lights the blocks of each way in order: the WAN MAC, the engine, the switch', () => {
    expect(BLOCKS.rx).toEqual(['wanmac', 'pkt', 'sw']);
    expect(BLOCKS.tx).toEqual([...BLOCKS.rx].reverse());
    for (const t of TIERS) {
      const ids = new Set(routerPlan(t).blocks.map((b) => b.id));
      for (const id of [...BLOCKS.rx, ...BLOCKS.tx]) expect(ids.has(id), `tier ${t} ${id}`).toBe(true);
    }
  });

  it('skips a wire the plan does not have', () => {
    expect(routerRoute({ links: [] }, 'rx')).toEqual([]);
  });
});
