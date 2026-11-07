import { describe, expect, it } from 'vitest';
import type { PurchaseSnap, SlotSnap } from '@/worker/game/game';
import { ladderFor, nextUpgrade, pickerFor } from './picker';
import { dev, EMPTY_SLOTS, snap } from '@/core/ui/testdata';

// Heatsink rows (docs/UI.md, "Heatsink rows"): "Nothing better to buy right now" only when the fitted part is the top
// tier; a higher tier gets its own line with its cost, and the bars compare with it.

const buy = (id: string, price: number, o: Partial<PurchaseSnap> = {}): PurchaseSnap => ({
  id, name: id, kind: 'vrm-sink', price, affordable: false, ...o,
});
const SINK_SLOT: SlotSnap = { id: 'vrm-sink0', type: 'vrm-sink', deviceId: null };
const FITTED: SlotSnap = { id: 'vrm-sink0', type: 'vrm-sink', deviceId: 'sink1' };
const fitted = (spec: string) => dev({ id: 'sink1', spec, kind: 'vrm-sink', name: spec, slot: 'vrm-sink0' });
const crate = (spec: string) => ({ id: 'inv9', spec, kind: 'vrm-sink' as const, name: spec, freeSlots: ['vrm-sink0'], swapSlots: [], installable: true });

describe('fan spots offer their own size', () => {
  const fan = (id: string, tier = 0) => ({ id, name: id, kind: 'fan' as const, price: 10 + tier, affordable: true });
  const ALL = ['fan40', 'fan92', 'fan92x', 'fan120', 'fan120x', 'fan140', 'fan140x'].map((id) => fan(id, id.endsWith('x') ? 1 : 0));
  const ids = (m: { ladder: { specId: string }[] }) => m.ladder.map((r) => r.specId);

  it('an empty spot names its size and sells that size only', () => {
    const s = snap({ slots: [{ id: 'front0', type: 'fan', deviceId: null, size: 120 }], purchases: ALL });
    const m = pickerFor('front0', s)!;
    expect(m.title).toBe('120 mm fan spot');
    expect(ids(m).sort()).toEqual(['fan120', 'fan120x']);
    expect(m.lines.some((l) => l.text.includes('120 mm'))).toBe(true);
    expect(m.device).toBeUndefined();
  });

  it('a fitted fan offers the high-airflow fan of its size, not the next size up', () => {
    const s = snap({
      slots: [{ id: 'front0', type: 'fan', deviceId: 'f1', size: 92 }],
      devices: [dev({ id: 'f1', spec: 'fan92', kind: 'fan', name: 'fan92', slot: 'front0' })],
      purchases: ALL,
    });
    const m = pickerFor('front0', s)!;
    expect(ids(m).sort()).toEqual(['fan92', 'fan92x']);
    expect(nextUpgrade(m.ladder)?.specId).toBe('fan92x');
    expect(m.actions.some((a) => a.id === 'uninstall' && a.deviceId === 'f1')).toBe(true);
  });

  it('a spare fan in the inventory compares its own size', () => {
    const s = snap({ inventory: [{ id: 'inv7', spec: 'fan140', kind: 'fan', name: 'fan140', freeSlots: [], swapSlots: [], installable: false }], purchases: ALL });
    expect(ids(pickerFor('inv:inv7', s)!).sort()).toEqual(['fan140', 'fan140x']);
  });

  it('a heatsink with a free fan spot and no fan says a fan fits; with a fan it stays quiet', () => {
    const cooler = dev({ id: 'c1', spec: 'cooler1', kind: 'cooler', name: 'cooler1', slot: 'cooler0' });
    const says = (fitted: string | null) => pickerFor('cooler0', snap({
      slots: [{ id: 'cooler0', type: 'cooler', deviceId: 'c1' }, { id: 'cooler0.fan0', type: 'fan', deviceId: fitted, size: 120 }, { id: 'cooler0.fan1', type: 'fan', deviceId: null, size: 120 }],
      devices: [cooler],
    }))!.lines.some((l) => l.text.includes('A 120 mm fan fits'));
    expect(says(null)).toBe(true);
    expect(says('f1')).toBe(false);
  });
});

describe('next tier on the heatsink rows', () => {
  it('a higher tier that is not bought yet is "Later", with its name and no "nothing better" line', () => {
    const s = snap({
      slots: [...EMPTY_SLOTS.filter((x) => x.id !== 'vrm-sink0'), FITTED],
      devices: [fitted('vsink0')],
      purchases: [buy('vsink0', 30), buy('vsink1', 70, { later: true, description: 'Not available yet' }), buy('vsink2', 140, { later: true })],
    });
    const m = pickerFor('vrm-sink0', s)!;
    expect(m.emptyText).toBeUndefined();
    expect(nextUpgrade(m.ladder)?.specId).toBe('vsink1');
    expect(m.ladder.find((r) => r.specId === 'vsink1')!.state).toBe('level');
  });

  it('a higher tier in the inventory (a spare) is the next tier, not "nothing better"', () => {
    const s = snap({
      slots: [...EMPTY_SLOTS.filter((x) => x.id !== 'vrm-sink0'), FITTED],
      devices: [fitted('vsink0')],
      inventory: [crate('vsink2')],
      purchases: [buy('vsink0', 30), buy('vsink1', 70), buy('vsink2', 140)],
    });
    const m = pickerFor('vrm-sink0', s)!;
    expect(m.emptyText).toBeUndefined();
    expect(nextUpgrade(m.ladder)).toMatchObject({ specId: 'vsink2', state: 'crate' });
  });

  it('the top tier fitted: the line says there is nothing better', () => {
    const s = snap({
      slots: [...EMPTY_SLOTS.filter((x) => x.id !== 'vrm-sink0'), FITTED],
      devices: [fitted('vsink2')],
      purchases: [buy('vsink0', 30), buy('vsink1', 70), buy('vsink2', 140)],
    });
    const m = pickerFor('vrm-sink0', s)!;
    expect(m.emptyText).toBe('Nothing better to buy right now.');
    expect(nextUpgrade(m.ladder)).toBeUndefined();
  });

  it('an empty socket has every tier as "up" (no "nothing better")', () => {
    const s = snap({ slots: [...EMPTY_SLOTS, SINK_SLOT], purchases: [buy('vsink0', 30), buy('vsink1', 70)] });
    const m = pickerFor('vrm-sink0', s)!;
    expect(m.emptyText).toBeUndefined();
    expect(nextUpgrade(m.ladder)?.specId).toBe('vsink0');
  });
});

describe('the operating system tiles and the installed memory', () => {
  const osBuy = (id: string): PurchaseSnap => ({ id, name: id, kind: 'os' as PurchaseSnap['kind'], price: 100, affordable: true });
  const ram = (spec: string) => dev({ id: 'm1', spec, kind: 'ram', name: spec, slot: 'dimm0' });

  it('an OS that needs more memory than is fitted carries a warning with the numbers', () => {
    const s = snap({ devices: [ram('ram0')], purchases: [osBuy('os1')] });
    const warn = ladderFor(s, 'os').find((r) => r.specId === 'os1')?.warn;
    expect(warn).toMatch(/needs 32K of memory, you have 16K/);
  });

  it('no warning once enough memory is fitted', () => {
    const s = snap({ devices: [ram('ram1')], purchases: [osBuy('os1')] });
    expect(ladderFor(s, 'os').find((r) => r.specId === 'os1')?.warn).toBeUndefined();
  });
});
