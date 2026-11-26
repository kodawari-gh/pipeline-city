// The room's shell: the back wall round the glass and the building's column in it, the other walls and the ceiling, the skirting and the
// shadow gap, the oak floor and the rug.
import { bakedTex } from '@/core/render/three/baked';
import { rectBox, shareTex, softBox } from '@/core/render/three/geometry';
import { cloth, mat } from '@/core/render/three/materials';
import { CEILING } from '../palette';
import { CEIL_Y, DOOR, EAST_X, FRONT_Z, PIER, RUG, WALL_T, WEST_X, WINDOW, wallAround } from '../roomplan';
import { rugMap } from './cloth';
import { oakFloor } from './planks';
import type { Build, Material, Mesh, Rect } from './types';

/** The skirting's height. */
const SK = 1100;
/** A run of skirting: along x from `x0` to `x1`, along z from `z0` to `z1`, and the way its face looks. */
interface Run {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  out: 'x' | '-x' | 'z' | '-z';
}

/** The other walls and the ceiling take light and cast no shadow: the eye is always inside. */
const shell = (m: Mesh): Mesh => {
  m.castShadow = false;
  return m;
};

/** A piece of the skirting or the shadow gap (`m`: the trim's tone by default). */
const skirt = (r: Rect, [z0, z1]: [number, number], m: Material): Mesh => shell(softBox(r, z0, z1, m, 20));

/** A run's face: along the wall it runs on, its height the skirting's. */
function runRect({ x0, x1, out }: Run, fl: number): Rect {
  if (out === 'z' || out === '-z') {
    return { x: x0, y: fl - SK, w: x1 - x0, h: SK };
  }
  if (out === 'x') {
    return { x: x0, y: fl - SK, w: 110, h: SK };
  }
  return { x: x1 - 110, y: fl - SK, w: 110, h: SK };
}

/** A run's depth: 110 out of the back or the front wall, or the whole run on a side wall. */
function runDepth({ z0, z1, out }: Run): [number, number] {
  if (out === 'z') {
    return [z0, z0 + 110];
  }
  if (out === '-z') {
    return [z1 - 110, z1];
  }
  return [z0, z1];
}

/**
 * The back wall: plaster round the glass (a slot over it, a low upstand under it, the corner to the west, the bed's wall to the east) and the
 * building's column in it, which carries the things on the wall. Then the other walls and the ceiling.
 */
export function buildWalls({ R, fl, H, wall }: Build): void {
  const W = WINDOW;
  for (const r of wallAround(WEST_X, EAST_X, CEIL_Y, fl, W)) {
    R.add(wall(r, -WALL_T, 0));
  }
  R.add(wall({ x: PIER.x0, y: W.y, w: PIER.x1 - PIER.x0, h: W.h }, -WALL_T, 0));
  R.add(shell(wall({ x: WEST_X - 1200, y: CEIL_Y, w: 1200, h: H }, -WALL_T, FRONT_Z + 1200)));
  R.add(shell(wall({ x: EAST_X, y: CEIL_Y, w: 1200, h: H }, -WALL_T, FRONT_Z + 1200)));
  R.add(shell(wall({ x: WEST_X - 1200, y: CEIL_Y, w: EAST_X - WEST_X + 2400, h: H }, FRONT_Z, FRONT_Z + 1200)));
  const ceiling = shell(
    rectBox(
      { x: WEST_X - 1200, y: CEIL_Y - 1200, w: EAST_X - WEST_X + 2400, h: 1200 },
      -WALL_T,
      FRONT_Z + 1200,
      mat(CEILING, { roughness: 0.95 }),
    ),
  );
  ceiling.name = 'ceiling';
  R.add(ceiling);
}

/** A low flush skirting, square-edged, and a shadow gap where the walls meet the ceiling (no cornice); the door breaks the skirting on the west wall. */
export function buildSkirting({ R, fl, trim }: Build): void {
  const runs: Run[] = [
    { x0: WEST_X, x1: EAST_X, z0: 0, z1: 0, out: 'z' },
    { x0: WEST_X, x1: WEST_X, z0: 0, z1: DOOR.z0 - 980, out: 'x' },
    { x0: WEST_X, x1: WEST_X, z0: DOOR.z1 + 980, z1: FRONT_Z, out: 'x' },
    { x0: EAST_X, x1: EAST_X, z0: 0, z1: FRONT_Z, out: '-x' },
    { x0: WEST_X, x1: EAST_X, z0: FRONT_Z, z1: FRONT_Z, out: '-z' },
  ];
  for (const run of runs) {
    R.add(skirt(runRect(run, fl), runDepth(run), trim));
  }
  const gap = mat(0x13_15_18, { roughness: 0.9 });
  R.add(skirt({ x: WEST_X, y: CEIL_Y, w: EAST_X - WEST_X, h: 220 }, [0, 40], gap));
  R.add(skirt({ x: WEST_X, y: CEIL_Y, w: 40, h: 220 }, [0, FRONT_Z], gap));
  R.add(skirt({ x: EAST_X - 40, y: CEIL_Y, w: 40, h: 220 }, [0, FRONT_Z], gap));
}

/** The floor: long smoked oak planks; a flat charcoal rug under the bed's west side (`RUG`). */
export function buildFloor({ R, fl }: Build): void {
  const floor = oakFloor();
  floor.name = 'oak floor';
  R.add(floor);
  const pile = shareTex(bakedTex('room-rug')) ?? rugMap();
  const rug = softBox(
    { x: RUG.x0, y: fl - RUG.h, w: RUG.x1 - RUG.x0, h: RUG.h },
    RUG.z0,
    RUG.z1,
    cloth(0xff_ff_ff, { map: pile, bumpMap: pile, bumpScale: 1, roughness: 0.97 }),
    140,
  );
  rug.castShadow = false;
  rug.name = 'rug';
  R.add(rug);
}
