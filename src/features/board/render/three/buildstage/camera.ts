// The camera: fly to a view, a preset, a device or a part; orbit and focus.
import { Box3, Vector3 } from 'three';
import { fitRect, LIMITS } from '@/core/render/three/camera';
import { idOf, pickPoint } from '@/core/render/three/pick';
import { devNode } from '@/features/board/sim/removal';
import { getSpec } from '@/features/board/sim/specs';
import { START, WALL_SHIFT, BIG_SIDE, STAY, FOCUS_FILL, BIG_AREA, FAR } from './tuning';
import { clampTo } from './grip';
import type { OrbitView } from './types';
import { StageShot } from './shot';

export abstract class StageCamera extends StageShot {
  // ------------------------------------------------------------------ the camera
  /** Fly to `v`: it is the goal, and the flight is marked (the first touch of the view catches it). */
  protected fly(v: OrbitView): void {
    this.goal = v;
    this.flying = true;
  }

  /**
   * The nearest surface under a client point (world) among the machine, the wall and the monitor, or null: a zoom and a pan go at its depth. The plate that takes a click on
   * the shut glass side (`case.side`) is no surface: the ray goes through it to the board behind (at the glass's depth the board would pan slower than the pointer).
   */
  protected surfaceAt(x: number, y: number): Vector3 | null {
    if (this.dead || !this._machine) {
      return null;
    }
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    return pickPoint(
      [this.machine.root, ...(this.wall ? [this.wall.root] : []), ...(this.monitor ? [this.monitor] : [])],
      this.ctx.camera,
      ((x - r.left) / r.width) * 2 - 1,
      -(((y - r.top) / r.height) * 2 - 1),
      (o) => idOf(o) === 'case.side',
    );
  }

  /** A part this big on the screen is looked at, not carried (`BIG_SIDE`, `BIG_AREA`). */
  protected big(device: string): boolean {
    const a = this.anchorOf(device);
    return (
      a !== null && (Math.max(a.w, a.h) > BIG_SIDE * Math.min(this.W, this.H) || a.w * a.h > BIG_AREA * this.W * this.H)
    );
  }

  /** `v` kept on the stage: its target within reach of the start view's (the machine and the wall cannot be lost), and not out past `FAR` times its height. */
  protected onStage(v: OrbitView): OrbitView {
    const h = this.frameView(),
      gx = h.height * (this.W / this.H) * STAY,
      gy = h.height * STAY;
    return {
      ...v,
      x: clampTo(v.x, h.x - gx, h.x + gx),
      y: clampTo(v.y, h.y - gy, h.y + gy),
      z: clampTo(v.z, h.z - h.height, h.z + h.height),
      height: Math.min(v.height, h.height * FAR),
    };
  }

  resetView(): void {
    this.fly(this.frameView());
  }

  /** A camera preset: the whole machine seen from the front, three-quarter (the start), the side, or from above; or the wall with its power plate and network jack. */
  preset(name: 'front' | 'angle' | 'side' | 'top' | 'wall'): void {
    if (name === 'wall') {
      this.fly(this.wallView());
      return;
    }
    const at = {
      front: { yaw: 0, pitch: 0.08 },
      angle: { yaw: START.yaw, pitch: START.pitch },
      side: { yaw: 1.05, pitch: 0.12 },
      top: { yaw: 0.2, pitch: 0.75 },
    }[name];
    this.fly({ ...this.frameView(), ...at });
  }

  /**
   * Fly the camera to a fitted part (its device id): in the middle of the window the panels leave free, the part filling `FOCUS_FILL` of its
   * larger side (a tall stick by its height, a wide card by its width). Head on, but for a part whose face does not look at the glass: a card stands on edge, its face looks up, so the
   * flight looks down on it as far as the camera tilts (as the game's `focusPart` does); a stick's faces look east, so it turns to read them. Nothing else turns the camera: this is the
   * player's own flight. False when it has no model.
   */
  focusDevice(id: string): boolean {
    const o = this.objectOf(devNode(id));
    if (!o) {
      return false;
    }
    o.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(o),
      c = box.getCenter(new Vector3()),
      s = box.getSize(new Vector3()),
      aspect = this.W / this.H;
    const rail = this.machine.rails.find((r) => r.id === id),
      turned =
        getSpec(this.board.devices.find((d) => d.id === id)?.spec ?? '')?.kind === 'ram'
          ? this.machine.rails.find((r) => r.id === 'ram')
          : undefined;
    // (the free window's middle is a little east of the screen's: the start view's shift, the same share of the view's width)
    const shiftOf = (height: number) => WALL_SHIFT * (height / this.frameView().height);
    if (rail?.lie) {
      const l = rail.lie,
        eff = l.d * Math.sin(LIMITS.pitchMax),
        v = fitRect(
          { x: rail.rect.x, y: -l.y - eff / 2, w: rail.rect.w, h: eff },
          rail.z,
          aspect,
          { yaw: 0, pitch: LIMITS.pitchMax, fov: this.goal.fov },
          FOCUS_FILL,
        );
      this.fly({ ...v, x: v.x - shiftOf(v.height) });
      return true;
    }
    const height = Math.max(s.y, s.x / aspect, 150) / FOCUS_FILL;
    this.fly({
      ...this.goal,
      x: c.x - shiftOf(height),
      y: c.y,
      z: turned ? turned.z : c.z,
      yaw: turned?.angle?.yaw ?? 0,
      pitch: turned?.angle?.pitch ?? 0,
      height,
    });
    return true;
  }

  /** Dev and checks: put the camera exactly here (the flicker check nudges it a pixel at a time). */
  jump(v: Partial<OrbitView>): void {
    this.goal = { ...this.view, ...v };
    this.view = this.goal;
  }
  get orbit(): OrbitView {
    return this.view;
  }
  /** Dev aid (close-up reviews, `tools/jobsheet.mjs`): turn the camera to a node's part, `at` a yaw and a pitch, and fill the view `fill` times with it. */
  focus(node: string, at: { yaw?: number; pitch?: number; fill?: number } = {}): boolean {
    const { yaw = 0.3, pitch = 0.35, fill = 2.2 } = at;
    const o = this.objectOf(node);
    if (!o) {
      return false;
    }
    o.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(o),
      c = box.getCenter(new Vector3()),
      s = box.getSize(new Vector3());
    this.jump({ x: c.x, y: c.y, z: c.z, yaw, pitch, height: Math.max(s.x, s.y, s.z) * fill });
    return true;
  }
}
