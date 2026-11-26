// A fan's cord to the board (machine3d.ts, the fans' cords): from the fan on its heatsink, its radiator or its mount to its header.
import { CASE_Z } from '@/features/room/render/three/roomplan';
import { BD, FAN_HUB } from '../../layout/layout';
import { fanHost } from '../../../sim/board';
import { coolerFanLead } from '../cooler3d';
import { SINK_FAN_MID } from '../sink3d';
import { at, cableMesh, fromSlot, grommet, hangPts } from '../wires3d';
import { caseEnv } from './bodies';
import { nth, visualOf } from './keys';
import type { CableRig, Cord, MachineParts, RopeEnd } from './types';
import { cord, header } from './cord-kit';

/** The fan's end: the cooler's west side, a heatsink fan's housing, the hub's input. */
function anchorOf({ p, c }: Cord): RopeEnd {
  const { s } = c;
  const cooler = s.devices.find((d) => d.kind === 'cooler'),
    coolerFans = s.devices.filter((d) => d.kind === 'fan' && cooler !== undefined && fanHost(d.slot) === cooler.slot);
  if (p.id === 'cpufan') {
    return coolerFanLead(
      visualOf(cooler?.spec ?? ''),
      coolerFans.map((d) => Number(d.slot.slice(d.slot.lastIndexOf('.fan') + 4))),
    );
  }
  if (p.id === 'sysfan') {
    return { at: at(FAN_HUB.x + 90, FAN_HUB.y - 60, CASE_Z + 240), dir: [0, 1, 0] };
  }
  return { at: at(p.anchor[0], p.anchor[1], SINK_FAN_MID), dir: [p.anchorDir[0], -p.anchorDir[1], 0] }; // (out of a sink fan's frame)
}

/** The cord of a fan on a cooler or a heatsink, or the hub's own (`sysfan`): under the board's bottom edge into the tray, and out of the hub slot into the hub's input. */
export function partCord(m: MachineParts, k: Cord): CableRig {
  const { p } = k,
    anchor = anchorOf(k);
  const skip =
    p.id === 'cpufan'
      ? m.obstacles.filter((o) => o.userData['cooler'] === true)
      : m.obstacles.filter((o) => o.userData['sink'] === true);
  const fenv = caseEnv(m, skip);
  if (p.id !== 'sysfan') {
    return cord(k, { fixed: anchor, env: fenv, o: { slack: 1.3, extra: 160, n: 20 } }, header(k));
  }
  const hole = { x: p.seat[0] - 40, y: BD.y + BD.h + 70, w: 80, h: 60 };
  m.wires.add(grommet(hole, m.grommets));
  const holeEnd = nth(fromSlot(hole, 1), 0),
    hubRun = hangPts(nth(k.hubEnds, 0), anchor, k.look, fenv, { slack: 1.2, extra: 80, n: 14 });
  return cord(
    k,
    { fixed: holeEnd, env: fenv, o: { slack: 1.25, extra: 120, n: 16 } },
    {
      ...header(k),
      extra: () => cableMesh(hubRun, k.look),
      // (the power goes on from the header, in at the hole, behind the tray to the hub's slot, out to the hub's input)
      power: { more: [hubRun] },
    },
  );
}
