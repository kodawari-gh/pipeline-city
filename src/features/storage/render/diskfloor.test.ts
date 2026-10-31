import { describe, expect, it } from 'vitest';
import { diskPlan } from './diskfloor';
import { ARCH } from './diskplan';

type R = { x: number; y: number; w: number; h: number };
const inside = (r: R, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 1e-6 && r.y + r.h <= h + 1e-6;
const overlap = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('the floorplan of a drive', () => {
  for (const kind of ['hdd', 'ssd-sata', 'ssd-nvme'] as const) {
    it(`${kind}: every block is inside the body and no two blocks overlap`, () => {
      const p = diskPlan(kind, 520, 340, 64);
      for (const b of p.blocks) expect(inside(b.rect, 520, 340), b.id).toBe(true);
      for (let i = 0; i < p.blocks.length; i++) for (let j = i + 1; j < p.blocks.length; j++) expect(overlap(p.blocks[i]!.rect, p.blocks[j]!.rect), `${p.blocks[i]!.id} ${p.blocks[j]!.id}`).toBe(false);
    });

    it(`${kind}: every link joins two blocks with orthogonal legs, and ends on its target`, () => {
      const p = diskPlan(kind, 520, 340, 64);
      const by = new Map(p.blocks.map((b) => [b.id, b.rect]));
      const touches = (pt: [number, number], r: R) => pt[0] >= r.x - 1e-6 && pt[0] <= r.x + r.w + 1e-6 && pt[1] >= r.y - 1e-6 && pt[1] <= r.y + r.h + 1e-6;
      for (const l of p.links) {
        expect(by.has(l.from), l.id).toBe(true);
        expect(by.has(l.to), l.id).toBe(true);
        expect(l.pts.length).toBeGreaterThanOrEqual(2);
        for (let i = 1; i < l.pts.length; i++) expect(l.pts[i]![0] === l.pts[i - 1]![0] || l.pts[i]![1] === l.pts[i - 1]![1], `${l.id} is orthogonal`).toBe(true);
        // the stub of a channel's second die starts on the rail, so its far end is the one that must touch
        expect(touches(l.pts[l.pts.length - 1]!, by.get(l.to)!), l.id).toBe(true);
      }
    });
  }

  it('the hard disk has a platter and an arm and no dies; the flash drives have dies that hold every cell once', () => {
    const h = diskPlan('hdd', 640, 440, 48);
    expect(h.platter!.tracks * h.platter!.sectors).toBeGreaterThanOrEqual(48);
    expect(h.arm!.len).toBeGreaterThan(h.platter!.R);
    expect(h.dies).toHaveLength(0);
    for (const kind of ['ssd-sata', 'ssd-nvme'] as const) {
      const p = diskPlan(kind, 520, 340, 64);
      expect(p.dies).toHaveLength(ARCH[kind].dies);
      expect(p.dies.reduce((n, d) => n + d.slice.count, 0)).toBe(64);
      expect(p.platter).toBeUndefined();
    }
  });

  it('the NVMe has four channel rails, a queue block and a wider host link than the SATA SSD', () => {
    const n = diskPlan('ssd-nvme', 1000, 300, 64), s = diskPlan('ssd-sata', 520, 340, 32);
    expect(n.links.filter((l) => l.kind === 'channel' && !l.id.endsWith('b'))).toHaveLength(4);
    expect(n.blocks.some((b) => b.kind === 'queue')).toBe(true);
    expect(s.blocks.some((b) => b.kind === 'queue')).toBe(false);
    expect(n.links.find((l) => l.id === 'iface-ctrl')!.lanes).toBeGreaterThan(s.links.find((l) => l.id === 'iface-ctrl')!.lanes);
    expect(s.links.filter((l) => l.kind === 'channel')).toHaveLength(4); // one shared channel, a stub into each die
  });
});
