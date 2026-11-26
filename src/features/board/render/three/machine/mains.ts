// The mains cords (machine3d.ts, `buildRoomCords`): in the room each drops through the desk's grommet to the wall socket; on the studio's wall
// it runs whole to its outlet.
import { Group } from 'three';
import { mat } from '@/core/render/three/materials';
import { tag, unseen } from '@/core/render/three/pick';
import { reversed } from '../power/runs';
import { cableMesh, hangPts } from '../wires3d';
import { nth } from './keys';
import { roomEngage, roomModel, roomSeat, wallEngage, wallModel } from './swiss';
import { addRig } from './rigs';
import type { Env, MachineParts, Outside, RopeEnd, Seat, V3 } from './types';

/** A mains cord: its cable id and where it leaves its device. */
interface Mains {
  id: 'pcmains' | 'monmains';
  from: RopeEnd;
}

/** The floor under the desk a loose mains plug lies on, by the wall socket (nothing to weave through the desk). */
const floorOf = (o: Outside): Env => ({
  planes: [
    { n: [0, 1, 0], d: -o.geo.floor },
    { n: [0, 0, 1], d: 40 },
    { n: [0, -1, 0], d: -o.under },
  ],
  solids: [],
});

/**
 * A mains cord in the room: it runs from its device through the desk's grommet for good; what the player moves is the plug under the desk. It lies
 * loose on the floor by the wall socket and goes into its outlet (`socket`), out of the wall. `dx`: its place in the grommet.
 */
export function roomMains(
  m: MachineParts,
  o: Outside,
  c: Mains & { socket: { x: number; y: number }; dx: number },
): void {
  const { id, from, socket, dx } = c,
    { dg, cord } = o;
  if (!o.has(id)) {
    return;
  }
  const g = tag(new Group(), `cable.${id}`),
    hole: V3 = [dg.x + dx, o.deskTop + 10, dg.z],
    low: RopeEnd = { at: [dg.x + dx, o.under - 10, dg.z], dir: [0, -1, 0] };
  // (the room's plate is drawn small, swisssocket3d.ts `ROOM_SOCKET`: its Swiss plug is built at the same scale, upright, its earth pin down)
  const seat = roomSeat(socket),
    hang = { slack: 1.1, extra: 700, stiff: 0.4, n: 30 };
  const floor = floorOf(o),
    ground = nth(floor.planes, 0);
  const run = hangPts(from, { at: hole, dir: [0, 1, 0] }, cord, o.room, { slack: 1.1, extra: 500, stiff: 0.4, n: 30 });
  g.add(cableMesh(run, cord));
  // (a thin cord seen from afar is a pixel wide: an unseen sleeve three times as thick round it is what the pointer finds)
  const grab = cableMesh(run, { ...cord, r: cord.r * 3 });
  grab.material = mat(0, { transparent: true, opacity: 0, depthWrite: false });
  g.add(unseen(grab));
  addRig(
    m,
    {
      id,
      name: 'the wall socket',
      target: 'socket',
      look: cord,
      env: floor,
      fixed: [low],
      model: roomModel(cord, seat),
      seat,
      canSeat: true,
      engage: roomEngage(),
      seated: (ex) => [hangPts(low, nth(ex, 0), cord, floor, hang)],
      deck: ground,
      n: hang.n,
      stiff: hang.stiff,
      lead: cord.r * 2.5,
      // (the power comes from the wall: out of the plug, up through the desk's hole and along the cord to its device)
      power: { out: true, beyond: [low.at, ...reversed(run)] },
    },
    { g, seated: o.on(id) },
  );
  m.wires.add(g);
}

/**
 * A mains cord on the studio's wall: one piece from its device to its plug in the outlet, a real Swiss type 12 plug in a real type 13 recess, turned as
 * the socket of the pinwheel it goes into: the power runs out of the plug.
 */
export function wallMains(m: MachineParts, o: Outside, { id, from }: Mains): void {
  const { w, stage, cord } = o;
  if (!o.has(id) || !w || !stage) {
    return;
  }
  const g = tag(new Group(), `cable.${id}`),
    at = w.plan.mains.outlet[id],
    roll = w.plan.mains.turn[id];
  const seat: Seat = { at, axis: [0, 0, 1] },
    hang = { slack: 1.4, extra: 600, stiff: 0.4, n: 40 },
    ground = nth(stage.planes, 0);
  addRig(
    m,
    {
      id,
      name: 'the wall socket',
      target: 'socket',
      look: cord,
      env: stage,
      fixed: [from],
      model: wallModel(cord, seat, roll),
      seat,
      canSeat: true,
      engage: wallEngage(),
      seated: (ex) => [hangPts(from, nth(ex, 0), cord, stage, hang)],
      deck: ground,
      n: hang.n,
      stiff: hang.stiff,
      lead: cord.r * 2.5,
      power: { out: true },
    },
    { g, seated: o.on(id) },
  );
  m.wires.add(g);
}
