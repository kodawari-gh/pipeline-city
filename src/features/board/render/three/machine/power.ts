// The machine's lenses on its parts (machine3d.ts): the airflow lens's thermal view and the power lens's glow, with the materials it splits off.
import { MeshStandardMaterial } from 'three';
import { PartSkin } from '@/core/render/three/materials';
import { heatOf } from '@/core/render/three/thermal';
import { findById } from '@/core/render/three/pick';
import { SHROUD } from '../basement3d';
import { RING_IN_LENS } from './consts';
import type { MachineParts, Material, Mesh, Object3D, Role } from './types';

/** The thermal view's scale (`thermal`): its foot and its top. */
export interface HeatScale {
  lo: number;
  hi: number;
}

/**
 * The airflow lens's thermal view (docs/render/air.md): each part with a skin glows by its temperature (`temps`, by device id; a part not in it is at the
 * scale's foot) on the thermal scale from `lo` to `hi`, and eases there. Null puts every part's own look back.
 */
export function thermal(m: MachineParts, temps: ReadonlyMap<string, number> | null, { lo, hi }: HeatScale): void {
  for (const [id, sk] of m.skins) {
    sk.thermal(temps ? heatOf(temps.get(id) ?? lo, lo, hi) : null);
  }
}

/** A mesh with a plain material of its own look (no glow): the lens may give it a copy. */
const plainLook = (o: Object3D): o is Mesh & { material: MeshStandardMaterial } => {
  if (!('isMesh' in o) || o.isMesh !== true) {
    return false;
  }
  const src = 'material' in o ? o.material : null;
  return src instanceof MeshStandardMaterial && src.emissive.getHex() === 0;
};

/** The part tagged `id` inside `root` gets a copy of each of its materials that no other part shares, so the lens can light one fan alone. A glow of the part's own (a fan's ring of light) is left as it is. */
export function splitPart(m: MachineParts, id: string, root: Object3D): void {
  const part = findById(root, id);
  if (!part) {
    return;
  }
  const copies = new Map<MeshStandardMaterial, MeshStandardMaterial>();
  part.traverse((o) => {
    if (!plainLook(o)) {
      return;
    }
    const mesh = o,
      src = mesh.material;
    let c = copies.get(src);
    if (!c) {
      c = src.clone();
      copies.set(src, c);
    }
    m.powerWas.set(mesh, src);
    mesh.material = c;
  });
  if (copies.size > 0) {
    m.powerSkins.set(id, new PartSkin([...copies.values()]));
  }
}

/** Give the lit parts their own materials while the lens shows (`on`), and the shared ones back when it goes. */
function splitParts(m: MachineParts, on: boolean): void {
  if (on === m.powerOn) {
    return;
  }
  m.powerOn = on;
  if (on) {
    for (const [id, root] of m.powerRoots) {
      splitPart(m, id, root);
    }
    return;
  }
  const copies = new Set<Material>();
  for (const [mesh, was] of m.powerWas) {
    // (each is the lens's own copy, one material: `splitPart`)
    if (!Array.isArray(mesh.material)) {
      copies.add(mesh.material);
    }
    mesh.material = was;
  }
  for (const c of copies) {
    c.dispose();
  }
  m.powerWas.clear();
  m.powerSkins.clear();
}

/** The power lens's say: what each part draws, the parts to show red and each part's role (`powerGlow`). */
export interface Glow {
  levels: ReadonlyMap<string, number> | null;
  warn: ReadonlySet<string>;
  roles: ReadonlyMap<string, Role> | null;
}

/** The role a part glows in: its own, or a use for a part in `levels` when no roles are given. */
const roleOf = ({ levels, roles }: Glow, id: string): Role | undefined => {
  if (roles) {
    return roles.get(id);
  }
  return levels?.has(id) === true ? 'use' : undefined;
};

/**
 * The power lens's view of the parts (docs/render/power.md): each power part (`roles`, by device id: a use, a hub or a source) glows by what it draws (`levels`, by
 * device id, 0 to 1 on the power scale) in its role's colour, red for the ids in `warn`. A part with no role (a heatsink, a radiator, a hose) keeps its own look, under
 * the veil. With no `roles` every part in `levels` is a use. Null puts every part's own look back. The basement's shroud is taken off while the lens shows: the
 * supply and the fan hub, two of its hubs, stand under it, and its top sheet hides them from above.
 */
export function powerGlow(m: MachineParts, g: Glow): void {
  const { levels, warn } = g;
  const each = (id: string, sk: PartSkin): void => {
    const role = roleOf(g, id);
    sk.electric(levels && role !== undefined ? (levels.get(id) ?? 0) : null, warn.has(id), role);
  };
  splitParts(m, Boolean(levels));
  for (const [id, sk] of m.skins) {
    each(id, sk);
  }
  for (const [id, sk] of m.powerSkins) {
    each(id, sk);
  }
  const cover = m.root.getObjectByName(SHROUD);
  if (cover) {
    cover.visible = !levels;
  }
  // (the fans' rings of light are a decoration: they go low, or they read as the power of the fan)
  m.ringK = levels ? RING_IN_LENS : 1;
}
