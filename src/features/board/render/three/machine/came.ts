// The parts a patch adds (machine3d.ts, `patch`): each built alone and merged alone, as the build does it, with the boxes the cables go round.
import { Box3, Group } from 'three';
import { mergeSiblings } from '@/core/render/three/merge';
import { shareMaterials } from '@/core/render/three/materials';
import { lowDetail } from '@/core/render/three/detail';
import { slotRects } from '../slots3d';
import { buildRamMap } from './rammap';
import { fill } from './fill';
import { addPart, partContext, relist } from './list';
import type { Diff, MachineParts, Object3D, PartBuild, Snapshot } from './types';

/** The boxes the cables go round, of the parts just made. */
function takeSolids(m: MachineParts, made: readonly PartBuild[]): void {
  for (const b of made) {
    for (const ob of b.obstacles) {
      ob.updateWorldMatrix(true, true);
      const box = new Box3().setFromObject(ob);
      if (!box.isEmpty()) {
        m.solids.set(ob, { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] });
      }
    }
  }
}

/** The new pieces merge among themselves, as the build merges each part. */
export function mergeAdded(m: MachineParts, added: readonly Object3D[]): void {
  if (m.merged && added.length > 0) {
    const holder = new Group(),
      skip = [...m.keep],
      apart = [...m.fades, ...m.apart];
    holder.add(...added);
    mergeSiblings(holder, { skip, apart, pbr: true });
    shareMaterials(holder, { skip, apart, across: lowDetail() });
    m.root.add(...holder.children);
    return;
  }
  for (const o of added) {
    if (o.parent !== m.root) {
      m.root.add(o);
    }
  }
}

/** What comes: built alone, its boxes taken, the bank's map made again for a stick, and the sockets they take or free. */
export function addCame(m: MachineParts, s: Snapshot, { gone, came }: Diff): Object3D[] {
  m.devs = s.devices;
  m.rects = slotRects(s);
  const ctx = partContext(m),
    made = came.map((d) => addPart(m, d, ctx)),
    added: Object3D[] = made.flatMap((b) => b.roots);
  relist(m);
  takeSolids(m, made);
  if (gone.some((d) => d.kind === 'ram') || came.some((d) => d.kind === 'ram')) {
    buildRamMap(m);
  }
  for (const d of gone) {
    fill(m, { slot: d.slot, filled: false }, added);
  }
  for (const d of came) {
    fill(m, { slot: d.slot, filled: true }, added);
  }
  return added;
}
