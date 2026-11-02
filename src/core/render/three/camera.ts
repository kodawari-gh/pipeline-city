// The 3D camera (docs/THREE_SETUP.md): one perspective camera on an orbit. A view is a target, two angles, the world height it shows at the
// target and a field of view; the distance follows from those, so a narrow fov reads nearly orthographic (the board view) and a tween of the fov is
// a dolly zoom with no jump. The maths is pure and tested; only `applyView` touches Three.
import type { PerspectiveCamera } from 'three';

export interface OrbitView { x: number; y: number; z: number; yaw: number; pitch: number; height: number; fov: number }
export interface Box { x: number; y: number; w: number; h: number }

// (`heightMin`: the die is drawn at 0.7 of its own frame, so the closest view shows 90 of that frame's units)
export const LIMITS = { yaw: 1.1, pitchMin: -0.08, pitchMax: 0.75, heightMin: 63, heightMax: 34000 };
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

/** A box of the world (y up): the eye stays in it (`keepInside`). */
export interface Room { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** How far the eye can go from the target, along its line of sight, before it leaves the room (the target is in it). */
export function reach(v: OrbitView, r: Room): number {
  const c = Math.cos(v.pitch), d = [Math.sin(v.yaw) * c, Math.sin(v.pitch), Math.cos(v.yaw) * c], p = [v.x, v.y, v.z];
  const lo = [r.x0, r.y0, r.z0], hi = [r.x1, r.y1, r.z1];
  let t = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-9) continue;
    t = Math.min(t, ((d[i]! > 0 ? hi[i]! : lo[i]!) - p[i]!) / d[i]!);
  }
  return Math.max(0, t);
}

/**
 * `v` with its eye inside the room: the walls, the floor and the ceiling then hide all that is outside. The target is first moved into the room
 * (`z0` may be behind the eye's own limit, `targetZ0`). A room view (a fov of `fovBase` or more) widens its fov up to `fovMax` to keep the
 * height it shows from closer; past that, or for a narrower view, the height comes down. `restore`: a widened fov goes back toward `fovBase`
 * when the room allows it (a goal); an eased view never narrows here, so it does not jump.
 */
export function keepInside(v: OrbitView, r: Room, o: { targetZ0?: number; fovBase?: number; fovMax?: number; restore?: boolean } = {}): OrbitView {
  const base = o.fovBase ?? 26, max = o.fovMax ?? 40;
  const out = { ...v, x: clamp(v.x, r.x0, r.x1), y: clamp(v.y, r.y0, r.y1), z: clamp(v.z, o.targetZ0 ?? r.z0, r.z1) };
  const far = reach(out, r);
  if (out.fov >= base - 1e-6) {
    const need = (2 * Math.atan(out.height / (2 * Math.max(1, far))) * 180) / Math.PI;
    out.fov = o.restore ? clamp(need, base, max) : clamp(Math.max(need, out.fov), base, Math.max(max, out.fov));
  }
  if (distanceOf(out) > far * (1 + 1e-9)) out.height = Math.max(LIMITS.heightMin, 2 * far * Math.tan((out.fov * Math.PI) / 360));
  return out;
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
