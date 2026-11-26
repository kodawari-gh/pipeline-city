// A spire on a tower's top tier (`crown.ts`), in the tower's own lines: blades up its corners, stages of glass under eaves, and a needle.
import { Color } from 'three';
import { SEG } from '@/core/render/three/geometry';
import { Kind, sized, Wide } from './basics';
import type { Mass } from './mass';
import type { Building, Tier, Top, V3 } from './types';

/** What a spire's pieces share: the tier's middle, the blades' and eaves' metal, the lights' seed. */
interface Spire {
  m: Mass;
  b: Building;
  mid: readonly [number, number];
  metal: Color;
  seed: number;
}

/** A spire's stages from the foot up: each one's height as a share of the spire's. */
const STAGES = [0.3, 0.24, 0.19, 0.15, 0.12] as const;

/** A band of eight sides round the middle through these radii and heights, its flats facing the tower's walls. */
function lathe(m: Mass, [cx, cz]: readonly [number, number], profile: readonly (readonly [number, number])[]): void {
  m.skin(
    profile.map(([r, y]) =>
      Array.from({ length: SEG.spireSides }, (_, i): V3 => {
        const a = -(i + 0.5) * ((Math.PI * 2) / SEG.spireSides);
        return [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
      }),
    ),
  );
}

/** A blade on a tier's corner (sx, sz: which one) from y0 up `high`, narrowing to a point and leaning a little in toward the spire: metal by day, lit at night. Diamond in section. */
function blade(
  { m, b, metal, seed }: Spire,
  t: Tier,
  { sx, sz, y0, high }: { sx: number; sz: number; y0: number; high: number },
): void {
  const x = sx > 0 ? t.x1 - 2.4 : t.x0 + 2.4,
    z = sz > 0 ? t.z1 - 2.4 : t.z0 + 2.4,
    dx = sx * Math.SQRT1_2,
    dz = sz * Math.SQRT1_2;
  const mids: V3[] = [],
    rings: V3[][] = [];
  for (const s of [0, 1]) {
    const pull = 3.5 * s,
      half = 0.12 + 2.2 * (1 - s);
    const c: V3 = [x - dx * pull, y0 + high * s, z - dz * pull];
    const at = (a: number, e: number): V3 => [c[0] + dz * a + dx * e, c[1], c[2] - dx * a + dz * e];
    mids.push(c);
    rings.push([at(0, half), at(half, 0), at(0, -half), at(-half, 0)]);
  }
  if (b.light === undefined) {
    m.set(metal, Kind.Plain);
  } else {
    m.set(new Color(b.light).multiplyScalar(0.6), Kind.Led, { seed, look: [0, 0, 0, 0], refl: 1 });
  }
  m.skin(rings, mids);
}

/** The glass stages from h up, each slimmer and shorter than the one below (from radius r), under a thin eave with a line of light. Where they end: the height and the radius. */
function stages({ m, b, mid, metal, seed }: Spire, h: number, r0: number): [number, number] {
  const sh = h * 0.16;
  let y = h,
    r = r0;
  for (const share of STAGES) {
    const y1 = y + sh * share,
      top = r * 0.87,
      eave = top + 1.7;
    if (b.light === undefined) {
      m.set(metal, Kind.Plain);
    } else {
      m.set(b.light, Kind.Crown, { seed, look: [2.4, y, y1 - y, 1.5] });
    }
    lathe(m, mid, [
      [r, y],
      [top, y1],
    ]);
    // the eave: its soffit, its edge, and its slope in to the next stage
    const next = top * 0.76;
    m.set(metal, Kind.Plain);
    lathe(m, mid, [
      [top, y1],
      [eave, y1 + 0.5],
      [eave, y1 + 1.3],
      [next, y1 + 3],
    ]);
    if (b.light !== undefined) {
      m.set(b.light, Kind.Led, { seed, look: [0, y1 + 0.9, 0, Wide.Up] });
      lathe(m, mid, [
        [eave + 0.08, y1 + 0.5],
        [eave + 0.08, y1 + 1.3],
      ]);
    }
    y = y1 + 3;
    r = next;
  }
  return [y, r];
}

/** The last slope from (r, y), the light going on up it; then the needle, fainter, and its rings of light. Its tip's height. */
function needle({ m, b, mid, metal, seed }: Spire, [y0, r]: readonly [number, number]): number {
  const [cx, cz] = mid;
  if (b.light === undefined) {
    m.set(metal, Kind.Plain);
  } else {
    m.set(b.light, Kind.Flood, { look: [0, y0 - 2, 18, 0] });
  }
  lathe(m, mid, [
    [r, y0],
    [1.4, y0 + 5],
  ]);
  const y = y0 + 5,
    long = 20;
  if (b.light === undefined) {
    m.set(metal, Kind.Plain, { look: [cx, 0, cz, Wide.Across] });
  } else {
    m.set(new Color(b.light).multiplyScalar(0.45), Kind.Led, { seed, look: [cx, 0, cz, Wide.Across], refl: 1 });
  }
  lathe(m, mid, [
    [1.1, y],
    [0.3, y + long],
  ]);
  if (b.light !== undefined) {
    for (const [k, s] of [
      [0.12, 2.6],
      [0.3, 2],
      [0.48, 1.5],
    ] as const) {
      const ry = y + long * k;
      m.set(b.light, Kind.Led, { seed, look: [cx, ry + 0.4, cz, Wide.All] }).box(sized(mid, [s, s]), [ry, ry + 0.8], {
        top: true,
      });
    }
  }
  return y + long;
}

/**
 * A spire on a tower's top tier, in the tower's own lines: four blades carry its corners up past the roof and lean in; between them eight-sided
 * stages of glass rise, each slimmer and shorter than the one below, under a thin eave with a line of light; a needle with rings of light tops
 * them. A stage glows brightest at its foot. Its tip's height.
 */
export function spire(m: Mass, b: Building, { t, h, cx, cz }: Top): number {
  const w = Math.min(t.x1 - t.x0, t.z1 - t.z0),
    s: Spire = { m, b, mid: [cx, cz], metal: new Color(b.frame).lerp(new Color(0xc8_cc_d0), 0.5), seed: b.seed % 991 };
  for (const [sx, sz] of [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    blade(s, t, { sx, sz, y0: h, high: h * 0.065 });
  }
  return needle(s, stages(s, h, w * 0.38));
}
