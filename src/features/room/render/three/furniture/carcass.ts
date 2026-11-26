// The bookcase's boards (`bookcase`): its sides, back and plinth in smoked oak, and the shelf-pin holes.
import { CylinderGeometry } from 'three';
import { SEG, instanced } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { BOOKCASE, FLOOR_Y } from '../roomplan';
import { OAK_TILE, grainUv } from './oak';
import { board } from './shapes';
import { CASE_BOARDS } from './strips';
import type { Group, Material, Mesh } from './types';

/** An oak board with its grain along it. */
export const wood = (m: Mesh): Mesh => grainUv(m, OAK_TILE);

/** The carcass: the two sides, the back between them (one plain board in the same finish), the shelf-pin holes up the inside of each side. */
export function caseCarcass(g: Group, oakMat: Material): void {
  const { x, w, z0, z1, top } = BOOKCASE,
    fl = FLOOR_Y,
    xf = x + w,
    { side } = CASE_BOARDS;
  g.add(
    wood(board({ x, y: top, w, h: fl - top }, [z0, z0 + side], oakMat)),
    wood(board({ x, y: top, w, h: fl - top }, [z1 - side, z1], oakMat)),
  );
  g.add(wood(board({ x, y: top, w: 300, h: fl - top }, [z0 + side, z1 - side], oakMat)));
  // (two rows of holes, front and back)
  const pins: { x: number; y: number; z: number }[] = [];
  for (const pz of [z0 + side, z1 - side]) {
    for (const px of [x + 1300, xf - 900]) {
      for (let py = top + 1200; py < fl - 1600; py += 640) {
        pins.push({ x: px, y: -py, z: pz });
      }
    }
  }
  const hole = new CylinderGeometry(70, 70, 24, SEG.smallDisc);
  hole.rotateX(Math.PI / 2);
  g.add(instanced(hole, mat(0x05_06_08, { roughness: 0.9 }), pins));
}

/** The plinth, set back under the bottom shelf (a shadow line along the floor). */
export function casePlinth(g: Group, oakMat: Material): void {
  const { x, w, z0, z1 } = BOOKCASE,
    fl = FLOOR_Y,
    { side } = CASE_BOARDS;
  g.add(wood(board({ x: x + 300, y: fl - 1000, w: w - 700, h: 1000 }, [z0 + side, z1 - side], oakMat)));
}
