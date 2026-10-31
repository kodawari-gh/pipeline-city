// The 3D camera (docs/THREE_SETUP.md): one perspective camera on an orbit. A view is a target, two angles, the world height it shows at the
// target and a field of view; the distance follows from those, so a narrow fov reads nearly orthographic (the board view) and a tween of the fov is
// a dolly zoom with no jump. The maths is pure and tested; only `applyView` touches Three.
import type { PerspectiveCamera } from 'three';

export interface OrbitView { x: number; y: number; z: number; yaw: number; pitch: number; height: number; fov: number }
export interface Box { x: number; y: number; w: number; h: number }

export const LIMITS = { yaw: 1.1, pitchMin: -0.08, pitchMax: 0.75, heightMin: 90, heightMax: 34000 };
/** Share of the gap to the goal that remains after one second. */
const EASE_LEFT = 0.002;

export const distanceOf = (v: Pick<OrbitView, 'height' | 'fov'>): number => v.height / (2 * Math.tan((v.fov * Math.PI) / 360));

export function eyeOf(v: OrbitView): { x: number; y: number; z: number } {
  const d = distanceOf(v), c = Math.cos(v.pitch);
  return { x: v.x + d * Math.sin(v.yaw) * c, y: v.y + d * Math.sin(v.pitch), z: v.z + d * Math.cos(v.yaw) * c };
}

export function clampView(v: OrbitView): OrbitView {
  return {
    ...v,
    yaw: Math.max(-LIMITS.yaw, Math.min(LIMITS.yaw, v.yaw)),
    pitch: Math.max(LIMITS.pitchMin, Math.min(LIMITS.pitchMax, v.pitch)),
    height: Math.max(LIMITS.heightMin, Math.min(LIMITS.heightMax, v.height)),
  };
}

/** The view height that fits a `w` by `h` box on a screen of this aspect, with the margin (1 fills the screen). */
export const fitHeight = (w: number, h: number, aspect: number, margin = 0.92): number => Math.max(h, w / aspect) / margin;

/** Show a rect of the layout (y down, the 2D world) on the plane z. */
export function fitRect(r: Box, z: number, aspect: number, from: Pick<OrbitView, 'yaw' | 'pitch' | 'fov'>, margin?: number): OrbitView {
  return clampView({ ...from, x: r.x + r.w / 2, y: -(r.y + r.h / 2), z, height: fitHeight(r.w, r.h, aspect, margin) });
}

/** Zoom by `k` (under 1 closer), keeping the point at (nx, ny) on the screen (-1..1, y up) where it is. */
export function zoomAt(v: OrbitView, k: number, nx: number, ny: number, aspect: number): OrbitView {
  const height = Math.max(LIMITS.heightMin, Math.min(LIMITS.heightMax, v.height * k)), shift = (v.height - height) / 2;
  return panBy({ ...v, height }, nx * shift * aspect, ny * shift);
}

/** Move the target by (dx, dy) world units along the screen's right and up axes. */
export function panBy(v: OrbitView, dx: number, dy: number): OrbitView {
  const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), sp = Math.sin(v.pitch), cp = Math.cos(v.pitch);
  return { ...v, x: v.x + dx * cy - dy * sp * sy, y: v.y + dy * cp, z: v.z - dx * sy - dy * sp * cy };
}

export function orbitBy(v: OrbitView, dYaw: number, dPitch: number): OrbitView {
  return clampView({ ...v, yaw: v.yaw + dYaw, pitch: v.pitch + dPitch });
}

/** One frame of easing toward `goal`. Height eases by ratio, so a long zoom feels even. Independent of the frame rate. */
export function stepView(v: OrbitView, goal: OrbitView, dt: number): OrbitView {
  const t = 1 - Math.pow(EASE_LEFT, Math.max(0, dt)), mix = (a: number, b: number) => a + (b - a) * t;
  return {
    x: mix(v.x, goal.x), y: mix(v.y, goal.y), z: mix(v.z, goal.z), yaw: mix(v.yaw, goal.yaw), pitch: mix(v.pitch, goal.pitch), fov: mix(v.fov, goal.fov),
    height: Math.exp(mix(Math.log(v.height), Math.log(goal.height))),
  };
}

export function applyView(camera: PerspectiveCamera, v: OrbitView, aspect: number): void {
  const eye = eyeOf(v), d = distanceOf(v);
  camera.position.set(eye.x, eye.y, eye.z);
  camera.lookAt(v.x, v.y, v.z);
  camera.fov = v.fov;
  camera.aspect = aspect;
  // the depth range follows the distance: a close look at a die keeps its precision
  camera.near = Math.max(4, d * 0.04);
  camera.far = d + 120000;
  camera.updateProjectionMatrix();
}
