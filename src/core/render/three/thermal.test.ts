import { describe, expect, it } from 'vitest';
import { heatOf, tempAt, THERMAL, thermalGlsl, thermalGradient, thermalHex } from './thermal';

describe('the thermal scale', () => {
  it('runs cold to hot: blue at the bottom, white-hot at the top, and each stop is its own colour', () => {
    expect(thermalHex(0)).toBe(THERMAL[0]![1]);
    expect(thermalHex(1)).toBe(THERMAL[THERMAL.length - 1]![1]);
    for (const [t, c] of THERMAL) expect(thermalHex(t)).toBe(c);
    // (the blue channel leads at the cold end, the red one at the hot end)
    expect(thermalHex(0) & 255).toBeGreaterThan(thermalHex(0) >> 16);
    expect(thermalHex(0.78) >> 16).toBeGreaterThan(thermalHex(0.78) & 255);
  });

  it('clamps outside 0 and 1, and every place is a colour', () => {
    expect(thermalHex(-3)).toBe(thermalHex(0));
    expect(thermalHex(4)).toBe(thermalHex(1));
    for (let i = 0; i <= 100; i++) {
      const c = thermalHex(i / 100);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('maps a temperature to a place and back, and bends the first kelvins up', () => {
    expect(heatOf(25, 25, 65)).toBe(0);
    expect(heatOf(65, 25, 65)).toBe(1);
    expect(heatOf(5, 25, 65)).toBe(0);
    expect(heatOf(90, 25, 65)).toBe(1);
    expect(heatOf(35, 25, 65)).toBeGreaterThan(0.25);
    for (const T of [27, 33, 45, 60]) expect(tempAt(heatOf(T, 25, 65), 25, 65)).toBeCloseTo(T, 6);
  });

  it('writes the scale as a GLSL function with every stop and as a CSS gradient', () => {
    const g = thermalGlsl();
    expect(g).toContain('vec3 thermal(float h)');
    expect(g.match(/return/g)!.length).toBe(THERMAL.length);
    expect(thermalGradient()).toMatch(/^linear-gradient\(to top, #2f6bff 0%.*#fff8e0 100%\)$/);
  });
});
