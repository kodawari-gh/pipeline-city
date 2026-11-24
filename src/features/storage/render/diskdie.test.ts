import { describe, expect, it } from 'vitest';
import { ARCH } from './diskplan';
import { CTRL_DIE, NAND_DIE, PLATTER, ctrlDiePlan, nandDiePlan, platterPlan, type DieRect } from './diskdie';

const inside = (a: DieRect, b: DieRect): boolean =>
  a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.y + a.h <= b.y + b.h + 1e-6;
const meet = (a: DieRect, b: DieRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('the controller die of a flash drive', () => {
  for (const kind of ['ssd-sata', 'ssd-nvme'] as const) {
    it(`${kind}: an engine for each channel of its tier, every block in the die and clear of the others`, () => {
      const p = ctrlDiePlan(kind),
        die = { x: 0, y: 0, w: CTRL_DIE.w, h: CTRL_DIE.h };
      expect(p.blocks.filter((b) => b.kind === 'channel')).toHaveLength(ARCH[kind].channels);
      for (const b of p.blocks) {
        expect(inside(b.rect, die), b.id).toBe(true);
        for (const o of p.blocks) if (o !== b) expect(meet(b.rect, o.rect), `${b.id}/${o.id}`).toBe(false);
      }
      for (const l of p.links)
        for (const pt of l.pts) expect(inside({ x: pt[0], y: pt[1], w: 0, h: 0 }, die)).toBe(true);
    });
  }

  it('gives only the NVMe die its queues', () => {
    expect(ctrlDiePlan('ssd-nvme').blocks.some((b) => b.kind === 'queue')).toBe(true);
    expect(ctrlDiePlan('ssd-sata').blocks.some((b) => b.kind === 'queue')).toBe(false);
  });
});

describe('the NAND die', () => {
  it('has four planes and the periphery in each die, all inside it and clear of each other', () => {
    for (const n of [1, 4] as const) {
      const p = nandDiePlan(n);
      expect(p.tiles).toHaveLength(n);
      expect(p.w / p.h).toBeCloseTo(NAND_DIE.w / NAND_DIE.h, 5);
      for (const t of p.tiles) {
        expect(t.planes).toHaveLength(4);
        const parts = [...t.planes.map((q) => q.rect), ...t.periphery.map((q) => q.rect)];
        for (const a of parts) {
          expect(inside(a, t.rect), `${n}`).toBe(true);
          for (const b of parts) if (a !== b) expect(meet(a, b), `${n}`).toBe(false);
        }
        for (const q of t.planes)
          for (const sub of [q.array, q.decoder, q.buffer]) expect(inside(sub, q.rect)).toBe(true);
      }
    }
  });

  it('keeps the stacked dies apart', () => {
    const t = nandDiePlan(4).tiles;
    for (const a of t) for (const b of t) if (a !== b) expect(meet(a.rect, b.rect)).toBe(false);
  });
});

describe('the platter', () => {
  it('has its data band inside the disc and round the hub', () => {
    const p = platterPlan();
    expect(p.R).toBe(PLATTER.R);
    expect(p.band[1]).toBeLessThan(p.R);
    expect(p.band[0]).toBeGreaterThan(p.clamp);
    expect(p.clamp).toBeGreaterThan(p.hub);
  });
});
