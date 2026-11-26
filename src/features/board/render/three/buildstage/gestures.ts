// The pointer and the pads: tap, drag, pan, pinch.
import { heightAt, LIMITS, panBy, retarget, zoomAt, zoomOn } from '@/core/render/three/camera';
import { turnOf } from '@/core/render/three/gesture';
import { attachPad } from '@/core/render/three/pad';
import { deviceFor } from '../buildpick';
import type { Pt } from '../buildshot';
import { give, clampTo } from './grip';
import type { Grab, Grip, PadHost, PadKind } from './types';
import { StageCableHand } from './cablehand';

export abstract class StageGestures extends StageCableHand {
  /** A press on a part inside the open case (no busy job) hands the device id and the press here: the UI drags it. */
  onGrab: ((device: string, e: PointerEvent) => void) | null = null;
  /**
   * The pointers, as in the game (`board3d.ts`) and the Gallery's viewer (`core/render/three/pad.ts`): drag pans, right drag or shift turns, the wheel zooms
   * toward the surface under the pointer; on touch one finger pans, two fingers pinch and turn. A press on a part or a plug lifts it (the UI's drag, the hand).
   */
  protected override listen(el: HTMLCanvasElement): void {
    // what a pan or a pinch took hold of (the depth of the surface under it; the point a pinch zooms about, null: none), and a turn's start
    const grip: Grip = { el, grabZ: undefined, pinchAt: undefined, turning: null };
    const pad = attachPad(el, this.gestures(grip));
    const move = (e: PointerEvent) => {
      if (!pad.core.busy) {
        this.pointerOver(e.clientX, e.clientY, el);
      }
    };
    const leave = () => {
      if (!pad.core.busy) {
        this.hover.value = null;
        el.style.cursor = '';
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    this.cleanup.push(() => {
      pad.dispose();
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    });
  }

  /** The pad's gestures on the stage, over one `grip`. */
  protected gestures(g: Grip): PadHost {
    return {
      press: (at, e) => this.padPress(g, at, e),
      begin: (kind, at) => {
        this.padBegin(g, kind, at);
      },
      pan: (dx, dy) => {
        this.padPan(g, dx, dy);
      },
      turn: (dx, dy) => {
        const t = turnOf(dx, dy, this.H);
        g.turning ??= { base: this.goal, yaw: this.goal.yaw, pitch: this.goal.pitch };
        g.turning.yaw = clampTo(g.turning.yaw + t.yaw, -LIMITS.yaw, LIMITS.yaw);
        g.turning.pitch = clampTo(g.turning.pitch + t.pitch, LIMITS.pitchMin, LIMITS.pitchMax);
        this.goal = { ...g.turning.base, yaw: g.turning.yaw, pitch: g.turning.pitch };
      },
      zoom: (k, at) => {
        this.padZoom(g, k, at);
      },
      twist: (rad) => {
        this.goal = { ...this.goal, yaw: clampTo(this.goal.yaw + rad, -LIMITS.yaw, LIMITS.yaw) };
      },
      end: () => {
        g.grabZ = undefined;
        g.pinchAt = undefined;
        g.turning = null;
      },
      // (a press that did not move: a click on a part picks it, as the UI's drag does when it does not move; the side panel opens, empty space lets go of the picked part)
      tap: (at) => {
        const id = this.status.peek().busy || this.holding || !this.onGrab ? null : this.partAt(at.x, at.y);
        if (id !== null && id !== '') {
          this.select(id);
        } else {
          this.click(at.x, at.y);
        }
      },
      // (a double click on a part flies to it; on anything else it frames the machine again)
      focus: (at) => {
        const d = deviceFor(this.idAt(at.x, at.y), this.board);
        if (d) {
          this.focusDevice(d.id);
        } else {
          this.resetView();
        }
      },
    };
  }

  /** A press: what a drag from it may lift (a cable's plug, a part), or null. */
  protected padPress(g: Grip, at: Pt, e: PointerEvent): Grab | null {
    if (this.status.peek().busy || this.holding) {
      return null;
    }
    // a cable's plug lifts as the pointer moves (a press that does not move is a click); a refused lift (a lead that carries power) goes on as a pan
    const cable = this.cableAt(at.x, at.y);
    if (cable !== null && cable !== '') {
      return {
        eager: true,
        lift: (ev) => {
          this.beginCable(cable, ev);
          const held = this.holding;
          if (held) {
            give(g.el, ev);
          }
          return held;
        },
      };
    }
    // a part (the UI's drag takes it): a mouse drag on a small one lifts it. On a finger, and on a part that fills the screen, a drag pans over it and a hold lifts it
    const id = this.onGrab ? this.partAt(at.x, at.y) : null;
    if (id !== null && id !== '') {
      return {
        eager: e.pointerType === 'mouse' && !this.big(id),
        lift: () => {
          give(g.el, e);
          this.onGrab?.(id, e);
          return true;
        },
      };
    }
    return null;
  }

  /** A gesture begins: a drag clears the hover, a flight is caught; a turn goes about the surface under the stage's middle, a pan or a pinch at the surface under it. */
  protected padBegin(g: Grip, kind: PadKind, at: Pt): void {
    // (a drag clears the hover; a flight in the air is caught where it is)
    if (this.hover.peek()) {
      this.hover.value = null;
      g.el.style.cursor = '';
    }
    if (this.flying) {
      this.flying = false;
      this.goal = this.view;
    }
    if (kind === 'turn') {
      // the view turns about the surface under the middle of the stage
      const r = g.el.getBoundingClientRect(),
        m = this.surfaceAt(r.left + r.width / 2, r.top + r.height / 2);
      if (m) {
        this.goal = retarget(this.goal, m.z);
        this.view = retarget(this.view, m.z);
      }
      g.turning = { base: this.goal, yaw: this.goal.yaw, pitch: this.goal.pitch };
      return;
    }
    const p = this.surfaceAt(at.x, at.y);
    g.grabZ = p?.z;
    g.pinchAt = kind === 'pinch' ? p : undefined;
  }

  /** A pan: the grabbed surface follows the pointer (the pan goes at its depth), and the view goes with it at once. */
  protected padPan(g: Grip, dx: number, dy: number): void {
    // the grabbed surface follows the pointer: the pan goes at its depth, and the view goes with it at once
    const k = (g.grabZ === undefined ? this.view.height : heightAt(this.view, g.grabZ)) / this.H,
      was = this.goal;
    this.goal = this.onStage(panBy(this.goal, -dx * k, dy * k));
    this.view = {
      ...this.view,
      x: this.view.x + this.goal.x - was.x,
      y: this.view.y + this.goal.y - was.y,
      z: this.view.z + this.goal.z - was.z,
    };
  }

  /** A zoom toward the surface under the pointer (or the point a pinch took hold of). */
  protected padZoom(g: Grip, k: number, at: Pt): void {
    if (this.flying) {
      this.flying = false;
      this.goal = this.view;
    }
    const r = g.el.getBoundingClientRect(),
      p = g.pinchAt === undefined ? this.surfaceAt(at.x, at.y) : g.pinchAt;
    const nx = ((at.x - r.left) / r.width) * 2 - 1,
      ny = -(((at.y - r.top) / r.height) * 2 - 1);
    this.goal = this.onStage(p ? zoomOn(this.goal, p, k) : zoomAt(this.goal, k, nx, ny, this.W / this.H));
  }
}
