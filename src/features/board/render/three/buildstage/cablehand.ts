// A cable the player drags by its plug.
import { signal } from '@preact/signals';
import { hotPluggable } from '@/features/board/sim/cables';
import type { CableTrack } from './types';
import { StagePointer } from './pointer';

export abstract class StageCableHand extends StagePointer {
  // ------------------------------------------------------------------ the player's hand on a cable
  /** Ends the cable the player holds (the pointer's events on the window come off); null when none is held. */
  protected cableDrop: ((cancelled: boolean) => void) | null = null;
  /** What the held plug would do at the pointer ("Plug into the CPU power socket", "Let go to plug into …") and where the pointer is: the toolbar draws it by the pointer. */
  readonly cableTip = signal<{ text: string; ok: boolean; x: number; y: number } | null>(null);

  /**
   * The player takes hold of a cable's plug (`down` found it, and the pointer moved): a seated plug is pulled out against its latch, a loose one lifted. The hand
   * holds it until the pointer is let go: over its socket it slides in and clicks (the game's rule: a cable other than the hot-pluggable ones needs the machine
   * off), anywhere else it falls on its cable and stays where it lands. Escape lets go and drops it.
   */
  protected beginCable(kind: string, e: PointerEvent): void {
    if (this.dead || this.status.peek().busy || this.holding) {
      return;
    }
    if (this.snapshot.powered && !hotPluggable(kind)) {
      this.refuse('Power the machine off first: the PSU cables carry live power.');
      return;
    }
    this.clearRefusal();
    if (!this.hand.grab(kind, e.clientX, e.clientY)) {
      this.refuse('This lead cannot be moved.');
      return;
    }
    this.hover.value = null;
    this.trackCable(e.pointerId, e.clientX, e.clientY);
  }

  /** Follow the pointer for the hand until it lets go (a release, a cancel, Escape, the window losing focus). */
  protected trackCable(id: number, cx: number, cy: number): void {
    const el = this.ctx.renderer.domElement,
      track: CableTrack = { id, last: [cx, cy], off: [] };
    const end = (cancelled: boolean, x: number, y: number): void => {
      for (const f of track.off) {
        f();
      }
      this.cableDrop = null;
      this.cableTip.value = null;
      el.style.cursor = '';
      if (!this.dead) {
        this.hand.release(x, y, cancelled);
      }
      this.demand.ask();
    };
    this.followCable(track, end);
    this.cableDrop = (cancelled) => {
      end(cancelled, ...track.last);
    };
    el.style.cursor = 'grabbing';
    this.hand.move(cx, cy, this.rawIdAt(cx, cy));
    this.tipAt(cx, cy);
  }

  /** What the held plug would do at a client point, shown there (`cableTip`). */
  protected tipAt(x: number, y: number): void {
    const l = this.hand.label();
    this.cableTip.value = l ? { ...l, x, y } : null;
  }

  /** The window's pointer, key and focus events that move the held plug and end the hold (`end`); `track.off` takes them off. */
  protected followCable(track: CableTrack, end: (cancelled: boolean, x: number, y: number) => void): void {
    const onMove = (m: PointerEvent): void => {
      if (m.pointerId !== track.id) {
        return;
      }
      track.last = [m.clientX, m.clientY];
      this.hand.move(m.clientX, m.clientY, this.rawIdAt(m.clientX, m.clientY));
      this.tipAt(m.clientX, m.clientY);
      this.demand.ask();
    };
    const onUp = (m: PointerEvent): void => {
      if (m.pointerId === track.id) {
        end(false, m.clientX, m.clientY);
      }
    };
    const onCancel = (m: PointerEvent): void => {
      if (m.pointerId === track.id) {
        end(true, m.clientX, m.clientY);
      }
    };
    const onKey = (k: KeyboardEvent): void => {
      if (k.key === 'Escape') {
        k.stopPropagation();
        end(true, ...track.last);
      }
    };
    const onBlur = (): void => {
      end(true, ...track.last);
    };
    globalThis.addEventListener('pointermove', onMove, true);
    globalThis.addEventListener('pointerup', onUp, true);
    globalThis.addEventListener('pointercancel', onCancel, true);
    globalThis.addEventListener('keydown', onKey, true);
    globalThis.addEventListener('blur', onBlur);
    track.off.push(() => {
      globalThis.removeEventListener('pointermove', onMove, true);
      globalThis.removeEventListener('pointerup', onUp, true);
      globalThis.removeEventListener('pointercancel', onCancel, true);
      globalThis.removeEventListener('keydown', onKey, true);
      globalThis.removeEventListener('blur', onBlur);
    });
  }
}
