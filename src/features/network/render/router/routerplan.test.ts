import { describe, expect, it } from 'vitest';
import type { Rect } from '../plan/netplan';
import { ROUTER_PARTS, routerInput, routerPlan, type RouterBlockKind } from './routerplan';

/** A router front's plan area per tier (the plan units of `routerGeo`: the front over the plan scale). */
const SIZE: Record<number, { w: number; h: number }> = { 1: { w: 2400, h: 454 }, 2: { w: 2400, h: 472 }, 3: { w: 2400, h: 472 }, 4: { w: 2394, h: 560 } };
const TIERS = [1, 2, 3, 4];
const inside = (r: Rect, o: Rect): boolean => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const apart = (a: Rect, b: Rect): boolean => a.x >= b.x + b.w - 0.01 || b.x >= a.x + a.w - 0.01 || a.y >= b.y + b.h - 0.01 || b.y >= a.y + a.h - 0.01;
const LEAVES: RouterBlockKind[] = ['cpu', 'pkt', 'sw', 'dram', 'flash', 'power', 'wanjack', 'wanmag', 'wanphy', 'lanphy', 'lanmag', 'lanjack', 'stat'];

describe('the router as a floorplan', () => {
  it('is drawn for the four routers, in the area of the router\'s front', () => {
    for (const t of TIERS) {
      const p = routerPlan(t, SIZE[t]!);
      expect(p.die, `tier ${t}`).toEqual({ x: 0, y: 0, ...SIZE[t]! });
      expect(p.input, `tier ${t}`).toBe(routerInput(t));
    }
  });

  it('has every block once, the SoC\'s frame round its three, and a radio only on the routers that have aerials', () => {
    for (const t of TIERS) {
      const p = routerPlan(t, SIZE[t]!), ids = p.blocks.map((b) => b.id);
      expect(new Set(ids).size, `tier ${t}`).toBe(ids.length);
      for (const k of LEAVES) expect(ids, `tier ${t} ${k}`).toContain(k);
      expect(p.blocks.find((b) => b.id === 'soc')!.frame, `tier ${t}`).toBe(true);
      for (const k of ['cpu', 'pkt', 'sw']) expect(p.blocks.find((b) => b.id === k)!.parent, `tier ${t} ${k}`).toBe('soc');
      expect(ids.includes('radio'), `tier ${t} radio`).toBe(t <= 2);
      expect(!!ROUTER_PARTS[t]!.radio, `tier ${t} radio part`).toBe(t <= 2);
    }
  });

  it('keeps every block inside the plan, and the blocks apart so a hover lands on one', () => {
    for (const t of TIERS) {
      const p = routerPlan(t, SIZE[t]!), leaves = p.blocks.filter((b) => b.kind !== 'soc'), soc = p.blocks.find((b) => b.id === 'soc')!.rect;
      for (const b of p.blocks) expect(inside(b.rect, p.die), `tier ${t} ${b.id}`).toBe(true);
      for (const b of leaves.filter((x) => x.parent)) expect(inside(b.rect, soc), `tier ${t} ${b.id} in soc`).toBe(true);
      for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) expect(apart(leaves[i]!.rect, leaves[j]!.rect), `tier ${t} ${leaves[i]!.id} / ${leaves[j]!.id}`).toBe(true);
    }
  });

  it('puts the SoC over the traffic block, the WAN side in the west and the LAN side in the east, the jacks along the bottom', () => {
    for (const t of TIERS) {
      const p = routerPlan(t, SIZE[t]!), r = (k: string) => p.blocks.find((b) => b.id === k)!.rect;
      expect(r('wanjack').x, `tier ${t}`).toBeLessThan(r('wanmag').x);
      expect(r('wanmag').x, `tier ${t}`).toBeLessThan(r('wanphy').x);
      expect(r('wanphy').x, `tier ${t}`).toBeLessThan(r('stat').x);
      expect(r('stat').x, `tier ${t}`).toBeLessThan(r('lanphy').x);
      expect(r('lanphy').x, `tier ${t}`).toBeLessThan(r('lanmag').x);
      expect(r('lanmag').x, `tier ${t}`).toBeLessThan(r('lanjack').x);
      // the frames pass the packet engine before the switch
      expect(r('cpu').x, `tier ${t}`).toBeLessThan(r('pkt').x);
      expect(r('pkt').x, `tier ${t}`).toBeLessThan(r('sw').x);
      // the SoC and the small parts stand in the top row, the jacks in the bottom row
      for (const k of ['soc', 'dram', 'flash', 'power']) expect(r(k).y + r(k).h, `tier ${t} ${k}`).toBeLessThan(r('stat').y);
      for (const k of ['wanjack', 'lanjack']) expect(r(k).y, `tier ${t} ${k}`).toBe(r('stat').y);
      // the SoC lies between the memory and the flash
      expect(r('dram').x + r('dram').w, `tier ${t}`).toBeLessThanOrEqual(r('soc').x);
      expect(r('soc').x + r('soc').w, `tier ${t}`).toBeLessThanOrEqual(r('flash').x);
    }
  });

  it('routes every wire with at least two points, between the blocks it names, and gives each wire its own id', () => {
    for (const t of TIERS) {
      const p = routerPlan(t, SIZE[t]!), ids = new Set(p.blocks.map((b) => b.id));
      expect(p.links.length, `tier ${t}`).toBeGreaterThanOrEqual(t <= 2 ? 13 : 12);
      for (const l of p.links) {
        expect(l.pts.length, `tier ${t} ${l.id}`).toBeGreaterThanOrEqual(2);
        expect(ids.has(l.from), `tier ${t} ${l.id} from ${l.from}`).toBe(true);
        expect(ids.has(l.to), `tier ${t} ${l.id} to ${l.to}`).toBe(true);
        for (const [x, y] of l.pts) { expect(x, `${l.id} x`).toBeGreaterThanOrEqual(0); expect(x, `${l.id} x`).toBeLessThanOrEqual(p.die.w); expect(y, `${l.id} y`).toBeGreaterThanOrEqual(0); expect(y, `${l.id} y`).toBeLessThanOrEqual(p.die.h); }
      }
      expect(new Set(p.links.map((l) => l.id)).size, `tier ${t}`).toBe(p.links.length);
      expect(p.links.some((l) => l.id === 'radio-soc'), `tier ${t}`).toBe(t <= 2);
    }
  });

  it('starts each wire at the edge of the block it leaves and ends it at the edge of the block it reaches', () => {
    const touches = (pt: [number, number], r: Rect): boolean => {
      const near = (v: number, a: number, b: number) => v >= a - 1 && v <= b + 1;
      return (near(pt[0], r.x, r.x + r.w) && (Math.abs(pt[1] - r.y) <= 1 || Math.abs(pt[1] - (r.y + r.h)) <= 1)) || (near(pt[1], r.y, r.y + r.h) && (Math.abs(pt[0] - r.x) <= 1 || Math.abs(pt[0] - (r.x + r.w)) <= 1));
    };
    for (const t of TIERS) {
      const p = routerPlan(t, SIZE[t]!), r = (k: string) => p.blocks.find((b) => b.id === k)!.rect;
      for (const l of p.links) {
        expect(touches(l.pts[0]!, r(l.from)), `tier ${t} ${l.id} leaves ${l.from}`).toBe(true);
        expect(touches(l.pts[l.pts.length - 1]!, r(l.to)), `tier ${t} ${l.id} reaches ${l.to}`).toBe(true);
      }
    }
  });

  it('is the same plan for the same router and size, and a different one for each tier', () => {
    expect(routerPlan(2, SIZE[2]!)).toBe(routerPlan(2, SIZE[2]!));
    expect(routerPlan(1, SIZE[1]!)).not.toBe(routerPlan(2, SIZE[2]!));
    expect(routerInput(99)).toBe(ROUTER_PARTS[1]);
    expect(new Set(TIERS.map((t) => ROUTER_PARTS[t]!.soc)).size).toBe(4);
    expect(new Set(TIERS.map((t) => ROUTER_PARTS[t]!.std)).size).toBe(4);
    expect(ROUTER_PARTS[1]!.cores).toBeLessThan(ROUTER_PARTS[4]!.cores);
    expect(ROUTER_PARTS[1]!.dram.mb).toBeLessThan(ROUTER_PARTS[4]!.dram.mb);
  });
});
