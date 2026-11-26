// Drawing a frame: when it is needed, and the first picture.
import type { Material } from 'three';
import { airflowLens, powerLens } from '@/app/hover';
import { distanceOf } from '@/core/render/three/camera';
import { STILL_PX, ViewWatch } from '@/core/render/three/ondemand';
import { rankMaterials } from '@/core/render/three/drawsort';
import { syncWorld } from '@/core/render/three/stillworld';
import { startPrograms } from '@/core/render/three/compile';
import type { LinkLevels } from '@/features/network/render/jackleds';
import { RANK_EVERY } from './tuning';
import { StageLook } from './look';

/** The id of the program three linked for a material (its renderer properties' `currentProgram`), 0 before it has one. */
function programId(props: unknown): number {
  if (typeof props !== 'object' || props === null || !('currentProgram' in props)) {
    return 0;
  }
  const p = props.currentProgram;
  return typeof p === 'object' && p !== null && 'id' in p && typeof p.id === 'number' ? p.id : 0;
}

export abstract class StagePresent extends StageLook {
  protected readonly moved = new ViewWatch();
  protected pictured = false;
  protected frames = 0;
  protected readonly programOf = (m: Material): number => programId(this.ctx.renderer.properties.get(m));

  /** Is anything moving that needs a frame: a part's motion, a fan or a panel, a lens, the snap preview's pulse, the eye on its way, or a camera move? */
  protected moving(net: LinkLevels): boolean {
    const { camera, renderer } = this.ctx,
      D = distanceOf(this.view);
    return (
      this.anim !== null ||
      this.holding ||
      this.status.peek().busy ||
      this.machine.moving ||
      powerLens.peek() ||
      airflowLens.peek() ||
      this.marker?.visible === true ||
      this._game?.powered === true ||
      net.moving ||
      this.eye.moving ||
      this.moved.shift(camera, renderer.domElement.width, renderer.domElement.height, D / 4, D * 4) >= STILL_PX
    );
  }

  /** Draw the frame when it is asked for (docs/render/load.md): the first picture waits for its programs; a still view refines its picture instead. */
  protected present(now: number, net: LinkLevels): void {
    const { scene, camera, renderer } = this.ctx;
    // drawn on demand: a part's motion, a fan or a panel, a lens, the snap preview's pulse, the eye on its way, or a camera move
    const w = renderer.domElement.width,
      h = renderer.domElement.height;
    // (tiles still in the queue: their frames come in batches, docs/render/case.md "Build my PC's frame")
    this.drew = this.demand.want(now, this.moving(net), this.bakes.size > 0);
    // (a still view adds jittered frames to its picture until its edges are smooth: `Post.refine`)
    if (!this.drew) {
      this.post.refine();
      return;
    }
    // (the first picture: its programs link first; the ticks until then draw nothing, give the tiles their time and ask again)
    if (!this.pictured && !this.programs.ready()) {
      this.drew = false;
      this.demand.ask();
      return;
    }
    syncWorld(scene);
    this.post.render();
    if (!this.pictured) {
      this.pictured = true;
      this.onPicture();
    }
    // (after the draw: the fades' see-through variants link on the driver's threads while the player looks, not at the first fade)
    if (this.warm) {
      this.warm = false;
      startPrograms(renderer, scene, camera, { fades: [this.machine.root, ...(this.monitor ? [this.monitor] : [])] });
    }
    this.moved.mark(camera, w, h);
    // (a frame with a change may have new materials or programs; the others refresh the ranks now and then)
    if (this.demand.forced || !(++this.frames % RANK_EVERY)) {
      rankMaterials(scene, this.programOf);
    }
    this.eye.read(this.post.meter());
  }
}
