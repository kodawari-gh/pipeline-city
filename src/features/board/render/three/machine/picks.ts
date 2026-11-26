// The board's unseen drop boxes (machine3d.ts): over each free socket, each free fan spot of a host and each empty drive tray, so a pick or a
// drop finds them; and the back wall's slot covers over the empty PCIe slots.
import { rectBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { tag, unseen } from '@/core/render/three/pick';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { GEO, M2_SLOTS, USB_PORT } from '../../layout/layout';
import { slotRects } from '../slots3d';
import { SLOT_H } from '../ram3d';
import { grow } from '../parts';
import type { MachineParts, RectLike, Snapshot } from './types';
import { fanPicks } from './fan-picks';

/** A seat a pick box lies over until its part comes: a module's, a cooler's or a sink's. */
export const SEAT = /^(?:tpm|cooler|vrm-sink|ram-sink)\d+$/u;

/** The board's pick boxes: an empty memory socket, M.2 slot, header or seat is picked by an unseen box over its rect; the USB port by one in front of the cover, where a key is dropped. */
export function boardPicks(m: MachineParts, s: Snapshot | null, filled: ReadonlySet<string>): void {
  const clear = mat(0, { transparent: true, opacity: 0, depthWrite: false });
  const pickBox = (r: RectLike, [z0, z1]: readonly [number, number], id: string): void => {
    const b = unseen(tag(rectBox(r, z0, z1, clear), id));
    m.picks.set(id, b);
    m.root.add(b);
  };
  m.pickBox = pickBox;
  pickBox(grow(USB_PORT, 60), [BOARD_Z, BOARD_Z + 1400], 'usb');
  for (const [i, d] of GEO.dimm.entries()) {
    if (!filled.has(`dimm${i}`)) {
      pickBox(d.rect, [BOARD_Z, BOARD_Z + SLOT_H], `dimm${i}`);
    }
  }
  for (const [i, r] of M2_SLOTS.entries()) {
    if (!filled.has(`m2${i}`)) {
      pickBox(r, [BOARD_Z, BOARD_Z + 40], `m2${i}`);
    }
  }
  if (!s) {
    return;
  }
  for (const [id, r] of slotRects(s)) {
    if (SEAT.test(id) && !filled.has(id)) {
      pickBox(r, [BOARD_Z, BOARD_Z + 40], id); // (low: the cooler's seat is round the CPU socket, which stands above it and wins the ray)
    }
  }
  fanPicks(m, s, filled);
}
