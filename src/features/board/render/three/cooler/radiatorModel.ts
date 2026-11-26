// The loop's radiator (cooler3d.ts): the 2D one stood up across the case, inboard of its side's fans; a core as thick as its grade and as deep
// as a fan, an end tank past the fans at each end.
import type { MeshStandardMaterial } from 'three';
import { mat } from '@/core/render/three/materials';
import { mergeStatic } from '@/core/render/three/merge';
import type { RadiatorFit } from '../../cooler';
import { radAlu } from './look';
import type { Model } from './model';
import { radCore, radHoles, radPlates } from './radCore';
import { radPorts, radTanks } from './radEnds';
import { radOf } from './radFrame';
import { radPlate } from './radPlate';

/**
 * The radiator on its side of the case, inboard of that side's fans (`ids`: the mounts it spans, in order along it; the fans stay the case's, on
 * their mounts). Its core is as thick as its grade (`RAD_T`) and as deep as a fan's side: flat coolant tubes from tank to tank, the fins between
 * them (`FIN_PITCH`), a side plate down each edge folded over both faces, and in the folds the four screw holes of each mount's fan on each face
 * (push or pull). An end tank past the fans at each end (`TANK`), each closed by an end cap: the near one (to the pump) with the two G1/4 ports
 * and their fittings, the far one with the fill plug.
 */
export function radiatorModel(fit: RadiatorFit, grade: 1 | 2 | 3, ids: readonly string[]): Model {
  const rad = radOf(fit);
  // (neutral brushed aluminium, a satin finish: the cooler's blue ramp at full metalness mirrors the dark case and reads purple there)
  // (two tones, as the palette gives them: the plates and the caps dark, the tanks and the tubes light)
  const plateM = radAlu(0x6a_6f_79, 0.42),
    bodyM = radAlu(0x7b_80_8a, 0.35),
    dark = mat(0x13_15_18, { roughness: 0.6 });
  const finM = radCore(rad, grade, bodyM);
  radPlates(rad, plateM);
  radHoles(rad, ids.length, dark);
  const edgeM = radPlate(rad, ids.length);
  radTanks(rad, bodyM, plateM);
  radPorts(rad, fit);
  // (what glows in the thermal view: the whole aluminium body, the fins and the tubes with it. A skin's material is left out of the palette merge,
  // so its still meshes merge here, by material: the plates and caps, the tanks and tubes, the lit edges and the fins are four draws)
  const skin: MeshStandardMaterial[] = [plateM, bodyM, edgeM, finM];
  mergeStatic(rad.root, { own: true, ok: (x) => skin.some((s) => s === x.material) });
  return { root: rad.root, spins: [], skin };
}
