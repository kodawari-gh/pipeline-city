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
