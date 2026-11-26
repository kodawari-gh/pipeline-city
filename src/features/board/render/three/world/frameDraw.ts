// The frame's draw (board3d.ts), on demand (docs/render/load.md "Draw on demand"), and the metered eye's reading of what it drew.
import type { Graphics } from '@/app/graphics';
import { distanceOf } from '@/core/render/three/camera';
import { EYE_SKIP } from '@/core/render/three/eye';
import { BASE_EXPOSURE } from '@/core/render/three/init';
import { STILL_PX } from '@/core/render/three/ondemand';
import { EYE_KEY, EYE_RANGE } from './consts';
import type { Eye } from './frameEye';
import type { World } from './world';

/**
 * The game draws every frame. The title's room draws when its picture changes: the sway moves it `STILL_PX` or more at the room's depths,
 * the city's beat comes (its cars, the cup's steam, the hour's light), the machine moves, the probe works, the eye is on its way, or something
 * asked (a new size, setting, theme, picture, part, tile or shadow). True: the frame drew.
 */
export const drawStep = (w: World, p: { now: number; g: Graphics; near: number }): boolean => {
  const { stage, held, cam, clock } = w,
    { camera, canvas, demand, shift } = stage;
  const D = distanceOf(cam.view);
  // the city's beat is one frame, not a motion: it asks, so it draws no trailing frame after it
  if (held.room?.ambientDue === true) {
    demand.ask();
  }
  // the title's sway never stops: a frame that moves the picture by `STILL_PX` is one frame, not a motion with an end pose to show, so it
  // asks and draws no trailing frame (the picture a tick later would be the same within the limit). Without the sway, a settling view keeps its last frame.
  const moved = cam.menu && shift.shift(camera, canvas.width, canvas.height, D / 2, D * 1.5) >= STILL_PX,
    swaying = cam.menu && cam.sway > 0;
  if (moved && swaying) {
    demand.ask();
  }
  const busy =
    !cam.menu ||
    !clock.revealed ||
    held.machine?.moving === true ||
    stage.probe.busy ||
    held.bounces > 0 ||
    (p.near > 0 && Math.abs(Math.log(held.metered / held.seen)) > 1e-3) ||
    (moved && !swaying);
  const draw = demand.want(p.now, busy);
  if (draw) {
    held.room?.drawOutside(stage.renderer, stage.scene, { camera, samples: p.g.msaa });
    stage.post.render();
    shift.mark(camera, canvas.width, canvas.height);
  }
  return draw;
};

/** The metered eye reads the frame it drew, and eases toward its reading. */
export const meterStep = (w: World, p: { draw: boolean; eye: Eye; dt: number }): void => {
  const { held } = w;
  const lum = p.draw && p.eye.near > 0 ? w.stage.post.meter() : null;
  if (lum !== null) {
    if (p.eye.dark) {
      held.heldReads = EYE_SKIP;
    } else if (held.heldReads > 0) {
      held.heldReads -= 1;
    } else {
      held.reading = lum;
      held.metered = Math.min(EYE_RANGE[1], Math.max(EYE_RANGE[0], EYE_KEY / (BASE_EXPOSURE * lum)));
    }
  }
  held.seen *= (held.metered / held.seen) ** (1 - 0.01 ** p.dt);
};
