// Dev only (board3d.ts): the `__board` hook the shot tools and the tests drive the world by. The prod build has none of it: the DEV gate folds
// to false, and the eye as given (`unclamped`) goes with it.
import { Box3, Vector3 } from 'three';
import { snapshot } from '@/app/store';
import { clampView } from '@/core/render/three/camera';
import { roots } from './anchors';
import { devLooks, objectOf } from './devLooks';
import { devViews } from './devViews';
import type { World } from './world';
import type { OrbitView } from './types';

declare global {
  /** Dev only: the hook the shot tools and the tests drive the world by (`devHook`). */
  var __board: unknown;
}

/** The shot tool's optional angles and fill (tools/shot-case.mjs passes them in this order): turned by `yaw`, seen from `pitch` above, the largest side filling `fill` of the view's height. */
type Angles = [yaw?: number, pitch?: number, fill?: number];

/** The hook on the window, in the dev build only. */
export function devHook(w: World): void {
  if (import.meta.env.DEV) {
    /** Dev only (`tools/shot-case.mjs`): show this view at once with no room clamp, held until a flight or an input (`unclamped`). */
    const jumpRaw = (v: OrbitView): void => {
      holdView(w, v);
    };
    globalThis.__board = {
      ...devLooks(w),
      ...devViews(w),
      // the case shot tool (`tools/shot-case.mjs`): the eye as given, with no room clamp; `frameSpec` frames a device (its spec id, or its kind) from its
      // own box in world units: its largest side fills `fill` of the view's height, turned by `yaw`, seen from `pitch` above. Null: no such device.
      jumpRaw: (v: OrbitView) => {
        jumpRaw(v);
      },
      frameSpec: (key: string, ...angles: Angles): OrbitView | null => {
        const [yaw = 0, pitch = 0.1, fill = 0.6] = angles;
        const d = snapshot.peek()?.devices.find((x) => x.spec === key || x.kind === key || x.slot === key);
        return d ? frameOf(w, d.id, { yaw, pitch, fill }) : null;
      },
      // `--id`: the object with this hover id (a part, a cable, a room object), framed the same way; `--list`: every hover id in the scene, sorted
      frameId: (id: string, ...angles: Angles): OrbitView | null => {
        const [yaw = 0.52, pitch = 0.35, fill = 0.5] = angles;
        return frameOf(w, id, { yaw, pitch, fill });
      },
      ids: (): string[] => hoverIds(w),
    };
  }
}

/** The eye as given, with no room clamp. */
function holdView(w: World, v: OrbitView): void {
  const { cam } = w;
  cam.unclamped = true;
  cam.atOverview = false;
  const held = clampView(v);
  cam.goal = held;
  cam.view = held;
}

/** The view that frames the object with this hover id from its own box (its largest side fills `fill` of the view's height), shown at once. Null: no such object. */
function frameOf(w: World, id: string, at: { yaw: number; pitch: number; fill: number }): OrbitView | null {
  const o = objectOf(w, id);
  if (!o) {
    return null;
  }
  const b = new Box3().setFromObject(o),
    c = b.getCenter(new Vector3()),
    s = b.getSize(new Vector3());
  const v: OrbitView = {
    x: c.x,
    y: c.y,
    z: c.z,
    yaw: at.yaw,
    pitch: at.pitch,
    fov: 26,
    height: Math.max(s.x, s.y, s.z, 1) / at.fill,
  };
  holdView(w, v);
  return v;
}

/** Every hover id in the scene, sorted. */
function hoverIds(w: World): string[] {
  const s = new Set<string>();
  for (const r of roots(w)) {
    r.traverse((o) => {
      if (typeof o.userData['id'] === 'string') {
        s.add(o.userData['id']);
      }
    });
  }
  return [...s].toSorted();
}
