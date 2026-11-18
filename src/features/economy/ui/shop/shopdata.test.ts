import { describe, expect, it } from 'vitest';
import { ladderFor } from './picker';
import { currentSpecFor, galleryGroups, KIND_ICON, kindIcon, kindLabel, priceOf, SHOP_ORDER, shopFor, splitName, STUDIO_KINDS } from './shopdata';
import { snap } from '@/core/ui/testdata';

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

describe('the gallery', () => {
  it('splits a part name from the detail in its brackets', () => {
    expect(splitName('Tiny-5F+I (front end: I-cache, 2-bit predictor)')).toEqual({ title: 'Tiny-5F+I', detail: 'front end: I-cache, 2-bit predictor' });
    expect(splitName('Liquid loop')).toEqual({ title: 'Liquid loop', detail: '' });
    expect(splitName('Tiny (a (b))')).toEqual({ title: 'Tiny', detail: 'a (b)' });
  });

  it('lists the studio categories in order, every part with its tier and a price', () => {
    const groups = galleryGroups();
    expect(groups.map((g) => g.kind)).toEqual(STUDIO_KINDS.filter((k) => groups.some((g) => g.kind === k)));
    for (const g of groups) {
      for (const i of g.items) {
        expect(Number.isInteger(i.tier) && i.tier >= 0, `${i.id} tier`).toBe(true);
        expect(priceOf(i.id), `${i.id} price`).not.toBeNull();
      }
    }
  });
});
