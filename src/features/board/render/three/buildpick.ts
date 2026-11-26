// What the pointer means on Build my PC's stage (docs/PC_PARTS.md "Interaction"), as it means it in the game (docs/render/interact.md): the part under
// the pointer is outlined and named, a click picks it, a drag from the shelf outlines every socket that takes the part. Pure: ids, boxes and rectangles.
import { Vector3 } from 'three';
import type * as threeTypes from 'three';
import { boardSlots, deviceSpec, freeSlots, slotAccepts, slotFits } from '@/features/board/sim/board';
import type * as boardTypes from '@/features/board/sim/board';
import { getSpec } from '@/features/board/sim/specs';

/** A rectangle in client pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The sockets that take a catalogue part: the `free` ones, and the `swap` ones, where a part of its kind sits now (a drop there takes that one out
 * first). A whole case or board (`case2`, `board1`) has no socket: nothing.
 */
export function fitSlots(board: boardTypes.Board, item: string): { free: string[]; swap: string[] } {
  const spec = /^(?<kind>case|board)\d$/u.test(item) ? undefined : getSpec(item);
  if (!spec) {
    return { free: [], swap: [] };
  }
  const free = freeSlots(board, spec.slot, spec).map((s) => s.id),
    open = new Set(free);
  const swap = boardSlots(board)
    .filter(
      (s) =>
        !open.has(s.id) &&
        slotAccepts(s.type, spec.slot) &&
        slotFits(s, spec) &&
        board.devices.some((d) => d.slot === s.id),
    )
    .map((s) => s.id);
  return { free, swap };
}

/**
 * The fitted device an id of the scene stands for: its own id, the supply's stand-in (`psu`), or the device a die's block or a card's lane belongs to
 * (`cpu.fetch`, `pcie1.lane3`). Null for anything else (a socket, a cable, the case).
 */
export function deviceFor(id: string | null, board: boardTypes.Board): boardTypes.InstalledDevice | null {
  if (!id) {
    return null;
  }
  const exact = board.devices.find((d) => d.id === id);
  if (exact) {
    return exact;
  }
  if (id === 'psu') {
    return board.devices.find((d) => deviceSpec(d).kind === 'psu') ?? null;
  }
  if (!id.includes('.') || id.startsWith('cable.')) {
    return null;
  }
  const head = id.split('.')[0]!;
  return board.devices.find((d) => d.slot === head || (head === 'cpu' && deviceSpec(d).kind === 'cpu')) ?? null;
}

/** The socket an id of the scene stands for (an empty socket's own id, or the socket a device fills), or null. */
export function socketFor(id: string | null, board: boardTypes.Board): string | null {
  if (!id) {
    return null;
  }
  return boardSlots(board).some((s) => s.id === id) ? id : null;
}

const corner = new Vector3();

/** A world box as a client rectangle (`canvas`: the canvas's own client rectangle); null when it is empty or a corner is behind the eye. */
export function screenRect(box: threeTypes.Box3, camera: threeTypes.Camera, canvas: Rect): Rect | null {
  if (box.isEmpty()) {
    return null;
  }
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        corner.set(x, y, z).project(camera);
        if (corner.z >= 1) {
          return null;
        }
        const px = canvas.x + ((corner.x + 1) / 2) * canvas.w,
          py = canvas.y + ((1 - corner.y) / 2) * canvas.h;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
