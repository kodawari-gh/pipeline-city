// The two mains cords' ends (machine3d.ts, `buildRoomCords`): the PC's from the supply's inlet in the case's rear wall, the monitor's from its back.
import { getSpec } from '@/features/board/sim/specs';
import { CASE } from '../../layout/layout';
import { mainsInlet, mainsPlug, PLUG_TAIL } from '../psu3d';
import type { MachineParts, Outside, RopeEnd } from './types';
import { roomMains, wallMains } from './mains';

/** The PC's mains cord: the C13 plug sits in the supply's C14 inlet (`psu3d.ts`), the cord leaves its strain relief. None with no supply fitted. */
export function* pcMains(m: MachineParts, o: Outside): Generator<void> {
  // (the inlet is the power supply's: with no supply fitted there is nothing to hold the cord)
  const psu = o.s.devices.find((d) => d.kind === 'psu');
  if (!psu) {
    return;
  }
  const visual = (getSpec(psu.spec) as { visual?: string } | undefined)?.visual ?? 'psu-basic',
    inlet = mainsInlet(m.plan, visual);
  if (o.has('pcmains')) {
    m.wires.add(mainsPlug(m.plan, visual));
  }
  const from: RopeEnd = { at: [CASE.x - PLUG_TAIL, inlet[1], inlet[2]], dir: [-1, 0, 0] };
  if (o.w) {
    wallMains(m, o, { id: 'pcmains', from });
  } else {
    roomMains(m, o, { id: 'pcmains', from, socket: o.geo.socket.pc, dx: 60 });
  }
  yield;
}

/** The monitor's mains cord, from its back. */
export function monMains(m: MachineParts, o: Outside): void {
  if (!o.w) {
    roomMains(m, o, {
      id: 'monmains',
      from: { at: o.seats.power.at, dir: o.seats.power.axis },
      socket: o.geo.socket.mon,
      dx: -60,
    });
  } else if (o.w.monitor) {
    wallMains(m, o, { id: 'monmains', from: { at: o.w.monitor.at, dir: o.w.monitor.axis } });
  }
}
