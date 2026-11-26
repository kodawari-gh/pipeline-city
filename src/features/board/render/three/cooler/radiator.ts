// The loop's radiator as the model and the airflow lens share it (cooler3d.ts): its depth across the case, the layout of its flat coolant tubes,
// its two ports, and the coolant's way through it (`radiatorFlow`).
import type { V3 } from '@/core/render/three/rope';
import { FAN_MAX, FAN_ZC } from '@/features/room/render/three/roomplan';
import { FAN_LEN } from '../../layout/layout';
import { TANK, frameOf, radiatorCore } from '../../cooler';
import type { RadiatorFit } from './types';

/** How deep the radiator is across the case: one fan's side and a side plate's lip each side, centred on the fans' depth (`FAN_ZC`). */
export const radiatorDepth = (): number => Math.min(FAN_LEN, FAN_MAX) + 80;
/** How far apart the radiator's two ports are across its depth (a G1/4 fitting's hex is 19 mm across), and how far its end tanks stand proud of its core. */
const PORT_DZ = 700;
export const TANK_LIP = 10;
/** The side plates' thickness, and the pitch of the flat tubes across the radiator's depth (the model's and the airflow lens's water share one layout). */
export const RAD_PLATE = 34;
const TUBE_PITCH = 225;

/** The radiator's flat coolant tubes across its depth `D`: how many, their pitch, and the depth where the first one's row starts. */
export function radiatorTubeLayout(D = radiatorDepth()): { n: number; pitch: number; z0: number } {
  const inner = D - 2 * RAD_PLATE,
    n = Math.max(1, Math.round(inner / TUBE_PITCH));
  return { n, pitch: inner / n, z0: FAN_ZC - D / 2 + RAD_PLATE };
}

/**
 * The radiator's two ports, on the inboard face of the tank nearer the pump: at the tank's middle, one either side of the radiator's middle depth,
 * the one nearer the board first. `at`: where its fitting screws in (world); `dir`: inboard, the way the fitting points.
 */
export function radiatorPorts3d(fit: RadiatorFit): { at: V3; dir: V3 }[] {
  const fr = frameOf(fit.mount, fit.end),
    p = fr.P(-TANK / 2, radiatorCore(fit).v1 + TANK_LIP),
    dir: V3 = [fr.inward[0], -fr.inward[1], 0];
  return [-PORT_DZ / 2, PORT_DZ / 2].map((dz) => ({ at: [p[0], -p[1], FAN_ZC + dz], dir }));
}

/**
 * The radiator on its side of the case, inboard of that side's fans (`ids`: the mounts it spans, in order along it; the fans stay the case's, on
 * their mounts). Its core is as thick as its grade (`RAD_T`) and as deep as a fan's side: flat coolant tubes from tank to tank, the fins between
 * them (`FIN_PITCH`), a side plate down each edge folded over both faces, and in the folds the four screw holes of each mount's fan on each face
 * (push or pull). An end tank past the fans at each end (`TANK`), each closed by an end cap: the near one (to the pump) with the two G1/4 ports
 * and their fittings, the far one with the fill plug.
/** The coolant's way through a radiator, for the airflow lens (`air/plan.ts` `waterNet`): world points, y up. */
export interface RadiatorFlow {
  /** Each flat tube, from the near tank's middle (where the ports are) to the far tank's, in the core's middle plane, at its own depth. */
  tubes: { a: V3; b: V3 }[];
  /** The two ports (where the fittings screw into the near tank's inboard face, the one nearer the board first), the way a fitting points (inboard), and how far the core's middle plane is from them. */
  ports: V3[];
  inward: V3;
  reach: number;
  /** Half the core's thickness: the lens draws the water in and the water out a half of it either side of the middle plane. */
  half: number;
}

/** The radiator's tubes and ports as the model builds them (`radiatorModel`): the lens runs the water along them. */
export function radiatorFlow(fit: RadiatorFit): RadiatorFlow {
  const fr = frameOf(fit.mount, fit.end),
    { v0, v1 } = radiatorCore(fit),
    vm = (v0 + v1) / 2,
    lay = radiatorTubeLayout();
  const at = (u: number, z: number): V3 => {
    const p = fr.P(u, vm);
    return [p[0], -p[1], z];
  };
  const tubes = Array.from({ length: lay.n }, (_, k) => {
    const z = lay.z0 + (k + 0.5) * lay.pitch;
    return { a: at(-TANK / 2, z), b: at(fr.L + TANK / 2, z) };
  });
  return {
    tubes,
    ports: radiatorPorts3d(fit).map((p) => p.at),
    inward: [fr.inward[0], -fr.inward[1], 0],
    reach: v1 + TANK_LIP - vm,
    half: (v1 - v0) / 2,
  };
}
