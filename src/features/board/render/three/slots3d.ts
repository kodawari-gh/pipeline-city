// Where each socket of the board and the case is, by slot id (the 2D board's `scene.slots`): the lenses read them, and the empty ones get a drop box.
import type { Snapshot } from '@/worker/protocol';
import { BOARD_TIERS } from '../../sim/specs';
import { tpmRect } from '@/core/render/accelart';
import { radiatorSpan } from '@/features/room/render/desk/props/case';
import { slotRect as storageSlotRect } from '@/features/storage/render/drives';
import { COOLER, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, LAYOUT_TIER, MONITOR, PCIE_RAILS, PKG, PSU, RAM_SINK, VRM_SINK, type Rect } from '../layout/layout';

/** Where each socket of the board and the case is, by slot id (the 2D board's `scene.slots`). */
export function slotRects(s: Snapshot): Map<string, Rect> {
  const m = new Map<string, Rect>(), slots = BOARD_TIERS[s.boardTier]?.slots ?? {};
  const add = (type: string, n: number, of: (i: number) => Rect | null) => { for (let i = 0; i < n; i++) { const r = of(i); if (r) m.set(`${type}${i}`, r); } };
  add('dimm', slots.dimm ?? 0, (i) => ({ x: DIMM_X(i), y: DIMM_Y(i), w: DIMM_W, h: DIMM_H }));
  add('cpu', slots.cpu ?? 0, () => PKG);
  add('cooler', slots.cooler ?? 0, () => COOLER);
  add('display', slots.display ?? 0, () => MONITOR);
  add('atx', slots.atx ?? 0, () => PSU);
  add('atx-plus', slots['atx-plus'] ?? 0, () => PSU);
  add('pcie', slots.pcie ?? 0, (i) => { const r = PCIE_RAILS[i]; return r ? { x: r.x, y: r.y - 20, w: r.w, h: r.h + 40 } : null; });
  add('vrm-sink', slots['vrm-sink'] ?? 0, () => VRM_SINK);
  add('ram-sink', slots['ram-sink'] ?? 0, () => RAM_SINK);
  add('tpm', slots.tpm ?? 0, () => tpmRect(LAYOUT_TIER));
  for (const side of ['front', 'top'] as const) { const span = radiatorSpan(side); if (span) m.set(`rad-${side}`, span.rect); }
  add('sata', slots.sata ?? 0, (i) => storageSlotRect('sata' + i));
  add('m2', slots.m2 ?? 0, (i) => storageSlotRect('m2' + i));
  return m;
}
