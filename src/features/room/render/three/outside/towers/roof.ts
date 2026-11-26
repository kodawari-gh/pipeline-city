// What stands on a roof (`building.ts` calls it for each tier with room to spare), the largest first, each where the others leave room: a
// bulkhead with its door and a paved way to it, solar panels, then the plant (`plant.ts`). A roof's membrane turned up a wall: its flashing.
import { Color } from 'three';
import { inset, Kind, sized } from './basics';
import type { Mass } from './mass';
import { ducts, mushrooms, outdoorUnits, plantBoxes, skylights, tank, vents } from './plant';
import type { Roof } from './roofing';
import type { Building, Place, Rect, RoofAt, V3 } from './types';

/** A parapet's height over its roof (m), how far from the window a roof gets its plant and tanks, and its smallest things. */
export const PARAPET = 1.1,
  CLUTTER = 900,
  FINE = 420;

/** A field of solar panels in rows, tilted to the south (+z) on dark frames. */
function solar(m: Mass, r: Rect, y: number): void {
  const dep = 1.7,
    rise = 0.5,
    foot = 0.22,
    l = Math.hypot(dep, rise),
    n: V3 = [0, dep / l, rise / l];
  for (let { z1 } = r; z1 - dep >= r.z0; z1 -= dep + 1.1) {
    const z0 = z1 - dep;
    m.set(0x40_44_4a, Kind.Plain).box({ x0: r.x0 + 0.1, x1: r.x1 - 0.1, z0: z0 + 0.1, z1: z1 - 0.1 }, [
      y,
      y + foot + rise * 0.4,
    ]);
    m.set(0, Kind.Solar).quad(
      [
        [r.x0, y + foot, z1],
        [r.x1, y + foot, z1],
        [r.x1, y + foot + rise, z0],
        [r.x0, y + foot + rise, z0],
      ],
      n,
      [
        [r.x0, 0],
        [r.x1, 0],
        [r.x1, l],
        [r.x0, l],
      ],
    );
  }
}

/** A roof's membrane turned up the inner face of the rect r's walls (`out`: up the outer face) to h over y, under a metal bar: its flashing. */
export function flashing(m: Mass, r: Rect, { y, h, out = false }: { y: number; h: number; out?: boolean }): void {
  const k = out ? -0.04 : 0.04,
    face = inset(r, k),
    bar = inset(r, k * 1.25);
  m.set(0x50_53_56, Kind.Plain).box(face, [y, y + h], { inward: !out });
  m.set(0x9f_a3_a6, Kind.Plain).box(bar, [y + h, y + h + 0.05], { inward: !out });
  if (out) {
    m.ring(bar, -k * 1.25, y + h + 0.05);
  } else {
    m.ring(r, k * 1.25, y + h + 0.05);
  }
}

/** The places on a roof r, each away from its parapet and from what stands there already (see `Place`). */
function placer(r: Rect, rand: () => number): Place {
  const w = r.x1 - r.x0,
    d = r.z1 - r.z0,
    used: Rect[] = [];
  return (pw, pd, pick = rand) => {
    if (pw > w - 2.4 || pd > d - 2.4) {
      return null;
    }
    for (let i = 0; i < 8; i++) {
      const q = sized(
        [r.x0 + 1.2 + pw / 2 + pick() * (w - 2.4 - pw), r.z0 + 1.2 + pd / 2 + pick() * (d - 2.4 - pd)],
        [pw, pd],
      );
      if (used.every((u) => q.x1 + 0.7 < u.x0 || q.x0 - 0.7 > u.x1 || q.z1 + 0.7 < u.z0 || q.z0 - 0.7 > u.z1)) {
        used.push(q);
        return q;
      }
    }
    return null;
  };
}

/** Near, a bulkhead's flashing; the steel door over the flashing's sill, in a frame, its lever; a step up to it; a lamp over it, warm at night, under a canopy; and a paved way to it. */
function door({ m, r, y, rand }: Roof, head: Rect): void {
  const [cx, cz] = [(head.x0 + head.x1) / 2, (head.z0 + head.z1) / 2];
  const at = (x0: number, x1: number, out: number): Rect => ({
    x0: cx + x0,
    x1: cx + x1,
    z0: head.z1,
    z1: head.z1 + out,
  });
  flashing(m, head, { y, h: 0.28, out: true });
  m.set(0x74_78_7c, Kind.Plain).box(at(-0.66, 0.66, 0.07), [y + 0.26, y + 2.5], { top: true });
  m.set(0x2b_30_33, Kind.Plain).box(at(-0.52, 0.52, 0.1), [y + 0.33, y + 2.4], { top: true });
  m.set(0xb5_b8_ba, Kind.Plain).box(
    { x0: cx + 0.26, x1: cx + 0.42, z0: head.z1 + 0.1, z1: head.z1 + 0.16 },
    [y + 1.22, y + 1.27],
    {
      top: true,
    },
  );
  m.set(0x9c_98_90, Kind.Plain).box(at(-0.8, 0.8, 0.62), [y, y + 0.18], { top: true });
  m.set(0x3a_3d_40, Kind.Plain).box(at(-0.15, 0.15, 0.13), [y + 2.6, y + 2.84], { top: true });
  m.set(0xff_d8_a6, Kind.Led, { look: [0, 0, 0, 0], refl: 0.85 }).box(
    { x0: cx - 0.11, x1: cx + 0.11, z0: head.z1 + 0.13, z1: head.z1 + 0.145 },
    [y + 2.63, y + 2.81],
  );
  m.set(0x7d_81_86, Kind.Plain).box(at(-0.9, 0.9, 0.6), [y + 2.94, y + 3.02], { top: true });
  m.set(0xa3_9f_96, Kind.Plain).box(
    rand() < 0.5
      ? { x0: r.x0 + 0.3, x1: head.x0, z0: cz - 0.5, z1: cz + 0.5 }
      : { x0: cx - 0.5, x1: cx + 0.5, z0: head.z1 + 0.62, z1: r.z1 - 0.3 },
    [y, y + 0.07],
    { top: true },
  );
}

/** A bulkhead over the roof's stair and lift, and near, its door (`door`). */
function bulkhead(roof: Roof): void {
  const { m, y, b, rand, fine, place } = roof;
  const shade = new Color(b.frame).lerp(new Color(0x9a_96_8e), 0.6);
  const head = place(4 + rand() * 4, 4 + rand() * 3);
  if (!head) {
    return;
  }
  m.set(shade, Kind.Plain).box(head, [y, y + 3.4 + rand() * 1.5], { top: true });
  m.set(shade.clone().multiplyScalar(1.1), Kind.Plain).ring(inset(head, -0.12), 0.12, y + 3.42);
  if (fine) {
    door(roof, head);
  }
}

/** Fields of solar panels, more on a large roof. */
function solarFields({ m, y, w, d, large, rand, place }: Roof): void {
  for (let i = 0, n = (rand() < 0.5 ? 1 : 0) + Math.min(1, large); i < n; i++) {
    const q = place(Math.min(w - 3, 7 + rand() * 16), Math.min(d - 3, 6 + rand() * 12));
    if (q) {
      solar(m, q, y);
    }
  }
}

/**
 * What stands on a roof, the largest first, each where the others leave room: a bulkhead with its door and a paved way to it, solar panels, plant
 * boxes, a water tank on its stand, a row of air-conditioning units on their rail, skylights, vent pipes. `fine`: near enough for the small things:
 * then the bulkhead has its flashing, a framed door on a step, a lamp over it under a canopy, and the roof its mushroom vents.
 */
export function clutter(m: Mass, b: Building, { r, y, rand, fine }: RoofAt): void {
  const w = r.x1 - r.x0,
    d = r.z1 - r.z0;
  if (w < 10 || d < 10) {
    return;
  }
  const roof: Roof = { m, r, y, w, d, large: Math.floor((w * d) / 350), b, rand, fine, place: placer(r, rand) };
  bulkhead(roof);
  solarFields(roof);
  ducts(roof);
  plantBoxes(roof);
  tank(roof);
  outdoorUnits(roof);
  if (!fine) {
    return;
  }
  skylights(roof);
  vents(roof);
  mushrooms(roof);
}
