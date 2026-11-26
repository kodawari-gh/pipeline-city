// The eye's exposure, a step a frame.
import { effective } from '@/app/graphics';
import { TEXTURE_LEVELS } from '@/core/render/three/artlod';
import { heightAt } from '@/core/render/three/camera';
import { BASE_EXPOSURE } from '@/core/render/three/init';
import { Eye } from '@/core/render/three/eye';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import type { Snapshot } from '@/worker/protocol';
import { EYE_KEY, BAKE_MS, EYE_RANGE, BAKE_STILL_MS } from './tuning';
import { StageOutline } from './outline';

export abstract class StageLook extends StageOutline {
  protected readonly eye = new Eye(EYE_KEY / BASE_EXPOSURE, EYE_RANGE);
  /** The last tick drew a frame; the drawn frames' count (`RANK_EVERY`). */
  protected drew = true;
  /** One frame of the look: the art's density, the motion, the outline, the tiles, the snap preview's pulse, the lens and the eye. */
  protected stepLook(now: number, snap: Snapshot, dt: number): void {
    const { camera, renderer } = this.ctx;
    // (the art's density follows the `textures` setting as the board's view does: Low draws it at half what the screen needs)
    const dpr = renderer.getPixelRatio() * (TEXTURE_LEVELS[effective.peek().textures] ?? 1);
    this.machine.lod(camera, this.H, dpr);
    // (the wall's router: its shell fades for the zoom and its board shows, as the room's does)
    this.wall?.lod(camera, this.H, dpr);
    this.step(dt * this.rate());
    this.syncOutline();
    // (a tick that drew no frame has the time for more tiles: the tiles' frames come in batches, `DrawGate.want`)
    this.bakes.run(this.drew ? BAKE_MS : BAKE_STILL_MS);
    if (this.marker?.visible === true) {
      this.marker.material.opacity = 0.22 + 0.14 * Math.sin(now / 160);
    }
    this.lens.frame(camera, this.H, snap, dt, renderer.getPixelRatio(), this.machine);
    // (the power lens darkens the picture on purpose: the eye holds where it stood, and the local eye is out, or both would lift the dark back up)
    const { dark } = this.lens;
    this.post.setDark(dark);
    this.eye.hold(dark);
    this.post.setReach(heightAt(this.view, BOARD_Z));
    // the eye adapts as in the game (`board3d.ts`): a cream case and a black one both read
    // (the meter's reading comes a frame or more after its draw: a tick with no draw takes the last frame's too)
    this.eye.read(this.post.metered());
    this.post.setEye(this.eye.step(dt));
  }
}
