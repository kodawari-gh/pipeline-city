import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// Text needs a canvas, which the tests do not have: labels are empty containers here (as in art.test.ts).
vi.mock('../ink', async (orig) => ({ ...(await orig<typeof import('../ink')>()), label: () => new Container() }));
// gradient fills draw on a canvas, which the tests do not have
vi.mock('pixi.js', async (orig) => ({ ...(await orig<typeof import('pixi.js')>()), FillGradient: class { constructor(public o?: unknown) {} } }));

import { specsOfKind, type CoolerSpec } from '../../sim/board/specs';
import { coolerArt, coolerKitArt, radiatorArt, radiatorPorts } from './cooler';
import { COOLER, RADIATOR, TOP_FANS, TOP_FAN_LEN, TOP_FAN_T, setLayoutTier } from './layout';
import type { Theme } from '../theme';

const DARK: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const LIGHT: Theme = { ...DARK, dark: false, bg: '#eaeff6', board: '#9ccdbd', ink: '#0f1830', mute: '#475372', line: '#9aabc8', tile: '#ffffff' };
const coolers = specsOfKind('cooler') as CoolerSpec[];

describe('cooler art', () => {
  it('every cooler draws in either theme, its fan turning on the plate or the frame it sits in', () => {
    expect(coolers.length).toBeGreaterThanOrEqual(3);
    setLayoutTier(3, 3);
    for (const spec of coolers) for (const T of [DARK, LIGHT]) {
      const p = coolerArt(T, spec);
      expect(p.root.children.length, spec.id).toBeGreaterThan(1);
      expect(p.fan, spec.id).toBeDefined();
      const f = p.fan!.position;
      expect(f.x, spec.id).toBeGreaterThan(COOLER.x);
      expect(f.x, spec.id).toBeLessThan(COOLER.x + COOLER.w);
      expect(f.y, spec.id).toBeGreaterThan(COOLER.y);
      expect(f.y, spec.id).toBeLessThan(COOLER.y + COOLER.h);
    }
  });

  it('the shop picture of a loop carries its radiator; the others are the cooler alone', () => {
    setLayoutTier(3, 3);
    for (const spec of coolers) {
      const kit = coolerKitArt(DARK, spec);
      expect(kit.children.length, spec.id).toBe(spec.visual === 'cooler-liquid' ? 3 : 1);
    }
  });
});

describe('the radiator', () => {
  it('stands in the first top fan\'s place, or in the same band on the Mini, clear of the 8-pin cable', () => {
    for (const tier of [0, 1, 2, 3]) {
      setLayoutTier(tier, tier);
      expect(RADIATOR.w, `tier ${tier}`).toBe(TOP_FAN_LEN);
      expect(RADIATOR.h, `tier ${tier}`).toBe(TOP_FAN_T);
      if (TOP_FANS.length) expect(RADIATOR, `tier ${tier}`).toEqual(TOP_FANS[0]);
      else expect(RADIATOR.x, 'the Mini').toBeLessThan(-2500);
    }
  });

  it('draws with a live fan, and its two ports are on the underside of its west end', () => {
    setLayoutTier(3, 3);
    for (const T of [DARK, LIGHT]) {
      const r = radiatorArt(T, RADIATOR);
      expect(r.root.children.length).toBeGreaterThan(0);
      expect(r.fan.offset).toBe(0);
    }
    const [a, b] = radiatorPorts(RADIATOR);
    expect(a[1]).toBeGreaterThan(RADIATOR.y + RADIATOR.h);
    expect(a[1]).toBe(b[1]);
    expect(b[0] - a[0]).toBeGreaterThan(60); // room for a tube each
    expect(b[0]).toBeLessThan(RADIATOR.x + 200);
  });
});
