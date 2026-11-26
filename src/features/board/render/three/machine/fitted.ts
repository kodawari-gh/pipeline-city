// The parts fitted (machine3d.ts, the build): each part in turn, then the bank's map, the boxes the cables go round, the loop's hoses and the
// cables.
import { Box3 } from 'three';
import { slotRects } from '../slots3d';
import { cablesSteps } from './cables';
import { buildRamMap } from './rammap';
import { addPart, partContext, relist } from './list';
import type { MachineParts, RoomGeo, Snapshot } from './types';
import { hoses } from './hoses';

/** The parts, one at a time, then the bank's map and the boxes the cables go round, the loop's hoses and the cables. */
export function* buildParts(m: MachineParts, s: Snapshot, geo: RoomGeo): Generator<void> {
  m.rects = slotRects(s);
  const ctx = partContext(m);
  for (const d of s.devices) {
    addPart(m, d, ctx);
    yield;
  }
  relist(m);
  buildRamMap(m);
  m.root.updateMatrixWorld(true);
  for (const o of m.obstacles) {
    const b = new Box3().setFromObject(o);
    if (!b.isEmpty()) {
      m.solids.set(o, { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
    }
  }
  yield;
  yield* hoses(m);
  m.wires.name = 'wires';
  m.root.add(m.wires);
  yield* cablesSteps(m, s, geo);
}
