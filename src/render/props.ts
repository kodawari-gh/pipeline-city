import { Container, Graphics, Text } from 'pixi.js';
import type { InventorySnap, KeySnap } from '../sim/game/game';
import { box, dashed, disc, HEAD, label, mix, MONO } from './ink';
import { CRATE, POWER_BTN, POWER_PLATE, TRAY, TRAY_COLS, USB_PORT, type Rect } from './layout';
import type { Theme } from './theme';

// World props for the assembly game: the parts crate (inventory icons), the USB key tray, a key stick, the power button.
// Each prop that can be clicked or dragged is a Container centred on its own origin, so board.ts / interact.ts can
// lift and scale it about its middle on hover.

export interface PropObj {
  id: string;
  /** World rect of the whole object (hit test, outline, highlight ring). */
  rect: Rect;
  /** The container that animates on hover (position = its centre in world units). */
  node: Container;
  base: { x: number; y: number; s: number };
}

export interface PropsArt { root: Container; objs: PropObj[]; led: Graphics; ledText: Text | null }

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const shortName = (n: string) => n.replace(/ \(.*$/, '');
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------- icons for crate items (nominal 480 x 480, centred)

export const ICON = 480;

function accentOf(T: Theme, kind: string): string {
  switch (kind) {
    case 'cpu': return T.alu;
    case 'psu': return T.ld;
    case 'ram': return T.mul;
    case 'display': return T.st;
    case 'cooler': return T.alu;
    case 'board': return T.br;
    default: return T.mute;
  }
}

/** A small recognisable icon for a part kind, centred on (0,0), about ICON units across. */
export function partIcon(T: Theme, kind: string, _spec = ''): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  const a = accentOf(T, kind);
  const body = T.dark ? mix(T.sub, T.tile, 0.5) : mix(T.sub, T.tile, 0.35);
  const edge = (w = 8) => ({ stroke: a, lw: w });
  g.roundRect(-210, 190, 420, 24, 12).fill({ color: '#000000', alpha: 0.2 }); // contact shadow
  if (kind === 'cpu') {
    box(g, -170, -170, 340, 340, 28, { fill: body, ...edge() });
    for (let i = 0; i < 9; i++) for (const o of [-150, 138]) { g.rect(-130 + i * 30, o, 12, 12); g.rect(o, -130 + i * 30, 12, 12); }
    g.fill({ color: T.pin, alpha: 0.9 });
    box(g, -86, -86, 172, 172, 12, { fill: T.die, stroke: a, lw: 6 });
    for (let i = 0; i < 4; i++) { g.moveTo(-60, -50 + i * 34).lineTo(60, -50 + i * 34); }
    g.stroke({ width: 5, color: a, alpha: 0.7 });
    g.poly([-165, -165, -118, -165, -165, -118]).fill({ color: T.pin });
  } else if (kind === 'psu') {
    box(g, -230, -140, 460, 280, 26, { fill: body, ...edge() });
    disc(g, -110, 0, 98, { fill: T.die, stroke: T.line, lw: 6 });
    for (let k = 0; k < 5; k++) { const th = (k / 5) * Math.PI * 2; g.moveTo(-110, 0).lineTo(-110 + Math.cos(th) * 84, Math.sin(th) * 84); }
    g.stroke({ width: 18, color: a, alpha: 0.8, cap: 'round' });
    for (let y = -90; y <= 90; y += 36) g.moveTo(60, y).lineTo(205, y);
    g.stroke({ width: 10, color: T.line, alpha: 0.8, cap: 'round' });
  } else if (kind === 'ram') {
    box(g, -236, -76, 472, 152, 14, { fill: body, ...edge() });
    for (let i = 0; i < 6; i++) box(g, -206 + i * 70, -52, 56, 78, 8, { fill: T.die, stroke: T.line, lw: 4 });
    for (let i = 0; i < 26; i++) g.rect(-224 + i * 17, 48, 10, 20);
    g.fill({ color: T.pin });
    g.rect(-20, 56, 18, 14).fill({ color: body });
  } else if (kind === 'display') {
    box(g, -210, -170, 420, 270, 20, { fill: mix(body, '#000000', 0.2), ...edge() });
    box(g, -188, -148, 376, 226, 8, { fill: '#050a0c' });
    for (let i = 0; i < 4; i++) g.rect(-164, -122 + i * 32, 100 + ((i * 53) % 150), 12);
    g.fill({ color: a, alpha: 0.85 });
    g.poly([-40, 100, 40, 100, 70, 160, -70, 160]).fill({ color: body });
    box(g, -120, 160, 240, 24, 12, { fill: body, stroke: a, lw: 5 });
  } else if (kind === 'cooler') {
    box(g, -180, -180, 360, 360, 24, { fill: body, ...edge() });
    for (let x = -150; x < 150; x += 30) g.moveTo(x, -160).lineTo(x, 160);
    g.stroke({ width: 7, color: T.line });
    disc(g, 0, 0, 120, { fill: T.die, stroke: a, lw: 6 });
    for (let k = 0; k < 6; k++) { const th = (k / 6) * Math.PI * 2; g.moveTo(0, 0).lineTo(Math.cos(th) * 105, Math.sin(th) * 105); }
    g.stroke({ width: 16, color: a, alpha: 0.7, cap: 'round' });
  } else if (kind === 'board') {
    box(g, -220, -200, 440, 400, 20, { fill: mix(T.board, a, 0.12), ...edge() });
    box(g, -110, -110, 120, 120, 8, { fill: T.die, stroke: T.line, lw: 4 });
    for (let i = 0; i < 4; i++) g.rect(50 + i * 34, -160, 18, 240);
    g.fill({ color: T.line });
    for (let i = 0; i < 5; i++) g.rect(-180 + i * 56, 130, 38, 28);
    g.fill({ color: T.pin, alpha: 0.8 });
  } else {
    box(g, -160, -160, 320, 320, 24, { fill: body, ...edge() });
    c.addChild(label('?', 0, 0, 200, a, { head: true, anchor: [0.5, 0.5] }));
  }
  return c;
}

// ---------------------------------------------------------------- the crate

/** Largest cell size (<= 700) such that n items fit the crate interior in a grid. */
function cellFor(n: number, w: number, h: number): number {
  for (let s = 700; s >= 300; s -= 20) if (Math.floor(w / s) * Math.floor(h / (s * 0.92)) >= n) return s;
  return 300;
}

export function crateArt(T: Theme, items: InventorySnap[]): PropsArt {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const r = CRATE;
  const wood = mix(T.sub, T.ld, T.dark ? 0.16 : 0.22), woodDark = mix(wood, '#000000', 0.35);
  box(g, r.x + 14, r.y + 26, r.w, r.h, 40, { fill: '#000000', fa: 0.22 });
  box(g, r.x, r.y, r.w, r.h, 40, { fill: wood, stroke: T.ld, lw: 12, sa: 0.85 });
  // interior (looking down into the open crate), slats on the walls
  const inner = { x: r.x + 90, y: r.y + 150, w: r.w - 180, h: r.h - 250 };
  box(g, inner.x, inner.y, inner.w, inner.h, 24, { fill: woodDark, fa: 0.8, stroke: T.ld, lw: 5, sa: 0.5 });
  for (let x = r.x + 160; x < r.x + r.w - 100; x += 300) g.moveTo(x, r.y + r.h - 90).lineTo(x, r.y + r.h - 18);
  g.stroke({ width: 9, color: woodDark, alpha: 0.9 });
  root.addChild(label('STARTER CRATE', r.x + 100, r.y + 78, 84, T.ld, { head: true }));
  root.addChild(label(items.length ? `${items.length} part${items.length === 1 ? '' : 's'} - drag onto the board` : 'EMPTY', r.x + r.w - 100, r.y + 78, 46, T.mute, { anchor: [1, 0.5] }));
  const objs: PropObj[] = [];
  const cell = cellFor(items.length, inner.w, inner.h);
  const cols = Math.max(1, Math.floor(inner.w / cell)), rowH = cell * 0.92;
  const sc = cell / 700;
  items.forEach((it, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const rowsN = Math.ceil(items.length / cols);
    const cx = inner.x + (inner.w - Math.min(items.length, cols) * cell) / 2 + cell * (col + 0.5);
    const cy = inner.y + (inner.h - rowsN * rowH) / 2 + rowH * (row + 0.5);
    const node = new Container();
    const icon = partIcon(T, it.kind, it.spec);
    icon.position.set(0, -30);
    node.addChild(icon);
    node.addChild(label(shortName(it.name), 0, 250, 62, T.ink, { head: true, anchor: [0.5, 0.5] }));
    node.position.set(cx, cy);
    node.scale.set(sc);
    root.addChild(node);
    const hw = 280 * sc, hh = 310 * sc;
    objs.push({ id: 'inv:' + it.id, rect: { x: cx - hw, y: cy - hh, w: hw * 2, h: hh * 2 }, node, base: { x: cx, y: cy, s: sc } });
  });
  return { root, objs, led: new Graphics(), ledText: null };
}

/** The world rect of the crate and its interior (used for the crate hit area). */
export const CRATE_RECT = CRATE;

// ---------------------------------------------------------------- USB keys and the tray

export const KEY_LEN = 600;
export type Urgency = 'ok' | 'soon' | 'late';

export function urgencyOf(k: KeySnap): Urgency {
  if (k.late) return 'late';
  const span = Math.max(1, k.deadlineTick - k.arrivalTick);
  return k.age / span > 0.65 ? 'soon' : 'ok';
}

export const urgencyColor = (T: Theme, u: Urgency) => (u === 'late' ? T.bad : u === 'soon' ? T.ld : T.st);

/** A USB stick centred on (0,0), the connector pointing east (towards the port), about KEY_LEN long. */
export function keyStick(T: Theme, k: KeySnap): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  const u = urgencyOf(k), col = urgencyColor(T, u);
  const body = T.dark ? mix(T.sub, T.tile, 0.6) : mix('#ffffff', T.tile, 0.5);
  box(g, -296, -84, 410, 190, 34, { fill: '#000000', fa: 0.25 });
  box(g, -300, -95, 410, 190, 34, { fill: body, stroke: col, lw: 9 });
  g.rect(-300 + 30, -95, 24, 190).fill({ color: col, alpha: 0.9 }); // urgency band
  g.roundRect(110, -50, 190, 100, 8).fill({ color: '#c8d0dc' }).stroke({ width: 5, color: '#7d8798' });
  g.rect(128, -22, 28, 44).fill({ color: '#3a4254' });
  g.rect(180, -22, 28, 44).fill({ color: '#3a4254' });
  g.circle(-250 + 4, 0, 0);
  c.addChild(label(k.label, -78, k.done ? -22 : 0, 60, T.ink, { head: true, anchor: [0.5, 0.5] }));
  if (k.done) c.addChild(label('DONE', -78, 52, 38, col, { anchor: [0.5, 0.5], weight: '700' }));
  return c;
}

export const trayKeyCentre = (i: number) => {
  const pitch = (TRAY.w - 240) / TRAY_COLS;
  const col = i % TRAY_COLS, row = Math.floor(i / TRAY_COLS);
  return { x: TRAY.x + 120 + KEY_LEN / 2 + col * pitch, y: TRAY.y + 255 + row * 270 };
};

/** Where the plugged key's centre sits: the connector seated inside the USB port, the body sticking out west. */
export const pluggedKeyCentre = () => ({ x: USB_PORT.x + 190 - KEY_LEN / 2, y: USB_PORT.y + USB_PORT.h / 2 });

export function trayArt(T: Theme, keys: KeySnap[]): PropsArt {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const r = TRAY;
  const shell = T.dark ? mix(T.sub, T.tile, 0.4) : mix(T.sub, T.tile, 0.3);
  box(g, r.x + 12, r.y + 20, r.w, r.h, 36, { fill: '#000000', fa: 0.22 });
  box(g, r.x, r.y, r.w, r.h, 36, { fill: shell, stroke: T.mul, lw: 10, sa: 0.8 });
  box(g, r.x + 40, r.y + 150, r.w - 80, r.h - 190, 20, { fill: '#000000', fa: 0.28 });
  root.addChild(label('USB KEY TRAY', r.x + 90, r.y + 76, 72, T.mul, { head: true }));
  const empty = keys.length === 0;
  root.addChild(label(empty ? 'NO WORK WAITING' : `${keys.length} waiting`, r.x + r.w - 90, r.y + 76, 46, empty ? T.mute : T.ink, { anchor: [1, 0.5], a: empty ? 0.8 : 1 }));
  // empty key bays (dashed outlines) so the tray reads as a tray even when empty
  const bays = 12;
  for (let i = keys.length; i < bays; i++) {
    const p = trayKeyCentre(i);
    const pts: [number, number][] = [[p.x - 296, p.y - 95], [p.x + 110, p.y - 95], [p.x + 110, p.y + 95], [p.x - 296, p.y + 95], [p.x - 296, p.y - 95]];
    dashed(g, pts, 26, 22);
  }
  g.stroke({ width: 5, color: T.mute, alpha: 0.28 });
  const objs: PropObj[] = [];
  keys.forEach((k, i) => {
    const p = trayKeyCentre(i);
    const node = keyStick(T, k);
    node.position.set(p.x, p.y);
    root.addChild(node);
    objs.push({ id: 'key:' + k.id, rect: { x: p.x - 300, y: p.y - 100, w: 600, h: 200 }, node, base: { x: p.x, y: p.y, s: 1 } });
  });
  return { root, objs, led: new Graphics(), ledText: null };
}

/** The key sitting in the USB port (drawn above the board art). */
export function pluggedKeyArt(T: Theme, k: KeySnap): PropsArt {
  const root = new Container();
  const p = pluggedKeyCentre();
  const node = keyStick(T, k);
  node.position.set(p.x, p.y);
  root.addChild(node);
  return { root, objs: [{ id: 'key:' + k.id, rect: { x: p.x - 300, y: p.y - 100, w: 400, h: 200 }, node, base: { x: p.x, y: p.y, s: 1 } }], led: new Graphics(), ledText: null };
}

// ---------------------------------------------------------------- power button

export interface PowerState { powered: boolean; error: boolean; blocked: boolean }

export function powerArt(T: Theme, st: PowerState): PropsArt {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const p = POWER_PLATE, b = POWER_BTN;
  const shell = T.dark ? mix(T.sub, T.tile, 0.4) : mix(T.sub, T.tile, 0.3);
  box(g, p.x + 10, p.y + 18, p.w, p.h, 40, { fill: '#000000', fa: 0.22 });
  box(g, p.x, p.y, p.w, p.h, 40, { fill: shell, stroke: T.line, lw: 8 });
  root.addChild(label('POWER', p.x + p.w / 2, p.y + 80, 78, T.ink, { head: true, anchor: [0.5, 0.5], a: 0.85 }));
  // the button (lifts and scales as one object)
  const node = new Container();
  const bg = new Graphics();
  node.addChild(bg);
  const ring = st.error ? T.bad : st.powered ? T.st : T.mute;
  disc(bg, 0, 14, b.r + 18, { fill: '#000000', fa: 0.3 });
  disc(bg, 0, 0, b.r + 18, { fill: mix(shell, '#000000', 0.3), stroke: ring, lw: 12, sa: st.powered || st.error ? 1 : 0.7 });
  disc(bg, 0, 0, b.r - 10, { fill: mix(shell, '#ffffff', T.dark ? 0.1 : 0.4), stroke: T.line, lw: 6 });
  // power symbol
  bg.arc(0, 8, 78, -Math.PI * 0.32, Math.PI * 1.32 + Math.PI * 0.0, true).stroke({ width: 18, color: ring, cap: 'round' });
  bg.moveTo(0, -78).lineTo(0, -4).stroke({ width: 18, color: ring, cap: 'round' });
  node.position.set(b.x, b.y);
  root.addChild(node);
  // lights
  const led = new Graphics();
  root.addChild(led);
  const ly = p.y + p.h - 175;
  const items: [string, number][] = [['ON', -190], ['OFF', 0], ['ERR', 190]];
  for (const [t, dx] of items) root.addChild(label(t, p.x + p.w / 2 + dx, ly + 70, 40, T.mute, { anchor: [0.5, 0.5], a: 0.9 }));
  return {
    root,
    objs: [{ id: 'power', rect: { x: b.x - b.r - 24, y: b.y - b.r - 24, w: (b.r + 24) * 2, h: (b.r + 24) * 2 }, node, base: { x: b.x, y: b.y, s: 1 } }],
    led,
    ledText: null,
  };
}

/** Redraw the three status lights (call every frame; cheap). */
export function drawPowerLeds(T: Theme, led: Graphics, st: PowerState, now: number) {
  led.clear();
  const p = POWER_PLATE, ly = p.y + p.h - 175;
  const blink = 0.55 + 0.45 * Math.sin(now * 0.008);
  const on = st.powered && !st.error;
  const lights: [number, string, boolean, number][] = [
    [-190, T.st, on, 1], [0, T.ld, !st.powered && !st.error, 1], [190, T.bad, st.error, st.error ? blink : 1],
  ];
  for (const [dx, c, lit, a] of lights) {
    const x = p.x + p.w / 2 + dx;
    if (lit) led.circle(x, ly, 44).fill({ color: c, alpha: 0.25 * a });
    led.circle(x, ly, 26).fill({ color: lit ? c : mix(c, T.bg, 0.8), alpha: lit ? a : 0.55 }).stroke({ width: 5, color: T.line, alpha: 0.8 });
  }
}

export { clamp01, centre, MONO, HEAD };
