// The furniture: the bed and its LED strips, the bedside drawer and its lantern, the bookcase, the door, the ceiling light, a print over the
// bed, plants, the floor lantern, the picture light, the door's sconce and the arc lamp.
import { bookcase } from '../furniture/bookcase';
import { door } from '../furniture/door';
import { eastWall } from '../furniture/eastwall';
import { floorLantern } from '../furniture/lanterns';
import { ceilingLight, print } from '../furniture/walls';
import { NEON_WASH } from '../palette';
import { FIG_AT, floorPlant } from '../plants3d';
import { CEIL_Y } from '../roomplan';
import { BEDSIDE_LAYER, LANTERN_FAR, PRINT } from './consts';
import type { Bed, Bedside, Build, Lantern, PointLight, RoomParts } from './types';

/** A lantern's paper and its bulb let the light through: they cast no shadow, the paper glows with it. */
function glassy(l: Lantern): void {
  l.root.traverse((o) => {
    const m: unknown = 'material' in o ? o.material : undefined;
    if (m === l.shade || m === l.glow) {
      o.castShadow = false;
    }
  });
}

/** A lantern's shadow: soft, and with no cut-off distance its shadow camera keeps its own range, which must reach across the room. */
function lanternShadow(l: PointLight): void {
  Object.assign(l.shadow.camera, { near: 200, far: LANTERN_FAR });
  l.shadow.bias = -0.002;
  l.shadow.normalBias = 20;
}

/** The bed's LED strips (every strip casts the one pale wash, the desk's too) and the bedside lantern, its shadow on the nightstand and the bed. */
function bedLights(room: RoomParts, bd: Bed, ns: Bedside): void {
  room.ledGlow = bd.glow;
  room.ledUnder = bd.under;
  room.ledHalo = bd.halo;
  room.ledUnder.color.setHex(NEON_WASH);
  room.ledHalo.color.setHex(NEON_WASH);
  room.shade = ns.shade;
  room.bulbGlow = ns.glow;
  room.bedLight.position.set(...ns.bulb);
  // the lantern's shadow: the nightstand, the bed and the pillows in its light, softly
  lanternShadow(room.bedLight);
  glassy(ns);
  for (const r of [ns.root, bd.root]) {
    r.traverse((o) => {
      if (o.castShadow) {
        o.layers.enable(BEDSIDE_LAYER);
      }
    });
  }
}

/** The floor lantern's shadow: the bookcase's end, the fig's leaves on the west wall and the floor. */
function floorLamp(room: RoomParts): void {
  room.floorLamp = floorLantern();
  glassy(room.floorLamp);
  room.floorLight.position.set(...room.floorLamp.bulb);
  lanternShadow(room.floorLight);
}

/** The print over the bed, the picture light, the door's sconce and the arc lamp (its shadow reaches from its dome to the floor). */
function wallLights({ room, R }: Build): void {
  const printed = print(PRINT, 0);
  printed.name = 'print';
  room.picture.root.name = 'picture';
  room.sconce.root.name = 'sconce';
  room.arc.root.name = 'arc lamp';
  R.add(printed, room.picture.root, room.sconce.root, room.arc.root);
  const al = room.arc.light;
  Object.assign(al.shadow.camera, { near: 300, far: 60_000 });
  al.shadow.bias = -0.0005;
  al.shadow.normalBias = 10;
}

/** The furniture round the bed (`bd`) and its nightstand (`ns`), which the build made a turn before. */
export function furnish(b: Build, bd: Bed, ns: Bedside): void {
  const { room, R } = b;
  bedLights(room, bd, ns);
  floorLamp(room);
  const top = ceilingLight(4000, CEIL_Y, 30_000);
  const bookshelf = bookcase(),
    dr = door(),
    plant = floorPlant(FIG_AT.x, FIG_AT.z),
    ew = eastWall();
  bd.root.name = 'bed';
  ns.root.name = 'nightstand';
  bookshelf.name = 'bookcase';
  dr.name = 'door';
  top.root.name = 'ceiling light';
  plant.name = 'floor plant';
  ew.name = 'east wall';
  room.floorLamp.root.name = 'floor lamp';
  R.add(
    bd.root,
    ns.root,
    bookshelf,
    dr,
    top.root,
    plant,
    ew,
    room.bedLight,
    room.floorLamp.root,
    room.floorLight,
    room.strips.root,
  );
  wallLights(b);
}
