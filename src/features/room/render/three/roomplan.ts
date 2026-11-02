// The 3D room's plan (pure): depths and the runs of the wood-slat wall. The x and y of everything come from the 2D layout (`roomGeo`, `layout.ts`), z is the distance out of the back wall.
import type { Rect } from '@/features/board/render/layout/layout';

/** The desk's depth from the wall (about 650 mm at the monitor's scale), and its top's thickness. */
export const DESK_D = 12000, DESK_TOP = 360;
/** The case stands this far from the wall, this deep; the board sits on its far panel. */
export const CASE_Z = 2200, CASE_D = 4200, BOARD_Z = CASE_Z + 260;
export const MONITOR_Z = 3200;
export const ROOM_D = 26000;

/** The wall's slats: thin and dense, like an acoustic panel wall. */
export const SLAT_W = 170, SLAT_PITCH = 250;
/** The 3D room's clock starts in the early afternoon (the reference look is a sunny day). */
export const START_HOUR_3D = 14.2;

// ---- the bedroom round the desk: real sizes at the monitor's scale (about 18,700 units a metre; the 2D floor is far closer than a real one) ----
/** The floor (a desk 750 mm high) and the ceiling (2.5 m over the floor), 2D y down. */
export const FLOOR_Y = 20000, CEIL_Y = -26800;
/** The side walls and the wall behind the viewer (the room is 4.8 m wide and 3.7 m deep). */
export const WEST_X = -40000, EAST_X = 50000, FRONT_Z = 70000;
/** The back wall's thickness at the window (its reveal), and the window's opening in it (2D y down): a tall casement west of the desk. */
export const WALL_T = 2600;
export const WINDOW: Rect = { x: -32600, y: -14000, w: 11000, h: 17600 };
/** The slatted accent panel behind the desk; plaster elsewhere. */
export const SLATS_X0 = -20000, SLATS_X1 = 9000;
/** The bed's frame (its head on the back wall, east of the desk), the bedside table, the bookcase on the west wall, the door near the front. */
export const BED = { x: 19500, w: 26500, z0: 500, z1: 38000 };
export const NIGHTSTAND = { x: 9800, w: 8400, z0: 400, z1: 8600, top: FLOOR_Y - 10500 };
export const BOOKCASE = { x: WEST_X, w: 5600, z0: 8000, z1: 24000, top: FLOOR_Y - 34000 };
export const DOOR = { z0: 46000, z1: 62000, top: FLOOR_Y - 38500 };
/** The world box (y up) the camera's eye keeps to: the room less a margin that keeps the near plane off the walls. */
export const EYE_MARGIN = 3600;
export function eyeRoom(): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } {
  const m = EYE_MARGIN;
  return { x0: WEST_X + m, x1: EAST_X - m, y0: -FLOOR_Y + m, y1: -CEIL_Y - m, z0: m, z1: FRONT_Z - m };
}

/**
 * The sun's direction (world, y up, z out of the wall toward the viewer) at an hour: it rises far to the east (+x) behind the wall, climbs to
 * about 50 degrees and sets low in the west, where the window looks: at dusk it sinks into the skyline in the window's view.
 */
export function sunDir(hour: number): [number, number, number] {
  const f = Math.min(1, Math.max(0, (hour - 6) / 14.5)), az = 1.3 - 1.7 * f, el = 0.85 * Math.sin(Math.PI * f) - 0.04;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

export interface Run { x: number; y0: number; y1: number }

/** The wall's vertical slats from x0 to x1, y0 to y1 (y down), cut round the hole (the window with its frame). */
export function slatRuns(x0: number, x1: number, y0: number, y1: number, hole: Rect): Run[] {
  const out: Run[] = [];
  for (let x = x0; x + SLAT_W <= x1; x += SLAT_PITCH) {
    const clear = x + SLAT_W <= hole.x || x >= hole.x + hole.w;
    if (clear) { out.push({ x, y0, y1 }); continue; }
    if (hole.y > y0) out.push({ x, y0, y1: hole.y });
    if (hole.y + hole.h < y1) out.push({ x, y0: hole.y + hole.h, y1 });
  }
  return out;
}

/** The four pieces of a wall from x0 to x1, y0 to y1, with a hole in it. */
export function wallAround(x0: number, x1: number, y0: number, y1: number, hole: Rect): Rect[] {
  return [
    { x: x0, y: y0, w: hole.x - x0, h: y1 - y0 },
    { x: hole.x + hole.w, y: y0, w: x1 - hole.x - hole.w, h: y1 - y0 },
    { x: hole.x, y: y0, w: hole.w, h: hole.y - y0 },
    { x: hole.x, y: hole.y + hole.h, w: hole.w, h: y1 - hole.y - hole.h },
  ].filter((r) => r.w > 0 && r.h > 0);
}

/** How strong the sun is at an hour: 0 at night, 1 from mid morning to mid afternoon. */
export function daylight(hour: number): number {
  const up = Math.min(1, Math.max(0, (hour - 5.5) / 2.5)), down = Math.min(1, Math.max(0, (20.5 - hour) / 2.5));
  return Math.min(up, down);
}
