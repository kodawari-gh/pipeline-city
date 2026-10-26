import { Container, FillGradient, Graphics, Text } from 'pixi.js';
import type { KeySnap } from '../sim/game/game';
import { getSpec } from '../sim/board/specs';
import { box, dashed, disc, HEAD, label, mix, MONO } from './ink';
import { wallTone } from './case';
import { usbPlug } from './ports';
import { CASE_LEDS, HOOK_PITCH, HOOK_Y, LANYARD, POWER_BTN, ROW_DROP, TRAY, TRAY_COLS, TRAY_ROWS, USB_PORT, type Rect } from './layout';
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
  /** A key's timer: redraws its dial for the key as it is now (the sim's age moves every tick; the stick itself is only rebuilt when something else changes). */
  retime?: (k: KeySnap) => void;
  /** A key hanging on its lanyard: the container that swings about the hook (its origin is the stick's centre; the hook is `HANG_Y` above it), and the lanyard inside it (scaled to uncoil it). */
  swing?: Container;
  lan?: Container;
}

export interface PropsArt {
  root: Container;
  /** Static art (boxes, labels): board.ts bakes it into a texture at far zoom. Lives inside `root` until moved. */
  chrome?: Container;
  objs: PropObj[]; led: Graphics; ledText: Text | null;
  /** The remove cue on a finished key (plugged, `stage` done): animated per frame by `drawKeyCue`. */
  cue?: KeyCue;
}

/** The remove cue: a glow around the stick and a `TAKE ME` / `REMOVE` tag under it. Lives in the key's node, outside its baked `vec`. */
export interface KeyCue { glow: Graphics; tag: Container; pill: Graphics }

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
    case 'nic': case 'router': return T.alu;
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
  } else if (kind === 'nic') {
    box(g, -190, -110, 380, 220, 14, { fill: mix(body, '#0e6a7a', 0.25), ...edge() });
    box(g, -120, -56, 110, 90, 8, { fill: T.die, stroke: T.line, lw: 4 });
    box(g, -20, -60, 130, 100, 6, { fill: mix(body, '#ffffff', 0.3), stroke: T.line, lw: 4 });
    for (let x = 0; x < 120; x += 22) g.moveTo(-10 + x, -50).lineTo(-10 + x, 30);
    g.stroke({ width: 5, color: T.line, alpha: 0.8 });
    box(g, -230, -90, 70, 150, 8, { fill: mix(body, '#ffffff', 0.4), stroke: a, lw: 5 });
    for (let i = 0; i < 12; i++) g.rect(-120 + i * 24, 96, 12, 24);
    g.fill({ color: T.pin });
  } else if (kind === 'router') {
    box(g, -220, -90, 440, 190, 24, { fill: mix(body, '#ffffff', 0.15), ...edge() });
    for (let i = 0; i < 4; i++) disc(g, -170 + i * 38, -50, 9, { fill: i === 0 ? T.st : a, fa: 0.9 });
    for (let i = 0; i < 4; i++) box(g, -170 + i * 90, 36, 64, 60, 6, { fill: '#05070c', stroke: a, lw: 3 });
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

/** Full-size key in the tray: plug end 220 + body 740, 230 tall (a stubby stick, about 3:1 like a real one). */
export const KEY_LEN = 960;
export const KEY_H = 230;
/** Compact key drawn in the USB port: 190 of plug + 560 of body. */
export const KEY_LEN_PLUGGED = 750;
/** The metal plug's height: it must slip into the USB port (108 tall, see `USB_PORT`). */
export const KEY_PLUG_H = 88;
/** How far a seated key's plug is inside the port (the rest of the plug shows between the stick and the port's mouth). */
export const KEY_INSERT = 100;
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

/** The colour of a workload kind: the lanyard of its keys (the sticks themselves stay plain). The kinds are the sim's key types: the cli jobs and the job classes. */
export const WORKLOAD_COLOURS: Record<string, string> = {
  log: '#4fa3e0', calc: '#e0a82e', checksum: '#3f9a6a', scan: '#a068d8',
  db: '#d9783a', web: '#2fc4c4', secure: '#d03a4a', gpu: '#e05ab0', npu: '#8bd13f', hpc: '#b9bccd',
};
export const lanyardColour = (k: Pick<KeySnap, 'type'>) => WORKLOAD_COLOURS[k.type] ?? '#8d9bc4';

/** Where a stick's timer dial sits (in the stick's own space, centred on it) and how big it is: by the collar, at the plug end of the body. */
export function keyTimerSpot(compact: boolean) {
  const half = (compact ? KEY_LEN_PLUGGED : KEY_LEN) / 2, plugL = compact ? 200 : 220, bw = 2 * half - plugL, r = compact ? 54 : 62;
  return { x: -half + bw - 78 - r, y: 0, r };
}

/**
 * The timer dial of a key that has no result yet: a disc that a hand sweeping round clockwise from the top eats up, the part still to go left
 * filled (green, amber once it is more than two thirds gone, red past the deadline: then the disc is empty and the hand stands at the top).
 * Redrawn as the sim ticks (`PropObj.retime`); a key with its result has none.
 */
export function drawKeyTimer(g: Graphics, T: Theme, k: KeySnap, compact: boolean) {
  g.clear();
  if (k.done) return;
  const { x, y, r } = keyTimerSpot(compact);
  const span = Math.max(1, k.deadlineTick - k.arrivalTick), frac = clamp01(k.age / span), col = urgencyColor(T, urgencyOf(k));
  const hand = T.dark ? '#e8eeff' : '#1c2540', a0 = -Math.PI / 2, a = a0 + frac * 2 * Math.PI;
  g.circle(x, y, r).fill({ color: '#000000', alpha: T.dark ? 0.45 : 0.16 });
  if (!k.late && frac < 1) {
    g.moveTo(x, y).arc(x, y, r - 8, a, a0 + 2 * Math.PI).closePath().fill({ color: col, alpha: 0.9 });
    g.moveTo(x, y).lineTo(x + Math.cos(a) * (r - 6), y + Math.sin(a) * (r - 6)).stroke({ width: 7, color: hand, cap: 'round' });
  } else g.moveTo(x, y).lineTo(x, y - (r - 6)).stroke({ width: 7, color: col, cap: 'round' });
  g.circle(x, y, r).stroke({ width: 6, color: col, alpha: 0.9 });
  g.circle(x, y, 8).fill({ color: hand });
}

/**
 * A USB stick centred on (0,0), the connector pointing east (towards the port): a plain dark body (the workload is its lanyard's colour, the
 * timer a dial on `retime`). Full size (KEY_LEN x KEY_H): job id and type, template. Compact (KEY_LEN_PLUGGED): job id and what it is doing, or DONE.
 */
export function keyStick(T: Theme, k: KeySnap, compact = false, notRead = false): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  const half = (compact ? KEY_LEN_PLUGGED : KEY_LEN) / 2, plugL = compact ? 200 : 220, h = KEY_H;
  const bx = -half, bw = 2 * half - plugL; // body rect x..x+bw, plug beyond it
  const px = bx + bw - 6; // the plug starts a little inside the body
  // ---- the plug: a metal sleeve in side profile, the size of the port's opening ----
  const ph = KEY_PLUG_H;
  usbPlug(g, T, px, 0, plugL + 6, ph);
  // ---- the body: a soft shadow, a gradient shell with a gloss, a keyring cap at the back and a collar by the plug ----
  box(g, bx + 5, -h / 2 + 14, bw, h, 46, { fill: '#000000', fa: T.dark ? 0.35 : 0.22 });
  g.roundRect(bx, -h / 2, bw, h, 46).fill(vgradFill(T.dark ? mix(T.sub, T.tile, 0.75) : '#ffffff', T.dark ? mix(T.sub, T.bg, 0.2) : mix('#c9d2e2', T.tile, 0.4))).stroke({ width: 6, color: T.line, alpha: 0.95 });
  g.roundRect(bx + 8, -h / 2 + 8, bw - 16, 34, 17).fill({ color: '#ffffff', alpha: T.dark ? 0.1 : 0.7 }); // gloss
  g.roundRect(bx + 4, -h / 2 + 4, 74, h - 8, 42).fill({ color: mix(T.line, T.bg, 0.3), alpha: 0.5 }); // rubber cap
  g.circle(bx + 40, 0, 17).fill({ color: T.dark ? '#05080f' : '#8a95aa' }).stroke({ width: 5, color: T.line, alpha: 0.9 }); // keyring hole
  g.rect(bx + bw - 54, -h / 2 + 4, 22, h - 8).fill({ color: mix(T.line, T.bg, 0.2), alpha: 0.9 }); // the collar band (the stage colour overrides it below)
  const tx = bx + 102, spot = keyTimerSpot(compact), tw = (k.done ? bw - 66 : spot.x - spot.r - 20) - tx;
  if (!k.done) g.circle(spot.x, spot.y, spot.r).fill({ color: '#000000', alpha: T.dark ? 0.45 : 0.16 }); // the dial's face (its hand and the rest are `drawKeyTimer`)
  const stg = stageInfo(T, k);
  if (stg) g.rect(bx + bw - 54, -h / 2 + 4, 22, h - 8).fill({ color: stg.color, alpha: 1 });
  if (compact) {
    const fs = Math.max(40, Math.min(96, tw / (k.label.length * 0.6))); // the job label is as big as the room by the dial allows
    c.addChild(label(fit(k.label, fs, tw, 0.6), tx, -48 + (96 - fs) * 0.2, fs, T.ink, { head: true }));
    if (stg) c.addChild(label(fit(stg.text, 50, tw, 0.62), tx, 44, 50, stg.color, { weight: '700' }));
    else if (k.done) c.addChild(label('DONE', tx, 40, 56, T.st, { weight: '700' }));
    else if (notRead) c.addChild(label('NOT READ', tx, 40, 56, T.mute, { weight: '700' })); // in the port of a halted machine: never read
    else c.addChild(label(fit(k.template, 46, tw), tx, 42, 46, T.mute));
    return c;
  }
  const fs = Math.max(54, Math.min(88, tw / (k.label.length * 0.6)));
  c.addChild(label(fit(k.label, fs, tw, 0.6), tx, -62 + (88 - fs) * 0.3, fs, T.ink, { head: true }));
  if (stg) {
    c.addChild(label(fit(stg.text, 60, tw, 0.62), tx, 30, 60, stg.color, { weight: '700' }));
  } else if (k.done) {
    c.addChild(label('DONE', tx, 4, 56, T.st, { weight: '700' }));
    c.addChild(label(fit(k.result || k.template, 44, tw, 0.62), tx, 62, 44, T.mute));
  } else {
    c.addChild(label(fit(k.template, 56, tw), tx, 30, 56, T.mute));
  }
  return c;
}

/** Where the rack's hook for stick `i` is (rows of `TRAY_COLS`: the first row on the upper rail, the next on the lower one, staggered half a pitch). */
export const trayHook = (i: number) => {
  const col = i % TRAY_COLS, row = Math.floor(i / TRAY_COLS);
  return { x: TRAY.x + 300 + col * HOOK_PITCH + row * (HOOK_PITCH / 2), y: TRAY.y + HOOK_Y + row * ROW_DROP };
};
/** The centre of the stick hanging from hook `i`: straight under it, a lanyard's length down, upright (the plug at the bottom). */
export const trayKeyCentre = (i: number) => { const h = trayHook(i); return { x: h.x, y: h.y + LANYARD + KEY_LEN / 2 }; };

/** Where the plugged key's centre sits: the connector seated inside the USB port, the body sticking out west. */
export const pluggedKeyCentre = () => ({ x: USB_PORT.x + KEY_INSERT - KEY_LEN_PLUGGED / 2, y: USB_PORT.y + USB_PORT.h / 2 });

function vgradFill(top: string, bot: string) { return new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: top }, { offset: 1, color: bot }], textureSpace: 'local' }); }

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

export type TrayMode = 'off' | 'retired' | 'waiting' | 'fallback';

/** How far the hook is above a hanging stick's centre: the lanyard's length and half the stick. */
export const HANG_Y = LANYARD + KEY_LEN / 2;

/**
 * A key on its lanyard, centred on the stick: upright (the plug at the bottom, the lettering reading down it) with a flat two-strand cord
 * going up to the hook, which is `HANG_Y` above the centre. Everything but the node's position lives in `swing`, which pivots at the hook
 * (`swing.rotation` is the sway); `lan.scale.y` uncoils the cord (0 = no cord, 1 = hanging), about the stick's end.
 */
export function hangingKey(T: Theme, k: KeySnap) {
  const vec = keyStick(T, k), node = new Container(), swing = new Container(), lan = new Graphics();
  vec.rotation = Math.PI / 2; // hanging: the plug (the stick's east end) points at the ground and the lettering reads down the stick
  // the lanyard goes with the stick: a flat cord from the hook, two strands through a small ring on the stick's end
  const top = -HANG_Y, end = -KEY_LEN / 2;
  for (const dx of [-14, 14]) lan.moveTo(dx * 0.4, top + 20).quadraticCurveTo(dx * 1.6, (top + end) / 2, dx * 0.5, end + 6);
  lan.stroke({ width: 16, color: lanyardColour(k), cap: 'round' });
  lan.circle(0, end + 4, 30).stroke({ width: 9, color: T.dark ? '#aab6dc' : '#6b7794' });
  lan.pivot.set(0, end); lan.position.set(0, end);
  swing.pivot.set(0, top); swing.position.set(0, top);
  const timer = new Graphics();
  timer.rotation = Math.PI / 2; // the dial turns with the stick
  const retime = (q: KeySnap) => drawKeyTimer(timer, T, q, false);
  retime(k);
  swing.addChild(lan, vec, timer);
  node.addChild(swing);
  return { node, swing, lan, vec, retime };
}

export function trayArt(T: Theme, keys: KeySnap[], mode: TrayMode = 'off'): PropsArt {
  const root = new Container(), chrome = new Container();
  const g = new Graphics();
  root.addChild(chrome);
  chrome.addChild(g);
  const r = TRAY;
  // the rack's own look is the two rails on the wall (room.ts draws them, with a hook each): here the lettering on the upper rail, and the sticks on their lanyards
  const ink = T.dark ? '#e6d5c4' : '#4a3426';
  chrome.addChild(label('KEYS', r.x + 70, r.y + 100, 70, ink, { head: true, a: 0.85 }));
  const empty = keys.length === 0;
  // the network owns the work now: with the link up the tray is a calm leftover shelf; when the link drops the sticks come back
  if (mode === 'retired') g.alpha = 0.55;
  const note = mode === 'retired' ? (empty ? 'LINK UP: KEYS RETIRED' : `LINK UP: ${keys.length} LEFTOVER`) : mode === 'waiting' ? 'NET DOWN' : mode === 'fallback' ? 'NET DOWN: STICKS BACK AT 1/3 RATE' : empty ? 'NO WORK WAITING' : `${keys.length} waiting`;
  const noteCol = mode === 'retired' ? T.st : mode === 'waiting' || mode === 'fallback' ? T.ld : ink;
  chrome.addChild(label(note, r.x + 470, r.y + 104, mode === 'fallback' ? 34 : 40, noteCol, { a: mode === 'off' && empty ? 0.8 : 1 }));
  const objs: PropObj[] = [];
  keys.forEach((k, i) => {
    const p = trayKeyCentre(i);
    const { node, swing, lan, vec, retime } = hangingKey(T, k);
    node.position.set(p.x, p.y);
    root.addChild(node);
    objs.push({ id: 'key:' + k.id, rect: { x: p.x - KEY_H / 2 - 5, y: p.y - KEY_LEN / 2, w: KEY_H + 10, h: KEY_LEN }, node, vec, swing, lan, retime, base: { x: p.x, y: p.y, s: 1 } });
  });
  return { root, chrome, objs, led: new Graphics(), ledText: null };
}

/** The compact stick's outline (centred on the key) and the tag under its body (the body spans x -375..185). */
const CUE_STICK = { x: -KEY_LEN_PLUGGED / 2, y: -KEY_H / 2, w: KEY_LEN_PLUGGED, h: KEY_H };
const CUE_TAG = { x: -95, y: 265, w: 800, h: 230 };

/**
 * The key sitting in the USB port (drawn above the board art). `notRead`: the machine halted before this key was in the port, so it is
 * never read: the key is dimmed and says NOT READ (static, no blink). `cueLabel` (e.g. `TAKE ME`) adds the remove cue to a finished key.
 */
export function pluggedKeyArt(T: Theme, k: KeySnap, notRead = false, cueLabel: string | null = null): PropsArt {
  const root = new Container();
  const p = pluggedKeyCentre();
  const vec = keyStick(T, k, true, notRead), node = new Container();
  if (notRead) vec.alpha = 0.6;
  let cue: KeyCue | undefined;
  if (cueLabel && k.stage === 'done' && !notRead) {
    // a finished key waits for its removal: a glow on the stick and a tag, on the game clock (drawKeyCue); none of it is baked
    const glow = new Graphics(), pill = new Graphics(), tag = new Container();
    const text = new Text({ text: cueLabel, style: { fontFamily: HEAD, fontSize: 160, fontWeight: '700', fill: T.st }, resolution: 2 });
    text.anchor.set(0.5, 0.5);
    tag.addChild(pill, text);
    tag.position.set(CUE_TAG.x, CUE_TAG.y);
    node.addChild(glow);
    cue = { glow, tag, pill };
  }
  const clip = new Container(); // the mask goes on a wrapper: on `vec` itself it blanked the stick once board.ts baked it to a texture far out (the mask is in the root's space, the bake is not)
  clip.addChild(vec);
  node.addChild(clip);
  const timer = new Graphics(), retime = (q: KeySnap) => drawKeyTimer(timer, T, q, true);
  retime(k);
  node.addChild(timer);
  if (cue) node.addChild(cue.tag);
  node.position.set(p.x, p.y);
  root.addChild(node);
  // the part of the plug inside the port is hidden by the port's shell: the stick is cut at the port's mouth
  const cut = new Graphics().rect(USB_PORT.x - 6000, p.y - 600, 6000 + 6, 1200).fill({ color: '#ffffff' });
  root.addChild(cut);
  clip.mask = cut; // the stick only: the remove cue's glow and tag stay whole
  return { root, objs: [{ id: 'key:' + k.id, rect: { x: p.x - KEY_LEN_PLUGGED / 2, y: p.y - KEY_H / 2 - 5, w: KEY_LEN_PLUGGED, h: KEY_H + 10 }, node, vec, retime, base: { x: p.x, y: p.y, s: 1 } }], led: new Graphics(), ledText: null, cue };
}

/**
 * Per-frame remove cue. `now` is game time (a pause freezes the breath). `k` scales the tag and the glow width so both stay readable
 * at the exterior (far) view: 1 at the overview, up to 2.6 further out. Calm: one slow sine, no flashing.
 */
export function drawKeyCue(c: KeyCue, T: Theme, now: number, k: number) {
  const beat = 0.5 + 0.5 * Math.sin(now * 0.0035); // about a 1.8 s breath
  const s = CUE_STICK, e = (12 + 10 * beat) * k;
  c.glow.clear();
  box(c.glow, s.x - e, s.y - e, s.w + 2 * e, s.h + 2 * e, 50 * k, { fill: T.st, fa: 0.05 + 0.08 * beat });
  box(c.glow, s.x - e, s.y - e, s.w + 2 * e, s.h + 2 * e, 50 * k, { stroke: T.st, lw: 12 * k, sa: 0.35 + 0.45 * beat });
  c.tag.scale.set(k);
  const t = CUE_TAG;
  c.pill.clear();
  box(c.pill, -t.w / 2, -t.h / 2, t.w, t.h, t.h / 2, { fill: T.dark ? '#0b1226' : '#ffffff', fa: 0.94, stroke: T.st, lw: 9, sa: 0.85 + 0.15 * beat });
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
  // the power symbol: a ring open at the top (clockwise from just right of the top, the long way round), the bar in the gap
  // The arc gets its own moveTo so no stray segment joins it to the previous shape, and the gap is wide enough for the
  // bar plus both round caps (stroke widths scale with the button).
  const gap = Math.PI * 0.2, R = 78 * k, w = 15 * k;
  bg.moveTo(R * Math.cos(-Math.PI / 2 + gap), 8 * k + R * Math.sin(-Math.PI / 2 + gap));
  bg.arc(0, 8 * k, R, -Math.PI / 2 + gap, Math.PI * 1.5 - gap, false).stroke({ width: w, color: ring, cap: 'round' });
  bg.moveTo(0, -62 * k).lineTo(0, -4 * k).stroke({ width: w, color: ring, cap: 'round' });
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

export { clamp01, centre, MONO, HEAD };
