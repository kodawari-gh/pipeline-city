// The machine's boxes (machine3d.ts): a part's, the case's body, what the air meets, what the cables keep clear of, and the roots a pick or a
// swap reads.
import { Box3 } from 'three';
import { findById } from '@/core/render/three/pick';
import { BOARD_Z, CASE_FRONT as FRONT, CASE_Z } from '@/features/room/render/three/roomplan';
import { BD, CASE_IN } from '../../layout/layout';
import { cageBox } from '../drivecage3d';
import { TRAY_Z } from '../wires3d';
import { builds } from './list';
import type { AirBody, Env, MachineParts, Object3D, RopeSolid, V3 } from './types';

/** The box over the layout rect `r` (y flipped) from depth `z0` to `z1`. */
export const slab = (r: { x: number; y: number; w: number; h: number }, z0: number, z1: number): RopeSolid => ({
  min: [r.x, -(r.y + r.h), z0],
  max: [r.x + r.w, -r.y, z1],
});

/** A part's box in the machine's space (its device id), or null: the power lens hangs its words over it. */
export function partBox(m: MachineParts, id: string): { min: V3; max: V3 } | null {
  const o = findById(m.root, id);
  const b = o ? new Box3().setFromObject(o) : null;
  return b && !b.isEmpty() ? { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] } : null;
}

/** The board's pieces: everything on the root that is not the case, the cables or a light (a board swap lifts these). */
export function boardRoots(m: MachineParts): Object3D[] {
  const skip = new Set<Object3D>([...m.caseRoots, m.wires, m.rgb, m.spill]);
  return m.root.children.filter((o) => !skip.has(o));
}

/** The box of the case without its side panel: the parts, the cables and the mains cord stay in or near it (a picture of the machine frames this: `BuildStage.capture`). */
export function bodyBox(m: MachineParts): Box3 {
  const door = m.door?.cm.door,
    box = new Box3();
  m.root.updateMatrixWorld(true);
  for (const o of m.caseRoots) {
    if (o !== door && o.visible) {
      box.union(new Box3().setFromObject(o));
    }
  }
  return box;
}

/** The basement's box: under the shroud, from the case's west wall to the basement's east. */
const basementBox = (m: MachineParts): RopeSolid =>
  slab({ x: CASE_IN.x, y: m.plan.top, w: m.plan.east - CASE_IN.x, h: m.plan.floor - m.plan.top }, CASE_Z, FRONT);

/** The case's solid bodies that no part and no zoom takes away: the basement (the shroud) and the drive cage. */
function solidBodies(m: MachineParts): AirBody[] {
  return [
    { id: 'basement', kind: 'basement', ...basementBox(m) },
    { id: 'cage', kind: 'cage', ...cageBox(m.cage) },
  ];
}

/**
 * The boxes the air meets, in the machine's space (the airflow lens, air/plan.ts): the case's fixed bodies (the board, the basement, the drive cage, the
 * memory bank) and each part that stands in the way (cooler, cards, sinks, radiator), by device id. The parts' are the boxes the cables go round.
 */
export function airBodies(m: MachineParts): AirBody[] {
  const out: AirBody[] = [{ id: 'board', kind: 'board', ...slab(BD, CASE_Z, BOARD_Z) }, ...solidBodies(m)];
  if (m.ram) {
    out.push({ id: 'ram', kind: 'ram', ...slab(m.ram, BOARD_Z, BOARD_Z + 380) });
  }
  for (const o of builds(m)) {
    for (const ob of o.obstacles) {
      const b = m.solids.get(ob);
      if (b) {
        const [x0, y0, z0] = b.min,
          [x1, y1, z1] = b.max;
        out.push({ id: o.id, kind: o.kind, slot: o.slot, min: [x0, y0, z0], max: [x1, y1, z1] });
      }
    }
  }
  return out;
}

/** Run `draw` with the side panel taken off: the picture of an open machine, whatever the panel's kind (a steel one hides the inside, a glass one tints it). */
export function withoutDoor<T>(m: MachineParts, draw: () => T): T {
  const door = m.door?.cm.door,
    was = door?.visible ?? true;
  if (door) {
    door.visible = false;
  }
  try {
    return draw();
  } finally {
    if (door) {
      door.visible = was;
    }
  }
}

/** What the cables inside the case keep clear of: the tray, the glass, the top, the shroud, the drive cage, the board, and the parts that stand in their way. */
export function caseEnv(m: MachineParts, skip: readonly Object3D[] = []): Env {
  const solids: RopeSolid[] = [slab(BD, CASE_Z, BOARD_Z), basementBox(m), cageBox(m.cage)];
  if (m.ram) {
    solids.push(slab(m.ram, BOARD_Z, BOARD_Z + 380));
  }
  for (const [o, b] of m.solids) {
    if (!skip.includes(o)) {
      solids.push(b);
    }
  }
  return {
    planes: [
      { n: [0, 0, 1], d: TRAY_Z },
      { n: [0, 0, -1], d: -(FRONT - 50) },
      { n: [0, -1, 0], d: CASE_IN.y },
      { n: [1, 0, 0], d: CASE_IN.x },
      { n: [-1, 0, 0], d: -(CASE_IN.x + CASE_IN.w) },
    ],
    solids,
  };
}
