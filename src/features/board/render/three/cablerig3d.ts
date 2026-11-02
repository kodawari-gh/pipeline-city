// A draggable cable's rig (docs/GRAPHICS_3D_OVERHAUL.md "Cables"): what Machine3D knows of a lead to build it seated or loose, and what the hand
// (plughand3d.ts) needs to hold it live. Each strand leaves a fixed point (its grommet, its device); the plug model is built in its socket, so
// any other place of the plug is a pose from there: a pivot at the socket's mouth, moved and turned. One model and one comb of strands serve
// the seated cable, the loose one and the held one, so nothing swaps when a plug goes in or out.
import { Group, Quaternion, Vector3, type Object3D } from 'three';
import { hang, type RopeEnd, type V3 } from '@/core/render/three/rope';
import { cableMesh, loosePlug, type Env, type Look } from './wires3d';

/** A socket's mouth and the way a plug pulls out of it (a unit vector). */
export interface Seat { at: V3; axis: V3 }
/** A plug's place: its pivot (the mouth's point on the plug) and its turn from the seated pose. Seated is { at: seat.at, q: identity }. */
export interface Pose { at: V3; q: Quaternion }
/** A loose plug that came to rest where it was dropped, how much cable it had pulled out, and its strands as they lay (the hand keeps them: nothing hangs again). */
export interface Rest { pose: Pose; length: number; strands?: V3[][] }

export interface CableRig {
  /** The cable's kind (`atx`, `cpu`, `pcie1`, `cpufan`, `video`, ...). */
  id: string;
  /** What the player plugs it into, for the label ("the 24-pin"). */
  name: string;
  /** The scene id of what takes it (outlined while it is held), or null. */
  target: string | null;
  look: Look;
  env: Env;
  /** Where each strand leaves its grommet or its device (into the cable). */
  fixed: RopeEnd[];
  /** The plug's model built in its socket, and where each strand leaves it there. */
  model: () => { root: Object3D; strands: RopeEnd[] };
  seat: Seat;
  /** False when nothing takes it now (a PCIe lead with no card): its seat is only where its model is built. */
  canSeat: boolean;
  /** How far the plug goes in: it pops free past this, it lines up this far out of the mouth. */
  engage: number;
  /** The seated strands (each from its fixed point to its exit), as the static build hangs them. */
  seated: (exits: RopeEnd[]) => V3[][];
  /** The most cable that comes out of the grommet (the plug stays this close to the strands' middle). */
  reach: number;
  /** How much cable hangs out when it is loose and has no rest pose. */
  loose: number;
  /** The live ropes' points and stiffness, and the straight lead out of each end. */
  n: number;
  stiff: number;
  lead: number;
  /** What shows only while it is seated (a wall socket, a second run). */
  extra?: () => Object3D;
}

const V = (p: V3) => new Vector3(p[0], p[1], p[2]);
const T = (v: Vector3): V3 => [v.x, v.y, v.z];

/** A straight plug standing out of its seat along the axis, `l` long (a video or mains plug): its model and its exit. */
export function straightPlug(seat: Seat, w: number, h: number, l: number, accent: string): { root: Object3D; strands: RopeEnd[] } {
  const root = loosePlug(w, h, l, accent), ax = V(seat.axis);
  root.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), ax);
  root.position.copy(V(seat.at).addScaledVector(ax, l));
  return { root, strands: [{ at: T(V(seat.at).addScaledVector(ax, l + 2)), dir: seat.axis }] };
}

/** A strand's exit (at the seat) carried to a pose. */
export function exitAt(e: RopeEnd, seat: Seat, pose: Pose): RopeEnd {
  const at = V(e.at).sub(V(seat.at)).applyQuaternion(pose.q).add(V(pose.at)), dir = V(e.dir).applyQuaternion(pose.q);
  return { at: T(at), dir: T(dir) };
}

/** The middle of some ends, and their mean direction. */
export function middle(ends: readonly RopeEnd[]): RopeEnd {
  const at = new Vector3(), dir = new Vector3();
  for (const e of ends) { at.add(V(e.at)); dir.add(V(e.dir)); }
  return { at: T(at.divideScalar(Math.max(1, ends.length))), dir: T(dir.lengthSq() ? dir.normalize() : dir.set(0, 0, 1)) };
}

/** The pose of a plug hanging at a cable's tip: its strands' middle on the tip, the cable leaving it back along the tip's direction. */
export function poseOnTip(seat: Seat, exits: readonly RopeEnd[], tip: { at: V3; dir: V3 }): Pose {
  const m = middle(exits), q = new Quaternion().setFromUnitVectors(V(m.dir), V(tip.dir).negate().normalize());
  return { at: T(V(tip.at).sub(V(m.at).sub(V(seat.at)).applyQuaternion(q))), q };
}

/** The plug model under a pivot at its seat, placed at a pose. */
export function pivotOf(seat: Seat, root: Object3D, pose?: Pose): Group {
  const pivot = new Group(), inner = new Group();
  inner.position.set(-seat.at[0], -seat.at[1], -seat.at[2]);
  inner.add(root);
  pivot.add(inner);
  setPose(pivot, pose ?? { at: seat.at, q: new Quaternion() });
  return pivot;
}

export function setPose(pivot: Object3D, pose: Pose): void {
  pivot.position.set(pose.at[0], pose.at[1], pose.at[2]);
  pivot.quaternion.copy(pose.q);
}

/** A loose cable: at its rest pose, or hanging from its strands' middle `loose` long with the plug at the tip. Each strand runs to its exit. */
export function looseState(rig: CableRig, exits: readonly RopeEnd[], rest: Rest | undefined): { rest: Rest; strands: V3[][] } {
  const opt = { r: rig.look.r, stiff: rig.stiff, n: rig.n, lead: rig.lead, ...rig.env };
  let r = rest;
  if (!r) {
    const spine = hang({ a: middle(rig.fixed), b: null, length: rig.loose, ...opt }), tip = spine[spine.length - 1]!, prev = spine[spine.length - 2]!;
    const d = V(tip).sub(V(prev)).normalize();
    r = { pose: poseOnTip(rig.seat, exits, { at: tip, dir: T(d) }), length: rig.loose };
  }
  const strands = r.strands ?? rig.fixed.map((a, i) => hang({ a, b: exitAt(exits[i]!, rig.seat, r.pose), length: r.length, ...opt }));
  return { rest: r, strands };
}

/**
 * The rig's cable as it stands (Machine3D adds it to the cable's tagged group; the hand hides it while it holds the cable): the plug in its
 * socket with the seated strands, or loose at its rest pose.
 */
export function rigStatic(rig: CableRig, seated: boolean, rest: Rest | undefined): Group {
  const g = new Group(), m = rig.model();
  g.userData.rig = true;
  if (seated && rig.canSeat) {
    g.add(m.root, cableMesh(rig.seated(m.strands), rig.look));
    if (rig.extra) g.add(rig.extra());
    return g;
  }
  const l = looseState(rig, m.strands, rest);
  g.add(pivotOf(rig.seat, m.root, l.rest.pose), cableMesh(l.strands, rig.look));
  return g;
}

/** `pts` resampled to `n` points evenly along its length. */
export function resample(pts: readonly V3[], n: number): V3[] {
  if (pts.length === n) return pts.map((p) => [...p] as V3);
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1], pts[i]![2] - pts[i - 1]![2]));
  const total = L[L.length - 1]!, out: V3[] = [];
  for (let i = 0, k = 0; i < n; i++) {
    const want = (total * i) / (n - 1);
    while (k + 2 < pts.length && L[k + 1]! < want) k++;
    const f = Math.min(1, Math.max(0, (want - L[k]!) / (L[k + 1]! - L[k]! || 1))), a = pts[k]!, b = pts[k + 1]!;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  }
  return out;
}
