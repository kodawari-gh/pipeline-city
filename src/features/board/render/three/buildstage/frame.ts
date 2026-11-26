// The frame loop: the view moves to its goal, then the parts, the eye and the picture.
import { signal } from '@preact/signals';
import { effective, FrameGate } from '@/app/graphics';
import { applyView, settled, stepView } from '@/core/render/three/camera';
import { frameDt } from '@/core/render/three/ondemand';
import { StagePresent } from './present';

export abstract class StageFrame extends StagePresent {
  protected readonly gate = new FrameGate();
  /** A flight runs (`fly`: a preset, a focus, the start view): the first touch of the view catches it where it is. */
  protected flying = false;
  protected raf = 0;
  protected last = performance.now();
  /** Counts up when the camera moves or the stage resizes: what is placed by a part's screen box measures it again (`anchorOf`). */
  readonly viewRev = signal(0);
  protected viewKey = '';
  protected readonly frame = (now: number): void => {
    if (this.dead) {
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
    if (!this.gate.ready(now, effective.peek().fps)) {
      return;
    }
    const dt = frameDt(now, this.last);
    this.last = now;
    this.applyTabs();
    this.moveView(dt);
    // the machine runs while it is on (the game ticks at `simSpeed`); the snapshot below is the one after those ticks
    this.simulate(dt);
    const { snap, net } = this.stepParts(dt);
    this.stepLook(now, snap, dt);
    this.present(now, net);
  };

  /** The view eases toward its goal and the camera takes it; a moved view counts up `viewRev`. */
  protected moveView(dt: number): void {
    const arrived = settled(this.view, this.goal);
    if (arrived) {
      this.flying = false;
    }
    this.view = arrived ? this.goal : stepView(this.view, this.goal, dt);
    applyView(this.ctx.camera, this.view, this.W / this.H);
    const vk = `${this.view.x}|${this.view.y}|${this.view.z}|${this.view.yaw}|${this.view.pitch}|${this.view.height}|${this.W}|${this.H}`;
    if (vk !== this.viewKey) {
      this.viewKey = vk;
      this.viewRev.value++;
    }
  }
}
