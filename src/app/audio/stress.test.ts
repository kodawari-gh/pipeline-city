import { describe, expect, it } from 'vitest';
import { STRESS_SCALE, stressAmount, stressTerms } from './stress';

describe('stressAmount', () => {
  it('is 0 for an empty or healthy snapshot', () => {
    expect(stressAmount({})).toBe(0);
    expect(stressAmount({ devices: [{ throttle: 1 }], power: { totalW: 10, budgetW: 100 } })).toBe(0);
  });

  it('takes the worst device throttle', () => {
    const s = { devices: [{ throttle: 1 }, { throttle: 0.9 }, { throttle: 0.95 }] };
    expect(stressTerms(s).throttle).toBeCloseTo(0.1 / STRESS_SCALE, 9);
    expect(stressAmount(s)).toBeCloseTo(0.1 / STRESS_SCALE, 9);
  });

  it('grows the VRM term past load ratio 1 and caps at 1', () => {
    expect(stressTerms({ board: { vrm: { loadRatio: 1 } } }).vrm).toBe(0);
    expect(stressTerms({ board: { vrm: { loadRatio: 1 + STRESS_SCALE / 2 } } }).vrm).toBeCloseTo(0.5, 9);
    expect(stressTerms({ board: { vrm: { loadRatio: 3 } } }).vrm).toBe(1);
  });

  it('scales the temperature between throttle and damage temperature', () => {
    const vrm = { tempC: 80, throttleC: 80, damageC: 100 };
    expect(stressTerms({ board: { vrm } }).temp).toBe(0);
    expect(stressTerms({ board: { vrm: { ...vrm, tempC: 82 } } }).temp).toBeCloseTo(0.1 / STRESS_SCALE, 9);
    expect(stressTerms({ board: { vrm: { ...vrm, tempC: 120 } } }).temp).toBe(1);
  });

  it('ignores a temperature range with damage not above throttle', () => {
    expect(stressTerms({ board: { vrm: { tempC: 95, throttleC: 90, damageC: 90 } } }).temp).toBe(0);
  });

  it('starts the power term at 90 percent of budget', () => {
    expect(stressTerms({ power: { totalW: 90, budgetW: 100 } }).power).toBe(0);
    expect(stressTerms({ power: { totalW: 90 + (100 * STRESS_SCALE) / 2, budgetW: 100 } }).power).toBeCloseTo(0.5, 9);
  });

  it('ignores power when the budget is zero', () => {
    expect(stressTerms({ power: { totalW: 500, budgetW: 0 } }).power).toBe(0);
  });

  it('returns the largest term as the amount', () => {
    const s = { devices: [{ throttle: 0.99 }], power: { totalW: 200, budgetW: 100 } };
    const t = stressTerms(s);
    expect(t.amount).toBe(Math.max(t.throttle, t.temp, t.vrm, t.power));
    expect(t.amount).toBe(1);
  });

  it('treats a non-finite field as missing', () => {
    expect(stressAmount({ devices: [{ throttle: Number.NaN }], power: { totalW: Infinity, budgetW: 100 } })).toBe(0);
  });
});
