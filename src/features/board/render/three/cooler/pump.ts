// The loop's pump head (cooler3d.ts): a cold plate under a square base and a round body (`pumpBody`) on a four-arm bracket, and the port block on
// its north side with a G1/4 fitting in each of its two ports.
import { BoxGeometry, Mesh, Vector3 } from 'three';
import { SEG, drum, place, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { COOLER_HOLES } from '../../layout/layout';
import { outlinePts, shapeOf, slab } from '../casekit3d';
import { chrome, fitting, mount } from './kit';
import { L, copper, plastic } from './look';
import { PUMP, portY } from './plan';
import { pumpBody } from './pumpCap';
import type { Group, Material, MeshStandardMaterial, Spin } from './types';

/**
 * The copper cold plate on the lid, the square base over it, and the bracket's four black steel arms out of the base to the standoffs, a knurled
 * thumb nut on each.
 */
function pumpBase(g: Group, black: Material, bracket: Material) {
  mount(g, { standoff: L + 60, nut: L + 110 });
  g.add(softBox({ x: -500, y: -500, w: 1000, h: 1000 }, L, L + 50, copper(), 12));
  const base = shapeOf(outlinePts({ x: -820, y: -820, w: 1640, h: 1640 }, 320, undefined, SEG.cornerSoft));
  g.add(slab(base, L + 50, L + 250, black, 20));
  for (const [hx, hy] of COOLER_HOLES) {
    const len = Math.hypot(hx, hy),
      k = (600 + len) / 2 / len,
      arm = place(new Mesh(new BoxGeometry(len - 600, 170, 44), bracket));
    arm.position.set(hx * k, -hy * k, L + 84);
    arm.rotation.z = Math.atan2(-hy, hx);
    g.add(arm, drum(hx, hy, L + 62, L + 108, 120, bracket, SEG.bigDisc));
  }
}

/**
 * The port block on the north side, out of the body's round side, a G1/4 fitting in each of its two ports (the hoses to the radiator hang from
 * them once every part is in: `hose`, machine3d.ts).
 */
function pumpPorts(g: Group, black: Material) {
  const north = new Vector3(0, 1, 0),
    y0 = PUMP.R * 0.6;
  g.add(
    softBox(
      { x: -PUMP.portX - 220, y: -portY(), w: 2 * PUMP.portX + 440, h: portY() - y0 },
      PUMP.portZ - 220,
      PUMP.portZ + 220,
      black,
      50,
    ),
  );
  for (const sx of [-PUMP.portX, PUMP.portX]) {
    fitting(g, { p: new Vector3(sx, portY(), PUMP.portZ), dir: north }, chrome());
  }
}

/** The loop's pump head on `g`; the body's material is its skin. */
export function liquid(g: Group, spins: Spin[]): MeshStandardMaterial {
  const black = plastic(),
    bracket = mat(0x1d_1e_22, { metalness: 0.55, roughness: 0.42 });
  pumpBase(g, black, bracket);
  const side = pumpBody(g, spins, black);
  pumpPorts(g, black);
  return side;
}
