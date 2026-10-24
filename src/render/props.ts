import { Container, FillGradient, Graphics, Text } from 'pixi.js';
import type { KeySnap } from '../sim/game/game';
import { getSpec } from '../sim/board/specs';
import { box, dashed, disc, HEAD, label, mix, MONO } from './ink';
import { wallTone } from './case';
import { CASE_LEDS, HELD, POWER_BTN, TRAY, TRAY_COLS, USB_PORT, type Rect } from './layout';
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
    case 'storage': return T.mul;
    case 'os': return T.st;
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
  } else if (kind === 'storage') {
    const v = getSpec(_spec)?.visual ?? 'hdd';
    if (v === 'ssd-nvme') {
      box(g, -60, -200, 120, 400, 10, { fill: mix(body, '#10333a', 0.5), ...edge() });
      box(g, -66, -190, 132, 120, 8, { fill: mix(body, '#ffffff', 0.2), stroke: T.alu, lw: 5 });
      for (let i = 0; i < 8; i++) g.rect(-50 + i * 13, 150, 9, 40);
      g.fill({ color: T.pin });
      box(g, -42, -30, 84, 70, 6, { fill: T.die, stroke: T.line, lw: 4 });
    } else if (v === 'ssd-sata') {
      box(g, -190, -120, 380, 240, 22, { fill: mix(body, '#ffffff', 0.12), ...edge() });
      box(g, -150, -80, 200, 130, 8, { fill: T.die, stroke: T.line, lw: 4 });
      box(g, -120, -60, 60, 60, 6, { fill: T.tile, stroke: a, lw: 5 });
      disc(g, 130, 70, 12, { fill: a });
    } else {
      box(g, -200, -150, 400, 300, 22, { fill: mix(body, '#ffffff', 0.12), ...edge() });
      disc(g, -50, -10, 100, { fill: T.die, stroke: a, lw: 6 });
      disc(g, -50, -10, 22, { fill: a });
      g.moveTo(40, 100).lineTo(110, -70).stroke({ width: 14, color: a, alpha: 0.8, cap: 'round' });
      box(g, 100, -110, 70, 220, 8, { fill: T.tile, stroke: T.line, lw: 4 });
    }
  } else if (kind === 'os') {
    box(g, -190, -150, 380, 300, 22, { fill: '#050a0c', ...edge() });
    c.addChild(label('>_', -140, -20, 150, a, { head: true }));
    g.rect(-140, 70, 220, 14).fill({ color: a, alpha: 0.6 });
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

/** What an OS-ingested key is doing, as a short label and a colour (null for keys in the tray or without an OS). */
export function stageInfo(T: Theme, k: KeySnap): { text: string; color: string } | null {
  switch (k.stage) {
    case 'ingesting': return { text: 'INGESTING', color: T.mul };
    case 'queued': return { text: 'QUEUED', color: T.mute };
    case 'running': return { text: 'JOB RUNNING', color: T.alu };
    case 'result': return { text: 'DONE - PLUG AGAIN', color: T.st };
    case 'flashing': return { text: 'WRITING RESULT', color: T.ld };
    case 'done': return { text: 'RESULT SAVED', color: T.st };
    default: return null;
  }
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
export function keyStick(T: Theme, k: KeySnap, compact = false, notRead = false): Container {
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
  const stg = stageInfo(T, k);
  if (stg) g.rect(bx + 26, -h / 2, 22, h).fill({ color: stg.color, alpha: 1 });
  if (compact) {
    c.addChild(label(fit(k.label, 96, tw, 0.6), tx, k.done || stg ? -48 : -34, 96, T.ink, { head: true }));
    if (stg) c.addChild(label(fit(stg.text, 50, tw, 0.62), tx, 44, 50, stg.color, { weight: '700' }));
    else if (k.done) c.addChild(label('DONE', tx, 40, 56, col, { weight: '700' }));
    else if (notRead) c.addChild(label('NOT READ', tx, 40, 56, T.mute, { weight: '700' })); // in the port of a halted machine: never read
    else bar(34, tw);
    return c;
  }
  c.addChild(label(fit(k.label, 88, tw, 0.6), tx, -62, 88, T.ink, { head: true }));
  if (stg) {
    c.addChild(label(stg.text, tx, 20, 60, stg.color, { weight: '700' }));
    bar(66, tw);
  } else if (k.done) {
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

const vgradFill = (top: string, bot: string) => new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: top }, { offset: 1, color: bot }], textureSpace: 'local' });

/**
 * A glass-like panel (the key tray and the held rack): a shadow, a vertical gradient body with a top sheen and a coloured edge,
 * and a sunken well for its content. Dark and light share this structure; only the tones differ (a flat grey box in light was the
 * old black overlay on a light shell).
 */
function glassPanel(g: Graphics, r: Rect, T: Theme, edge: string, lw: number, sa: number, rad: number, well: Rect) {
  box(g, r.x + 12, r.y + 20, r.w, r.h, rad, { fill: '#000000', fa: T.dark ? 0.24 : 0.16 });
  const top = T.dark ? mix(T.sub, T.tile, 0.5) : '#f7f9fd', bot = T.dark ? mix(T.sub, T.bg, 0.25) : '#d2dbe9';
  g.roundRect(r.x, r.y, r.w, r.h, rad).fill(vgradFill(top, bot)).stroke({ width: lw, color: edge, alpha: sa });
  g.roundRect(r.x + 16, r.y + 10, r.w - 32, 26, 13).fill({ color: '#ffffff', alpha: T.dark ? 0.07 : 0.75 });
  // the well: its top lip is shaded (darker), its floor lighter, with a glint on the bottom lip
  const wTop = T.dark ? '#060a16' : '#a9b4c8', wBot = T.dark ? '#0e1528' : '#c8d1e1';
  g.roundRect(well.x, well.y, well.w, well.h, 20).fill(vgradFill(wTop, wBot));
  g.roundRect(well.x, well.y, well.w, well.h, 20).stroke({ width: 4, color: T.dark ? '#000000' : '#6f7d98', alpha: T.dark ? 0.5 : 0.5 });
  g.roundRect(well.x + 14, well.y + 12, well.w - 28, 18, 9).fill({ color: '#ffffff', alpha: T.dark ? 0.03 : 0.35 }); // glass sheen in the well
  g.roundRect(well.x + 12, well.y + well.h - 14, well.w - 24, 6, 3).fill({ color: '#ffffff', alpha: T.dark ? 0.05 : 0.7 });
}

export function trayArt(T: Theme, keys: KeySnap[]): PropsArt {
  const root = new Container(), chrome = new Container();
  const g = new Graphics();
  root.addChild(chrome);
  chrome.addChild(g);
  const r = TRAY;
  glassPanel(g, r, T, T.mul, 10, 0.8, 36, { x: r.x + 40, y: r.y + 150, w: r.w - 80, h: r.h - 190 });
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

/**
 * The key sitting in the USB port (drawn above the board art). `notRead`: the machine halted before this key was in the port, so it is
 * never read: the key is dimmed and says NOT READ (static, no blink).
 */
export function pluggedKeyArt(T: Theme, k: KeySnap, notRead = false): PropsArt {
  const root = new Container();
  const p = pluggedKeyCentre();
  const vec = keyStick(T, k, true, notRead), node = new Container();
  if (notRead) vec.alpha = 0.6;
  node.addChild(vec);
  node.position.set(p.x, p.y);
  root.addChild(node);
  return { root, objs: [{ id: 'key:' + k.id, rect: { x: p.x - KEY_LEN_PLUGGED / 2, y: p.y - KEY_H / 2 - 5, w: KEY_LEN_PLUGGED, h: KEY_H + 10 }, node, vec, base: { x: p.x, y: p.y, s: 1 } }], led: new Graphics(), ledText: null };
}

// ---------------------------------------------------------------- power button

/**
 * powered: the machine is switched on (any phase, including halted and error). down: the power path is gone (PSU tripped or
 * board dead): the ON light goes dark. error: the phase is `error` or the machine is down (the red ERR light blinks).
 * blocked: there is no power at all (no PSU, burnt PSU, ATX unplugged, dead board): the OFF standby light is dark.
 */
export interface PowerState { powered: boolean; down: boolean; error: boolean; blocked: boolean }

/** The power button on the case's top panel (the status lights are drawn per frame by `drawPowerLeds`). */
export function powerArt(T: Theme, st: PowerState): PropsArt {
  const root = new Container();
  const b = POWER_BTN;
  const shell = wallTone(T);
  const node = new Container(), vec = new Container();
  const bg = new Graphics();
  node.addChild(vec);
  vec.addChild(bg);
  // the button reads 'on' whenever the machine is powered (any phase); off is the muted ring
  const ring = st.powered ? T.st : T.mute;
  disc(bg, 0, 12, b.r + 14, { fill: '#000000', fa: 0.3 });
  disc(bg, 0, 0, b.r + 14, { fill: mix(shell, '#000000', 0.3), stroke: ring, lw: 10, sa: st.powered ? 1 : 0.7 });
  disc(bg, 0, 0, b.r - 12, { fill: mix(shell, '#ffffff', T.dark ? 0.1 : 0.4), stroke: T.line, lw: 5 });
  const k = b.r / 175;
  bg.arc(0, 8 * k, 78 * k, -Math.PI * 0.32, Math.PI * 1.32, true).stroke({ width: 15, color: ring, cap: 'round' });
  bg.moveTo(0, -78 * k).lineTo(0, -4 * k).stroke({ width: 15, color: ring, cap: 'round' });
  node.position.set(b.x, b.y);
  root.addChild(node);
  const led = new Graphics();
  root.addChild(led);
  return {
    root,
    objs: [{ id: 'power', rect: { x: b.x - b.r - 20, y: b.y - b.r - 20, w: (b.r + 20) * 2, h: (b.r + 20) * 2 }, node, vec, base: { x: b.x, y: b.y, s: 1 } }],
    led,
    ledText: null,
  };
}

/** Redraw the status lights on the case panel: on / off / error and the disk activity LED (every frame; cheap). `now` is game time. */
export function drawPowerLeds(T: Theme, led: Graphics, st: PowerState, now: number, disk = 0) {
  led.clear();
  const ly = CASE_LEDS.y;
  const blink = 0.55 + 0.45 * Math.sin(now * 0.008);
  // ON: powered in any phase (halted and POST error included) unless the power path is down; ERR: red, blinking
  const on = st.powered && !st.down;
  const lights: [number, string, boolean, number][] = [
    // OFF is the standby light: it needs a working PSU on the wall (blocked = no PSU / burnt PSU / ATX unplugged / dead board)
    [CASE_LEDS.on, T.st, on, 1], [CASE_LEDS.off, T.ld, !st.powered && !st.error && !st.blocked, 1], [CASE_LEDS.err, T.bad, st.error, st.error ? blink : 1],
    [CASE_LEDS.disk, T.ld, disk > 0.02, disk],
  ];
  for (const [x, c, lit, a] of lights) {
    if (lit) led.circle(x, ly, 40).fill({ color: c, alpha: 0.22 * a });
    led.circle(x, ly, 22).fill({ color: lit ? c : mix(c, T.bg, 0.8), alpha: lit ? 0.4 + 0.6 * a : 0.55 }).stroke({ width: 4, color: T.line, alpha: 0.8 });
  }
}

// ---------------------------------------------------------------- held keys (the OS ingested them; they wait for their result)

export const HELD_COLS = 2, HELD_ROWS = 3;
export const heldKeyCentre = (i: number) => {
  const col = i % HELD_COLS, row = Math.floor(i / HELD_COLS);
  return { x: HELD.x + 50 + KEY_LEN_PLUGGED / 2 + col * (KEY_LEN_PLUGGED + 50), y: HELD.y + 235 + row * 262 };
};

export function heldArt(T: Theme, keys: KeySnap[]): PropsArt {
  const root = new Container(), chrome = new Container();
  const g = new Graphics();
  root.addChild(chrome);
  chrome.addChild(g);
  const r = HELD;
  const ready = keys.filter((k) => k.stage === 'result').length;
  glassPanel(g, r, T, ready ? T.st : T.line, 8, ready ? 0.9 : 0.8, 36, { x: r.x + 30, y: r.y + 110, w: r.w - 60, h: r.h - 140 });
  chrome.addChild(label('HELD KEYS', r.x + 70, r.y + 62, 62, ready ? T.st : T.mute, { head: true }));
  const note = keys.length === 0 ? 'NONE HELD' : ready ? `${ready} READY - PLUG TO COLLECT` : `${keys.length} WAITING FOR THE OS`;
  chrome.addChild(label(note, r.x + r.w - 70, r.y + 62, 40, ready ? T.st : T.mute, { anchor: [1, 0.5], a: keys.length ? 1 : 0.8 }));
  for (let i = keys.length; i < HELD_COLS * HELD_ROWS; i++) {
    const p = heldKeyCentre(i), w = KEY_LEN_PLUGGED, h = KEY_H;
    const pts: [number, number][] = [[p.x - w / 2, p.y - h / 2], [p.x + w / 2, p.y - h / 2], [p.x + w / 2, p.y + h / 2], [p.x - w / 2, p.y + h / 2], [p.x - w / 2, p.y - h / 2]];
    dashed(g, pts, 24, 20);
  }
  g.stroke({ width: 5, color: T.mute, alpha: 0.25 });
  const objs: PropObj[] = [];
  keys.slice(0, HELD_COLS * HELD_ROWS).forEach((k, i) => {
    const p = heldKeyCentre(i);
    const vec = keyStick(T, k, true), node = new Container();
    node.addChild(vec);
    node.position.set(p.x, p.y);
    root.addChild(node);
    objs.push({ id: 'key:' + k.id, rect: { x: p.x - KEY_LEN_PLUGGED / 2, y: p.y - KEY_H / 2 - 5, w: KEY_LEN_PLUGGED, h: KEY_H + 10 }, node, vec, base: { x: p.x, y: p.y, s: 1 } });
  });
  if (keys.length > HELD_COLS * HELD_ROWS) chrome.addChild(label(`+${keys.length - HELD_COLS * HELD_ROWS} more`, r.x + r.w - 70, r.y + r.h - 24, 36, T.mute, { anchor: [1, 0.5] }));
  return { root, chrome, objs, led: new Graphics(), ledText: null };
}

export { clamp01, centre, MONO, HEAD };
