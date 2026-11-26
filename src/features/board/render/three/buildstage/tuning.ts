// The stage's places, speeds and timings (`buildstage.ts`): where its monitor and the wall stand, how fast a step plays, how near a pointer must be.
import type { V3 } from '@/core/render/three/rope';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { monitorSeats } from '@/features/room/render/three/monitor3d';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import type { Snapshot } from '@/worker/protocol';
import { CASE as CASE_RECT, DESK_Y, LAYOUT_CASE, MONITOR } from '../../layout/layout';
import { DOOR_SEES } from '../casedoor';
import { cableBlocked } from '@/features/board/sim/cables';
import type { Board, CableId, CaseKind, StageWall, WallNet, WallPlan } from './types';
import { ispTier, routerTier, wallPlan } from '../studiowall3d';

/** How many whole machines the history keeps (each holds a game): the oldest and the steps before it go first. */
export const KEEP_SWAPS = 8;
/** How long a refusal stays on the hint line, counted from the end of the job that raised it. */
export const REFUSAL_MS = 6000;

/** The eye's key and range, as in the game's board view. */
export const EYE_KEY = 0.04,
  EYE_RANGE = [0.3, 14] as const;
export { BUILD_START as START } from '@/core/render/three/buildframe';
/** How far west (units) the start view moves the picture of the case and the wall (the wall's own views, `wallView`). */
export const WALL_SHIFT = 1400;
/** The z the Wall preset aims at: between the plates' faces and the router's front. */
export const WALL_FOCUS_Z = 1800;
/** Where the stage's monitor stands (`syncMonitor`): its foot's middle this far west of the case's west face and in front of the board, turned this far to the camera. */
export const MONITOR_AT = { dx: -5200, dz: 1800, yaw: 0.5, rootZ: 400 } as const;
/** Where the stage's monitor lets its power cord out, in the world, and the way the cord leaves it (`monitorSeats`, turned and moved as `syncMonitor` places the monitor). */
function monitorPower(): { at: V3; axis: V3 } {
  const p = monitorSeats(MONITOR, 0).power,
    c = Math.cos(MONITOR_AT.yaw),
    s = Math.sin(MONITOR_AT.yaw);
  const turn = (v: V3): V3 => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  const [x, y, z] = turn([p.at[0] - (MONITOR.x + MONITOR.w / 2), p.at[1] + DESK_Y, p.at[2] + MONITOR_AT.rootZ]);
  return {
    at: [x + CASE_RECT.x + MONITOR_AT.dx, y - (CASE_RECT.y + CASE_RECT.h), z + BOARD_Z + MONITOR_AT.dz],
    axis: turn(p.axis),
  };
}
/**
 * The distance stand-ins (`partlod.ts`) draw only from this part of the stage's own zoom out: at its own view and closer, every part is itself.
 * Low has no such floor (PHONE-01): the small parts draw merged at any zoom, as the size rule says, and the whole machine is held while a
 * step moves parts (`frame`).
 */
export const LOD_CEIL = 0.8;
/** The settle after a part goes in: how long it lasts and how far (world units) the part dips past its seat. */
/** The speed of the parts in the way in a chain of more than two steps, and of a skip. */
export const QUICK = 2.5,
  SKIP = 6;
/** A part this big on the screen (its larger side, or its share of the screen) is looked at, not carried: a mouse drag on it pans (a hold lifts it), as in the game. */
export const BIG_SIDE = 0.7,
  BIG_AREA = 0.3;
/** The view's target stays this far (in heights of the start view) from the start view's, and the view shows at most this many times its height. */
export const STAY = 0.6,
  FAR = 2.5;
/** A focused part fills this share of the stage's height (or of its width, for a wide one). */
export const FOCUS_FILL = 0.5;
/**
 * How near (px) the pointer must be to a plug to mean it: a loose plug is small and lies among parts, a seated one is a few pixels (the game's `looseNear`).
 * A ray that meets the cable itself needs none of this.
 */
export const GRAB_PX = 22,
  SEATED_PX = 12;
/** A cable in a chain (a fan's lead) is pulled this much faster again: it is the same small motion each time. */
export const CABLE_QUICK = 1.8;
export const SETTLE_SECONDS = 0.2,
  SETTLE_DEPTH = 40;
/** The tile bakes' time in a tick that follows a drawn frame, and in one that follows none (ms); the drawn frames between two rank refreshes. */
export const BAKE_MS = 6,
  BAKE_STILL_MS = 12,
  RANK_EVERY = 32;
export const sleep = async (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** The rope's steps for a frame of `dt` seconds (the hoses, `LoopHoses.pose`): about 240 a second, as the cable hand's. */
export const ropeSteps = (dt: number): number => Math.max(2, Math.min(24, Math.round(dt * 240)));

/** How long after a close the stage frees its meshes: a frame or so after its context (`BuildStage.dispose`). */
export const FREE_LATER_MS = 20;

/** Does the game refuse this cable now (`cableBlocked` gives a reason)? */
export function isBlocked(board: Board, id: CableId): boolean {
  const why = cableBlocked(board, id);
  return why !== null && why !== '';
}

/** Nothing: the first picture's resolve stands here until `picture` sets it. */
export const noop = (): void => {
  /* the first picture's resolve replaces it */
};

/** The kind of the case on the stage: its side panel's look and pace (`casedoor.ts`). */
export const caseKind = (): CaseKind => CASE_KIND[LAYOUT_CASE] ?? 'gamer';

/** The wall's plan for the case as the layout has it now: placed by the case's west face and top, over the floor under it. */
export function wallPlanNow(): WallPlan {
  return wallPlan({
    caseX: CASE_RECT.x,
    caseTop: -CASE_RECT.y,
    caseW: CASE_RECT.w,
    floorY: -(CASE_RECT.y + CASE_RECT.h) - 140,
  });
}
/** What the wall shows of the game's network (its jacks' lights come from the frames: `frame`). */
export function wallNet(s: Snapshot): WallNet {
  return { router: routerTier(s.net?.router?.id), isp: ispTier(s.net?.isp?.id) };
}

/** Does the shut side panel hide the inside (a steel one, or a window over the upper part only)? A step behind it cannot be seen: it plays with the panel open. */
export const steelCase = (): boolean => !DOOR_SEES[caseKind()];

/** What the machine's cords need of the wall (the machine is built with it: `Machine3D`'s `wall`). */
export function stageWall(s: Snapshot): StageWall {
  return { plan: wallPlanNow(), monitor: s.devices.some((d) => d.kind === 'display') ? monitorPower() : null };
}

/**
 * Runs `step` on each item in turn, each after the one before it has ended (the steps of a job play one at a time). A step that answers `false`
 * ends the run there.
 */
export async function inTurn<T>(items: Iterator<T>, step: (x: T) => Promise<unknown>): Promise<void> {
  const next = items.next();
  if (next.done === true) {
    return;
  }
  if ((await step(next.value)) === false) {
    return;
  }
  await inTurn(items, step);
}

/** `x`, which the game has just answered for (a part it put in, a tier of its tables): a missing one throws, as reading it would have. */
export function sure<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) {
    throw new TypeError('Build my PC: the game has no such part');
  }
  return x;
}
