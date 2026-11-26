// What holds a frame of the 3D world back (board3d.ts): the frame rate's gate, a stage that covers the room, a new picture whose programs still
// link; and the auto-adjust's watch over slow frames.
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { autoStep, graphics, nextStep, watchFps } from '@/app/graphics';
import type { Graphics } from '@/app/graphics';
import { snapshot } from '@/app/store';
import { bootStage } from '@/app/boot';
import { buildOpen, galleryOpen } from '@/core/ui/state';
import { linked, programDone, startPrograms, startShadowPrograms } from '@/core/render/three/compile';
import { install } from './build';
import { resetWatches } from './clock';
import type { World } from './world';

/** The new picture's programs have linked: it draws from this frame on. */
const drawn = (w: World, now: number): void => {
  w.held.linking = null;
  w.clock.linkedAt = now;
  resetWatches(w.clock, now);
  w.stage.demand.ask();
  if (!w.clock.revealed) {
    bootStage('Lighting the room', 0.92);
  }
};

/**
 * Gallery or Build my PC (the main menu's, `Hud.tsx`) covers the whole screen with an opaque stage that draws in its own context: the room
 * is not drawn behind it. The canvas keeps its last picture and the room's time stands still, so it is the same on return. A new picture's
 * programs still link meanwhile (`warmed`, `linking`): a graphics change made there is ready on return.
 */
const covered = ({ clock, held }: World): boolean =>
  clock.revealed && held.warmed && !held.linking && !snapshot.peek() && (galleryOpen.peek() || buildOpen.peek());

/** A stage covers the room: the frame stops here. (The frame rate the graphics settings show stays live: the page's, which the stage's draw sets.) */
const coveredTick = (w: World, now: number): boolean => {
  const { clock, stage } = w;
  if (covered(w)) {
    clock.wasCovered = true;
    clock.last = now;
    clock.meter.tick(now, stage.canvas.width, stage.canvas.height);
    return true;
  }
  if (clock.wasCovered) {
    clock.wasCovered = false;
    stage.demand.ask();
  }
  return false;
};

/** A new picture's programs still link: nothing is drawn (the canvas keeps its last picture; the boot screen covers the first). */
const linkingTick = (w: World, now: number): boolean => {
  const { linking } = w.held;
  if (!linking) {
    return false;
  }
  if (!linked(linking)) {
    if (!w.clock.revealed) {
      bootStage('Preparing the shaders', 0.38 + (0.52 * linking.filter((p) => programDone(p)).length) / linking.length);
    }
    w.clock.last = now;
    return true;
  }
  drawn(w, now);
  return false;
};

/** True: the frame stops here (the gate, a covering stage, programs still linking). */
export const heldBack = (w: World, now: number, fps: number): boolean =>
  !w.clock.gate.ready(now, fps) || coveredTick(w, now) || linkingTick(w, now);

/** A weak GPU: when the frames stay slow, auto-adjust takes the next step down and stays there (`lowered`). */
export const autoAdjust = (w: World, now: number, at: { g: Graphics; fps: number }): void => {
  const { g, fps } = at;
  if (
    graphics.peek().auto &&
    document.visibilityState === 'visible' &&
    w.clock.watch.tick((now - w.clock.last) / 1000, now, watchFps(g, fps))
  ) {
    const step = nextStep(graphics.peek(), autoStep.peek());
    if (step !== null) {
      autoStep.value = step;
    }
  }
};

/** The first frame of a new picture: its programs start to link, its lights as they stand now (`compile.ts`). True: the frame stops here. */
export const warmStep = (w: World, now: number): boolean => {
  const { held, stage } = w,
    { renderer, scene, camera } = stage;
  if (held.warmed) {
    return false;
  }
  held.warmed = true;
  const linking = [
    ...startPrograms(renderer, scene, camera, { fades: held.machine?.fades ?? [] }),
    ...startShadowPrograms(renderer, scene, camera),
    ...(held.room?.startPrograms(renderer, scene) ?? []),
    ...stage.post.startPrograms(renderer),
    ...stage.probe.startPrograms(renderer),
  ];
  held.linking = linking;
  if (!linked(linking)) {
    return true;
  }
  drawn(w, now);
  return false;
};

/** A new machine whose programs have linked takes the old one's place. */
export const swapNext = (w: World): void => {
  const { next } = w.held;
  if (next && linked(next.programs)) {
    install(w, next.m);
    w.held.next = null;
  }
};
