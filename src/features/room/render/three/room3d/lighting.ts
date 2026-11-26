// The room's light: the window carries the day (the sky's soft light and the sun, both let in by the opening alone, so the room is lit from
// one side and falls off away from it); the room's bounce is baked on the still meshes (`takeBake`) and its probe on the rest (`setProbe`);
// the lamps, the screen.
import { SCREEN } from '@/features/board/render/layout/layout';

import { boxEnv } from '@/core/render/three/boxenv';
import { RoomEnv } from '../roomenv';
import { CEIL_Y, DESK_D, EAST_X, FLOOR_Y, FRONT_Z, MONITOR_Z, WALL_T, WEST_X, WINDOW } from '../roomplan';
import { GLASS_Z, SUN_D } from './consts';
import type { Build, Texture } from './types';

/** The sky's light, high and far out behind the glass's middle: the north sky's light comes down through the whole glass wall onto the desk. */
function skyLight({ room, R, g, deskTop }: Build): void {
  const W = WINDOW,
    cx = (g.desk.x0 + g.desk.x1) / 2,
    wc = [W.x + W.w / 2, -(W.y + W.h / 2), GLASS_Z] as const,
    k = room.key;
  k.position.set(wc[0], wc[1] + 12_000, -WALL_T - 20_000);
  k.target.position.set(cx - 4000, deskTop - 2000, DESK_D + 4000);
  k.castShadow = true;
  k.shadow.mapSize.set(4096, 4096);
  Object.assign(k.shadow.camera, { near: 2000, far: 140_000 });
  k.shadow.bias = -0.0003;
  k.shadow.normalBias = 20;
  k.shadow.radius = 14;
  R.add(k, k.target);
}

/** The sun (aimed by the frame, `aimSun`), and the screen's glow on the panel's face, turned to the room (an area light shines along its -z). */
function sunAndScreen({ room, R }: Build): void {
  const s = room.sun;
  s.castShadow = true;
  s.shadow.mapSize.set(2048, 2048);
  Object.assign(s.shadow.camera, { near: SUN_D - 30_000, far: SUN_D + 90_000 });
  s.shadow.bias = -0.0002;
  s.shadow.normalBias = 30;
  s.shadow.radius = 5;
  R.add(s, s.target);
  const l = room.screenLight;
  l.width = SCREEN.w;
  l.height = SCREEN.h;
  l.position.set(SCREEN.x + SCREEN.w / 2, -(SCREEN.y + SCREEN.h / 2), MONITOR_Z + 200);
  l.rotation.y = Math.PI;
  R.add(l);
}

/**
 * The window's light, the sun, the screen's; then the room's own reflections: the studio's environment at first (`env`), set on each of its
 * materials so the evening can dim them, then the probe's; a model that loads late (the mouse, the hoodie) joins them.
 */
export function lightRig(b: Build, env: Texture | null): void {
  const { room, R } = b;
  skyLight(b);
  sunAndScreen(b);
  room.box = boxEnv([WEST_X, -FLOOR_Y, 0], [EAST_X, -CEIL_Y, FRONT_Z], room.probeAt);
  room.envs = new RoomEnv(env, room.box);
  room.envs.adopt(R);
}
