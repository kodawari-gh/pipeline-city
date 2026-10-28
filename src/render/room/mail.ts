import { Container, Graphics } from 'pixi.js';
import { box, mix } from '../ink';
import { OUTBOX, TRAY, USB_PORT } from '../board/layout';
import { HANG_Y } from './props';
import type { Theme } from '../theme';

// A new key does not just appear on the rack: a letter drifts in beside it, opens, the key rises out of it on its lanyard, is carried to its
// hook (it hangs from the carried end, so it swings as it goes) and is hung up. Every hanging key sways: a slow breath of its own, and
// a damped pendulum that landings, neighbours leaving and the carry push on. All the maths here is pure (board.ts drives it with the game
// clock, so it freezes with the pause and speeds up with the game).

/** The whole arrival, in game seconds. */
export const MAIL_S = 3.6;
export const ENV_W = 1900, ENV_H = 1400;

// the timeline, as fractions of MAIL_S
const FLY_END = 0.24, FLAP0 = 0.34, FLAP1 = 0.46, RISE0 = 0.46, CARRY0 = 0.64, CARRY1 = 0.9, LEAVE0 = 0.6, LEAVE1 = 0.88;
/** How far the stick sits below the stage's centre while it is still in the envelope (its top just under the pocket's edge, its plug above the bottom), and how far it rises out of it. */
const RISE_FROM = 190, RISE = 700;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const sm = (a: number, b: number, u: number) => { const t = clamp01((u - a) / (b - a)); return t * t * (3 - 2 * t); };
const outCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

/** Where the letter comes to rest: on the open wall above the monitor, west of the rack. */
export const mailStage = () => ({ x: TRAY.x - 1100, y: TRAY.y + 1250 });

export interface LetterPose { x: number; y: number; rot: number; alpha: number; scale: number; /** 1 closed .. -1 open (the flap's vertical scale about the top edge). */ flap: number }

export function letterPose(u: number, stage: { x: number; y: number }): LetterPose {
  const fly = outCubic(u / FLY_END);
  let x = stage.x - 1700 * (1 - fly), y = stage.y - 1500 * (1 - fly);
  let rot = -0.5 * (1 - fly) + 0.07 * Math.sin(fly * 11) * (1 - fly);
  if (u >= FLY_END) y += 14 * Math.sin((u - FLY_END) * 40) * Math.max(0, 1 - (u - FLY_END) / 0.1); // a small bob as it settles
  const l = sm(LEAVE0, LEAVE1, u);
  x -= 300 * l; y += 800 * l * l; rot += 0.55 * l;
  return { x, y, rot, scale: 1, alpha: Math.min(1, u / 0.04) * (1 - l), flap: 1 - 2 * sm(FLAP0, FLAP1, u) };
}

export type MailPhase = 'wait' | 'rise' | 'carry' | 'settle';
export interface KeyPose { phase: MailPhase; x: number; y: number; /** How much of the lanyard is uncoiled, 0..1. */ cordK: number }

/** The key's centre: inside the envelope, rising out of it, carried by the lanyard's end to the hook, hanging there. `rest` is its resting centre. */
export function keyPose(u: number, stage: { x: number; y: number }, rest: { x: number; y: number }): KeyPose {
  if (u < RISE0) return { phase: 'wait', x: stage.x, y: stage.y + RISE_FROM, cordK: 0 };
  if (u < CARRY0) {
    const r = (u - RISE0) / (CARRY0 - RISE0);
    return { phase: 'rise', x: stage.x, y: stage.y + RISE_FROM - RISE * sm(0, 1, r), cordK: sm(0.25, 1, r) };
  }
  if (u < CARRY1) {
    const s = sm(0, 1, (u - CARRY0) / (CARRY1 - CARRY0));
    const hx = rest.x, hy = rest.y - HANG_Y, sx = stage.x, sy = stage.y + RISE_FROM - RISE - HANG_Y, dx = hx - sx;
    // the end of the lanyard, in the hand: up and over, then down onto the hook
    const p1 = { x: sx + 0.25 * dx, y: Math.min(sy, hy) - 650 }, p2 = { x: hx - 0.12 * dx, y: hy - 600 };
    const k = 1 - s, a = k * k * k, b = 3 * k * k * s, c = 3 * k * s * s, d = s * s * s;
    return { phase: 'carry', x: a * sx + b * p1.x + c * p2.x + d * hx, y: a * sy + b * p1.y + c * p2.y + d * hy + HANG_Y, cordK: 1 };
  }
  return { phase: 'settle', x: rest.x, y: rest.y, cordK: 1 };
}

/** The sideways acceleration of the carried end (world units per second squared), from the pose's second difference. */
export function carryAx(u: number, stage: { x: number; y: number }, rest: { x: number; y: number }): number {
  const d = 0.01, h = d * MAIL_S;
  return (keyPose(u + d, stage, rest).x - 2 * keyPose(u, stage, rest).x + keyPose(u - d, stage, rest).x) / (h * h);
}

// ---------------------------------------------------------------- the letter going out

/** A finished key leaves in a letter: the whole send-off, in game seconds, and the envelope's scale (a smaller one than the one that comes in), then its scale at the letterbox. */
export const MAIL_OUT_S = 3.8;
export const OUT_K = 0.75, POST_K = 0.4;
const KEY_IN_K = 0.8, OUT_FLY = 0.2, OUT_SHUT0 = 0.56, OUT_SHUT1 = 0.67, OUT_GO = 0.68, OUT_AT = 0.86;

/** Where the outgoing letter waits: the gap west of the USB port, clear of the monitor and of the cables' trunks. */
export const mailOutStage = () => ({ x: USB_PORT.x - 1500, y: USB_PORT.y + USB_PORT.h / 2 + 60 });
/** The letterbox's slot (its centre): the envelope is held over it, then slides down into it. */
export const outboxSlot = () => ({ x: OUTBOX.x + OUTBOX.w / 2, y: OUTBOX.y + 108 });
const POST_DROP = 1000, ABOVE = 520;

/**
 * The outgoing envelope: in from the lower west with its flap open, the flap shuts on the key, then it is carried up to the letterbox (turning
 * upright and getting small as it goes), held over the slot and posted: it slides down into the slot and the slot hides it (board.ts clips it there).
 */
export function outLetterPose(u: number, st: { x: number; y: number }): LetterPose {
  const fly = outCubic(u / OUT_FLY), slot = outboxSlot();
  let x = st.x - 900 * (1 - fly), y = st.y + 1300 * (1 - fly), rot = 0.35 * (1 - fly) + 0.06 * Math.sin(fly * 11) * (1 - fly), scale = OUT_K;
  if (u >= OUT_SHUT1 - 0.02 && u < OUT_GO) y += 16 * Math.sin((u - OUT_SHUT1 + 0.02) / (OUT_GO - OUT_SHUT1 + 0.02) * Math.PI); // a pat on the flap
  const s = sm(OUT_GO, OUT_AT, u), d = sm(OUT_AT, 1, u);
  x += (slot.x - st.x) * s; y += (slot.y - ABOVE - st.y) * s - 350 * Math.sin(Math.PI * s);
  rot += (Math.PI / 2 - rot) * s; scale += (POST_K - OUT_K) * s;
  y += POST_DROP * d;
  return { x, y, rot, scale, alpha: Math.min(1, u / 0.05), flap: -1 + 2 * sm(OUT_SHUT0, OUT_SHUT1, u) };
}

/** From when the envelope is going into the slot (so the slot should clip it), as a fraction of the send-off; and the instant it is in. */
export const POSTING_FROM = OUT_AT - 0.02;

export interface OutKeyPose { visible: boolean; x: number; y: number; rot: number; scale: number }

/** The finished key, from the port to the envelope: out of the port, over to the envelope turning upright, and down into the pocket (hidden once the flap is shut). */
export function outKeyPose(u: number, from: { x: number; y: number }, st: { x: number; y: number }): OutKeyPose {
  const above = { x: st.x, y: st.y - 700 * OUT_K - 340 - 80 }, inside = { x: st.x, y: st.y + 140 };
  if (u < 0.1) return { visible: true, x: from.x, y: from.y, rot: 0, scale: 1 };
  if (u < 0.42) {
    const s = sm(0.1, 0.42, u);
    return { visible: true, x: from.x + (above.x - from.x) * s, y: from.y + (above.y - from.y) * s - 300 * Math.sin(Math.PI * s), rot: Math.PI / 2 * s, scale: 1 - (1 - KEY_IN_K) * s };
  }
  const s = sm(0.42, 0.58, u);
  return { visible: u < 0.64, x: above.x, y: above.y + (inside.y - above.y) * s, rot: Math.PI / 2, scale: KEY_IN_K };
}

// ---------------------------------------------------------------- the sway

/** A hanging key's swing about its hook: the angle (rad) and its rate, and a phase of its own for the slow breath. */
export interface SwayState { a: number; w: number; ph: number }
export const SWAY = { w0: 2.1, zeta: 0.1, breath: 0.03, ax: 1 / 14000, max: 0.55 };

/** Step the pendulum: a spring back to straight, a little damping, and the push of the support's acceleration `ax`. */
export function swayStep(st: SwayState, dt: number, ax = 0) {
  const n = Math.max(1, Math.ceil(Math.min(dt, 0.1) / 0.008)), h = Math.min(dt, 0.1) / n;
  for (let i = 0; i < n; i++) {
    st.w += (-SWAY.w0 * SWAY.w0 * st.a - 2 * SWAY.zeta * SWAY.w0 * st.w - SWAY.ax * ax) * h;
    st.a += st.w * h;
    if (st.a > SWAY.max) { st.a = SWAY.max; st.w = Math.min(0, st.w); } else if (st.a < -SWAY.max) { st.a = -SWAY.max; st.w = Math.max(0, st.w); }
  }
}

/** What the stick is drawn at: the pendulum plus a slow, always-there breath (two periods, so it never looks like a metronome). */
export const swayAngle = (st: SwayState, gtMs: number) =>
  st.a + SWAY.breath * (0.7 * Math.sin(gtMs / 1000 * 1.19 + st.ph) + 0.3 * Math.sin(gtMs / 1000 * 1.9 + 2.3 * st.ph));

// ---------------------------------------------------------------- the letter's art

export interface Letter { back: Container; front: Container; flap: Container; flapTop: Graphics; flapUnder: Graphics }

/**
 * An envelope centred on (0,0), in two layers so the key can come out between them: `back` (its inside) and `front` (the pocket and
 * the flap). The flap hinges on the top edge; open, it moves to the back so the key passes in front of it.
 */
export function buildLetter(T: Theme): Letter {
  const W = ENV_W, H = ENV_H, x0 = -W / 2, y0 = -H / 2;
  const paper = T.dark ? '#e8dcc0' : '#fdf6e3', shade = T.dark ? '#cbbb96' : '#eadfc2', inner = T.dark ? '#7d6f52' : '#b8a780', edge = T.dark ? '#5f5238' : '#9c8a66';
  const back = new Container(), front = new Container(), flap = new Container();
  const gb = new Graphics();
  box(gb, x0 + 26, y0 + 36, W, H, 22, { fill: '#000000', fa: T.dark ? 0.32 : 0.18 });
  box(gb, x0, y0, W, H, 22, { fill: inner, stroke: edge, lw: 8, sa: 0.9 });
  back.addChild(gb);
  const top = y0 + H * 0.28;
  const gf = new Graphics();
  box(gf, x0, top, W, y0 + H - top, 22, { fill: paper, stroke: edge, lw: 8, sa: 0.9 });
  gf.moveTo(x0 + 14, y0 + H - 14).lineTo(0, y0 + H * 0.62).lineTo(x0 + W - 14, y0 + H - 14).stroke({ width: 6, color: edge, alpha: 0.4 });
  for (const [i, w] of [[0, 560], [1, 640], [2, 420]] as const) gf.roundRect(-440, y0 + H * 0.64 + i * 62, w, 16, 8).fill({ color: edge, alpha: 0.5 });
  gf.roundRect(x0 + W - 330, top + 40, 210, 160, 10).fill({ color: mix('#c43a3a', paper, 0.2), alpha: 0.9 }).stroke({ width: 6, color: edge, alpha: 0.7 });
  gf.circle(x0 + W - 225, top + 120, 38).stroke({ width: 8, color: paper, alpha: 0.9 });
  front.addChild(gf);
  const tip = y0 + H * 0.56;
  const flapTop = new Graphics(), flapUnder = new Graphics();
  flapTop.poly([x0 + 6, y0 + 4, x0 + W - 6, y0 + 4, 0, tip]).fill({ color: paper }).stroke({ width: 8, color: edge, alpha: 0.9, join: 'round' });
  flapTop.poly([x0 + 70, y0 + 24, x0 + W - 70, y0 + 24, 0, tip - 90]).fill({ color: shade, alpha: 0.55 });
  flapTop.circle(0, tip - 66, 62).fill({ color: '#c43a3a' }).stroke({ width: 7, color: mix('#c43a3a', '#000000', 0.35) });
  flapTop.circle(0, tip - 66, 34).stroke({ width: 5, color: mix('#c43a3a', '#ffffff', 0.3), alpha: 0.7 });
  flapUnder.poly([x0 + 6, y0 + 4, x0 + W - 6, y0 + 4, 0, tip]).fill({ color: shade }).stroke({ width: 8, color: edge, alpha: 0.9, join: 'round' });
  flap.pivot.set(0, y0); flap.position.set(0, y0);
  flap.addChild(flapUnder, flapTop);
  front.addChild(flap);
  return { back, front, flap, flapTop, flapUnder };
}

/** Put the letter at a pose: both layers move together; the flap shows its outside while closed, its inside once it has turned over, and sits behind the key then. */
export function setLetter(L: Letter, p: LetterPose) {
  for (const c of [L.back, L.front]) { c.position.set(p.x, p.y); c.rotation = p.rot; c.alpha = p.alpha; c.scale.set(p.scale); }
  L.flap.scale.y = Math.abs(p.flap) < 0.02 ? 0.02 : p.flap;
  L.flapTop.visible = p.flap > 0; L.flapUnder.visible = p.flap <= 0;
  const want = p.flap > 0 ? L.front : L.back;
  if (L.flap.parent !== want) want.addChild(L.flap);
}
