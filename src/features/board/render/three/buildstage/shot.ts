// A still of the stage (`capture`), for the shelf and the job sheets.
import { Vector3 } from 'three';
import { effective } from '@/app/graphics';
import { TEXTURE_LEVELS } from '@/core/render/three/artlod';
import { applyView, heightAt } from '@/core/render/three/camera';
import { syncWorld } from '@/core/render/three/stillworld';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { centred, fitFactor, pictureWindow } from '../buildshot';
import { sleep, sure } from './tuning';
import type { OrbitView, Pt, Win } from './types';
import { StageFrame } from './frame';

export abstract class StageShot extends StageFrame {
  /**
   * A picture of the machine as it stands: the whole case seen from the start view with its side panel off, `w` x `h` pixels, as a data URL (null while a
   * step plays), encoded as `as.type` at `as.quality` (WebP at 0.85 by default). The baked pictures of the Start list (`tools/buildstills.mjs`) and the
   * thumbnails of the saved builds are these. The view comes back as it was.
   */
  async capture(w: number, h: number, as: { type?: string; quality?: number } = {}): Promise<string | null> {
    const { type = 'image/webp', quality = 0.85 } = as;
    if (this.dead || this.status.peek().busy || this.shown.peek() === 'nothing') {
      return null;
    } // (an empty stage has no machine to frame)
    // (the first picture links the programs, and the parts' art comes in over a few frames)
    await this.waitPictured(160);
    if (this.dead || this.status.peek().busy) {
      return null;
    }
    const { view, crop } = this.shotView(w / h);
    return this.shoot(view, crop, { w, h, type, quality });
  }

  /** Waits for the first picture and the parts' art, 50 ms at a time, at most `left` times. */
  protected async waitPictured(left: number): Promise<void> {
    const waiting = !this.pictured || this.bakes.size > 0;
    if (left <= 0 || !waiting) {
      return;
    }
    await sleep(50);
    await this.waitPictured(left - 1);
  }

  /** The view of a picture of `aspect` (the start view on the middle of the machine, framed to fill its share of the window), and the canvas's crop for it. */
  protected shotView(aspect: number): { view: OrbitView; crop: Win } {
    const { camera, renderer } = this.ctx,
      canvas = renderer.domElement,
      cw = canvas.width,
      ch = canvas.height;
    const win = pictureWindow(cw, ch, aspect),
      body = this.machine.bodyBox(),
      size = body.getSize(new Vector3()),
      mid = body.getCenter(new Vector3());
    const v = new Vector3(),
      project = (): Pt[] => {
        camera.updateMatrixWorld(true);
        const out: Pt[] = [];
        for (const x of [body.min.x, body.max.x]) {
          for (const y of [body.min.y, body.max.y]) {
            for (const z of [body.min.z, body.max.z]) {
              v.set(x, y, z).project(camera);
              out.push({ x: ((v.x + 1) / 2) * cw, y: ((1 - v.y) / 2) * ch });
            }
          }
        }
        return out;
      };
    // the start view on the middle of the machine, drawn in or out until the machine fills its share of the window (its box moves as the height changes: a few passes)
    const start: OrbitView = {
      ...this.frameView(),
      x: mid.x,
      y: mid.y,
      z: mid.z,
      height: Math.max(size.x, size.y) * 1.5,
    };
    let { height } = start;
    for (let i = 0; i < 4; i++) {
      applyView(camera, { ...start, height }, cw / ch);
      height *= fitFactor(project(), win);
    }
    const view: OrbitView = { ...start, height };
    applyView(camera, view, cw / ch);
    return { view, crop: centred(project(), win, cw, ch) };
  }

  /** Draw the machine alone (no monitor, no wall, its side panel off) from `view`, and read the crop as a data URL of `out`'s size and type. The view comes back as it was. */
  protected shoot(view: OrbitView, crop: Win, out: { w: number; h: number; type: string; quality: number }): string {
    const { scene, camera, renderer } = this.ctx,
      canvas = renderer.domElement,
      m = this.machine,
      density = renderer.getPixelRatio() * (TEXTURE_LEVELS[effective.peek().textures] ?? 1);
    const { monitor, wall } = this;
    const monitorWas = monitor?.visible ?? false,
      wallWas = wall?.root.visible ?? false;
    if (monitor) {
      monitor.visible = false;
    }
    if (wall) {
      wall.root.visible = false;
    } // (the picture is of the machine: no wall behind it)
    try {
      return m.withoutDoor(() => {
        m.holdDetail([m.root]);
        m.lod(camera, this.H, density);
        this.post.setReach(heightAt(view, BOARD_Z));
        syncWorld(scene);
        this.post.render();
        // (read at once: the canvas keeps its picture only until the task ends)
        const c = document.createElement('canvas');
        c.width = out.w;
        c.height = out.h;
        const g = sure(c.getContext('2d'));
        g.imageSmoothingQuality = 'high';
        g.drawImage(canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, out.w, out.h);
        return c.toDataURL(out.type, out.quality);
      });
    } finally {
      if (monitor) {
        monitor.visible = monitorWas;
      }
      if (wall) {
        wall.root.visible = wallWas;
      }
      applyView(camera, this.view, this.W / this.H);
      this.demand.ask();
    }
  }
}
