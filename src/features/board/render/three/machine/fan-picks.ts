// The unseen drop boxes over the free fan spots (machine3d.ts): the heatsinks' (`hostFanPicks`) and the case's mounts (`fanPicks`).
import { getSpec } from '@/features/board/sim/specs';
import { fanMounts } from '@/features/room/render/desk/props/case';
import { BOARD_Z, FAN_MAX, FAN_ZC, REAR_ZC } from '@/features/room/render/three/roomplan';
import { fanHost } from '../../../sim/board';
import { coolerFanBox } from '../cooler3d';
import { slotRects } from '../slots3d';
import type { MachineParts, Snapshot } from './types';

/** The same for the free fan spots of the heatsinks (a patch makes these again when a host or its fan comes or goes). */
export function hostFanPicks(m: MachineParts, s: Snapshot, filled: ReadonlySet<string>): void {
  for (const [id, r] of slotRects(s)) {
    const host = fanHost(id);
    if (host === null || filled.has(id)) {
      continue;
    }
    const d = s.devices.find((x) => x.slot === host),
      visual = (getSpec(d?.spec ?? '') as { visual?: string } | undefined)?.visual ?? '',
      spot = Number(id.slice(id.lastIndexOf('.fan') + 4));
    const box = d?.kind === 'cooler' ? coolerFanBox(visual, spot) : { r, z0: BOARD_Z + 180, z1: BOARD_Z + 560 };
    if (box) {
      m.pickBox(box.r, [box.z0, box.z1], id);
    }
  }
}

/** The unseen drop box of each free fan spot, as big as the fan it takes: a case mount's in the case (a radiator leaves its side's fans on their mounts); a heatsink's on its end or over its top. */
export function fanPicks(m: MachineParts, s: Snapshot, filled: ReadonlySet<string>): void {
  for (const f of fanMounts()) {
    if (filled.has(f.id)) {
      continue;
    }
    const zc = f.side === 'rear' ? REAR_ZC : FAN_ZC,
      d = Math.min(f.side === 'top' ? f.rect.w : f.rect.h, FAN_MAX);
    m.pickBox(f.rect, [zc - d / 2, zc + d / 2], f.id);
  }
  hostFanPicks(m, s, filled);
}
