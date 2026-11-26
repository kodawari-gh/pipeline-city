// The loop's pump body and cap (cooler3d.ts): a round anodised body, a thin light ring under a brushed cap with a diamond-cut edge, and the cap's
// window of black glass with the maker's mark under it (the impeller is inside, unseen).
import { CylinderGeometry, Mesh } from 'three';
import { drum, fanSides, place } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough } from '@/core/render/three/pick';
import { decal } from '../casekit3d';
import { glowMat, light } from '../fans3d';
import { L, capMark, capMat } from './look';
import { PUMP } from './plan';
import type { Group, Material, MeshStandardMaterial, Spin } from './types';

/** The sides of each round of the pump: one count, so its bands, foot and cap meet edge to edge. The polished chamfer shows each side, so it takes a 120 mm fan's count. */
const PUMP_SIDES = fanSides(120);
/** A round band standing along z, open at both ends, from depth `z0` (radius `r0`) to `z1` (radius `r1`): a body's side, a chamfer, a light ring. */
function band3(r: readonly [number, number], z: readonly [number, number], m: Material): Mesh {
  const [r0, r1] = r,
    [z0, z1] = z;
  const o = place(new Mesh(new CylinderGeometry(r1, r0, z1 - z0, PUMP_SIDES, 1, true).rotateX(Math.PI / 2), m));
  o.position.z = (z0 + z1) / 2;
  return o;
}

/**
 * The cap's window: a disc of black glass in a polished lip, proud of the brushed face, the maker's mark printed under it (`capMark`). No light of
 * its own: it mirrors the room, and the ring under the cap is the pump's only light.
 */
function capWindow(g: Group, polished: Material) {
  const { top } = PUMP,
    WIN = 500;
  g.add(band3([WIN + 26, WIN], [top, top + 10], polished));
  g.add(drum(0, 0, top + 2, top + 7, WIN, mat(0x05_06_08, { metalness: 0, roughness: 0.06 }), PUMP_SIDES));
  const mark = capMark();
  if (mark) {
    g.add(
      decal(
        { x: -WIN * 0.6, y: -WIN * 0.6, w: WIN * 1.2, h: WIN * 1.2 },
        top + 7.5,
        mat(0xff_ff_ff, { map: mark, alphaTest: 0.5, alphaToCoverage: true, metalness: 0.3, roughness: 0.35 }),
      ),
    );
  }
}

/** The pump's body on its base, the light ring and the cap; the body's material (its skin) back. */
export function pumpBody(g: Group, spins: Spin[], black: Material): MeshStandardMaterial {
  const { R, R0, top } = PUMP;
  // the body: anodised dark aluminium (satin, as the radiator's: it keeps its grey in the case's shade), a little wider at its foot; a seam where
  // it meets the base
  const side = mat(0x2a_2d_32, { metalness: 0.45, roughness: 0.4 }),
    z1 = top - 126;
  g.add(band3([R0, R], [L + 250, z1], side));
  g.add(drum(0, 0, L + 250, L + 262, R0 + 6, black, PUMP_SIDES));
  // a thin light ring under the cap, set a little in: smoked when off (a dark line between the body and the cap), lit in the case's colour with
  // the fans
  const ringM = glowMat(0xff_ff_ff, 0x14_16_1b);
  ringM.roughness = 0.7;
  g.add(seeThrough(band3([R - 6, R - 6], [z1, z1 + 46], ringM)));
  spins.push(light(ringM, undefined, 1.4));
  // the cap: its side, a bright diamond-cut chamfer round its face, the face brushed in rings; a small raised boss in the middle, dark satin in a
  // polished bevel (a hole if it were all dark)
  const polished = mat(0xb9_ba_bf, { metalness: 0.95, roughness: 0.14 });
  g.add(band3([R, R], [z1 + 46, top - 34], side));
  g.add(band3([R, R - 40], [top - 34, top], polished));
  g.add(drum(0, 0, top - 4, top, R - 40, capMat(), PUMP_SIDES));
  capWindow(g, polished);
  return side;
}
