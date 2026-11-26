// A socket takes a part or is freed (machine3d.ts, `patch`): its latches, its drop box, its plate or its tag follow.
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { traySpot } from '../drivecage3d';
import { SEAT } from './picks';
import { trayPick } from './trays';
import type { Fill, MachineParts, Object3D } from './types';
import { swapPick } from './swap';
import { fillCpu } from './fill-cpu';
import { fillSocket } from './socket';

const TRAY = /^sata(?<n>\d+)$/u,
  SOCKET = /^(?<kind>dimm|m2|pcie)(?<i>\d+)$/u;

/** A socket takes a part or is freed: its latches, its drop box, its plate or its tag follow. New pieces go on `added`. */
export function fill(m: MachineParts, f: Fill, added: Object3D[]): void {
  const { slot } = f;
  if (slot === 'cpu0') {
    fillCpu(m, f);
    return;
  }
  if (SEAT.test(slot)) {
    // the seat of a module, a cooler or a sink: an unseen box where it is bare (low: the cooler's seat is round the CPU socket, which wins the ray)
    const r = m.rects.get(slot);
    swapPick(m, f, () => {
      if (r) {
        m.pickBox(r, [BOARD_Z, BOARD_Z + 40], slot);
      }
    });
    return;
  }
  const tray = TRAY.exec(slot);
  if (tray) {
    // the bare tray's drop box: gone with a drive on the tray, back when it leaves
    const t = traySpot(m.cages, Number(tray.groups?.['n']));
    swapPick(m, f, () => {
      if (t) {
        trayPick(m, t);
      }
    });
    return;
  }
  const g = SOCKET.exec(slot)?.groups;
  if (g) {
    fillSocket(m, f, { kind: g['kind'] ?? '', i: Number(g['i']), added });
  }
}
