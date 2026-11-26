// The case's basement in 3D (docs/render/three.md). Under the shroud: the power supply at the back corner, its rear in the case's
// rear wall with the mains inlet, at its real size (an SFX bay in the Mini and the Micro, an ATX one in the bigger cases; psu3d.ts builds the
// unit), the room east of it the front fans' air passes through to the supply, the fan hub on the tray sheet and the basement's drive cage under
// the main one (drivecage3d.ts). The shroud runs on east under the main cage as its shelf, as a Define 7's: open on the glass side from the hub on.
import { Group, Mesh, PlaneGeometry } from 'three';
import type * as threeTypes from 'three';
import { drawLockup } from '@/core/render/brands';
import { paintLow, rectBox, softBox } from '@/core/render/three/geometry';
import type * as geometryTypes from '@/core/render/three/geometry';
import { NONE, perforated, perforatedFlatRun, plateY, ring, rivets, screws, thumbscrews, wallX } from './casekit3d';
import type * as casekit3dTypes from './casekit3d';
import { mat } from '@/core/render/three/materials';
import { tag } from '@/core/render/three/pick';
import { CASE_FRONT as FRONT, CASE_Z } from '@/features/room/render/three/roomplan';
import { BAY_CELLS, CAGE_W, CASE, CASE_IN, caseForm, FAN_HUB, LAYOUT_CASE, PSU, PSU_FACE_X } from '../layout/layout';

export interface BasementPlan {
  /** The basement's floor and the shroud's top (layout y), the shroud's east end (layout x: its slotted wall, east of the cage, before a front radiator). */
  floor: number;
  top: number;
  east: number;
  /** Where the side panels end (layout x), west of the fan hub: east of it the shroud is open on the glass side over the hub and the basement's cage, its top the main cage's shelf. */
  shelf: number;
  /** The power supply's box: a layout rect and a depth range. */
  psu: geometryTypes.RectLike & { z0: number; z1: number };
  /** The vented span east of the supply's room (the shroud's top is slotted over it, its front perforated). */
  vent: { x: number; w: number };
}

/** The room east of the power supply: it slides this far off the rear wall before it comes out through the shroud's side (`buildmotion.ts`, 240), past the cover's edge. */
const PSU_ROOM = 360;
/** The shroud's panel over the power supply comes off to reach it: its object's name (a click on it still answers as the PSU). */
export const PSU_COVER = 'psu-cover';
/** The whole shroud's object's name: the power lens takes it off (the supply and the fan hub stand under it, and its top sheet hides them from above). */
export const SHROUD = 'shroud';
/** The power supply unit's object's name, in the device's group. */
export const PSU_BODY = 'psu-body';
/** The supply's fan on its underside, over the floor's opening: in the middle of the bay, a 120 mm fan in an ATX bay, a 92 mm one in an SFX bay. */
export const psuFan = (u: BasementPlan['psu']): { x: number; z: number; r: number } => ({
  x: u.x + u.w / 2,
  z: (u.z0 + u.z1) / 2,
  r: (u.h > 1700 ? 60 : 46) * 23,
});
/** The supply's opening in the rear wall: its rear slides out of it. */
export const psuOpening = (u: BasementPlan['psu']): casekit3dTypes.Span => ({
  y0: u.y + 30,
  y1: u.y + u.h - 30,
  z0: u.z0 + 30,
  z1: u.z1 - 30,
});

/** The rubber strips the supply stands on are 3 mm thick: the fan guard's screw heads clear the floor. */
const PSU_FEET = 70;
/** Where everything in the basement goes. */
export function basementPlan(): BasementPlan {
  const floor = CASE.y + CASE.h - 150,
    top = PSU.y,
    shelf = FAN_HUB.x - 150,
    east = Math.max(shelf, (BAY_CELLS[0]?.x ?? shelf) + CAGE_W + 50);
  const F = caseForm(LAYOUT_CASE),
    psu = { x: PSU_FACE_X - F.d, y: floor - PSU_FEET - F.h, w: F.d, h: F.h, z0: CASE_Z + 200, z1: CASE_Z + 200 + F.w };
  const x = psu.x + psu.w + PSU_ROOM;
  return { floor, top, east, shelf, psu, vent: { x, w: Math.max(0, shelf - 140 - x) } };
}

/**
 * The shroud over the basement: its top (a sheet with cable holes by the tray and vent slots over the vent span, riveted to the tray along a flange),
 * its glass-side cover over the power supply (the case's name printed on it, a vented band, two thumbscrews and two screws; it comes off to reach
 * the supply and answers a click as the PSU), the fixed panel east of it (perforated over the vent span, screwed on), the open top east of it
 * (its edge folded down, the hub and the basement's cage under it) and the shroud's east wall, slotted so the front fans' air reaches the supply. On the
 * floor, the strips the supply stands on.
 */
export function shroud(
  p: BasementPlan,
  look: { body: number; ink: string } = { body: 0x26_28_2d, ink: '#c9ced6' },
  rivet: threeTypes.Material = mat(0x2a_2d_32, { metalness: 0.45, roughness: 0.42 }),
  screw: threeTypes.Material = mat(0x2a_2d_32, { metalness: 0.65, roughness: 0.38 }),
): Group {
  const g = new Group(),
    m = mat(look.body, { roughness: 0.45, metalness: 0.3 }),
    zb = CASE_Z + 70,
    zf = FRONT - 70;
  g.name = SHROUD;
  const bg = `#${look.body.toString(16).padStart(6, '0')}`;
  // one hole method: the plate stays whole; its cable and vent openings are perforated sheets on a dark backing (casekit3d `perforatedFlat`)
  g.add(plateY(CASE_IN.x, p.east, zb, zf, p.top, 30, [], m, 4));
  const topY = -p.top,
    slot = { kind: 'slot' as const, pitch: 110, tone: look.body, o: { metal: 0.35, rough: 0.5 } };
  const open: [number, number, number, number][] = [CASE_IN.x + 520, p.psu.x + p.psu.w - 620].map((x) => [
    x,
    x + 760,
    zb + 130,
    zb + 300,
  ]);
  if (p.vent.w > 40) {
    open.push([p.vent.x + 40, p.vent.x + p.vent.w, zb + 340, zf - 110]);
  }
  g.add(perforatedFlatRun(topY, open, slot.kind, slot.pitch, slot.tone, slot.o));
  // the flange up the tray, and its rivets (under the cage, the cage's own flanges hold it)
  g.add(softBox({ x: CASE_IN.x, y: p.top - 50, w: p.shelf - CASE_IN.x, h: 50 }, zb - 1, zb + 10, m, 3));
  const tray: casekit3dTypes.Spot[] = [];
  for (let x = CASE_IN.x + 300; x < p.shelf - 150; x += 620) {
    tray.push({ x, y: -(p.top - 25), z: zb + 10 });
  }
  g.add(rivets(tray, 'z+', 40, rivet));

  const west = { x: CASE_IN.x, y: p.top, w: p.vent.x - 110 - CASE_IN.x, h: p.floor - p.top };
  const panel = tag(new Group(), 'psu');
  panel.name = PSU_COVER;
  panel.add(softBox(west, zf - 40, zf, m, 8));
  const knurl = mat(0x95_9a_a3, { metalness: 0.75, roughness: 0.38 }),
    tx = west.x + west.w - 170;
  panel.add(
    thumbscrews(
      [west.y + 170, west.y + west.h - 170].map((y) => ({ x: tx, y: -y, z: zf + 2 })),
      'z+',
      80,
      48,
      knurl,
    ),
  );
  panel.add(
    screws(
      [west.y + 110, west.y + west.h - 110].map((y) => ({ x: west.x + 110, y: -y, z: zf + 2 })),
      'z+',
      48,
      screw,
    ),
  );
  const W = 1024,
    H = Math.max(64, Math.round((W * west.h) / west.w));
  const print = paintLow(W, H, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fillRect(0, 0, W, 6);
    // the case maker's lockup (`core/render/brands`), in the print's one ink
    drawLockup(c, 'hako', W * 0.36, H / 2, Math.min(H * 0.36, W * 0.07), look.ink, { acc: null, align: 'center' });
  });
  const face = new Mesh(
    new PlaneGeometry(west.w, west.h),
    mat(0xff_ff_ff, { map: print, roughness: 0.45, metalness: 0.2 }),
  );
  face.position.set(west.x + west.w / 2, -(west.y + west.h / 2), zf + 2);
  panel.add(face);
  const vent: geometryTypes.RectLike = { x: west.x + west.w - 1020, y: west.y + 170, w: 640, h: west.h - 340 };
  panel.add(ring(vent, 14, NONE, 14, zf, zf + 9, m));
  perforated(panel, vent, zf + 3, 'slot', 110, look.body, { metal: 0.35, rough: 0.5 });
  g.add(panel);

  // the fixed panel east of the cover: perforated over the vent span, screwed at its corners
  const x0 = west.x + west.w,
    fixed: geometryTypes.RectLike = { x: x0 + 12, y: p.top, w: p.shelf - x0 - 12, h: p.floor - p.top };
  g.add(softBox(fixed, zf - 40, zf, m, 8));
  if (p.vent.w > 400) {
    const band: geometryTypes.RectLike = { x: p.vent.x + 60, y: fixed.y + 170, w: p.vent.w - 120, h: fixed.h - 340 };
    g.add(ring(band, 14, NONE, 14, zf, zf + 9, m));
    perforated(g, band, zf + 3, 'slot', 110, look.body, { metal: 0.35, rough: 0.5 });
  }
  g.add(
    screws(
      [
        [fixed.x + 110, fixed.y + 110],
        [fixed.x + fixed.w - 110, fixed.y + 110],
        [fixed.x + 110, fixed.y + fixed.h - 110],
        [fixed.x + fixed.w - 110, fixed.y + fixed.h - 110],
      ].map(([x, y]) => ({ x: x!, y: -y!, z: zf + 2 })),
      'z+',
      48,
      screw,
    ),
  );
  // the shelf's glass-side edge, folded down (stiff enough for a cage of disks), and the panel's folded east edge
  if (p.east - p.shelf > 200) {
    g.add(
      softBox({ x: p.shelf, y: p.top, w: p.east - p.shelf, h: 110 }, zf - 40, zf, m, 6),
      softBox({ x: p.shelf - 30, y: p.top, w: 30, h: p.floor - p.top }, zf - 200, zf, m, 4),
    );
  }
  const slots: casekit3dTypes.Span[] = [];
  for (let y = p.top + 170; y + 60 < p.floor - 90; y += 130) {
    slots.push({ y0: y, y1: y + 60, z0: zb + 320, z1: zf - 320, r: 30 });
  }
  g.add(wallX(p.east - 40, p.east, { y0: p.top, y1: p.floor, z0: zb, z1: zf }, slots, m));

  // the rubber strips under the power supply, either side of its fan
  const u = p.psu,
    rubber = mat(0x05_06_08, { roughness: 0.92 });
  for (const z of [u.z0 + 60, u.z1 - 200]) {
    g.add(rectBox({ x: u.x + 90, y: u.y + u.h, w: u.w - 180, h: PSU_FEET }, z, z + 140, rubber));
  }
  return g;
}
