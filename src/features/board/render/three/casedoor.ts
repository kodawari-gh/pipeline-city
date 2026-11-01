// How each case's side panel opens (case3d.ts): a pure pose of the opening's progress `t` (0 shut, 1 open), so closing is the same motion run
// back. Every panel ends swung out on a vertical axis at its front edge, standing toward the viewer east of the case, clear of the view of the
// inside. The Mini's steel panel first lets go of its two thumbscrews, slides back off its hooks and comes away; the Micro's pops out of its
// push latches; the Mid's glass door swings on its hinges and settles with a small overshoot; the Full tower's heavy glass door is damped.
import type { CaseKind } from '@/features/room/render/shell/casedecor';

/** `slide`: units the panel moves back (toward the rear wall, -x); `out`: units it comes off the body (+z); `swing`: radians about its front edge; `screws`: 0..1 how far the thumbscrews are undone. */
export interface DoorPose { slide: number; out: number; swing: number; screws: number }

/** How long a full opening takes, in seconds. */
export const DOOR_SECONDS: Record<CaseKind, number> = { oem: 1.6, matte: 1.0, gamer: 0.9, show: 1.3 };
/** How far an open panel stands out: past square, so its far end leans away from the inside. */
export const SWING = (105 * Math.PI) / 180;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
/** The part of `t` between `a` and `b`, 0 to 1. */
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const inOut = (u: number) => u * u * (3 - 2 * u);
const outCubic = (u: number) => 1 - (1 - u) ** 3;
/** Ends at 1 after a small overshoot (a door on free hinges). */
const outBack = (u: number) => { const c = 1.4; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };

export function doorPose(kind: CaseKind, t: number): DoorPose {
  const u = clamp(t);
  switch (kind) {
    case 'oem': return { screws: inOut(span(u, 0, 0.25)), slide: 240 * inOut(span(u, 0.22, 0.45)), out: 70 * inOut(span(u, 0.42, 0.52)), swing: SWING * inOut(span(u, 0.5, 1)) };
    case 'matte': return { screws: 0, slide: 0, out: 45 * outCubic(span(u, 0, 0.18)), swing: SWING * inOut(span(u, 0.12, 1)) };
    case 'gamer': return { screws: 0, slide: 0, out: 0, swing: SWING * outBack(u) };
    case 'show': return { screws: 0, slide: 0, out: 0, swing: SWING * outCubic(u) };
  }
}
