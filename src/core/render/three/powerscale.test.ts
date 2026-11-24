import { describe, expect, it } from 'vitest';
import {
  HUB,
  hubHex,
  levelOf,
  POWER,
  POWER_LIFT,
  POWER_VEIL,
  powerGlsl,
  powerGradient,
  powerHex,
  ROLE_HEX,
  roleScaleHex,
  SOURCE,
  sourceHex,
  WARN,
  wattsAt,
} from './powerscale';

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
    for (let i = 0; i <= 100; i++) {
      const c = powerHex(i / 100);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
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
    // (a use, a hub and a source are a function each, and the warning)
    expect(g.match(/return/g)!.length).toBe(POWER.length + HUB.length + SOURCE.length + 1);
    expect(powerGradient()).toMatch(/^linear-gradient\(to right, #7a4a10 0%.*#ffe58a 100%\)$/);
  });

  it('gives each role its own colour family: a source white, a hub cyan, a use amber', () => {
    const r = (c: number) => c >> 16,
      g = (c: number) => (c >> 8) & 255,
      b = (c: number) => c & 255;
    for (const h of [0.3, 0.62, 1]) {
      // (a hub is blue over red, a use is red over blue, a source is near white: its channels stay close)
      expect(b(hubHex(h))).toBeGreaterThan(r(hubHex(h)));
      expect(r(powerHex(h))).toBeGreaterThan(b(powerHex(h)));
    }
    expect(r(sourceHex(1)) - b(sourceHex(1))).toBeLessThan(24);
    expect(hubHex(0)).toBe(HUB[0]![1]);
    expect(hubHex(1)).toBe(HUB[HUB.length - 1]![1]);
    expect(sourceHex(1)).toBe(SOURCE[SOURCE.length - 1]![1]);
    for (const role of ['source', 'hub', 'use'] as const)
      expect(roleScaleHex(role, 0.5)).toBe({ source: sourceHex, hub: hubHex, use: powerHex }[role](0.5));
    // (the chips of the legend are each role's colour, all different)
    expect(new Set(Object.values(ROLE_HEX)).size).toBe(3);
  });

  it('lifts a power part by what the veil takes: the part reads under it as it did under the first veil', () => {
    const mean = (POWER_VEIL[0] + POWER_VEIL[1] + POWER_VEIL[2]) / 3;
    expect(POWER_LIFT * mean).toBeCloseTo(0.155, 6);
    // (a lens for the power parts alone: everything else goes about half as dark as the first veil's 0.155, and darker than 0.1)
    expect(mean).toBeLessThan(0.1);
    for (const c of POWER_VEIL) expect(c).toBeGreaterThan(0);
  });
});
