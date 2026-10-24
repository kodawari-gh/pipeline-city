import { describe, expect, it } from 'vitest';
import type { PurchaseSnap, SlotSnap } from '../sim/game/game';
import { nextUpgrade, pickerFor } from './picker';
import { dev, EMPTY_SLOTS, snap } from './testdata';

// Heatsink rows (docs/UI.md, "Heatsink rows"): "Nothing better to buy right now" only when the fitted part is the top
// tier; a higher tier gets its own line with its cost, and the bars compare with it.

const buy = (id: string, price: number, o: Partial<PurchaseSnap> = {}): PurchaseSnap => ({
  id, name: id, kind: 'vrm-sink', price, affordable: false, ...o,
});
const SINK_SLOT: SlotSnap = { id: 'vrm-sink0', type: 'vrm-sink', deviceId: null };
const FITTED: SlotSnap = { id: 'vrm-sink0', type: 'vrm-sink', deviceId: 'sink1' };
const fitted = (spec: string) => dev({ id: 'sink1', spec, kind: 'vrm-sink', name: spec, slot: 'vrm-sink0' });
const crate = (spec: string) => ({ id: 'inv9', spec, kind: 'vrm-sink' as const, name: spec, freeSlots: ['vrm-sink0'], swapSlots: [], installable: true });

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
