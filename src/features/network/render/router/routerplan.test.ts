import { describe, expect, it } from 'vitest';
import type { Rect } from '../plan/netplan';
import { ROUTER_DIE, ROUTER_PARTS, routerInput, routerPlan } from './routerplan';

const TIERS = [1, 2, 3, 4];
const inside = (r: Rect, o: Rect): boolean => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const apart = (a: Rect, b: Rect): boolean => a.x >= b.x + b.w - 0.01 || b.x >= a.x + a.w - 0.01 || a.y >= b.y + b.h - 0.01 || b.y >= a.y + a.h - 0.01;
const LEAVES = ['wanmac', 'cpu', 'mem', 'pkt', 'sw', 'stat'];

describe('the router SoC as a floorplan', () => {
  it('is drawn for the four routers, on a square die', () => {
    for (const t of TIERS) {
      const p = routerPlan(t);
      expect(p.die, `tier ${t}`).toEqual({ x: 0, y: 0, ...ROUTER_DIE });
      expect(p.die.w, `tier ${t}`).toBe(p.die.h);
      expect(p.input, `tier ${t}`).toBe(routerInput(t));
    }
  });

  it('has every block once and the SoC\'s frame round all of them', () => {
    for (const t of TIERS) {
      const p = routerPlan(t), ids = p.blocks.map((b) => b.id);
      expect(new Set(ids).size, `tier ${t}`).toBe(ids.length);
      expect(ids.sort(), `tier ${t}`).toEqual(['soc', ...LEAVES].sort());
      expect(p.blocks.find((b) => b.id === 'soc')!.frame, `tier ${t}`).toBe(true);
      for (const k of LEAVES) expect(p.blocks.find((b) => b.id === k)!.parent, `tier ${t} ${k}`).toBe('soc');
    }
  });

  it('keeps every block inside the die, and the blocks apart so a hover lands on one', () => {
    for (const t of TIERS) {
      const p = routerPlan(t), leaves = p.blocks.filter((b) => b.kind !== 'soc'), soc = p.blocks.find((b) => b.id === 'soc')!.rect;
      for (const b of p.blocks) expect(inside(b.rect, p.die), `tier ${t} ${b.id}`).toBe(true);
      for (const b of leaves) expect(inside(b.rect, soc), `tier ${t} ${b.id} in soc`).toBe(true);
      for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) expect(apart(leaves[i]!.rect, leaves[j]!.rect), `tier ${t} ${leaves[i]!.id} / ${leaves[j]!.id}`).toBe(true);
    }
  });

  it('puts the line side in the west of the top row, the engine under it and the switch under the engine', () => {
    for (const t of TIERS) {
      const p = routerPlan(t), r = (k: string) => p.blocks.find((b) => b.id === k)!.rect;
      expect(r('wanmac').x, `tier ${t}`).toBeLessThan(r('cpu').x);
      expect(r('cpu').x, `tier ${t}`).toBeLessThan(r('mem').x);
      expect(r('wanmac').y + r('wanmac').h, `tier ${t}`).toBeLessThan(r('pkt').y);
      expect(r('pkt').y + r('pkt').h, `tier ${t}`).toBeLessThan(r('sw').y);
      expect(r('sw').x, `tier ${t}`).toBeLessThan(r('stat').x);
      // the engine is the widest block: the NAT table's rows run along it
      expect(r('pkt').w, `tier ${t}`).toBeGreaterThan(r('stat').w * 2);
    }
  });

  it('routes every wire with at least two points, between the blocks it names, and gives each wire its own id', () => {
    for (const t of TIERS) {
      const p = routerPlan(t), ids = new Set(p.blocks.map((b) => b.id));
      expect(p.links.map((l) => l.id).sort(), `tier ${t}`).toEqual(['cpu-mem', 'cpu-pkt', 'mem-pkt', 'pkt-stat', 'pkt-sw', 'wanmac-pkt']);
      for (const l of p.links) {
        expect(l.pts.length, `tier ${t} ${l.id}`).toBeGreaterThanOrEqual(2);
        expect(ids.has(l.from), `tier ${t} ${l.id} from ${l.from}`).toBe(true);
        expect(ids.has(l.to), `tier ${t} ${l.id} to ${l.to}`).toBe(true);
        for (const [x, y] of l.pts) { expect(x, `${l.id} x`).toBeGreaterThanOrEqual(0); expect(x, `${l.id} x`).toBeLessThanOrEqual(p.die.w); expect(y, `${l.id} y`).toBeGreaterThanOrEqual(0); expect(y, `${l.id} y`).toBeLessThanOrEqual(p.die.h); }
      }
      expect(new Set(p.links.map((l) => l.id)).size, `tier ${t}`).toBe(p.links.length);
    }
  });

  it('starts each wire at the edge of the block it leaves and ends it at the edge of the block it reaches', () => {
    const touches = (pt: [number, number], r: Rect): boolean => {
      const near = (v: number, a: number, b: number) => v >= a - 1 && v <= b + 1;
      return (near(pt[0], r.x, r.x + r.w) && (Math.abs(pt[1] - r.y) <= 1 || Math.abs(pt[1] - (r.y + r.h)) <= 1)) || (near(pt[1], r.y, r.y + r.h) && (Math.abs(pt[0] - r.x) <= 1 || Math.abs(pt[0] - (r.x + r.w)) <= 1));
    };
    for (const t of TIERS) {
      const p = routerPlan(t), r = (k: string) => p.blocks.find((b) => b.id === k)!.rect;
      for (const l of p.links) {
        expect(touches(l.pts[0]!, r(l.from)), `tier ${t} ${l.id} leaves ${l.from}`).toBe(true);
        expect(touches(l.pts[l.pts.length - 1]!, r(l.to)), `tier ${t} ${l.id} reaches ${l.to}`).toBe(true);
      }
    }
  });

  it('is the same plan for the same router, and the parts differ by tier', () => {
    expect(routerPlan(2)).toBe(routerPlan(2));
    expect(routerPlan(1)).not.toBe(routerPlan(2));
    expect(routerInput(99)).toBe(ROUTER_PARTS[1]);
    expect(new Set(TIERS.map((t) => ROUTER_PARTS[t]!.soc)).size).toBe(4);
    expect(new Set(TIERS.map((t) => ROUTER_PARTS[t]!.std)).size).toBe(4);
    expect(ROUTER_PARTS[1]!.cores).toBeLessThan(ROUTER_PARTS[4]!.cores);
    expect(ROUTER_PARTS[1]!.dram.mb).toBeLessThan(ROUTER_PARTS[4]!.dram.mb);
    // (the radio is the home routers' only: they have aerials)
    for (const t of TIERS) expect(!!ROUTER_PARTS[t]!.radio, `tier ${t}`).toBe(t <= 2);
  });
});
