import { Container, Graphics, Text } from 'pixi.js';
import { hover, selected } from '../game/hover';
import { dragging, highlight } from '../game/interaction';
import { connectCable, disconnectCable, ejectKey, install, lastError, plugKey, powerButton, snapshot } from '../game/store';
import type { Snapshot } from '../sim/protocol';
import type { Camera, FlyOpts, Grab } from './camera';
import { drawPlug, ACCENT } from './devices';
import { box, MONO, mix } from './ink';
import { BD, type Rect } from './layout';
import { keyStick, partIcon, ICON, KEY_LEN, KEY_LEN_PLUGGED, type PropObj } from './props';
import { movablePlug, rubberBand, type Cable, type CableKind, type Loose, type Plug, type Pt } from './routes';
import type { Theme } from './theme';

// Everything the player does with the mouse or a finger, and every moving overlay that goes with it: hover affordance,
// drag and drop (parts, cables, keys), drop-target pulses, tutorial highlight rings and edge arrows, inline messages.
// board.ts owns the scene and fills `scene`; this class owns the gesture state and the overlay layers.

export type CableState = 'connected' | 'loose' | 'held';

export interface CableInfo {
  kind: CableKind;
  cable: Cable;
  loose: Loose;
  /** Rect of the plug the player grabs (seated or at rest). */
  plug: Rect;
  /** Where the loose plug goes (board connector). */
  connector: Rect;
  state: CableState;
}

export interface SceneInfo {
  /** Id to world rect, for outlines, highlight rings and flyTo. */
  rects: Map<string, Rect>;
  /** Ids that animate on hover. */
  interactive: Set<string>;
  /** Props whose node lifts on hover (tray keys, power button, plugged key). */
  props: Map<string, PropObj>;
  cables: Map<CableKind, CableInfo>;
  /** Slot id to its world rect (empty or occupied). */
  slots: Map<string, Rect>;
  usb: Rect;
}

export const emptyScene = (): SceneInfo => ({ rects: new Map(), interactive: new Set(), props: new Map(), cables: new Map(), slots: new Map(), usb: { x: 0, y: 0, w: 0, h: 0 } });

const DRAG_PX = 6;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const inside = (r: Rect, x: number, y: number, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
const centre = (r: Rect): Pt => [r.x + r.w / 2, r.y + r.h / 2];
const NO_EJECT = new Set(['loading', 'running', 'writing']);

interface Toast { c: Container; t0: number; x: number; y: number }

export class Interact {
  readonly fx = new Container();
  readonly hud = new Container();
  scene: SceneInfo = emptyScene();
  /** board.ts hooks: which cable is in the player's hand (its static art is hidden), and the optimistic cable state. */
  onHeld: (k: CableKind | null) => void = () => {};
  forced = new Map<CableKind, { connected: boolean; until: number }>();
  hitAt: (cx: number, cy: number) => string | null = () => null;

  private T!: Theme;
  private g = new Graphics();
  private hg = new Graphics();
  private ghost = new Container();
  private notes = new Container();
  private amt = new Map<string, number>();
  private hoverId: string | null = null;
  private toasts: Toast[] = [];
  private drag: null | {
    kind: 'part' | 'cable' | 'key';
    id: string;
    /** Current pointer (client) and world position. */
    cx: number; cy: number; wx: number; wy: number;
    /** part: where the drag began (world), for the snap back when there is no prop to return to */ home?: Pt;
    /** part */ validFree?: Set<string>; validSwap?: Set<string>; over?: string | null; why?: string | null;
    /** cable */ cable?: CableInfo; snapped?: boolean;
    /** key */ fromPlugged?: boolean; keyId?: number;
  } = null;
  private back: { c: Container; fx: number; fy: number; tx: number; ty: number; t0: number; to: 'fade' | 'return' }[] = [];
  private actionAt: { x: number; y: number; t: number } = { x: 0, y: 0, t: -1e9 };
  private edge: { id: string; x: number; y: number }[] = [];
  private noteText: Text;
  private noteBg = new Graphics();
  private noteSet = false;

  constructor(private camera: Camera, private canvas: HTMLCanvasElement, private flyToRects: (rs: Rect[], opts: FlyOpts) => void) {
    this.fx.addChild(this.g, this.ghost);
    this.hud.addChild(this.hg, this.notes, this.noteBg);
    this.noteText = new Text({ text: '', style: { fontFamily: MONO, fontSize: 13, fontWeight: '700', fill: '#ffffff', wordWrap: true, wordWrapWidth: 260 }, resolution: 2 });
    this.noteText.visible = false;
    this.hud.addChild(this.noteText);
    camera.onGrab = (cx, cy, e) => this.grabAt(cx, cy, e);
    // a refused action from the sim shows near where the player acted
    let first = true;
    lastError.subscribe((m) => {
      if (first) { first = false; return; }
      if (m && performance.now() - this.actionAt.t < 2500) this.toast(m.replace(/^[a-zA-Z]+: /, ''), this.actionAt.x, this.actionAt.y, 'bad');
    });
  }

  setTheme(T: Theme) { this.T = T; }

  /** A drag is in progress (board.ts uses it to stop hover updates). */
  get busy() { return !!this.drag; }

  /**
   * Start dragging an inventory part from a DOM pointerdown outside the canvas (the inventory menu). Tracks the pointer on
   * window until release: drop on a valid socket installs, anything else (other socket, off canvas, Escape) snaps back.
   */
  beginPartDrag(invId: string, e: PointerEvent) {
    if (this.drag) return;
    const id = e.pointerId;
    if (!this.beginPart(invId, e.clientX, e.clientY)) return;
    try { (e.target as Element | null)?.setPointerCapture?.(id); } catch { /* not capturable (synthetic event) */ }
    const over = (cx: number, cy: number) => { const r = this.canvas.getBoundingClientRect(); return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom; };
    const end = (cx: number, cy: number, cancelled: boolean) => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      this.dragEnd(cx, cy, cancelled || !over(cx, cy));
    };
    let last: [number, number] = [e.clientX, e.clientY];
    const onMove = (m: PointerEvent) => { if (m.pointerId !== id) return; last = [m.clientX, m.clientY]; this.dragMove(m.clientX, m.clientY); };
    const onUp = (m: PointerEvent) => { if (m.pointerId === id) end(m.clientX, m.clientY, false); };
    const onCancel = (m: PointerEvent) => { if (m.pointerId === id) end(m.clientX, m.clientY, true); };
    const onKey = (k: KeyboardEvent) => { if (k.key === 'Escape') { k.stopPropagation(); end(last[0], last[1], true); } };
    const onBlur = () => end(last[0], last[1], true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
  }

  // ------------------------------------------------------------------ helpers

  private snap(): Snapshot | null { return snapshot.peek(); }
  private canvasXY(cx: number, cy: number): Pt { const r = this.canvas.getBoundingClientRect(); return [cx - r.left, cy - r.top]; }
  private world(cx: number, cy: number): Pt { const w = this.camera.toWorld(cx, cy); return [w.x, w.y]; }
  private act(cx: number, cy: number) { this.actionAt = { x: cx, y: cy, t: performance.now() }; }

  /** Small inline message near a client point. */
  toast(text: string, cx: number, cy: number, tone: 'bad' | 'info' = 'bad') {
    const T = this.T;
    const [sx, sy] = this.canvasXY(cx, cy);
    const c = new Container();
    const t = new Text({ text, style: { fontFamily: MONO, fontSize: 13, fontWeight: '600', fill: T.dark ? '#f2f6ff' : '#14203a', wordWrap: true, wordWrapWidth: 250 }, resolution: 2 });
    t.position.set(10, 7);
    const bg = new Graphics();
    box(bg, 0, 0, t.width + 20, t.height + 14, 8, { fill: T.dark ? '#0b1226' : '#ffffff', fa: 0.96, stroke: tone === 'bad' ? T.bad : T.alu, lw: 2 });
    c.addChild(bg, t);
    const w = t.width + 20, h = t.height + 14;
    const x = clamp(sx - w / 2, 8, Math.max(8, this.camera.w - w - 8)), y = clamp(sy - h - 26, 8, Math.max(8, this.camera.h - h - 8));
    c.position.set(x, y);
    this.toasts.push({ c, t0: performance.now(), x, y });
    while (this.toasts.length > 3) this.toasts.shift()!.c.destroy({ children: true });
    this.hud.addChild(c);
  }

  // ------------------------------------------------------------------ hover and click

  setHover(id: string | null) {
    this.hoverId = id && this.scene.interactive.has(id) && !this.drag ? id : null;
    this.updateCursor();
  }

  private isDraggable(id: string | null) {
    return !!id && (id.startsWith('key:') || (id.startsWith('cable.') && this.plugHit(id)));
  }
  private plugHit(id: string) { return this.scene.cables.has(id.slice(6) as CableKind); }

  private updateCursor() {
    this.canvas.style.cursor = this.drag ? 'grabbing' : this.hoverId ? (this.isDraggable(this.hoverId) ? 'grab' : 'pointer') : '';
  }

  /** A click (no drag) on `id`, or on nothing. Writes `selected` and triggers the quick actions. */
  click(id: string | null, cx = 0, cy = 0) {
    selected.value = id;
    if (!id) return;
    const s = this.snap();
    if (!s) return;
    this.act(cx, cy);
    if (id === 'power') {
      if (!s.powered && s.noPowerReason) this.toast(s.noPowerReason, cx, cy);
      powerButton();
    } else if (id.startsWith('key:')) {
      const keyId = Number(id.slice(4));
      if (s.plugged?.id === keyId) this.tryEject(cx, cy); else this.tryPlug(keyId, cx, cy);
    }
  }

  private tryPlug(keyId: number, cx: number, cy: number): boolean {
    const s = this.snap();
    if (!s) return false;
    if (s.plugged) { this.toast('A key is already in the USB port. Remove it first.', cx, cy); return false; }
    this.act(cx, cy);
    plugKey(keyId);
    return true;
  }

  private ejectBlocked(s: Snapshot): string | null {
    return NO_EJECT.has(s.phase) ? 'The job is still running. Wait for REMOVE KEY on the monitor.' : null;
  }

  private tryEject(cx: number, cy: number): boolean {
    const s = this.snap();
    if (!s || !s.plugged) return false;
    const why = this.ejectBlocked(s);
    if (why) { this.toast(why, cx, cy); return false; }
    this.act(cx, cy);
    ejectKey();
    return true;
  }

  // ------------------------------------------------------------------ grabbing

  private grabAt(cx: number, cy: number, _e: PointerEvent): Grab | null {
    // edge arrows (screen space) fly to their target
    const [sx, sy] = this.canvasXY(cx, cy);
    for (const e of this.edge) if (Math.hypot(sx - e.x, sy - e.y) < 22) { const id = e.id; return { move() {}, up: (_x, _y, _ev, c) => { if (!c) this.flyToId(id); } }; }
    const s = this.snap();
    if (!s) return null;
    const [wx, wy] = this.world(cx, cy);
    const id = this.hitAt(cx, cy);
    if (!id) return null;
    // a plug (not the sleeve) of a cable
    if (id.startsWith('cable.')) {
      const ci = this.scene.cables.get(id.slice(6) as CableKind);
      if (!ci || ci.state === 'held' || !inside(ci.plug, wx, wy, 30)) return null;
      return this.pending(cx, cy, id, () => this.beginCable(ci, cx, cy));
    }
    if (id.startsWith('key:')) return this.pending(cx, cy, id, () => this.beginKey(Number(id.slice(4)), cx, cy));
    return null;
  }

  /** Common drag gesture: a press that moves less than DRAG_PX is a click. */
  private pending(cx0: number, cy0: number, id: string, begin: () => boolean): Grab {
    let started = false, refused = false;
    return {
      move: (cx, cy) => {
        if (!started && !refused && Math.hypot(cx - cx0, cy - cy0) > DRAG_PX) { started = begin(); refused = !started; }
        if (started) this.dragMove(cx, cy);
      },
      up: (cx, cy, _e, cancelled) => {
        if (started) this.dragEnd(cx, cy, cancelled);
        else if (!cancelled && !refused) this.click(id, cx, cy);
      },
    };
  }

  // ------------------------------------------------------------------ drag begin

  private start(kind: 'part' | 'cable' | 'key', id: string, cx: number, cy: number) {
    const [wx, wy] = this.world(cx, cy);
    this.drag = { kind, id, cx, cy, wx, wy };
    dragging.value = { kind, id };
    hover.value = null;
    this.hoverId = null;
    this.updateCursor();
    return this.drag;
  }

  private beginPart(invId: string, cx: number, cy: number): boolean {
    const s = this.snap();
    const it = s?.inventory.find((x) => x.id === invId);
    if (!s || !it) return false;
    const d = this.start('part', invId, cx, cy);
    d.validFree = new Set(it.freeSlots); d.validSwap = new Set(it.swapSlots);
    d.why = s.powered ? 'Power the machine off first' : it.installable ? null : (it.reason ?? 'Nowhere to put this right now');
    this.setGhost(partIcon(this.T, it.kind, it.spec), 1);
    d.home = [d.wx, d.wy];
    return true;
  }

  private beginKey(keyId: number, cx: number, cy: number): boolean {
    const s = this.snap();
    if (!s) return false;
    const fromPlugged = s.plugged?.id === keyId;
    const k = fromPlugged ? s.plugged : (s.tray.find((x) => x.id === keyId) ?? s.held?.find((x) => x.id === keyId));
    if (!k) return false;
    if (fromPlugged) {
      const why = this.ejectBlocked(s);
      if (why) { this.toast(why, cx, cy); return false; }
    }
    const d = this.start('key', 'key:' + keyId, cx, cy);
    d.fromPlugged = fromPlugged; d.keyId = keyId;
    d.why = !fromPlugged && s.plugged ? 'A key is already in the USB port' : null;
    this.setGhost(keyStick(this.T, k, fromPlugged), 2);
    this.setDim('key:' + keyId, true);
    return true;
  }

  private beginCable(ci: CableInfo, cx: number, cy: number): boolean {
    const s = this.snap();
    if (!s) return false;
    if (s.powered) { this.toast('Power the machine off first: cables only change while it is off.', cx, cy); return false; }
    const d = this.start('cable', 'cable.' + ci.kind, cx, cy);
    d.cable = ci;
    if (ci.state === 'connected') {
      this.act(cx, cy);
      disconnectCable(ci.kind);
      this.forced.set(ci.kind, { connected: false, until: performance.now() + 1500 });
    }
    this.onHeld(ci.kind);
    this.buildPlugGhost(ci);
    return true;
  }

  private setGhost(c: Container, _kind: number) {
    this.ghost.removeChildren().forEach((x) => x.destroy({ children: true }));
    this.ghost.addChild(c);
    this.ghost.alpha = 0.92;
    this.ghost.visible = true;
  }

  private buildPlugGhost(ci: CableInfo) {
    const g = new Graphics();
    const p = movablePlug(ci.cable);
    // a plug at the origin whose pin face is at x = 0 and whose body trails to +x (the cable leaves at +x)
    const plug: Plug = { x: 0, y: 0, dx: 1, dy: 0, w: ci.loose.plug.w, l: ci.loose.plug.l, pins: p.pins };
    drawPlug(g, this.T, plug, ACCENT(this.T, ci.kind), true);
    this.ghost.removeChildren().forEach((x) => x.destroy({ children: true }));
    this.ghost.addChild(g);
    this.ghost.alpha = 1;
    this.ghost.visible = true;
  }

  private setDim(id: string, on: boolean) {
    const o = this.scene.props.get(id);
    if (o) o.node.alpha = on ? 0.28 : 1;
  }

  // ------------------------------------------------------------------ drag move / end

  private dragMove(cx: number, cy: number) {
    const d = this.drag;
    if (!d) return;
    d.cx = cx; d.cy = cy;
    [d.wx, d.wy] = this.world(cx, cy);
    if (d.kind === 'part') d.over = this.slotAt(d.wx, d.wy, d);
    if (d.kind === 'cable' && d.cable) {
      d.snapped = inside(d.cable.connector, d.wx, d.wy, d.cable.kind === 'video' ? 160 : 260);
    }
  }

  /** The valid slot under the world point, or null. */
  private slotAt(wx: number, wy: number, d: NonNullable<Interact['drag']>): string | null {
    for (const id of [...(d.validFree ?? []), ...(d.validSwap ?? [])]) {
      const r = id === 'board' ? BD : this.scene.slots.get(id);
      if (r && inside(r, wx, wy, 40)) return id;
    }
    return null;
  }

  private anySlotAt(wx: number, wy: number): string | null {
    for (const [id, r] of this.scene.slots) if (inside(r, wx, wy, 40)) return id;
    return null;
  }

  private dragEnd(cx: number, cy: number, cancelled: boolean) {
    const d = this.drag;
    if (!d) return;
    this.dragMove(cx, cy);
    const s = this.snap();
    this.drag = null;
    dragging.value = null;
    this.ghost.visible = false;
    const gx = d.wx, gy = d.wy;
    const flash = (to: 'fade' | 'return', tx: number, ty: number) => {
      // detach the ghost's content into a short-lived animation
      const kids = this.ghost.removeChildren();
      const c = new Container(); c.scale.copyFrom(this.ghost.scale); c.position.set(gx, gy); c.rotation = this.ghost.rotation;
      for (const k of kids) c.addChild(k);
      this.fx.addChild(c);
      this.back.push({ c, fx: gx, fy: gy, tx, ty, t0: performance.now(), to });
    };
    if (d.kind === 'part') {
      const it = s?.inventory.find((x) => x.id === d.id);
      if (!cancelled && s && it && d.over && !d.why) {
        const r = d.over === 'board' ? BD : this.scene.slots.get(d.over)!;
        this.act(cx, cy);
        install(it.id, d.over === 'board' ? undefined : d.over);
        flash('fade', r.x + r.w / 2, r.y + r.h / 2);
      } else {
        if (!cancelled && s && it) {
          const slot = this.anySlotAt(d.wx, d.wy);
          if (d.why) { if (slot || inside(BD, d.wx, d.wy)) this.toast(d.why, cx, cy); }
          else if (slot && it.kind === 'os') this.toast('An OS goes onto an installed drive. Install a drive first, then drop the OS on it.', cx, cy);
          else if (slot) this.toast(`${it.name} does not fit the ${slot.replace(/\d+$/, '')} socket.`, cx, cy);
        }
        flash('return', d.home ? d.home[0] : gx, d.home ? d.home[1] : gy);
      }
    } else if (d.kind === 'key') {
      this.setDim(d.id, false);
      const o = this.scene.props.get(d.id);
      const overPort = inside(this.scene.usb, d.wx, d.wy, 170);
      if (!cancelled && !d.fromPlugged && overPort && !d.why) { this.act(cx, cy); plugKey(d.keyId!); flash('fade', this.scene.usb.x + 60, this.scene.usb.y + this.scene.usb.h / 2); }
      else if (!cancelled && d.fromPlugged && !overPort) { this.act(cx, cy); ejectKey(); flash('fade', gx, gy); }
      else {
        if (!cancelled && !d.fromPlugged && overPort && d.why) this.toast(d.why, cx, cy);
        flash('return', o ? o.base.x : gx, o ? o.base.y : gy);
      }
    } else if (d.kind === 'cable' && d.cable) {
      const ci = d.cable;
      this.ghost.removeChildren().forEach((x) => x.destroy({ children: true }));
      if (!cancelled && d.snapped) {
        this.act(cx, cy);
        connectCable(ci.kind);
        this.forced.set(ci.kind, { connected: true, until: performance.now() + 1500 });
      } else if (!cancelled) {
        // dropped near the wrong socket?
        for (const o of this.scene.cables.values()) if (o.kind !== ci.kind && inside(o.connector, d.wx, d.wy, 200)) { this.toast('That plug does not fit this socket.', cx, cy); break; }
      }
      this.onHeld(null);
    }
    this.updateCursor();
  }

  // ------------------------------------------------------------------ highlight geometry

  rectsFor(id: string): Rect[] {
    if (id.startsWith('cable.')) {
      const ci = this.scene.cables.get(id.slice(6) as CableKind);
      if (!ci) return [];
      return ci.state === 'connected' ? [ci.plug] : [ci.plug, ci.connector];
    }
    const r = this.scene.rects.get(id);
    return r ? [r] : [];
  }

  flyToId(id: string, opts: FlyOpts = {}) {
    const rs = this.rectsFor(id);
    if (rs.length) this.flyToRects(rs, opts);
    else opts.onDone?.(false);
  }

  // ------------------------------------------------------------------ per frame

  /** `now` is wall time (hover, drag, toasts); `gt` is game time (rings showing machine state, frozen when paused). */
  frame(now: number, dt: number, gt = now) {
    const T = this.T, cam = this.camera, z = cam.z;
    const g = this.g;
    g.clear();
    const lw = clamp(3.5 / z, 5, 70);
    const s = this.snap();

    // ---- hover amounts (lift, scale, outline) ----
    const k = 1 - Math.exp(-dt * 14);
    const ids = new Set<string>([...this.amt.keys()]);
    if (this.hoverId) ids.add(this.hoverId);
    for (const id of ids) {
      const target = id === this.hoverId ? 1 : 0;
      let a = this.amt.get(id) ?? 0;
      a += (target - a) * k;
      if (Math.abs(target - a) < 0.01) a = target;
      if (a === 0) this.amt.delete(id); else this.amt.set(id, a);
      const o = this.scene.props.get(id);
      if (o) { o.node.position.set(o.base.x, o.base.y - 22 * a); o.node.scale.set(o.base.s * (1 + 0.07 * a)); }
      if (a > 0) {
        const r = this.scene.rects.get(id) ?? o?.rect;
        if (r) {
          const e = 8 + 16 * a, rr = Math.min(60, 20 + e);
          box(g, r.x - e, r.y - e - (o ? 22 * a : 0), r.w + 2 * e, r.h + 2 * e, rr, { stroke: T.alu, lw: lw * 2.6, sa: 0.16 * a });
          box(g, r.x - e, r.y - e - (o ? 22 * a : 0), r.w + 2 * e, r.h + 2 * e, rr, { stroke: T.alu, lw, sa: 0.9 * a });
        }
      }
    }

    // ---- drag visuals ----
    const d = this.drag;
    this.noteText.visible = false;
    this.noteBg.clear();
    this.noteSet = false;
    if (d && s) this.drawDrag(d, now, lw, s);

    // ---- return / fade animations ----
    for (let i = this.back.length - 1; i >= 0; i--) {
      const b = this.back[i]!;
      const t = Math.min(1, (now - b.t0) / (b.to === 'fade' ? 220 : 240)), e = 1 - Math.pow(1 - t, 3);
      if (b.to === 'return') { b.c.position.set(b.fx + (b.tx - b.fx) * e, b.fy + (b.ty - b.fy) * e); b.c.alpha = 1 - t * t; }
      else { b.c.position.set(b.fx + (b.tx - b.fx) * e, b.fy + (b.ty - b.fy) * e); b.c.alpha = 1 - t; b.c.scale.set(b.c.scale.x * (1 - 0.04)); }
      if (t >= 1) { b.c.destroy({ children: true }); this.back.splice(i, 1); }
    }

    // ---- the machine is waiting for the player to pull the key ----
    if (s && !d) {
      const ringKeys: Snapshot['tray'] = [];
      if (s.phase === 'done-remove-key' && s.plugged) ringKeys.push(s.plugged);
      if (s.plugged && s.keyActivity === 'done') ringKeys.push(s.plugged);
      for (const k of s.held ?? []) if (k.stage === 'result') ringKeys.push(k);
      for (const k of ringKeys) {
        const o = this.scene.props.get('key:' + k.id);
        if (!o) continue;
        const beat = 0.5 + 0.5 * Math.sin(gt * 0.006), r = o.rect, e = 16 + 14 * beat;
        box(g, r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, 50, { stroke: T.st, lw: lw * 1.8, sa: 0.5 + 0.5 * beat });
        box(g, r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, 50, { fill: T.st, fa: 0.08 * beat });
      }
    }

    // ---- tutorial highlights ----
    this.drawHighlights(now, lw);

    // ---- toasts ----
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i]!, age = now - t.t0;
      t.c.alpha = age > 2300 ? Math.max(0, 1 - (age - 2300) / 400) : Math.min(1, age / 120);
      t.c.position.y = t.y - Math.min(10, age * 0.03);
      if (age > 2700) { t.c.destroy({ children: true }); this.toasts.splice(i, 1); }
    }

    // ---- optimistic cable state expires ----
    void s;
  }

  private drawDrag(d: NonNullable<Interact['drag']>, now: number, lw: number, s: Snapshot) {
    const T = this.T, g = this.g, z = this.camera.z;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
    if (d.kind === 'part') {
      const ok = !d.why;
      for (const [id, r] of [...this.scene.slots, ['board', BD] as [string, Rect]]) {
        if (id === 'board' && !d.validFree?.has('board')) continue;
        const free = d.validFree?.has(id), swap = d.validSwap?.has(id);
        const valid = ok && (free || swap);
        const col = free ? T.st : T.ld;
        if (valid) {
          const over = d.over === id;
          const e = 12 + 12 * pulse + (over ? 14 : 0);
          box(g, r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, 40, { fill: col, fa: over ? 0.28 : 0.07 + 0.08 * pulse, stroke: col, lw: lw * (over ? 2.2 : 1.6), sa: over ? 1 : 0.55 + 0.4 * pulse });
        } else if (id !== 'board') {
          box(g, r.x, r.y, r.w, r.h, 30, { fill: T.bg, fa: ok ? 0.55 : 0.28 });
        }
      }
      // ghost follows the pointer at a steady on-screen size; over a target it settles on the socket
      const sc = clamp(120 / (ICON * z), 0.35, 4);
      const tgt = d.over && d.over !== 'board' ? this.scene.slots.get(d.over) : null;
      this.ghost.position.set(tgt ? tgt.x + tgt.w / 2 : d.wx, tgt ? tgt.y + tgt.h / 2 : d.wy);
      this.ghost.scale.set(tgt ? Math.min(sc, Math.min(tgt.w, tgt.h) / ICON * 0.9 + 0.2) : sc);
      this.ghost.rotation = 0;
      this.ghost.alpha = ok ? 0.92 : 0.5;
      if (d.why) this.note(d.why, d.cx, d.cy, T.bad);
    } else if (d.kind === 'key') {
      const sc = clamp(300 / (KEY_LEN * z), 1, 3), half = d.fromPlugged ? KEY_LEN_PLUGGED / 2 : KEY_LEN / 2;
      const over = inside(this.scene.usb, d.wx, d.wy, 170);
      if (!d.fromPlugged) {
        const r = this.scene.usb;
        const e = 14 + 12 * pulse;
        const free = !s.plugged;
        box(g, r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, 24, { fill: free ? T.st : T.bad, fa: over ? 0.3 : 0.08 + 0.07 * pulse, stroke: free ? T.st : T.bad, lw: lw * 1.8, sa: over ? 1 : 0.5 + 0.4 * pulse });
        if (d.why) this.note(d.why, d.cx, d.cy, T.bad);
        else if (!over) this.note('Drop on the USB port', d.cx, d.cy, T.mute);
      } else {
        this.note(over ? 'Let go to keep it plugged' : 'Release to pull the key out', d.cx, d.cy, T.mute);
      }
      // the stick follows the pointer, centred a little ahead of it; seats into the port when over it
      if (!d.fromPlugged && over && !d.why) {
        // seats compactly, like the plugged key
        this.ghost.position.set(this.scene.usb.x + 190 - KEY_LEN * 0.5 * 0.51, this.scene.usb.y + this.scene.usb.h / 2);
        this.ghost.scale.set(0.51);
      } else {
        // the pointer holds the plug end
        this.ghost.position.set(d.wx - (half - 40) * sc, d.wy);
        this.ghost.scale.set(sc);
      }
      this.ghost.rotation = 0;
    } else if (d.kind === 'cable' && d.cable) {
      const ci = d.cable, cab = ci.cable, accent = ACCENT(T, ci.kind);
      // matching connector pulses
      const r = ci.connector, e = 14 + 14 * pulse + (d.snapped ? 14 : 0);
      box(g, r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, 30, { fill: accent, fa: d.snapped ? 0.3 : 0.08 + 0.08 * pulse, stroke: accent, lw: lw * (d.snapped ? 2.2 : 1.6), sa: d.snapped ? 1 : 0.55 + 0.4 * pulse });
      // pose of the plug: the pin face at the pointer, body trailing back along the cable; snapped, it sits in the socket
      const lo = ci.loose, l = lo.plug.l;
      const seated = movablePlug(cab);
      let tip: Pt = [d.wx, d.wy], ang: number;
      if (d.snapped) { tip = [seated.x, seated.y]; ang = seated.dx > 0 ? 0 : Math.PI; }
      else {
        const pre = rubberBand(lo.anchor, lo.anchorDir, tip);
        const a = pre[pre.length - 3]!, b = pre[pre.length - 1]!;
        ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
      }
      const end: Pt = [tip[0] + Math.cos(ang) * l, tip[1] + Math.sin(ang) * l];
      const pts = rubberBand(lo.anchor, lo.anchorDir, end);
      const w = cab.w * (ci.kind === 'video' ? 1 : 0.62);
      const sleeve = T.dark ? '#171d29' : '#2a313d';
      const line = (list: Pt[], dx = 0, dy = 0) => { g.moveTo(list[0]![0] + dx, list[0]![1] + dy); for (let i = 1; i < list.length; i++) g.lineTo(list[i]![0] + dx, list[i]![1] + dy); };
      line(pts, 8, 12); g.stroke({ width: w + 6, color: '#000000', alpha: 0.28, cap: 'round', join: 'round' });
      line(pts); g.stroke({ width: w, color: sleeve, cap: 'round', join: 'round' });
      line(pts); g.stroke({ width: w, color: accent, alpha: 0.16, cap: 'round', join: 'round' });
      // the fixed plug at the PSU socket / monitor port
      const fixed: Plug = ci.kind === 'video' ? cab.b : cab.a;
      drawPlug(g, T, fixed, accent, ci.kind === 'video');
      this.ghost.position.set(tip[0], tip[1]);
      this.ghost.rotation = ang;
      this.ghost.scale.set(1);
      if (!d.snapped) this.note('Drag the plug to the glowing socket', d.cx, d.cy, T.mute);
    }
    this.noteText.visible = this.noteSet && !!d;
  }

  /** A one-line hint following the pointer while dragging (screen space). */
  private note(text: string, cx: number, cy: number, color: string) {
    const [sx, sy] = this.canvasXY(cx, cy);
    const t = this.noteText;
    if (t.text !== text) t.text = text;
    t.style.fill = color === this.T.mute ? (this.T.dark ? '#cfd8f5' : '#26324f') : color;
    t.anchor.set(0, 0);
    t.position.set(clamp(sx + 24, 14, Math.max(14, this.camera.w - t.width - 14)), clamp(sy + 28, 12, Math.max(12, this.camera.h - t.height - 14)));
    t.visible = true;
    this.noteSet = true;
    this.noteBg.clear();
    box(this.noteBg, t.x - 8, t.y - 5, t.width + 16, t.height + 10, 7, { fill: this.T.dark ? '#0b1226' : '#ffffff', fa: 0.92, stroke: color === this.T.bad ? this.T.bad : this.T.line, lw: 1.5 });
  }

  // ------------------------------------------------------------------ tutorial highlight rings and edge arrows

  private drawHighlights(now: number, lw: number) {
    const T = this.T, g = this.g, hg = this.hg, cam = this.camera, z = cam.z;
    hg.clear();
    this.edge = [];
    const ids = highlight.peek();
    if (!ids.length) return;
    const ph = (now % 1400) / 1400, beat = 0.5 + 0.5 * Math.sin(ph * Math.PI * 2);
    const col = T.ld;
    const left = cam.inset.left + 36, right = cam.w - cam.inset.right - 36, top = cam.inset.top + 36, bottom = cam.h - cam.inset.bottom - 36;
    for (const id of ids) {
      const rs = this.rectsFor(id);
      if (!rs.length) continue;
      let anyVisible = false;
      for (const r of rs) {
        const e = 14 + 10 * beat;
        box(g, r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, 36 + e, { stroke: col, lw: lw * 1.7, sa: 0.55 + 0.45 * beat });
        const e2 = 14 + ph * 90;
        box(g, r.x - e2, r.y - e2, r.w + 2 * e2, r.h + 2 * e2, 36 + e2, { stroke: col, lw: lw, sa: 0.55 * (1 - ph) });
        // arrow above the target, steady size on screen, bobbing
        const as = clamp(26 / z, 40, 400), bob = 8 * beat * as / 40;
        const cx = r.x + r.w / 2, ty = r.y - e - as * 0.4 - bob;
        g.poly([cx - as * 0.62, ty - as * 1.2, cx + as * 0.62, ty - as * 1.2, cx, ty]).fill({ color: col, alpha: 0.95 }).stroke({ width: lw * 0.6, color: T.dark ? '#000000' : '#ffffff', alpha: 0.6 });
        const sx = cam.cx + (cx - cam.x) * z, sy = cam.cy + (r.y + r.h / 2 - cam.y) * z;
        if (sx > cam.inset.left && sx < cam.w - cam.inset.right && sy > cam.inset.top && sy < cam.h - cam.inset.bottom) anyVisible = true;
      }
      if (!anyVisible) {
        const r = rs[0]!, [cxw, cyw] = centre(r);
        const sx = cam.cx + (cxw - cam.x) * z, sy = cam.cy + (cyw - cam.y) * z;
        const fx = cam.cx, fy = cam.cy;
        const dx = sx - fx, dy = sy - fy;
        const kx = dx === 0 ? Infinity : (dx > 0 ? right - fx : left - fx) / dx, ky = dy === 0 ? Infinity : (dy > 0 ? bottom - fy : top - fy) / dy;
        const kk = Math.min(Math.abs(kx), Math.abs(ky));
        const px = fx + dx * kk, py = fy + dy * kk, a = Math.atan2(dy, dx);
        const R = 19 + 3 * beat;
        hg.circle(px, py, R + 7).fill({ color: col, alpha: 0.18 + 0.15 * beat });
        hg.circle(px, py, R).fill({ color: T.dark ? '#0b1226' : '#ffffff', alpha: 0.95 }).stroke({ width: 2.5, color: col });
        const ca = Math.cos(a), sa = Math.sin(a);
        hg.poly([px + ca * 15, py + sa * 15, px - ca * 8 - sa * 11, py - sa * 8 + ca * 11, px - ca * 3, py - sa * 3, px - ca * 8 + sa * 11, py - sa * 8 - ca * 11]).fill({ color: col });
        this.edge.push({ id, x: px, y: py });
      }
    }
  }

  /** Style a key for an optimistic or settled cable state. */
  cableStateOf(kind: CableKind, snapConnected: boolean, now: number): boolean {
    const f = this.forced.get(kind);
    if (f) {
      if (now > f.until || f.connected === snapConnected) this.forced.delete(kind);
      else return f.connected;
    }
    return snapConnected;
  }

  /** Cursor-independent mix helper kept for colour tinting of the dim veil. */
  static tint(a: string, b: string, t: number) { return mix(a, b, t); }
}
