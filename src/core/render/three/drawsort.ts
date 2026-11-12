// The opaque draws of a frame in program order (docs/render/case.md "Build my PC's frame"). three sorts them by material id, so the
// programs come mixed: each change of program uploads the lights and the camera again. `byProgram` puts the draws of one program in a row,
// then by material, then front to back. The depth buffer makes the picture the same in any order.
// Use: `renderer.setOpaqueSort(byProgram)`, and `rankMaterials` after a frame that drew new materials.
import type { Material, Mesh, Object3D } from 'three';

interface Ranked { _rank?: number }

/** One draw of three's render list (the fields the sort reads). */
export interface DrawItem { id: number; groupOrder: number; renderOrder: number; z: number; material: Material }

/** three's own opaque order, with the material's program rank before its id. A material with no rank yet sorts first. */
export function byProgram(a: DrawItem, b: DrawItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  const ma = a.material, mb = b.material;
  if (ma !== mb) {
    const d = ((ma as Ranked)._rank ?? 0) - ((mb as Ranked)._rank ?? 0);
    if (d !== 0) return d;
    if (ma.id !== mb.id) return ma.id - mb.id;
  }
  if (a.z !== b.z) return a.z - b.z;
  return a.id - b.id;
}

/** Give each material under `root` its program's number (`programOf`: 0 when it has none yet) as its rank for `byProgram`. */
export function rankMaterials(root: Object3D, programOf: (m: Material) => number): void {
  root.traverse((o) => {
    const m = (o as Mesh).material as Material | Material[] | undefined;
    if (!m) return;
    if (Array.isArray(m)) for (const a of m) (a as Ranked)._rank = programOf(a);
    else (m as Ranked)._rank = programOf(m);
  });
}
