import { describe, expect, it } from 'vitest';
import { ladderFor } from './picker';
import { currentSpecFor, KIND_ICON, kindIcon, kindLabel, SHOP_ORDER, shopFor } from './shopdata';
import { snap } from './testdata';

describe('the shop', () => {
  it('lists every category that has items, in build order, each with an icon and a label', () => {
    const sections = shopFor(snap());
    expect(sections.map((x) => x.kind)).toEqual(SHOP_ORDER.filter((k) => sections.some((x) => x.kind === k)));
    for (const sec of sections) {
      expect(sec.icon).toBe(KIND_ICON[sec.kind]);
      expect(sec.label).toBe(kindLabel(sec.kind));
      expect(sec.items.length).toBeGreaterThan(0);
    }
  });

  it('every kind the shelf can hold has its own icon', () => {
    const icons = SHOP_ORDER.map((k) => kindIcon(k));
    expect(new Set(icons).size).toBe(SHOP_ORDER.length);
    expect(kindIcon('something-new')).toBe('box');
  });

  it('keeps the tiers below the best owned part as outgrown, where the upgrade ladder leaves them out', () => {
    const s = snap();
    const all = ladderFor(s, 'cpu', true);
    const ladder = ladderFor(s, 'cpu');
    expect(all.length).toBeGreaterThanOrEqual(ladder.length);
    // the shop shows every tier of the kind once
    expect(new Set(all.map((r) => r.specId)).size).toBe(all.length);
    for (const r of all.filter((x) => x.state === 'outclassed')) expect(ladder.some((l) => l.specId === r.specId)).toBe(false);
  });

  it('names the part fitted now, for the stat bars', () => {
    expect(currentSpecFor(snap(), 'board')).toBe('board0');
    expect(currentSpecFor(snap(), 'os')).toBeNull();
  });
});
