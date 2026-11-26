// The views (board3d.ts): the eye kept in the room and out of the furniture, a rect fitted in the part of the screen the HUD leaves free,
// and the overview, the title's sway, the board's and the die's views.
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { viewInset } from '@/app/hover';
import { fitRect, keepInside, keepWhole, panBy } from '@/core/render/three/camera';
import type { Box, KeepOpts, OrbitView } from '@/core/render/three/camera';
import { BOARD_Z, VIEW_TOP, WINDOW, eyeRoom } from '@/features/room/render/three/roomplan';
import { CASE, CASE_IN, DIE, ROUTER_SPOT, TRAY } from '../../layout/layout';
import { FLAT, LOOK_Z, MENU_S, ROOM_ANGLE, TARGET_Z0 } from './consts';
import type { Scope } from './world';

export const aspect = ({ stage }: Scope): number => stage.W / stage.H;
/** The reference's framing: front on, a little from above, from the glass west of the desk to the drawers, from the old window head to the desk's drawers. */
const roomRect = ({ held }: Scope): Box => {
  const g = held.room?.geo;
  if (!g) {
    throw new Error('the overview frames the room once it is built');
  }
  const x0 = Math.max(WINDOW.x, g.desk.x0 - 12_500) - 1200,
    y0 = Math.min(TRAY.y, ROUTER_SPOT.y, g.clock.y, VIEW_TOP) - 1200;
  return { x: x0, y: y0, w: Math.max(g.desk.x1, CASE.x + CASE.w) + 1200 - x0, h: g.ys + 7000 - y0 };
};
/**
 * A view with its eye in the room (the walls hide all outside it) and out of the furniture: a goal may narrow its fov back (`restore`), the
 * eased view only widens.
 */
export const keeping = (s: Scope, restore: boolean): KeepOpts => ({
  targetZ0: TARGET_Z0,
  fovBase: ROOM_ANGLE.fov,
  restore,
  blocks: s.held.blocks,
});
export const inRoom = (s: Scope, v: OrbitView, restore = true): OrbitView =>
  import.meta.env.DEV && s.cam.unclamped ? v : keepInside(v, eyeRoom(), keeping(s, restore));
/** A pan that would push the eye through a wall or into the furniture slides along it (one axis), or stops. */
export const panIn = (s: Scope, v: OrbitView, d: { dx: number; dy: number }): OrbitView => {
  const { dx, dy } = d;
  for (const [a, b] of [
    [dx, dy],
    [dx, 0],
    [0, dy],
  ] as const) {
    const p = panBy(v, a, b),
      k = inRoom(s, p);
    if (Math.abs(k.height - p.height) < 1 && Math.hypot(k.x - p.x, k.y - p.y, k.z - p.z) < 1) {
      return k;
    }
  }
  return v;
};
/** How a rect is fitted (`fitRect`): its depth, the angles it is seen at, and the share of the free window it fills. */
export interface Fit {
  z: number;
  from: Pick<OrbitView, 'yaw' | 'pitch' | 'fov'>;
  margin: number;
}
/** `fitRect` for the part of the screen the HUD leaves free (`viewInset`): the rect centres in it, and fills it by the margin. */
export const inFree = ({ stage }: Scope, r: Box, fit: Fit): OrbitView => {
  const { W, H } = stage,
    i = viewInset.peek(),
    fw = Math.max(50, W - i.left - i.right),
    fh = Math.max(50, H - i.top - i.bottom);
  const v = fitRect(r, fit.z, fw / fh, fit.from, fit.margin),
    height = (v.height * H) / fh,
    k = height / H;
  return panBy({ ...v, height }, (-(i.left - i.right) / 2) * k, ((i.top - i.bottom) / 2) * k);
};
/**
 * The overview shows the whole room in the part of the screen the HUD leaves free. A tall card at the bottom (the tutorial's, 360 px at 1920 x 1080) moves its
 * target to a height where the desk's top stands between the target and the eye: `keepWhole` slides it a little, `keepInside` would shrink the view to a sliver.
 */
export const overview = (s: Scope): OrbitView => {
  const v = inFree(s, roomRect(s), { z: LOOK_Z, from: ROOM_ANGLE, margin: 0.9 });
  return import.meta.env.DEV && s.cam.unclamped ? v : keepWhole(v, eyeRoom(), keeping(s, true));
};
/** Before a game (the title over the live room): the overview, turning slowly a little way each side round its target. */
export const menuView = (s: Scope, t: number): OrbitView => {
  const o = overview(s);
  return inRoom(s, { ...o, yaw: o.yaw + s.cam.sway * Math.sin(t / MENU_S) });
};
export const boardView = (s: Scope): OrbitView => inFree(s, CASE_IN, { z: BOARD_Z, from: FLAT, margin: 0.95 });
// close enough that the cooler and the lid have faded (`DEVICE_LOD.die.fade`) and the die's names read
export const cpuView = (s: Scope): OrbitView => inFree(s, DIE, { z: BOARD_Z + 200, from: FLAT, margin: 0.95 });
/**
 * After the player moves the goal (a zoom, the end of a pan or a turn): the eye stays in the room. Nothing else holds the view: it stays at any angle
 * and any depth the player leaves it (a part's aligned view is a flight, `focusPart`, not a rail).
 */
export const settle = (s: Scope): void => {
  s.cam.goal = inRoom(s, s.cam.goal);
};
