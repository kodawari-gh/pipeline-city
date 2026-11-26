import { assert, describe, expect, it } from 'vitest';
import { diskPlan } from './diskfloor';
import { ARCH } from './diskplan';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

interface R {
  x: number;
  y: number;
  w: number;
  h: number;
}
const inside = (r: R, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 1e-6 && r.y + r.h <= h + 1e-6;
const overlap = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A point on or in `r`, within rounding. */
const touches = (pt: [number, number], r: R) =>
  pt[0] >= r.x - 1e-6 && pt[0] <= r.x + r.w + 1e-6 && pt[1] >= r.y - 1e-6 && pt[1] <= r.y + r.h + 1e-6;
/** A leg from `a` to `b` runs straight across or straight down. */
const orthogonal = (a: [number, number], b: [number, number]): boolean => a[0] === b[0] || a[1] === b[1];
const isDieRail = (l: { kind: string; id: string }): boolean => l.kind === 'channel' && !l.id.endsWith('b');
const KINDS = ['hdd', 'ssd-sata', 'ssd-nvme'] as const;

describe('the floorplan of a drive', () => {
  it.each(KINDS)('%s: every block is inside the body and no two blocks overlap', (kind) => {
    const p = diskPlan(kind, 520, 340, 64);
    for (const b of p.blocks) {
      expect(inside(b.rect, 520, 340), `for ${b.id}`).toBe(true);
    }
    for (let i = 0; i < p.blocks.length; i++) {
      for (let j = i + 1; j < p.blocks.length; j++) {
        const a = must(p.blocks[i]),
          b = must(p.blocks[j]);
        expect(overlap(a.rect, b.rect), `${a.id} ${b.id}`).toBe(false);
      }
    }
  });

  it.each(KINDS)('%s: every link joins two blocks with orthogonal legs, and ends on its target', (kind) => {
    const p = diskPlan(kind, 520, 340, 64);
    const by = new Map(p.blocks.map((b) => [b.id, b.rect]));
    for (const l of p.links) {
      expect(by.has(l.from), `for ${l.id}`).toBe(true);
      expect(by.has(l.to), `for ${l.id}`).toBe(true);
      expect(l.pts.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < l.pts.length; i++) {
        expect(orthogonal(must(l.pts[i - 1]), must(l.pts[i])), `${l.id} is orthogonal`).toBe(true);
      }
      // the stub of a channel's second die starts on the rail, so its far end is the one that must touch
      const lastPts = l.pts.at(-1);
      assert.exists(lastPts);
      const byValue = by.get(l.to);
      assert.exists(byValue);
      expect(touches(lastPts, byValue), `for ${l.id}`).toBe(true);
    }
  });

  it('the hard disk has a platter and an arm and no dies; the flash drives have dies that hold every cell once', () => {
    const h = diskPlan('hdd', 640, 440, 48);
    assert.exists(h.platter);
    expect(h.platter.tracks * h.platter.sectors).toBeGreaterThanOrEqual(48);
    assert.exists(h.arm);
    expect(h.arm.len).toBeGreaterThan(h.platter.R);
    expect(h.dies).toHaveLength(0);
    for (const kind of ['ssd-sata', 'ssd-nvme'] as const) {
      const p = diskPlan(kind, 520, 340, 64);
      expect(p.dies).toHaveLength(ARCH[kind].dies);
      expect(p.dies.reduce((n, d) => n + d.slice.count, 0)).toBe(64);
      expect(p.platter).toBeUndefined();
    }
  });

  it('the NVMe has four channel rails, a queue block and a wider host link than the SATA SSD', () => {
    const n = diskPlan('ssd-nvme', 1000, 300, 64),
      s = diskPlan('ssd-sata', 520, 340, 32);
    expect(n.links.filter(isDieRail)).toHaveLength(4);
    expect(n.blocks.some((b) => b.kind === 'queue')).toBe(true);
    expect(s.blocks.some((b) => b.kind === 'queue')).toBe(false);
    const ifaceCtrlLink = n.links.find((l) => l.id === 'iface-ctrl');
    assert.exists(ifaceCtrlLink);
    expect(ifaceCtrlLink.lanes).toBeGreaterThan(must(s.links.find((l) => l.id === 'iface-ctrl')).lanes);
    expect(s.links.filter((l) => l.kind === 'channel')).toHaveLength(4); // one shared channel, a stub into each die
  });
});
