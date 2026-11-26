// The machine's merge and its distance stand-ins (machine3d.ts, PERF22 and PERF6): what merges and shares its materials, and what the distance LOD
// stands in for.
import { shareMaterials } from '@/core/render/three/materials';
import { lowDetail } from '@/core/render/three/detail';
import { mergeSiblingsSteps } from '@/core/render/three/merge';
import type { LodScope, MachineParts, Object3D } from './types';

/**
 * Fewer draws and materials (PERF22, docs/render/three.md "Merges"): the still meshes of each parent as one palette mesh
 * (`mergeSiblings`), then equal materials as one in each part (`shareMaterials`). The cables (built again alone) and `keep` stay as they
 * are; each fade (`fades`, `apart`) keeps its materials. The state looks are `own`: the skins, the rings and strips, the case's LEDs.
 */
export function* share(m: MachineParts): Generator<void> {
  const skip = [m.wires, ...m.keep],
    apart = [...m.fades, ...m.apart];
  yield* mergeSiblingsSteps(m.root, { skip, apart, pbr: true });
  // (at Low, equal materials of different parts become one too: PHONE-01; High keeps one set per part, as it was)
  shareMaterials(m.root, { skip, apart, across: lowDetail() });
}

/**
 * What the distance LOD must know (docs/render/lod.md "The machine's stand-ins"). Anchors: what a reveal shows, hides or fades as a whole
 * (each fade, a card's cooler, the board's small parts) and the cables (built again alone): their stand-ins are their children. Left out:
 * `keep`, the side panel (it swings), the key (built again alone), and a card's own tree (it swings down flat; its cooler is an anchor).
 */
export function lodScope(m: MachineParts): LodScope {
  const cards = new Set<Object3D>([...m.cards.values()].map((c) => c.root));
  // (the loop's hoses fade but have no stand-ins: they are in `keep`, posed live)
  const anchors: Object3D[] = [
    m.wires,
    ...m.apart,
    ...m.still,
    ...m.fades.filter((o) => !cards.has(o) && o !== m.hoses?.body),
  ];
  const skip: Object3D[] = [...m.keep, ...cards];
  if (m.small) {
    anchors.push(m.small);
  }
  if (m.door) {
    skip.push(m.door.cm.door);
  }
  if (m.key) {
    skip.push(m.key.g);
  }
  return { anchors, skip };
}
