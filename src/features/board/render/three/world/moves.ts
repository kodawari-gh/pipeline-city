// The view's moves on the pad (board3d.ts): a gesture's start (a flight in the air is caught where it is; a turn goes about what the player
// looks at), the pan at the grabbed surface's depth, and the turn the room allows.
import { LIMITS, heightAt, retarget, turnReach } from '@/core/render/three/camera';
import type { PadHost } from '@/core/render/three/pad';
import { turnOf } from '@/core/render/three/gesture';
import { freeRect } from './anchors';
import { cancelFlight } from './flights';
import { anchor } from './pointer';
import { inRoom, panIn } from './view';
import type { Scope, Turning } from './world';
import type { Pt } from './types';

/** The kind of gesture the pad starts (`PadHost.begin`). */
type PadKind = Parameters<NonNullable<PadHost['begin']>>[0];

/** The turn the room allows: a wall or a piece of furniture stops it where it is (`turnReach`), the view is never shrunk into one or thrown to its far side. */
const startTurn = (s: Scope): Turning => ({
  base: s.cam.goal,
  ref: inRoom(s, s.cam.goal).height,
  yaw: s.cam.goal.yaw,
  pitch: s.cam.goal.pitch,
});
const turnStep = (s: Scope, t: Turning, d: { yaw: number; pitch: number }): void => {
  const want = {
    yaw: Math.max(-LIMITS.yaw, Math.min(LIMITS.yaw, t.yaw + d.yaw)),
    pitch: Math.max(LIMITS.pitchMin, Math.min(LIMITS.pitchMax, t.pitch + d.pitch)),
  };
  const got = turnReach(t.base, t, want, (v) => inRoom(s, v), t.ref);
  t.yaw = got.yaw;
  t.pitch = got.pitch;
  s.cam.goal = inRoom(s, { ...t.base, ...got });
};

/** A gesture starts about `at`: a flight in the air is caught where it is; a turn goes about the surface under the middle of the free window. */
export function beginMove(s: Scope, kind: PadKind, at: Pt): void {
  const { cam, grip } = s;
  cancelFlight(s);
  cam.atOverview = false;
  // (a flight in the air is caught where it is)
  if (cam.flying) {
    cam.flying = false;
    cam.goal = inRoom(s, cam.view);
  }
  if (kind === 'turn') {
    // the view turns about what the player looks at: the surface under the middle of the free window
    const f = freeRect(s),
      m = anchor(s, { clientX: f.x + f.w / 2, clientY: f.y + f.h / 2 });
    if (m) {
      cam.goal = retarget(cam.goal, m.z);
      cam.view = retarget(cam.view, m.z);
    }
    grip.turning = startTurn(s);
    return;
  }
  const p = anchor(s, { clientX: at.x, clientY: at.y });
  grip.grabZ = p?.z;
  grip.pinchAt = kind === 'pinch' ? p : undefined;
}

/** The grabbed surface follows the pointer: the pan goes at its depth. */
export function panMove(s: Scope, dx: number, dy: number): void {
  const { cam, grip } = s,
    k = (grip.grabZ === undefined ? cam.view.height : heightAt(cam.view, grip.grabZ)) / s.stage.H,
    was = cam.goal;
  cam.goal = panIn(s, cam.goal, { dx: -dx * k, dy: dy * k });
  cam.view = {
    ...cam.view,
    x: cam.view.x + cam.goal.x - was.x,
    y: cam.view.y + cam.goal.y - was.y,
    z: cam.view.z + cam.goal.z - was.z,
  };
}

/** A turn by a drag of (dx, dy) px, from the turn's start. */
export function turnMove(s: Scope, dx: number, dy: number): void {
  const t = turnOf(dx, dy, s.stage.H);
  s.grip.turning ??= startTurn(s);
  turnStep(s, s.grip.turning, t);
}

/** Two fingers turning: the pinch moves the goal meanwhile, so each twist is a turn of its own from where the goal is now. */
export function twistMove(s: Scope, rad: number): void {
  turnStep(s, startTurn(s), { yaw: rad, pitch: 0 });
}
