import { Container, Graphics, Rectangle, Sprite, type Renderer, type Texture } from 'pixi.js';
import { disc, label, mix } from './ink';
import { CASE, MONITOR, ROUTER_SPOT, SHELF_Y, TRAY, type Rect } from './layout';
import type { Theme } from './theme';

// The room the machine lives in (docs/RENDER.md "The room"): a bedroom wall, a long desk and what stands on it, seen from the front
// like the rest of the world. It is all scenery behind the machine: one static art container plus a few live parts (the sky in
// the window, the wall's light, the lamp's glow, the mug's steam, the clock's hands) that follow the game clock. The lamp and the
// window blind are the only things that answer a click.

/** The camera cap: the zoom-out stops where this box fills the screen, and panning stays inside it (the wall itself reaches much further). */
export const ROOM: Rect = { x: -21500, y: -13400, w: 36000, h: 21500 };
/** Desk geometry that does not depend on the case: its west and east ends (well past the room box, so a wide screen never sees them), the slab's thickness and the floor under it. */
export const DESK = { x0: -34000, x1: 26000, slab: 340, floor: 7800 };
/** Height of the case feet below `CASE`: the desk top is where they stand. */
export const FOOT = 110;
/** The mug's centre x (the steam rises from it). */
const MUG_X = -15300;

/** Y of the desk's top surface: the case stands on it, so it follows the case (a taller case sits lower on the desk). */
export const deskY = () => CASE.y + CASE.h + FOOT;

export interface RoomGeo {
  /** The desk's top surface. */
  ys: number;
  /** The window (its glass) and the blind that covers it. */
  window: Rect;
  /** The clock face. */
  clock: { x: number; y: number; r: number };
  /** The desk lamp: its base x, and the box that answers a click. */
  lamp: { x: number; head: { x: number; y: number }; mouth: { x: number; y: number }; rect: Rect };
  /** The shelf unit under the monitor: its outer rect (the monitor stands on top, the tray sits in its first cubby). */
  unit: Rect;
}

/** The lamp hood points down and east at this angle; `LAMP_REACH` is the hood's length from the arm to its mouth. */
const LAMP_D = { x: 0.766, y: 0.643 }, LAMP_REACH = 840;

export function roomGeo(): RoomGeo {
  const ys = deskY();
  const lx = -17600;
  return {
    ys,
    window: { x: -20300, y: -6600, w: 6200, h: 5300 },
    clock: { x: -7900, y: -6300, r: 640 },
    lamp: { x: lx, head: { x: lx + 600, y: ys - 3150 }, mouth: { x: lx + 600 + LAMP_D.x * LAMP_REACH, y: ys - 3150 + LAMP_D.y * LAMP_REACH }, rect: { x: lx - 600, y: ys - 3500, w: 2350, h: 3500 } },
    unit: { x: -8900, y: MONITOR.y + MONITOR.h + 8, w: 4120, h: ys - (MONITOR.y + MONITOR.h + 8) },
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

/** The scenery: wall, window frame, shelf, clock face, corkboard, poster, desk, shelf unit and what stands on the desk. */
function sceneryArt(T: Theme, geo: RoomGeo): { back: Container; front: Container } {
  const L = look(T), ys = geo.ys;
  const back = new Container(), front = new Container();
  const g = new Graphics(); back.addChild(g);
  const f = new Graphics(); front.addChild(f);

  // wall: an endless colour, a slow wallpaper stripe, and the darker band the desk throws on it
  g.rect(-90000, -90000, 180000, 180000).fill({ color: L.wall });
  for (let x = ROOM.x - 400; x < ROOM.x + ROOM.w + 400; x += 1200) g.rect(x, -90000, 420, 180000).fill({ color: L.stripe, alpha: T.dark ? 0.55 : 0.6 });
  for (let k = 0; k < 6; k++) g.rect(-90000, ys - 1600 + k * 270, 180000, 280).fill({ color: L.wallLo, alpha: 0.18 + k * 0.05 });
  g.rect(-90000, ys - 400, 180000, 420).fill({ color: L.wallLo, alpha: 0.5 });
  // the skirting board and the floor are in `deskArt`; a picture rail along the top keeps a tall wall from being plain
  g.rect(-90000, ROOM.y + 700, 180000, 90).fill({ color: L.wallLo, alpha: 0.7 });

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

  // the clock on the wall: face, rim, ticks (the hands are live)
  const c = geo.clock;
  disc(g, c.x + 28, c.y + 40, c.r + 40, { fill: '#000000', fa: 0.22 });
  disc(g, c.x, c.y, c.r + 60, { fill: L.metalLo, stroke: L.edge, lw: 8, sa: 0.6 });
  disc(g, c.x, c.y, c.r, { fill: T.dark ? '#d8dff3' : '#fbfcff', stroke: L.line, lw: 8 });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, r0 = c.r * (k % 3 === 0 ? 0.78 : 0.86);
    g.moveTo(c.x + Math.sin(a) * r0, c.y - Math.cos(a) * r0).lineTo(c.x + Math.sin(a) * c.r * 0.94, c.y - Math.cos(a) * c.r * 0.94).stroke({ width: k % 3 === 0 ? 30 : 16, color: '#2b3560', cap: 'round' });
  }

  // the corkboard with its notes, to the right of the window
  const cb: Rect = { x: -13700, y: -4600, w: 2450, h: 2800 };
  g.rect(cb.x - 110, cb.y - 110, cb.w + 220, cb.h + 220).fill({ color: L.wood }).stroke({ width: 8, color: L.edge, alpha: 0.7 });
  g.rect(cb.x, cb.y, cb.w, cb.h).fill({ color: L.cork });
  for (let k = 0; k < 70; k++) { const a = ((k * 7919) % 1000) / 1000, b = ((k * 104729) % 1000) / 1000; g.circle(cb.x + a * cb.w, cb.y + b * cb.h, 12 + (k % 3) * 8).fill({ color: mix(L.cork, '#000000', 0.25), alpha: 0.35 }); }
  const notes: { x: number; y: number; w: number; h: number; c: string; r: number; t: string }[] = [
    { x: cb.x + 160, y: cb.y + 200, w: 740, h: 720, c: '#ffd75e', r: -0.06, t: 'buy RAM' },
    { x: cb.x + 960, y: cb.y + 150, w: 740, h: 740, c: '#7fe0a8', r: 0.05, t: 'jobs due' },
    { x: cb.x + 1650, y: cb.y + 330, w: 700, h: 700, c: '#ff9db5', r: -0.03, t: 'ISP?' },
    { x: cb.x + 280, y: cb.y + 1150, w: 1200, h: 1400, c: '#ffffff', r: 0.04, t: '' },
    { x: cb.x + 1560, y: cb.y + 1300, w: 720, h: 720, c: '#9ed4ff', r: 0.07, t: 'power?' },
  ];
  for (const n of notes) {
    const ng = new Graphics(); ng.position.set(n.x + n.w / 2, n.y + n.h / 2); ng.rotation = n.r;
    ng.rect(-n.w / 2 + 14, -n.h / 2 + 22, n.w, n.h).fill({ color: '#000000', alpha: 0.2 });
    ng.rect(-n.w / 2, -n.h / 2, n.w, n.h).fill({ color: n.c });
    ng.circle(0, -n.h / 2 + 90, 46).fill({ color: '#d03a4a' });
    if (!n.t) { // a printed sheet: the city map, as lines
      for (let k = 0; k < 6; k++) ng.rect(-n.w / 2 + 110, -n.h / 2 + 260 + k * 150, n.w - 220 - (k % 3) * 150, 26).fill({ color: '#8a97c2', alpha: 0.8 });
      ng.rect(-n.w / 2 + 110, -n.h / 2 + 150, 520, 56).fill({ color: '#2b3560', alpha: 0.85 });
    } else {
      ng.addChild(label(n.t, 0, 40, 150, '#3a3030', { anchor: [0.5, 0.5], a: 0.8 }));
    }
    back.addChild(ng);
  }

  // a poster over the desk's east half: the city at night, as a framed print
  const po: Rect = { x: 7400, y: -5200, w: 2600, h: 3500 };
  g.rect(po.x + 30, po.y + 40, po.w, po.h).fill({ color: '#000000', alpha: 0.2 });
  g.rect(po.x - 90, po.y - 90, po.w + 180, po.h + 180).fill({ color: T.dark ? '#1b2342' : '#fbfcff' }).stroke({ width: 10, color: L.line });
  g.rect(po.x, po.y, po.w, po.h).fill({ color: '#101a45' });
  for (let k = 0; k < 8; k++) g.rect(po.x, po.y + k * 160, po.w, 160).fill({ color: mix('#101a45', '#ff7a8a', k / 11), alpha: 0.55 });
  disc(g, po.x + po.w * 0.7, po.y + 760, 280, { fill: '#ffe9b8', fa: 0.95 });
  const bl = [[0.0, 0.36, 0.14], [0.14, 0.52, 0.12], [0.26, 0.3, 0.1], [0.36, 0.62, 0.13], [0.49, 0.42, 0.1], [0.59, 0.7, 0.14], [0.73, 0.4, 0.11], [0.84, 0.55, 0.16]] as const;
  for (const [bx, bh, bw] of bl) {
    const x = po.x + bx * po.w, h = bh * po.h * 0.8, y = po.y + po.h - h;
    g.rect(x, y, bw * po.w, h).fill({ color: '#070b22' });
    for (let r = 0; r < Math.floor(h / 260); r++) for (let q = 0; q < Math.floor((bw * po.w) / 190); q++) if ((r * 7 + q * 3 + Math.floor(bx * 20)) % 3 !== 0) g.rect(x + 50 + q * 190, y + 90 + r * 260, 90, 120).fill({ color: '#ffd77a', alpha: 0.85 });
  }
  back.addChild(label('PIPELINE CITY', po.x + po.w / 2, po.y + 330, 210, '#cfd9ff', { head: true, anchor: [0.5, 0.5], a: 0.9 }));

  // a coat on a hook, east of the poster
  const hx = 11400, hy = -4300;
  g.rect(hx - 380, hy - 120, 760, 100).fill({ color: L.wood }).stroke({ width: 6, color: L.edge, alpha: 0.7 });
  for (const dx of [-220, 220]) g.circle(hx + dx, hy - 70, 52).fill({ color: L.metal });
  g.poly([hx - 90, hy, hx + 90, hy, hx + 150, hy + 140, hx + 750, hy + 360, hx + 640, hy + 1900, hx + 360, hy + 1860, hx + 330, hy + 1120, hx + 300, hy + 3000, hx - 300, hy + 3000, hx - 330, hy + 1120, hx - 360, hy + 1860, hx - 640, hy + 1900, hx - 750, hy + 360, hx - 150, hy + 140]).fill({ color: L.cloth }).stroke({ width: 10, color: mix(L.cloth, '#000000', 0.3), alpha: 0.8 });
  g.poly([hx - 150, hy + 140, hx, hy + 520, hx + 150, hy + 140, hx + 90, hy, hx - 90, hy]).fill({ color: mix(L.cloth, '#000000', 0.25) });
  g.moveTo(hx, hy + 520).lineTo(hx, hy + 3000).stroke({ width: 10, color: mix(L.cloth, '#000000', 0.35), alpha: 0.7 });

  // ---- the desk ----
  const d = DESK, ye = d.floor;
  // the floor and the dark under the desk
  f.rect(-90000, ye, 180000, 90000).fill({ color: mix(L.wallLo, '#000000', T.dark ? 0.35 : 0.12) });
  for (let x = -90000 + 600; x < 90000; x += 1400) f.rect(x, ye, 18, 90000).fill({ color: '#000000', alpha: 0.18 });
  f.rect(-90000, ye - 90, 180000, 110).fill({ color: mix(L.wallLo, '#000000', 0.25) }); // the skirting board
  f.rect(d.x0 + 700, ys + d.slab, d.x1 - d.x0 - 1400, ye - 90 - ys - d.slab).fill({ color: '#000000', alpha: T.dark ? 0.55 : 0.28 });
  // the end panels, a drawer block and the back rail
  for (const x of [-20900, 9300]) { f.rect(x, ys + d.slab, 600, ye - 90 - ys - d.slab).fill({ color: L.woodLo }).stroke({ width: 8, color: L.edge, alpha: 0.6 }); f.rect(x + 30, ys + d.slab, 40, ye - 90 - ys - d.slab).fill({ color: L.woodHi, alpha: 0.35 }); }
  const dbH = Math.min(2300, ye - 90 - ys - d.slab - 200);
  const db = { x: -12400, y: ys + d.slab, w: 4300, h: dbH };
  f.rect(db.x, db.y, db.w, db.h).fill({ color: L.wood }).stroke({ width: 8, color: L.edge, alpha: 0.7 });
  const dh = db.h / 2;
  for (let k = 0; k < 2; k++) {
    const dy = db.y + 90 + k * dh;
    f.rect(db.x + 110, dy, db.w - 220, dh - 130).fill({ color: L.woodHi, alpha: 0.5 }).stroke({ width: 7, color: L.edge, alpha: 0.6 });
    f.rect(db.x + db.w / 2 - 380, dy + (dh - 130) / 2 - 24, 760, 48).fill({ color: L.metal }).stroke({ width: 5, color: L.metalLo });
  }
  // the slab: a lit top, a front edge, a grain
  f.rect(d.x0, ys, d.x1 - d.x0, d.slab).fill({ color: L.wood }).stroke({ width: 10, color: L.edge, alpha: 0.8 });
  f.rect(d.x0 + 8, ys + 6, d.x1 - d.x0 - 16, 70).fill({ color: L.woodHi }); // the far strip of the top, seen at a slant
  f.rect(d.x0 + 8, ys + d.slab - 50, d.x1 - d.x0 - 16, 44).fill({ color: L.woodLo, alpha: 0.7 });
  for (let k = 0; k < 90; k++) {
    const x = d.x0 + ((k * 2654435761) % 1000) / 1000 * (d.x1 - d.x0), y = ys + 100 + (k % 4) * 52;
    f.rect(x, y, 600 + (k % 5) * 420, 8).fill({ color: L.woodLo, alpha: 0.22 });
  }
  f.rect(d.x0, ys + d.slab, d.x1 - d.x0, 150).fill({ color: '#000000', alpha: 0.24 });

  // ---- the shelf unit under the monitor: top plank, two boards, a cubby for the tray, more cubbies when the case is taller ----
  const u = geo.unit, bw = 190;
  f.rect(u.x, u.y, u.w, u.h).fill({ color: mix(L.woodLo, '#000000', 0.3) });
  const t0 = u.y + 200, shelves: number[] = [];
  // the first board is just under the tray, then one every ~1,150 down to the desk
  const trayBottom = TRAY.y + TRAY.h + 18;
  shelves.push(trayBottom);
  for (let y = trayBottom + 1250; y < ys - 600; y += 1250) shelves.push(y);
  for (const y of shelves) f.rect(u.x, y, u.w, Math.min(210, ys - y)).fill({ color: L.wood }).stroke({ width: 6, color: L.edge, alpha: 0.6 });
  f.rect(u.x, u.y, bw, u.h).fill({ color: L.wood }).stroke({ width: 6, color: L.edge, alpha: 0.6 });
  f.rect(u.x + u.w - bw, u.y, bw, u.h).fill({ color: L.wood }).stroke({ width: 6, color: L.edge, alpha: 0.6 });
  f.rect(u.x + 20, u.y, 30, u.h).fill({ color: L.woodHi, alpha: 0.4 });
  f.rect(u.x - 70, u.y, u.w + 140, t0 - u.y).fill({ color: L.wood }).stroke({ width: 8, color: L.edge, alpha: 0.7 });
  f.rect(u.x - 50, u.y + 14, u.w + 100, 20).fill({ color: L.woodHi, alpha: 0.8 });
  // what the lower cubbies hold: a cardboard box of cables, a pile of books, a tin
  const cubby = (i: number): Rect | null => {
    const top = shelves[i]! + 210, bot = shelves[i + 1] ?? ys;
    return bot - top > 500 ? { x: u.x + bw, y: top, w: u.w - 2 * bw, h: bot - top } : null;
  };
  for (let i = 0; i < shelves.length; i++) {
    const r = cubby(i); if (!r) continue;
    const k = i % 3;
    if (k === 0) { // a cardboard box
      const bx = r.x + 420, bh = Math.min(r.h - 150, 820), by = r.y + r.h - bh;
      f.rect(bx, by, 1700, bh).fill({ color: '#b48a5a' }).stroke({ width: 7, color: '#7a5a38' });
      f.rect(bx, by, 1700, 150).fill({ color: '#c9a070' });
      f.rect(bx + 600, by + 250, 500, 220).fill({ color: '#fbfcff', alpha: 0.9 });
      f.rect(bx + 660, by + 310, 380, 24).fill({ color: '#2b3560', alpha: 0.7 });
      f.rect(bx + 660, by + 380, 260, 24).fill({ color: '#2b3560', alpha: 0.5 });
    } else if (k === 1) { // books
      const cols = ['#5a4a86', '#a35a45', '#3f6a9a', '#c9a24a', '#3f9a6a'];
      let x = r.x + 300;
      for (let b = 0; b < 7; b++) { const bh = Math.min(r.h - 100, 700 + (b % 3) * 120), bwid = 150 + (b % 2) * 50; f.rect(x, r.y + r.h - bh, bwid, bh).fill({ color: cols[b % cols.length]! }).stroke({ width: 5, color: '#000000', alpha: 0.3 }); x += bwid + 6; }
    } else { // a tin of cables
      f.rect(r.x + r.w - 1900, r.y + r.h - 520, 1200, 520).fill({ color: L.metalLo }).stroke({ width: 6, color: L.metal });
      f.rect(r.x + r.w - 1900, r.y + r.h - 520, 1200, 90).fill({ color: L.metal });
    }
  }
  // the monitor's feet cast a little shadow on the top plank
  f.rect(MONITOR.x + MONITOR.w / 2 - 1500, u.y - 4, 3000, 28).fill({ color: '#000000', alpha: 0.28 });
  shadow(f, u.x + u.w / 2, ys + 44, u.w + 300, 0.32);

  // ---- on the desk: the case's own shadow, a duck, the keyboard, the lamp, the mug, a book stack; and east of the case, the plant, a jar, headphones ----
  shadow(f, CASE.x + CASE.w / 2, ys + 44, CASE.w + 400, 0.34);
  const kx = -14800, kw = 4200;
  // a desk mat under the keyboard and the mouse
  f.rect(kx - 400, ys - 36, kw + 1350, 40).fill({ color: L.plasticLo }).stroke({ width: 5, color: '#000000', alpha: 0.25 });
  // the keyboard: a low wedge with a row of caps along its top
  f.poly([kx, ys - 36, kx + kw, ys - 36, kx + kw, ys - 186, kx + 80, ys - 270]).fill({ color: L.plastic }).stroke({ width: 6, color: L.line });
  for (let k = 0; k < 24; k++) f.rect(kx + 200 + k * 160, ys - 242 + (k * 3.3 / 24) * 24 - (k * 0.7), 120, 28).fill({ color: T.dark ? '#aab6dc' : L.paper, alpha: T.dark ? 0.7 : 0.95 });
  shadow(f, kx + kw / 2, ys + 30, kw, 0.28);
  // the mouse
  f.ellipse(kx + kw + 700, ys - 100, 240, 100).fill({ color: L.plastic }).stroke({ width: 6, color: L.line });
  f.rect(kx + kw + 700 - 12, ys - 180, 24, 80).fill({ color: L.line, alpha: 0.7 });
  // the mug (steam is live)
  const mx = MUG_X;
  f.rect(mx - 420, ys - 1040, 840, 1040).fill({ color: '#e8edf8' }).stroke({ width: 8, color: L.line });
  f.rect(mx - 420, ys - 1040, 840, 140).fill({ color: '#3a2418' });
  f.circle(mx + 470, ys - 560, 230).stroke({ width: 70, color: '#e8edf8' });
  f.rect(mx - 380, ys - 700, 160, 600).fill({ color: '#000000', alpha: 0.07 });
  f.rect(mx - 120, ys - 760, 520, 90).fill({ color: '#d03a4a', alpha: 0.9 });
  shadow(f, mx, ys + 30, 1200, 0.3);
  // a book stack and a pen cup at the west end
  const bsx = -20400;
  [['#3f6a9a', 1500, 230], ['#a35a45', 1300, 200], ['#c9a24a', 1580, 180]].forEach(([c, w, h], i) => {
    const y = ys - [0, 230, 430][i]! - (h as number);
    f.rect(bsx + (i === 1 ? 70 : i === 2 ? -40 : 0), y, w as number, h as number).fill({ color: c as string }).stroke({ width: 6, color: '#000000', alpha: 0.3 });
    f.rect(bsx + (i === 1 ? 70 : i === 2 ? -40 : 0) + 40, y + 50, (w as number) - 80, 22).fill({ color: L.paper, alpha: 0.5 });
  });
  shadow(f, bsx + 700, ys + 30, 1900, 0.26);
  f.rect(-18900, ys - 800, 520, 800).fill({ color: L.metalLo }).stroke({ width: 6, color: L.metal });
  for (const [dx, a] of [[-120, -0.2], [20, 0.05], [150, 0.3]] as const) f.moveTo(-18640 + dx, ys - 790).lineTo(-18640 + dx + Math.sin(a) * 700, ys - 790 - Math.cos(a) * 700).stroke({ width: 40, color: dx === 20 ? '#ffd75e' : '#d03a4a', cap: 'round' });
  // the lamp: base, two arms, a hood (the glow is live)
  const lx = geo.lamp.x, hd = geo.lamp.head, ex = lx + 1000, ey = ys - 1850;
  f.rect(lx - 520, ys - 150, 1040, 150).fill({ color: L.metalLo }).stroke({ width: 6, color: L.metal });
  f.rect(lx - 420, ys - 220, 840, 80).fill({ color: L.metal });
  f.moveTo(lx, ys - 200).lineTo(ex, ey).lineTo(hd.x, hd.y).stroke({ width: 82, color: L.metalLo, cap: 'round', join: 'round' });
  f.moveTo(lx, ys - 200).lineTo(ex, ey).lineTo(hd.x, hd.y).stroke({ width: 28, color: L.metal, cap: 'round', join: 'round' });
  for (const [px2, py2] of [[lx, ys - 200], [ex, ey], [hd.x, hd.y]] as const) f.circle(px2, py2, 70).fill({ color: L.metal }).stroke({ width: 6, color: L.metalLo });
  // the hood: a cone from the arm's end to a wide mouth, a rim, a lit stripe along its top
  const mo = geo.lamp.mouth, nx = -LAMP_D.y, ny = LAMP_D.x;
  const hood = [hd.x + nx * 110, hd.y + ny * 110, mo.x + nx * 440, mo.y + ny * 440, mo.x - nx * 440, mo.y - ny * 440, hd.x - nx * 110, hd.y - ny * 110];
  f.poly(hood).fill({ color: '#3f6a9a' }).stroke({ width: 8, color: '#27486b' });
  f.poly([hd.x - nx * 110, hd.y - ny * 110, mo.x - nx * 440, mo.y - ny * 440, mo.x - nx * 380 - LAMP_D.x * 70, mo.y - ny * 380 - LAMP_D.y * 70, hd.x - nx * 90, hd.y - ny * 90]).fill({ color: '#ffffff', alpha: 0.2 });
  f.poly([mo.x + nx * 440, mo.y + ny * 440, mo.x - nx * 440, mo.y - ny * 440, mo.x - nx * 440 - LAMP_D.x * 60, mo.y - ny * 440 - LAMP_D.y * 60, mo.x + nx * 440 - LAMP_D.x * 60, mo.y + ny * 440 - LAMP_D.y * 60]).fill({ color: '#27486b' });
  shadow(f, lx, ys + 30, 1500, 0.3);
  // a rubber duck by the riser, to listen to the bugs
  const dkx = -4310;
  f.ellipse(dkx, ys - 230, 330, 210).fill({ color: '#ffd23a' }).stroke({ width: 6, color: '#b8901a' });
  f.circle(dkx + 220, ys - 520, 190).fill({ color: '#ffd23a' }).stroke({ width: 6, color: '#b8901a' });
  f.poly([dkx + 360, ys - 520, dkx + 640, ys - 480, dkx + 360, ys - 430]).fill({ color: '#ff8a1a' });
  f.circle(dkx + 270, ys - 570, 28).fill({ color: '#1b2140' });
  shadow(f, dkx, ys + 30, 800, 0.28);
  // east of the case: a plant, a jar of pens, headphones on a stand
  const east = CASE.x + CASE.w + 1500;
  f.poly([east - 520, ys - 880, east + 520, ys - 880, east + 400, ys, east - 400, ys]).fill({ color: L.pot }).stroke({ width: 8, color: L.edge, alpha: 0.6 });
  f.rect(east - 570, ys - 1000, 1140, 150).fill({ color: mix(L.pot, '#000000', 0.18) });
  for (const [dx, h] of [[-300, 1500], [-100, 2200], [150, 1900], [330, 1200]] as const) { f.moveTo(east + dx, ys - 980).lineTo(east + dx * 1.4, ys - 980 - h).stroke({ width: 120, color: L.leaf, cap: 'round' }); f.moveTo(east + dx * 1.4, ys - 980 - h).lineTo(east + dx * 1.4, ys - 980 - h + 90).stroke({ width: 150, color: L.leafLo, cap: 'round' }); }
  shadow(f, east, ys + 30, 1300, 0.3);
  const hpx = east + 2900;
  f.rect(hpx - 70, ys - 1900, 140, 1900).fill({ color: L.metalLo });
  f.rect(hpx - 560, ys - 130, 1120, 130).fill({ color: L.metalLo }).stroke({ width: 6, color: L.metal });
  f.moveTo(hpx - 700, ys - 1250).quadraticCurveTo(hpx, ys - 3000, hpx + 700, ys - 1250).stroke({ width: 90, color: L.plasticLo, cap: 'round' });
  f.moveTo(hpx - 700, ys - 1250).quadraticCurveTo(hpx, ys - 3000, hpx + 700, ys - 1250).stroke({ width: 30, color: L.plastic, cap: 'round' });
  for (const sg of [-1, 1]) f.ellipse(hpx + sg * 700, ys - 1130, 210, 330).fill({ color: L.plastic }).stroke({ width: 8, color: L.line });
  shadow(f, hpx, ys + 30, 1300, 0.28);
  return { back, front };
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

/** A rectangle that answers a click, with the tooltip words. */
export interface RoomHit { id: 'lamp' | 'blind'; rect: Rect }

/**
 * The room as a scene node: static scenery, plus the live parts. `frame(gt, dt)` moves them on the game clock `gt` (ms); the
 * blind and the lamp ease on wall time `dt` (ms).
 */
export class RoomView {
  readonly root = new Container();
  readonly geo: RoomGeo;
  readonly hits: RoomHit[];
  private readonly sky = new Graphics();
  private readonly amb = new Graphics();
  private readonly glow = new Graphics();
  private readonly pool: Sprite | null;
  private readonly hands = new Graphics();
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
    const { back, front } = sceneryArt(T, geo);
    const w = geo.window;
    this.mask.rect(w.x, w.y, w.w, w.h).fill({ color: '#ffffff' });
    this.sky.mask = this.mask;
    this.blindG.mask = this.mask;
    // order: wall and window frame, then the sky inside the glass (under the frame art), the desk, the lights, the hands
    this.root.addChild(back);
    back.addChildAt(this.sky, 1);
    back.addChildAt(this.mask, 1);
    back.addChildAt(this.blindG, 3); // over the sky, under the frame, the sill and the plant on it
    this.root.addChild(front, this.amb);
    if (this.pool) this.root.addChild(this.pool);
    this.root.addChild(this.glow, this.steam, this.hands);
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
    this.drawHands(h);
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
    const R = ROOM, big = 9000;
    // the whole room dims at night (the light theme more than the dark one, which is dim already), brightens a little by day in the dark
    // theme and warms at the ends of the day: three washes, laid into one fill
    let wash = { c: d ? '#02040c' : '#1b2a55', a: d ? 0.3 * night : 0.34 * night };
    const lift = d ? 0.1 * (1 - night) : 0;
    if (lift > 0.002) wash = over({ c: '#bcd4ff', a: lift }, wash);
    if (dusk > 0.02) wash = over({ c: '#ff9a5a', a: 0.08 * dusk * (d ? 1 : 1.3) }, wash);
    if (wash.a > 0.002) g.rect(R.x - big, R.y - big, R.w + 2 * big, R.h + 2 * big).fill({ color: wash.c, alpha: wash.a });
    // the window's light on the wall and the desk: a slanted pool going down and east, stronger by day, a cold wash by moonlight
    const w = this.geo.window, ys = this.geo.ys, day = 1 - night;
    const reach = ys - w.y;
    const a = (day * 0.08 + dusk * 0.05 + night * 0.025) * (1 - this.blind);
    if (a > 0.003) {
      const col = day > 0.35 ? '#fff0c8' : night > 0.5 ? '#aebfff' : '#ffb070';
      g.poly([w.x, w.y + w.h, w.x + w.w, w.y + w.h, w.x + w.w + reach * 0.55 + 3300, ys, w.x + reach * 0.55 + 700, ys]).fill({ color: col, alpha: a });
    }
  }

  private drawGlow(h: number) {
    const g = this.glow, geo = this.geo, night = nightAt(h), on = this.lamp, d = this.T.dark;
    g.clear();
    const I = on * (d ? 0.4 + 0.6 * night : 0.2 + 0.5 * night);
    if (this.pool) this.pool.visible = false;
    if (I < 0.01) return;
    const mo = geo.lamp.mouth, ys = geo.ys, nx = -LAMP_D.y, ny = LAMP_D.x;
    // a warm pool on the wall around the hood, a cone down from its mouth onto the desk and the keyboard, a bright bulb in the mouth
    if (this.pool) { this.pool.position.set(mo.x - 300, mo.y - 200); this.pool.scale.set((2 * GLOW_R) / 256); this.pool.alpha = I; this.pool.visible = true; }
    else for (let k = 0; k < 8; k++) g.circle(mo.x - 300, mo.y - 200, GLOW_R - k * 650).fill({ color: '#ffb35a', alpha: 0.023 * I * (1 + k * 0.2) });
    g.poly([mo.x + nx * 440, mo.y + ny * 440, mo.x - nx * 440, mo.y - ny * 440, mo.x + 3600, ys, mo.x - 900, ys]).fill({ color: '#ffc27a', alpha: 0.1 * I });
    g.ellipse(mo.x + 1300, ys + 30, 3000, 110).fill({ color: '#ffd9a0', alpha: 0.22 * I });
    g.circle(mo.x - LAMP_D.x * 40, mo.y - LAMP_D.y * 40, 330).fill({ color: '#ffd68a', alpha: 0.22 * I });
    g.circle(mo.x - LAMP_D.x * 40, mo.y - LAMP_D.y * 40, 170).fill({ color: '#fff2c8', alpha: 0.95 * Math.min(1, I * 1.5) });
  }

  private drawHands(h: number) {
    const g = this.hands, c = this.geo.clock;
    g.clear();
    const hr = ((h % 12) / 12) * Math.PI * 2, mn = ((h * 60) % 60) / 60 * Math.PI * 2;
    g.moveTo(c.x, c.y).lineTo(c.x + Math.sin(hr) * c.r * 0.5, c.y - Math.cos(hr) * c.r * 0.5).stroke({ width: 44, color: '#2b3560', cap: 'round' });
    g.moveTo(c.x, c.y).lineTo(c.x + Math.sin(mn) * c.r * 0.78, c.y - Math.cos(mn) * c.r * 0.78).stroke({ width: 26, color: '#2b3560', cap: 'round' });
    g.circle(c.x, c.y, 44).fill({ color: '#d03a4a' });
  }

  private drawSteam(gt: number) {
    const g = this.steam, ys = this.geo.ys, mx = MUG_X;
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
