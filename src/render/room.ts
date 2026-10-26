import { Container, Graphics, Rectangle, type Renderer } from 'pixi.js';
import { disc, label, mix } from './ink';
import { drawAircraft, drawCityLive, drawClouds, drawSkyline, drawStars } from './skyline';
import { acPlug, metalOf } from './ports';
import { trayHook } from './props';
import { LightView, type Beam, type LightGeo } from './light';
import { roundedPath } from './routes';
import { drawMug, MUG } from './mug';
import { Steam } from './steam';
import { drawSlats } from './wall';
import { drawCeiling, drawCrown, drawFloor, FADE } from './shell';
import { captureShape } from './capture';
import { drawPlant, drawRug } from './decor';
import { drawDesk, drawDeskShadow, drawUnderDesk } from './desk';
import { deskGeo, roomPersp, S_FRONT, type Persp } from './persp';
import { lazyShape, rectShape, type Shape } from './shape';
import {
  CASE, CASE_IN, SCREEN, DESK_SLAB, DESK_UNDER, DESK_Y, FLOOR_Y, FOOT, MONITOR, MONITOR_POWER, PC_POWER, OUTBOX, PC_CORD_X, POWER_PLATE, ROUTER_SPOT, ROW_DROP, SHELF_Y, TRAY, TRAY_COLS, TRAY_ROWS, type Rect,
} from './layout';
import type { Theme } from './theme';

// The room the machine lives in (docs/RENDER.md "The room"): a bedroom wall, a long desk and what stands on it, seen from the front
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
/**
 * The lamp stands at the desk's west end: a weighted base, a lower arm that leans back (west, away from the work), an elbow, an upper arm that reaches
 * forward over the desk (east), and a hood on its end pointing down and east (SIDE 1; -1 would mirror it) at `LAMP_D`. The joints are offsets from the base
 * centre on the desk top (x east, y up is negative); `reach` is the hood's length from the arm's end to its mouth, `hood` its half width at the mouth.
 */
const SIDE = 1, LAMP_D = { x: 0.766 * SIDE, y: 0.643 };
const LAMP = { pivot: { x: 0, y: -300 }, elbow: { x: -1300 * SIDE, y: -3900 }, head: { x: 1400 * SIDE, y: -7600 }, reach: 1500, hood: 760, neck: 180, base: 1100 };

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
  const clock: Rect = { x: CASE.x + CASE.w / 2 - 1500, y: -5500, w: 3000, h: 1100 };
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
  else return false;
  save();
  return true;
}
export const ROOM_IDS = ['lamp', 'blind'] as const;
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

// ---- the palette ----
interface Look {
  wall: string; wallLo: string; wood: string; woodHi: string; woodLo: string; edge: string; line: string;
  paper: string; ink: string; cork: string; metal: string; metalLo: string; plastic: string; plasticLo: string; cloth: string;
}
const look = (T: Theme): Look => T.dark
  ? {
    wall: '#121a31', wallLo: '#0d1327', wood: '#3a2a2e', woodHi: '#4d3a3d', woodLo: '#241a1d', edge: '#6b5558', line: '#2a3768',
    paper: '#aeb8d4', ink: '#2b3560', cork: '#5a4634', metal: '#7d8bb0', metalLo: '#4a5679', plastic: '#2a3252', plasticLo: '#1b2140', cloth: '#5a4a86',
  }
  : {
    wall: '#d3e3ea', wallLo: '#c0d3de', wood: '#c39b72', woodHi: '#d8b68f', woodLo: '#a37c58', edge: '#8a6a4c', line: '#9aabc8',
    paper: '#fbfcff', ink: '#2c3a63', cork: '#c9a26c', metal: '#8d99b4', metalLo: '#6b7794', plastic: '#e9eef6', plasticLo: '#c4cedf', cloth: '#7a63c4',
  };

/** A soft shadow of a thing standing on the desk top, on the top (three ellipses, each smaller and darker; a little toward the viewer and the east, away from the lamp and the window). */
const shadow = (g: Graphics, x: number, y: number, w: number, a = 0.3) => {
  for (let k = 0; k < 3; k++) g.ellipse(x + w * 0.015, y + 70, w / 2 + (2 - k) * 110, 130 + (2 - k) * 80).fill({ color: '#000000', alpha: a / 2.2 });
};

/** The clock's LED colour. */
const ledColor = (T: Theme) => (T.dark ? '#ffa54a' : '#d9421f');
/** The four digits' top-left corners (world), a colon between the second and the third. */
const clockDigits = (c: Rect): [number, number][] => [310, 930, 1630, 2250].map((dx) => [c.x + dx, c.y + 160] as [number, number]);
const DIGIT_W = 480, DIGIT_H = 780;
/** Which of the seven segments (a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle) each digit lights. */
const SEGS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
/** One seven-segment digit at its top-left corner: the lit segments of `d` (8 draws all of them, used dimmed as the ghost behind the lit digits). */
function segDigit(g: Graphics, x: number, y: number, d: number, color: string, alpha: number) {
  const t = 76, w = DIGIT_W, h = DIGIT_H, mid = y + h / 2;
  const bars: Record<string, [number, number, number, number]> = {
    a: [x + t * 0.6, y, w - t * 1.2, t], g: [x + t * 0.6, mid - t / 2, w - t * 1.2, t], d: [x + t * 0.6, y + h - t, w - t * 1.2, t],
    f: [x, y + t * 0.6, t, h / 2 - t * 0.9], b: [x + w - t, y + t * 0.6, t, h / 2 - t * 0.9], e: [x, mid + t * 0.3, t, h / 2 - t * 0.9], c: [x + w - t, mid + t * 0.3, t, h / 2 - t * 0.9],
  };
  for (const k of SEGS[d]!) { const [bx, by, bw, bh] = bars[k]!; g.roundRect(bx, by, bw, bh, t / 2.2); }
  g.fill({ color, alpha });
}

/** A face-on mains plug in a wall outlet, its cord leaving at the top. */
function plugFace(f: Graphics, T: Theme, x: number, y: number) {
  const body = T.dark ? '#141a26' : '#262d3a', rim = T.dark ? '#5b6a94' : '#6b7794';
  f.roundRect(x - 270 + 14, y - 280 + 20, 540, 560, 70).fill({ color: '#000000', alpha: 0.3 });
  f.roundRect(x - 270, y - 280, 540, 560, 70).fill({ color: body }).stroke({ width: 8, color: rim, alpha: 0.8 });
  f.roundRect(x - 220, y - 240, 440, 70, 30).fill({ color: '#ffffff', alpha: T.dark ? 0.08 : 0.2 });
  for (let k = 0; k < 4; k++) f.rect(x - 200, y - 80 + k * 90, 400, 18).fill({ color: '#ffffff', alpha: 0.08 });
  f.roundRect(x - 90, y - 330, 180, 90, 30).fill({ color: body }).stroke({ width: 6, color: rim, alpha: 0.6 }); // the boot
}

/**
 * The mains: a double socket on the wall under the desk, the PC's and the monitor's plugs and the two cords. A cord leaves its plug,
 * drops behind the desk (so only the stretches above the desk and under it show) and runs to its outlet. The cords are in `back`
 * (the desk, the shelf unit and the slab cover them), the plate and the plugs in `front`.
 */
function powerArt(T: Theme, geo: RoomGeo, back: Graphics, front: Graphics) {
  const m = metalOf(T), s = geo.socket, p = s.plate, jog = p.y - 330;
  const rim = T.dark ? '#7d8bb0' : '#8d99b4', sleeve = T.dark ? '#0a0d15' : '#232a38';
  const cord = (route: [number, number][], w = 70) => {
    const pts = roundedPath(route, 170);
    const line = (dx = 0, dy = 0) => { back.moveTo(pts[0]![0] + dx, pts[0]![1] + dy); for (let i = 1; i < pts.length; i++) back.lineTo(pts[i]![0] + dx, pts[i]![1] + dy); };
    line(10, 14); back.stroke({ width: w + 6, color: '#000000', alpha: 0.28, cap: 'round', join: 'round' });
    line(); back.stroke({ width: w + 10, color: rim, alpha: T.dark ? 0.32 : 0.0, cap: 'round', join: 'round' });
    line(); back.stroke({ width: w, color: sleeve, cap: 'round', join: 'round' });
    line(-w * 0.22, 0); back.stroke({ width: w * 0.12, color: '#ffffff', alpha: T.dark ? 0.16 : 0.12, cap: 'round', join: 'round' });
  };
  // the PC: the plug in the rear wall's inlet; the cord leaves its tail, turns down and falls straight to its outlet (the plate is set so that the outlet is right under it)
  const pcPlug = { x: PC_POWER.x - 6, y: PC_POWER.y, dx: -1, dy: 0, w: 190, l: 330 };
  cord([[pcPlug.x - pcPlug.l + 10, pcPlug.y], [PC_CORD_X, pcPlug.y], [PC_CORD_X, s.pc.y - 310]]);
  acPlug(back, T, pcPlug);
  // the monitor: its cord is built in and comes out from behind it (this layer is under the monitor, so the start is hidden), drops behind the desk and runs to its outlet
  const mon = MONITOR_POWER;
  cord([[mon.x, mon.y - 200], [mon.x, jog], [s.mon.x, jog], [s.mon.x, s.mon.y - 310]]);
  // the socket: a plate with two outlets, both plugged
  const plate = T.dark ? '#7b86a8' : '#f4f6fb', edge = T.dark ? '#b3bddb' : '#a8b3cc';
  front.roundRect(p.x + 14, p.y + 20, p.w, p.h, 50).fill({ color: '#000000', alpha: 0.3 });
  front.roundRect(p.x, p.y, p.w, p.h, 50).fill({ color: plate }).stroke({ width: 8, color: edge, alpha: 0.8 });
  front.roundRect(p.x + 24, p.y + 20, p.w - 48, 50, 24).fill({ color: '#ffffff', alpha: T.dark ? 0.12 : 0.5 });
  for (const o of [s.mon, s.pc]) front.circle(o.x, o.y, 300).fill({ color: mix(plate, '#000000', 0.18) }).stroke({ width: 6, color: edge, alpha: 0.5 });
  for (const sx of [p.x + 70, p.x + p.w - 70]) { front.circle(sx, p.y + p.h / 2, 24).fill({ color: mix(plate, '#000000', 0.3) }); front.moveTo(sx - 14, p.y + p.h / 2).lineTo(sx + 14, p.y + p.h / 2).stroke({ width: 5, color: edge, alpha: 0.7 }); }
  plugFace(front, T, s.mon.x, s.mon.y);
  plugFace(front, T, s.pc.x, s.pc.y);
  void m;
}

/** The desk lamp itself (the soft shadow under it is the scenery's): a weighted base, a lower arm that leans back, an elbow, an upper arm forward over the desk and the hood (the glow is live). `lampShape` reads the silhouette of this. */
export function drawLamp(f: Graphics, L: Look, geo: RoomGeo) {
  const ys = geo.ys;
  const lx = geo.lamp.x, hd = geo.lamp.head, p0 = { x: lx + LAMP.pivot.x, y: ys + LAMP.pivot.y }, el = { x: lx + LAMP.elbow.x, y: ys + LAMP.elbow.y };
  f.roundRect(lx - LAMP.base, ys - 200, LAMP.base * 2, 200, 50).fill({ color: L.metalLo }).stroke({ width: 7, color: L.metal });
  f.roundRect(lx - LAMP.base + 120, ys - 330, LAMP.base * 2 - 240, 150, 60).fill({ color: L.metal }).stroke({ width: 6, color: L.metalLo });
  f.rect(lx - LAMP.base + 150, ys - 318, LAMP.base * 2 - 300, 18).fill({ color: '#ffffff', alpha: 0.2 });
  // an arm: a rod and, beside it, the thin rod of the parallel linkage (the spring)
  const arm = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy), nx2 = -dy / l, ny2 = dx / l;
    f.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 160, color: L.metalLo, cap: 'round' });
    f.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 86, color: L.metal, cap: 'round' });
    f.moveTo(a.x - nx2 * 22, a.y - ny2 * 22).lineTo(b.x - nx2 * 22, b.y - ny2 * 22).stroke({ width: 16, color: '#ffffff', alpha: 0.22, cap: 'round' });
    f.moveTo(a.x + nx2 * 230, a.y + ny2 * 230).lineTo(b.x + nx2 * 230, b.y + ny2 * 230).stroke({ width: 44, color: L.metalLo, cap: 'round' });
  };
  arm(p0, el); arm(el, hd);
  for (const [px2, py2] of [[p0.x, p0.y], [el.x, el.y], [hd.x, hd.y]] as const) { f.circle(px2, py2, 170).fill({ color: L.metal }).stroke({ width: 8, color: L.metalLo }); f.circle(px2, py2, 58).fill({ color: L.metalLo }); }
  // the hood: a cone from the arm's end to a wide mouth, a rim, a lit stripe along its top
  const mo = geo.lamp.mouth, nx = -LAMP_D.y * SIDE, ny = LAMP_D.x * SIDE, hw = LAMP.hood, nk = LAMP.neck;
  const hood = [hd.x + nx * nk, hd.y + ny * nk, mo.x + nx * hw, mo.y + ny * hw, mo.x - nx * hw, mo.y - ny * hw, hd.x - nx * nk, hd.y - ny * nk];
  f.poly(hood).fill({ color: '#3f6a9a' }).stroke({ width: 9, color: '#27486b' });
  f.poly([hd.x - nx * nk, hd.y - ny * nk, mo.x - nx * hw, mo.y - ny * hw, mo.x - nx * hw * 0.86 - LAMP_D.x * 90, mo.y - ny * hw * 0.86 - LAMP_D.y * 90, hd.x - nx * nk * 0.8, hd.y - ny * nk * 0.8]).fill({ color: '#ffffff', alpha: 0.2 });
  f.poly([mo.x + nx * hw, mo.y + ny * hw, mo.x - nx * hw, mo.y - ny * hw, mo.x - nx * hw - LAMP_D.x * 80, mo.y - ny * hw - LAMP_D.y * 80, mo.x + nx * hw - LAMP_D.x * 80, mo.y + ny * hw - LAMP_D.y * 80]).fill({ color: '#27486b' });
}

/** The scenery: wall, window frame, shelf, clock face, desk, shelf unit, the wall socket and the cords, and what stands on the desk. */
function sceneryArt(T: Theme, geo: RoomGeo): { back: Container; front: Container; over: Container; bakes: Container[] } {
  const L = look(T), ys = geo.ys;
  const back = new Container(), front = new Container(), over = new Container();
  // the wall and the desk are each one Graphics inside a wrapper with fixed bounds (the wall is 180000 wide: it is only baked over the region `roomBakeRect`)
  const area = roomBakeRect(geo), bakeBox = () => { const c = new Container(); c.boundsArea = new Rectangle(area.x, area.y, area.w, area.h); return c; };
  const g = new Graphics(), gWrap = bakeBox(); gWrap.addChild(g); back.addChild(gWrap);
  const f = new Graphics(), fWrap = bakeBox(); fWrap.addChild(f); front.addChild(fWrap);
  const o = new Graphics(); over.addChild(o); // what stands in front of the cables that run behind it (the mug)

  // wall: an endless colour, the slat wall over all of it (`wall.ts`), and the darker band the desk throws on it
  const shell = { ceil: geo.ceil, floor: geo.floor };
  drawCeiling(g, T, shell);
  g.rect(-90000, geo.ceil, 180000, geo.floor - geo.ceil).fill({ color: L.wall });
  drawSlats(g, T, shell);
  drawCrown(g, T, shell);
  // the desk's top meets the wall at its far edge: the wall just above it is a little in shadow, easing out upward (24 fine bands: a gradient, not a stripe)
  // (in the light theme the wall's own pale blue over the tan slats read as a haze: the shadow is a warm dark there)
  const dusk = T.dark ? L.wallLo : '#4a3a30', dk = T.dark ? 1 : 0.4, D = deskGeo(geo.persp, ys, geo.floor);
  for (let k = 0; k < 24; k++) g.rect(-90000, D.yBack - 1700 + k * 71, 180000, 75).fill({ color: dusk, alpha: 0.5 * dk * ((k + 1) / 24) ** 2.2 });
  // what hangs on the wall and stands before it throws a soft shadow east and down (the lamp and the window are west and above): under all of it
  const cast = (r: Rect, dx: number, dy: number, spread: number, a: number, rad = 60) => {
    const n = 16; // enough nested rects that no ring shows
    for (let k = 0; k < n; k++) { const e = spread * (1 - k / (n - 1)); g.roundRect(r.x + dx - e, r.y + dy - e, r.w + 2 * e, r.h + 2 * e, rad + e).fill({ color: '#000000', alpha: (a * (T.dark ? 1 : 0.6)) / n }); }
  };
  cast(MONITOR, 520, 420, 460, 0.42, 300);
  cast(CASE, 560, 420, 500, 0.42, 120);
  cast(geo.clock, 150, 230, 150, 0.5, 90);
  cast(OUTBOX, 130, 200, 130, 0.45, 40);
  for (let row = 0; row < TRAY_ROWS; row++) cast({ x: geo.keyRack.x, y: geo.keyRack.y + row * ROW_DROP, w: geo.keyRack.w, h: 360 }, 140, 210, 140, 0.45, 30);
  cast({ x: ROUTER_SPOT.x - 300, y: SHELF_Y, w: ROUTER_SPOT.w + 420, h: 170 }, 200, 300, 160, 0.42, 20);

  // the router shelf: a plank on two brackets, the wall plate above it on the left (both drawn by the network layer)
  const sx0 = ROUTER_SPOT.x - 300, sx1 = ROUTER_SPOT.x + ROUTER_SPOT.w + 120, sy = SHELF_Y;
  g.rect(sx0, sy, sx1 - sx0, 170).fill({ color: L.wood }).stroke({ width: 8, color: L.edge, alpha: 0.7 });
  g.rect(sx0 + 14, sy + 14, sx1 - sx0 - 28, 16).fill({ color: L.woodHi, alpha: 0.8 });
  for (const bx of [sx0 + 380, sx1 - 560]) { g.poly([bx, sy + 170, bx + 120, sy + 170, bx + 120, sy + 560, bx, sy + 560]).fill({ color: L.metalLo }); g.poly([bx + 120, sy + 170, bx + 120, sy + 520, bx + 400, sy + 170]).fill({ color: L.metal, alpha: 0.9 }); }
  g.rect(sx0 + 20, sy + 170, sx1 - sx0 - 40, 70).fill({ color: '#000000', alpha: 0.16 });

  // the window: a recess in the wall, the glass (live sky goes here), a frame with a cross bar and a transom, a sill
  const w = geo.window;
  const frameCol = mix(L.wood, '#ffffff', T.dark ? 0.1 : 0.45);
  g.rect(w.x - 230, w.y - 230, w.w + 460, w.h + 460).fill({ color: L.wallLo }).stroke({ width: 10, color: L.line, alpha: 0.6 });
  g.rect(w.x - 150, w.y - 150, w.w + 300, w.h + 150).fill({ color: mix(L.wood, '#ffffff', T.dark ? 0.08 : 0.4) }).stroke({ width: 8, color: L.edge, alpha: 0.7 });
  g.rect(w.x, w.y, w.w, w.h).fill({ color: '#0a0f24' });
  const gf = new Graphics(); // the frame over the glass and the live sky
  gf.rect(w.x + w.w / 2 - 65, w.y, 130, w.h).fill({ color: frameCol });
  for (const t of [0.16, 0.42, 0.68]) gf.rect(w.x, w.y + w.h * t, w.w, 120).fill({ color: frameCol });
  gf.rect(w.x, w.y, w.w, w.h).stroke({ width: 90, color: frameCol, alignment: 1 });
  gf.rect(w.x + 28, w.y + 28, w.w - 56, 18).fill({ color: '#ffffff', alpha: 0.14 });
  gf.rect(w.x + w.w / 2 - 65, w.y, 22, w.h).fill({ color: '#ffffff', alpha: 0.1 }); // the lit edge of the mullion
  gf.circle(w.x + w.w - 380, w.y + w.h * 0.68 + 60, 38).fill({ color: L.metal }).stroke({ width: 5, color: L.metalLo }); // the latch
  const sill = new Graphics();
  sill.rect(w.x - 500, w.y + w.h + 80, w.w + 1000, 210).fill({ color: L.wood }).stroke({ width: 8, color: L.edge, alpha: 0.7 });
  sill.rect(w.x - 480, w.y + w.h + 92, w.w + 960, 20).fill({ color: L.woodHi, alpha: 0.8 });
  sill.rect(w.x - 440, w.y + w.h + 290, w.w + 880, 90).fill({ color: '#000000', alpha: 0.16 });
  back.addChild(gf, sill);

  // the digital clock on the wall above the case: a dark case, a dimmed "88:88" behind the lit digits (the digits are live)
  const c = geo.clock, led = ledColor(T);
  g.roundRect(c.x + 26, c.y + 40, c.w, c.h, 90).fill({ color: '#000000', alpha: 0.22 });
  g.roundRect(c.x, c.y, c.w, c.h, 90).fill({ color: T.dark ? '#141a26' : '#262d3a' }).stroke({ width: 10, color: L.edge, alpha: 0.7 });
  g.roundRect(c.x + 60, c.y + 60, c.w - 120, c.h - 120, 50).fill({ color: '#06080d' });
  for (const [x, y] of clockDigits(c)) segDigit(g, x, y, 8, led, 0.1);
  g.roundRect(c.x + 80, c.y + 74, c.w - 160, 18, 9).fill({ color: '#ffffff', alpha: 0.05 });

  // ---- the desk (`desk.ts`, in the room's perspective): a top with depth that things stand on, a slab, a side panel at the west end and a drawer pedestal at the east end that stand on the floor in front of the baseboard; it spans from west of the lamp to just past the case ----
  const { x0, x1 } = geo.desk, ye = geo.floor, P = geo.persp;
  drawUnderDesk(f, T, D, x0, x1);
  // the floor and the baseboard (`shell.ts`), under the desk and over the foot of the wall, the rug on it, and the desk's shadow
  drawFloor(f, T, { ceil: geo.ceil, floor: ye, ...P });
  drawRug(f, T, { x0, x1, floor: ye, ...P });
  drawDeskShadow(f, T, D, x0, x1);
  powerArt(T, geo, g, f);
  drawDesk(f, T, L, D, x0, x1);

  // ---- the key rack on the wall above the monitor (props.ts draws the lettering and the sticks on their lanyards): two wooden rails, five brass hooks on each ----
  const kr = geo.keyRack;
  for (let row = 0; row < TRAY_ROWS; row++) {
    const ry = kr.y + row * ROW_DROP, rw = kr.w - (row ? 0 : 0);
    g.roundRect(kr.x + 16, ry + 26, rw, 360, 30).fill({ color: '#000000', alpha: T.dark ? 0.3 : 0.16 });
    g.roundRect(kr.x, ry, rw, 360, 30).fill({ color: L.wood }).stroke({ width: 8, color: L.edge, alpha: 0.85 });
    g.roundRect(kr.x + 14, ry + 12, rw - 28, 20, 10).fill({ color: L.woodHi, alpha: 0.8 });
    for (let k = 0; k < 4; k++) g.rect(kr.x + 40, ry + 70 + ((k * 2654435761 + row * 977) % 1000) / 1000 * 230, rw - 80, 6).fill({ color: L.woodLo, alpha: 0.22 });
    for (const sx of [kr.x + 40, kr.x + rw - 40]) { g.circle(sx, ry + 330, 20).fill({ color: L.metal }).stroke({ width: 4, color: L.metalLo }); g.moveTo(sx - 10, ry + 330).lineTo(sx + 10, ry + 330).stroke({ width: 4, color: L.metalLo }); }
  }
  for (let i = 0; i < TRAY_COLS * TRAY_ROWS; i++) {
    const h = trayHook(i);
    g.circle(h.x, h.y, 34).fill({ color: L.metal }).stroke({ width: 6, color: L.metalLo }); // a brass cup hook: its base on the rail,
    g.moveTo(h.x, h.y).quadraticCurveTo(h.x + 54, h.y + 40, h.x + 12, h.y + 96).stroke({ width: 16, color: L.metal, cap: 'round' }); // and the bend the lanyard hangs from
  }
  // ---- the letterbox: a red wall box with a slot in its top, between the router's shelf and the case ----
  const ob = OUTBOX, red = T.dark ? '#8e2f38' : '#c24c55', redHi = mix(red, '#ffffff', T.dark ? 0.22 : 0.3), redLo = mix(red, '#000000', 0.35);
  g.roundRect(ob.x + 18, ob.y + 28, ob.w, ob.h, 40).fill({ color: '#000000', alpha: T.dark ? 0.3 : 0.16 });
  g.roundRect(ob.x, ob.y, ob.w, ob.h, 40).fill({ color: red }).stroke({ width: 8, color: redLo, alpha: 0.9 });
  g.roundRect(ob.x + 16, ob.y + 14, ob.w - 32, 26, 13).fill({ color: redHi, alpha: 0.7 });
  g.roundRect(ob.x + 150, ob.y + 80, ob.w - 300, 56, 20).fill({ color: '#05070c' }).stroke({ width: 6, color: redLo, alpha: 0.9 }); // the slot
  g.roundRect(ob.x + 130, ob.y + 54, ob.w - 260, 30, 12).fill({ color: redLo }); // its hood
  g.roundRect(ob.x + 80, ob.y + 330, ob.w - 160, 250, 24).fill({ color: redLo, alpha: 0.55 }); // the plate under the slot
  for (const sx of [ob.x + 60, ob.x + ob.w - 60]) for (const sy of [ob.y + 60, ob.y + ob.h - 60]) g.circle(sx, sy, 14).fill({ color: L.metal }).stroke({ width: 3, color: L.metalLo });
  back.addChild(label('OUT', ob.x + ob.w / 2, ob.y + 455, 130, T.dark ? '#f0d9d9' : '#fff1f1', { head: true, anchor: [0.5, 0.5], a: 0.9 }));
  g.circle(ob.x + ob.w - 130, ob.y + ob.h - 100, 22).fill({ color: '#05070c' }).stroke({ width: 4, color: redLo }); // the lamp that lights when a letter goes in
  // the monitor's foot casts a little shadow on the desk
  shadow(f, MONITOR.x + MONITOR.w / 2, ys + 44, 5600, 0.32);

  // ---- on the desk: the case's own shadow, the lamp at the very west, the keyboard and the mouse under the monitor (either side of its foot), the mug between the monitor and the case ----
  shadow(f, CASE.x + CASE.w / 2, ys + 44, CASE.w + 400, 0.34);
  // the desk mat, the keyboard and the mouse, in front of the monitor's foot (they are drawn on the over layer, above the monitor): real sizes against the 24 inch
  const cx = MONITOR.x + MONITOR.w / 2, kw = 6200, kx = cx - kw / 2 - 300, kb = ys, kf = 190, kd = 400; // keyboard: left, width, base line, front face height, depth of its top
  const matX0 = kx - 500, matX1 = cx + kw / 2 + 2500;
  o.roundRect(matX0, ys - 70, matX1 - matX0, 70, 30).fill({ color: T.dark ? '#141c36' : '#c4cedf' }).stroke({ width: 5, color: '#000000', alpha: 0.2 });
  o.rect(matX0 + 40, ys - 62, matX1 - matX0 - 80, 12).fill({ color: '#ffffff', alpha: T.dark ? 0.06 : 0.4 });
  // the keyboard: a front face, a sloped top seen from a little above with five rows of caps (the space bar in the front row), a pair of lamps at the back
  const capCol = T.dark ? '#b8c2e4' : '#ffffff', capEdge = T.dark ? '#4a5679' : '#9aabc8';
  o.ellipse(kx + kw / 2, kb + 40, kw / 2 + 200, 110).fill({ color: '#000000', alpha: 0.2 });
  o.roundRect(kx, kb - kf - 70, kw, kf + 70, 44).fill({ color: L.plasticLo }).stroke({ width: 6, color: '#000000', alpha: 0.3 });
  const topL = (t: number) => kx + 70 + 190 * t, topR = (t: number) => kx + kw - 70 - 190 * t, topY = (t: number) => kb - kf - 70 - kd * t;
  o.poly([topL(0), topY(0), topR(0), topY(0), topR(1), topY(1), topL(1), topY(1)]).fill({ color: L.plastic }).stroke({ width: 6, color: L.line });
  o.poly([topL(0), topY(0), topR(0), topY(0), topR(0.1), topY(0.1), topL(0.1), topY(0.1)]).fill({ color: '#ffffff', alpha: T.dark ? 0.06 : 0.35 });
  for (let r = 0; r < 5; r++) {
    const t0 = 0.06 + r * 0.17, t1 = t0 + 0.13, y0 = topY(t0), y1 = topY(t1), xl0 = topL(t0) + 40, xr0 = topR(t0) - 40, xl1 = topL(t1) + 40, xr1 = topR(t1) - 40;
    const caps = r === 0 ? [[0, 0.1], [0.11, 0.2], [0.21, 0.3], [0.31, 0.69], [0.7, 0.79], [0.8, 0.89], [0.9, 1]] : Array.from({ length: r === 4 ? 14 : 15 }, (_, k) => { const n = r === 4 ? 14 : 15; return [k / n + 0.004, (k + 1) / n - 0.004]; });
    for (const [a, b] of caps as number[][]) {
      const lx0 = xl0 + (xr0 - xl0) * a!, rx0 = xl0 + (xr0 - xl0) * b!, lx1 = xl1 + (xr1 - xl1) * a!, rx1 = xl1 + (xr1 - xl1) * b!;
      o.poly([lx0, y0, rx0, y0, rx1, y1, lx1, y1]).fill({ color: capCol, alpha: T.dark ? 0.78 : 0.97 }).stroke({ width: 3, color: capEdge, alpha: 0.7 });
    }
  }
  for (const [dx, col] of [[kw - 520, '#6dffa6'], [kw - 380, T.dark ? '#33406e' : '#aebbd6']] as const) o.circle(kx + dx, topY(0.96), 14).fill({ color: col, alpha: 0.9 });
  // the mouse: a domed body with the two buttons and the wheel, on the mat east of the keyboard, and its cord curling back behind the keyboard
  const mox = kx + kw + 1050;
  o.ellipse(mox, ys + 30, 520, 80).fill({ color: '#000000', alpha: 0.24 });
  o.moveTo(mox - 20, ys - 330).bezierCurveTo(mox - 300, ys - 640, mox - 1700, ys - 560, mox - 2100, ys - 820).stroke({ width: 20, color: L.plasticLo, cap: 'round' });
  o.roundRect(mox - 330, ys - 260, 660, 260, 120).fill({ color: L.plasticLo }).stroke({ width: 6, color: '#000000', alpha: 0.3 });
  o.moveTo(mox - 360, ys - 210).bezierCurveTo(mox - 360, ys - 520, mox - 150, ys - 560, mox, ys - 560).bezierCurveTo(mox + 150, ys - 560, mox + 360, ys - 520, mox + 360, ys - 210).closePath().fill({ color: L.plastic }).stroke({ width: 6, color: L.line });
  o.moveTo(mox, ys - 560).lineTo(mox, ys - 360).stroke({ width: 7, color: L.line });
  o.moveTo(mox - 350, ys - 360).bezierCurveTo(mox - 200, ys - 380, mox - 60, ys - 380, mox + 350, ys - 360).stroke({ width: 6, color: L.line, alpha: 0.8 });
  o.roundRect(mox - 22, ys - 520, 44, 110, 20).fill({ color: T.dark ? '#aab6dc' : L.paper }).stroke({ width: 4, color: capEdge });
  o.ellipse(mox - 150, ys - 470, 110, 40).fill({ color: '#ffffff', alpha: T.dark ? 0.12 : 0.55 });
  // the mug in the gap between the monitor and the case (`mug.ts`: seen from a little above, a coaster, a tapered body with a band of little towers, a handle, the coffee; the steam is live)
  const mx = geo.mug;
  drawMug(o, T.dark, mx, ys, L.cork);
  // the lamp at the desk's very west end: a weighted base, a lower arm that leans back, an elbow, an upper arm forward over the desk and the hood (the glow is live)
  drawPlant(f, T, geo.lamp.x + LAMP.base + 1250, ys); // a plant between the lamp and the monitor
  shadow(f, geo.lamp.x, ys, 2 * (LAMP.base + 400), 0.34);
  drawLamp(f, L, geo);
  return { back, front, over, bakes: [gWrap, fWrap] };
}

/**
 * The lit edges: a thin warm line along the top and the west side of what the lamp and the window light (the monitor, the case, the keyboard, the clock, the
 * letterbox, the key rack, the shelf, the desk's top edge, the lamp's hood and arms, the mug's rim), like the hairlines of the board catching light. It is drawn
 * above the things, under the light layer's dark, so the night dims it with them.
 */
function rimArt(T: Theme, geo: RoomGeo): Graphics {
  const g = new Graphics(), ys = geo.ys, col = T.dark ? '#e0b060' : '#a8803a', hi = mix(col, '#ffffff', 0.35), w1 = 16, w2 = 11;
  const edge = (r: Rect, rad: number, a = 0.8) => {
    g.roundRect(r.x, r.y, r.w, r.h, rad).stroke({ width: w2 * 0.6, color: col, alpha: a * 0.35 });
    g.moveTo(r.x + rad, r.y).lineTo(r.x + r.w - rad, r.y).stroke({ width: w1, color: hi, alpha: a });
    g.moveTo(r.x, r.y + rad).lineTo(r.x, r.y + r.h - rad).stroke({ width: w2, color: col, alpha: a * 0.7 });
  };
  edge(MONITOR, 330, 0.85); edge(CASE, 120, 0.85); edge(geo.clock, 90, 0.7); edge(OUTBOX, 40, 0.6);
  for (let row = 0; row < TRAY_ROWS; row++) edge({ x: geo.keyRack.x, y: geo.keyRack.y + row * ROW_DROP, w: geo.keyRack.w, h: 360 }, 30, 0.6);
  edge({ x: ROUTER_SPOT.x - 300, y: SHELF_Y, w: ROUTER_SPOT.w + 420, h: 170 }, 0, 0.6);
  edge({ x: geo.socket.plate.x, y: geo.socket.plate.y, w: geo.socket.plate.w, h: geo.socket.plate.h }, 50, 0.5);
  const cx = MONITOR.x + MONITOR.w / 2, kw = 6200, kx = cx - kw / 2 - 300;
  edge({ x: kx, y: ys - 260, w: kw, h: 260 }, 44, 0.7);
  const D = deskGeo(geo.persp, ys, geo.floor);
  g.moveTo(D.xAt(geo.desk.x0, S_FRONT), D.yFront).lineTo(D.xAt(geo.desk.x1, S_FRONT), D.yFront).stroke({ width: 20, color: hi, alpha: 0.8 }); // the desk's front edge, where the top turns down
  const mx = geo.mug, mt = ys - MUG.h;
  g.ellipse(mx, mt, MUG.r, MUG.r * MUG.e).stroke({ width: w2, color: hi, alpha: 0.7 });
  g.moveTo(mx - MUG.r, mt).lineTo(mx - MUG.rb, ys - 20).stroke({ width: w1, color: hi, alpha: 0.6 });
  // the lamp: the hood's rim and the lit side of the arms
  const lx = geo.lamp.x, p0 = { x: lx, y: ys - 300 }, el = { x: lx + LAMP.elbow.x, y: ys + LAMP.elbow.y }, hd = geo.lamp.head, mo = geo.lamp.mouth;
  const nx = -LAMP_D.y * SIDE, ny = LAMP_D.x * SIDE, hw = LAMP.hood, nk = LAMP.neck;
  g.poly([hd.x + nx * nk, hd.y + ny * nk, mo.x + nx * hw, mo.y + ny * hw, mo.x - nx * hw, mo.y - ny * hw, hd.x - nx * nk, hd.y - ny * nk]).stroke({ width: w2, color: hi, alpha: 0.7 });
  const arm = (a: { x: number; y: number }, b: { x: number; y: number }) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy), ax = -dy / l, ay = dx / l; g.moveTo(a.x - ax * 75, a.y - ay * 75).lineTo(b.x - ax * 75, b.y - ay * 75).stroke({ width: w2, color: hi, alpha: 0.6 }); };
  arm(p0, el); arm(el, hd);
  return g;
}

/** The places the room's light is cut around, from the layout of the moment (the case follows the tier). The keyboard is its sloped top: `y` its front edge, `h` how far it runs back. */
export function lightGeo(geo: RoomGeo): LightGeo {
  const cx = MONITOR.x + MONITOR.w / 2, kw = 6200, kx = cx - kw / 2 - 300, dk = deskGeo(geo.persp, geo.ys, geo.floor);
  return {
    window: geo.window, region: roomBakeRect(geo), case: CASE, inner: CASE_IN, monitor: MONITOR, screen: SCREEN, router: ROUTER_SPOT, clock: geo.clock, mouth: geo.lamp.mouth, dir: LAMP_D, ys: geo.ys,
    keyboard: { x: kx, y: geo.ys - 260, w: kw, h: 400 }, deskTop: dk.yFront, deskBack: dk.yBack,
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

/** A rectangle that answers a click, with the tooltip words. */
/** `shape` is the thing's silhouette (what the pointer picks and the hover ring follows); without one the rectangle is. */
export interface RoomHit { id: 'lamp' | 'blind'; rect: Rect; shape?: Shape }

/** The lamp's silhouette (base, arms, joints, hood) read from its own art: the box round it is mostly wall, and reaches over the monitor. Built when the pointer first comes near. */
export function lampShape(renderer: Renderer, T: Theme, geo: RoomGeo): Shape {
  const r = geo.lamp.rect;
  return lazyShape(r, () => {
    const g = new Graphics();
    drawLamp(g, look(T), geo);
    const s = captureShape(renderer, g, r, { threshold: 130 });
    g.destroy();
    return s ?? rectShape(r);
  });
}

/**
 * The room as a scene node: static scenery, plus the live parts. `frame(gt, dt)` moves them on the game clock `gt` (ms); the
 * blind and the lamp ease on wall time `dt` (ms).
 */
export class RoomView {
  readonly root = new Container();
  /** Cables that run behind the desk, the riser and the monitor (the ISP lead, see net.ts): in the back layer, under the desk. */
  readonly behind = new Container();
  /** What stands in front of the cables (the mug and its steam): board.ts puts this above the cable layer, not in the room's own layer. */
  readonly over = new Container();
  /** The light: the dark of the room with the lit places cut out of it, and what the lights add. board.ts puts this above everything outside the case (the monitor, the props, the case's shell). Empty without a renderer (tests). */
  readonly light = new Container();
  readonly geo: RoomGeo;
  readonly hits: RoomHit[];
  private readonly sky = new Container();
  private readonly skyBack = new Graphics();
  private readonly skyCity = new Graphics();
  private readonly skyLive = new Graphics();
  private cityKey = '';
  private readonly glow = new Graphics();
  private readonly lightView: LightView | null;
  private readonly clockG = new Graphics();
  private readonly steam: Steam;
  private readonly blindG = new Graphics();
  private readonly mask = new Graphics();
  private readonly bakes: Container[];
  private baked = false;
  private lamp = roomState.lamp ? 1 : 0;
  private blind = roomState.blind ? 1 : 0;
  private screenOn = false;
  private screen = 0;
  private lastKey = '';
  private beamKey = '';

  /** `renderer` lets the room's light be drawn into textures; without one (tests) there is no light layer. */
  constructor(private T: Theme, geo = roomGeo(), renderer?: Renderer) {
    this.geo = geo;
    this.lightView = renderer ? new LightView(renderer, lightGeo(geo)) : null;
    this.light.addChild(rimArt(T, geo));
    if (this.lightView) this.light.addChild(this.lightView.root);
    const { back, front, over, bakes } = sceneryArt(T, geo);
    this.bakes = bakes;
    this.over.addChild(over);
    const w = geo.window;
    this.mask.rect(w.x, w.y, w.w, w.h).fill({ color: '#ffffff' });
    this.sky.addChild(this.skyBack, this.skyCity, this.skyLive);
    this.sky.mask = this.mask;
    this.blindG.mask = this.mask;
    // order: wall and window frame, then the sky inside the glass (under the frame art), the desk, the lights, the hands
    this.root.addChild(back);
    back.addChild(this.behind);
    back.addChildAt(this.sky, 1);
    back.addChildAt(this.mask, 1);
    back.addChildAt(this.blindG, 3); // over the sky, under the frame and the sill
    this.root.addChild(front);
    this.root.addChild(this.glow, this.clockG);
    this.steam = new Steam(geo.mug, geo.ys - MUG.h + 30, T.dark);
    this.over.addChild(this.steam);
    this.hits = [{ id: 'lamp', rect: geo.lamp.rect, shape: renderer ? lampShape(renderer, T, geo) : undefined }, { id: 'blind', rect: { x: w.x, y: w.y, w: w.w, h: w.h } }];
    this.frame(0, 0, true);
  }

  /**
   * Far out the wall and the desk are two baked textures (one quad each instead of a hundred overlapping shapes); close in, and when the view runs
   * past the baked region (a very wide or tall screen), they are drawn as shapes again. While `cover` (the case) fills the view, the room is not drawn.
   */
  setView(view: Rect, z: number, dpr: number, cover: Rect | null) {
    const hide = !!cover && roomHidden(view, cover), want = !hide && roomBakeFits(view, z, dpr, this.geo);
    this.root.visible = !hide;
    this.light.visible = !hide;
    if (want === this.baked) return;
    this.baked = want;
    for (const c of this.bakes) c.cacheAsTexture(want ? { resolution: ROOM_BAKE_RES, antialias: true } : false);
  }

  /** Free the light's textures (the room is built again with the scene). */
  dispose() { this.light.removeFromParent(); this.lightView?.destroy(); }

  /** The monitor shines (the machine is on with a display): the light puts it, and what it throws on the keyboard and the desk, out of the dark. */
  setScreen(on: boolean) { this.screenOn = on; }

  /** How much the room is dimmed to put the case in the light (`focusAt`): 0 to 1. */
  setFocus(f: number) { this.lightView?.setFocus(f); }

  /** Advance the live parts. Cheap when nothing visible changed (the key rounds the clock to a few steps a second). */
  frame(gt: number, dtMs: number, force = false): boolean {
    const goalL = roomState.lamp ? 1 : 0, goalB = roomState.blind ? 1 : 0, k = 1 - Math.exp(-dtMs / 140);
    this.lamp += (goalL - this.lamp) * (dtMs > 0 ? k : 1); if (Math.abs(goalL - this.lamp) < 0.01) this.lamp = goalL;
    const goalS = this.screenOn ? 1 : 0;
    this.screen += (goalS - this.screen) * (dtMs > 0 ? 1 - Math.exp(-dtMs / 400) : 1); if (Math.abs(goalS - this.screen) < 0.01) this.screen = goalS;
    this.blind += (goalB - this.blind) * (dtMs > 0 ? 1 - Math.exp(-dtMs / 260) : 1); if (Math.abs(goalB - this.blind) < 0.004) this.blind = goalB;
    if (this.root.visible) {
      // what moves smoothly runs every frame (they are cheap: sprites and one small Graphics): the steam, and the window's shaft as the sun moves
      this.steam.frame(gt);
      const h0 = roomDebug.hour ?? hourAt(gt), bk = `${Math.round(h0 * 3000)}|${this.blind.toFixed(3)}`;
      if (force || bk !== this.beamKey) { this.beamKey = bk; this.lightView?.setBeams(beamsAt(this.geo, h0, this.blind), this.T.dark); }
    }
    // the rest (the sky's stars, clouds and city, the clock, the light's textures) is redrawn about 30 times a second, and when something visible changed
    const key = `${roomDebug.hour ?? ''}|${Math.round(gt / 33)}|${this.lamp.toFixed(2)}|${this.screen.toFixed(2)}|${this.blind.toFixed(3)}`;
    if (!force && (key === this.lastKey || !this.root.visible)) return false;
    this.lastKey = key;
    const h = roomDebug.hour ?? hourAt(gt);
    this.drawSky(h, gt);
    this.drawGlow(h);
    this.lightView?.set({ dark: this.T.dark, night: nightAt(h), dusk: duskAt(h), lamp: this.lamp, screen: this.screen, beams: beamsAt(this.geo, h, this.blind) }, force);
    this.drawClock(h, gt);
    return true;
  }

  private drawSky(h: number, gt: number) {
    const g = this.skyBack, w = this.geo.window, night = nightAt(h), s = skyAt(h);
    g.clear();
    const bands = 20;
    for (let i = 0; i < bands; i++) g.rect(w.x, w.y + (i * w.h) / bands, w.w, w.h / bands + 2).fill({ color: mix(s.top, s.hor, Math.pow(i / (bands - 1), 1.4)) });
    drawStars(g, w, night, gt);
    // the sun by day and the moon by night, each on an arc across the glass
    const sunT = (h - 5.6) / 12.8, moonT = ((h + 6) % 24) / 12.6;
    const arc = (t: number) => ({ x: w.x + w.w * (0.12 + 0.76 * t), y: w.y + w.h * (0.62 - 0.5 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)))) });
    if (sunT > -0.05 && sunT < 1.05) { const p = arc(sunT); g.circle(p.x, p.y, 460).fill({ color: '#fff3c4', alpha: 0.26 }); g.circle(p.x, p.y, 300).fill({ color: '#fff0a8' }); }
    if (moonT > 0 && moonT < 1) { const p = arc(moonT); g.circle(p.x, p.y, 420).fill({ color: '#dfe8ff', alpha: 0.12 }); g.circle(p.x, p.y, 260).fill({ color: '#eef2ff' }); g.circle(p.x - 90, p.y - 50, 52).fill({ color: '#c3cbe6' }); g.circle(p.x + 80, p.y + 66, 36).fill({ color: '#c3cbe6' }); g.circle(p.x + 20, p.y - 110, 24).fill({ color: '#c3cbe6' }); }
    drawClouds(g, w, night, s.hor, gt);
    drawAircraft(g, w, night, gt);
    // the city: the static part is redrawn when the light has moved on by a step, the live part (flickering windows, beacons) every time
    const ck = `${Math.round(night * 24)}|${Math.round(h * 6)}`;
    if (ck !== this.cityKey) { this.cityKey = ck; this.skyCity.clear(); drawSkyline(this.skyCity, w, night, s.hor); }
    this.skyLive.clear();
    drawCityLive(this.skyLive, w, night, gt);
    // the blind: slats that roll down from the top, ending in a bar
    const b = this.blindG; b.clear();
    if (this.blind > 0.002) {
      const bh = w.h * this.blind;
      b.rect(w.x, w.y, w.w, bh).fill({ color: mix(look(this.T).paper, '#6b7aa8', this.T.dark ? 0.55 : 0.18) });
      for (let y = w.y + 120; y < w.y + bh - 60; y += 160) b.rect(w.x, y, w.w, 10).fill({ color: '#000000', alpha: 0.16 });
      b.rect(w.x, w.y + bh - 60, w.w, 60).fill({ color: look(this.T).metal });
      b.rect(w.x + w.w / 2 - 36, w.y + bh - 60, 72, 140).fill({ color: look(this.T).metalLo });
    }
  }

  private drawGlow(h: number) {
    const g = this.glow, geo = this.geo, night = nightAt(h), on = this.lamp, d = this.T.dark;
    g.clear();
    const I = on * (d ? 0.4 + 0.6 * night : 0.2 + 0.5 * night);
    if (I < 0.01) return;
    const mo = geo.lamp.mouth;
    // the bulb in the hood's mouth (the light it gives, the pool and the cone, is the light layer's)
    g.circle(mo.x - LAMP_D.x * 60, mo.y - LAMP_D.y * 60, 560).fill({ color: '#ffd68a', alpha: 0.22 * I });
    g.circle(mo.x - LAMP_D.x * 60, mo.y - LAMP_D.y * 60, 300).fill({ color: '#fff2c8', alpha: 0.95 * Math.min(1, I * 1.5) });
  }

  private drawClock(h: number, gt: number) {
    const g = this.clockG, c = this.geo.clock, led = ledColor(this.T);
    g.clear();
    const hh = Math.floor(h) % 24, mm = Math.floor((h * 60) % 60);
    const [d0, d1, d2, d3] = clockDigits(c);
    [[d0, Math.floor(hh / 10)], [d1, hh % 10], [d2, Math.floor(mm / 10)], [d3, mm % 10]].forEach(([p, d]) => {
      const [x, y] = p as [number, number];
      segDigit(g, x - 14, y - 14, d as number, led, 0.05); // a soft halo (the same segments, a little off, very faint)
      segDigit(g, x, y, d as number, led, 0.95);
    });
    // the colon blinks once a second of game time
    const on = Math.floor(gt / 500) % 2 === 0, cx = c.x + 1520, y0 = c.y + 160 + DIGIT_H * 0.33, y1 = c.y + 160 + DIGIT_H * 0.67;
    for (const y of [y0, y1]) g.circle(cx, y, 46).fill({ color: led, alpha: on ? 0.95 : 0.12 });
  }

}
