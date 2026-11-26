// The video cable (machine3d.ts, `buildRoomCords`): combed out of sight from the monitor's back, behind the stand, down through the keyboard's
// grommet by the wall (room3d.ts: the keyboard sits at MONITOR_Z + 3600), along under the top (over the tray) and up through the desk's grommet
// behind the case. What the player moves is the PC end: from that grommet over the desk to the board's HDMI port on the case's west side, or to a
// graphics card's display port (a graphics display only), as the 2D game.
import { Group } from 'three';
import { tag } from '@/core/render/three/pick';
import { seatPlug } from '../cablerig3d';
import { boardHdmi, hdmiPlug, hdmiReal } from '../plugs3d';
import { hangPts } from '../wires3d';
import { nth } from './keys';
import { addRig } from './rigs';
import type { Env, MachineParts, Outside, RopeEnd, Seat, V3 } from './types';
import { monitorRun } from './monitor-run';
import { videoPorts } from './video-ports';

/** The video cable, if it stands. */
export function* videoCable(m: MachineParts, o: Outside): Generator<void> {
  if (!o.has('video')) {
    return;
  }
  const { dg, deskTop, video, room } = o;
  const g = tag(new Group(), 'cable.video'),
    vz = dg.z + 80;
  monitorRun(o, g, vz);
  // the PC end: where the sim has it (the board's port, or a card's), and the other ports it could go to
  const ports = videoPorts(o);
  const now = ports.find((p) => p.port === o.s.videoPort) ?? nth(ports, 0),
    axis: V3 = [-1, 0, 0];
  const seat: Seat = { at: now.at, axis },
    grom: RopeEnd = { at: [dg.x, deskTop + 10, vz], dir: [0, 1, 0] };
  const env: Env = { planes: room.planes, solids: [o.caseBox] },
    pc = { slack: 1.1, extra: 900, stiff: 0.35, n: 30 };
  // (each socket takes its plug, plugs3d.ts: a card's is real; the board's is cut to its rear I/O's smaller mouth, its keyed side toward the board)
  const plug = (port: string) => () =>
    port === 'board'
      ? seatPlug(seat, hdmiPlug(boardHdmi(video.r)), -Math.PI / 2)
      : seatPlug(seat, hdmiPlug(hdmiReal(video.r)));
  addRig(
    m,
    {
      id: 'video',
      name: 'the display port',
      target: 'io',
      look: video,
      env,
      fixed: [grom],
      model: plug(now.port),
      seat,
      canSeat: true,
      engage: 380,
      port: now.port === 'board' ? undefined : now.port,
      alts: ports.filter((p) => p !== now).map((p) => ({ port: p.port, at: p.at, model: plug(p.port) })),
      seated: (ex) => [hangPts(grom, nth(ex, 0), video, env, pc)],
      deck: o.deck,
      n: pc.n,
      stiff: pc.stiff,
      lead: video.r * 2.5,
    },
    { g, seated: o.on('video') },
  );
  m.wires.add(g);
  yield;
}
