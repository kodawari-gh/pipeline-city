// How each case's side panel opens (case3d.ts): a pure pose of the opening's progress `t` (0 shut, 1 open), so closing is the same motion run
// back. Every panel ends swung out on a vertical axis at its front edge, standing toward the viewer east of the case, clear of the view of the
// inside. The Mini's steel panel first lets go of its two thumbscrews, slides back off its hooks and comes away; the Micro's pops out of its
// push latches; the Mid's glass door swings on its hinges and settles with a small overshoot; the Full tower's heavy glass door is damped.
import type { CaseKind } from '@/features/room/render/shell/casedecor';

/** `slide`: units the panel moves back (toward the rear wall, -x); `out`: units it comes off the body (+z); `swing`: radians about its front edge; `screws`: 0..1 how far the thumbscrews are undone. */
export interface DoorPose {
  slide: number;
  out: number;
  swing: number;
  screws: number;
}

/** How long a full opening takes, in seconds. */
export const DOOR_SECONDS: Record<CaseKind, number> = { oem: 1.3, matte: 1, gamer: 0.9, show: 1.3 };
/** How far an open panel stands out: past square, so its far end leans away from the inside. */
export const SWING = (105 * Math.PI) / 180;

/**
 * Does the shut panel show the inside (a window over the board)? The Mini's steel side shows nothing and the Micro's tinted window only the upper
 * part: a step that plays behind them cannot be seen, so the panel must be open for it (Build my PC keeps it open for them, `BuildStage.door`).
 */
export const DOOR_SEES: Record<CaseKind, boolean> = { oem: false, matte: false, gamer: true, show: true };

/** The panel is clear of the inside, for a part that comes in from the viewer's side, once it has swung this far (of `SWING`). */
const CLEAR = 0.75;
/** The share of a full opening that a step waits for at least: the Full tower's glass door is clear by then (0.78 of its swing at 0.4). */
const WAIT_MIN = 0.4;

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/**
 * The door's progress after `dt` seconds toward `want` (1 open, 0 shut), over `seconds` for a full opening. Always in [0, 1]: a `t` out of
 * range is clamped first, and a negative or NaN `dt` is no step.
 */
export function stepDoor(t: number, want: 0 | 1, dt: number, seconds: number): number {
  const u = Number.isNaN(t) ? 0 : clamp(t);
  const step = dt > 0 ? dt / seconds : 0;
  return want ? clamp(Math.min(1, u + step)) : clamp(Math.max(0, u - step));
}
/** The part of `t` between `a` and `b`, 0 to 1. */
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const inOut = (u: number) => u * u * (3 - 2 * u);
const outCubic = (u: number) => 1 - (1 - u) ** 3;
/** Ends at 1 after a small overshoot (a door on free hinges). */
const outBack = (u: number) => {
  const c = 1.4;
  return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
};

export function doorPose(kind: CaseKind, t: number): DoorPose {
  const u = clamp(t);
  switch (kind) {
    case 'oem':
      return {
        screws: inOut(span(u, 0, 0.16)),
        slide: 240 * inOut(span(u, 0.14, 0.34)),
        out: 70 * inOut(span(u, 0.32, 0.4)),
        swing: SWING * inOut(span(u, 0.38, 1)),
      };
    case 'matte':
      return { screws: 0, slide: 0, out: 45 * outCubic(span(u, 0, 0.18)), swing: SWING * inOut(span(u, 0.12, 1)) };
    case 'gamer':
      return { screws: 0, slide: 0, out: 0, swing: SWING * outBack(u) };
    case 'show':
      return { screws: 0, slide: 0, out: 0, swing: SWING * outCubic(u) };
  }
}

/**
 * The share of a full opening (0..1) that a step waits for before its work starts: the panel is clear by then. The Mini's panel first lets go
 * of its screws and slides off, so it takes the longest; a glass door that swings at once keeps the share it always had (`WAIT_MIN`).
 */
export function doorWait(kind: CaseKind): number {
  for (let i = 0; i <= 200; i++) if (doorPose(kind, i / 200).swing >= CLEAR * SWING) return Math.max(WAIT_MIN, i / 200);
  return 1;
}
