// The LAN lead (machine3d.ts, `buildRoomCords`): fixed at the router's port, its plug lies on the desk and goes into the network jack on the
// case's rear panel, the board's or a network card's. On the studio's wall its router end is in the router's first LAN jack.
import { Group } from 'three';
import { tag } from '@/core/render/three/pick';
import { hangPts } from '../wires3d';
import { netVisible, nth } from './keys';
import { addRig } from './rigs';
import type { Env, Jack, MachineParts, Outside, Seat } from './types';
import { boardJackAt, jacksOf } from './lan-jacks';
import { routerEnd, plugFor, leadOf } from './lan-ends';

/** The LAN lead, if it stands and the network shows (the room), or on the studio's wall. */
export function* lanLead(m: MachineParts, o: Outside): Generator<void> {
  const { s, w } = o;
  if (!o.has('lan') || !(w || (netVisible(s) && m.inRoom))) {
    return;
  }
  const g = tag(new Group(), 'cable.lan'),
    lead = leadOf(s),
    { look } = lead;
  const jacks = jacksOf(o);
  // (no jack at all, a board without one and no card: the plug waits at the board's place, and nothing takes it)
  const picked = s.net?.port.kind === 'nic' ? jacks.find((j) => j.port === s.net?.port.deviceId) : undefined,
    now: Jack = picked ?? jacks[0] ?? { port: 'board', kind: 'rj45', at: boardJackAt() };
  const fixed = routerEnd(o, lead, now);
  g.add(fixed.root);
  const from = nth(fixed.strands, 0);
  const seat: Seat = { at: now.at, axis: [-1, 0, 0] },
    env: Env = o.stage ?? { planes: o.room.planes, solids: [o.caseBox] },
    hang = { slack: 1.1, extra: 600, stiff: 0.35, n: 30 },
    plug = plugFor(lead, seat);
  addRig(
    m,
    {
      id: 'lan',
      name: 'the network port',
      target: 'io',
      look,
      env,
      fixed: [from],
      model: plug(now),
      seat,
      canSeat: true,
      engage: 380,
      port: now.port,
      alts: jacks.filter((j) => j !== now).map((j) => ({ port: j.port, at: j.at, model: plug(j) })),
      seated: (ex) => [hangPts(from, nth(ex, 0), look, env, hang)],
      deck: o.deck,
      n: hang.n,
      stiff: hang.stiff,
      lead: look.r * 2.5,
    },
    { g, seated: o.on('lan') },
  );
  m.wires.add(g);
  yield;
}
