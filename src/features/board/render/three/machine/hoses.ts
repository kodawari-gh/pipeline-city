// The liquid loop's hoses (machine3d.ts): from the pump's ports to the radiator's, with a pump and a radiator both fitted.
import { PartSkin } from '@/core/render/three/materials';
import { HOSE_COLD, HOSE_HOT, LoopHoses, hoseEnds } from '../cooler3d';
import { caseEnv } from './bodies';
import { relist } from './list';
import type { MachineParts } from './types';

/**
 * The loop's hoses, only with its pump and a radiator both fitted (`hasLoop`): stiff braided hoses arcing from the pump's ports to the
 * radiator's. The room never moves them: they join the cooler (its merges, its stand-ins, its fade). Build my PC poses them live, so
 * there they stay as they are (`keep`) and fade with the cooler.
 */
export function* hoses(m: MachineParts): Generator<void> {
  if (!m.pump || !m.rad) {
    return;
  }
  const h = new LoopHoses(
    hoseEnds(m.rad.fit),
    caseEnv(
      m,
      m.obstacles.filter((o) => o.userData['cooler'] === true || o.userData['radiator'] === true),
    ),
  );
  m.hosePaths = h.paths();
  // (each hose's sleeve glows by its own water in the thermal view: the hot one first)
  m.hoseSkins = h.skins.map((mat, i) => [i > 0 ? HOSE_COLD : HOSE_HOT, new PartSkin([mat], 1, false)]);
  if (m.inRoom && m.cooler) {
    m.cooler.add(h.body);
  } else {
    m.hoses = h;
    m.root.add(h.root);
  }
  relist(m);
  yield;
}
