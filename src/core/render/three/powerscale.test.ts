import { describe, expect, it } from 'vitest';
import { levelOf, POWER, powerGlsl, powerGradient, powerHex, WARN, wattsAt } from './powerscale';

describe('the power scale', () => {
  it('runs from a dark amber to a pale hot yellow, and each stop is its own colour', () => {
    expect(powerHex(0)).toBe(POWER[0]![1]);
    expect(powerHex(1)).toBe(POWER[POWER.length - 1]![1]);
    for (const [t, c] of POWER) expect(powerHex(t)).toBe(c);
    // (always warm: the red channel leads the blue one on all of it, and the warning is not on the scale)
    for (let i = 0; i <= 20; i++) expect(powerHex(i / 20) >> 16).toBeGreaterThan(powerHex(i / 20) & 255);
    expect(POWER.some(([, c]) => c === WARN)).toBe(false);
  });

  it('clamps outside 0 and 1, and every place is a colour', () => {
    expect(powerHex(-2)).toBe(powerHex(0));
    expect(powerHex(9)).toBe(powerHex(1));
    for (let i = 0; i <= 100; i++) { const c = powerHex(i / 100); expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(0xffffff); }
  });

  it('maps a draw to a place by a square root and back: a few watts still show beside a hundred', () => {
    expect(levelOf(0, 250)).toBe(0);
    expect(levelOf(-3, 250)).toBe(0);
    expect(levelOf(10, 0)).toBe(0);
    expect(levelOf(250, 250)).toBe(1);
    expect(levelOf(900, 250)).toBe(1);
    expect(levelOf(4, 250)).toBeGreaterThan(0.1);
    expect(levelOf(100, 250)).toBeGreaterThan(levelOf(4, 250));
    for (const w of [2, 13, 54, 150]) expect(wattsAt(levelOf(w, 250), 250)).toBeCloseTo(w, 6);
  });

  it('writes the scale as a GLSL function with every stop and as a CSS gradient', () => {
    const g = powerGlsl();
    expect(g).toContain('vec3 power(float h)');
    expect(g).toContain('vec3 warn()');
    expect(g.match(/return/g)!.length).toBe(POWER.length + 1);
    expect(powerGradient()).toMatch(/^linear-gradient\(to right, #7a4a10 0%.*#ffe58a 100%\)$/);
  });
});
