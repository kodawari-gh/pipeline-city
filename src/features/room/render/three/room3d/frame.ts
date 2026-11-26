// The room's frame: the mail, the hour's sky and sun, the blinds, the window's light, the evening's lamps, the screen, the router and the
// plates, the clock and the tea's steam.
import { DARK, lightJack } from '@/features/network/render/jackleds';
import { STRIP_STAND_IN } from '../furniture/strips';
import { M } from '../outside/plan';
import { steam } from '../props3d';
import { daylight } from '../roomplan';
import {
  ARC_LM,
  BIAS_LM,
  DESK_LM,
  LANTERN_LM,
  PICTURE_LM,
  SCONCE_LM,
  SCREEN_NITS,
  STRIP_NITS,
  lumens,
  nits,
} from './consts';
import { mailStep } from './keys';
import { blindsStep, skyStep, windowLight } from './sky';
import type { RoomFrame, RoomParts } from './types';

/** The evening's three steps, each 0 to 1: the floor lantern and the shelves' strips at dusk, the bed's LED strips, the bedside lantern. */
interface Evening {
  dusk: number;
  led: number;
  bedside: number;
}

/** The desk lamp, the player's (a lamp is as bright by day as by night: the camera does not adapt). */
function deskLamp(room: RoomParts, on: boolean): void {
  room.lampLight.intensity = on ? lumens(DESK_LM, room.lampLight.angle) : 0;
  room.lamp.bulb.emissiveIntensity = on ? 3 : 0.05;
  room.lamp.inner.emissiveIntensity = on ? 0.6 : 0;
}

/** At dusk the floor lantern and the shelves' strips; capped strips light the books as a line light of their own (`stripLit`). */
function duskLamps(room: RoomParts, dusk: number): void {
  room.floorLight.intensity = dusk * lumens(LANTERN_LM);
  room.floorLamp.shade.emissiveIntensity = dusk * 1.1;
  room.floorLamp.glow.emissiveIntensity = dusk * 4;
  for (const l of room.strips.lights) {
    l.intensity = dusk * nits(STRIP_NITS);
  }
  const [strip] = room.strips.lights;
  if (strip) {
    STRIP_STAND_IN.colour.value.copy(strip.color).multiplyScalar(strip.visible ? 0 : strip.intensity);
  }
  room.strips.glow.emissiveIntensity = dusk * 1.6;
  // (the arc lamp is the desk's overhead cozy light: on at every hour)
  room.arc.light.intensity = lumens(ARC_LM, room.arc.light.angle);
  room.arc.glow.emissiveIntensity = 4;
  room.arc.shade.emissiveIntensity = 1.2;
}

/** As night falls the bedside lantern (a warm pool round the bed, its bulb glowing through the paper), the picture light and the door's sconce. */
function nightLamps(room: RoomParts, bedside: number): void {
  room.bedLight.intensity = bedside * lumens(LANTERN_LM);
  const pl = room.picture.light;
  pl.intensity = bedside * nits(PICTURE_LM / ((Math.PI * pl.width * pl.height) / (M * M)));
  room.picture.glow.emissiveIntensity = bedside * 1.6;
  room.sconce.up.intensity = bedside * lumens(SCONCE_LM, room.sconce.up.angle);
  room.sconce.down.intensity = bedside * lumens(SCONCE_LM, room.sconce.down.angle);
  room.sconce.glow.emissiveIntensity = bedside * 2;
  room.shade.emissiveIntensity = bedside * 1.1;
  room.bulbGlow.emissiveIntensity = bedside * 4;
}

/**
 * The evening comes on in three steps (the ceiling light stays off): at dusk the floor lantern and the shelves' strips; then the bed's cyan
 * LED strips (the floor round the bed, the wall over the headboard, the desk's underside); as night falls the bedside lantern, the picture
 * light and the door's sconce.
 */
function eveningLamps(room: RoomParts, night: number): Evening {
  const ramp = (a: number, b: number): number => Math.min(1, Math.max(0, (night - a) / (b - a)));
  const dusk = ramp(0.1, 0.4),
    led = ramp(0.2, 0.6),
    bedside = ramp(0.35, 0.65);
  duskLamps(room, dusk);
  nightLamps(room, bedside);
  room.ledGlow.emissiveIntensity = led * 3;
  room.ledUnder.intensity = led * 6;
  room.ledHalo.intensity = led * 10;
  room.deskLed.intensity = led * 18;
  return { dusk, led, bedside };
}

/** The screen's glow and the monitor's bias light (both stay in the scene at 0 without a monitor: the count of lights does not change). */
function screenLights(room: RoomParts, screen: RoomFrame['screen']): void {
  const lit = screen.installed && screen.powered;
  room.screenLight.intensity = lit ? nits(SCREEN_NITS) : 0;
  const { bias } = room.monitor;
  bias.intensity = lit ? nits(BIAS_LM / ((Math.PI * bias.width * bias.height) / (M * M))) : 0;
}

/** The monitor, the router on its spot (or its empty place) and its jacks' lights, the ISP plate's lights, the letterbox's light. */
function machineStep(room: RoomParts, f: RoomFrame): void {
  room.monitor.set(f.screen, f.hour);
  room.monitorSpot.visible = !f.screen.installed;
  room.routerBody.visible = f.router > 0;
  room.routerSpot.visible = f.router === 0;
  if (f.router > 0) {
    room.routerBuild(f.router);
  }
  // (the jacks' lights follow the frames the link carries; no router stands, or no game: they are out)
  const net = f.router > 0 ? (f.net ?? DARK) : DARK;
  lightJack(room.routerLamps?.lan, net.lan);
  lightJack(room.routerLamps?.wan, net.wan);
  for (const [k, m] of room.ispDots.entries()) {
    m.emissiveIntensity = k < f.isp ? 2 : 0;
  }
  room.mailLed.emissiveIntensity = f.mail ? 1.2 + 1.2 * Math.sin(f.t * 6) : 0;
}

/** The plan's name on the ISP plate, drawn again when it changes. */
function ispName(room: RoomParts, name: string): void {
  const it = room.ispText;
  if (!it || it.shown === name) {
    return;
  }
  it.shown = name;
  const c = it.cv.getContext('2d');
  if (!c) {
    return;
  }
  c.clearRect(0, 0, it.cv.width, it.cv.height);
  c.fillStyle = '#7fd8ff';
  c.font = '600 54px system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(name.toUpperCase(), it.cv.width / 2, it.cv.height / 2, it.cv.width - 24);
  it.tex.needsUpdate = true;
}

/** The room at frame `f`, `dt` seconds after the last. */
export function frameRoom(room: RoomParts, f: RoomFrame, dt: number): void {
  mailStep(room, f.t);
  const day = daylight(f.hour),
    hour = { hour: f.hour, day, night: 1 - day };
  room.outside.frame(f.hour, f.t);
  skyStep(room, hour);
  const open = blindsStep(room, f.blind, dt);
  windowLight(room, hour, open);
  deskLamp(room, f.lamp);
  const { dusk, led, bedside } = eveningLamps(room, hour.night);
  screenLights(room, f.screen);
  room.lightKey = `${room.sunKey >> 1}|${f.lamp}|${Math.round(room.blindK * 6)}|${f.screen.powered}|${Math.round(bedside * 4)}|${Math.round(led * 4)}|${Math.round(dusk * 4)}|${room.choice.live.size}`;
  machineStep(room, f);
  ispName(room, f.ispName);
  room.clock.set(f.hour);
  steam(room.cup, f.t);
}
