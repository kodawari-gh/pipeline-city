// The Build stage's framing (ticket #43): the machine fills the free window that the UI's tabs leave, seen from the 3/4 start view.
// The window is measured from the live tab boxes (`freeArea`); the view fits the projected corners of the machine's box (`frameMachine`).
import { PerspectiveCamera, Vector3 } from 'three';
import { applyView, clampView, fitRect, panBy } from './camera';
import type * as cameraTypes from './camera';

/** The Build stage's 3/4 start view. */
export const BUILD_START = { yaw: 0.42, pitch: 0.3, fov: 30 };
/** How much of the free window the machine's projected box fills: 0.8 leaves 10% air on each side (about 54 px high at 1080 p). */
const FRAME_FILL = 0.8;
/** The 3/4 view draws the near bottom larger, so the drawn middle sits low of the window's middle: the view seats it this share of the stage up. */
const SEAT_UP = 0.05;

/** A solid in world units (y up): its centre and its size (x wide, y high, z deep). */
export interface Solid {
  centre: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
}

type Edge = 'left' | 'right' | 'top' | 'bottom';

/**
 * How far the tabs reach in from each edge of the stage (boxes in one space). A wide tab (its width at least its height) counts for the top or the
 * bottom edge, a tall one for the left or the right, whichever it is nearer; so a side panel that runs down the stage is not taken for a bottom bar.
 * A box with no size counts for nothing.
 */
function reachIn(stage: cameraTypes.Box, tabs: cameraTypes.Box[]): Record<Edge, number> {
  const i: Record<Edge, number> = { left: 0, right: 0, top: 0, bottom: 0 };
  const sr = stage.x + stage.w,
    sb = stage.y + stage.h;
  for (const t of tabs) {
    if (t.w <= 0 || t.h <= 0) {
      continue;
    }
    const tr = t.x + t.w,
      tb = t.y + t.h;
    const near: Record<Edge, number> = { top: t.y - stage.y, bottom: sb - tb, left: t.x - stage.x, right: sr - tr };
    const reach: Record<Edge, number> = { top: tb - stage.y, bottom: sb - t.y, left: tr - stage.x, right: sr - t.x };
    const [a, b]: [Edge, Edge] = t.w >= t.h ? ['top', 'bottom'] : ['left', 'right'];
    const side = near[b] < near[a] ? b : a;
    i[side] = Math.max(i[side], Math.round(reach[side]));
  }
  return i;
}

/** The free window: the stage less what the tabs reach in from each edge. */
export function freeArea(stage: cameraTypes.Box, tabs: cameraTypes.Box[]): cameraTypes.Box {
  const i = reachIn(stage, tabs);
  return {
    x: stage.x + i.left,
    y: stage.y + i.top,
    w: Math.max(0, stage.w - i.left - i.right),
    h: Math.max(0, stage.h - i.top - i.bottom),
  };
}

/** The eight corners of a solid, in world units. */
function cornersOf(s: Solid): Vector3[] {
  const out: Vector3[] = [];
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [-0.5, 0.5]) {
      for (const sz of [-0.5, 0.5]) {
        out.push(new Vector3(s.centre.x + sx * s.size.x, s.centre.y + sy * s.size.y, s.centre.z + sz * s.size.z));
      }
    }
  }
  return out;
}

/** The corners on the stage's screen (CSS px, y down) under a view. */
function screenOf(v: cameraTypes.OrbitView, stage: cameraTypes.Box, pts: Vector3[]): { x: number; y: number }[] {
  const cam = new PerspectiveCamera();
  applyView(cam, v, stage.w / stage.h);
  cam.updateMatrixWorld(true);
  return pts.map((p) => {
    const q = p.clone().project(cam);
    return { x: stage.x + ((q.x + 1) / 2) * stage.w, y: stage.y + ((1 - q.y) / 2) * stage.h };
  });
}

/**
 * The machine framed in the free window: its projected corners fill `fill` of the window and sit at the window's middle, seated up by `SEAT_UP`.
 * The view is solved by a few steps, since perspective makes the scale and the middle move with the height and the target.
 */
export function frameMachine(
  stage: cameraTypes.Box,
  tabs: cameraTypes.Box[],
  machine: Solid,
  fill = FRAME_FILL,
): cameraTypes.OrbitView {
  const free = freeArea(stage, tabs);
  const fw = Math.max(50, free.w),
    fh = Math.max(50, free.h);
  const pts = cornersOf(machine);
  const { centre: c, size: s } = machine;
  // the start height: the machine's front rect fits the window
  let v = clampView(fitRect({ x: c.x - s.x / 2, y: -c.y - s.y / 2, w: s.x, h: s.y }, c.z, fw / fh, BUILD_START, 1));
  const tx = free.x + free.w / 2,
    ty = free.y + free.h / 2 - SEAT_UP * stage.h;
  for (let n = 0; n < 16; n++) {
    const p = screenOf(v, stage, pts);
    const minX = Math.min(...p.map((q) => q.x)),
      maxX = Math.max(...p.map((q) => q.x));
    const minY = Math.min(...p.map((q) => q.y)),
      maxY = Math.max(...p.map((q) => q.y));
    const k = Math.min((fill * fw) / Math.max(1, maxX - minX), (fill * fh) / Math.max(1, maxY - minY));
    const ex = (minX + maxX) / 2 - tx,
      ey = (minY + maxY) / 2 - ty;
    if (Math.abs(k - 1) < 0.002 && Math.abs(ex) < 0.5 && Math.abs(ey) < 0.5) {
      break;
    }
    // world units per CSS px at the target's plane, at the new height (the height spans the stage's height)
    const height = v.height / k,
      m = height / stage.h;
    v = clampView(panBy({ ...v, height }, ex * m, -ey * m));
  }
  return v;
}

/** The framing of a Build stage: while a drag is in progress the held view stands; otherwise the machine is framed in the free window. */
export function buildFrame(
  stage: cameraTypes.Box,
  tabs: cameraTypes.Box[],
  machine: Solid,
  held: cameraTypes.OrbitView,
  dragging: boolean,
): cameraTypes.OrbitView {
  return dragging ? held : frameMachine(stage, tabs, machine);
}
