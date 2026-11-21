import { describe, expect, it } from 'vitest';
import type { Rect } from '../plan/netplan';
import { routerGeo, routerIds, routerParts, routerRails, worldRect } from './routerlayout';
import { ROUTER_PLAN_W } from './routerplan';

/** A router front as the room's tiers give it: the width of the spot, the height of the bezel. */
const FRONTS: Record<number, Rect> = {
  1: { x: -7730, y: -3500, w: 2320, h: 438 },
  2: { x: -7730, y: -3500, w: 2320, h: 456 },
  3: { x: -7730, y: -3500, w: 2320, h: 457 },
  4: { x: -7724, y: -3500, w: 2314, h: 542 },
};
const TIERS = [1, 2, 3, 4];
const inside = (r: Rect, o: Rect): boolean => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;

describe('the router\'s panel in the world', () => {
  it('lays the plan over the front, ROUTER_PLAN_W units across, at the scale that fills it', () => {
    for (const t of TIERS) {
      const f = FRONTS[t]!, g = routerGeo(t, f);
      expect(g.plan.die.w, `tier ${t}`).toBe(ROUTER_PLAN_W);
      expect(g.scale, `tier ${t}`).toBeCloseTo(f.w / ROUTER_PLAN_W, 9);
      expect(g.scale, `tier ${t} a plan unit is about a world unit`).toBeGreaterThan(0.9);
      expect(g.scale, `tier ${t}`).toBeLessThan(1.1);
      expect(g.origin, `tier ${t}`).toEqual({ x: f.x, y: f.y });
      expect(g.face.x, `tier ${t}`).toBe(f.x);
      expect(g.face.y, `tier ${t}`).toBe(f.y);
      expect(g.face.w, `tier ${t}`).toBe(f.w);
      // (the plan's height is whole plan units: the panel is that tall, within a unit of the bezel)
      expect(Math.abs(g.face.h - f.h), `tier ${t}`).toBeLessThanOrEqual(g.scale);
      expect(g.plan.die.h * g.scale, `tier ${t}`).toBeCloseTo(g.face.h, 6);
    }
  });

  it('is the same object for the same front, and a different plan for each tier', () => {
    expect(routerGeo(2, FRONTS[2]!)).toBe(routerGeo(2, FRONTS[2]!));
    expect(routerGeo(1, FRONTS[1]!).plan).not.toBe(routerGeo(2, FRONTS[2]!).plan);
    expect(routerGeo(3, FRONTS[3]!).tier).toBe(3);
  });

  it('puts a plan rectangle in the world by the origin and the scale', () => {
    const g = routerGeo(4, FRONTS[4]!), r = { x: 100, y: 40, w: 200, h: 80 }, w = worldRect(g, r);
    expect(w).toEqual({ x: g.origin.x + 100 * g.scale, y: g.origin.y + 40 * g.scale, w: 200 * g.scale, h: 80 * g.scale });
    expect(worldRect({ origin: { x: 5, y: 7 }, scale: 1 }, r)).toEqual({ x: 105, y: 47, w: 200, h: 80 });
  });
});

describe('the parts of the router that a pointer can meet', () => {
  it('has an id for every block, `router.` and the block, and no id twice', () => {
    for (const t of TIERS) {
      const g = routerGeo(t, FRONTS[t]!), parts = routerParts(g), ids = parts.map((p) => p.id);
      expect(new Set(ids).size, `tier ${t}`).toBe(ids.length);
      expect(ids, `tier ${t}`).toEqual(g.plan.blocks.map((b) => `router.${b.id}`));
      for (const id of ids) expect(id, `tier ${t}`).toMatch(/^router\.[a-z]+$/);
      expect(ids.length, `tier ${t}`).toBe(t <= 2 ? 15 : 14);
    }
  });

  it('enumerates the ids of a tier without the world (the hover words are tested against them)', () => {
    for (const t of TIERS) {
      expect(routerIds(t), `tier ${t}`).toEqual(routerParts(routerGeo(t, FRONTS[t]!)).map((p) => p.id));
      expect(routerIds(t).includes('router.radio'), `tier ${t} radio`).toBe(t <= 2);
    }
  });

  it('keeps every part on the panel, and the three of the SoC inside its frame', () => {
    for (const t of TIERS) {
      const g = routerGeo(t, FRONTS[t]!), parts = routerParts(g), by = (id: string) => parts.find((p) => p.id === `router.${id}`)!.rect;
      for (const p of parts) expect(inside(p.rect, g.face), `tier ${t} ${p.id}`).toBe(true);
      for (const k of ['cpu', 'pkt', 'sw']) expect(inside(by(k), by('soc')), `tier ${t} ${k} in soc`).toBe(true);
      // the smallest rectangle under the pointer wins: a part inside the SoC is smaller than it
      for (const k of ['cpu', 'pkt', 'sw']) expect(by(k).w * by(k).h, `tier ${t} ${k}`).toBeLessThan(by('soc').w * by('soc').h);
    }
  });

  it('gives a flight to the whole panel and one to each part', () => {
    for (const t of TIERS) {
      const g = routerGeo(t, FRONTS[t]!), rails = routerRails(g);
      expect(rails[0], `tier ${t}`).toEqual({ id: 'router', rect: g.face });
      expect(rails.slice(1).map((r) => r.id), `tier ${t}`).toEqual(routerParts(g).map((p) => p.id));
      expect(new Set(rails.map((r) => r.id)).size, `tier ${t}`).toBe(rails.length);
    }
  });
});
