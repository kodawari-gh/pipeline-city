// The loop's hoses (cooler3d.ts): two 12 mm braided hoses that arc from the G1/4 fittings in the pump's port block to the radiator's, hung round
// the parts in their way (`hose`; `LoopHoses` is the rig that poses them).
import { Group, Vector3 } from 'three';
import { hang } from '@/core/render/three/rope';
import type { RadiatorFit } from '../../cooler';
import { band, braidedTube } from '../cables3d';
import { FIT, HOSE_R, nth } from './kit';
import { alu } from './look';
import { PUMP, portY } from './plan';
import { radiatorPorts3d } from './radiator';
import type { Env, MeshStandardMaterial, RopeEnd, RopeSpec, V3 } from './types';

/** A hose's end in a fitting at `at` pointing along `dir`: where it leaves the fitting's collar. */
const inFitting = (at: V3, dir: V3): RopeEnd => ({
  at: [at[0] + dir[0] * (FIT.len - 40), at[1] + dir[1] * (FIT.len - 40), at[2] + dir[2] * (FIT.len - 40)],
  dir,
});

/**
 * Where the loop's hoses start and end: in the fittings of the pump's two ports (north) and of the radiator's two (`radiatorPorts3d`). The port
 * nearer the radiator's tank goes to the radiator's port nearer the board, so the two hoses do not cross.
 */
export function hoseEnds(fit: RadiatorFit): [RopeEnd, RopeEnd][] {
  const rad = radiatorPorts3d(fit).map((p) => inFitting(p.at, p.dir)),
    [tx] = nth(rad, 0).at;
  const pump = [-PUMP.portX, PUMP.portX]
    .map((sx) => inFitting([sx, portY(), PUMP.portZ], [0, 1, 0]))
    .toSorted((p, q) => Math.abs(p.at[0] - tx) - Math.abs(q.at[0] - tx));
  return [
    [nth(pump, 0), nth(rad, 0)],
    [nth(pump, 1), nth(rad, 1)],
  ];
}

/** A hose's rope: a stiff hose a little longer than its gap, its ends leaving straight out of the fittings. */
export const hoseRope = (a: RopeEnd, b: RopeEnd, env: Env): RopeSpec => ({
  a,
  b,
  length: Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]) * 1.12 + 300,
  r: HOSE_R,
  stiff: 0.95,
  n: 30,
  lead: 220,
  ...env,
});
/** The hoses' sleeve (the 2D tube's dark sleeve, its weave 38 % of the way to the loop's accent) and their crimped ferrules. */
export const HOSE_LOOK = ['#0c1226', '#464078'] as const,
  ferruleMat = (): MeshStandardMaterial => alu(0x2a_30_48, 0.32);

/** One of the loop's hoses: a stiff braided hose arcing between its ends, a crimped ferrule at each end. */
export function hose(a: RopeEnd, b: RopeEnd, env: Env): Group {
  const g = new Group(),
    pts = hang(hoseRope(a, b, env));
  const { mesh, curve } = braidedTube(
      pts.map((p) => new Vector3(p[0], p[1], p[2])),
      HOSE_R,
      ...HOSE_LOOK,
    ),
    len = curve.getLength(),
    ferrule = ferruleMat();
  g.add(mesh);
  for (const s of [70, len - 70]) {
    g.add(band(curve, s, HOSE_R + 20, 140, ferrule));
  }
  return g;
}

/** The ids the loop's two hoses wear in the thermal view (`Machine3D.thermal`): the airflow lens gives each the temperature of its water. */
export const HOSE_HOT = 'hose.hot',
  HOSE_COLD = 'hose.cold';
