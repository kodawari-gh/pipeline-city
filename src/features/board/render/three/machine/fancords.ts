// The fans' cords (machine3d.ts, `buildCables`): from the fan to its header; the case fans' from the slot in the tray over the hub to the hub's
// headers. The power goes from the header, out to the fan.
import { Group } from 'three';
import { tag } from '@/core/render/three/pick';
import { hubHeaders } from '@/features/room/render/desk/props/case';
import { FAN_SLOT } from '../../layout/layout';
import { fanCordPlans } from '../../wiring/fancords';
import { fromSlot, grommet } from '../wires3d';
import { addRig } from './rigs';
import type { Cord, Inside, Look, MachineParts } from './types';
import { hubCord } from './hub-cord';
import { partCord } from './part-cord';

/** The fans' cords, one at a time. */
export function* fanCords(m: MachineParts, c: Inside): Generator<void> {
  const look: Look = { r: 11, base: '#14161c', accent: c.T.mul },
    hubSlot = grommet(FAN_SLOT, m.grommets);
  m.wires.add(hubSlot);
  const hubEnds = fromSlot(FAN_SLOT, hubHeaders().length + 1);
  for (const p of fanCordPlans()) {
    if (!c.has(p.id)) {
      continue;
    }
    const g = tag(new Group(), `cable.${p.id}`),
      plugged = c.on(p.id),
      k: Cord = { p, look, c, hubEnds };
    addRig(m, p.id.startsWith('fan:') ? hubCord(k) : partCord(m, k), { g, seated: plugged });
    m.wires.add(g);
    yield;
  }
}
