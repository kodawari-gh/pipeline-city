// Holding a cable's plug in 3D (docs/GRAPHICS_3D_OVERHAUL.md "Cables"): the plug rides over what is under the pointer on a spring and its strands
// swing from their grommet as live ropes (rope.ts `Rope`) of the length they have seated. Near its socket it squares up; inside the snap zone it
// lines up in front of the mouth, and let go there it slides in and clicks. A seated plug pulls out against its latch and pops free; one let go
// away from its socket falls on its cable and stays where it lands. Machine3D builds the cable from its rig (cablerig3d.ts); the hand holds it
// while the player does, then hands it back.
import { Group, Mesh, Plane, Quaternion, Raycaster, Vector2, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { connectCable, disconnectCable } from '@/app/store';
import { disposeTree, place } from '@/core/render/three/geometry';
import { findById, seeThrough } from '@/core/render/three/pick';
import { Rope, lengthOf, type Plane as RopePlane, type RopeEnd, type Solid, type V3 } from '@/core/render/three/rope';
import { Sleeve } from '@/core/render/three/sleeve';
import type { Snapshot } from '@/worker/protocol';
import { samplesFor, sleeveMat } from './cables3d';
import { exitAt, freedom, looseAt, looseState, middle, pivotOf, resample, setPose, spineEnv, spineLength, withinCable, type CableRig, type Pose, type Rest } from './cablerig3d';
import type { Machine3D } from './machine3d';

/** The spring that carries the plug to the pointer (per second, critically damped). */
export const OMEGA = 25;
/** Screen distances (px) from the point in front of the socket: the plug squares up from FAR_PX in, and snaps inside SNAP_PX. */
export const SNAP_PX = 70, FAR_PX = 260;
/** Pointer travel (px) that pops a seated plug free. */
export const POP_PX = 90;
/** Seconds: the slide in (at the least), the click, a slide back, the hand-over to the built cable, the wait for the sim to take the plug. */
const INSERT_S = 0.18, CLICK_S = 0.05, RESEAT_S = 0.12, BLEND_S = 0.3, CONFIRM_S = 1.5, FALL_MAX_S = 3;
/** Rope steps per frame. */
const STEPS = 4;
/** How far a held plug keeps off the parts and the walls (about half a plug), and the share of its cable's reach it may go out to (the rest is
 *  slack: a cable pulled taut over an edge shakes; at its socket it may use all of it). */
const CLEAR = 80, REACH = 0.92;

// ------------------------------------------------------------------ the motion (pure)
/** One step of a critically damped spring toward `goal`, exact for any dt: the new value and velocity. */
export function springStep(x: number, v: number, goal: number, w: number, dt: number): [number, number] {
  const e = x - goal, k = v + w * e, d = Math.exp(-w * dt);
  return [goal + (e + k * dt) * d, (v - w * k * dt) * d];
}

/** How long a plug takes to slide in over `engage` units: longer for a long run (a mains plug fed through the desk). */
export const insertTime = (engage: number): number => Math.min(0.4, INSERT_S * Math.max(1, engage / 300));

/** How far out of its socket a plug sliding in is at `t` (its engage's share, 1 to 0, speeding into the latch), then the click's nudge past 0. */
export function insertOffset(t: number, dur = INSERT_S): number {
  if (t < dur) { const u = t / dur; return 1 - u * u; }
  return -0.06 * Math.sin(Math.PI * Math.min(1, (t - dur) / CLICK_S));
}

/** A seated plug pulled `travel` px: how far it has come out (its engage's share: slowly, against the latch) and whether it has popped free. */
export function pullOffset(travel: number): { out: number; popped: boolean } {
  const u = Math.min(1, Math.max(0, travel) / POP_PX);
  return { out: 0.55 * u * u, popped: travel >= POP_PX };
}

/** How square to its socket a held plug turns: 0 farther than FAR_PX on screen, 1 inside SNAP_PX. */
export function snapWeight(px: number): number {
  const u = Math.min(1, Math.max(0, (FAR_PX - px) / (FAR_PX - SNAP_PX)));
  return u * u * (3 - 2 * u);
}

/**
 * Where a held plug rides under the pointer: `m` off the first face the ray `o + t·d` (`d` a unit vector) meets past the glass, a part's or a
 * floor's (a wall that faces `up`, as the deck does), back along the ray (`m` over the cosine to the face, so it keeps `m` off a slanted face
 * too). The walls round the sides do not stop it (`keepClear` brings it back inside them at its depth), nor a part it is already in where it
 * comes in. Null when the ray never comes in, or meets nothing.
 */
export function hover(o: V3, d: V3, env: { planes?: readonly RopePlane[]; solids?: readonly Solid[] }, m: number, up: V3): V3 | null {
  let tin = 0, hit = Infinity, cos = 1;
  for (const pl of env.planes ?? []) {
    const s = o[0] * pl.n[0] + o[1] * pl.n[1] + o[2] * pl.n[2] - pl.d, c = d[0] * pl.n[0] + d[1] * pl.n[1] + d[2] * pl.n[2];
    if (s < 0) { if (c <= 0) return null; tin = Math.max(tin, -s / c); }
    else if (c < 0 && pl.n[0] * up[0] + pl.n[1] * up[1] + pl.n[2] * up[2] > 0.5 && s / -c < hit) { hit = s / -c; cos = -c; }
  }
  if (hit <= tin) return null;
  for (const b of env.solids ?? []) {
    let t0 = -Infinity, t1 = Infinity, axis = 0;
    for (let j = 0; j < 3 && t0 <= t1; j++) {
      if (Math.abs(d[j]!) < 1e-9) { if (o[j]! < b.min[j]! || o[j]! > b.max[j]!) t0 = Infinity; continue; }
      const u = (b.min[j]! - o[j]!) / d[j]!, v = (b.max[j]! - o[j]!) / d[j]!;
      if (Math.min(u, v) > t0) { t0 = Math.min(u, v); axis = j; }
      t1 = Math.min(t1, Math.max(u, v));
    }
    if (t0 <= t1 && t0 >= tin && t0 < hit) { hit = t0; cos = Math.abs(d[axis]!); }
  }
  if (!Number.isFinite(hit)) return null;
  const t = Math.max(tin, hit - m / Math.max(cos, 0.35));
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}

/**
 * `p` kept `m` clear of the walls and out of the parts (both grown by `m`): over a part (toward the glass, +z) when that is inside the walls, else
 * out by the nearest side across the view (the shroud, which runs to the glass, puts it on its top).
 */
export function keepClear(p: V3, env: { planes?: readonly RopePlane[]; solids?: readonly Solid[] }, m: number): V3 {
  const q: V3 = [...p], planes = env.planes ?? [];
  const inside = (x: V3) => planes.every((pl) => x[0] * pl.n[0] + x[1] * pl.n[1] + x[2] * pl.n[2] - pl.d >= m);
  // a few rounds: a part it is lifted over may stand in another
  for (let round = 0; round < 4; round++) {
    let moved = false;
    for (const s of env.solids ?? []) {
      if (![0, 1, 2].every((j) => q[j]! > s.min[j]! - m && q[j]! < s.max[j]! + m)) continue;
      moved = true;
      if (inside([q[0], q[1], s.max[2] + m])) { q[2] = s.max[2] + m; continue; }
      let best = 0, gap = Infinity, to = 0;
      for (const j of [0, 1]) {
        const lo = s.min[j]! - m, hi = s.max[j]! + m;
        if (q[j]! - lo < gap) { gap = q[j]! - lo; best = j; to = lo; }
        if (hi - q[j]! < gap) { gap = hi - q[j]!; best = j; to = hi; }
      }
      q[best] = to;
    }
    if (!moved) break;
  }
  for (const pl of planes) {
    const e = q[0] * pl.n[0] + q[1] * pl.n[1] + q[2] * pl.n[2] - pl.d - m;
    if (e < 0) for (let j = 0; j < 3; j++) q[j] = q[j]! - pl.n[j]! * e;
  }
  return q;
}

// ------------------------------------------------------------------ the hand
type Phase = 'pull' | 'reseat' | 'held' | 'insert' | 'wait' | 'eject' | 'fall' | 'blend';

interface Live {
  rig: CableRig;
  /** Where the model's strands leave it, in its socket. */
  exits: RopeEnd[];
  pivot: Group;
  sleeve: Sleeve;
  mesh: Mesh;
  ropes: Rope[];
  /** Each strand's length (its seated one: it never changes), and how far the plug may turn from its seated turn (`freedom`). */
  lengths: number[];
  free: number;
  /** What the plug rides over and its spine falls in: the rig's walls and parts, and its deck (`spineEnv`). */
  space: { planes: RopePlane[]; solids: Solid[] };
  pose: Pose;
  vel: Vector3;
  phase: Phase;
  t: number;
  /** A slide's start (its engage's share), and what is left of the spring's way when the slide in began. */
  from: number;
  off: Vector3;
  spine?: Rope;
  blend?: { a: V3[][]; b: V3[][] };
}

export interface HandHost {
  machine(): Machine3D | null;
  snapshot(): Snapshot | null;
  toast(text: string, cx: number, cy: number): void;
}

const V = (p: V3) => new Vector3(p[0], p[1], p[2]);
const T = (v: Vector3): V3 => [v.x, v.y, v.z];
const ID = new Quaternion();

export class PlugHand {
  readonly root = new Group();
  private live: Live | null = null;
  /** The pointer, where it pressed, and the scene id under it (the backdrops too). */
  private px = 0;
  private py = 0;
  private sx = 0;
  private sy = 0;
  private over: string | null = null;
  private snapped = false;
  /** The built cable hidden while the hand holds it. */
  private hidden: Object3D | null = null;
  private readonly ray = new Raycaster();
  private readonly plane = new Plane();

  constructor(private readonly host: HandHost, private readonly canvas: HTMLCanvasElement) {}

  /** The cable held now (also while it slides in, falls or hands back), or null. */
  get kind(): string | null { return this.live?.rig.id ?? null; }

  /** Take hold of a cable's plug (false: it has no rig, as the LAN lead). A seated plug is pulled; a loose one is held at once. */
  grab(kind: string, cx: number, cy: number): boolean {
    this.finish();
    const m = this.host.machine(), rig = m?.rig(kind), s = this.host.snapshot();
    if (!m || !rig || !s) return false;
    const seated = rig.canSeat && !!s.cables.find((c) => c.id === kind)?.connected, model = rig.model();
    model.root.traverse((o) => { seeThrough(o); });
    const home = rig.seated(model.strands), lengths = home.map(lengthOf);
    let start: V3[][], pose: Pose;
    if (seated) { start = home; pose = { at: [...rig.seat.at], q: new Quaternion() }; }
    else { const l = looseState(rig, model.strands, m.rest.get(kind)); start = l.strands; pose = { at: [...l.rest.pose.at], q: l.rest.pose.q.clone() }; }
    const ropes = rig.fixed.map((a, i) => new Rope({ a, b: exitAt(model.strands[i]!, rig.seat, pose), length: lengths[i]!, r: rig.look.r, stiff: rig.stiff, n: rig.n, lead: rig.lead, ...rig.env }, { live: true, start: resample(start[i]!, rig.n) }));
    const sleeve = new Sleeve(ropes.length, rig.look.r, samplesFor(rig.n), rig.look.accent ? 14 : 10);
    const mesh = seeThrough(place(new Mesh(sleeve.geometry, sleeveMat(rig.look.base, rig.look.accent))));
    mesh.userData.live = true;
    sleeve.update(ropes.map((r) => r.points()));
    const pivot = pivotOf(rig.seat, model.root, pose);
    this.root.add(pivot, mesh);
    const space = spineEnv(rig);
    this.live = { rig, exits: model.strands, pivot, sleeve, mesh, ropes, lengths, free: freedom(rig, model.strands, lengths), space, pose, vel: new Vector3(), phase: seated ? 'pull' : 'held', t: 0, from: 0, off: new Vector3() };
    this.px = this.sx = cx; this.py = this.sy = cy; this.over = null; this.snapped = false;
    this.hide(true);
    return true;
  }

  move(cx: number, cy: number, over: string | null): void { this.px = cx; this.py = cy; this.over = over; }

  /** Let go: a plug pulled but not out slides back in; one in the snap zone slides in; any other falls on its cable. */
  release(cx: number, cy: number, cancelled: boolean): void {
    const l = this.live;
    if (!l) return;
    this.px = cx; this.py = cy;
    if (l.phase === 'pull') { l.phase = 'reseat'; l.t = 0; l.from = V(l.pose.at).sub(V(l.rig.seat.at)).dot(V(l.rig.seat.axis)) / l.rig.engage; return; }
    if (l.phase !== 'held') return;
    if (!cancelled && this.snapped) { l.phase = 'insert'; l.t = 0; l.off = V(l.pose.at).sub(this.preSeat(l.rig)); return; }
    if (!cancelled && !l.rig.canSeat) this.host.toast('No card takes this lead: install a graphics card first.', cx, cy);
    this.fall(l);
  }

  /** The text by the pointer, and whether a drop now plugs in. */
  label(): { text: string; ok: boolean } | null {
    const l = this.live;
    if (!l) return null;
    if (l.phase === 'pull') return { text: `Pull it out of ${l.rig.name}`, ok: false };
    if (!l.rig.canSeat) return { text: 'No card takes this lead', ok: false };
    return this.snapped ? { text: `Let go to plug into ${l.rig.name}`, ok: true } : { text: `Plug into ${l.rig.name}`, ok: false };
  }

  /** The ids to outline: what takes the held plug. */
  targets(): string[] {
    const l = this.live;
    return l?.phase === 'held' && l.rig.canSeat && l.rig.target ? [l.rig.target] : [];
  }

  frame(dt: number, cam: PerspectiveCamera): void {
    const l = this.live;
    if (!l) return;
    this.hide(true);
    const rig = l.rig;
    l.t += dt;
    switch (l.phase) {
      case 'pull': {
        const p = pullOffset(Math.hypot(this.px - this.sx, this.py - this.sy));
        if (p.popped) {
          // the loose cable the sim's answer builds (hidden while held) takes the strands as they are, so nothing hangs again
          this.host.machine()?.rest.set(rig.id, this.restOf(l));
          disconnectCable(rig.id); l.phase = 'held'; l.t = 0; this.hold(l, dt, cam);
        }
        else this.slide(l, p.out, 1);
        break;
      }
      case 'reseat': {
        const u = Math.min(1, l.t / RESEAT_S);
        this.slide(l, l.from * (1 - u) * (1 - u), 1);
        if (u >= 1) this.blendTo(l, rig.seated(l.exits));
        break;
      }
      case 'held': this.hold(l, dt, cam); break;
      case 'insert': {
        const dur = insertTime(rig.engage);
        this.slide(l, insertOffset(l.t, dur), Math.max(0, 1 - l.t / dur));
        if (l.t >= dur + CLICK_S) { connectCable(rig.id); l.phase = 'wait'; l.t = 0; }
        break;
      }
      case 'wait': {
        this.slide(l, 0, 0);
        if (this.host.snapshot()?.cables.find((c) => c.id === rig.id)?.connected) { this.host.machine()?.rest.delete(rig.id); this.blendTo(l, rig.seated(l.exits)); }
        else if (l.t > CONFIRM_S) { l.phase = 'eject'; l.t = 0; }
        break;
      }
      case 'eject': {
        const u = Math.min(1, l.t / RESEAT_S);
        this.slide(l, u * (2 - u), 0);
        if (u >= 1) this.fall(l);
        break;
      }
      case 'fall': {
        const sp = l.spine!;
        sp.step(STEPS);
        // the plug turns the least way that lines its cable up with the cable's tip, so it keeps its roll as it falls
        const tip = sp.tip(), m = middle(l.exits), out = V(m.dir).applyQuaternion(l.pose.q);
        const q = new Quaternion().slerp(new Quaternion().setFromUnitVectors(out, V(tip.dir).negate().normalize()).multiply(l.pose.q), l.free);
        l.pose = { at: looseAt(rig, l.exits, l.lengths, { at: T(V(tip.at).sub(V(m.at).sub(V(rig.seat.at)).applyQuaternion(q))), q }), q };
        if (sp.resting || l.t > FALL_MAX_S) {
          // the built cable lies just as the held one does: hand over at once
          setPose(l.pivot, l.pose);
          const mc = this.host.machine();
          if (mc) { mc.rest.set(rig.id, this.restOf(l)); mc.setCable(rig.id); }
          this.finish();
          return;
        }
        break;
      }
      case 'blend': {
        const u = Math.min(1, l.t / BLEND_S), k = u * u * (3 - 2 * u), { a, b } = l.blend!;
        l.sleeve.update(a.map((s, i) => s.map((p, j) => { const q = b[i]![j]!; return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k] as V3; })));
        if (u >= 1) this.finish();
        return;
      }
    }
    // the strands follow the plug
    setPose(l.pivot, l.pose);
    l.ropes.forEach((r, i) => { r.setEnds(rig.fixed[i]!, exitAt(l.exits[i]!, rig.seat, l.pose)); r.step(STEPS); });
    l.sleeve.update(l.ropes.map((r) => r.points()));
  }

  /** The point in front of the socket where a plug lines up before it slides in. */
  private preSeat(rig: CableRig): Vector3 { return V(rig.seat.at).addScaledVector(V(rig.seat.axis), rig.engage); }

  /**
   * Held: the plug on its spring toward the pointer, riding over what is under it (a part, the board, the desk), so it never sinks behind the
   * parts it passes or into the tray however slanted the view. Off the walls it goes on at its height over the deck.
   */
  private hold(l: Live, dt: number, cam: PerspectiveCamera) {
    const rig = l.rig, pre = this.preSeat(rig), r = this.canvas.getBoundingClientRect(), up = V(rig.deck.n);
    this.ray.setFromCamera(new Vector2(((this.px - r.left) / r.width) * 2 - 1, -((this.py - r.top) / r.height) * 2 + 1), cam);
    const on = hover(T(this.ray.ray.origin), T(this.ray.ray.direction), l.space, CLEAR, rig.deck.n);
    const goal = on ? V(on) : this.ray.ray.intersectPlane(this.plane.setFromNormalAndCoplanarPoint(up, V(l.pose.at)), new Vector3()) ?? V(l.pose.at);
    // how near the pointer is to the socket, on screen
    // (the point in front of the mouth, or the mouth itself: a pointer on the socket you see is near it, whichever way the socket faces)
    const far = (q: Vector3) => { const s = q.clone().project(cam); return s.z < 1 ? Math.hypot(this.px - (r.left + ((s.x + 1) / 2) * r.width), this.py - (r.top + ((1 - s.y) / 2) * r.height)) : Infinity; };
    const near = Math.min(far(pre), far(V(rig.seat.at)));
    this.snapped = rig.canSeat && (near <= SNAP_PX || (!!rig.target && this.over === rig.target));
    const w = this.snapped ? 1 : rig.canSeat ? snapWeight(near) : 0;
    // its turn: hanging along its cable (which leaves it along the deck toward its grommet, not down through the board), squared to the socket
    // as it comes near
    const fixed = V(middle(rig.fixed).at), m = middle(l.exits), toward = fixed.clone().sub(V(l.pose.at)).projectOnPlane(up);
    const back = (toward.lengthSq() > 1 ? toward.normalize() : new Vector3(0, -1, 0)).add(new Vector3(0, 0.7, 0)).normalize();
    const turn = new Quaternion().slerp(new Quaternion().setFromUnitVectors(V(m.dir), back), l.free * (1 - w));
    if (this.snapped) goal.copy(pre);
    // it goes only as far as its cable reaches (all of it at the socket, which its seated length reaches), at its height over the deck, and over
    // the parts in its way
    const reach = () => goal.copy(V(withinCable(rig, l.exits, l.lengths, T(goal), turn, this.snapped ? 1 : REACH, rig.deck.n)));
    reach();
    if (!this.snapped) { goal.copy(V(keepClear(T(goal), l.space, CLEAR))); reach(); }
    const p = l.pose.at;
    for (let j = 0; j < 3; j++) { const [x, v] = springStep(p[j]!, l.vel.getComponent(j), goal.getComponent(j), OMEGA, dt); p[j] = x; l.vel.setComponent(j, v); }
    l.pose.q.slerp(turn, 1 - Math.exp(-dt * 14));
  }

  /** On the socket's axis, `out` of its engage from the mouth, square to it; `left` of the spring's way at the slide's start still to close. */
  private slide(l: Live, out: number, left: number) {
    const at = V(l.rig.seat.at).addScaledVector(V(l.rig.seat.axis), l.rig.engage * out).addScaledVector(l.off, left);
    l.pose.at = T(at);
    l.pose.q.slerp(ID, left > 0 ? 0.35 : 1);
    l.vel.set(0, 0, 0);
  }

  /** Let the plug go: its cable's middle strand becomes a spine with a free end, the plug hangs at its tip. */
  private fall(l: Live) {
    const rig = l.rig, pts = l.ropes.map((r) => r.points()), n = rig.n;
    const mean = Array.from({ length: n }, (_, j) => pts.reduce((s, p) => [s[0] + p[j]![0] / pts.length, s[1] + p[j]![1] / pts.length, s[2] + p[j]![2] / pts.length] as V3, [0, 0, 0] as V3));
    l.spine = new Rope({ a: middle(rig.fixed), b: null, length: spineLength(rig, l.exits, l.lengths), r: rig.look.r, stiff: rig.stiff, n, lead: rig.lead, ...l.space }, { live: true, start: mean });
    l.phase = 'fall';
    l.t = 0;
    l.vel.set(0, 0, 0);
  }

  /** The plug's place and its strands as they are now. */
  private restOf(l: Live): Rest {
    return { pose: { at: [...l.pose.at], q: l.pose.q.clone() }, strands: l.ropes.map((r) => r.points()) };
  }

  /** Ease the strands from where they are to the cable Machine3D builds, then hand over to it. */
  private blendTo(l: Live, to: V3[][]) {
    setPose(l.pivot, l.pose);
    l.blend = { a: l.ropes.map((r) => r.points()), b: to.map((s) => resample(s, l.rig.n)) };
    l.phase = 'blend';
    l.t = 0;
  }

  /** Hand the cable back to the built one. */
  private finish() {
    const l = this.live;
    if (!l) return;
    this.hide(false);
    this.live = null;
    this.hidden = null;
    this.root.remove(l.pivot, l.mesh);
    disposeTree(l.pivot);
    disposeTree(l.mesh);
  }

  /** Hide the built cable while the hand holds it (it may be built again meanwhile: a plug in or out), or show it again. */
  private hide(hide: boolean) {
    const m = this.host.machine(), l = this.live;
    if (!m || !l) return;
    let under = false;
    for (let p: Object3D | null = this.hidden; p; p = p.parent) if (p === m.root) { under = true; break; }
    if (!under) this.hidden = findById(m.root, 'cable.' + l.rig.id);
    for (const c of this.hidden?.children ?? []) if (c.userData.rig) c.visible = !hide;
  }
}
