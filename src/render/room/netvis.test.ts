import { describe, expect, it } from 'vitest';
import { netPropsVisible, type NetVisInput } from './netvis';

const none: NetVisInput = { level: 1, hasRouter: false, hasIsp: false, routerInInventory: false, lanConnected: false };

describe('netPropsVisible', () => {
  it('hides the router spot and wall plate before the network unlocks', () => {
    expect(netPropsVisible(none)).toBe(false);
    expect(netPropsVisible({ ...none, level: 3 })).toBe(false);
  });
  it('shows them at the unlock level with nothing owned, so the router and plan can be bought', () => {
    expect(netPropsVisible({ ...none, level: 4 })).toBe(true);
    expect(netPropsVisible({ ...none, level: 9 })).toBe(true);
  });
  it('shows them as soon as any network part exists', () => {
    expect(netPropsVisible({ ...none, hasRouter: true })).toBe(true);
    expect(netPropsVisible({ ...none, hasIsp: true })).toBe(true);
    expect(netPropsVisible({ ...none, routerInInventory: true })).toBe(true);
    expect(netPropsVisible({ ...none, lanConnected: true })).toBe(true);
  });
});
