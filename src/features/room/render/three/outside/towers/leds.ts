// A tower's lights in its own colour: its LED bands and corner strips, and its head in floodlights at night.
import { Color } from 'three';
import { rng, topOf } from '../plan';
import { headOf, inset, Kind, sized, Wide } from './basics';
import type { Mass } from './mass';
import type { Building, Rect, Tier } from './types';

/** The towers' LED bands: cyan, warm white, amber (the room's accent families), and how often each is picked. */
const LEDS = [0x4f_d6_ff, 0x4f_d6_ff, 0xff_d8_a6, 0xff_d8_a6, 0xff_a6_4a] as const;

/** An LED colour picked from r. */
const pick = (r: () => number): number => LEDS[Math.floor(r() * LEDS.length)] ?? LEDS[0];

/** A colour (sRGB hex) as linear rgb, times k. */
function linear(hex: number, k: number): [number, number, number] {
  const c = new Color(hex);
  return [c.r * k, c.g * k, c.b * k];
}

/** A line of LEDs round a tier, under its parapet. */
function band(m: Mass, t: Tier): void {
  m.lk = [0, t.y1 - 0.625, 0, Wide.Up];
  m.box(inset(t, -0.06), [t.y1 - 0.9, t.y1 - 0.35]);
}

/** A strip of LEDs w wide up a tier's corners, from y0 to y1. */
function corners(m: Mass, t: Rect, { y0, y1, w }: { y0: number; y1: number; w: number }): void {
  for (const [x, z] of [
    [t.x0, t.z0],
    [t.x1, t.z0],
    [t.x1, t.z1],
    [t.x0, t.z1],
  ] as const) {
    m.lk = [x, 0, z, Wide.Across];
    m.box(sized([x, z], [w, w]), [y0, y1]);
  }
}

/** A modern tower's LEDs: a band round the top of each tier under its parapet; on a few, a strip up each corner of the shaft. A landmark has them all, in its own light. */
export function leds(m: Mass, b: Building): void {
  const r = rng(b.seed ^ 0x5b_d1);
  // a far block (`lightsOnly`) keeps the top tier's band and its corner strips (live Led, thickened by the shader like High's)
  if (b.light !== undefined) {
    m.set(b.light, Kind.Led, { seed: b.seed % 991 });
    for (const [i, t] of b.tiers.entries()) {
      // far: only the top band (less mid-shaft rings), but the corner strips still run up every tier
      if (!(m.lightsOnly && i < b.tiers.length - 1)) {
        band(m, t);
      }
      if (i > 0) {
        corners(m, t, { y0: t.y0, y1: t.y1 - 0.9, w: 0.5 });
      }
    }
    return;
  }
  if (b.style === 'tile' || topOf(b) < 60 || r() > 0.55) {
    return;
  }
  m.set(pick(r), Kind.Led, { seed: b.seed % 991 });
  for (const t of m.lightsOnly ? b.tiers.slice(-1) : b.tiers) {
    band(m, t);
  }
  const [, s] = b.tiers;
  if (!s || r() > 0.3) {
    return;
  }
  corners(m, s, { y0: s.y0, y1: headOf(b).y1 - 0.9, w: 0.36 });
}

/** A tall tower's head in floodlights at night: a landmark's always, in its own light; a few others', fainter. Its colour (linear), and the height it starts from. */
export function headLight(b: Building): { c: [number, number, number]; from: number } | null {
  const h = topOf(b),
    r = rng(b.seed ^ 0x3e_ad);
  if (b.light !== undefined) {
    return { c: linear(b.light, 1.05), from: h * 0.62 };
  }
  if (h < 130 || b.style === 'tile' || r() > 0.28) {
    return null;
  }
  return { c: linear(pick(r), 0.5), from: h * (0.78 + r() * 0.12) };
}
