// Dev only (board3d.ts `__board`): the views the tools and the tests fly to or jump to, the case's door, and a case of another tier.
import { clampView, fitRect, orbitBy } from '@/core/render/three/camera';
import { BOARD_Z, CASE_D, CASE_Z } from '@/features/room/render/three/roomplan';
import { CASE, LAYOUT_CASE, LAYOUT_TIER } from '../../layout/layout';
import { FLAT } from './consts';
import { flyToBoard, flyToCpu, flyToGpu, flyToRoom, jump } from './flights';
import { focusPart } from './focus';
import { rebuild } from './rebuild';
import { aspect, inRoom } from './view';
import type { World } from './world';

/** The case of tier `c` (board tier `b`, default the same), empty; null goes back to the game's. */
const previewCase = (w: World, c: number | null, b: number): void => {
  w.held.preview = c === null ? null : { board: b, case: c };
  rebuild(w);
  w.clock.wasTier = `${LAYOUT_TIER}|${LAYOUT_CASE}`;
};

/** The flights, the views, the parts' detailed views (`focusPart` frames them, as a double click on a part does) and the shot tool's eyes. */
export const devViews = (w: World): Record<string, unknown> => ({
  flyToCpu: () => {
    flyToCpu(w);
  },
  flyToGpu: () => {
    flyToGpu(w);
  },
  flyToBoard: () => {
    flyToBoard(w);
  },
  flyToRoom: () => {
    flyToRoom(w);
  },
  view: () => w.cam.view,
  goal: () => w.cam.goal,
  bakes: () => w.stage.bakes.size,
  rails: () => w.held.machine?.rails ?? [],
  focusPart: (id: string) => focusPart(w, id),
  orbit: (yaw: number, pitch: number) => {
    w.cam.goal = inRoom(w, orbitBy(w.cam.goal, yaw, pitch));
  },
  previewCase: (c: number | null, b = c ?? 0) => {
    previewCase(w, c, b);
  },
  // a close look at a layout point (x, y) at depth z, `height` world units tall, turned by `yaw`, from `pitch` above
  // oxlint-disable-next-line eslint/max-params -- the shot tools call it with these, in this order
  lookAt: (x: number, y: number, z: number, yaw: number, pitch: number, height: number) => {
    jump(w, clampView({ x, y: -y, z, yaw, pitch, fov: 26, height }));
  },
  toggleDoor: () => w.held.machine?.toggleDoor(),
  // the whole case from the side, turned by `yaw` and seen from `pitch` above
  caseView: (yaw = 0, pitch = 0.09, margin = 0.85) => {
    jump(w, fitRect(CASE, CASE_Z + CASE_D / 2, aspect(w), { yaw, pitch, fov: 26 }, margin));
  },
  // the shot tool's `--view x,y,z`: a layout point and a zoom in screen pixels per unit, seen flat
  camera: {
    set: (v: { x: number; y: number; z: number }) => {
      jump(w, clampView({ ...FLAT, x: v.x, y: -v.y, z: BOARD_Z, height: w.stage.H / v.z }));
    },
  },
});
