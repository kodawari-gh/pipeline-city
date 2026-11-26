// The network lens's flight (board3d.ts): it brings the camera in to the path from the plan's plate to the machine, and back when it ends.
import { networkLens } from '@/app/hover';
import type { Box } from '@/core/render/three/camera';
import { CASE_Z } from '@/features/room/render/three/roomplan';
import { CASE, ROUTER_SPOT, ispPlate } from '../../layout/layout';
import { ROOM_ANGLE } from './consts';
import { flyTo, flyToRoom } from './flights';
import { inFree } from './view';
import type { Scope } from './world';

/** The network lens's window: the plan's plate, the router and the machine, so that the path reads from end to end (a margin above for the words). */
const netWindow = (): Box => {
  const p = ispPlate(),
    r = ROUTER_SPOT,
    c = CASE,
    x0 = Math.min(p.x, r.x, c.x) - 600,
    x1 = Math.max(p.x + p.w, r.x + r.w, c.x + c.w) + 600;
  const y0 = Math.min(p.y, r.y, c.y) - 900,
    y1 = Math.max(p.y + p.h, r.y + r.h, c.y + c.h) + 300;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** The lens came on: fly in to its window when the view is farther out than that. */
function lensOn(s: Scope) {
  const { cam } = s,
    to = inFree(s, netWindow(), { z: CASE_Z, from: ROOM_ANGLE, margin: 0.86 });
  if (cam.goal.height > to.height * 1.1) {
    cam.netBack = { view: cam.goal, overview: cam.atOverview };
    flyTo(s, to);
    cam.netGoal = cam.goal;
  }
}

/** The lens went off: back where the camera came from, if the player has not moved the view since. */
function lensOff(s: Scope) {
  const { cam } = s,
    kept = cam.goal === cam.netGoal,
    back = cam.netBack;
  cam.netGoal = null;
  cam.netBack = null;
  if (kept && back) {
    if (back.overview) {
      flyToRoom(s);
    } else {
      flyTo(s, back.view);
    }
  }
}

/**
 * The network lens brings the camera in to its window when the view is farther out than that (a view already as close, in the case or at the board, stays as the
 * player has it); when the lens ends and the player has not moved the view since, the camera goes back (`Cam.netGoal`, `Cam.netBack`).
 */
export function watchNetLens(s: Scope): void {
  networkLens.subscribe((on) => {
    if (s.cam.menu || !s.held.machine) {
      return;
    }
    if (on) {
      lensOn(s);
    } else if (s.cam.netGoal) {
      lensOff(s);
    }
  });
}
