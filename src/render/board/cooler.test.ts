import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// Text needs a canvas, which the tests do not have: labels are empty containers here (as in art.test.ts).
vi.mock('../ink', async (orig) => ({ ...(await orig<typeof import('../ink')>()), label: () => new Container() }));
// gradient fills draw on a canvas, which the tests do not have
vi.mock('pixi.js', async (orig) => ({ ...(await orig<typeof import('pixi.js')>()), FillGradient: class { constructor(public o?: unknown) {} } }));

import { specsOfKind, type CoolerSpec } from '../../sim/board/specs';
import { coolerArt, coolerKitArt, radiatorArt, radiatorFit, radiatorPorts, tubeRoutes } from './cooler';
import { fanMounts } from '../room/case';
import { CASE_IN, COOLER, setLayoutTier } from './layout';
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
  it('bolts on any fan mount of any case, in either theme, with a live fan', () => {
    for (const tier of [0, 1, 2, 3]) {
      setLayoutTier(tier, tier);
      for (const m of fanMounts()) for (const T of [DARK, LIGHT]) for (const grade of [1, 2, 3] as const) {
        const r = radiatorArt(T, radiatorFit(m, 0), grade);
        expect(r.root.children.length, `${tier} ${m.id}`).toBeGreaterThan(0);
        expect(r.fan.offset).toBe(0);
      }
    }
  });

  it('its two ports are on the inboard face of the mount, side by side, in the tank nearer the pump', () => {
    setLayoutTier(3, 3);
    for (const m of fanMounts()) {
      const f = radiatorFit(m, 0), { tips, inward } = radiatorPorts(f), [a, b] = tips, r = m.rect;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1]), m.id).toBeGreaterThan(60); // room for a tube each
      const c: [number, number] = [r.x + r.w / 2, r.y + r.h / 2];
      for (const p of tips) expect((p[0] - c[0]) * inward[0] + (p[1] - c[1]) * inward[1], m.id).toBeGreaterThan(0); // on the inboard side of the slab's middle
      if (m.side === 'top') {
        expect(a[1], m.id).toBeGreaterThan(r.y + r.h); // the underside
        expect(f.end, m.id).toBe(Math.abs(0 - r.x) <= Math.abs(0 - (r.x + r.w)) ? 'start' : 'end');
      }
    }
  });

  it('the tubes run from the pump to the ports of every mount without leaving the case', () => {
    setLayoutTier(3, 3);
    const a: [number, number] = [COOLER.x + COOLER.w / 2 - 120, COOLER.y + 170], b: [number, number] = [COOLER.x + COOLER.w / 2 + 120, COOLER.y + 170];
    for (const m of fanMounts()) {
      const [t1, t2] = tubeRoutes(radiatorFit(m, 0), a, b);
      for (const route of [t1, t2]) {
        expect(route.length, m.id).toBeGreaterThanOrEqual(2);
        expect([a, b], m.id).toContainEqual(route[0]);
        for (const p of route) {
          expect(p[0], m.id).toBeGreaterThan(CASE_IN.x - 400); expect(p[0], m.id).toBeLessThan(CASE_IN.x + CASE_IN.w + 400);
        }
      }
    }
  });
});
