// What tops a tower (`building.ts`): a mast, a spire (`spire.ts`), a lit lantern or a screen round its plant, and its red beacons; and a
// flat block's balconies.
import { Color } from 'three';
import { STYLES, topOf } from '../plan';
import { headOf, inset, Kind, sized, Wide } from './basics';
import type { Mass } from './mass';
import { PARAPET } from './roof';
import { spire } from './spire';
import type { Building, Tier, Top } from './types';

/** A crown being built: the building's mass, the building, its top, and its stream. */
interface Crowning {
  m: Mass;
  b: Building;
  top: Top;
  rand: () => number;
}

/** A flat block's balconies on its street side (z1): a slab out from each storey, its front of frosted glass. */
export function balconies(m: Mass, b: Building, t: Tier): void {
  const { storey } = STYLES[b.style],
    rail = new Color(0x5d_66_6e).lerp(new Color(b.frame), 0.25),
    x0 = t.x0 + 0.5,
    x1 = t.x1 - 0.5;
  for (let y = t.y0 + storey; y < t.y1 - 0.5; y += storey) {
    m.set(b.frame, Kind.Plain).box({ x0, x1, z0: t.z1, z1: t.z1 + 1.3 }, [y - 0.18, y], { top: true });
    m.set(rail, Kind.Plain).box({ x0, x1, z0: t.z1 + 1.22, z1: t.z1 + 1.3 }, [y, y + 1.05], { top: true });
  }
}

/** A tower's screen round its roof's plant: its walls carried on up h past the roof, open inside, capped. */
function screen(m: Mass, b: Building, { t, h }: { t: Tier; h: number }): void {
  const c = new Color(b.frame).lerp(new Color(0x8a_90_96), 0.4);
  m.set(c, Kind.Plain).box(t, [t.y1 + PARAPET, t.y1 + h]);
  m.box(inset(t, 0.4), [t.y1 + PARAPET, t.y1 + h], { inward: true });
  m.set(c.clone().multiplyScalar(1.15), Kind.Plain).ring(t, 0.4, t.y1 + h);
}

/** A mast on its base; a landmark's in its floodlights, with rings of light up it. Its tip's height. */
function mast({ m, b, top: { h, cx, cz } }: Crowning): number {
  const mh = 25 + h * 0.12;
  if (b.light === undefined) {
    m.set(0x9d_a2_a8, Kind.Plain);
  } else {
    m.set(b.light, Kind.Flood, { look: [0, h, 6, 0] });
  }
  m.box(sized([cx, cz], [3, 3]), [h, h + 6], { top: true });
  m.set(0x9d_a2_a8, Kind.Plain, { look: [cx, 0, cz, Wide.Across] }).box(sized([cx, cz], [1.1, 1.1]), [h + 6, h + mh], {
    top: true,
  });
  // a landmark's mast: rings of light up it
  if (b.light !== undefined) {
    for (let k = 1; k <= 5; k++) {
      const y = h + 6 + ((mh - 8) * k) / 5;
      m.set(b.light, Kind.Led, { seed: b.seed % 991, look: [cx, y + 0.45, cz, Wide.All] }).box(
        sized([cx, cz], [2.2, 2.2]),
        [y, y + 0.9],
        {
          top: true,
        },
      );
    }
  }
  return h + mh;
}

/** A glass lantern over the roof, its ribs in the frame's colour; lit warm at night, a landmark's the brighter in its own light. Its tip's height. */
function lantern({ m, b, top: { t, h }, rand }: Crowning): number {
  const lh = 10 + rand() * 6,
    r = inset(t, 2.5);
  m.set(b.light ?? 0xff_c9_8f, Kind.Crown, { seed: b.seed, look: [2.4, h, lh, b.light === undefined ? 0 : 1.5] }).box(
    r,
    [h, h + lh],
    {
      top: true,
    },
  );
  m.set(b.frame, Kind.Plain).box(inset(r, -0.3), [h + lh, h + lh + 1.2], { top: true });
  if (b.light !== undefined) {
    m.set(b.light, Kind.Led, { seed: b.seed % 991, look: [0, h + lh + 0.6, 0, Wide.Up] }).box(inset(r, -0.36), [
      h + lh + 0.25,
      h + lh + 0.95,
    ]);
  }
  return h + lh + 1.2;
}

/** The crown's own piece, or a screen round a tall roof's plant now and then. Its tip's height. */
function piece(c: Crowning): number {
  const {
    m,
    b,
    top: { t, h },
    rand,
  } = c;
  if (b.crown === 'mast') {
    return mast(c);
  }
  if (b.crown === 'spire') {
    return spire(m, b, c.top);
  }
  if (b.crown === 'lantern') {
    return lantern(c);
  }
  if (b.style !== 'tile' && h > 70 && rand() < 0.55) {
    const sh = 4 + rand() * 4;
    screen(m, b, { t, h: sh });
    return h + sh;
  }
  return h + PARAPET;
}

/** A red beacon at the tip; on a tower with no spire, one on each of the roof's corners. */
function beacons({ m, b, top: { t, h, cx, cz }, rand }: Crowning, tip: number): void {
  m.set(0x40_08_08, Kind.Beacon, { seed: rand(), look: [cx, tip + 0.6, cz, Wide.All] }).box(
    sized([cx, cz], [1.2, 1.2]),
    [tip, tip + 1.2],
    {
      top: true,
    },
  );
  // a spire's corners hold its blades; a far block keeps its mast or spire and the tip's beacon, not the roof's corner beacons
  if (b.crown === 'spire' || m.lightsOnly) {
    return;
  }
  for (const [x, z] of [
    [t.x0 + 1, t.z0 + 1],
    [t.x1 - 1, t.z1 - 1],
    [t.x0 + 1, t.z1 - 1],
    [t.x1 - 1, t.z0 + 1],
  ] as const) {
    m.set(0x40_08_08, Kind.Beacon, { seed: rand(), look: [x, h + PARAPET + 0.4, z, Wide.All] }).box(
      sized([x, z], [0.8, 0.8]),
      [h + PARAPET, h + PARAPET + 0.8],
      { top: true },
    );
  }
}

/** A tower's crown on its top tier: a mast, a spire, a lit lantern; a red beacon at its tip and on the roof's corners. */
export function crown(m: Mass, b: Building, rand: () => number): void {
  const t = headOf(b),
    h = topOf(b),
    c: Crowning = { m, b, top: { t, h, cx: (t.x0 + t.x1) / 2, cz: (t.z0 + t.z1) / 2 }, rand };
  // a mast's and a spire's own pieces are the silhouette: a far block keeps them (`Mass.silhouette`), with the tip's beacon on top
  m.silhouette = b.crown === 'mast' || b.crown === 'spire';
  const tip = piece(c);
  m.silhouette = false;
  if (h < 110) {
    return;
  }
  beacons(c, tip);
}
