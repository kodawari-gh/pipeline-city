import { Container, Graphics, Rectangle, type Renderer } from 'pixi.js';
import { disc, label, mix } from '@/core/render/ink';
import { drawAircraft, drawCityLive, drawClouds, drawSkyline, drawStars } from './skyline';
import { acPlug, metalOf } from '@/features/board/render/layout/ports';
import { trayHook } from '../desk/props/props';
import { LightView, type Beam, type LightGeo } from './light';
import { drawMug, MUG } from '../desk/props/mug';
import { Steam } from '../desk/props/steam';
import { drawSlats, drawWallShade } from './wall';
import { drawCeiling, drawCrown, drawFloor, FADE } from './shell';
import { captureShape } from '@/core/render/capture';
import { drawPlant, drawRug } from './decor';
import { drawKeyboard, drawMat, drawMouse, KEYBOARD, keyboardPlacer } from '../desk/peripherals';
import { drawDesk, drawDeskShadow, drawUnderDesk } from '../desk/desk';
import { COLLAR_R, HOLES, PLATE_Q, SCREW, recessPoly } from './swiss';
import { deskGeo, roomPersp, S_FRONT, spreadX, spreadY, type Persp } from './persp';
import { lazyShape, rectShape, type Shape } from '@/core/render/shape';
import {
  CASE, CASE_IN, LAYOUT_CASE, SCREEN, DESK_SLAB, DESK_UNDER, DESK_Y, FLOOR_Y, FOOT, MONITOR, PC_POWER, OUTBOX, POWER_PLATE, ROUTER_SPOT, ROW_DROP, SHELF_Y, TRAY, TRAY_COLS, TRAY_ROWS, type Rect,
} from '@/features/board/render/layout/layout';
import { CASE_CUTS, CASE_KIND, cutRect, growCuts, isCut, type Cuts } from './casedecor';

/** The corner cuts of the case in the room (the showcase has chamfered corners), or none. Its shadow and its rim light follow them. */
const caseCuts = (): Cuts | undefined => { const c = CASE_CUTS[CASE_KIND[LAYOUT_CASE] ?? 'gamer']; return isCut(c) ? c : undefined; };
import type { Theme } from '@/core/render/theme';

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
/**
 * The lamp stands at the desk's west end: a weighted base, a lower arm that leans back (west, away from the work), an elbow, an upper arm that reaches
 * forward over the desk (east), and a hood on its end pointing down and east (SIDE 1; -1 would mirror it) at `LAMP_D`. The joints are offsets from the base
 * centre on the desk top (x east, y up is negative); `reach` is the hood's length from the arm's end to its mouth, `hood` its half width at the mouth.
 */
const SIDE = 1, LAMP_D = { x: 0.766 * SIDE, y: 0.643 };
const LAMP = { pivot: { x: 0, y: -300 }, elbow: { x: -1300 * SIDE, y: -3900 }, head: { x: 1400 * SIDE, y: -7600 }, reach: 1500, hood: 760, neck: 180, base: 1100, open: 320, bulb: 225 };
/** The hood's opening, an ellipse round the mouth (`LAMP.hood` across, `LAMP.open` along the axis: we see into it a little), scaled by `k`. */
const lampOpening = (mo: { x: number; y: number }, k = 1) => {
  const out: number[] = [], nx = -LAMP_D.y * SIDE, ny = LAMP_D.x * SIDE;
  for (let i = 0; i < 40; i++) { const a = (i * Math.PI * 2) / 40, u = LAMP.hood * k * Math.cos(a), v = LAMP.open * k * Math.sin(a); out.push(mo.x + nx * u + LAMP_D.x * v, mo.y + ny * u + LAMP_D.y * v); }
  return out;
};
/** Where the bulb sits in the opening: a little back from the mouth, toward the neck. */
const lampBulb = (mo: { x: number; y: number }) => ({ x: mo.x - LAMP_D.x * 40, y: mo.y - LAMP_D.y * 40 });

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

/**
 * The mains: a double socket on the wall under the desk, the plug in the case's inlet and the empty outlets. The two cords and their wall plugs are live (`cords.ts`):
 * a cord leaves its machine, drops behind the desk (so only the stretches above the desk and under it show) and runs to its outlet.
 */
function powerArt(T: Theme, geo: RoomGeo, back: Graphics, front: Graphics) {
  const m = metalOf(T), s = geo.socket, p = s.plate;
  // the PC: the plug in the rear wall's inlet; the cord leaves its tail, turns down and falls straight to its outlet (the plate is set so that the outlet is right under it)
  const pcPlug = { x: PC_POWER.x - 6, y: PC_POWER.y, dx: -1, dy: 0, w: 190, l: 330 };
  acPlug(back, T, pcPlug); // (the cord itself, and the plugs in the wall, are live: `cords.ts`)
  // the socket: two Swiss outlets (`swiss.ts`), each on its own square white plate with rounded corners, a round collar, the shield-shaped recess with its three round holes and the fixing screw
  const plate = T.dark ? '#e6e8ee' : '#f6f6f2', edge = T.dark ? '#f5f6fa' : '#cfd1d6', hollow = T.dark ? '#c8ccd7' : '#e6e6e2', hole = '#1a1d25';
  for (const o of [s.mon, s.pc]) {
    const q = PLATE_Q;
    front.roundRect(o.x - q + 14, o.y - q + 22, 2 * q, 2 * q, 70).fill({ color: '#000000', alpha: 0.3 });
    front.roundRect(o.x - q, o.y - q, 2 * q, 2 * q, 70).fill({ color: plate }).stroke({ width: 6, color: edge, alpha: 0.9 });
    front.roundRect(o.x - q + 22, o.y - q + 12, 2 * q - 44, 30, 15).fill({ color: '#ffffff', alpha: T.dark ? 0.3 : 0.7 }); // the lit top edge
    front.circle(o.x + 10, o.y + 14, COLLAR_R).fill({ color: '#000000', alpha: 0.16 }); // the collar stands proud: a soft shadow below right
    front.circle(o.x, o.y, COLLAR_R).fill({ color: mix(plate, '#ffffff', 0.35) }).stroke({ width: 5, color: mix(plate, '#000000', 0.2), alpha: 0.55 });
    front.circle(o.x, o.y, COLLAR_R - 14).stroke({ width: 3, color: '#ffffff', alpha: T.dark ? 0.25 : 0.8 });
    front.poly(recessPoly(o.x + 4, o.y + 5)).fill({ color: '#ffffff', alpha: T.dark ? 0.3 : 0.8 }); // the recess's lit lower edge
    front.poly(recessPoly(o.x, o.y)).fill({ color: hollow }).stroke({ width: 5, color: mix(hollow, '#000000', 0.38), alpha: 0.7 });
    for (const [dx, dy] of HOLES) { front.circle(o.x + dx, o.y + dy, 20).fill({ color: hole }); front.circle(o.x + dx - 5, o.y + dy - 6, 7).fill({ color: '#000000', alpha: 0.5 }); }
    const [sx, sy] = SCREW;
    front.circle(o.x + sx, o.y + sy, 15).fill({ color: mix(hollow, '#9aa0ae', 0.6) }).stroke({ width: 3, color: mix(hollow, '#000000', 0.4), alpha: 0.8 }); // the fixing screw
    front.moveTo(o.x + sx - 9, o.y + sy).lineTo(o.x + sx + 9, o.y + sy).stroke({ width: 3.5, color: '#4b5262', alpha: 0.9 });
  }
  void m;
}

/** The desk lamp itself (the soft shadow under it is the scenery's): a weighted base, a lower arm that leans back, an elbow, an upper arm forward over the desk and the hood (the glow is live). `lampShape` reads the silhouette of this. */
export function drawLamp(f: Graphics, L: Look, geo: RoomGeo) {
  const ys = geo.ys;
  const lx = geo.lamp.x, hd = geo.lamp.head, p0 = { x: lx + LAMP.pivot.x, y: ys + LAMP.pivot.y }, el = { x: lx + LAMP.elbow.x, y: ys + LAMP.elbow.y };
  // the base: a weighted disc seen from above (its rim and top are ellipses squashed like the mug's) with a hub the arm pivots on
  const rx = LAMP.base, ry = rx * MUG.e, rx2 = rx - 200, ry2 = rx2 * MUG.e;
  // a drum: straight sides between two heights with its front arc at the bottom, shaded round (a lit streak on the left, darker toward the right)
  const edge = mix(L.metalLo, '#000000', 0.45);
  const cyl = (yt: number, yb: number, r: number, col: string) => {
    const arc = (c0: number, c1: number) => { const out: number[] = [], a0 = Math.acos(c0), a1 = Math.acos(c1); for (let k = 0; k <= 32; k++) { const a = a0 + ((a1 - a0) * k) / 32; out.push(lx + r * Math.cos(a), yb + r * MUG.e * Math.sin(a)); } return out; };
    f.poly([lx - r, yt, lx + r, yt, ...arc(1, -1)]).fill({ color: col }).stroke({ width: 7, color: edge, alpha: 0.9 });
    for (const [c, al] of [[0.3, 0.1], [0.62, 0.1], [0.88, 0.12]] as const) f.poly([lx + r * c, yt, lx + r, yt, ...arc(1, c)]).fill({ color: '#000000', alpha: al });
    f.poly([lx - r * 0.9, yt, lx - r * 0.7, yt, ...arc(-0.7, -0.9)]).fill({ color: '#ffffff', alpha: 0.2 });
  };
  cyl(ys - 208, ys - 8, rx, L.metalLo);
  f.ellipse(lx, ys - 208, rx, ry).fill({ color: mix(L.metal, L.metalLo, 0.35) }).stroke({ width: 7, color: mix(L.metal, '#ffffff', 0.2) });
  cyl(ys - 328, ys - 208, rx2, L.metal);
  f.ellipse(lx, ys - 328, rx2, ry2).fill({ color: mix(L.metal, '#ffffff', 0.18) }).stroke({ width: 6, color: mix(L.metal, '#ffffff', 0.35) });
  f.ellipse(lx - rx2 * 0.25, ys - 330, rx2 * 0.5, ry2 * 0.5).fill({ color: '#ffffff', alpha: 0.14 });
  // an arm: a rod with a dark outline, a lit edge and a shaded edge, and beside it the parallel linkage: a thin plain rod with a pin at each end
  const arm = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l, nx2 = -uy, ny2 = ux;
    const line = (o: number, w: number, color: string, alpha = 1) => f.moveTo(a.x + nx2 * o, a.y + ny2 * o).lineTo(b.x + nx2 * o, b.y + ny2 * o).stroke({ width: w, color, alpha, cap: 'round' });
    // the linkage first (behind the rod)
    line(230, 46, edge); line(230, 32, L.metalLo); line(223, 8, '#ffffff', 0.3);
    for (const q of [a, b]) f.circle(q.x + nx2 * 230, q.y + ny2 * 230, 46).fill({ color: L.metal }).stroke({ width: 7, color: edge });
    // the rod
    line(0, 176, edge); line(0, 160, L.metalLo); line(0, 118, L.metal); line(0, 56, mix(L.metal, '#ffffff', 0.25));
    line(-30, 16, '#ffffff', 0.4); line(-66, 8, '#dfe7ff', 0.4); line(48, 28, '#000000', 0.18);
  };
  arm(p0, el); arm(el, hd);
  // the joints: a dark ring, a round knuckle with a lit upper left, a hub with a screw slot
  const joint = (px2: number, py2: number) => {
    f.circle(px2, py2, 196).fill({ color: edge });
    f.circle(px2, py2, 180).fill({ color: L.metalLo });
    f.circle(px2, py2, 150).fill({ color: L.metal });
    f.circle(px2 - 34, py2 - 38, 92).fill({ color: '#ffffff', alpha: 0.16 });
    f.circle(px2, py2, 70).fill({ color: L.metalLo }).stroke({ width: 8, color: edge });
    f.moveTo(px2 - 42, py2 + 20).lineTo(px2 + 42, py2 - 20).stroke({ width: 12, color: edge, cap: 'round' });
  };
  joint(p0.x, p0.y); joint(el.x, el.y);
  // the hood: a cone from a collar on the arm's end to a wide mouth, shaded in strips round its axis (lit along the top), then the opening whole on top of it, with the bulb inside
  const mo = geo.lamp.mouth, nx = -LAMP_D.y * SIDE, ny = LAMP_D.x * SIDE, hw = LAMP.hood, nk = LAMP.neck, dx = LAMP_D.x, dy = LAMP_D.y;
  const HOOD_LO = '#27486b', HOOD = '#3f6a9a', STRIPS = 14;
  const at = (u: number, t: number) => [hd.x + nx * nk * u + (mo.x - hd.x) * t - nx * (nk * u) * t + nx * hw * u * t, hd.y + ny * nk * u + (mo.y - hd.y) * t - ny * (nk * u) * t + ny * hw * u * t] as const;
  for (let i = 0; i < STRIPS; i++) {
    const u0 = -1 + (2 * i) / STRIPS, u1 = -1 + (2 * (i + 1)) / STRIPS, c = mix('#6f9fd0', HOOD_LO, Math.min(1, ((i + 0.5) / STRIPS) ** 0.8));
    const p = [at(u0, 0), at(u0, 1), at(u1, 1), at(u1, 0)];
    f.poly(p.flatMap((q) => [q[0], q[1]])).fill({ color: c }).stroke({ width: 3, color: c });
  }
  const sp = [at(-0.78, 0.1), at(-0.78, 1), at(-0.62, 1), at(-0.62, 0.1)];
  f.poly(sp.flatMap((q) => [q[0], q[1]])).fill({ color: '#ffffff', alpha: 0.25 });
  f.poly(hood0(hd, mo, nx, ny, nk, hw)).stroke({ width: 9, color: HOOD_LO, join: 'round' });
  // the opening: the dark inside, a lighter wall round the far side, the unlit bulb (the live glow lights these), a lit lip all round
  const bu = lampBulb(mo);
  f.poly(lampOpening(mo)).fill({ color: mix(HOOD_LO, '#000000', 0.35) });
  f.poly(lampOpening({ x: mo.x - dx * 50, y: mo.y - dy * 50 }, 0.8)).fill({ color: mix(HOOD_LO, '#000000', 0.6) });
  f.circle(bu.x, bu.y, LAMP.bulb).fill({ color: '#b9b7a6' }).stroke({ width: 8, color: '#6f6f68' });
  f.circle(bu.x - 60, bu.y - 60, 70).fill({ color: '#ffffff', alpha: 0.35 });
  f.poly(lampOpening(mo)).stroke({ width: 18, color: mix(HOOD, '#ffffff', 0.35), join: 'round' });
  // the collar: a band round the neck, and the head joint on top of it
  f.poly([hd.x + nx * (nk + 60), hd.y + ny * (nk + 60), hd.x + nx * (nk + 60) + dx * 130, hd.y + ny * (nk + 60) + dy * 130, hd.x - nx * (nk + 60) + dx * 130, hd.y - ny * (nk + 60) + dy * 130, hd.x - nx * (nk + 60), hd.y - ny * (nk + 60)]).fill({ color: L.metalLo }).stroke({ width: 7, color: edge });
  joint(hd.x, hd.y);
}

/** The hood's outline: the neck's two ends and the mouth's two ends. */
const hood0 = (hd: { x: number; y: number }, mo: { x: number; y: number }, nx: number, ny: number, nk: number, hw: number) =>
  [hd.x + nx * nk, hd.y + ny * nk, mo.x + nx * hw, mo.y + ny * hw, mo.x - nx * hw, mo.y - ny * hw, hd.x - nx * nk, hd.y - ny * nk];

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
  drawCeiling(g, T, { ...shell, ...geo.persp });
  g.rect(-90000, geo.ceil, 180000, geo.floor - geo.ceil).fill({ color: L.wall });
  drawSlats(g, T, shell, geo.persp.vx);
  drawWallShade(g, T, shell, geo.persp.vx);
  drawCrown(g, T, shell);
  // the desk's top meets the wall at its far edge: the wall just above it is a little in shadow, easing out upward (24 fine bands: a gradient, not a stripe)
  // (in the light theme the wall's own pale blue over the tan slats read as a haze: the shadow is a warm dark there)
  const dusk = T.dark ? L.wallLo : '#4a3a30', dk = T.dark ? 1 : 0.4, D = deskGeo(geo.persp, ys, geo.floor);
  for (let k = 0; k < 24; k++) g.rect(-90000, D.yBack - 1700 + k * 71, 180000, 75).fill({ color: dusk, alpha: 0.5 * dk * ((k + 1) / 24) ** 2.2 });
  // what hangs on the wall and stands before it throws a soft shadow east and down (the lamp and the window are west and above): under all of it
  const cast = (r: Rect, dx: number, dy: number, spread: number, a: number, rad = 60, cuts?: Cuts) => {
    const n = 16; // enough nested rects that no ring shows
    for (let k = 0; k < n; k++) {
      const e = spread * (1 - k / (n - 1));
      if (cuts) g.poly(cutRect(r.x + dx - e, r.y + dy - e, r.w + 2 * e, r.h + 2 * e, growCuts(cuts, e))); else g.roundRect(r.x + dx - e, r.y + dy - e, r.w + 2 * e, r.h + 2 * e, rad + e);
      g.fill({ color: '#000000', alpha: (a * (T.dark ? 1 : 0.6)) / n });
    }
  };
  cast(MONITOR, 520, 420, 460, 0.42, 300);
  cast(CASE, 560, 420, 500, 0.42, 120, caseCuts());
  cast(geo.clock, 150, 230, 150, 0.5, 90);
  cast(OUTBOX, 130, 200, 130, 0.45, 40);
  for (let row = 0; row < TRAY_ROWS; row++) cast({ x: geo.keyRack.x, y: geo.keyRack.y + row * ROW_DROP, w: geo.keyRack.w, h: 360 }, 140, 210, 140, 0.45, 30);
  cast({ x: ROUTER_SPOT.x - 300, y: SHELF_Y, w: ROUTER_SPOT.w + 420, h: 170 }, 200, 300, 160, 0.42, 20);
  // what stands on the desk throws its shadow on the wall behind it too: the plant, the mug and the lamp's arms and hood
  cast({ x: geo.mug - MUG.r, y: ys - MUG.h, w: MUG.r * 2, h: MUG.h }, 300, 220, 200, 0.3, 200);
  {
    const lx = geo.lamp.x, p0 = { x: lx, y: ys - 300 }, el = { x: lx + LAMP.elbow.x, y: ys + LAMP.elbow.y }, hd = geo.lamp.head, mo = geo.lamp.mouth, dx = 520, dy = 380, k = T.dark ? 1 : 0.6;
    const nx = -LAMP_D.y * SIDE, ny = LAMP_D.x * SIDE, hw = LAMP.hood, nk = LAMP.neck;
    for (const [w, a] of [[420, 0.07], [300, 0.08], [190, 0.1]] as const) g.moveTo(p0.x + dx, p0.y + dy).lineTo(el.x + dx, el.y + dy).lineTo(hd.x + dx, hd.y + dy).stroke({ width: w, color: '#000000', alpha: a * k, cap: 'round', join: 'round' });
    for (const grow of [1.5, 1.25, 1]) g.poly([hd.x + nx * nk * grow + dx, hd.y + ny * nk * grow + dy, mo.x + nx * hw * grow + dx, mo.y + ny * hw * grow + dy, mo.x - nx * hw * grow + dx, mo.y - ny * hw * grow + dy, hd.x - nx * nk * grow + dx, hd.y - ny * nk * grow + dy]).fill({ color: '#000000', alpha: 0.05 * k });
  }

  // the router shelf: a plank on two brackets, the wall plate above it on the left (both drawn by the network layer)
  const sx0 = ROUTER_SPOT.x - 300, sx1 = ROUTER_SPOT.x + ROUTER_SPOT.w + 120, sy = SHELF_Y;
  g.rect(sx0, sy, sx1 - sx0, 170).fill({ color: L.wood }).stroke({ width: 8, color: L.edge, alpha: 0.7 });
  g.rect(sx0 + 14, sy + 14, sx1 - sx0 - 28, 16).fill({ color: L.woodHi, alpha: 0.8 });
  // (two braces under the plank, seen from the front: a slim metal strip each with a lit edge and two screws, and the dark under the plank on the wall)
  for (const bx of [sx0 + 360, sx1 - 440]) {
    g.rect(bx + 22, sy + 170, 90, 320).fill({ color: '#000000', alpha: T.dark ? 0.3 : 0.14 });
    g.rect(bx, sy + 170, 90, 300).fill({ color: L.metalLo }).stroke({ width: 5, color: L.edge, alpha: 0.5 });
    g.rect(bx + 6, sy + 176, 26, 288).fill({ color: '#ffffff', alpha: 0.22 });
    for (const dy of [70, 230]) g.circle(bx + 45, sy + 170 + dy, 15).fill({ color: L.metal }).stroke({ width: 3, color: L.metalLo });
  }
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
  // the recess: the glass is set back in the wall, so the sides of the opening that face the vanishing point show (the west side, the head from below, the sill's inner top)
  {
    const P = geo.persp, k = 0.97, gx = (x: number) => P.vx + (x - P.vx) * k, gy = (y: number) => P.yH + (y - P.yH) * k, x1 = w.x + w.w, y1 = w.y + w.h;
    const face = (pts: [number, number][], col: string, a = 0.96) => gf.poly(pts.flat()).fill({ color: col, alpha: a });
    if (gx(w.x) > w.x) face([[w.x, w.y], [w.x, y1], [gx(w.x), gy(y1)], [gx(w.x), gy(w.y)]], mix(L.wallLo, '#000000', T.dark ? 0.2 : 0.32));
    if (gy(w.y) > w.y) face([[w.x, w.y], [x1, w.y], [Math.min(x1, gx(x1)), gy(w.y)], [gx(w.x), gy(w.y)]], mix(L.wallLo, '#000000', T.dark ? 0.45 : 0.4)); // (the glass is set back: the opening's far side clips it)
    if (gx(x1) < x1) face([[x1, w.y], [x1, y1], [gx(x1), gy(y1)], [gx(x1), gy(w.y)]], mix(L.wallLo, '#ffffff', 0.1));
    if (gy(y1) < y1) face([[w.x, y1], [x1, y1], [Math.min(x1, gx(x1)), gy(y1)], [gx(w.x), gy(y1)]], mix(frameCol, '#ffffff', 0.15));
  }
  // the sill: a board that sticks out of the wall, seen from above (its top is a trapezoid to the vanishing point) with its front edge and the shadow under it
  const sill = new Graphics();
  {
    const P = geo.persp, S = 1.03, sy0 = w.y + w.h + 80, sy1 = spreadY(P, sy0, S), sx0 = w.x - 500, sx1 = w.x + w.w + 500, fx0 = spreadX(P, sx0, S), fx1 = spreadX(P, sx1, S);
    sill.poly([sx0, sy0, sx1, sy0, fx1, sy1, fx0, sy1]).fill({ color: L.woodHi }).stroke({ width: 6, color: L.edge, alpha: 0.5 });
    sill.rect(fx0, sy1, fx1 - fx0, 210).fill({ color: L.wood }).stroke({ width: 8, color: L.edge, alpha: 0.7 });
    sill.rect(fx0 + 20, sy1 + 10, fx1 - fx0 - 40, 20).fill({ color: L.woodHi, alpha: 0.8 });
    sill.rect(fx0 + 60, sy1 + 210, fx1 - fx0 - 120, 120).fill({ color: '#000000', alpha: 0.16 });
    drawPlant(sill, T, w.x + w.w - 1100, (sy0 + sy1) / 2 + 20); // a plant on the sill, in front of the glass
  }
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
    // a peg in the rail seen end-on: a grey dot (the lanyard hangs from it); a hook's bend would not read at this distance
    const peg = T.dark ? '#8b93a6' : '#8a919f';
    g.circle(h.x + 8, h.y + 10, 30).fill({ color: '#000000', alpha: 0.25 });
    g.circle(h.x, h.y, 30).fill({ color: peg }).stroke({ width: 5, color: mix(peg, '#000000', 0.35) });
    g.circle(h.x - 8, h.y - 9, 9).fill({ color: '#ffffff', alpha: 0.4 });
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
  // the desk mat, the keyboard and the mouse, in front of the monitor's foot (`peripherals.ts`: turned a few degrees, on the desk top in perspective; drawn on the over layer, above the monitor)
  const mcx = MONITOR.x + MONITOR.w / 2;
  drawMat(o, T, D, mcx); drawKeyboard(o, T, L, D, mcx); drawMouse(o, T, L, D, mcx);
  // the mug in the gap between the monitor and the case (`mug.ts`: seen from a little above, a coaster, a tapered body with a chip die printed on it, a handle, the coffee; the steam is live)
  const mx = geo.mug;
  drawMug(o, T.dark, mx, ys, L.cork);
  // the lamp at the desk's very west end: a weighted base, a lower arm that leans back, an elbow, an upper arm forward over the desk and the hood (the glow is live)
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
  const edge = (r: Rect, rad: number, a = 0.8, cuts?: Cuts) => {
    if (cuts) { // a chamfered box: the hairline follows the cut corners (the top, the cut top west corner and the west side are lit)
      const [tl, tr, , bl] = cuts;
      g.poly(cutRect(r.x, r.y, r.w, r.h, cuts)).stroke({ width: w2 * 0.6, color: col, alpha: a * 0.35 });
      g.moveTo(r.x + tl, r.y).lineTo(r.x + r.w - tr, r.y).stroke({ width: w1, color: hi, alpha: a });
      g.moveTo(r.x, r.y + tl).lineTo(r.x + tl, r.y).stroke({ width: w2, color: hi, alpha: a * 0.85 });
      g.moveTo(r.x, r.y + tl).lineTo(r.x, r.y + r.h - bl).stroke({ width: w2, color: col, alpha: a * 0.7 });
      return;
    }
    g.roundRect(r.x, r.y, r.w, r.h, rad).stroke({ width: w2 * 0.6, color: col, alpha: a * 0.35 });
    g.moveTo(r.x + rad, r.y).lineTo(r.x + r.w - rad, r.y).stroke({ width: w1, color: hi, alpha: a });
    g.moveTo(r.x, r.y + rad).lineTo(r.x, r.y + r.h - rad).stroke({ width: w2, color: col, alpha: a * 0.7 });
  };
  edge(MONITOR, 330, 0.85); edge(CASE, 120, 0.85, caseCuts()); edge(geo.clock, 90, 0.7); edge(OUTBOX, 40, 0.6);
  for (let row = 0; row < TRAY_ROWS; row++) edge({ x: geo.keyRack.x, y: geo.keyRack.y + row * ROW_DROP, w: geo.keyRack.w, h: 360 }, 30, 0.6);
  edge({ x: ROUTER_SPOT.x - 300, y: SHELF_Y, w: ROUTER_SPOT.w + 420, h: 170 }, 0, 0.6);
  for (const o of [geo.socket.mon, geo.socket.pc]) edge({ x: o.x - PLATE_Q, y: o.y - PLATE_Q, w: 2 * PLATE_Q, h: 2 * PLATE_Q }, 70, 0.5); // (each Swiss outlet has its own square plate)
  const kp = keyboardPlacer(deskGeo(geo.persp, ys, geo.floor), MONITOR.x + MONITOR.w / 2), ka = kp(-KEYBOARD.w / 2, KEYBOARD.d / 2, KEYBOARD.h), kb2 = kp(KEYBOARD.w / 2, KEYBOARD.d / 2, KEYBOARD.h);
  g.moveTo(ka[0], ka[1]).lineTo(kb2[0], kb2[1]).stroke({ width: w1, color: hi, alpha: 0.7 }); // the keyboard's top-front edge
  const D = deskGeo(geo.persp, ys, geo.floor);
  g.moveTo(D.xAt(geo.desk.x0, S_FRONT), D.yFront).lineTo(D.xAt(geo.desk.x1, S_FRONT), D.yFront).stroke({ width: 20, color: hi, alpha: 0.8 }); // the desk's front edge, where the top turns down
  const mx = geo.mug, mt = ys - MUG.h;
  g.ellipse(mx, mt, MUG.r, MUG.r * MUG.e).stroke({ width: w2, color: hi, alpha: 0.7 });
  g.moveTo(mx - MUG.r, mt).lineTo(mx - MUG.rb, ys - 20).stroke({ width: w1, color: hi, alpha: 0.6 });
  // the lamp: the hood's rim and the lit side of the arms
  const lx = geo.lamp.x, p0 = { x: lx, y: ys - 300 }, el = { x: lx + LAMP.elbow.x, y: ys + LAMP.elbow.y }, hd = geo.lamp.head, mo = geo.lamp.mouth;
  const nx = -LAMP_D.y * SIDE, ny = LAMP_D.x * SIDE, hw = LAMP.hood, nk = LAMP.neck;
  // (only the hood's upper side, from past the collar to the mouth: no line across the opening or the joint)
  const t0 = 0.15, tx = hd.x - nx * nk + (mo.x - nx * hw - hd.x + nx * nk) * t0, ty = hd.y - ny * nk + (mo.y - ny * hw - hd.y + ny * nk) * t0;
  g.moveTo(tx, ty).lineTo(mo.x - nx * hw, mo.y - ny * hw).stroke({ width: w2, color: hi, alpha: 0.7, cap: 'round' });
  const arm = (a: { x: number; y: number }, b: { x: number; y: number }) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l, ax = -uy, ay = ux, c = 210; g.moveTo(a.x + ux * c - ax * 75, a.y + uy * c - ay * 75).lineTo(b.x - ux * c - ax * 75, b.y - uy * c - ay * 75).stroke({ width: w2, color: hi, alpha: 0.6 }); };
  arm(p0, el); arm(el, hd);
  return g;
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

/** A rectangle that answers a click, with the tooltip words. */
/** `shape` is the thing's silhouette (what the pointer picks and the hover ring follows); without one the rectangle is. */
export interface RoomHit { id: 'lamp' | 'blind' | 'clock'; rect: Rect; shape?: Shape }

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
    this.hits = [{ id: 'lamp', rect: geo.lamp.rect, shape: renderer ? lampShape(renderer, T, geo) : undefined }, { id: 'blind', rect: { x: w.x, y: w.y, w: w.w, h: w.h } }, { id: 'clock', rect: geo.clock }];
    this.frame(0, 0, true);
  }

  /**
   * Far out the wall and the desk are two baked textures (one quad each instead of a hundred overlapping shapes); close in, and when the view runs
   * past the baked region (a very wide or tall screen), they are drawn as shapes again. While `cover` (the case) fills the view, the room is not drawn.
   */
  setView(view: Rect, z: number, dpr: number, cover: Rect | null) {
    // a dead band on the zoom (8 %): a baked room stays baked through a wobble around the line instead of re-baking (lod.ts `ZoomSwitch`)
    const hide = !!cover && roomHidden(view, cover), want = !hide && roomBakeFits(view, this.baked ? z / 1.08 : z, dpr, this.geo);
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

  /** The room's items moved (the keyboard, the screen, the lamp's mouth, ...): the lights that follow them are redrawn (`LightView.setGeo`). */
  setLightGeo(patch: Partial<LightGeo>) { this.lightView?.setGeo(patch); }
  /** Nudge a light (`window`, `lamp`, `screen`, `clock`, or one added to the light view) by world units from where its item stands (`LightView.place`). */
  placeLight(id: string, dx: number, dy: number) { this.lightView?.place(id, dx, dy); }

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
    // the bulb in the hood's opening and the inside it lights, all inside the lip (the light it gives, the pool and the cone, is the light layer's)
    const bu = lampBulb(mo);
    g.poly(lampOpening(mo, 0.96)).fill({ color: '#ffd68a', alpha: 0.6 * Math.min(1, I * 1.5) });
    g.circle(bu.x, bu.y, LAMP.bulb + 45).fill({ color: '#fff0c0', alpha: 0.5 * Math.min(1, I * 1.5) });
    g.circle(bu.x, bu.y, LAMP.bulb).fill({ color: '#fff8e0', alpha: 0.97 * Math.min(1, I * 1.5) });
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
