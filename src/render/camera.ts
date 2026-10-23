import type { Container } from 'pixi.js';

export interface View { x: number; y: number; z: number }

/** A gesture that takes over from panning (dragging a part, a plug or a key). */
export interface Grab {
  move(cx: number, cy: number, e: PointerEvent): void;
  /** `cancelled` is true for pointercancel or when a second finger lands (pinch). */
  up(cx: number, cy: number, e: PointerEvent, cancelled: boolean): void;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * World camera: (x, y) is the world point at screen centre, z the zoom. Applies itself to a Pixi container.
 * Pointer events only (mouse, touch, pen): one pointer pans, two pinch, wheel zooms about the cursor.
 */
export class Camera {
  x = 0; y = 0; z = 0.15;
  minZ = 0.08; maxZ = 3;
  w = 800; h = 600;
  /** Screen space covered by UI (CSS px): the camera centres and fits in the rest. */
  inset = { top: 0, right: 0, bottom: 0, left: 0 };
  onChange: () => void = () => {};
  /** A pointer release that was a click, not a drag (client coords). */
  onClick: (cx: number, cy: number) => void = () => {};
  /** Hover move (client coords), or null when the pointer leaves or starts dragging. */
  onHover: (p: { x: number; y: number } | null) => void = () => {};
  onKey: ((k: 'cpu' | 'board') => void) | null = null;
  /** Pointer down (client coords): return a Grab to own the gesture (no panning, no click), or null to pan as usual. */
  onGrab: (cx: number, cy: number, e: PointerEvent) => Grab | null = () => null;
  private grab: { id: number; g: Grab } | null = null;
  private flight: null | { from: View; to: View; t0: number; dur: number } = null;
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

  /** Screen point (canvas px) that the view centre sits on: the middle of the area not covered by UI. */
  get cx() { return this.inset.left + (this.w - this.inset.left - this.inset.right) / 2; }
  get cy() { return this.inset.top + (this.h - this.inset.top - this.inset.bottom) / 2; }

  toWorld(cx: number, cy: number) {
    const r = this.el.getBoundingClientRect();
    return { x: (cx - r.left - this.cx) / this.z + this.x, y: (cy - r.top - this.cy) / this.z + this.y };
  }

  apply() {
    this.world.scale.set(this.z);
    this.world.position.set(this.cx - this.x * this.z, this.cy - this.y * this.z);
    this.onChange();
  }

  set(v: View) { this.x = v.x; this.y = v.y; this.z = this.clampZ(v.z); this.apply(); }

  private clampZ(z: number) { return Math.min(this.maxZ, Math.max(this.minZ, z)); }

  /** View that fits a world rectangle with some margin. */
  fit(r: { x: number; y: number; w: number; h: number }, margin = 0.92): View {
    const aw = Math.max(50, this.w - this.inset.left - this.inset.right), ah = Math.max(50, this.h - this.inset.top - this.inset.bottom);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2, z: Math.min(aw / r.w, ah / r.h) * margin };
  }

  flyTo(to: View, dur = 1400) {
    this.flight = { from: { x: this.x, y: this.y, z: this.z }, to: { ...to, z: this.clampZ(to.z) }, t0: performance.now(), dur };
  }

  /** Advance a flight; call once per frame. */
  update(now: number) {
    const f = this.flight;
    if (!f) return;
    const t = Math.min(1, (now - f.t0) / f.dur), e = ease(t);
    // exponential zoom, pan eased the same way
    this.x = f.from.x + (f.to.x - f.from.x) * e;
    this.y = f.from.y + (f.to.y - f.from.y) * e;
    this.z = f.from.z * Math.pow(f.to.z / f.from.z, e);
    if (t >= 1) this.flight = null;
    this.apply();
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
    this.flight = null;
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
        this.x -= dx / this.z; this.y -= dy / this.z; this.apply();
        this.onHover(null);
      }
    } else if (this.pointers.size === 2) {
      const d = this.pinchDist();
      const [a, b] = [...this.pointers.values()];
      if (this.pinch > 0 && d > 0 && a && b) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinch);
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
    this.flight = null;
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
