// The case's basement (machine3d.ts): the power supply's shroud and the drive cages over and under it, and the shade the main cage casts on the
// parts under it.
import { lowDetail } from '@/core/render/three/detail';
import { shroud } from '../basement3d';
import { driveCage } from '../drivecage3d';
import { footShade } from '../footshade3d';
import { CAGE_SHADE } from './consts';
import type { CagePlan, CaseKind, CaseModel, MachineParts, Mesh } from './types';

/** A skirt on the floor a cage stands on (its bottom), the cage's footprint between the tray sheet and its front. */
const underCage = (c: CagePlan): Mesh => {
  const m = footShade({ x: c.x0, y: c.z0, w: c.x1 - c.x0, h: c.z1 - c.z0 }, CAGE_SHADE.reach, CAGE_SHADE.peak);
  m.rotation.x = -Math.PI / 2;
  m.position.y = -c.bottom + 2;
  return m;
};

/** The basement's shroud and the drive cages over it and under it, with an empty tray in each free bay; at Low, a skirt under each cage. */
export function basement(m: MachineParts, kind: CaseKind, cm: CaseModel): void {
  // the basement's shroud (its panel over the power supply printed with the case maker's lockup, `basement3d.ts`); over it and under it the
  // drive cages with an empty tray in each free bay (a fitted drive's tray is its device's, `drivecage3d.ts`)
  const bays = new Set(m.devs.filter((d) => d.kind === 'storage' && d.slot.startsWith('sata')).map((d) => d.slot));
  cm.root.add(shroud(m.plan, cm.shroud, cm.rivet, cm.screw), ...m.cages.map((c) => driveCage(c, kind, bays)));
  if (lowDetail()) {
    cm.root.add(...m.cages.map(underCage));
  }
}
