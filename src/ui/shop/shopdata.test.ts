import { describe, expect, it } from 'vitest';
import { ladderFor } from './picker';
import { currentSpecFor, KIND_ICON, kindIcon, kindLabel, SHOP_ORDER, shopFor } from './shopdata';
import { snap } from '../testdata';

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

  it('shows every tier of a kind once, and none is outgrown', () => {
    const all = ladderFor(snap(), 'cpu');
    expect(new Set(all.map((r) => r.specId)).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(1);
    expect(all.every((r) => r.state !== ('outclassed' as string))).toBe(true);
  });

  it('names the part fitted now, for the stat bars', () => {
    expect(currentSpecFor(snap(), 'board')).toBe('board0');
    expect(currentSpecFor(snap(), 'os')).toBeNull();
  });
});
