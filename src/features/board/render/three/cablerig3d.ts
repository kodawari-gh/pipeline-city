// A draggable cable's rig (docs/GRAPHICS_3D_OVERHAUL.md "Cables"): what Machine3D knows of a lead to build it seated or loose, and what the hand
// (plughand3d.ts) needs to hold it live. Each strand leaves a fixed point (its grommet, its device); the plug model is built in its socket, so
// any other place of the plug is a pose from there: a pivot at the socket's mouth, moved and turned. One model and one comb of strands serve
// the seated cable, the loose one and the held one, so nothing swaps when a plug goes in or out. Each strand has one length, the one it has
// seated: loose or held, the plug goes only as far as that reaches.
import { Group, Quaternion, Vector3, type Object3D } from 'three';
import { dist, hang, lengthOf, type Plane, type RopeEnd, type V3 } from '@/core/render/three/rope';
import { cableMesh, loosePlug, type Env, type Look } from './wires3d';

/** A socket's mouth and the way a plug pulls out of it (a unit vector). */
export interface Seat { at: V3; axis: V3 }
/** A plug's place: its pivot (the mouth's point on the plug) and its turn from the seated pose. Seated is { at: seat.at, q: identity }. */
export interface Pose { at: V3; q: Quaternion }
/** A loose plug that came to rest where it was dropped, and its strands as they lay (the hand keeps them: nothing hangs again). */
export interface Rest { pose: Pose; strands?: V3[][] }

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
  /** Other sockets of the same kind on the seat's axis (a graphics card's display port, as well as the board's): the held plug lines up with the
   *  one nearest the pointer, and `connectCable` names it. `port` is `connectCable`'s port argument; `seat.port` is the seat's own. `model`:
   *  the plug that socket takes (one of another size or turn: a card's real HDMI, the board's smaller one), built in the rig's seat. */
  alts?: { port: string; at: V3; model?: () => { root: Object3D; strands: RopeEnd[] } }[];
  /** `connectCable`'s port argument for the seat itself. */
  port?: string;
  /** False when nothing takes it now (a PCIe lead with no card): its seat is only where its model is built. */
  canSeat: boolean;
  /** How far the plug goes in: it pops free past this, it lines up this far out of the mouth. */
  engage: number;
  /** The seated strands (each from its fixed point to its exit), as the static build hangs them: their lengths are the cable's. */
  seated: (exits: RopeEnd[]) => V3[][];
  /** What a held plug moves over and never goes behind (its inside faces the view): the board's face in the case, not down among the
   *  grommets on the tray; the desk in the room. A cable that pulls the plug in keeps it at its height over this. */
  deck: Plane;
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

/**
 * A plug model (plugs3d.ts: built round its own z axis, its socket's mouth at z = -l, the cable leaving at 0) standing in its seat, turned `roll`
 * round the seat's axis (a socket's keyed side down or toward the board): its model and its exit.
 */
export function seatPlug(seat: Seat, plug: { body: Object3D; l: number }, roll = 0): { root: Object3D; strands: RopeEnd[] } {
  const root = new Group(), ax = V(seat.axis), { body, l } = plug;
  body.rotation.z = roll;
  root.add(body);
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

/** The pose of a plug hanging at a cable's tip: its strands' middle on the tip, the cable leaving it back along the tip's direction (`free` of the turn there, `freedom`). */
export function poseOnTip(seat: Seat, exits: readonly RopeEnd[], tip: { at: V3; dir: V3 }, free = 1): Pose {
  const m = middle(exits), q = new Quaternion().slerp(new Quaternion().setFromUnitVectors(V(m.dir), V(tip.dir).negate().normalize()), free);
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

/** Each strand's length: the one it has seated, from its fixed point to its exit. */
export const lengthsOf = (rig: CableRig, exits: readonly RopeEnd[]): number[] => rig.seated([...exits]).map(lengthOf);

/**
 * `p` pulled back toward `from` to stay within `reach` of it. With `n` (a unit normal) it keeps its height along `n` and comes in along the plane
 * square to it: a plug held over the board stays over it, never drawn down toward a grommet behind it.
 */
export function withinReach(p: V3, from: V3, reach: number, n?: V3): V3 {
  const d: V3 = [p[0] - from[0], p[1] - from[1], p[2] - from[2]], h = n ? d[0] * n[0] + d[1] * n[1] + d[2] * n[2] : 0;
  const u: V3 = n ? [d[0] - n[0] * h, d[1] - n[1] * h, d[2] - n[2] * h] : d, l = Math.hypot(...u), R = Math.sqrt(Math.max(0, reach * reach - h * h));
  if (l <= R) return p;
  const k = R / l, o: V3 = n ? [from[0] + n[0] * h, from[1] + n[1] * h, from[2] + n[2] * h] : from;
  return [o[0] + u[0] * k, o[1] + u[1] * k, o[2] + u[2] * k];
}

/**
 * A plug's place `at` (turned `q`) pulled back toward its cable's fixed ends until no strand spans more than `share` of what it has between its
 * straight leads (`lengths` less a lead at each end): a plug goes only as far as its cable reaches. With `n`, as `withinReach`.
 */
export function withinCable(rig: CableRig, exits: readonly RopeEnd[], lengths: readonly number[], at: V3, q: Quaternion, share = 1, n?: V3): V3 {
  const p = V(at), seat = V(rig.seat.at), { lead } = rig, b = new Vector3();
  // rounds until it holds: the strands at a wide comb's far ends pull it opposite ways (a tall grommet slot, a plug turned across it)
  for (let k = 0; k < 16; k++) {
    let most = 0;
    exits.forEach((e, i) => {
      const f = rig.fixed[i]!, from: V3 = [f.at[0] + f.dir[0] * lead, f.at[1] + f.dir[1] * lead, f.at[2] + f.dir[2] * lead];
      b.copy(V(e.at)).sub(seat).addScaledVector(V(e.dir), lead).applyQuaternion(q).add(p);
      const d = V(withinReach(T(b), from, Math.max(0, lengths[i]! - 2 * lead) * share, n)).sub(b);
      p.add(d);
      most = Math.max(most, d.length());
    });
    if (most < 0.5) break;
  }
  return T(p);
}

/** How far the farthest of some ends is from their middle. */
function spread(ends: readonly RopeEnd[]): number {
  const m = middle(ends).at;
  return Math.max(...ends.map((e) => dist(e.at, m)));
}

/** How long a loose cable's spine is, from its strands' middle to its plug's: the shortest strand less both ends' spread, so every strand reaches. */
export function spineLength(rig: CableRig, exits: readonly RopeEnd[], lengths: readonly number[]): number {
  return Math.max(rig.lead * 3, Math.min(...lengths) - spread(rig.fixed) - spread(exits) - rig.lead);
}

/**
 * How far a plug may turn from its seated turn (0 to 1): all the way on one strand, less on a wide comb, not at all when the comb is as wide as
 * its strands are long (the 24-pin out of its tall slot beside the socket: turned across the slot, its end strands could not reach).
 */
export function freedom(rig: CableRig, exits: readonly RopeEnd[], lengths: readonly number[]): number {
  return Math.min(1, Math.max(0, 1 - (spread(rig.fixed) + spread(exits)) / Math.max(1, Math.min(...lengths) - 2 * rig.lead)));
}

/** What a loose cable's spine hangs in: its walls and parts, and its deck (the plug at its tip lies in front of the board, never in the tray). */
export const spineEnv = (rig: CableRig): Env => ({ planes: [...rig.env.planes, rig.deck], solids: rig.env.solids });

/** About half a plug's thickness: how far a loose plug's mouth and back keep in front of its deck. */
const PLUG_HALF = 60;

/** Where a loose plug at `pose` lies: its mouth and its back in front of its deck, and within its cable's reach (at its height over the deck). */
export function looseAt(rig: CableRig, exits: readonly RopeEnd[], lengths: readonly number[], pose: Pose): V3 {
  const n = V(rig.deck.n), at = V(pose.at), back = V(middle(exits).at).sub(V(rig.seat.at)).applyQuaternion(pose.q).add(at);
  at.addScaledVector(n, Math.max(0, PLUG_HALF + rig.deck.d - Math.min(n.dot(at), n.dot(back))));
  return withinCable(rig, exits, lengths, T(at), pose.q, 1, rig.deck.n);
}

/** A loose cable: at its rest pose, or hanging from its strands' middle with the plug at the tip. Each strand runs to its exit at its length. */
export function looseState(rig: CableRig, exits: readonly RopeEnd[], rest: Rest | undefined): { rest: Rest; strands: V3[][] } {
  const opt = { r: rig.look.r, stiff: rig.stiff, n: rig.n, lead: rig.lead, ...rig.env }, lengths = lengthsOf(rig, exits);
  let r = rest;
  if (!r) {
    const spine = hang({ a: middle(rig.fixed), b: null, length: spineLength(rig, exits, lengths), ...opt, ...spineEnv(rig) }), tip = spine[spine.length - 1]!, prev = spine[spine.length - 2]!;
    const pose = poseOnTip(rig.seat, exits, { at: tip, dir: T(V(tip).sub(V(prev)).normalize()) }, freedom(rig, exits, lengths));
    r = { pose: { at: looseAt(rig, exits, lengths, pose), q: pose.q } };
  }
  const strands = r.strands ?? rig.fixed.map((a, i) => hang({ a, b: exitAt(exits[i]!, rig.seat, r.pose), length: lengths[i]!, ...opt }));
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
    m.root.userData.plug = true;
    g.add(m.root, cableMesh(rig.seated(m.strands), rig.look));
    if (rig.extra) g.add(rig.extra());
    return g;
  }
  const l = looseState(rig, m.strands, rest);
  const pivot = pivotOf(rig.seat, m.root, l.rest.pose);
  pivot.userData.plug = true;
  g.add(pivot, cableMesh(l.strands, rig.look));
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
