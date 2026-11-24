// What a SATA drive hides under its cover (docs/PC_PARTS.md "Storage"), built at the drive's real size in the drive's own frame (x across, y up, z from the
// connector end): the SSD's board with its controller, DRAM and four NAND packages, each package a cap over a die that shows its floorplan once the cover is
// gone (`chipdie3d.ts`); the hard disk's stack of platters on the spindle's hub, the top one wearing its tracks and servo wedges, and the actuator over it:
// an arm with its head over the data band, the voice coil at its tail under a steel yoke. The drive fades its cover over `COVER_BAND` (`DriveHost.reveal`).
import { CylinderGeometry, Group, Mesh, Vector2, type Material } from 'three';
import { ramDieArt, ramDiePlan, RAM_DIE } from '@/features/memory/render/ramdie';
import { CTRL_DIE, NAND_DIE, PLATTER, ctrlDieArt, nandDieArt, platterArt } from '@/features/storage/render/diskdie';
import type { Theme } from '@/core/render/theme';
import { FINISH } from '@/core/render/three/artlod';
import { SEG, extrude, place, rectBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import type { V3 } from '@/core/render/three/rope';
import { LV_DIE, type ArtSet } from './artset3d';
import { screws, shapeOf } from './casekit3d';
import { dieInPackage, type DieHost } from './chipdie3d';
import { MM, crystal, inductor, passiveRow, passives, pcbSlab, pkg } from './pcbkit3d';

/** What a drive needs to show its inside: the set that bakes the art, the palette, and how it asks for a zoom at a place (a point in the drive's own frame). */
export interface DriveHost {
  art: ArtSet;
  T: Theme;
  reveal: (at: V3, apply: (zoom: number) => void) => void;
}

const m = (v: number) => v * MM;
/** A box over x0..x1, y0..y1 (up) and z0..z1, in the drive's frame. */
const bx = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mt: Material) =>
  rectBox({ x: x0, y: -y1, w: x1 - x0, h: y1 - y0 }, z0, z1, mt);

/** A flat piece with the (x, z) outline `pts` from y0 up to y1. */
function plate(pts: Vector2[], y0: number, y1: number, mt: Material, holes: Vector2[][] = []): Mesh {
  const g = extrude(shapeOf(pts, holes), { depth: y1 - y0, bevelEnabled: false, curveSegments: SEG.holeCurve });
  g.rotateX(Math.PI / 2).translate(0, y1, 0);
  return place(new Mesh(g, mt));
}

const disc = (x: number, z: number, r: number, y0: number, y1: number, mt: Material, n: number = SEG.drum): Mesh =>
  place(new Mesh(new CylinderGeometry(r, r, y1 - y0, n).translate(x, (y0 + y1) / 2, z), mt));

// ------------------------------------------------------------------ the SSD's board
/** The SSD's board in mm: 65 across, 90 long from its connector end; the packages' places in it. */
export const SSD_BOARD = { w: 65, l: 90, t: 0.8 } as const;

/**
 * The 2.5 in. SSD's board, its bottom at drive height `y`, its connector end at drive depth `z` and its west edge at drive `x`: a black board with the controller (a lidded package
 * and its clock), the DRAM cache and four NAND packages in two rows, the regulator and its decoupling. Each package is a cap over its die (`dieInPackage`); each asks for its zoom at its own place.
 */
export function ssdBoard(host: DriveHost, x: number, y: number, z: number): Group {
  const root = new Group(),
    g = new Group(),
    { w, l, t } = SSD_BOARD,
    pt = m(t);
  // (the board's frame is a PCB's: x east, y south, depth up: turned so its y runs along the drive and its depth up)
  root.rotation.x = -Math.PI / 2;
  root.position.set(x, y, z);
  root.add(g);
  const R = (a: number, b: number, c: number, d: number): RectLike => ({ x: m(a), y: m(b), w: m(c), h: m(d) });
  g.add(
    pcbSlab(
      [
        [0, 0],
        [m(w), 0],
        [m(w), m(l)],
        [0, m(l)],
      ],
      0,
      pt,
      0x121519,
    ),
  );
  const die: DieHost = {
    art: host.art,
    T: host.T,
    reveal: (r, d, apply) => host.reveal([x + r.x + r.w / 2, y + d, z + r.y + r.h / 2], apply),
  };
  const ctrl = R(7, 9, 13, 13),
    xtal = R(8.6, 4.2, 2, 1.6),
    dram = R(25.5, 9, 8, 10.35),
    pmic = R(44, 9.5, 3, 3);
  const nand = [R(12, 34, 18, 12), R(35, 34, 18, 12), R(12, 56, 18, 12), R(35, 56, 18, 12)];
  const ctrlBake = host.art.baker(() => ctrlDieArt(host.T, 'ssd-sata')),
    nandBake = host.art.baker(() => nandDieArt(host.T, 1, 'ssd-sata'));
  const dramBake = host.art.baker(() => ramDieArt(host.T, ramDiePlan({ banks: 8, bankGroups: 2 })));
  dieInPackage(
    g,
    die,
    ctrl,
    pt,
    m(1.4),
    ['KR2258-SA', '2310 TW', 'B12S1.0'],
    { lid: true },
    { ...CTRL_DIE, bake: ctrlBake },
  );
  crystal(g, xtal, pt, m(0.55));
  dieInPackage(g, die, dram, pt, m(1), ['KRD3-1G', '2310'], {}, { ...RAM_DIE, bake: dramBake, turn: true });
  nand.forEach((r, i) =>
    dieInPackage(g, die, r, pt, m(1.25), ['KRN3D-128', `T04${i + 1}2 TLC`], {}, { ...NAND_DIE, bake: nandBake }),
  );
  pkg(g, pmic, pt, m(0.75), ['P9M']);
  [R(50, 9, 1.6, 2), R(50, 12, 1.6, 2), R(50, 15, 1.6, 2)].forEach((r) => inductor(g, r, pt, m(1), 'R47'));
  // decoupling beside each package
  passives(
    g,
    [
      ...passiveRow(m(6), m(24), 7, m(2.2), '0402'),
      ...passiveRow(m(24), m(23.6), 4, m(2.2), '0402'),
      ...passiveRow(m(11), m(48.6), 7, m(2.4), '0402'),
      ...passiveRow(m(34), m(48.6), 7, m(2.4), '0402'),
      ...passiveRow(m(11), m(70.6), 7, m(2.4), '0402'),
      ...passiveRow(m(34), m(70.6), 7, m(2.4), '0402'),
    ],
    pt,
  );
  return root;
}

// ------------------------------------------------------------------ the hard disk's inside
/** The hard disk's inside, in units of the drive's frame: where its parts stand and how tall the cavity is. */
export interface HddFit {
  spin: { x: number; z: number };
  pivot: { x: number; z: number };
  floor: number;
}

/** The platters' radius (95 mm across on a 3.5 in. drive: 45 mm leaves the casting's wall clear), the heads' reach along the arm (mm from the pivot). */
export const PLATTER_R_MM = 45,
  ARM_MM = 58;

/**
 * The hard disk's inside: three platters on the spindle's hub (the top one wears the baked art: tracks, servo wedges, the clamp ring), the clamp and its screws, the actuator: the arm
 * over the top platter with its head on the data band, the pivot's bearing, the voice coil at its tail and the steel yoke over it. `f.floor`: the casting's floor.
 */
export function hddInside(host: DriveHost, f: HddFit): Group {
  const g = new Group(),
    R = m(PLATTER_R_MM),
    { x, z } = f.spin;
  const glass = mat(0x2a2d32, { metalness: 0.85, roughness: 0.28 }),
    steel = mat(0xb9babf, { metalness: 0.9, roughness: 0.32 }),
    dark = mat(0x2a2d32, { metalness: 0.7, roughness: 0.4 });
  // the platters, 0.8 mm each at a 4 mm pitch, the hub through them
  const tops = [3.4, 7.4, 11.4].map((v) => f.floor + m(v)),
    top = tops[2]!;
  tops.forEach((y, i) => g.add(disc(x, z, R, y - m(0.8), y, glass, i === 2 ? SEG.drum * 3 : SEG.drum * 2)));
  g.add(disc(x, z, m(9), f.floor, top, steel));
  // the top platter's face: the 2D platter's art on the disc, hidden with the cover (it bakes nothing before)
  const frame = new Group(),
    inner = new Group(),
    k = R / PLATTER.R;
  frame.position.set(x, top + 0.3, z);
  frame.rotation.x = -Math.PI / 2;
  frame.scale.setScalar(k);
  inner.position.set(-PLATTER.w / 2, PLATTER.h / 2, 0);
  frame.add(inner);
  host.art.surface(
    inner,
    host.art.baker(() => platterArt(host.T)).bake,
    { x: 0, y: 0, w: PLATTER.w, h: PLATTER.h },
    0,
    LV_DIE,
    FINISH.die,
  );
  g.add(frame);
  // the clamp ring over the hub, its six screws, the cap
  g.add(disc(x, z, m(13.4), top, top + m(1), dark), disc(x, z, m(4.6), top + m(1), top + m(2.4), steel));
  g.add(
    screws(
      Array.from({ length: 6 }, (_, i) => ({
        x: x + Math.cos((i / 6) * Math.PI * 2) * m(10.2),
        y: top + m(1),
        z: z + Math.sin((i / 6) * Math.PI * 2) * m(10.2),
      })),
      'y+',
      m(1.2),
      dark,
    ),
  );
  // the actuator: built along +z from its pivot, then turned to point at the spindle
  const dx = x - f.pivot.x,
    dz = z - f.pivot.z,
    act = new Group(),
    y0 = top + m(1.1),
    y1 = y0 + m(0.8),
    L = m(ARM_MM);
  act.position.set(f.pivot.x, 0, f.pivot.z);
  act.rotation.y = Math.atan2(dx, dz);
  const arm = [new Vector2(m(-3.4), m(2)), new Vector2(m(3.4), m(2)), new Vector2(m(1.1), L), new Vector2(m(-1.1), L)];
  const lighten = [
    [14, 1.5],
    [26, 1.2],
    [38, 0.9],
  ].map(([s, r]) =>
    Array.from(
      { length: 12 },
      (_, i) => new Vector2(Math.cos((i / 12) * Math.PI * 2) * m(r!), m(s!) + Math.sin((i / 12) * Math.PI * 2) * m(r!)),
    ),
  );
  act.add(plate(arm, y0, y1, steel, lighten));
  // the head: a slider under the arm's tip, over the band
  act.add(bx(m(-0.8), m(0.8), y0 - m(0.55), y0, L - m(0.5), L + m(2.9), dark));
  // the pivot's bearing, the voice coil behind it, the steel yoke over the coil on two posts
  act.add(disc(0, 0, m(4.6), f.floor + m(1), y1 + m(2.5), steel));
  act.add(
    plate(
      [
        new Vector2(m(-4.6), m(-1)),
        new Vector2(m(4.6), m(-1)),
        new Vector2(m(5.2), m(-12.5)),
        new Vector2(m(-5.2), m(-12.5)),
      ],
      y0,
      y1,
      mat(0xc0793a, { metalness: 0.7, roughness: 0.4 }),
    ),
  );
  act.add(bx(m(-6), m(6), y1 + m(0.8), y1 + m(2.2), m(-13), m(-1), steel));
  for (const px of [-5, 5]) act.add(disc(m(px), m(-12), m(0.9), f.floor, y1 + m(0.8), steel, SEG.post));
  g.add(act);
  return g;
}
