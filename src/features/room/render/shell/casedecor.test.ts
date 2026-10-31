import { describe, expect, it } from 'vitest';
import { rng } from './casedecor';

describe('case decoration', () => {
  it('draws the same numbers for the same seed, different ones for another', () => {
    const a = rng(9), b = rng(9), c = rng(10);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    expect(xs.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});
