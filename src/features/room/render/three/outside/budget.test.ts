import { describe, expect, it } from 'vitest';
import { cityBudget } from './budget';

describe('cityBudget', () => {
  it('High keeps the city as it is today', () => {
    expect(cityBudget(false)).toEqual({ every: 3, scale: 1, glow: true, mirror: true });
  });
  it('Low draws a quarter of the pixels, half as often, with no glow and no room in the glass', () => {
    expect(cityBudget(true)).toEqual({ every: 6, scale: 0.5, glow: false, mirror: false });
  });
});
