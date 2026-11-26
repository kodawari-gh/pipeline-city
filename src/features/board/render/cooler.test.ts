import { describe, expect, it, vi } from 'vitest';
import { Text } from 'pixi.js';
import * as specs from '../sim/specs';
import { coolerArt, coolerKitArt, radiatorArt, radiatorFit, radiatorPorts, tubeRoutes } from './cooler';
import { radiatorSpan } from '../../room/render/desk/props/case';
import { CASE_IN, COOLER, setLayoutTier } from './layout/layout';
import type { Theme } from '@/core/render/theme';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

// Text needs a canvas, which the tests do not have: labels are empty Text objects here, never measured or drawn (as in art.test.ts).
vi.mock(import('@/core/render/ink'), async (orig) => ({
  ...(await orig()),
  label: () => new Text({ text: '' }),
}));
// gradient fills draw on a canvas, which the tests do not have: a gradient here fills with plain white
vi.mock(import('pixi.js'), async (orig) => {
  const actual = await orig();
  class FillGradient extends actual.FillGradient {
    override buildGradient(): void {
      this.texture = actual.Texture.WHITE;
    }
  }
  return { ...actual, FillGradient };
});

const DARK: Theme = {
  bg: '#04060f',
  board: '#081628',
  trace: '#1e4270',
  sub: '#0d1636',
  die: '#111b46',
  pin: '#d4af5f',
  tile: '#18245c',
  ink: '#e2eaff',
  mute: '#8a97c2',
  line: '#2a366a',
  dot: '#18214a',
  on: '#08102a',
  alu: '#3be3ff',
  mul: '#a68bff',
  ld: '#ffc247',
  st: '#6dffa6',
  br: '#ff55dc',
  bad: '#ff5a78',
};
const coolers = specs.specsOfKind('cooler') as specs.CoolerSpec[];

function assert_every_cooler_draws_its_fan_turning_on_the_plate_(): void {
  expect(coolers.length).toBeGreaterThanOrEqual(3);
  setLayoutTier(3, 3);
  for (const spec of coolers) {
    const p = coolerArt(DARK, spec);
    expect(p.root.children.length).toBeGreaterThan(1);
    expect(p.fan).toBeDefined();
    const f = must(p.fan).position;
    expect(f.x).toBeGreaterThan(COOLER.x);
    expect(f.x).toBeLessThan(COOLER.x + COOLER.w);
    expect(f.y).toBeGreaterThan(COOLER.y);
    expect(f.y).toBeLessThan(COOLER.y + COOLER.h);
  }
}

function assert_the_shop_picture_of_a_loop_carries_its_radiator_(): void {
  setLayoutTier(3, 3);
  for (const spec of coolers) {
    const kit = coolerKitArt(DARK, spec);
    expect(kit.children).toHaveLength(spec.visual === 'cooler-liquid' ? 4 : 1); // the radiator, its two fans, the pump
  }
}

/** What a radiator can span in the case now: the front and the top (the rear takes none), each as one mount. */
const spans = () =>
  (['front', 'top'] as const)
    .map((s) => radiatorSpan(s))
    .filter((m): m is NonNullable<ReturnType<typeof radiatorSpan>> => Boolean(m));

function assert_bolts_along_the_front_or_the_top_of_any_case_wit(): void {
  for (const tier of [0, 1, 2, 3]) {
    setLayoutTier(tier, tier);
    for (const m of spans()) {
      for (const grade of [1, 2, 3] as const) {
        const r = radiatorArt(DARK, radiatorFit(m, 0), grade, m.ids.length);
        expect(r.root.children.length, `${tier} ${m.id}`).toBeGreaterThan(0);
        expect(r.fans).toHaveLength(m.ids.length);
        for (const f of r.fans) {
          expect(f.offset).toBe(0);
        }
      }
    }
  }
}

function assert_its_two_ports_are_on_the_inboard_face_of_the_mou(): void {
  setLayoutTier(3, 3);
  for (const m of spans()) {
    const f = radiatorFit(m, 0),
      { tips, inward } = radiatorPorts(f),
      [a, b] = tips,
      r = m.rect;
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(60); // room for a tube each
    const c: [number, number] = [r.x + r.w / 2, r.y + r.h / 2];
    for (const p of tips) {
      expect((p[0] - c[0]) * inward[0] + (p[1] - c[1]) * inward[1]).toBeGreaterThan(0);
    } // on the inboard side of the slab's middle
  }
  const top = must(radiatorSpan('top')),
    f = radiatorFit(top, 0),
    [a] = radiatorPorts(f).tips,
    r = top.rect;
  expect(a[1]).toBeGreaterThan(r.y + r.h); // the underside
  expect(f.end).toBe(Math.abs(0 - r.x) <= Math.abs(0 - (r.x + r.w)) ? 'start' : 'end');
}

function assert_the_tubes_run_from_the_pump_to_the_ports_of_ever(): void {
  setLayoutTier(3, 3);
  const a: [number, number] = [COOLER.x + COOLER.w / 2 - 120, COOLER.y + 170],
    b: [number, number] = [COOLER.x + COOLER.w / 2 + 120, COOLER.y + 170];
  for (const m of spans()) {
    const [t1, t2] = tubeRoutes(radiatorFit(m, 0), a, b);
    for (const route of [t1, t2]) {
      expect(route.length).toBeGreaterThanOrEqual(2);
      expect([a, b]).toContainEqual(route[0]);
      for (const p of route) {
        expect(p[0]).toBeGreaterThan(CASE_IN.x - 400);
        expect(p[0]).toBeLessThan(CASE_IN.x + CASE_IN.w + 400);
      }
    }
  }
}

describe('cooler art', () => {
  it('every cooler draws, its fan turning on the plate or the frame it sits in', () => {
    expect.hasAssertions();
    assert_every_cooler_draws_its_fan_turning_on_the_plate_();
  });

  it('the shop picture of a loop carries its radiator; the others are the cooler alone', () => {
    expect.hasAssertions();
    assert_the_shop_picture_of_a_loop_carries_its_radiator_();
  });
});

describe('the radiator', () => {
  it('bolts along the front or the top of any case, with a live fan for every mount it spans', () => {
    expect.hasAssertions();
    assert_bolts_along_the_front_or_the_top_of_any_case_wit();
  });

  it('spans every fan of its side, and the rear has no radiator', () => {
    setLayoutTier(3, 3);
    const top = must(radiatorSpan('top')),
      front = must(radiatorSpan('front'));
    expect(top.ids).toStrictEqual(['top0', 'top1']);
    expect(front.ids).toStrictEqual(['front0', 'front1', 'front2']);
    expect(top.rect.w).toBeGreaterThan(top.rect.h);
    expect(front.rect.h).toBeGreaterThan(front.rect.w);
    setLayoutTier(0, 0);
    expect(radiatorSpan('top')).toBeNull(); // the Mini tower has no top fans
  });

  it('its two ports are on the inboard face of the mount, side by side, in the tank nearer the pump', () => {
    expect.hasAssertions();
    assert_its_two_ports_are_on_the_inboard_face_of_the_mou();
  });

  it('the tubes run from the pump to the ports of every mount without leaving the case', () => {
    expect.hasAssertions();
    assert_the_tubes_run_from_the_pump_to_the_ports_of_ever();
  });
});
