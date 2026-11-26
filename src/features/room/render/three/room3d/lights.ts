// The room's lights: their groups for the bake's mix, the casters, the lights by name, the baked bounce's mix and the sun's aim.
import { keyFrames } from '@/core/render/three/lightmapmix';
import { bounceLift } from '../roomlights';
import { WINDOW, sunDir } from '../roomplan';
import { GLASS_Z, SKY_K, SUN_D, SUN_HOURS } from './consts';
import type { Color, Light, LightId, PointLight, RoomParts, SpotLight, WebGLRenderer } from './types';

/**
 * The baked bounce's light groups: the lights the room scales by one value (a switch, a step of the evening). `tools/bake/` bakes each at
 * its lights' full power, and the mix scales it by its first light's intensity over the one baked.
 */
export function lightGroups(room: RoomParts): { id: string; lights: Light[] }[] {
  return [
    { id: 'desk', lights: [room.lampLight] },
    { id: 'arc', lights: [room.arc.light] },
    { id: 'floor', lights: [room.floorLight] },
    { id: 'bedside', lights: [room.bedLight] },
    { id: 'strips', lights: room.strips.lights },
    { id: 'picture', lights: [room.picture.light] },
    { id: 'sconce', lights: [room.sconce.up, room.sconce.down] },
    { id: 'led', lights: [room.ledUnder, room.ledHalo, room.deskLed] },
    { id: 'screen', lights: [room.screenLight, room.monitor.bias] },
  ];
}

/** The lights that cast shadows, in `SHADOW_LEVELS`' order. */
export function castersOf(room: RoomParts): (SpotLight | PointLight)[] {
  return [room.key, room.sun, room.lampLight, room.bedLight, room.floorLight, room.arc.light];
}

/** The room's lights by their name in `LIGHT_ORDER` (roomlights.ts). */
const LIGHTS: Record<LightId, (room: RoomParts) => Light[]> = {
  key: (room) => [room.key],
  sun: (room) => [room.sun],
  arc: (room) => [room.arc.light],
  desk: (room) => [room.lampLight],
  floor: (room) => [room.floorLight],
  bedside: (room) => [room.bedLight],
  sconce: (room) => [room.sconce.up, room.sconce.down],
  screen: (room) => [room.screenLight],
  deskLed: (room) => [room.deskLed],
  picture: (room) => [room.picture.light],
  ledHalo: (room) => [room.ledHalo],
  ledUnder: (room) => [room.ledUnder],
  bias: (room) => [room.monitor.bias],
  strips: (room) => room.strips.lights,
  // (the machine's: `Machine3D.setLights`)
  case: () => [],
  spill: () => [],
};

/** The room's lights by their name in `LIGHT_ORDER` (roomlights.ts). */
export const lightsOf = (room: RoomParts, id: LightId): Light[] => LIGHTS[id](room);

/** The baked bounce for the light as it stands, summed again only when that light changes (`lightKey`). */
export function mixLight(room: RoomParts, renderer: WebGLRenderer): void {
  const lm = room.lightmap;
  if (!lm || room.mixKey === room.lightKey) {
    return;
  }
  room.mixKey = room.lightKey;
  const levels = new Map<string, number | Color>(),
    direct = new Map<string, number>();
  // (a capped lamp's light is out of the scene, its level is not: its bounce stays, and the bake's direct light of its group stands in for
  // its pool; a bake without it lifts the bounce in its place, `CAPPED_BOUNCE`)
  for (const g of lightGroups(room)) {
    const level = g.lights[0]?.intensity ?? 0,
      capped = g.lights.filter((l) => !l.visible).length;
    if (capped && lm.hasDirect(g.id)) {
      levels.set(g.id, level);
      direct.set(g.id, level * (capped / g.lights.length));
    } else {
      levels.set(g.id, level * bounceLift(capped, g.lights.length));
    }
  }
  levels.set('sky', room.key.color.clone().multiplyScalar(room.skyK * SKY_K));
  levels.set('city', room.key.color.clone().multiplyScalar(room.cityK * SKY_K));
  for (const [h, w] of keyFrames(room.hour, SUN_HOURS)) {
    levels.set(`sun-${h}`, room.sun.color.clone().multiplyScalar(room.sunK * w));
  }
  lm.mix(renderer, levels, direct);
}

/**
 * The sun at an hour: a spot far out along its direction, aimed through the window's middle. Its shadow is drawn again when it moves; through
 * the night it stands still (`sunDir`), so the moon's shaft it gives keeps its map.
 */
export function aimSun(room: RoomParts, hour: number): void {
  const d = sunDir(hour),
    W = WINDOW,
    c = [W.x + W.w / 2, -(W.y + W.h / 2), GLASS_Z] as const,
    p = room.sun.position;
  const x = c[0] + d[0] * SUN_D,
    y = c[1] + d[1] * SUN_D,
    z = c[2] + d[2] * SUN_D;
  if (p.x === x && p.y === y && p.z === z) {
    return;
  }
  p.set(x, y, z);
  room.sun.target.position.set(c[0] - d[0] * 20_000, c[1] - d[1] * 20_000, c[2] - d[2] * 20_000);
  room.sun.shadow.needsUpdate = true;
}
