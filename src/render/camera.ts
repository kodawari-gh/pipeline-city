import type { Container } from 'pixi.js';

export interface View { x: number; y: number; z: number }
export interface Inset { top: number; right: number; bottom: number; left: number }
export interface Rect { x: number; y: number; w: number; h: number }

/** Options for a flight (`flyTo` in board.ts, `Camera.flyTo`). Defaults are in docs/RENDER.md. */
export interface FlyOpts {
  /** `false` jumps to the target instead of animating. Default `true`. */
  smooth?: boolean;
  /** Zoom to land on, clamped to the camera range. Default: frame the target with context, zoom capped at 0.3. */
  zoom?: number;
  /**
   * Hold the target: the view stays where the flight lands when the UI reserves or frees space (no overview re-fit),
   * until the player pans or zooms or another flight starts.
   */
  hold?: boolean;
  /** Called once: `true` when the flight lands, `false` when it is cancelled (press, wheel, pinch, key, another flight) or the id is unknown. */
  onDone?: (arrived: boolean) => void;
}

/** A gesture that takes over from panning (dragging a part, a plug or a key). */
export interface Grab {
  move(cx: number, cy: number, e: PointerEvent): void;
  /** `cancelled` is true for pointercancel or when a second finger lands (pinch). */
  up(cx: number, cy: number, e: PointerEvent, cancelled: boolean): void;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Pure world-to-client mapping used by the camera (and unit tested): a world rect at view `v`, where the view centre
 * sits at `centre` (canvas px) and the canvas's top-left is at `origin` (client px). Output is client px.
 */
export function screenRect(r: Rect, v: View, centre: { x: number; y: number }, origin: { left: number; top: number }): Rect {
  return {
    x: origin.left + centre.x + (r.x - v.x) * v.z,
    y: origin.top + centre.y + (r.y - v.y) * v.z,
    w: r.w * v.z,
    h: r.h * v.z,
  };
}

/**
 * World camera: (x, y) is the world point at screen centre, z the zoom. Applies itself to a Pixi container.
 * Pointer events only (mouse, touch, pen): one pointer pans, two pinch, wheel zooms about the cursor.
 */
export class Camera {
  x = 0; y = 0; z = 0.15;
  minZ = 0.08; maxZ = 3;
  w = 800; h = 600;
  /**
   * Screen space covered by UI (CSS px), the TARGET value. The drawn inset eases toward it in `update` (never while a
   * pointer gesture runs), so the view glides instead of jumping when a panel opens or closes.
   */
  inset: Inset = { top: 0, right: 0, bottom: 0, left: 0 };
  /** The inset as drawn (eased). `cx`/`cy` and the free area use this. */
  private shown: Inset = { top: 0, right: 0, bottom: 0, left: 0 };
  private easeAt = 0;
  /** Set by `flyTo(..., hold = true)`: the held world point. Cleared by a pan, a wheel, a pinch or a non-held flight. */
  holdAt: { x: number; y: number } | null = null;
  onChange: () => void = () => {};
  /** A pointer release that was a click, not a drag (client coords). */
  onClick: (cx: number, cy: number) => void = () => {};
  /** Hover move (client coords), or null when the pointer leaves or starts dragging. */
  onHover: (p: { x: number; y: number } | null) => void = () => {};
  onKey: ((k: 'cpu' | 'board') => void) | null = null;
  /** Pointer down (client coords): return a Grab to own the gesture (no panning, no click), or null to pan as usual. */
  onGrab: (cx: number, cy: number, e: PointerEvent) => Grab | null = () => null;
  private grab: { id: number; g: Grab } | null = null;
  private flight: null | { from: View; to: View; t0: number; dur: number; done?: (arrived: boolean) => void } = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private down = { x: 0, y: 0, moved: false };
  private pinch = 0;

  constructor(private world: Container, private el: HTMLElement) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.pdown);
    el.addEventListener('pointermove', this.pmove);
    el.addEventListener('pointerup', this.pup);
    el.addEventListener('pointercancel', this.pup);
    el.addEventListener('pointerleave', () => this.onHover(null));
    el.addEventListener('wheel', this.wheel, { passive: false });
    window.addEventListener('keydown', this.key);
  }

  resize(w: number, h: number) { this.w = w; this.h = h; this.apply(); }

  /** Set the inset now, without easing (start-up). */
  snapInset(i: Inset) { this.inset = { ...i }; this.shown = { ...i }; this.apply(); }

  /** True while a pointer gesture (pan, pinch, or a grab such as a drag) owns the view. */
  get gesturing() { return this.pointers.size > 0 || !!this.grab; }

  /** Screen point (canvas px) that the view centre sits on: the middle of the area not covered by UI. */
  get cx() { return this.shown.left + (this.w - this.shown.left - this.shown.right) / 2; }
  get cy() { return this.shown.top + (this.h - this.shown.top - this.shown.bottom) / 2; }

  toWorld(cx: number, cy: number) {
    const r = this.el.getBoundingClientRect();
    return { x: (cx - r.left - this.cx) / this.z + this.x, y: (cy - r.top - this.cy) / this.z + this.y };
  }

  /** A world rect in client px (the viewport), the same mapping `apply` uses for the world container. */
  screenRect(r: Rect): Rect {
    const b = this.el.getBoundingClientRect();
    return screenRect(r, this, { x: this.cx, y: this.cy }, b);
  }

  /** The free area (the canvas minus the UI inset as drawn), in client px. */
  freeRect(): Rect {
    const b = this.el.getBoundingClientRect();
    const x = b.left + this.shown.left, y = b.top + this.shown.top;
    return { x, y, w: Math.max(0, this.w - this.shown.left - this.shown.right), h: Math.max(0, this.h - this.shown.top - this.shown.bottom) };
  }

  apply() {
    this.world.scale.set(this.z);
    this.world.position.set(this.cx - this.x * this.z, this.cy - this.y * this.z);
    this.onChange();
  }

  set(v: View) { this.cancelFlight(); this.x = v.x; this.y = v.y; this.z = this.clampZ(v.z); this.apply(); }

  private clampZ(z: number) { return Math.min(this.maxZ, Math.max(this.minZ, z)); }

  /** View that fits a world rectangle with some margin (uses the target inset). */
  fit(r: Rect, margin = 0.92): View {
    const aw = Math.max(50, this.w - this.inset.left - this.inset.right), ah = Math.max(50, this.h - this.inset.top - this.inset.bottom);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2, z: Math.min(aw / r.w, ah / r.h) * margin };
  }

  /**
   * Fly to a view over `dur` ms (0 jumps). Replaces any flight in progress (its `onDone` gets false). `onDone(true)` when it
   * lands. `hold` keeps the target (see `FlyOpts.hold`); without it any hold is dropped.
   */
  flyTo(to: View, dur = 1400, onDone?: (arrived: boolean) => void, hold = false) {
    this.cancelFlight();
    this.holdAt = hold ? { x: to.x, y: to.y } : null;
    const target = { x: to.x, y: to.y, z: this.clampZ(to.z) };
    if (dur <= 0) { this.x = target.x; this.y = target.y; this.z = target.z; this.apply(); onDone?.(true); return; }
    this.flight = { from: { x: this.x, y: this.y, z: this.z }, to: target, t0: performance.now(), dur, done: onDone };
  }

  /** Stop the flight in progress, if any, where it is. Its `onDone` gets false. */
  cancelFlight() {
    const f = this.flight;
    if (!f) return;
    this.flight = null;
    f.done?.(false);
  }

  /** Advance a flight and the inset easing; call once per frame. */
  update(now: number) {
    let moved = false, landed: (() => void) | null = null;
    const f = this.flight;
    if (f) {
      const t = Math.min(1, (now - f.t0) / f.dur), e = ease(t);
      // exponential zoom, pan eased the same way
      this.x = f.from.x + (f.to.x - f.from.x) * e;
      this.y = f.from.y + (f.to.y - f.from.y) * e;
      this.z = f.from.z * Math.pow(f.to.z / f.from.z, e);
      moved = true;
      if (t >= 1) { this.flight = null; landed = () => f.done?.(true); }
    }
    if (this.easeInset(now)) moved = true;
    if (moved) this.apply();
    landed?.();
  }

  /** Ease the drawn inset toward the target (about 0.3 s). Frozen while a gesture owns the view, so nothing moves under the pointer. */
  private easeInset(now: number): boolean {
    const dt = Math.min(0.1, Math.max(0, (now - this.easeAt) / 1000));
    this.easeAt = now;
    if (this.gesturing) return false;
    const k = 1 - Math.exp(-dt * 9);
    let moved = false;
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const d = this.inset[side] - this.shown[side];
      if (d === 0) continue;
      this.shown[side] = Math.abs(d) < 0.5 ? this.inset[side] : this.shown[side] + d * k;
      moved = true;
    }
    return moved;
  }

  private zoomAt(cx: number, cy: number, factor: number) {
    const before = this.toWorld(cx, cy);
    this.z = this.clampZ(this.z * factor);
    const r = this.el.getBoundingClientRect();
    // keep the world point under the cursor fixed
    this.x = before.x - (cx - r.left - this.cx) / this.z;
    this.y = before.y - (cy - r.top - this.cy) / this.z;
    this.apply();
  }

  private pdown = (e: PointerEvent) => {
    this.cancelFlight();
    this.el.setPointerCapture?.(e.pointerId);
    if (this.grab) { // a second finger: the grab is over, the pinch begins
      this.grab.g.up(e.clientX, e.clientY, e, true); this.grab = null;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.down.moved = true;
      return;
    }
    if (this.pointers.size === 0 && (e.pointerType !== 'mouse' || e.button === 0)) {
      const g = this.onGrab(e.clientX, e.clientY, e);
      if (g) { this.grab = { id: e.pointerId, g }; this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); return; }
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.down = { x: e.clientX, y: e.clientY, moved: false };
    if (this.pointers.size === 2) { this.pinch = this.pinchDist(); this.down.moved = true; }
  };

  private pinchDist() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private pmove = (e: PointerEvent) => {
    if (this.grab) { if (e.pointerId === this.grab.id) this.grab.g.move(e.clientX, e.clientY, e); return; }
    const p = this.pointers.get(e.pointerId);
    if (!p) { if (e.pointerType === 'mouse') this.onHover({ x: e.clientX, y: e.clientY }); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!this.down.moved && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) this.down.moved = true;
    if (this.pointers.size === 1) {
      if (this.down.moved) {
        this.holdAt = null;
        this.x -= dx / this.z; this.y -= dy / this.z; this.apply();
        this.onHover(null);
      }
    } else if (this.pointers.size === 2) {
      const d = this.pinchDist();
      const [a, b] = [...this.pointers.values()];
      if (this.pinch > 0 && d > 0 && a && b) { this.holdAt = null; this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinch); }
      this.pinch = d;
    }
  };

  private pup = (e: PointerEvent) => {
    if (this.grab && e.pointerId === this.grab.id) {
      const g = this.grab.g;
      this.grab = null; this.pointers.delete(e.pointerId);
      g.up(e.clientX, e.clientY, e, e.type === 'pointercancel');
      return;
    }
    const had = this.pointers.delete(e.pointerId);
    if (had && e.type === 'pointerup' && this.pointers.size === 0 && !this.down.moved) this.onClick(e.clientX, e.clientY);
    this.pinch = 0;
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.cancelFlight();
    this.holdAt = null;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.0015));
  };

  private key = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') this.onKey?.('cpu');
    else if (e.key === 'b' || e.key === 'B') this.onKey?.('board');
  };
}
