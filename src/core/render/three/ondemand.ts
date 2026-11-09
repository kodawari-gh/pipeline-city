// Draw on demand (docs/render/load.md): a still view draws no frame. The loop still runs each tick, so clocks, eases and timers keep
// their rate; only the GPU draw waits. A WebGL canvas keeps its last picture until the next draw into it (a resize clears it: ask).
import { Matrix4, Vector4, type Camera } from 'three';

/** A view that moves less than this many device pixels anywhere on screen since the last draw looks the same. */
export const STILL_PX = 0.5;

let changes = 0;
/** Something changed a scene out of any frame's own work (a baked tile, a model that loaded): every gate draws its next tick. */
export function sceneChanged(): void { changes++; }

/**
 * The "needs a frame" signal: a one-shot ask (a change), a busy source (an animation that plays), a time-limited keep, or a `sceneChanged`
 * since the last tick.
 */
export class DrawGate {
  private asked = true;
  private was = false;
  private until = -Infinity;
  private seen = changes;

  /** Something changed: draw the next tick. */
  ask(): void { this.asked = true; }

  /** Keep drawing until `now + ms` (after input, or for a fade with no other source). */
  keep(now: number, ms: number): void { this.until = Math.max(this.until, now + ms); }

  /** Draw this tick? `busy` says an animation plays now. One more frame follows the last busy tick, so the end pose shows. */
  want(now: number, busy = false): boolean {
    const w = this.asked || busy || this.was || now < this.until || this.seen !== changes;
    this.seen = changes;
    this.asked = false;
    this.was = busy;
    return w;
  }
}

const GRID = [-1, 0, 1];

/** How far, in device pixels, the camera moved the picture since the last drawn frame: a 3x3 screen grid at two depths, reprojected. */
export class ViewWatch {
  private readonly vp = new Matrix4();
  private readonly inv = new Matrix4();
  private readonly m = new Matrix4();
  private readonly c = new Vector4();
  private p10 = 0;
  private p14 = 0;
  private w = 0;
  private h = 0;
  private has = false;

  /** The camera of the frame just drawn. */
  mark(camera: Camera, w: number, h: number): void {
    camera.updateMatrixWorld();
    this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.inv.copy(this.vp).invert();
    const e = camera.projectionMatrix.elements;
    this.p10 = e[10];
    this.p14 = e[14];
    this.w = w;
    this.h = h;
    this.has = true;
  }

  /** The largest screen move, in device pixels, of a point at view depth `near` or `far` (Infinity with no mark or a new size). */
  shift(camera: Camera, w: number, h: number, near: number, far: number): number {
    if (!this.has || w !== this.w || h !== this.h) return Infinity;
    camera.updateMatrixWorld();
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.inv);
    let most = 0;
    for (const d of [near, far]) {
      // the NDC depth of view depth d under the last projection
      const z = -this.p10 + this.p14 / d;
      for (const nx of GRID) for (const ny of GRID) {
        const c = this.c.set(nx, ny, z, 1).applyMatrix4(this.m);
        if (c.w <= 1e-9) return Infinity;
        most = Math.max(most, Math.abs(c.x / c.w - nx) * w / 2, Math.abs(c.y / c.w - ny) * h / 2);
      }
    }
    return most;
  }
}
