// The pad's host for the game's view (board3d.ts; `core/render/three/pad.ts` gives the same pointers on every stage): this says what they do
// to the game's view. A drag pans, a right drag (or shift) turns, the wheel zooms at the pointer, a click picks.
import type { PadHost } from '@/core/render/three/pad';
import type { Drag3D } from '../drag3d';
import { clickAt } from './click';
import { focusAt } from './focus';
import { beginMove, panMove, turnMove, twistMove } from './moves';
import { pressAt } from './press';
import { settle } from './view';
import { zoomToward } from './zoom';
import type { Scope } from './world';

/** What the pointers do to the game's view; `lift` carries what a press lifts. */
export const gestures = (s: Scope, lift: Drag3D): PadHost => ({
  press: (at, e) => pressAt(s, lift, { at, e }),
  begin: (kind, at) => {
    beginMove(s, kind, at);
  },
  pan: (dx, dy) => {
    panMove(s, dx, dy);
  },
  turn: (dx, dy) => {
    turnMove(s, dx, dy);
  },
  zoom: (k, at) => {
    zoomToward(s, { clientX: at.x, clientY: at.y }, { k, at: s.grip.pinchAt });
  },
  twist: (rad) => {
    twistMove(s, rad);
  },
  end: () => {
    s.grip.grabZ = undefined;
    s.grip.pinchAt = undefined;
    s.grip.turning = null;
    settle(s);
  },
  tap: (_at, e) => {
    clickAt(s, e);
  },
  focus: (_at, e) => {
    focusAt(s, e);
  },
});
