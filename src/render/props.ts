import { Container, Graphics, Text } from 'pixi.js';
import type { KeySnap } from '../sim/game/game';
import { box, dashed, disc, HEAD, label, mix, MONO } from './ink';
import { POWER_BTN, POWER_PLATE, TRAY, TRAY_COLS, USB_PORT, type Rect } from './layout';
import type { Theme } from './theme';

// World props for the assembly game: part icons (ghost while dragging), the USB key tray, a key stick, the power button.
// Each prop that can be clicked or dragged is a Container centred on its own origin, so board.ts / interact.ts can
// lift and scale it about its middle on hover.

export interface PropObj {
  id: string;
  /** World rect of the whole object (hit test, outline, highlight ring). */
  rect: Rect;
  /** The container that animates on hover (position = its centre in world units). */
  node: Container;
  /** Everything drawn inside `node` (board.ts caches it as a texture when far out). */
  vec: Container;
  base: { x: number; y: number; s: number };
}

export interface PropsArt {
  root: Container;
  /** Static art (boxes, labels): board.ts bakes it into a texture at far zoom. Lives inside `root` until moved. */
  chrome?: Container;
  objs: PropObj[]; led: Graphics; ledText: Text | null;
}

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------- icons for parts (nominal 480 x 480, centred)

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

// ---------------------------------------------------------------- USB keys and the tray

/** Full-size key in the tray: plug end 330 + body 1140, 230 tall. */
export const KEY_LEN = 1470;
export const KEY_H = 230;
/** Compact key drawn in the USB port: 190 of plug + 560 of body. */
export const KEY_LEN_PLUGGED = 750;
export type Urgency = 'ok' | 'soon' | 'late';

export function urgencyOf(k: KeySnap): Urgency {
  if (k.late) return 'late';
  const span = Math.max(1, k.deadlineTick - k.arrivalTick);
  return k.age / span > 0.65 ? 'soon' : 'ok';
}

export const urgencyColor = (T: Theme, u: Urgency) => (u === 'late' ? T.bad : u === 'soon' ? T.ld : T.st);

/** Shorten with an ellipsis only when the text would overflow `w` world units at font size `size`. */
function fit(str: string, size: number, w: number, em = 0.62): string {
  const n = Math.max(3, Math.floor(w / (size * em)));
  return str.length <= n ? str : str.slice(0, n - 1) + '…';
}

/**
 * A USB stick centred on (0,0), the connector pointing east (towards the port). Full size (KEY_LEN x KEY_H): job id and
 * type, template, and an age bar against the deadline. Compact (KEY_LEN_PLUGGED): job id and the bar, or DONE.
 */
export function keyStick(T: Theme, k: KeySnap, compact = false): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  const u = urgencyOf(k), col = urgencyColor(T, u);
  const body = T.dark ? mix(T.sub, T.tile, 0.6) : mix('#ffffff', T.tile, 0.5);
  const half = (compact ? KEY_LEN_PLUGGED : KEY_LEN) / 2, plugL = compact ? 190 : 330, h = KEY_H;
  const bx = -half, bw = 2 * half - plugL; // body rect x..x+bw, plug beyond it
  box(g, bx + 4, -h / 2 + 12, bw, h, 34, { fill: '#000000', fa: 0.25 });
  box(g, bx, -h / 2, bw, h, 34, { fill: body, stroke: col, lw: 9 });
  g.rect(bx + 26, -h / 2, 22, h).fill({ color: col, alpha: 0.9 }); // urgency band
  const ph = 96;
  g.roundRect(bx + bw - 6, -ph / 2, plugL + 6, ph, 8).fill({ color: '#c8d0dc' }).stroke({ width: 5, color: '#7d8798' });
  g.rect(bx + bw + 40, -24, 36, 48).fill({ color: '#3a4254' });
  g.rect(bx + bw + 40 + Math.min(110, plugL - 100), -24, 36, 48).fill({ color: '#3a4254' });
  const tx = bx + 84, tw = bw - 84 - 36;
  const span = Math.max(1, k.deadlineTick - k.arrivalTick), frac = clamp01(k.age / span);
  const bar = (y: number, w: number) => {
    const b = new Graphics();
    b.roundRect(tx, y, w, 28, 14).fill({ color: '#000000', alpha: 0.3 });
    if (frac > 0) b.roundRect(tx, y, Math.max(28, w * frac), 28, 14).fill({ color: col });
    c.addChild(b);
  };
  if (compact) {
    c.addChild(label(fit(k.label, 96, tw, 0.6), tx, k.done ? -48 : -34, 96, T.ink, { head: true }));
    if (k.done) c.addChild(label('DONE', tx, 40, 56, col, { weight: '700' }));
    else bar(34, tw);
    return c;
  }
  c.addChild(label(fit(k.label, 88, tw, 0.6), tx, -62, 88, T.ink, { head: true }));
  if (k.done) {
    c.addChild(label('DONE', tx, 4, 56, col, { weight: '700' }));
    c.addChild(label(fit(k.result || k.template, 44, tw, 0.62), tx, 62, 44, T.mute));
  } else {
    c.addChild(label(fit(k.template, 56, tw), tx, 2, 56, T.mute));
    const txt = k.late ? 'LATE' : `${k.age}/${span}s`;
    const tW = txt.length * 48 * 0.62 + 24;
    bar(50, tw - tW);
    c.addChild(label(txt, tx + tw, 64, 48, col, { anchor: [1, 0.5], weight: '700' }));
  }
  return c;
}

export const trayKeyCentre = (i: number) => {
  const pitch = KEY_LEN + 60;
  const col = i % TRAY_COLS, row = Math.floor(i / TRAY_COLS);
  return { x: TRAY.x + 150 + KEY_LEN / 2 + col * pitch, y: TRAY.y + 255 + row * 290 };
};

/** Where the plugged key's centre sits: the connector seated inside the USB port, the body sticking out west. */
export const pluggedKeyCentre = () => ({ x: USB_PORT.x + 190 - KEY_LEN_PLUGGED / 2, y: USB_PORT.y + USB_PORT.h / 2 });

export function trayArt(T: Theme, keys: KeySnap[]): PropsArt {
  const root = new Container(), chrome = new Container();
  const g = new Graphics();
  root.addChild(chrome);
  chrome.addChild(g);
  const r = TRAY;
  const shell = T.dark ? mix(T.sub, T.tile, 0.4) : mix(T.sub, T.tile, 0.3);
  box(g, r.x + 12, r.y + 20, r.w, r.h, 36, { fill: '#000000', fa: 0.22 });
  box(g, r.x, r.y, r.w, r.h, 36, { fill: shell, stroke: T.mul, lw: 10, sa: 0.8 });
  box(g, r.x + 40, r.y + 150, r.w - 80, r.h - 190, 20, { fill: '#000000', fa: 0.28 });
  chrome.addChild(label('USB KEY TRAY', r.x + 90, r.y + 76, 72, T.mul, { head: true }));
  const empty = keys.length === 0;
  chrome.addChild(label(empty ? 'NO WORK WAITING' : `${keys.length} waiting`, r.x + r.w - 90, r.y + 76, 46, empty ? T.mute : T.ink, { anchor: [1, 0.5], a: empty ? 0.8 : 1 }));
  // empty key bays (dashed outlines) so the tray reads as a tray even when empty
  const bays = TRAY_COLS * 5;
  for (let i = keys.length; i < bays; i++) {
    const p = trayKeyCentre(i);
    const pts: [number, number][] = [[p.x - KEY_LEN / 2, p.y - KEY_H / 2], [p.x + KEY_LEN / 2, p.y - KEY_H / 2], [p.x + KEY_LEN / 2, p.y + KEY_H / 2], [p.x - KEY_LEN / 2, p.y + KEY_H / 2], [p.x - KEY_LEN / 2, p.y - KEY_H / 2]];
    dashed(g, pts, 26, 22);
  }
  g.stroke({ width: 5, color: T.mute, alpha: 0.28 });
  const objs: PropObj[] = [];
  keys.forEach((k, i) => {
    const p = trayKeyCentre(i);
    const vec = keyStick(T, k), node = new Container();
    node.addChild(vec);
    node.position.set(p.x, p.y);
    root.addChild(node);
    objs.push({ id: 'key:' + k.id, rect: { x: p.x - KEY_LEN / 2, y: p.y - KEY_H / 2 - 5, w: KEY_LEN, h: KEY_H + 10 }, node, vec, base: { x: p.x, y: p.y, s: 1 } });
  });
  return { root, chrome, objs, led: new Graphics(), ledText: null };
}

/** The key sitting in the USB port (drawn above the board art). */
export function pluggedKeyArt(T: Theme, k: KeySnap): PropsArt {
  const root = new Container();
  const p = pluggedKeyCentre();
  const vec = keyStick(T, k, true), node = new Container();
  node.addChild(vec);
  node.position.set(p.x, p.y);
  root.addChild(node);
  return { root, objs: [{ id: 'key:' + k.id, rect: { x: p.x - KEY_LEN_PLUGGED / 2, y: p.y - KEY_H / 2 - 5, w: KEY_LEN_PLUGGED, h: KEY_H + 10 }, node, vec, base: { x: p.x, y: p.y, s: 1 } }], led: new Graphics(), ledText: null };
}

// ---------------------------------------------------------------- power button

export interface PowerState { powered: boolean; error: boolean; blocked: boolean }

export function powerArt(T: Theme, st: PowerState): PropsArt {
  const root = new Container(), chrome = new Container();
  const g = new Graphics();
  root.addChild(chrome);
  chrome.addChild(g);
  const p = POWER_PLATE, b = POWER_BTN;
  const shell = T.dark ? mix(T.sub, T.tile, 0.4) : mix(T.sub, T.tile, 0.3);
  box(g, p.x + 10, p.y + 18, p.w, p.h, 40, { fill: '#000000', fa: 0.22 });
  box(g, p.x, p.y, p.w, p.h, 40, { fill: shell, stroke: T.line, lw: 8 });
  chrome.addChild(label('POWER', p.x + p.w / 2, p.y + 80, 78, T.ink, { head: true, anchor: [0.5, 0.5], a: 0.85 }));
  // the button (lifts and scales as one object)
  const node = new Container(), vec = new Container();
  const bg = new Graphics();
  node.addChild(vec);
  vec.addChild(bg);
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
  for (const [t, dx] of items) chrome.addChild(label(t, p.x + p.w / 2 + dx, ly + 70, 40, T.mute, { anchor: [0.5, 0.5], a: 0.9 }));
  return {
    root, chrome,
    objs: [{ id: 'power', rect: { x: b.x - b.r - 24, y: b.y - b.r - 24, w: (b.r + 24) * 2, h: (b.r + 24) * 2 }, node, vec, base: { x: b.x, y: b.y, s: 1 } }],
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
