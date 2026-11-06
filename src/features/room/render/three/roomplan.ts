// The 3D room's plan (pure): depths, the glass wall and its column, the sun's path. The x and y of everything come from the 2D layout (`roomGeo`, `layout.ts`), z is the distance out of the back wall.
import type { Room } from '@/core/render/three/camera';
import type { Rect } from '@/features/board/render/layout/layout';

/** The desk's depth from the wall (about 650 mm at the monitor's scale), and its top's thickness. */
export const DESK_D = 12000, DESK_TOP = 360;
/** The case stands this far from the wall, this deep; the board sits on its far panel. */
export const CASE_Z = 2200, CASE_D = 4200, BOARD_Z = CASE_Z + 260;
export const MONITOR_Z = 3200;
export const ROOM_D = 26000;

/** The 3D room's clock starts in the early afternoon. */
export const START_HOUR_3D = 14.2;

// ---- the bedroom round the desk: real sizes at the monitor's scale (about 18,700 units a metre; the 2D floor is far closer than a real one) ----
/** The floor (a desk 750 mm high) and the ceiling (2.5 m over the floor), 2D y down. */
export const FLOOR_Y = 20000, CEIL_Y = -26800;
/** The side walls and the wall behind the viewer (the room is 4.8 m wide and 3.7 m deep). */
export const WEST_X = -40000, EAST_X = 50000, FRONT_Z = 70000;
/**
 * The back wall's thickness (its reveal), and the glass wall in it (2D y down): floor-to-ceiling glazing from near the west corner to past the
 * case, from a slot under the ceiling (the blinds' pocket) down to a low upstand (10 cm). The city fills the view behind the desk.
 */
export const WALL_T = 2600;
export const WINDOW: Rect = { x: WEST_X + 2400, y: CEIL_Y + 900, w: 10400 - (WEST_X + 2400), h: FLOOR_Y - 1900 - (CEIL_Y + 900) };
/**
 * The building's column in the glass wall, behind the monitor's east end: plaster, the whole height. The things of the 2D wall stay on it at
 * their 2D places (the router's shelf, the letterbox, the network and power plates); the clock moves onto it (`CLOCK_Y`).
 */
export const PIER = { x0: -8400, x1: -2700 };
/** The glazing's mullion: the bay west of the column is cut in two. */
export const MULLION_X = (WINDOW.x + PIER.x0) / 2;
/** The clock's top on the column (2D y down): over the router's antennas. */
export const CLOCK_Y = -7900;
/** The top of the room view's framing: the old window head, so the tall glass does not pull the camera back. */
export const VIEW_TOP = -14000;
/**
 * The bed (its headboard just off the back wall, east of the desk: `head` deep, its top `headTop`; `top`: the mattress's top, 2D y down), the
 * bedside drawer floating on the wall beside it (its top about the mattress's height, `h` tall; the lantern on it, `lamp.dx` in from its west
 * end and `lamp.dz` off its middle, `lamp.r` round and `lamp.h` tall), the bookcase on the west wall, the door near the front.
 */
export const BED = { x: 19500, w: 26500, z0: 500, z1: 38000, head: 600, headTop: FLOOR_Y - 17500, top: FLOOR_Y - 9000 };
export const NIGHTSTAND = { x: 11400, w: 7200, z0: 0, z1: 6800, top: FLOOR_Y - 9300, h: 3200, lamp: { dx: 2400, dz: -300, r: 1950, h: 3800 } };
export const BOOKCASE = { x: WEST_X, w: 5600, z0: 8000, z1: 24000, top: FLOOR_Y - 34000 };
export const DOOR = { z0: 46000, z1: 62000, top: FLOOR_Y - 38500 };
/** The wall sconce on the west wall north of the door, clear of its architrave: its middle along the wall (z) and its middle at eye height (2D y down). */
export const SCONCE = { z: 43300, y: FLOOR_Y - 31800 } as const;
/** The rug beside the bed, under its west side (clear of the desk chair's castors), and its thickness. */
export const RUG = { x0: -8000, x1: 27000, z0: 15000, z1: 41000, h: 300 };
/** Is the floor point (x, z) on the rug? (A thing standing there stands on its top.) */
export const onRug = (x: number, z: number): boolean => x > RUG.x0 && x < RUG.x1 && z > RUG.z0 && z < RUG.z1;
/** The fig in its pot on the floor by the west wall (its leaves reach about 5000 round it). */
export const FIG_AT = { x: WEST_X + 5800, z: 31500 } as const;
/**
 * The tall paper floor lantern in front of the glass, by the bench and the bookcase's near end (it lights the books' spines from the room's side;
 * by the fig it would stand in front of the bookcase): its middle, its paper's radius and height, its legs' height (about 1.25 m in all).
 */
export const FLOOR_LANTERN = { x: -30500, z: 8400, r: 2300, h: 20600, legs: 2800 } as const;
/**
 * The arc floor lamp east of the desk, the desk's overhead cozy light (`light.md`): its base on the rug (x, z), clear of the bed; its dome's
 * mouth over the desk's front edge (x, 2D y down, z), east of the case's middle but west of its hinge (the open side panel would shade it),
 * far enough out from the case that its top shades only the board's top edge.
 */
export const ARC_LAMP = { x: 14000, z: 26000, head: { x: 5500, y: -8000, z: 21000 } } as const;
/** The low bench along the glass west of the desk (a stone top at seat height, 40 cm): its ends (x), its back and front (z), its top (2D y down). */
export const BENCH = { x0: WINDOW.x + 1200, x1: -24600, z0: 400, z1: 5600, top: FLOOR_Y - 7480 };
/** The key stand on the desk west of the monitor: where the rack's west end stands (x) and its hooks' plane (z). */
export const KEY_STAND = { x: -19800, z: 5600 };
/** The cable tray hung under the desk top's back edge, behind the monitor: its ends (x), its back and front (z), its top `drop` under the top, `h` deep. */
export const TRAY = { x0: -16000, x1: -5000, z0: 400, z1: 2600, drop: 400, h: 1500 };
/** The drawer unit under the desk's east end: its west side `in` from the desk's east end, `w` wide. */
export const PED = { in: 7800, w: 7500 };
/** The floating shelf on the east wall past the bed's foot: its ends (z), its top (2D y) and its depth. */
export const SHELF = { z0: 40000, z1: 55000, y: -3000, d: 4000 };
/** The world box (y up) the camera's eye keeps to: the room less a margin that keeps the near plane off the walls. */
export const EYE_MARGIN = 3600;
export function eyeRoom(): Room {
  const m = EYE_MARGIN;
  return { x0: WEST_X + m, x1: EAST_X - m, y0: -FLOOR_Y + m, y1: -CEIL_Y - m, z0: m, z1: FRONT_Z - m };
}

/**
 * The furniture the camera's eye keeps out of (world boxes, y up; `keepInside`), each round all of its piece: the bed's body to the duvet's
 * top in three tiers (the duvet falls out past the frame, more toward its hem), its headboard with the pillows; the bedside drawer with the
 * book on it, the lantern; the bookcase
 * with the pothos trailing off it; the fig's leaves; the east shelf with its speaker, plant and vines; the desk's top, its drawer unit and the
 * backpack against it; the bench with the aloe on it. `geo`: the 2D desk's ends and top (`roomGeo`). Not the chair (it stands in the views of
 * the desk), nor the case and the monitor (the views are of them).
 */
export function eyeBlocks(geo: { desk: { x0: number; x1: number }; ys: number }): Room[] {
  // a box from 2D: its ends (x), its top and bottom (2D y down), its back and front (z)
  const box = (x0: number, x1: number, top: number, bottom: number, z0: number, z1: number): Room => ({ x0, x1, y0: -bottom, y1: -top, z0, z1 });
  const fl = FLOOR_Y, { x, w, z0, z1 } = BED, duvet = BED.top - 1700, ns = NIGHTSTAND, lamp = ns.lamp;
  const lx = ns.x + lamp.dx, lz = (ns.z0 + ns.z1) / 2 + lamp.dz, ped = geo.desk.x1 - PED.in, under = geo.ys + DESK_TOP, b = BENCH;
  return [
    box(x - 400, x + w + 400, duvet, fl - 8500, z0 - 100, z1 + 400),
    box(x - 1400, x + w + 1400, fl - 8500, fl - 6500, z0 - 100, z1 + 700),
    box(x - 2000, x + w + 2000, fl - 6500, fl, z0 - 100, z1 + 2000),
    box(x, x + w, BED.headTop, duvet, z0 - 100, z0 + BED.head + 9300),
    box(ns.x, ns.x + ns.w, ns.top - 650, ns.top + ns.h, ns.z0, ns.z1 + 20),
    box(lx - lamp.r, lx + lamp.r, ns.top - lamp.h, ns.top, lz - lamp.r, lz + lamp.r),
    box(WEST_X, BOOKCASE.x + BOOKCASE.w + 1100, BOOKCASE.top - 4000, fl, BOOKCASE.z0, BOOKCASE.z1 + 800),
    // (the fig's leaves differ a little from build to build: a wider box)
    box(FIG_AT.x - 5200, FIG_AT.x + 7400, fl - 27000, fl, FIG_AT.z - 6500, FIG_AT.z + 7000),
    box(EAST_X - SHELF.d - 1000, EAST_X, SHELF.y - 4000, SHELF.y + 7100, SHELF.z0, SHELF.z1 + 400),
    box(geo.desk.x0, geo.desk.x1, geo.ys, under, 0, DESK_D),
    box(ped, ped + PED.w, under, fl, 300, DESK_D - 280),
    box(ped - 5000, ped, fl - 9200, fl, 5000, 11000),
    // (the aloe stands up to 6,000 over the bench's top)
    box(b.x0 - 400, b.x1 + 400, b.top - 6000, fl, b.z0 - 100, b.z1 + 400),
  ];
}

/**
 * The sun's direction (world, y up, z out of the wall toward the viewer) at an hour. The glass looks north: the sun rises in the east (+x), a
 * little toward the glass, passes south behind the room (+z), about 50 degrees up at noon, and sets in the west. It never shines in; it lights
 * the faces of the city that look at us, and low in the evening it rakes across them from the west.
 */
export function sunDir(hour: number): [number, number, number] {
  const f = Math.min(1, Math.max(0, (hour - 6) / 14.5)), az = 1.75 - 3.5 * f, el = 0.85 * Math.sin(Math.PI * f) - 0.04;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
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
