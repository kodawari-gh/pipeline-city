// The video cable's run in the room (machine3d.ts, the video cable): under the desk, behind the monitor's stand and up to its HDMI port.
import { rounded } from '@/core/render/three/geometry';
import { MONITOR_Z } from '@/features/room/render/three/roomplan';
import { KEY_LEAD } from '@/features/room/render/three/props3d';
import { MONITOR } from '../../layout/layout';
import { seatPlug } from '../cablerig3d';
import { hdmiPlug, hdmiReal } from '../plugs3d';
import { cableMesh, hangPts } from '../wires3d';
import { slab } from './bodies';
import { nth } from './keys';
import type { Env, Group, Outside, RopeEnd, Seat, V3 } from './types';

/** The video cable's fixed run: from the monitor's back (its plug is built in), behind the stand and under the desk, up through its grommet. */
export function monitorRun(o: Outside, g: Group, vz: number): void {
  const { dg, deskTop, video, room, mp } = o;
  const kg = { x: MONITOR.x + MONITOR.w / 2 + KEY_LEAD[0] + 160, z: MONITOR_Z + 3600 + KEY_LEAD[1] - 150 },
    low = o.under - 340;
  const run: V3[] = [
    [dg.x, deskTop, vz],
    [dg.x, low, vz],
    [dg.x - 500, low, vz],
    [dg.x - 1500, low, kg.z],
    [kg.x, low, kg.z],
    [kg.x, deskTop, kg.z],
  ];
  // the stand's column and foot (monitor3d.ts): the cable runs behind them
  const stand: Env = {
    planes: room.planes,
    solids: [...room.solids, ...[mp.column, mp.foot].map((b) => slab(b.r, b.z0, b.z1))],
  };
  const up: RopeEnd = { at: [kg.x, deskTop + 10, kg.z], dir: [0, 1, 0] },
    hang = { natural: true, handle: 0.4, stiff: 0.45, n: 34 };
  const monSeat: Seat = o.seats.video,
    mon = seatPlug(monSeat, hdmiPlug(hdmiReal(video.r)));
  const path = rounded(run, 250),
    drop = hangPts(up, nth(mon.strands, 0), video, stand, hang);
  g.add(mon.root, cableMesh([...path, ...drop], video));
}
