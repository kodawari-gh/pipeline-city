import { describe, expect, it } from 'vitest';
import { BLOCKS, routerRoute } from './routerroute';
import { routerPlan } from './routerplan';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const TIERS = [1, 2, 3, 4];

type Hop = ReturnType<typeof routerRoute>[number];

/** The blocks a hop joins, in the way the frame goes: `a` the one it leaves, `b` the one it reaches. */
const ends = (h: Hop) => ({
  a: h.reverse ? h.link.to : h.link.from,
  b: h.reverse ? h.link.from : h.link.to,
});

/** Where each way comes in and where it leaves the router. */
const WAYS = { rx: { first: 'wanmac', last: 'sw' }, tx: { first: 'sw', last: 'wanmac' } } as const;

describe('the way a frame goes through the router SoC', () => {
  it('runs the wires from the WAN MAC to the switch for a download, in order, none run backward', () => {
    for (const t of TIERS) {
      const hops = routerRoute(routerPlan(t), 'rx');
      expect(
        hops.map((h) => h.link.id),
        `tier ${t}`,
      ).toStrictEqual(['wanmac-pkt', 'pkt-sw']);
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
      ).toStrictEqual(rx.map((h) => h.link.id).toReversed());
      expect(
        tx.every((h) => h.reverse),
        `tier ${t}`,
      ).toBe(true);
    }
  });

  it('joins end to end: each wire starts where the one before it ended', () => {
    for (const t of TIERS) {
      for (const dir of ['rx', 'tx'] as const) {
        const hops = routerRoute(routerPlan(t), dir);
        for (let i = 1; i < hops.length; i++) {
          const hop = must(hops[i]);
          expect(ends(must(hops[i - 1])).b, `tier ${t} ${dir} ${hop.link.id}`).toBe(ends(hop).a);
        }
        // (the way starts in the block the frame comes in at and ends in the block it leaves by)
        expect(ends(must(hops[0])).a, `tier ${t} ${dir}`).toBe(WAYS[dir].first);
        const last = must(hops.at(-1));
        expect(ends(last).b, `tier ${t} ${dir}`).toBe(WAYS[dir].last);
      }
    }
  });

  it('lights the blocks of each way in order: the WAN MAC, the engine, the switch', () => {
    expect(BLOCKS.rx).toStrictEqual(['wanmac', 'pkt', 'sw']);
    expect(BLOCKS.tx).toStrictEqual([...BLOCKS.rx].toReversed());
    for (const t of TIERS) {
      const ids = new Set(routerPlan(t).blocks.map((b) => b.id));
      for (const id of [...BLOCKS.rx, ...BLOCKS.tx]) {
        expect(ids.has(id), `tier ${t} ${id}`).toBe(true);
      }
    }
  });

  it('skips a wire the plan does not have', () => {
    expect(routerRoute({ links: [] }, 'rx')).toStrictEqual([]);
  });
});
