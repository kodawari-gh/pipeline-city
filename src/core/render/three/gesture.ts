// What the pointers of a stage mean, pure and the same on every stage (the game, Build my PC, the Gallery; docs/render/interact.md "Camera").
//   mouse   drag pans · right-drag or shift-drag turns · the wheel zooms at the pointer · double-click focuses
//   touch   one finger pans · two fingers: pinch zooms (and the fingers drag the view along), twist turns, swipe turns · double-tap focuses
// `pad.ts` reads the DOM events and calls these; the stages turn the answers into their own camera moves.

export interface Pt {
  x: number;
  y: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** A turn of the whole stage height, in radians: a drag across it turns the view this far, whatever the screen's size. */
export const TURN = 4;

/** Sensitivity of a wheel (per pixel of its delta, in the exponent) and of a trackpad's pinch (which the browser sends as ctrl + wheel in small steps). */
const WHEEL_K = 0.0018,
  PINCH_K = 0.006;

/** The zoom a wheel event asks for, as a factor on the height shown (under 1: closer). A line or a page of a wheel that counts them is about 40 or 800 pixels. */
export function wheelZoom(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
  return Math.exp(clamp(px, -300, 300) * (e.ctrlKey ? PINCH_K : WHEEL_K));
}

/** How far a finger must travel (CSS pixels) before two fingers mean a pinch or a swipe. */
export const LOCK_PX = 10;

/** `pinch`: the fingers spread, close or twist (zoom, with the view dragged along and turned by the twist); `swipe`: they move together (turn). */
export type TwoKind = 'pinch' | 'swipe';

/**
 * Two fingers down: where they started, what the gesture has been decided to be (null: not yet), where they stood at the last move, and how many
 * moves each has reported since. The pointer events come one finger at a time: a decision waits until both have been heard (a fast swipe would
 * otherwise read as a pinch from the first finger's event alone), or until one has moved so often that the other is plainly at rest.
 */
export interface Two {
  a0: Pt;
  b0: Pt;
  kind: TwoKind | null;
  a: Pt;
  b: Pt;
  na: number;
  nb: number;
}

export const twoStart = (a: Pt, b: Pt): Two => ({ a0: a, b0: b, kind: null, a, b, na: 0, nb: 0 });

/** One move of two fingers: `zoom` the factor on the height shown, (`dx`, `dy`) how far their middle went, `twist` (rad, clockwise on the screen positive), `at` the middle they were about. */
export interface TwoMove {
  kind: TwoKind | null;
  zoom: number;
  dx: number;
  dy: number;
  twist: number;
  at: Pt;
}

const span = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y) || 1;
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
/** The turn from angle `a` to angle `b` (rad), the short way round. */
const wrap = (a: number): number => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a);
const heading = (a: Pt, b: Pt): number => Math.atan2(b.y - a.y, b.x - a.x);

/**
 * The fingers moved to `a` and `b` (`who`: only that one finger's event, 0 or 1; none: both). Until a finger has travelled `LOCK_PX` the gesture is
 * undecided and nothing moves; then it is decided once: the fingers going the same way (the middle's travel beats half the change of what lies
 * between them) is a swipe, anything else a pinch. The first move carries all that travel, so the view does not lag behind the fingers. A swipe
 * ignores the span from then on (a hand's tremor is no zoom), a pinch carries the middle along.
 */
export function twoMove(s: Two, a: Pt, b: Pt, who?: 0 | 1): { two: Two; move: TwoMove } {
  const na = s.na + (who === 1 ? 0 : 1),
    nb = s.nb + (who === 0 ? 0 : 1);
  let kind = s.kind;
  if (!kind) {
    const d1 = { x: a.x - s.a0.x, y: a.y - s.a0.y },
      d2 = { x: b.x - s.b0.x, y: b.y - s.b0.y };
    const together = Math.hypot(d1.x + d2.x, d1.y + d2.y) / 2,
      apart = Math.hypot(d2.x - d1.x, d2.y - d1.y) / 2;
    const far = Math.max(Math.hypot(d1.x, d1.y), Math.hypot(d2.x, d2.y)),
      heard = (na > 0 && nb > 0) || Math.max(na, nb) >= 4;
    if (far < LOCK_PX || !heard)
      return { two: { ...s, na, nb }, move: { kind: null, zoom: 1, dx: 0, dy: 0, twist: 0, at: mid(a, b) } };
    kind = together > 1.25 * apart ? 'swipe' : 'pinch';
  }
  const m0 = mid(s.a, s.b),
    m1 = mid(a, b),
    pinch = kind === 'pinch';
  return {
    two: { ...s, kind, a, b, na, nb },
    move: {
      kind,
      zoom: pinch ? span(s.a, s.b) / span(a, b) : 1,
      dx: m1.x - m0.x,
      dy: m1.y - m0.y,
      twist: pinch ? wrap(heading(a, b) - heading(s.a, s.b)) : 0,
      at: m0,
    },
  };
}

/** The turn (yaw, pitch; rad) a drag of (`dx`, `dy`) pixels makes on a stage `h` pixels high: the content follows the pointer. */
export const turnOf = (dx: number, dy: number, h: number): { yaw: number; pitch: number } => ({
  yaw: (-dx / Math.max(1, h)) * TURN,
  pitch: (dy / Math.max(1, h)) * TURN,
});
