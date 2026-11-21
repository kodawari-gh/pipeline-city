import { describe, expect, it } from 'vitest';
import { NIC_LEN } from '../../../board/render/layout/layout';
import { NIC_LANES } from '../../../board/render/three/niccopper';
import { NIC_LINK, NIC_PLAN, nicInput, nicPlan, nicPlanWidth, type NicBlockKind } from './nicplan';
import { nicRoute, BLOCKS } from './nicroute';
import type { Rect } from '../plan/netplan';

const EDGE = { x0: 400, x1: 1000 };
const VISUALS = ['nic-gbe', 'nic-10g', 'nic-40g'];
const inside = (r: Rect, o: Rect): boolean => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const apart = (a: Rect, b: Rect): boolean => a.x >= b.x + b.w - 0.01 || b.x >= a.x + a.w - 0.01 || a.y >= b.y + b.h - 0.01 || b.y >= a.y + a.h - 0.01;
const LEAVES: NicBlockKind[] = ['jack', 'mag', 'phy', 'mac', 'stats', 'rxq', 'txq', 'dma', 'pcie', 'nvm', 'xtal', 'vreg', 'temp'];

describe('the card as a floorplan', () => {
  it('is drawn for the three cards, as long as the card less its two ends', () => {
    for (const v of VISUALS) {
      const p = nicPlan(v, EDGE);
      expect(p.die.w, v).toBe(nicPlanWidth(v));
      expect(p.die.w, v).toBe(NIC_LEN[v]! - 2 * NIC_PLAN.margin);
      expect(p.die.h, v).toBe(NIC_PLAN.h);
    }
  });

  it('has every block of the card once, and the controller\'s frame round its own', () => {
    for (const v of VISUALS) {
      const p = nicPlan(v, EDGE), ids = p.blocks.map((b) => b.id);
      expect(new Set(ids).size, v).toBe(ids.length);
      for (const k of LEAVES) expect(ids, `${v} ${k}`).toContain(k);
      expect(p.blocks.find((b) => b.id === 'ctl')!.frame, v).toBe(true);
      for (const k of ['phy', 'mac', 'stats', 'rxq', 'txq', 'dma', 'pcie']) expect(p.blocks.find((b) => b.id === k)!.parent, `${v} ${k}`).toBe('ctl');
    }
  });

  it('keeps every block inside the plan, and the blocks apart so a hover lands on one', () => {
    for (const v of VISUALS) {
      const p = nicPlan(v, EDGE), leaves = p.blocks.filter((b) => b.kind !== 'ctl');
      for (const b of p.blocks) expect(inside(b.rect, p.die), `${v} ${b.id}`).toBe(true);
      for (const b of leaves) expect(inside(b.rect, p.blocks.find((x) => x.id === 'ctl')!.rect) || !b.parent, `${v} ${b.id} in ctl`).toBe(true);
      for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) expect(apart(leaves[i]!.rect, leaves[j]!.rect), `${v} ${leaves[i]!.id} / ${leaves[j]!.id}`).toBe(true);
    }
  });

  it('runs the data from the jack in the west to the host link in the east', () => {
    for (const v of VISUALS) {
      const p = nicPlan(v, EDGE), x = (k: string) => p.blocks.find((b) => b.id === k)!.rect.x;
      expect(x('jack'), v).toBeLessThan(x('mag'));
      expect(x('mag'), v).toBeLessThan(x('phy'));
      expect(x('phy'), v).toBeLessThan(x('mac'));
      expect(x('mac'), v).toBeLessThan(x('rxq'));
      expect(x('rxq'), v).toBeLessThan(x('dma'));
      expect(x('dma'), v).toBeLessThan(x('pcie'));
      expect(x('pcie'), v).toBeLessThan(x('nvm'));
    }
  });

  it('stacks the MAC over the counters and the receive queue over the transmit queue', () => {
    const p = nicPlan('nic-10g', EDGE), r = (k: string) => p.blocks.find((b) => b.id === k)!.rect;
    expect(r('mac').y).toBeLessThan(r('stats').y);
    expect(r('rxq').y).toBeLessThan(r('txq').y);
    expect(r('rxq').x).toBe(r('txq').x);
  });

  it('routes every wire with at least two points, between the blocks it names', () => {
    for (const v of VISUALS) {
      const p = nicPlan(v, EDGE), ids = new Set(p.blocks.map((b) => b.id));
      expect(p.links.length, v).toBeGreaterThanOrEqual(13);
      for (const l of p.links) {
        expect(l.pts.length, `${v} ${l.id}`).toBeGreaterThanOrEqual(2);
        expect(ids.has(l.from), `${v} ${l.id} from ${l.from}`).toBe(true);
        expect(ids.has(l.to) || l.to === 'edge', `${v} ${l.id} to ${l.to}`).toBe(true);
      }
      expect(new Set(p.links.map((l) => l.id)).size, v).toBe(p.links.length);
    }
  });

  it('runs the host bus from the PCIe core to the middle of the gold fingers', () => {
    for (const v of VISUALS) {
      const p = nicPlan(v, EDGE), bus = p.links.find((l) => l.id === 'pcie-host')!, last = bus.pts[bus.pts.length - 1]!, pcie = p.blocks.find((b) => b.id === 'pcie')!.rect;
      expect(last[0], v).toBeCloseTo((EDGE.x0 + EDGE.x1) / 2, 3);
      expect(last[1], v).toBeLessThan(0);
      expect(bus.pts[0]![0], v).toBeGreaterThanOrEqual(pcie.x);
      expect(bus.pts[0]![0], v).toBeLessThanOrEqual(pcie.x + pcie.w);
      expect(bus.pts[0]![1], v).toBe(pcie.y);
    }
  });

  it('takes the lanes and the jacks of the 3D card', () => {
    for (const v of VISUALS) expect(nicInput(v).lanes, v).toBe(NIC_LANES[v]);
    expect(NIC_LINK['nic-40g']!.ports).toBe(2);
    expect(NIC_LINK['nic-gbe']!.ports).toBe(1);
    expect(nicInput('nic-unknown')).toBe(NIC_LINK['nic-gbe']);
    // the three cards are three different plans: each has its own chip, standard and queue ring
    expect(new Set(VISUALS.map((v) => NIC_LINK[v]!.chip)).size).toBe(3);
    expect(new Set(VISUALS.map((v) => NIC_LINK[v]!.std)).size).toBe(3);
    expect(NIC_LINK['nic-gbe']!.ring).toBeLessThan(NIC_LINK['nic-40g']!.ring);
  });
});

describe('the way a frame goes through the card', () => {
  const ids = (v: string, dir: 'rx' | 'tx') => nicRoute(nicPlan(v, EDGE), dir).map((h) => `${h.reverse ? '<' : ''}${h.link.id}`);

  it('comes in from the jack, through the magnetics, the PHY, the MAC and the receive queue, over the DMA engine to the host', () => {
    for (const v of VISUALS) expect(ids(v, 'rx'), v).toEqual(['jack-mag', 'mag-phy', 'phy-mac', 'mac-rxq', 'rxq-dma', 'dma-pcie', 'pcie-host']);
  });

  it('goes out the same way back, each wire run against its direction', () => {
    for (const v of VISUALS) expect(ids(v, 'tx'), v).toEqual(['<pcie-host', '<dma-pcie', '<txq-dma', '<mac-txq', '<phy-mac', '<mag-phy', '<jack-mag']);
  });

  it('lights the blocks it goes through, in order, and the two ways meet the same ends', () => {
    expect(BLOCKS.rx).toEqual([...BLOCKS.tx].reverse().map((b) => (b === 'txq' ? 'rxq' : b)));
    expect(BLOCKS.rx[0]).toBe('jack');
    expect(BLOCKS.rx[BLOCKS.rx.length - 1]).toBe('pcie');
  });
});
