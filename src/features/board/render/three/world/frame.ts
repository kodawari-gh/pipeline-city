// The 3D world's frame (board3d.ts), step by step: what holds it back, the view, the live layers and the room, the machine and the outline,
// the eye, the draw and the light. `requestAnimationFrame` calls it again after every step (`runWorld`).
import { effective, loopLimit } from '@/app/graphics';
import { snapshot, speed } from '@/app/store';
import { drawStep, meterStep } from './frameDraw';
import { eyeStep, stillStep } from './frameEye';
import { autoAdjust, heldBack, swapNext, warmStep } from './frameGate';
import { caseStep, outlineStep } from './frameCase';
import { liveStep } from './frameLive';
import { probeStep, revealStep, tierStep } from './frameProbe';
import { viewStep } from './frameView';
import type { World } from './world';

/** One frame of the world at `now` (the rAF's time). */
export function frame(w: World, now: number): void {
  const t0 = performance.now(); // the frame work time (CPU in this callback) for `TierWatch`
  const g = effective.peek(),
    fps = loopLimit(g.fps, document.hasFocus());
  if (heldBack(w, now, fps)) {
    return;
  }
  autoAdjust(w, now, { g, fps });
  const { clock, stage } = w;
  const rawDt = Math.max(0, (now - clock.last) / 1000),
    dt = Math.min(0.1, rawDt),
    ratio = stage.renderer.getPixelRatio();
  clock.last = now;
  clock.gt += dt * 1000 * speed.value;
  swapNext(w);
  const s = snapshot.peek();
  viewStep(w, s, { now, dt });
  const { hour, net } = liveStep(w, { s, dt, ratio, g });
  caseStep(w, s, { dt, net });
  outlineStep(w);
  const eye = eyeStep(w, hour);
  if (warmStep(w, now)) {
    return;
  }
  stillStep(w, { now, on: s !== null, g, eye });
  const draw = drawStep(w, { now, g, near: eye.near });
  meterStep(w, { draw, eye, dt });
  probeStep(w, { now, draw, s, g });
  tierStep(w, { now, draw, g, fps, rawDt, t0 });
  revealStep(w, now);
}
