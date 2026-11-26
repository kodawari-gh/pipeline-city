// The camera's flights (board3d.ts): to a view, to the room, the board, the die and the first graphics card's die; a flight cut short, and
// the dev-only jump.
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { snapshot } from '@/app/store';
import { clampView, fitRect } from '@/core/render/three/camera';
import type { OrbitView } from '@/core/render/three/camera';
import { cardOrigin } from '@/core/render/accelart';
import { gpuPlan, moveRect } from '@/features/gpu/render/gpulayout';
import { getSpec } from '@/features/board/sim/specs';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { FLAT } from './consts';
import { aspect, boardView, cpuView, inRoom, overview } from './view';
import type { Scope } from './world';

/** Any flight, cut or input ends the dev-only unclamped view. */
export const cancelFlight = ({ cam }: Scope): void => {
  cam.unclamped = false;
  const p = cam.pending;
  cam.pending = null;
  p?.(false);
};
export const flyTo = (s: Scope, v: OrbitView): void => {
  cancelFlight(s);
  s.cam.atOverview = false;
  s.cam.goal = inRoom(s, clampView(v));
  s.cam.flying = true;
};
/** Dev only (the shot tool): show this view at once, as it is (its angles stay until the player moves it). */
export const jump = (s: Scope, v: OrbitView): void => {
  s.cam.unclamped = false;
  s.cam.goal = inRoom(s, v);
  s.cam.view = s.cam.goal;
};
export const flyToRoom = (s: Scope): void => {
  flyTo(s, overview(s));
  s.cam.atOverview = true;
};
export const flyToBoard = (s: Scope): void => {
  flyTo(s, boardView(s));
};
export const flyToCpu = (s: Scope): void => {
  flyTo(s, cpuView(s));
};
/** The first graphics card's die, framed close enough that the shroud has faded (`DEVICE_LOD.gpu.fade`) and the blocks read. */
export const flyToGpu = (s: Scope): void => {
  const d = snapshot.peek()?.devices.find((x) => x.kind === 'gpu');
  const spec: { visual?: string } | undefined = d ? getSpec(d.spec) : undefined;
  const visual = spec?.visual;
  if (!d || visual === undefined || visual === '') {
    return;
  }
  const slot = Number(/\d+$/u.exec(d.slot)?.[0] ?? 0),
    b = moveRect(gpuPlan(visual).body, cardOrigin(slot, visual));
  // a long card's die is a row of SMs: frame its height, at its first third
  const h = b.h + 160,
    w = Math.min(b.w + 160, h * aspect(s));
  flyTo(s, fitRect({ x: b.x - 80, y: b.y - 80, w, h }, BOARD_Z + 300, aspect(s), FLAT, 0.95));
};
