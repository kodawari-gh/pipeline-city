// One building into the city's mass (`rings.ts`): whole, as near the window (its walls, parapet, roof and plant, crown, lights and signs), or
// at Low past `LOW_WHOLE` a plain block with its night pieces only.
import { Color } from 'three';
import { rng, STYLES, topOf } from '../plan';
import { inset, Kind } from './basics';
import { balconies, crown } from './crown';
import { headLight, leds } from './leds';
import type { Mass } from './mass';
import { CLUTTER, clutter, FINE, flashing, PARAPET } from './roof';
import { signs } from './signs';
import type { Building, Tier } from './types';

/** A tower's head in floodlights (`headLight`), or none. */
type Head = ReturnType<typeof headLight>;

/** A tier's walls, each wall's bays stretched to fit it whole, under the head's floodlights. `i`: the tier's place from the foot. */
function walls(m: Mass, b: Building, { t, i, head }: { t: Tier; i: number; head: Head }): void {
  const s = STYLES[b.style],
    home = b.style === 'tile' || (b.style === 'band' && topOf(b) < 60);
  m.set(b.frame, home ? Kind.Home : Kind.Facade, {
    tint: b.tint,
    seed: (b.seed % 997) + i * 0.37,
    look: [s.bay, s.storey, s.win[0], s.win[1]],
    refl: s.refl,
  });
  if (head) {
    m.fl = head.c;
    m.flY = [head.from, topOf(b)];
  }
  m.box(t, [t.y0, t.y1], {
    fit: (len) => {
      m.lk = [len / Math.max(1, Math.round(len / s.bay)), s.storey, s.win[0], s.win[1]];
    },
  });
  m.fl = [0, 0, 0];
  m.flY = [0, 0];
}

/** The parapet round a tier's roof, the gravel inside it, and near, its flashing. The parapet's colour. */
function parapet(m: Mass, b: Building, { t, near }: { t: Tier; near: boolean }): Color {
  const frame = new Color(b.frame).multiplyScalar(b.style === 'glass' ? 1 : 0.92);
  m.set(frame, Kind.Plain).box(t, [t.y1, t.y1 + PARAPET]);
  m.box(inset(t, 0.3), [t.y1, t.y1 + PARAPET], { inward: true });
  m.set(frame.clone().multiplyScalar(1.15), Kind.Plain).ring(t, 0.3, t.y1 + PARAPET);
  const floor = inset(t, 0.3);
  m.set(0x8a_87_80, Kind.Roof, { seed: b.seed % 991, look: [floor.x0, floor.x1, floor.z0, floor.z1] }).top(floor, t.y1);
  if (near) {
    flashing(m, floor, { y: t.y1, h: 0.32 });
  }
  return frame;
}

/** An office grid's stone cap under its parapet's top and its string course over the shop fronts; any other's slim metal cap. */
function cap(m: Mass, b: Building, { t, i, frame }: { t: Tier; i: number; frame: Color }): void {
  if (b.style === 'grid') {
    const s = STYLES[b.style],
      stone = new Color(b.frame).multiplyScalar(1.06),
      out = 0.25;
    m.set(stone, Kind.Plain).box(inset(t, -out), [t.y1 + PARAPET - 0.75, t.y1 + PARAPET + 0.12]);
    m.ring(inset(t, -out), out + 0.3, t.y1 + PARAPET + 0.12);
    if (i === 0 && t.y1 > s.storey * 2) {
      m.box(inset(t, -0.18), [s.storey - 0.35, s.storey]);
      m.ring(inset(t, -0.18), 0.18, s.storey);
    }
  } else {
    m.set(frame.clone().lerp(new Color(0xb4_b9_be), 0.5), Kind.Plain).box(inset(t, -0.12), [
      t.y1 + PARAPET - 0.25,
      t.y1 + PARAPET + 0.05,
    ]);
    m.ring(inset(t, -0.12), 0.42, t.y1 + PARAPET + 0.05);
  }
}

/** A tier's roof that has room for plant: in front of the tier above it (the strip the window sees), or all of it on the top tier. */
function freeOf(b: Building, t: Tier, i: number): Tier {
  const next = b.tiers[i + 1];
  return next ? { ...t, z0: next.z1 + 1 } : t;
}

/**
 * A far building at Low (past `LOW_WHOLE`): each tier a plain box in the facade's look (its walls in its floodlights, as `building`'s) under
 * a flat roof (30 vertices a tier), then only its night pieces: the crown's lights, the LED bands, their corner strips and the signs. No
 * parapet or roof plant (`Mass.lightsOnly` drops the plain pieces). Its crown and its signs are High's own. `away`: from the window (m).
 */
export function block(m: Mass, b: Building, away: number): void {
  const head = headLight(b),
    rand = rng(b.seed);
  for (const [i, t] of b.tiers.entries()) {
    // (the roof's plant draws from the building's stream before the crown does, in `building`: the same draws here, no vertex kept)
    const free = freeOf(b, t, i);
    if (away < CLUTTER && free.z1 - free.z0 > 10) {
      m.dry = true;
      clutter(m, b, { r: free, y: t.y1, rand, fine: away < FINE });
      m.dry = false;
    }
    walls(m, b, { t, i, head });
    // (a roof, not a facade: its uv is the ground's metres, and a wall's rooms would light on it)
    m.set(0x8a_87_80, Kind.Roof, { seed: b.seed % 991, look: [t.x0, t.x1, t.z0, t.z1] }).top(t, t.y1);
  }
  m.lightsOnly = true;
  crown(m, b, rand);
  leds(m, b);
  signs(m, b, away);
  m.lightsOnly = false;
}

/** A building into `m`, `away` from the window (m). */
export function building(m: Mass, b: Building, away: number): void {
  const rand = rng(b.seed),
    near = away < CLUTTER,
    head = headLight(b);
  for (const [i, t] of b.tiers.entries()) {
    walls(m, b, { t, i, head });
    cap(m, b, { t, i, frame: parapet(m, b, { t, near }) });
    // a flat block's balconies; the plant on the roof (on a podium, in the strip in front of the shaft, the side the window sees)
    if (near && b.style === 'band' && b.tiers.length === 1) {
      balconies(m, b, t);
    }
    if (near) {
      const free = freeOf(b, t, i);
      if (free.z1 - free.z0 > 10) {
        clutter(m, b, { r: free, y: t.y1, rand, fine: away < FINE });
      }
    }
  }
  crown(m, b, rand);
  leds(m, b);
  signs(m, b, away);
}
