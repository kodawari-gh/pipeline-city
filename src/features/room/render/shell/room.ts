import { mix } from '@/core/render/ink';
import type { Beam, LightGeo } from './light';
import { FADE } from './shell';
import { KEYBOARD, keyboardPlacer } from '../desk/peripherals';
import { deskGeo, roomPersp, type Persp } from './persp';
import {
  CASE, CASE_IN, SCREEN, DESK_SLAB, DESK_UNDER, DESK_Y, FLOOR_Y, FOOT, MONITOR, POWER_PLATE, ROUTER_SPOT, TRAY, type Rect,
} from '@/features/board/render/layout/layout';

// The room the machine lives in (docs/render/room/room.md "The room"): a bedroom wall, a long desk and what stands on it, seen from the front
// like the rest of the world. It is all scenery behind the machine: one static art container plus a few live parts (the sky in
// the window, the wall's light, the lamp's glow, the mug's steam, the clock's hands) that follow the game clock. The lamp and the
// window blind are the only things that answer a click.

/** The desk's slab and the height of the space under it, and the feet the case stands on (all in `layout.ts`: the monitor, the riser, the router and the plates follow the same desk top). */
export const DESK = { slab: DESK_SLAB, under: DESK_UNDER };
export { FOOT };
/** How far the desk reaches west of the lamp (which stands at its very west end) and east of the case (which is the last thing on it). */
const DESK_WEST = 1500, DESK_EAST = 500;
/** How much wall the camera may show beyond the desk's and the window's ends, and below the wall socket (no floor); the top is the router or the window, whichever is higher. */
const BOX_SIDE = 900, BOX_BELOW = 2200, BOX_TOP_ABOVE = 500;
/** How much wall there is above the highest thing on it, up to the ceiling. */
const CEIL_ABOVE = 2700;
/** The lamp's hood points down and east from the desk's west end (SIDE 1; -1 would mirror it): the direction the light leaves the mouth in. */
const SIDE = 1, LAMP_D = { x: 0.766 * SIDE, y: 0.643 };
/** The lamp's head joint (offset from the base on the desk top) and the hood's length from the arm's end to its mouth. */
const LAMP = { head: { x: 1400 * SIDE, y: -7600 }, reach: 1500 };

/** Y of the desk's top surface: the case stands on it, so it follows the case (a taller case sits lower on the desk). */
export const deskY = () => DESK_Y;

export interface RoomGeo {
  /** The desk's top surface, the floor, and the desk's west and east ends (the east end follows the case's width). */
  ys: number;
  floor: number;
  /** Where the wall meets the ceiling. */
  ceil: number;
  /** The room's one perspective (`persp.ts`): the floor, the desk and the window's recess meet at its vanishing point. */
  persp: Persp;
  desk: { x0: number; x1: number };
  /** The mug's centre x (east of the case; the steam rises from it). */
  mug: number;
  /** The wall socket under the desk (its plate and its two outlets, left for the monitor, right for the PC). */
  socket: { plate: Rect; mon: { x: number; y: number }; pc: { x: number; y: number } };
  /** The window (its glass) and the blind that covers it. */
  window: Rect;
  /** The digital wall clock's body, above the case. */
  clock: Rect;
  /** The desk lamp: its base x, and the box that answers a click. */
  lamp: { x: number; head: { x: number; y: number }; mouth: { x: number; y: number }; rect: Rect };
  /** The key rack on the wall above the monitor: two rails with five hooks each, the sticks hang from them on lanyards. */
  keyRack: Rect;
  /** The corner of the router shelf (the room draws the plank under the router). */
  top: number;
}

/** The camera cap: the zoom-out stops where this box fills the screen, and panning stays inside it: the desk and the window with a little wall beyond, from just above the router shelf (or the window) to just under the wall socket (no floor, no ceiling; the wall itself reaches much further). Follows the case. */
export function roomBox(geo: RoomGeo = roomGeo()): Rect {
  const bottom = geo.floor + BOX_BELOW, top = geo.top - BOX_TOP_ABOVE, x0 = Math.min(geo.desk.x0, geo.window.x - 420) - BOX_SIDE;
  return { x: x0, y: top, w: geo.desk.x1 + BOX_SIDE - x0, h: bottom - top };
}

/** The room's static art (the wall, the desk) is baked to two textures while the camera is far out: the region they cover (the camera box and some wall around it, for a screen that is wider or taller than the box), and the texture's pixels per world unit. */
export const ROOM_BAKE_RES = 0.09;
export const roomBakeRect = (geo: RoomGeo = roomGeo()): Rect => { const b = roomBox(geo), y0 = geo.ceil - FADE.ceil - 500, y1 = geo.floor + FADE.floor + 500; return { x: b.x - 2500, y: y0, w: b.w + 5000, h: y1 - y0 }; };

/** Whether the baked art fits `view` (a world rect) at zoom `z` on a display with `dpr` pixels per css pixel: the view lies inside the region and is no finer than the texture. */
export function roomBakeFits(view: Rect, z: number, dpr: number, geo: RoomGeo = roomGeo()): boolean {
  const r = roomBakeRect(geo);
  return z * dpr <= ROOM_BAKE_RES * 1.2 && view.x >= r.x && view.y >= r.y && view.x + view.w <= r.x + r.w && view.y + view.h <= r.y + r.h;
}

/** Whether `view` lies inside `cover` (shrunk by `margin`): the case's interior fills the screen there, so the room behind it need not be drawn. */
export function roomHidden(view: Rect, cover: Rect, margin = 200): boolean {
  return view.x >= cover.x + margin && view.y >= cover.y + margin && view.x + view.w <= cover.x + cover.w - margin && view.y + view.h <= cover.y + cover.h - margin;
}

/**
 * The window's light at height `y` below the glass, for a light that moves `slant` units west for every unit down (negative: east): the x
 * span of the shaft, whose edges are the rays from the glass's top-left and bottom-right corners (top-right and bottom-left when it runs east).
 */
export function shaftSpan(w: Rect, y: number, slant: number): { xl: number; xr: number } {
  const dx = slant * (y - w.y), dxb = slant * (y - w.y - w.h), below = y >= w.y + w.h;
  if (slant >= 0) return { xl: w.x - dx, xr: below ? w.x + w.w - dxb : w.x };
  return { xl: below ? w.x - dxb : w.x + w.w, xr: w.x + w.w - dx };
}

export function roomGeo(): RoomGeo {
  const ys = deskY(), east = CASE.x + CASE.w, lx = MONITOR.x - 3600, plate = POWER_PLATE;
  // the window: west of the desk, the whole height of the wall: from just under the top of the highest thing on it (the key rack) down to its sill, which is just above the desk top's height
  const clock: Rect = { x: CASE.x + CASE.w / 2 - 1500, y: Math.min(-5500, CASE.y - 1500), w: 3000, h: 1100 };
  const WIN_W = 5600, winTop = Math.min(clock.y, ROUTER_SPOT.y, TRAY.y) + 190, WIN_H = ys - 700 - winTop;
  const window: Rect = { x: lx - DESK_WEST - 250 - WIN_W, y: winTop, w: WIN_W, h: WIN_H };
  const head = { x: lx + LAMP.head.x, y: ys + LAMP.head.y };
  const ceil = Math.min(window.y - 190, clock.y, ROUTER_SPOT.y, TRAY.y) - CEIL_ABOVE, desk = { x0: lx - DESK_WEST, x1: east + DESK_EAST };
  return {
    ys,
    floor: FLOOR_Y,
    ceil,
    persp: roomPersp({ ceil, floor: FLOOR_Y, ...desk }),
    desk,
    mug: MONITOR.x + MONITOR.w + 710,
    socket: { plate, mon: { x: plate.x + plate.w * 0.28, y: plate.y + plate.h / 2 }, pc: { x: plate.x + plate.w * 0.72, y: plate.y + plate.h / 2 } },
    window,
    clock,
    lamp: { x: lx, head, mouth: { x: head.x + LAMP_D.x * LAMP.reach, y: head.y + LAMP_D.y * LAMP.reach }, rect: { x: lx - 1900, y: ys - 8300, w: 6600, h: 8300 } },
    keyRack: TRAY,
    top: Math.min(window.y - 190, clock.y, ROUTER_SPOT.y, TRAY.y),
  };
}

export interface RoomState { lamp: boolean; blind: boolean }
const KEY = 'pipeline-city.room';
export const roomState: RoomState = { lamp: true, blind: false };
/** Dev and tests: pin the hour of the day (null follows the game clock). */
export const roomDebug: { hour: number | null } = { hour: null };
try {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
  if (raw) { const o = JSON.parse(raw) as Partial<RoomState>; roomState.lamp = o.lamp ?? true; roomState.blind = o.blind ?? false; }
} catch { /* private window or blocked storage: the defaults stand */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(roomState)); } catch { /* nothing to keep it in */ } };
/** A click on a room prop (`lamp`, `blind`). Returns whether the id was one. */
export function roomClick(id: string): boolean {
  if (id === 'lamp') roomState.lamp = !roomState.lamp;
  else if (id === 'blind') roomState.blind = !roomState.blind;
  else if (id === 'clock' || id === 'mail') return true; // scenery that only answers the pointer: it has a ring and a tip, no state
  else return false;
  save();
  return true;
}
export const ROOM_IDS = ['lamp', 'blind', 'clock'] as const;
export const isRoomId = (id: string) => (ROOM_IDS as readonly string[]).includes(id);

// ---- time of day: one day is `DAY_S` seconds of game time, and the first view is the evening ----
export const DAY_S = 1800;
export const START_HOUR = 18.6;
const sstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
/** The hour (0 to 24) of the room's clock at game time `gt` (ms). */
export const hourAt = (gt: number) => (((START_HOUR + (gt / 1000 / DAY_S) * 24) % 24) + 24) % 24;
/** 0 in full daylight, 1 at night; the dawn and the dusk are the ramps in between. */
export const nightAt = (h: number) => (h < 12 ? 1 - sstep(5, 7.2, h) : sstep(17.4, 19.6, h));
/** 1 at sunrise and sunset, 0 away from them: the warm hour. */
export const duskAt = (h: number) => Math.max(0, 1 - Math.abs(h - 6.1) / 1.5, 1 - Math.abs(h - 18.5) / 1.6);

const SKY: { h: number; top: string; hor: string }[] = [
  { h: 0, top: '#050816', hor: '#0c1232' }, { h: 4.6, top: '#070a1c', hor: '#161a3e' }, { h: 6, top: '#2b2f63', hor: '#f08a5d' },
  { h: 7.6, top: '#4f8fd8', hor: '#ffd9a8' }, { h: 12, top: '#3d86e0', hor: '#c2e7ff' }, { h: 17, top: '#4a8ad8', hor: '#ffe2b0' },
  { h: 18.5, top: '#3b3d86', hor: '#ff8f4f' }, { h: 20, top: '#121440', hor: '#3b2a5c' }, { h: 24, top: '#050816', hor: '#0c1232' },
];
/** The sky's top and horizon colours at an hour. */
export function skyAt(h: number): { top: string; hor: string } {
  let i = 0;
  while (i < SKY.length - 2 && h >= SKY[i + 1]!.h) i++;
  const a = SKY[i]!, b = SKY[i + 1]!, t = (h - a.h) / (b.h - a.h);
  return { top: mix(a.top, b.top, t), hor: mix(a.hor, b.hor, t) };
}

/** The places the room's light is cut around, from the layout of the moment (the case follows the tier). The keyboard is its sloped top: `y` its front edge, `h` how far it runs back. */
export function lightGeo(geo: RoomGeo): LightGeo {
  const dk = deskGeo(geo.persp, geo.ys, geo.floor), kp = keyboardPlacer(dk, MONITOR.x + MONITOR.w / 2), kf = kp(-KEYBOARD.w / 2, KEYBOARD.d / 2, KEYBOARD.h), kg = kp(KEYBOARD.w / 2, KEYBOARD.d / 2, KEYBOARD.h);
  return {
    window: geo.window, region: roomBakeRect(geo), case: CASE, inner: CASE_IN, monitor: MONITOR, screen: SCREEN, router: ROUTER_SPOT, clock: geo.clock, mouth: geo.lamp.mouth, dir: LAMP_D, ys: geo.ys,
    keyboard: { x: Math.min(kf[0], kg[0]), y: Math.max(kf[1], kg[1]), w: Math.abs(kg[0] - kf[0]), h: 330 }, deskTop: dk.yFront, deskBack: dk.yBack,
  };
}

/** Where the sun and the moon are at an hour: how far through their arc across the sky (0 rising, 1 setting), or null while below the horizon. */
export function bodiesAt(h: number): { sun: number | null; moon: number | null } {
  const sunT = (h - 5.6) / 12.8, moonT = ((h + 6) % 24) / 12.6;
  return { sun: sunT > 0 && sunT < 1 ? sunT : null, moon: moonT > 0 && moonT < 1 ? moonT : null };
}

/**
 * The lights the window lets in at an hour: for the sun and the moon above the horizon, the slant of the shaft (units west per unit down, negative east:
 * a body west of the window's centre (small `t`) shines east and the other way round, a high one almost straight down, a low one long and flat), its
 * strength (0 to 1, with the sky's brightness) and its colour (the sun warm when low).
 */
export function lightsAt(h: number): { body: 'sun' | 'moon'; slant: number; strength: number; color: string }[] {
  const out: { body: 'sun' | 'moon'; slant: number; strength: number; color: string }[] = [];
  const b = bodiesAt(h);
  const one = (body: 'sun' | 'moon', t: number, k: number, color: (el: number) => string) => {
    const el = Math.sin(Math.PI * t), u = 0.12 + 0.76 * t, edge = sstep(0, 0.05, t) * sstep(0, 0.05, 1 - t);
    out.push({ body, slant: (u - 0.5) * 2 * (0.35 + 1.4 * (1 - el)), strength: k * Math.pow(el, 0.6) * edge, color: color(el) });
  };
  if (b.sun !== null) one('sun', b.sun, 0.17, (el) => mix('#ffa060', '#fff0c8', Math.pow(el, 0.5)));
  if (b.moon !== null) one('moon', b.moon, 0.05, () => '#aebfff');
  return out;
}

/**
 * The window's light as the slices the light layer draws (`light.ts`): for each body above the horizon a shaft that leaves the glass in the direction it
 * shines from, strongest at the glass and fading out by the desk (the slices step down 12 times between the sill and the desk top, each keeping `fade` of
 * the strength), and a flat patch where it reaches the desk top. `blind` (0 open, 1 down) takes it away.
 */
export function beamsAt(geo: RoomGeo, h: number, blind: number): Beam[] {
  const w = geo.window, ys = geo.ys, out: Beam[] = [];
  for (const L of lightsAt(h)) {
    const a = L.strength * (1 - blind);
    if (a < 0.003) continue;
    const yb = w.y + w.h, ya0 = [w.y, yb, ...Array.from({ length: 12 }, (_, k) => yb + ((ys - yb) * (k + 1)) / 12)], quads: Beam['quads'] = [];
    for (let k = 0; k + 1 < ya0.length; k++) {
      const ya = ya0[k]!, ye = ya0[k + 1]!, top = shaftSpan(w, ya, L.slant), bot = shaftSpan(w, ye - 0.01, L.slant);
      quads.push({ pts: [top.xl, ya, top.xr, ya, bot.xr, ye + 3, bot.xl, ye + 3], fade: Math.pow(1 - Math.max(0, ya - yb) / (ys - yb), 1.4) });
    }
    const hit = shaftSpan(w, ys, L.slant), xa = Math.max(hit.xl, geo.desk.x0), xb = Math.min(hit.xr, geo.desk.x1);
    out.push({ color: L.color, a, slant: L.slant, quads, patch: xb - xa > 200 ? { x: (xa + xb) / 2, y: ys + 26, rx: (xb - xa) / 2, ry: 70 } : null });
  }
  return out;
}

