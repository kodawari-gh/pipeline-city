// The 3D world runs (board3d.ts, docs/render/load.md): the frame, the light bake's wait and the shaders; the boot screen ends once the room's
// light has settled. Then, in the dev build, the tools' hook.
import { bootDone, bootStage } from '@/app/boot';
import { modelsIn } from '@/core/render/three/gltf';
import { devHook } from './devhook';
import { frame } from './frame';
import type { World } from './world';

/** The frame on every animation frame, from the first after the light and the models are in; resolves when the boot screen has gone. */
export async function runWorld(w: World): Promise<void> {
  const tick = (now: number): void => {
    frame(w, now);
    requestAnimationFrame(tick);
  };
  // the light bake's lightmap changes the room's programs: they link after it
  bootStage('Loading the light', 0.36);
  await w.held.room?.ready;
  // the models the room asked for (the mouse, the hoodie) are in before the programs start: one that joins after them links its own at the first draw
  await modelsIn();
  bootStage('Preparing the shaders', 0.38);
  requestAnimationFrame(tick);
  await w.clock.shown;
  bootDone();
  devHook(w);
}
