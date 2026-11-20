import { describe, expect, it } from 'vitest';
import { ladderFor } from './picker';
import { artStillIds, currentSpecFor, galleryGroups, hasModel, KIND_ICON, kindIcon, kindLabel, priceOf, railLabel, SHOP_ORDER, shopFor, splitName, stillIds, STUDIO_KINDS } from './shopdata';
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

  it('gives each rail button a short label of its own, and the full one stays in the heading', () => {
    const short = SHOP_ORDER.map((k) => railLabel(k));
    expect(new Set(short).size).toBe(SHOP_ORDER.length);
    for (const s of short) { expect(s.length).toBeLessThanOrEqual(9); expect(s).not.toMatch(/\s{2,}/); }
    expect(railLabel('cpu')).toBe('Processor');
    expect(railLabel('psu')).toBe('Power');
    expect(railLabel('something-new')).toBe('something-new');
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

  it('ends with the four routers, which have a 3D model of their own (an OS and an internet plan have none)', () => {
    const groups = galleryGroups(), last = groups[groups.length - 1]!;
    expect(last.kind).toBe('router');
    expect(last.items.map((i) => i.id)).toEqual(['router1', 'router2', 'router3', 'router4']);
    expect(STUDIO_KINDS[STUDIO_KINDS.length - 1]).toBe('router');
    expect(hasModel('router')).toBe(true);
    for (const k of ['os', 'isp', null]) expect(hasModel(k), String(k)).toBe(false);
  });

  it('bakes a still for each router, with its model, and for each internet plan, with its drawn picture', () => {
    expect(artStillIds()).toEqual(['isp1', 'isp2', 'isp3', 'isp4', 'isp5']);
    const all = stillIds();
    for (const id of ['router1', 'router2', 'router3', 'router4', ...artStillIds()]) expect(all, id).toContain(id);
    expect(new Set(all).size).toBe(all.length);
    // (a router's picture is the model's, so it is not one of the drawn ones)
    expect(artStillIds().some((id) => id.startsWith('router'))).toBe(false);
  });
});
