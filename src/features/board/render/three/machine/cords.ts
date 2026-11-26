// The cords out of the case, over the room (machine3d.ts): the video cable runs from the board's HDMI port through the desk and up behind the
// monitor's stand into its back (never across the desk in front of the stand); the mains cords (the PC's from the PSU's inlet in the case's rear
// wall, the monitor's from its back) drop through the desk's grommet to the wall socket. A cord that is out lies loose from its device.
import { SEG, post } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { lanLead } from './lan';
import { monMains, pcMains } from './pcmains';
import { outsideOf } from './outside';
import { videoCable } from './video';
import type { MachineParts, RoomGeo, Snapshot } from './types';

/** The cords out of the case, one at a time. */
export function* buildRoomCords(m: MachineParts, s: Snapshot, geo: RoomGeo): Generator<void> {
  const o = outsideOf(m, s, geo),
    { dg } = o;
  // the desk's grommet the mains cords drop through, behind the case's west side
  m.wires.add(
    post(dg.x, geo.ys, dg.z, 150, 14, mat(0x2a_2d_32, { roughness: 0.6, metalness: 0.3 }), SEG.bigDisc),
    post(dg.x, geo.ys - 1, dg.z, 112, 16, mat(0x05_06_08, { roughness: 0.9 }), SEG.bigDisc),
  );
  yield* videoCable(m, o);
  yield* lanLead(m, o);
  yield* pcMains(m, o);
  monMains(m, o);
}
