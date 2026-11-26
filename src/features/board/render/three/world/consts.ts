// The 3D world's tuning (board3d.ts): the views' angles and depths, the eye's adaptation, the title's sway, the boot screen's limits, and the
// pointer's reach.
import { LIMITS } from '@/core/render/three/camera';

export const ROOM_ANGLE = { yaw: 0, pitch: 0.09, fov: 26 };
export const FLAT = { yaw: 0, pitch: 0, fov: 14 };
/** The view onto a part that lies on a shelf (`Rail.lie`): from the front, tilted down as far as the camera goes. */
export const LIE = { yaw: 0, pitch: LIMITS.pitchMax, fov: 20 };
/**
 * The overview's target depth (in the case, in front of the board). The room's look reads how near the eye is by the height a view shows there
 * (`roomness`), whatever its target: the target follows the surface the player zooms to, and the look must not change with it.
 */
export const LOOK_Z = 5000;
/** A target may lie this far back (behind the back wall: the view out of the window). */
export const TARGET_Z0 = -3000;
/** The machine's ids that are reached from outside the case (a tutorial target among them leaves the side panel shut). */
export const OUTSIDE = new Set([
  'case',
  'case.side',
  'power',
  'usb',
  'io',
  'cable.video',
  'cable.lan',
  'cable.pcmains',
  'cable.monmains',
]);
/** The share of the particles at each level of the graphics settings. */
export const PARTICLE_LEVELS = [0, 0.5, 1];
/** The room's probe is captured again at most this often (ms) while its light changes (the sun moves a step every few seconds). */
export const PROBE_MS = 1500;
/**
 * The eye adapts, as a camera's exposure does (`src/features/room/light.md`); the light itself does not change. In the room's views the
 * exposure is set: by night `NIGHT_EYE` times the day's (the room has only its lamps). From the board view in it is metered (`Post.meter`):
 * the exposure that shows the scene's mean luminance at `EYE_KEY`, within `EYE_RANGE` of the base. The case's dark inside, lit by the room's
 * lamps alone, then reads, and a die's bright art does not burn out.
 */
export const NIGHT_EYE = 1.4,
  EYE_KEY = 0.04,
  EYE_RANGE = [0.3, 14] as const;
/**
 * The local eye's key in the room's views (`LocalEye.key`; it fades out toward the board view, `Post.setReach`): the light it adapts each part
 * of the picture toward. By day middle grey (`MID`): the walls by the bright glass read. At night lower: the room stays low-key, its pools of
 * lamp light and the dark between them. At night it also keeps more of the bright (`LocalEye.high`): the pools stand out (a wall in one
 * reads L .05 or more, `light.md` "Targets"), where by day it holds back the glass.
 */
export const NIGHT_KEY = 0.03,
  NIGHT_HIGH = 0.8;
/** Before a game (the title over the live room): the overview turns this far (rad) each side of its own, slowly, round its target, once in `MENU_S` × 2π s. */
export const MENU_SWAY = 0.07,
  MENU_S = 9;
/** The boot screen goes at the latest this long (ms) after the programs have linked, if the room's light has not settled by then. */
export const REVEAL_MS = 4000;
/** An anchor smaller than this on screen (px) is not comfortably visible: a plug that small is hard to grab. */
export const MIN_TARGET_PX = 10;
/** How often a still of the room is saved for the next boot screen (ms). */
export const STILL_MS = 30_000;
/** How far from a loose plug (px) the pointer takes it, and from a seated one's seat. */
export const GRAB_PX = 22,
  SEATED_PX = 12;
/** A part this big on the screen (its larger side, or its share of the screen) is looked at, not carried: a mouse drag on it pans (a hold lifts it). */
export const BIG_SIDE = 0.7,
  BIG_AREA = 0.3;
/** Ids the tutorial and the shop use that stand for another object here (the monitor and the supply stand for their sockets; the bay for its first free mouth). */
export const ALIAS: Record<string, string[]> = {
  display0: ['monitor'],
  atx0: ['psu'],
  'atx-plus0': ['psu'],
  bay: Array.from({ length: 8 }, (_, i) => `sata${i}`),
};

/** After the page's next paint: the boot screen shows its stage before the work that holds the page. */
export const nextPaint = async (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
/** After the page's pending tasks (a click, a key): no wait for a paint, which would wait for the driver while programs link. */
export const turn = async (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
