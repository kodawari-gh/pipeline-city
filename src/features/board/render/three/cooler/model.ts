// The cooler on the CPU (cooler3d.ts), by its spec's `visual`: the stock heatsink, the tower or the loop's pump head, with the fans fitted on it.
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { Group } from 'three';
import type { MeshStandardMaterial } from 'three';
import type { RadiatorFit } from '../../cooler';
import type { FanFit, Spin } from '../fans3d';
import { liquid } from './pump';
import { stock } from './stock';
import { tower } from './tower';

export interface Model {
  root: Group;
  spins: Spin[];
  /** The materials that follow the part's state (`PartSkin`). */ skin: MeshStandardMaterial[];
}
/** The radiator the loop's hoses run to: where it is bolted and how many of the case's fan mounts it spans. */
export interface RadiatorAt {
  fit: RadiatorFit;
  count: number;
}

/** The cooler on the CPU, by its spec's `visual` (the loop's hoses are `hose`'s), with the fans fitted on its spots: without any, a bare heatsink. */
export function coolerModel(visual: string, fans: readonly FanFit[] = []): Model {
  const root = new Group(),
    spins: Spin[] = [];
  let m: MeshStandardMaterial;
  if (visual === 'cooler-liquid') {
    m = liquid(root, spins);
  } else if (visual === 'cooler-tower') {
    m = tower(root, spins, fans);
  } else {
    m = stock(root, spins, fans);
  }
  return { root, spins, skin: [m] };
}
