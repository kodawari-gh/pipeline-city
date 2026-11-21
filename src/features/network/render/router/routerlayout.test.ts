import { describe, expect, it } from 'vitest';
import type { Rect } from '../plan/netplan';
import { ROUTER_BODIES, ROUTER_DIE_RECT, routerGeo, routerIds, routerParts } from './routerlayout';
import { ROUTER_DIE } from './routerplan';

const TIERS = [1, 2, 3, 4];
const inside = (r: Rect, o: Rect): boolean => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;

describe('the router\'s die in its frame', () => {
  it('covers the plan from the frame\'s origin, at the plan\'s own units', () => {
    for (const t of TIERS) {
      const g = routerGeo(t);
      expect(g.die, `tier ${t}`).toEqual({ x: 0, y: 0, ...ROUTER_DIE });
      expect(g.die, `tier ${t}`).toEqual(ROUTER_DIE_RECT);
      expect(g.plan.die, `tier ${t}`).toEqual(g.die);
    }
  });

  it('is the same object for the same tier, and a different plan for each', () => {
    expect(routerGeo(2)).toBe(routerGeo(2));
    expect(routerGeo(1).plan).not.toBe(routerGeo(2).plan);
    expect(routerGeo(3).tier).toBe(3);
  });
});

describe('the parts of the router that a pointer can meet', () => {
  it('has an id for every block of the die, `router.` and the block, and no id twice', () => {
    for (const t of TIERS) {
      const g = routerGeo(t), parts = routerParts(g), ids = parts.map((p) => p.id);
      expect(new Set(ids).size, `tier ${t}`).toBe(ids.length);
      expect(ids, `tier ${t}`).toEqual(g.plan.blocks.map((b) => `router.${b.id}`));
      for (const id of ids) expect(id, `tier ${t}`).toMatch(/^router\.[a-z]+$/);
      expect(ids.length, `tier ${t}`).toBe(7);
    }
  });

  it('enumerates the ids of a tier: the bodies on the board (the radio only where there is one) and the die\'s blocks', () => {
    for (const t of TIERS) {
      const ids = routerIds(t);
      expect(new Set(ids).size, `tier ${t}`).toBe(ids.length);
      expect(ids.slice(ids.length - 7), `tier ${t}`).toEqual(routerParts(routerGeo(t)).map((p) => p.id));
      expect(ids.includes('router.radio'), `tier ${t} radio`).toBe(t <= 2);
      for (const b of ROUTER_BODIES.filter((x) => x !== 'router.radio')) expect(ids, `tier ${t}`).toContain(b);
    }
  });

  it('keeps every block on the die, and the six of the SoC inside its frame', () => {
    for (const t of TIERS) {
      const g = routerGeo(t), parts = routerParts(g), by = (id: string) => parts.find((p) => p.id === `router.${id}`)!.rect;
      for (const p of parts) expect(inside(p.rect, g.die), `tier ${t} ${p.id}`).toBe(true);
      for (const k of ['wanmac', 'cpu', 'mem', 'pkt', 'sw', 'stat']) {
        expect(inside(by(k), by('soc')), `tier ${t} ${k} in soc`).toBe(true);
        // the smallest rectangle under the pointer wins: a part inside the SoC is smaller than it
        expect(by(k).w * by(k).h, `tier ${t} ${k}`).toBeLessThan(by('soc').w * by('soc').h);
      }
    }
  });
});
