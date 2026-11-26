// The desk's architect lamp and its light (`setDesk`).
import { lowDetail } from '@/core/render/three/detail';
import { mergeWithin } from '@/core/render/three/merge';
import { lamp } from '../props3d';
import type { Build } from './types';

/**
 * The architect lamp, and its light from the shade's mouth. (Low: its base, arms and joints in one draw, its shade's steel in another;
 * CITY-06. High keeps each mesh: `highident`. `pbr`: its steel keeps High's reflection of the room, the blue rim the monitor's wash gives the
 * shade's lip.)
 */
export function deskLamp({ room, R, g, ys, deskTop }: Build): void {
  const lx = g.lamp.x;
  room.lamp = lamp({ x: lx, y: ys }, { x: lx - 1300, y: ys - 3900 }, g.lamp.head, g.lamp.mouth, 2600);
  if (lowDetail()) {
    mergeWithin(room.lamp.root, { twin: room.envTwin, pbr: true });
  }
  R.add(room.lamp.root);
  const [mx, my, mz] = room.lamp.mouth;
  const ll = room.lampLight;
  ll.position.set(mx, my, mz);
  ll.target.position.set(mx + room.lamp.dir[0] * 4000, deskTop, mz + 2500);
  ll.castShadow = true;
  ll.shadow.mapSize.set(1024, 1024);
  ll.shadow.bias = -0.0005;
  ll.shadow.radius = 6;
  Object.assign(ll.shadow.camera, { near: 200, far: 90_000 });
  R.add(ll, ll.target);
}
