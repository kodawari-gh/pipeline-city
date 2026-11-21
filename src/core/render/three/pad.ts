// The pointers of a stage, read the same on every stage (docs/render/interact.md "Camera"): the game's board, Build my PC, the Gallery's viewer.
// `PadCore` is the recogniser (pure: events in, calls on the host out, tested in `pad.test.ts`); `attachPad` feeds it from an element's DOM events.
//   mouse   drag pans · right-drag, shift-drag turn · middle-drag pans · the wheel zooms at the pointer · double-click focuses
//   touch   one finger pans · hold on a part, then drag, lifts it · two fingers: pinch zooms (they drag the view along; a twist turns it), swipe turns · double-tap focuses
// What a drag that starts on a part means (lift it, or pan) is the host's call (`press`): a part it hands out as `eager` lifts as the pointer moves,
// any other lifts after a hold (a part too big on the screen to be a thing to carry, a machine that runs: a drag there pans, as on the empty board).
import { twoMove, twoStart, wheelZoom, type Pt, type Two } from './gesture';

/** What a press may lift. `lift` takes the pointer over (a drag of the host's own) and says so; false: refused (it said why), the press goes on as it was. */
export interface Grab { eager: boolean; lift(e: PointerEvent): boolean }

export type PadKind = 'pan' | 'turn' | 'pinch';

export interface PadHost {
  /** The first pointer went down at `at` (client px). What a drag from here may lift, or null. */
  press?(at: Pt, e: PointerEvent): Grab | null;
  /** A gesture starts about `at` (the press for a pan or a turn, the fingers' middle for a pinch or a swipe): where the surface that follows the pointers is. */
  begin?(kind: PadKind, at: Pt): void;
  /** The content follows the pointer by (dx, dy) px: one finger, the left or the middle button, and a pinch's middle. */
  pan(dx: number, dy: number): void;
  /** The view turns by (dx, dy) px of drag: the right button, shift, two fingers' swipe. */
  turn(dx: number, dy: number): void;
  /** Zoom by the factor `k` on the height shown (under 1 closer), toward the client point `at`: a wheel notch, a trackpad's pinch, two fingers. */
  zoom(k: number, at: Pt): void;
  /** Two fingers twisted by `rad` (clockwise positive) about `at`. */
  twist?(rad: number, at: Pt): void;
  /** The gesture is over (the last pointer is up): the host settles the view. */
  end?(): void;
  /** A press that did not move: a click or a tap. */
  tap?(at: Pt, e: PointerEvent): void;
  /** A second tap, near and soon after the first (a double click). */
  focus?(at: Pt, e: PointerEvent): void;
}

/** One pointer event, as the recogniser reads it. */
export interface Ptr { id: number; touch: boolean; x: number; y: number; button: number; shift: boolean; t: number; ev: PointerEvent }

export const SLOP_MOUSE = 5, SLOP_TOUCH = 10;
/** A press that stays this long (ms) without moving lifts what it holds. */
export const HOLD_MS = 400;
/** A second tap within this many ms and px of the first is a double. */
export const DOUBLE_MS = 380, DOUBLE_PX = 30;

type Mode = 'idle' | 'press' | 'pan' | 'turn' | 'two' | 'lifted' | 'spent';
type Later = (ms: number, fn: () => void) => () => void;

export class PadCore {
  private mode: Mode = 'idle';
  private ptrs = new Map<number, Pt>();
  /** The first pointer's press: where, when, what it means (`turn`: a drag turns), and what it may lift. */
  private p: { id: number; x0: number; y0: number; x: number; y: number; touch: boolean; turn: boolean; grab: Grab | null; ev: PointerEvent } | null = null;
  private two: Two | null = null;
  private stop = () => {};
  private tapped: { x: number; y: number; t: number } | null = null;
  /** Did the gesture that runs move anything? (the host's `end` follows it) */
  private moved = false;

  constructor(private host: PadHost, private later: Later = (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); }) {}

  /** Is a pointer down that the pad has? */
  get busy(): boolean { return this.mode !== 'idle'; }

  /** A pointer went down. False: the pad does not take it (a third finger, one the host holds). */
  down(q: Ptr): boolean {
    // (a mouse has one press at a time: a new one means the pointer the host held is gone, its up lost)
    if (this.mode === 'lifted' && !q.touch) this.cancel();
    if (this.mode === 'lifted') return false;
    if (q.touch) {
      if (this.ptrs.size >= 2) return false;
      this.ptrs.set(q.id, { x: q.x, y: q.y });
      if (this.ptrs.size === 2) {
        // the second finger: the press, if it is still one, is no tap, no lift and no pan (a pan that ran goes on as the pinch's)
        this.stop(); this.stop = () => {};
        this.p = null;
        this.two = twoStart(...(this.fingers() as [Pt, Pt]));
        if (this.mode !== 'pan' && this.mode !== 'turn') this.moved = false;
        this.mode = 'two';
        return true;
      }
    } else if (this.mode !== 'idle') return false;
    else this.ptrs.set(q.id, { x: q.x, y: q.y });
    const turn = !q.touch && (q.button === 2 || (q.button === 0 && q.shift));
    // (the middle button pans over everything: it lifts nothing)
    const grab = !turn && q.button === 0 ? this.host.press?.({ x: q.x, y: q.y }, q.ev) ?? null : null;
    this.p = { id: q.id, x0: q.x, y0: q.y, x: q.x, y: q.y, touch: q.touch, turn, grab, ev: q.ev };
    this.mode = 'press';
    this.moved = false;
    if (grab && !grab.eager) this.stop = this.later(HOLD_MS, () => this.hold());
    return true;
  }

  move(q: Ptr): void {
    if (!this.ptrs.has(q.id)) return;
    this.ptrs.set(q.id, { x: q.x, y: q.y });
    const p = this.p;
    if (this.mode === 'press' && p && q.id === p.id) {
      p.ev = q.ev;
      if (Math.hypot(q.x - p.x0, q.y - p.y0) < (p.touch ? SLOP_TOUCH : SLOP_MOUSE)) return;
      this.stop(); this.stop = () => {};
      if (p.grab?.eager && p.grab.lift(q.ev)) { this.give(); return; }
      this.mode = p.turn ? 'turn' : 'pan';
      this.host.begin?.(this.mode, { x: p.x0, y: p.y0 });
      this.moved = true;
      // (the whole travel since the press: the content stays under the pointer, the slop is no dead zone)
      this.send(q.x - p.x0, q.y - p.y0);
      p.x = q.x; p.y = q.y;
      return;
    }
    if ((this.mode === 'pan' || this.mode === 'turn') && p && q.id === p.id) {
      this.send(q.x - p.x, q.y - p.y);
      p.x = q.x; p.y = q.y;
      return;
    }
    if (this.mode === 'two' && this.two && this.ptrs.size === 2) {
      const [a, b] = this.fingers() as [Pt, Pt], was = this.two.kind, who = [...this.ptrs.keys()].indexOf(q.id) === 0 ? 0 : 1, r = twoMove(this.two, a, b, who);
      this.two = r.two;
      const m = r.move;
      if (!m.kind) return;
      if (!was) this.host.begin?.(m.kind === 'swipe' ? 'turn' : 'pinch', m.at);
      this.moved = true;
      if (m.kind === 'swipe') { if (m.dx || m.dy) this.host.turn(m.dx, m.dy); return; }
      if (m.zoom !== 1) this.host.zoom(m.zoom, m.at);
      if (m.dx || m.dy) this.host.pan(m.dx, m.dy);
      if (m.twist) this.host.twist?.(m.twist, m.at);
    }
  }

  up(q: Ptr, cancelled = false): void {
    if (!this.ptrs.has(q.id)) return;
    this.ptrs.delete(q.id);
    const p = this.p;
    if (this.mode === 'press' && p && q.id === p.id) {
      this.stop(); this.stop = () => {};
      this.p = null;
      this.mode = 'idle';
      // (a right or middle button's click is no tap)
      if (cancelled || (!q.touch && q.button !== 0)) return;
      this.tap({ x: q.x, y: q.y }, q.ev, q.t);
      return;
    }
    if (this.mode === 'pan' || this.mode === 'turn') this.finish();
    else if (this.mode === 'two') {
      // (the finger left behind neither pans nor taps)
      if (this.moved) this.host.end?.();
      this.two = null;
      this.mode = this.ptrs.size ? 'spent' : 'idle';
      return;
    } else if (this.mode === 'lifted') this.mode = 'idle';
    if (!this.ptrs.size) this.mode = 'idle';
  }

  /** The press has held still: a part a drag would only pan over lifts now. */
  hold(): void {
    const p = this.p;
    if (this.mode !== 'press' || !p?.grab) return;
    if (p.grab.lift(p.ev)) this.give();
  }

  /** The pointers are gone without a click (the window lost focus, a pointer cancel): whatever runs ends. */
  cancel(): void {
    this.stop(); this.stop = () => {};
    if (this.moved && this.mode !== 'lifted') this.host.end?.();
    this.ptrs.clear();
    this.p = null; this.two = null;
    this.mode = 'idle';
  }

  /** A wheel notch, or a trackpad's pinch (the browser sends it as a wheel with ctrl held). */
  wheel(e: { clientX: number; clientY: number; deltaY: number; deltaMode: number; ctrlKey: boolean }): void {
    this.host.zoom(wheelZoom(e), { x: e.clientX, y: e.clientY });
  }

  // ---------------------------------------------------------------- inside
  private fingers(): Pt[] { return [...this.ptrs.values()]; }

  /** The host holds the pointer now: the pad lets it go, and ignores it until it is up. */
  private give(): void { this.p = null; this.mode = 'lifted'; }

  private send(dx: number, dy: number): void {
    if (this.mode === 'turn') this.host.turn(dx, dy); else this.host.pan(dx, dy);
  }

  private finish(): void {
    this.p = null;
    this.mode = 'idle';
    if (this.moved) this.host.end?.();
  }

  private tap(at: Pt, ev: PointerEvent, t: number): void {
    const was = this.tapped;
    if (was && t - was.t <= DOUBLE_MS && Math.hypot(at.x - was.x, at.y - was.y) <= DOUBLE_PX) { this.tapped = null; this.host.focus?.(at, ev); return; }
    this.tapped = { x: at.x, y: at.y, t };
    this.host.tap?.(at, ev);
  }
}

/** The pad on an element: its pointer events, wheel and context menu go to a `PadCore`; the browser leaves the element its fingers (no scroll, no page zoom, no text selection). */
export function attachPad(el: HTMLElement, host: PadHost): { core: PadCore; dispose(): void } {
  const core = new PadCore(host);
  const read = (e: PointerEvent): Ptr => ({ id: e.pointerId, touch: e.pointerType !== 'mouse', x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey, t: e.timeStamp, ev: e });
  const down = (e: PointerEvent) => {
    if (!core.down(read(e))) return;
    // (a pointer that is already gone, as a synthetic one in a test, cannot be captured)
    try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  };
  const move = (e: PointerEvent) => core.move(read(e));
  // (the up and the cancel come to the window: a pointer the host took over may be captured by another element, and its end must not be lost)
  const up = (e: PointerEvent) => { core.up(read(e)); try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ } };
  const cancel = (e: PointerEvent) => core.up(read(e), true);
  const wheel = (e: WheelEvent) => { e.preventDefault(); core.wheel(e); };
  const menu = (e: Event) => e.preventDefault();
  const blur = () => core.cancel();
  // (the element's own window: a pop-out or a frame has its own. A test's stand-in element has no window and no style, and takes its own events alone)
  const win = el.ownerDocument?.defaultView ?? null, s = el.style as CSSStyleDeclaration | undefined;
  if (s) {
    s.touchAction = 'none';
    s.userSelect = 'none';
    s.setProperty('-webkit-user-select', 'none');
    s.setProperty('-webkit-touch-callout', 'none');
    s.setProperty('-webkit-tap-highlight-color', 'transparent');
  }
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('wheel', wheel, { passive: false });
  el.addEventListener('contextmenu', menu);
  win?.addEventListener('pointerup', up);
  win?.addEventListener('pointercancel', cancel);
  win?.addEventListener('blur', blur);
  return {
    core,
    dispose() {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('wheel', wheel); el.removeEventListener('contextmenu', menu);
      win?.removeEventListener('pointerup', up); win?.removeEventListener('pointercancel', cancel); win?.removeEventListener('blur', blur);
      core.cancel();
    },
  };
}
