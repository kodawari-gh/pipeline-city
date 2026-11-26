// The window's part of the room's frame: the hour's sky and sun, the blinds, the light that comes in by the glass.
import { Color } from 'three';
import { skyAt } from '../../shell/room';
import { GLASS_T } from '../outside/view';
import { WINDOW, sunDir } from '../roomplan';
import { CITY_DAY, KEY_DECAY, KEY_REF, PROBE_K, smooth } from './consts';
import { aimSun } from './lights';
import type { RoomParts } from './types';

/** The hour of a frame, and how much of it is day (`daylight`) and night. */
interface Hour {
  hour: number;
  day: number;
  night: number;
}

/** The sun aimed for the hour and its colour, and the sky's light's colour, a step at a time (20 a game hour). */
export function skyStep(room: RoomParts, { hour, day, night }: Hour): void {
  const hk = Math.round(hour * 20);
  if (hk === room.sunKey) {
    return;
  }
  room.sunKey = hk;
  aimSun(room, hour);
  const s = skyAt(hour),
    low = 1 - Math.min(1, Math.max(0, sunDir(hour)[1] / 0.45));
  room.sun.color.set(0xff_f2_dc).lerp(new Color(s.hor), 0.25 + low * 0.6);
  if (day <= 0) {
    room.sun.color.set(0x8f_a6_ff);
  }
  // the sky's colour, paler; the low sun warms it a little; the night's is the moon's blue
  room.key.color
    .set(s.top)
    .lerp(new Color(0xff_ff_ff), 0.5)
    .lerp(room.sun.color, 0.2 * low * day)
    .lerp(new Color(0x6f_86_d8), night);
}

/** The blinds ease toward up or down; returns how open the window is (a drawn blind lets some light through). */
export function blindsStep(room: RoomParts, blind: boolean, dt: number): number {
  room.blindK += ((blind ? 1 : 0) - room.blindK) * (1 - 0.02 ** dt);
  const wh = WINDOW.h - 900,
    bh = Math.max(1, room.blindK * wh);
  for (const b of room.blinds) {
    b.scale.y = bh;
    b.position.y = -(WINDOW.y + 900) - bh / 2;
  }
  return 1 - room.blindK * 0.85;
}

/**
 * The day comes in by the window, the sky's light and the sun; the rest of the room has what bounces (the probe). At night a dim blue
 * moonlight: the lamps, the screen and the machine carry the room. (The glass looks north: the sun comes in only low, at the day's two ends,
 * from the side it stands to; the glass takes its share of all of it, `GLASS_T`, at every hour.)
 */
export function windowLight(room: RoomParts, { hour, day, night }: Hour, open: number): void {
  const sunIn = smooth(0.02, 0.12, -sunDir(hour)[2]);
  room.hour = hour;
  room.sunK = day * 5.8 * sunIn * open * GLASS_T;
  room.sun.intensity = room.sunK + night * 0.25 * open * GLASS_T;
  // (the sky's light, and the city's through the whole glass wall: by day its sunlit blocks, at night its glow, a soft blue light over the desk)
  room.skyK = (0.05 + day * 3) * open * GLASS_T;
  room.cityK = (day * 3 * CITY_DAY + night * 0.7) * open * GLASS_T;
  room.key.intensity = (room.skyK + room.cityK) * KEY_REF ** KEY_DECAY;
  const env = room.probe ? PROBE_K : 0.35 * (0.16 + 0.84 * day);
  room.envs.setStrength(env);
}
