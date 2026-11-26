// The desk: its oak top (`deskSlab`), the drawer unit under its east end (`drawerUnit`), its legs, its cable tray and its LED strip.

import { SEG, post, rectBox, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { OAK_TILE, grainUv, smokedOak } from '../furniture/oak';
import { board } from '../furniture/shapes';
import { oak } from '../furniture/textures';
import { STEEL, VENEER, VENEER_GRAIN } from '../palette';
import { DESK_D, DESK_TOP, FLOOR_Y, PED, TRAY } from '../roomplan';
import type { Build, Group, Mesh, MeshStandardMaterial, RoomGeo } from './types';

/** The desk's top: one slab of the floor's smoked oak, its grain along the desk, its edges rounded as all the furniture's (`board`). */
export function deskSlab(g: RoomGeo): Mesh {
  return grainUv(
    board({ x: g.desk.x0, y: g.ys, w: g.desk.x1 - g.desk.x0, h: DESK_TOP }, [0, DESK_D], smokedOak()),
    OAK_TILE,
  );
}

/**
 * The drawer unit under the desk's east end: a black-brown carcass from the floor to the top, five fronts with a dark gap round each, a grip
 * cut along each top edge. The carcass and the fronts are `board`s (the furniture's round edges).
 */
export function drawerUnit(g: RoomGeo): Mesh[] {
  const ped = { x: g.desk.x1 - PED.in, y: g.ys + DESK_TOP, w: PED.w, h: FLOOR_Y - g.ys - DESK_TOP };
  const alex = mat(0xff_ff_ff, { map: oak(VENEER, VENEER_GRAIN), roughness: 0.55 }),
    slot = mat(0x05_06_08, { roughness: 0.9 });
  const out = [
    board(ped, [300, DESK_D - 400], alex),
    rectBox({ x: ped.x + 260, y: ped.y + 40, w: ped.w - 520, h: ped.h - 80 }, DESK_D - 400, DESK_D - 380, slot),
  ];
  const dh = (ped.h - 160 - 4 * 90) / 5;
  for (let k = 0; k < 5; k++) {
    const d = { x: ped.x + 300, y: ped.y + 80 + k * (dh + 90), w: ped.w - 600, h: dh };
    out.push(
      board(d, [DESK_D - 520, DESK_D - 300], alex),
      rectBox({ x: d.x + d.w / 2 - 1500, y: d.y, w: 3000, h: 220 }, DESK_D - 310, DESK_D - 290, slot),
    );
  }
  return out;
}

/** What the desk's base leaves to the things on and under it: the legs' steel, the drawer unit's west side, the top's underside. */
export interface DeskBase {
  steel: MeshStandardMaterial;
  pedX: number;
  under: number;
}

/** The legs at the west end: round steel tubes screwed into plates under the top, a plastic foot on each. */
function deskLegs({ R, g, ys, fl }: Build, steel: MeshStandardMaterial): void {
  const legH = fl - ys - DESK_TOP,
    tx = g.desk.x0 + 1000;
  for (const [j, z] of [1000, DESK_D - 1000].entries()) {
    const leg = post(tx, fl - 200, z, 280, legH - 200, steel, SEG.drum),
      foot = post(tx, fl, z, 300, 200, mat(0x13_15_18, { roughness: 0.8 }), SEG.drum);
    leg.name = `desk leg ${j}`;
    foot.name = `desk foot ${j}`;
    R.add(leg, foot);
    R.add(softBox({ x: tx - 600, y: ys + DESK_TOP, w: 1200, h: 60 }, z - 600, z + 600, steel, 20));
  }
}

/** The cable tray: a black steel trough hung under the top's back edge (the power strip lies in it, `clutter3d.ts`) on two brackets. */
function cableTray(R: Group, steel: MeshStandardMaterial, under: number): void {
  const t = TRAY,
    ty = under + t.drop;
  for (const [z0, z1] of [
    [t.z0, t.z0 + 60],
    [t.z1 - 60, t.z1],
  ] as const) {
    R.add(softBox({ x: t.x0, y: ty, w: t.x1 - t.x0, h: t.h }, z0, z1, steel, 20));
  }
  R.add(softBox({ x: t.x0, y: ty + t.h - 60, w: t.x1 - t.x0, h: 60 }, t.z0, t.z1, steel, 20));
  for (const x of [t.x0, t.x1 - 60]) {
    R.add(softBox({ x, y: ty, w: 60, h: t.h }, t.z0, t.z1, steel, 20));
  }
  for (const x of [t.x0 + 1500, t.x1 - 1500]) {
    R.add(softBox({ x: x - 200, y: under, w: 400, h: t.drop }, t.z1 - 400, t.z1, steel, 20));
  }
}

/**
 * A cyan LED strip under the top's front edge, as round the bed: at night the desk floats on its glow. Its area light is a narrow band along
 * the strip (a wide one would show as a bright box in the glass behind the desk), stopping short of the drawer unit so its side does not
 * catch the light at point-blank range (a hard bright edge).
 */
function kneeLed({ room, R, g }: Build, { pedX, under }: DeskBase): void {
  const knee0 = g.desk.x0 + 600,
    knee1 = pedX - 200,
    lit1 = pedX - 2200;
  const knee = rectBox({ x: knee0, y: under, w: knee1 - knee0, h: 120 }, DESK_D - 700, DESK_D - 540, room.ledGlow);
  knee.name = 'desk knee';
  R.add(knee);
  room.deskLed.width = lit1 - knee0;
  room.deskLed.height = 1600;
  room.deskLed.position.set((knee0 + lit1) / 2, -under - 200, DESK_D - 1400);
  room.deskLed.rotation.x = -Math.PI / 2;
  R.add(room.deskLed);
}

/**
 * The desk: a smoked oak top (the floor's and the slats' wood) on two round black steel legs at the west end and a black-brown drawer unit at
 * the east end, a cable tray under its back edge, a cyan LED strip under its front edge.
 */
export function deskBase(b: Build): DeskBase {
  const { R, g, ys } = b;
  const desk = deskSlab(g);
  desk.name = 'desk top';
  R.add(desk);
  const steel = mat(STEEL, { roughness: 0.45, metalness: 0.4 });
  deskLegs(b, steel);
  R.add(...drawerUnit(g));
  const base = { steel, pedX: g.desk.x1 - PED.in, under: ys + DESK_TOP };
  cableTray(R, steel, base.under);
  kneeLed(b, base);
  return base;
}
