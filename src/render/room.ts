import { Container, Graphics, Rectangle, Sprite, type Renderer, type Texture } from 'pixi.js';
import { disc, label, mix } from './ink';
import { acPlug, metalOf } from './ports';
import { trayHook } from './props';
import { roundedPath } from './routes';
import {
  CASE, DESK_SLAB, DESK_UNDER, DESK_Y, FLOOR_Y, FOOT, MONITOR, MONITOR_POWER, PC_POWER, OUTBOX, POWER_PLATE, ROUTER_SPOT, ROW_DROP, SHELF_Y, TRAY, TRAY_COLS, TRAY_ROWS, type Rect,
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
const DESK_WEST = 1100, DESK_EAST = 500;
/** How much wall the camera may show beyond the desk's and the window's ends, and below the wall socket (no floor); the top is the router or the window, whichever is higher. */
const BOX_SIDE = 900, BOX_BELOW = 700, BOX_TOP_ABOVE = 500;
/** The lamp stands at the desk's west end, its hood pointing down and east (SIDE 1; -1 would mirror it) at this angle; `LAMP_REACH` is the hood's length from the arm to its mouth. */
const SIDE = 1, LAMP_D = { x: 0.766 * SIDE, y: 0.643 }, LAMP_REACH = 840;

/** Y of the desk's top surface: the case stands on it, so it follows the case (a taller case sits lower on the desk). */
export const deskY = () => DESK_Y;

export interface RoomGeo {
  /** The desk's top surface, the floor, and the desk's west and east ends (the east end follows the case's width). */
  ys: number;
  floor: number;
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
  const bottom = geo.socket.plate.y + geo.socket.plate.h + BOX_BELOW, top = geo.top - BOX_TOP_ABOVE, x0 = Math.min(geo.desk.x0, geo.window.x - 420) - BOX_SIDE;
  return { x: x0, y: top, w: geo.desk.x1 + BOX_SIDE - x0, h: bottom - top };
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
  const ys = deskY(), east = CASE.x + CASE.w, lx = MONITOR.x - 1800, plate = POWER_PLATE;
  const window: Rect = { x: lx - 290 - 3900, y: -5600, w: 3900, h: 5700 };
  const clock: Rect = { x: CASE.x + CASE.w / 2 - 1500, y: -5500, w: 3000, h: 1100 };
  const head = { x: lx + 600 * SIDE, y: ys - 3150 };
  return {
    ys,
    floor: FLOOR_Y,
    desk: { x0: lx - DESK_WEST, x1: east + DESK_EAST },
    mug: MONITOR.x + MONITOR.w + 550,
    socket: { plate, mon: { x: plate.x + plate.w * 0.28, y: plate.y + plate.h / 2 }, pc: { x: plate.x + plate.w * 0.72, y: plate.y + plate.h / 2 } },
    window,
    clock,
    lamp: { x: lx, head, mouth: { x: head.x + LAMP_D.x * LAMP_REACH, y: head.y + LAMP_D.y * LAMP_REACH }, rect: { x: lx - (SIDE > 0 ? 600 : 1750), y: ys - 3500, w: 2350, h: 3500 } },
    keyRack: TRAY,
    top: Math.min(window.y - 190, clock.y, ROUTER_SPOT.y, TRAY.y),
  };
}

// ---- the clickable props and their state (a per-viewer convenience: kept in localStorage when it is there) ----
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
export const DAY_S = 480;
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
  wall: string; wallLo: string; stripe: string; wood: string; woodHi: string; woodLo: string; edge: string; line: string;
  paper: string; ink: string; cork: string; metal: string; metalLo: string; plastic: string; plasticLo: string; leaf: string; leafLo: string; pot: string; cloth: string;
}
const look = (T: Theme): Look => T.dark
  ? {
    wall: '#0e1a33', wallLo: '#0a1327', stripe: '#16264a', wood: '#3a2a2e', woodHi: '#4d3a3d', woodLo: '#241a1d', edge: '#6b5558', line: '#2a3768',
    paper: '#aeb8d4', ink: '#2b3560', cork: '#5a4634', metal: '#7d8bb0', metalLo: '#4a5679', plastic: '#2a3252', plasticLo: '#1b2140', leaf: '#3f9a6a', leafLo: '#256444', pot: '#a35a45', cloth: '#5a4a86',
  }
  : {
    wall: '#dbe3ee', wallLo: '#c9d4e3', stripe: '#e6ecf5', wood: '#c39b72', woodHi: '#d8b68f', woodLo: '#a37c58', edge: '#8a6a4c', line: '#9aabc8',
    paper: '#fbfcff', ink: '#2c3a63', cork: '#c9a26c', metal: '#8d99b4', metalLo: '#6b7794', plastic: '#e9eef6', plasticLo: '#c4cedf', leaf: '#3f9a6a', leafLo: '#2b7a52', pot: '#c9694e', cloth: '#7a63c4',
  };

/** A flat ellipse of shadow on the desk top (the desk's far strip, seen edge-on). */
const shadow = (g: Graphics, x: number, y: number, w: number, a = 0.3) => { g.ellipse(x, y, w / 2, Math.max(24, w * 0.035)).fill({ color: '#000000', alpha: a }); };

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
  // the PC: the plug in the rear wall's inlet, the cord west and down the gap
  const pcPlug = { x: PC_POWER.x - 6, y: PC_POWER.y, dx: -1, dy: 0, w: 190, l: 330 };
  const pcX = pcPlug.x - 40 - pcPlug.l + 4 + 120;
  cord([[pcPlug.x - pcPlug.l + 10, pcPlug.y], [pcX, pcPlug.y], [pcX, jog], [s.pc.x, jog], [s.pc.x, s.pc.y - 310]]);
  acPlug(back, T, pcPlug);
  // the monitor: the plug hangs under its bezel, the cord drops behind the shelf unit and the desk
  const mon = MONITOR_POWER, mPlug = { x: mon.x, y: mon.y + 4, dx: 0, dy: 1, w: 170, l: 300 };
  cord([[mon.x, mPlug.y + mPlug.l - 10], [mon.x, jog], [s.mon.x, jog], [s.mon.x, s.mon.y - 310]]);
  acPlug(back, T, mPlug);
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

/** The scenery: wall, window frame, shelf, clock face, desk, shelf unit, the wall socket and the cords, and what stands on the desk. */
function sceneryArt(T: Theme, geo: RoomGeo): { back: Container; front: Container; over: Container } {
  const L = look(T), ys = geo.ys;
  const back = new Container(), front = new Container(), over = new Container();
  const g = new Graphics(); back.addChild(g);
  const f = new Graphics(); front.addChild(f);
  const o = new Graphics(); over.addChild(o); // what stands in front of the cables that run behind it (the mug)

  // wall: an endless colour, a slow wallpaper stripe, and the darker band the desk throws on it
  g.rect(-90000, -90000, 180000, 180000).fill({ color: L.wall });
  for (let x = -48000; x < 48000; x += 1200) g.rect(x, -90000, 420, 180000).fill({ color: L.stripe, alpha: T.dark ? 0.55 : 0.6 });
  for (let k = 0; k < 6; k++) g.rect(-90000, ys - 1600 + k * 270, 180000, 280).fill({ color: L.wallLo, alpha: 0.18 + k * 0.05 });
  g.rect(-90000, ys - 400, 180000, 420).fill({ color: L.wallLo, alpha: 0.5 });

  // the router shelf: a plank on two brackets, the wall plate above it on the left (both drawn by the network layer)
  const sx0 = ROUTER_SPOT.x - 300, sx1 = ROUTER_SPOT.x + ROUTER_SPOT.w + 120, sy = SHELF_Y;
  g.rect(sx0, sy, sx1 - sx0, 170).fill({ color: L.wood }).stroke({ width: 8, color: L.edge, alpha: 0.7 });
  g.rect(sx0 + 14, sy + 14, sx1 - sx0 - 28, 16).fill({ color: L.woodHi, alpha: 0.8 });
  for (const bx of [sx0 + 380, sx1 - 560]) { g.poly([bx, sy + 170, bx + 120, sy + 170, bx + 120, sy + 560, bx, sy + 560]).fill({ color: L.metalLo }); g.poly([bx + 120, sy + 170, bx + 120, sy + 520, bx + 400, sy + 170]).fill({ color: L.metal, alpha: 0.9 }); }
  g.rect(sx0 + 20, sy + 170, sx1 - sx0 - 40, 70).fill({ color: '#000000', alpha: 0.16 });

  // the window: a recess in the wall, the glass (live sky goes here), a frame with a cross bar, a sill with a plant
  const w = geo.window;
  g.rect(w.x - 190, w.y - 190, w.w + 380, w.h + 380).fill({ color: L.wallLo }).stroke({ width: 10, color: L.line, alpha: 0.6 });
  g.rect(w.x - 120, w.y - 120, w.w + 240, w.h + 120).fill({ color: mix(L.wood, '#ffffff', T.dark ? 0.08 : 0.4) }).stroke({ width: 8, color: L.edge, alpha: 0.7 });
  g.rect(w.x, w.y, w.w, w.h).fill({ color: '#0a0f24' });
  const gf = new Graphics(); // the frame over the glass and the live sky
  gf.rect(w.x + w.w / 2 - 55, w.y, 110, w.h).fill({ color: mix(L.wood, '#ffffff', T.dark ? 0.1 : 0.45) });
  gf.rect(w.x, w.y + w.h * 0.46, w.w, 100).fill({ color: mix(L.wood, '#ffffff', T.dark ? 0.1 : 0.45) });
  gf.rect(w.x, w.y, w.w, w.h).stroke({ width: 70, color: mix(L.wood, '#ffffff', T.dark ? 0.1 : 0.45), alignment: 1 });
  gf.rect(w.x + 24, w.y + 24, w.w - 48, 16).fill({ color: '#ffffff', alpha: 0.14 });
  const sill = new Graphics();
  sill.rect(w.x - 420, w.y + w.h + 70, w.w + 840, 190).fill({ color: L.wood }).stroke({ width: 8, color: L.edge, alpha: 0.7 });
  sill.rect(w.x - 400, w.y + w.h + 80, w.w + 800, 18).fill({ color: L.woodHi, alpha: 0.8 });
  // a small plant on the sill
  const px = w.x + 900, py = w.y + w.h + 70;
  sill.poly([px - 380, py - 520, px + 380, py - 520, px + 300, py, px - 300, py]).fill({ color: L.pot }).stroke({ width: 8, color: L.edge, alpha: 0.6 });
  sill.rect(px - 420, py - 600, 840, 120).fill({ color: mix(L.pot, '#000000', 0.18) });
  for (const [dx, a, len] of [[-260, -0.55, 760], [-90, -0.2, 950], [100, 0.18, 880], [290, 0.5, 700], [0, 0, 620]] as const) {
    const ex = px + dx + Math.sin(a) * len, ey = py - 600 - Math.cos(a) * len;
    sill.moveTo(px + dx * 0.4, py - 590).quadraticCurveTo(px + dx + Math.sin(a) * len * 0.3, py - 600 - len * 0.6, ex, ey).stroke({ width: 70, color: L.leaf, cap: 'round' });
    sill.ellipse(ex, ey, 150, 90).fill({ color: L.leafLo });
  }
  back.addChild(gf, sill);

  // the digital clock on the wall above the case: a dark case, a dimmed "88:88" behind the lit digits (the digits are live)
  const c = geo.clock, led = ledColor(T);
  g.roundRect(c.x + 26, c.y + 40, c.w, c.h, 90).fill({ color: '#000000', alpha: 0.22 });
  g.roundRect(c.x, c.y, c.w, c.h, 90).fill({ color: T.dark ? '#141a26' : '#262d3a' }).stroke({ width: 10, color: L.edge, alpha: 0.7 });
  g.roundRect(c.x + 60, c.y + 60, c.w - 120, c.h - 120, 50).fill({ color: '#06080d' });
  for (const [x, y] of clockDigits(c)) segDigit(g, x, y, 8, led, 0.1);
  g.roundRect(c.x + 80, c.y + 74, c.w - 160, 18, 9).fill({ color: '#ffffff', alpha: 0.05 });

  // ---- the desk: a west leg, a drawer pedestal at the east end, and the slab on top; it spans from west of the keyboard to just past the case ----
  const d = DESK, ye = geo.floor, { x0, x1 } = geo.desk;
  // the dark under the desk: there is no floor in the picture; the wall just goes dark toward the bottom (below), so the legs and the
  // pedestal run on into the dark and no screen shape can show an edge of the room
  const under = ye + 500 - ys - d.slab, ped = { x: x1 - 4500, y: ys + d.slab, w: 4400, h: under };
  f.rect(x0 + 60, ys + d.slab, ped.x - x0 - 60, under).fill({ color: '#000000', alpha: T.dark ? 0.55 : 0.28 });
  // the west leg
  f.rect(x0 + 60, ys + d.slab, 600, under).fill({ color: L.woodLo }).stroke({ width: 8, color: L.edge, alpha: 0.6 });
  f.rect(x0 + 90, ys + d.slab, 40, under).fill({ color: L.woodHi, alpha: 0.35 });
  // the drawer pedestal, down to the floor, at the east end: two or three drawers by its height
  f.rect(ped.x, ped.y, ped.w, ped.h).fill({ color: L.wood }).stroke({ width: 8, color: L.edge, alpha: 0.7 });
  const nd = 3, dh = ped.h / nd;
  for (let k = 0; k < nd; k++) {
    const dy = ped.y + 90 + k * dh;
    f.rect(ped.x + 110, dy, ped.w - 220, dh - 130).fill({ color: L.woodHi, alpha: 0.5 }).stroke({ width: 7, color: L.edge, alpha: 0.6 });
    f.rect(ped.x + ped.w / 2 - 380, dy + (dh - 130) / 2 - 24, 760, 48).fill({ color: L.metal }).stroke({ width: 5, color: L.metalLo });
  }
  // the bottom goes dark in 16 bands (no gradient: it is also built in tests, which have no canvas), then stays dark
  const dark = T.dark ? mix(L.wallLo, '#000000', 0.6) : mix(L.wallLo, '#1b2a55', 0.35), aMax = T.dark ? 0.97 : 0.62;
  for (let k = 0; k < 16; k++) f.rect(-90000, ye - 400 + (k * 900) / 16, 180000, 900 / 16 + 2).fill({ color: dark, alpha: aMax * ((k + 1) / 16) });
  f.rect(-90000, ye + 500, 180000, 90000).fill({ color: dark, alpha: aMax });
  powerArt(T, geo, g, f);
  // the slab: a lit top, a front edge, a grain
  f.rect(x0, ys, x1 - x0, d.slab).fill({ color: L.wood }).stroke({ width: 10, color: L.edge, alpha: 0.8 });
  f.rect(x0 + 8, ys + 6, x1 - x0 - 16, 70).fill({ color: L.woodHi }); // the far strip of the top, seen at a slant
  f.rect(x0 + 8, ys + d.slab - 50, x1 - x0 - 16, 44).fill({ color: L.woodLo, alpha: 0.7 });
  for (let k = 0; k < 40; k++) {
    const x = x0 + ((k * 2654435761) % 1000) / 1000 * (x1 - x0 - 1800), y = ys + 100 + (k % 4) * 52;
    f.rect(x, y, 600 + (k % 5) * 420, 8).fill({ color: L.woodLo, alpha: 0.22 });
  }
  f.rect(x0, ys + d.slab, x1 - x0, 150).fill({ color: '#000000', alpha: 0.24 });

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
  // the keyboard: a low wedge with a row of caps along its top, on a thin mat
  const kx = MONITOR.x + 150, kw = 2400;
  f.rect(kx - 200, ys - 36, kw + 400, 40).fill({ color: L.plasticLo }).stroke({ width: 5, color: '#000000', alpha: 0.25 });
  f.poly([kx, ys - 36, kx + kw, ys - 36, kx + kw, ys - 186, kx + 80, ys - 270]).fill({ color: L.plastic }).stroke({ width: 6, color: L.line });
  for (let k = 0; k < 13; k++) f.rect(kx + 200 + k * 160, ys - 256 + ((200 + k * 160) / (kw - 80)) * 84, 120, 28).fill({ color: T.dark ? '#aab6dc' : L.paper, alpha: T.dark ? 0.7 : 0.95 });
  shadow(f, kx + kw / 2, ys + 30, kw, 0.28);
  // the mouse, east of the monitor's foot
  const mox = MONITOR.x + MONITOR.w / 2 + 2400 + 900;
  f.rect(mox - 520, ys - 36, 1040, 40).fill({ color: L.plasticLo }).stroke({ width: 5, color: '#000000', alpha: 0.25 });
  f.ellipse(mox, ys - 100, 220, 100).fill({ color: L.plastic }).stroke({ width: 6, color: L.line });
  f.rect(mox - 12, ys - 180, 24, 80).fill({ color: L.line, alpha: 0.7 });
  // the mug in the gap between the monitor and the case (steam is live)
  const mx = geo.mug;
  o.rect(mx - 420, ys - 1040, 840, 1040).fill({ color: '#e8edf8' }).stroke({ width: 8, color: L.line });
  o.rect(mx - 420, ys - 1040, 840, 140).fill({ color: '#3a2418' });
  o.circle(mx + 470, ys - 560, 230).stroke({ width: 70, color: '#e8edf8' });
  o.rect(mx - 380, ys - 700, 160, 600).fill({ color: '#000000', alpha: 0.07 });
  o.rect(mx - 120, ys - 760, 520, 90).fill({ color: '#d03a4a', alpha: 0.9 });
  shadow(f, mx, ys + 30, 1200, 0.3);
  // the lamp at the desk's very west end: base, two arms, a hood pointing east over the keyboard (the glow is live)
  const lx = geo.lamp.x, hd = geo.lamp.head, ex = lx + 1000 * SIDE, ey = ys - 1850;
  f.rect(lx - 520, ys - 150, 1040, 150).fill({ color: L.metalLo }).stroke({ width: 6, color: L.metal });
  f.rect(lx - 420, ys - 220, 840, 80).fill({ color: L.metal });
  f.moveTo(lx, ys - 200).lineTo(ex, ey).lineTo(hd.x, hd.y).stroke({ width: 82, color: L.metalLo, cap: 'round', join: 'round' });
  f.moveTo(lx, ys - 200).lineTo(ex, ey).lineTo(hd.x, hd.y).stroke({ width: 28, color: L.metal, cap: 'round', join: 'round' });
  for (const [px2, py2] of [[lx, ys - 200], [ex, ey], [hd.x, hd.y]] as const) f.circle(px2, py2, 70).fill({ color: L.metal }).stroke({ width: 6, color: L.metalLo });
  // the hood: a cone from the arm's end to a wide mouth, a rim, a lit stripe along its top
  const mo = geo.lamp.mouth, nx = -LAMP_D.y * SIDE, ny = LAMP_D.x * SIDE;
  const hood = [hd.x + nx * 110, hd.y + ny * 110, mo.x + nx * 440, mo.y + ny * 440, mo.x - nx * 440, mo.y - ny * 440, hd.x - nx * 110, hd.y - ny * 110];
  f.poly(hood).fill({ color: '#3f6a9a' }).stroke({ width: 8, color: '#27486b' });
  f.poly([hd.x - nx * 110, hd.y - ny * 110, mo.x - nx * 440, mo.y - ny * 440, mo.x - nx * 380 - LAMP_D.x * 70, mo.y - ny * 380 - LAMP_D.y * 70, hd.x - nx * 90, hd.y - ny * 90]).fill({ color: '#ffffff', alpha: 0.2 });
  f.poly([mo.x + nx * 440, mo.y + ny * 440, mo.x - nx * 440, mo.y - ny * 440, mo.x - nx * 440 - LAMP_D.x * 60, mo.y - ny * 440 - LAMP_D.y * 60, mo.x + nx * 440 - LAMP_D.x * 60, mo.y + ny * 440 - LAMP_D.y * 60]).fill({ color: '#27486b' });
  shadow(f, lx, ys + 30, 1500, 0.3);
  return { back, front, over };
}

/** The soft pool of light round the lamp, drawn once into a small texture (30 nested discs): one sprite per frame instead of 30 big circles. */
const glowTextures = new WeakMap<Renderer, Texture>();
function glowTexture(r: Renderer): Texture {
  let t = glowTextures.get(r);
  if (!t) {
    const g = new Graphics();
    for (let k = 0; k < 30; k++) g.circle(0, 0, 256 - k * 8.3).fill({ color: '#ffb35a', alpha: 0.0062 * (1 + k * 0.05) });
    t = r.generateTexture({ target: g, frame: new Rectangle(-256, -256, 512, 512), resolution: 0.5, antialias: true });
    g.destroy();
    glowTextures.set(r, t);
  }
  return t;
}
/** The glow's radius in world units. */
const GLOW_R = 5600;

/** `top` laid over `bottom` (each a colour and an opacity): the one colour and opacity that look the same, so a stack of full-screen washes is one fill. */
function over(top: { c: string; a: number }, bottom: { c: string; a: number }): { c: string; a: number } {
  const a = top.a + bottom.a * (1 - top.a);
  return a <= 0 ? { c: bottom.c, a: 0 } : { c: mix(bottom.c, top.c, top.a / a), a };
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

/** A rectangle that answers a click, with the tooltip words. */
export interface RoomHit { id: 'lamp' | 'blind'; rect: Rect }

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
  readonly geo: RoomGeo;
  readonly hits: RoomHit[];
  private readonly sky = new Graphics();
  private readonly amb = new Graphics();
  private readonly glow = new Graphics();
  private readonly pool: Sprite | null;
  private readonly clockG = new Graphics();
  private readonly steam = new Graphics();
  private readonly blindG = new Graphics();
  private readonly mask = new Graphics();
  private lamp = roomState.lamp ? 1 : 0;
  private blind = roomState.blind ? 1 : 0;
  private lastKey = '';

  /** `renderer` lets the lamp's pool of light be a baked texture; without one (tests) it is drawn as discs. */
  constructor(private T: Theme, geo = roomGeo(), renderer?: Renderer) {
    this.geo = geo;
    this.pool = renderer ? new Sprite(glowTexture(renderer)) : null;
    this.pool?.anchor.set(0.5);
    const { back, front, over } = sceneryArt(T, geo);
    this.over.addChild(over);
    const w = geo.window;
    this.mask.rect(w.x, w.y, w.w, w.h).fill({ color: '#ffffff' });
    this.sky.mask = this.mask;
    this.blindG.mask = this.mask;
    // order: wall and window frame, then the sky inside the glass (under the frame art), the desk, the lights, the hands
    this.root.addChild(back);
    back.addChild(this.behind);
    back.addChildAt(this.sky, 1);
    back.addChildAt(this.mask, 1);
    back.addChildAt(this.blindG, 3); // over the sky, under the frame, the sill and the plant on it
    this.root.addChild(front, this.amb);
    if (this.pool) this.root.addChild(this.pool);
    this.root.addChild(this.glow, this.clockG);
    this.over.addChild(this.steam);
    this.hits = [{ id: 'lamp', rect: geo.lamp.rect }, { id: 'blind', rect: { x: w.x, y: w.y, w: w.w, h: w.h } }];
    this.frame(0, 0, true);
  }

  /** Advance the live parts. Cheap when nothing visible changed (the key rounds the clock to a few steps a second). */
  frame(gt: number, dtMs: number, force = false): boolean {
    const goalL = roomState.lamp ? 1 : 0, goalB = roomState.blind ? 1 : 0, k = 1 - Math.exp(-dtMs / 140);
    this.lamp += (goalL - this.lamp) * (dtMs > 0 ? k : 1); if (Math.abs(goalL - this.lamp) < 0.01) this.lamp = goalL;
    this.blind += (goalB - this.blind) * (dtMs > 0 ? 1 - Math.exp(-dtMs / 260) : 1); if (Math.abs(goalB - this.blind) < 0.004) this.blind = goalB;
    const key = `${roomDebug.hour ?? ''}|${Math.round(gt / 120)}|${this.lamp.toFixed(2)}|${this.blind.toFixed(3)}`;
    if (!force && key === this.lastKey) return false;
    this.lastKey = key;
    const h = roomDebug.hour ?? hourAt(gt);
    this.drawSky(h, gt);
    this.drawAmbient(h);
    this.drawGlow(h);
    this.drawClock(h, gt);
    this.drawSteam(gt);
    return true;
  }

  private drawSky(h: number, gt: number) {
    const g = this.sky, w = this.geo.window, night = nightAt(h), s = skyAt(h);
    g.clear();
    const bands = 14;
    for (let i = 0; i < bands; i++) g.rect(w.x, w.y + (i * w.h) / bands, w.w, w.h / bands + 2).fill({ color: mix(s.top, s.hor, Math.pow(i / (bands - 1), 1.4)) });
    // the stars come out with the night
    if (night > 0.05) for (let k = 0; k < 46; k++) {
      const sx = w.x + (((k * 7919) % 1000) / 1000) * w.w, sy = w.y + (((k * 104729) % 1000) / 1000) * w.h * 0.62, tw = 0.6 + 0.4 * Math.sin(gt / 900 + k);
      g.circle(sx, sy, 16 + (k % 3) * 8).fill({ color: '#ffffff', alpha: Math.min(1, night * 1.2) * tw * 0.85 });
    }
    // the sun by day and the moon by night, each on an arc across the glass
    const sunT = (h - 5.6) / 12.8, moonT = ((h + 6) % 24) / 12.6;
    const arc = (t: number) => ({ x: w.x + w.w * (0.12 + 0.76 * t), y: w.y + w.h * (0.78 - 0.62 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)))) });
    if (sunT > -0.05 && sunT < 1.05) { const p = arc(sunT); g.circle(p.x, p.y, 340).fill({ color: '#fff3c4', alpha: 0.28 }); g.circle(p.x, p.y, 230).fill({ color: '#fff0a8' }); }
    if (moonT > 0 && moonT < 1) { const p = arc(moonT); g.circle(p.x, p.y, 320).fill({ color: '#dfe8ff', alpha: 0.12 }); g.circle(p.x, p.y, 200).fill({ color: '#eef2ff' }); g.circle(p.x - 70, p.y - 40, 40).fill({ color: '#c3cbe6' }); g.circle(p.x + 60, p.y + 50, 28).fill({ color: '#c3cbe6' }); }
    // the skyline: two rows of towers, dark against the day and lit windows at night
    const far = mix('#7d93b8', '#161c42', night), near = mix('#4a5f86', '#0a0e26', night);
    const row = (col: string, base: number, seed: number, lit: number) => {
      let x = w.x - 100, i = seed;
      while (x < w.x + w.w + 100) {
        const bw = 420 + ((i * 37) % 5) * 130, bh = base + ((i * 53) % 7) * 190;
        g.rect(x, w.y + w.h - bh, bw, bh + 10).fill({ color: col });
        if (night > 0.1 && lit > 0) for (let r = 0; r < Math.floor(bh / 280); r++) for (let q = 0; q < Math.floor(bw / 190); q++) if ((r * 5 + q * 3 + i) % 3 !== 0) g.rect(x + 50 + q * 190, w.y + w.h - bh + 80 + r * 280, 80, 120).fill({ color: '#ffd77a', alpha: night * lit * (0.55 + 0.4 * (((i + r + q) * 7) % 3 === 0 ? 0.5 : 1)) });
        x += bw + 40; i++;
      }
    };
    row(far, 620, 3, 0.5); row(near, 360, 11, 1);
    // a red beacon on the tallest tower blinks at night
    if (night > 0.3 && Math.floor(gt / 700) % 2 === 0) g.circle(w.x + w.w * 0.34, w.y + w.h - 1650, 34).fill({ color: '#ff4a4a', alpha: night });
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

  private drawAmbient(h: number) {
    const g = this.amb, night = nightAt(h), dusk = duskAt(h), d = this.T.dark;
    g.clear();
    const R = roomBox(this.geo), big = 9000;
    // the whole room dims at night (the light theme more than the dark one, which is dim already), brightens a little by day in the dark
    // theme and warms at the ends of the day: three washes, laid into one fill
    let wash = { c: d ? '#02040c' : '#1b2a55', a: d ? 0.3 * night : 0.34 * night };
    const lift = d ? 0.1 * (1 - night) : 0;
    if (lift > 0.002) wash = over({ c: '#bcd4ff', a: lift }, wash);
    if (dusk > 0.02) wash = over({ c: '#ff9a5a', a: 0.08 * dusk * (d ? 1 : 1.3) }, wash);
    if (wash.a > 0.002) g.rect(R.x - big, R.y - big, R.w + 2 * big, R.h + 2 * big).fill({ color: wash.c, alpha: wash.a });
    // the window's light: a shaft that leaves the glass in the direction the sun (or the moon) shines from, strongest at the glass and fading out by the
    // desk, and a flat patch where it reaches the desk top: it comes from where the body is in the sky (west of centre throws it east and the other way round),
    // the lower the body the longer and more slanted it is, and the sun is warm at the ends of the day
    const w = this.geo.window, ys = this.geo.ys;
    for (const L of lightsAt(h)) {
      const a = L.strength * (1 - this.blind);
      if (a < 0.003) continue;
      const yb = w.y + w.h, ya0 = [w.y, yb, ...Array.from({ length: 12 }, (_, k) => yb + ((ys - yb) * (k + 1)) / 12)];
      for (let k = 0; k + 1 < ya0.length; k++) {
        const ya = ya0[k]!, ye = ya0[k + 1]!, top = shaftSpan(w, ya, L.slant), bot = shaftSpan(w, ye - 0.01, L.slant);
        const fade = Math.pow(1 - Math.max(0, ya - yb) / (ys - yb), 1.4);
        g.poly([top.xl, ya, top.xr, ya, bot.xr, ye + 3, bot.xl, ye + 3]).fill({ color: L.color, alpha: a * fade });
      }
      // the patch it throws on the desk top (where the shaft meets it)
      const hit = shaftSpan(w, ys, L.slant), xa = Math.max(hit.xl, this.geo.desk.x0), xb = Math.min(hit.xr, this.geo.desk.x1);
      if (xb - xa > 200) g.ellipse((xa + xb) / 2, ys + 26, (xb - xa) / 2, 70).fill({ color: L.color, alpha: Math.min(0.5, a * 3.2) });
    }
  }

  private drawGlow(h: number) {
    const g = this.glow, geo = this.geo, night = nightAt(h), on = this.lamp, d = this.T.dark;
    g.clear();
    const I = on * (d ? 0.4 + 0.6 * night : 0.2 + 0.5 * night);
    if (this.pool) this.pool.visible = false;
    if (I < 0.01) return;
    const mo = geo.lamp.mouth, ys = geo.ys, nx = -LAMP_D.y * SIDE, ny = LAMP_D.x * SIDE;
    // a warm pool on the wall around the hood, a cone down from its mouth onto the desk and the keyboard, a bright bulb in the mouth
    if (this.pool) { this.pool.position.set(mo.x - 300 * SIDE, mo.y - 200); this.pool.scale.set((2 * GLOW_R) / 256); this.pool.alpha = I; this.pool.visible = true; }
    else for (let k = 0; k < 8; k++) g.circle(mo.x - 300 * SIDE, mo.y - 200, GLOW_R - k * 650).fill({ color: '#ffb35a', alpha: 0.023 * I * (1 + k * 0.2) });
    g.poly([mo.x + nx * 440, mo.y + ny * 440, mo.x - nx * 440, mo.y - ny * 440, mo.x + 3600 * SIDE, ys, mo.x - 900 * SIDE, ys]).fill({ color: '#ffc27a', alpha: 0.1 * I });
    g.ellipse(mo.x + 1300 * SIDE, ys + 30, 3000, 110).fill({ color: '#ffd9a0', alpha: 0.22 * I });
    g.circle(mo.x - LAMP_D.x * 40, mo.y - LAMP_D.y * 40, 330).fill({ color: '#ffd68a', alpha: 0.22 * I });
    g.circle(mo.x - LAMP_D.x * 40, mo.y - LAMP_D.y * 40, 170).fill({ color: '#fff2c8', alpha: 0.95 * Math.min(1, I * 1.5) });
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

  private drawSteam(gt: number) {
    const g = this.steam, ys = this.geo.ys, mx = this.geo.mug;
    g.clear();
    for (let k = 0; k < 3; k++) {
      const t = (gt / 3200 + k / 3) % 1, x0 = mx - 240 + k * 240, top = ys - 1100;
      // a wisp: a wavy column that rises, thins and fades; each of the three keeps its own phase
      const pts: number[] = [];
      for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(x0 + Math.sin(gt / 700 + k * 2 + u * 5) * (50 + 120 * u), top - (0.15 + t) * 700 * u * 2.4); }
      g.moveTo(pts[0]!, pts[1]!);
      for (let i = 1; i <= 12; i++) g.lineTo(pts[i * 2]!, pts[i * 2 + 1]!);
      g.stroke({ width: 52 - 20 * t, color: '#ffffff', alpha: 0.26 * Math.sin(Math.PI * t), cap: 'round', join: 'round' });
    }
  }
}
