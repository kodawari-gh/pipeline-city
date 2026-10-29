import { describe, expect, it } from 'vitest';
import { cpuPlan } from './cpuplans';
import { splitPlan } from './coreplan';

describe('splitPlan', () => {
  it('is null for a single-core plan', () => {
    expect(splitPlan(cpuPlan({ arch: 'inorder', cacheLines: 8 }))).toBeNull();
  });

  it.each([{ arch: 'inorder', cores: 4 }, { arch: 'ooo', cores: 2 }] as const)('$arch x$cores: one plan per tile and the rest shared', (i) => {
    const plan = cpuPlan({ ...i, cacheLines: 8, l2Lines: 32 });
    const sp = splitPlan(plan)!;
    expect(sp.tiles).toHaveLength(i.cores);
    const total = sp.tiles.reduce((n, t) => n + t.plan.blocks.length, sp.shared.blocks.length);
    expect(total).toBe(plan.blocks.length);
    for (const [k, t] of sp.tiles.entries()) {
      expect(t.plan.cores).toBe(1);
      expect(t.plan.die).toEqual(plan.tiles![k]);
      expect(t.scale).toBeGreaterThan(0.2);
      expect(t.scale).toBeLessThanOrEqual(1);
      const ids = new Set(t.plan.blocks.map((b) => b.id));
      expect(ids.has('pc') && ids.has('fetch')).toBe(true);
      expect(t.plan.blocks.every((b) => b.core === undefined && !b.id.startsWith('c'))).toBe(true);
      // every link of a tile joins two blocks of it
      for (const l of t.plan.links) { expect(ids.has(l.from), l.id).toBe(true); expect(ids.has(l.to), l.id).toBe(true); }
      for (const b of t.plan.blocks) expect(b.rect.x >= t.rect.x - 1 && b.rect.y >= t.rect.y - 1 && b.rect.x + b.rect.w <= t.rect.x + t.rect.w + 1, b.id).toBe(true);
    }
    expect(sp.shared.blocks.some((b) => b.core !== undefined)).toBe(false);
    expect(sp.shared.blocks.some((b) => b.id === 'l2s')).toBe(true);
  });
});
