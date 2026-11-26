// The stock heatsink's shroud (cooler3d.ts): a plastic shroud over the vanes on four push pins, and the two latches that hold the fan down.
import type { Group, Material } from 'three';
import { SEG, instanced, rectBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { COOLER_HOLES } from '../../layout/layout';
import { outlinePts, shapeOf, slab } from '../casekit3d';
import { atHoles, circle, screws, upright } from './kit';
import { SHROUD } from './plan';

/** The shroud over the vanes, on a push pin at each hole: its foot on the board, its leg up to the shroud, its head sunk in the shroud's corner. */
export function stockShroud(g: Group, black: Material): void {
  const { w, z0, z1 } = SHROUD,
    shape = shapeOf(outlinePts({ x: -w / 2, y: -w / 2, w, h: w }, 220, undefined, SEG.cornerSoft), [
      circle({ x: 0, y: 0 }, 1000),
    ]);
  g.add(slab(shape, z0, z1, black, 8));
  g.add(
    instanced(upright(100, 104, SEG.drum), black, atHoles(BOARD_Z, BOARD_Z + 40)),
    instanced(upright(64, 70, SEG.disc), black, atHoles(BOARD_Z + 40, z0 - 90)),
  );
  g.add(
    instanced(upright(94, 72, SEG.drum), black, atHoles(z0 - 90, z0)),
    instanced(upright(84, 84, SEG.drum), mat(0x05_06_08, { roughness: 0.8 }), atHoles(z1 - 30, z1 + 2)),
  );
  screws(g, COOLER_HOLES, { z: z1 - 18, r: 50 });
  // the two latches that hold the fan down by its flange; the fan blows down into the vanes (it has no light)
  for (const s of [-1, 1]) {
    const y0 = s < 0 ? -w / 2 : w / 2 - 26;
    g.add(
      rectBox({ x: -150, y: y0, w: 300, h: 26 }, z1 - 4, z1 + 118, black),
      rectBox({ x: -150, y: s < 0 ? -w / 2 : w / 2 - 60, w: 300, h: 60 }, z1 + 88, z1 + 118, black),
    );
  }
}
