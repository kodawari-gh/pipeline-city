// Freeing the stage when the player leaves.
import { disposeTree } from '@/core/render/three/geometry';
import { disposeRenderContext } from '@/core/render/three/init';
import { freeBakePools } from '../bake';
import { sweepLabels } from '@/core/render/camera';
import { setLayoutTier } from '../../layout/layout';
import { studioMachine } from '@/app/audio/studio';
import { FREE_LATER_MS } from './tuning';
import { StagePresets } from './presets';

export abstract class StageTeardown extends StagePresets {
  /**
   * Frees all that the stage owns (PERF12), once. The WebGL context, the renderer and the post chain's targets go at once. The machine with
   * its baked art, the monitor with its textures and the stage's own meshes go in a second task (`FREE_LATER_MS`): all in one task held a
   * phone's frame longer than the close did before. The room's shared caches (`roomGeo`, shared materials) stay.
   */
  dispose(): void {
    if (this.dead) {
      return;
    }
    this.dead = true;
    studioMachine.value = null;
    this.onPicture(); // (an `open` that still waits for the first picture ends)
    this.benchStop.aborted = true; // (a run holds the game: it lets go at its next tick)
    clearTimeout(this.refusalTimer);
    cancelAnimationFrame(this.raf);
    for (const f of this.cleanup) {
      f();
    }
    this.cleanup.length = 0;
    this.anim = null;
    this.cableDrop?.(true); // (a plug the player holds: the window's pointer events come off)
    this.hand.cancel();
    this.onGrab = null;
    setLayoutTier(...this.was);
    if (import.meta.env.DEV && globalThis.__build === this) {
      delete globalThis.__build;
    }
    disposeRenderContext(this.ctx);
    this.post.dispose();
    setTimeout(() => {
      this.freeScene();
    }, FREE_LATER_MS);
  }

  /** The second half of `dispose`: the meshes and materials (cheap with the context lost), and what Pixi kept for their art. */
  protected freeScene(): void {
    this.lens.dispose();
    this.live.dispose();
    const { scene } = this.ctx;
    if (this._machine) {
      scene.remove(this._machine.root);
      this._machine.dispose();
    }
    if (this.monitor) {
      scene.remove(this.monitor);
      disposeTree(this.monitor, true);
      this.monitor = null;
      this.mon = null;
    }
    if (this.wall) {
      scene.remove(this.wall.root);
      this.wall.dispose();
      this.wall = null;
    }
    // the art is gone: what Pixi pooled for it, and its labels in the size rule
    freeBakePools();
    sweepLabels();
    // (a material shared with the room keeps this renderer's listener until its dispose)
    disposeTree(scene);
    scene.clear();
    this._machine = null;
    this._game = null;
    this.snaps.drop();
    this.bakes.drop(''); // (a job's closure holds the art it bakes)
    this.floor = null;
    this.marker = null;
    void this.host;
  }
}
