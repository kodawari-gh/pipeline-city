// The plant on a roof after its bulkhead and solar panels (`roof.ts` places them all): ducts, plant boxes, a water tank, a row of
// air-conditioning units, and near the window skylights, vent pipes and mushroom vents. Each draws from the roof's stream in turn, so the
// order of the pieces and of their draws is the city's.
import { ConeGeometry, CylinderGeometry } from 'three';
import { SEG } from '@/core/render/three/geometry';
import { rng } from '../plan';
import { inset, Kind, sized } from './basics';
import type { Roof } from './roofing';
import type { Rect } from './types';

/** A water tank and its lid, a vent pipe and its cap, the boot that seals a pipe to the membrane, a mushroom vent and its hood, centred on their own middles. */
const TANK = new CylinderGeometry(1.25, 1.25, 2.4, SEG.post).toNonIndexed(),
  TANK_LID = new ConeGeometry(1.3, 0.4, SEG.post).toNonIndexed(),
  VENT = new CylinderGeometry(0.14, 0.14, 0.8, SEG.smallDisc).toNonIndexed(),
  VENT_CAP = new CylinderGeometry(0.24, 0.24, 0.1, SEG.smallDisc).toNonIndexed();
const BOOT = new CylinderGeometry(0.2, 0.27, 0.14, SEG.smallDisc).toNonIndexed(),
  MUSH = new CylinderGeometry(0.26, 0.3, 0.42, SEG.midRound).toNonIndexed(),
  MUSH_CAP = new ConeGeometry(0.5, 0.24, SEG.midRound).toNonIndexed();

/** The middle of a rect. */
const midOf = (q: Rect): [number, number] => [(q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2];

/** A duct along the roof, on a plant box at its end. */
export function ducts({ m, y, w, d, large, rand, place }: Roof): void {
  for (let i = 0, n = Math.floor(rand() * 2) + Math.min(2, large); i < n; i++) {
    const along = rand() < 0.5,
      l = (along ? w : d) * (0.25 + rand() * 0.4),
      q = along ? place(l, 0.5) : place(0.5, l);
    if (q) {
      m.set(0x9a_9e_a2, Kind.Plain).box(q, [y + 0.15, y + 0.6], { top: true });
      const e = sized([along ? q.x1 : (q.x0 + q.x1) / 2, along ? (q.z0 + q.z1) / 2 : q.z1], [1.5, 1.5]);
      m.set(0x7d_81_86, Kind.Plain).box(e, [y, y + 1.3], { top: true });
    }
  }
}

/** Plant boxes; near, each stands on a dark kerb, its intake grille on the window's side, its fan's grille on top. */
export function plantBoxes({ m, y, large, rand, fine, place }: Roof): void {
  for (let i = 0, n = 1 + Math.floor(rand() * 3) + Math.min(3, large); i < n; i++) {
    const s = 1.6 + rand() * 1.8,
      q = place(s * 1.4, s);
    if (!q) {
      continue;
    }
    const top = y + 1.2 + rand() * 0.8;
    m.set(0x8d_91_96, Kind.Plain).box(q, [y + (fine ? 0.16 : 0), top], { top: true });
    if (fine) {
      const fan = Math.min(q.x1 - q.x0, q.z1 - q.z0) * 0.3;
      m.set(0x3d_40_43, Kind.Plain).box(inset(q, 0.08), [y, y + 0.16]);
      m.set(0x4a_4e_52, Kind.Plain).box(
        { x0: q.x0 + 0.18, x1: q.x1 - 0.18, z0: q.z1, z1: q.z1 + 0.025 },
        [y + 0.4, top - 0.22],
        {
          top: true,
        },
      );
      m.box(sized(midOf(q), [fan * 2, fan * 2]), [top, top + 0.05], { top: true });
    }
  }
}

/** Now and then a water tank on its stand. */
export function tank({ m, y, rand, place }: Roof): void {
  if (rand() >= 0.35) {
    return;
  }
  const q = place(2.8, 2.8);
  if (!q) {
    return;
  }
  const [x, z] = midOf(q),
    tint = rand() < 0.5 ? 0xa8_ac_ae : 0x6d_7a_80;
  m.set(0x30_33_36, Kind.Plain).box(sized([x, z], [1.9, 1.9]), [y, y + 1.1], { top: true });
  m.set(tint, Kind.Plain).shape(TANK, [x, y + 2.3, z]);
  m.shape(TANK_LID, [x, y + 3.7, z]);
}

/** Mostly, the outdoor units in a row, pale grey boxes on a dark rail. */
export function outdoorUnits({ m, y, w, rand, place }: Roof): void {
  if (rand() >= 0.7) {
    return;
  }
  const n = 3 + Math.floor(rand() * 5),
    run = Math.min(n * 1.25, w - 6),
    q = place(run + 0.4, 1);
  if (!q) {
    return;
  }
  const [x, z] = midOf(q);
  m.set(0x3a_3d_40, Kind.Plain).box(q, [y, y + 0.25], { top: true });
  m.set(0xc7_c9_c8, Kind.Plain);
  for (let i = 0; i < n && (i + 1) * 1.25 <= run + 0.01; i++) {
    m.box(sized([x - run / 2 + 0.62 + i * 1.25, z], [0.95, 0.42]), [y + 0.25, y + 0.95], { top: true });
  }
}

/** The skylights over a stairwell or a top floor's rooms, a little warm at night. */
export function skylights({ m, y, b, rand, place }: Roof): void {
  if (rand() >= 0.45) {
    return;
  }
  for (let i = 0, n = 1 + Math.floor(rand() * 3); i < n; i++) {
    const q = place(1.7, 2.8);
    if (q) {
      m.set(0x40_44_4a, Kind.Plain).box(inset(q, -0.1), [y, y + 0.3]);
      m.set(0xb9_91_5f, Kind.Crown, { seed: b.seed % 991, look: [0.85, y, 1, 0] }).box(q, [y + 0.3, y + 0.55], {
        top: true,
      });
    }
  }
}

/** Vent pipes in their boots. */
export function vents({ m, y, rand, place }: Roof): void {
  for (let i = 0, n = Math.floor(rand() * 6); i < n; i++) {
    const q = place(0.5, 0.5);
    if (q) {
      const [x, z] = midOf(q);
      m.set(0x6a_6e_72, Kind.Plain).shape(VENT, [x, y + 0.4, z]);
      m.shape(VENT_CAP, [x, y + 0.84, z]);
      m.set(0x3d_40_43, Kind.Plain).shape(BOOT, [x, y + 0.07, z]);
    }
  }
}

/** The mushroom vents, from their own stream, so all that stands before them keeps its place. */
export function mushrooms({ m, y, b, place }: Roof): void {
  const more = rng(b.seed * 31 + 7);
  for (let i = 0, n = 2 + Math.floor(more() * 3); i < n; i++) {
    const q = place(1, 1, more);
    if (q) {
      const [x, z] = midOf(q);
      m.set(0x3d_40_43, Kind.Plain).shape(BOOT, [x, y + 0.07, z]);
      m.set(0x8e_92_96, Kind.Plain).shape(MUSH, [x, y + 0.35, z]);
      m.shape(MUSH_CAP, [x, y + 0.68, z]);
    }
  }
}
