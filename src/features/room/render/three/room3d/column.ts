// On the building's column and by it: the clock over the router on its shelf, the key stand on the desk, the router and its empty place (the
// letterbox and the plates: `buildPlates`).
import { Group, MeshStandardMaterial } from 'three';
import { SEG, drum, rectBox, softBox } from '@/core/render/three/geometry';
import { mergeWithin } from '@/core/render/three/merge';
import { tag, unseen } from '@/core/render/three/pick';
import { ROUTER_SPOT, SHELF_Y } from '@/features/board/render/layout/layout';
import { KEY_LEN, trayHook, trayKeyCentre } from '../../desk/props/props';
import { DigitalClock } from '../props3d';
import { CLOCK_Y, KEY_STAND, PIER } from '../roomplan';
import { makeRouter } from './router';
import type { Build, Material } from './types';

/** The rack's two rows of hooks: a bar each, five chrome hooks on it. */
function hookRows({ g, dark, chrome }: Build, rack: Group): void {
  const kr = g.keyRack;
  for (let row = 0; row < 2; row++) {
    const { y } = trayHook(row * 5);
    rack.add(softBox({ x: kr.x + 120, y: y - 110, w: kr.w - 240 + row * 330, h: 220 }, 0, 200, dark, 40));
    for (let col = 0; col < 5; col++) {
      const h = trayHook(row * 5 + col);
      rack.add(drum(h.x, h.y, 200, 420, 40, chrome, SEG.midRound));
    }
  }
}

/**
 * The key stand on the desk west of the monitor: the 2D rack's two rows of hooks on a black steel frame, two uprights on feet. It is the rack
 * moved off the wall (`standAt`), so the keys keep their 2D places in it; the lowest key hangs clear of the desk.
 */
function keyStand(b: Build, steel: Material): void {
  const { room, R, g, ys } = b;
  const rack = tag(new Group(), 'tray'),
    kr = g.keyRack,
    bar1 = kr.x + kr.w + 210;
  const low = Math.max(...[5, 6, 7, 8, 9].map((i) => trayKeyCentre(i).y)) + KEY_LEN / 2,
    foot = low + 300;
  hookRows(b, rack);
  const rackTop = trayHook(0).y - 300;
  for (const x of [kr.x - 60, bar1]) {
    rack.add(softBox({ x, y: rackTop, w: 180, h: foot - rackTop }, -40, 240, steel, 40));
    rack.add(softBox({ x: x - 40, y: foot - 140, w: 260, h: 140 }, -900, 1300, steel, 40));
  }
  // (a new key's letter comes to the stand: it is in `keys`, so it floats in beside the rack as on the 2D wall)
  const stand = new Group();
  stand.position.set(KEY_STAND.x - kr.x, foot - ys, KEY_STAND.z);
  mergeWithin(rack, { twin: room.envTwin }); // (the rack's bars and hooks in a few draws, every tier: MACH-02, docs/render/three.md "Merges")
  stand.add(rack, room.keys);
  stand.name = 'key stand';
  R.add(stand);
}

/** The router's shelf, the router on it, and its empty place: an unseen box a router dragged from the inventory lands on (`router`), there while no router stands. */
function routerShelf({ room, R, dark }: Build): void {
  const shelf = softBox({ x: ROUTER_SPOT.x - 300, y: SHELF_Y, w: ROUTER_SPOT.w + 600, h: 140 }, 0, 1700, dark, 30);
  shelf.name = 'router shelf';
  R.add(shelf);
  const router = makeRouter(room);
  R.add(router);
  room.routerBody = router;
  const spot = new MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false });
  room.routerSpot = tag(rectBox(ROUTER_SPOT, 300, 1400, spot), 'router');
  R.add(unseen(room.routerSpot));
  // (the LAN lead is the machine's: a cable with a plug to move, `Machine3D.buildRoomCords`)
}

/** On the building's column: the clock over the router on its shelf; the key stand on the desk (`steel`: its frame's). */
export function buildColumn(b: Build, steel: Material): void {
  const { room, R, g } = b;
  room.clock = new DigitalClock({ ...g.clock, x: (PIER.x0 + PIER.x1) / 2 - g.clock.w / 2, y: CLOCK_Y });
  R.add(room.clock.root);
  keyStand(b, steel);
  routerShelf(b);
}
