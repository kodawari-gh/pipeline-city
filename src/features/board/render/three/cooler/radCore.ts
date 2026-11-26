// The radiator's core (cooler3d.ts `radiatorModel`): the fins painted on its faces, the flat tubes across its depth, the side plates folded over
// both faces, and the fans' screw holes in the folds.
import { CylinderGeometry } from 'three';
import { SEG, instanced } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { FAN_LEN } from '../../layout/layout';
import { FIN_PITCH, radiatorFanUs } from '../../cooler';
import { tiled } from '../casekit3d';
import { finLadder } from './look';
import { RAD_PLATE, radiatorTubeLayout } from './radiator';
import { boxes, item } from './radFrame';
import type { Material, MeshStandardMaterial, Rad } from './types';

/** The fins' pitch for each grade of radiator (`FIN_PITCH`). */
const PITCH = { 1: FIN_PITCH[0], 2: FIN_PITCH[1], 3: FIN_PITCH[2] } as const;

/**
 * The core: the fins painted on its faces (fins this fine shimmer as plates; painted, they blend into one tone from afar), the flat tubes a
 * tube's pitch apart across its depth, their edges a little proud of both faces. The fins' material back.
 */
export function radCore(rad: Rad, grade: 1 | 2 | 3, bodyM: Material): MeshStandardMaterial {
  const { root, fr, L, v0, t, side, D, z0, z1 } = rad,
    PLATE = RAD_PLATE;
  const n = L / PITCH[grade],
    { n: tubes, pitch: tp } = radiatorTubeLayout(D);
  const finM = mat(0xff_ff_ff, {
    map: side === 'front' ? tiled(finLadder('v'), 1, n) : tiled(finLadder('u'), n, 1),
    metalness: 0.5,
    roughness: 0.5,
  });
  const fins = item(fr.rect(0, v0 + 2, L, t - 4), z0 + PLATE, z1 - PLATE);
  root.add(...boxes(rad, finM, [fins]));
  const tubeItems = Array.from({ length: tubes }, (_, k) =>
    item(fr.rect(0, v0, L, t), z0 + PLATE + (k + 0.5) * tp - 20, z0 + PLATE + (k + 0.5) * tp + 20),
  );
  root.add(...boxes(rad, bodyM, tubeItems));
  return finM;
}

/** The side plates, each folded over both faces. */
export function radPlates(rad: Rad, plateM: Material): void {
  const { root, fr, L, v0, v1, t, z0, z1, fold } = rad,
    PLATE = RAD_PLATE;
  const plates = [z0, z1 - PLATE].map((za) => item(fr.rect(0, v0 - 6, L, t + 12), za, za + PLATE));
  for (const [za, zb] of [
    [z0, z0 + fold],
    [z1 - fold, z1],
  ] as const) {
    for (const va of [v0 - 6, v1]) {
      plates.push(item(fr.rect(0, va, L, 6), za, zb));
    }
  }
  root.add(...boxes(rad, plateM, plates));
}

/** The fans' screw holes in the folds, on both faces (`count`: the mounts the radiator spans). */
export function radHoles(rad: Rad, count: number, dark: Material): void {
  const { root, fr, L, v0, v1, side, zc, hole } = rad;
  const holeGeo = new CylinderGeometry(42, 42, 4, SEG.post);
  if (side === 'front') {
    holeGeo.rotateZ(Math.PI / 2);
  }
  const holes: { x: number; y: number; z: number }[] = [];
  for (const u of radiatorFanUs(L, count)) {
    for (const du of [-hole, hole]) {
      for (const dz of [-hole, hole]) {
        for (const v of [v0 - 7, v1 + 7]) {
          const p = fr.P(u + Math.min(FAN_LEN, L) / 2 + du, v);
          holes.push({ x: p[0], y: -p[1], z: zc + dz });
        }
      }
    }
  }
  root.add(instanced(holeGeo, dark, holes));
}
