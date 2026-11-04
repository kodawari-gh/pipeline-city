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

/** A box of the world (y up): the eye stays in it (`keepInside`), or out of it (a block: a piece of furniture). */
export interface Room { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The near plane's distance, as a share of the eye's distance to the target (`applyView`). */
const NEAR = 0.04;
/** The eye keeps this far off a block, and keeps its near plane off it for a screen up to this wide: a block is never cut open. */
const BLOCK_GAP = 150, MAX_ASPECT = 2.4;

/**
 * The stretch [t0, t1] of the line of sight (t: the eye's distance from the target p) where the eye or its near plane comes within `gap` of
 * the box b, or null. On each axis they span p + t·lo to p + t·hi, so each face of the box gives a half-line of t; the stretch is their meet.
 */
function blocked(p: readonly number[], lo: readonly number[], hi: readonly number[], b: Room, gap: number): [number, number] | null {
  const bl = [b.x0, b.y0, b.z0], bh = [b.x1, b.y1, b.z1];
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    // p + t·lo <= bh + gap and p + t·hi >= bl - gap, each as a·t >= c
    for (const [a, c] of [[-lo[i]!, p[i]! - bh[i]! - gap], [hi[i]!, bl[i]! - gap - p[i]!]] as const) {
      if (Math.abs(a) < 1e-12) { if (c > 0) return null; } else if (a > 0) t0 = Math.max(t0, c / a); else t1 = Math.min(t1, c / a);
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/**
 * The stretch [near, far] of the line of sight (t: the eye's distance from the target) where the eye may stand: the first one free of the
 * blocks, inside the room (the target is in it). A block on the way stops the eye and its near plane (sized for a `fov`) short of it. From a
 * target at a block, or in one, the eye may move away; if that takes it into the block, it goes on through and out of the far side (and out
 * of any block that touches it there: `near`). Where the room ends first, it stops short of the block's face, or, from inside the block,
 * backs out as far as the room lets it.
 */
export function sight(v: OrbitView, r: Room, blocks: readonly Room[] = [], fov = v.fov): [number, number] {
  const c = Math.cos(v.pitch), sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), sp = Math.sin(v.pitch);
  const d = [sy * c, sp, cy * c], p = [v.x, v.y, v.z];
  const lo = [r.x0, r.y0, r.z0], hi = [r.x1, r.y1, r.z1];
  let room = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-9) continue;
    room = Math.min(room, ((d[i]! > 0 ? hi[i]! : lo[i]!) - p[i]!) / d[i]!);
  }
  room = Math.max(0, room);
  if (!blocks.length) return [0, room];
  // what the eye sweeps on each axis: itself, and its near plane (NEAR of the way back to the target, half as high as NEAR·tan(fov/2) along
  // the screen's up, up to MAX_ASPECT times that along its right)
  const k = NEAR * Math.tan((fov * Math.PI) / 360), right = [cy, 0, -sy], up = [-sy * sp, c, -cy * sp], sLo: number[] = [], sHi: number[] = [];
  for (let i = 0; i < 3; i++) {
    const mid = (1 - NEAR) * d[i]!, e = k * (Math.abs(right[i]!) * MAX_ASPECT + Math.abs(up[i]!));
    sLo.push(Math.min(d[i]!, mid - e));
    sHi.push(Math.max(d[i]!, mid + e));
  }
  // the stretches where the eye may not stand; a block the target is at counts from the target, if the eye would go into it
  const spans: [number, number][] = [];
  let face = Infinity, inside = false;
  for (const b of blocks) {
    const s = blocked(p, sLo, sHi, b, BLOCK_GAP);
    if (!s) continue;
    if (s[0] > 0) { spans.push(s); face = Math.min(face, s[0]); continue; }
    const into = blocked(p, d, d, b, 0);
    if (!into || into[1] <= into[0] + 1e-6) continue;
    spans.push([0, s[1]]);
    if (into[0] > 0) face = Math.min(face, into[0]); else inside = true;
  }
  spans.sort((a, b) => a[0] - b[0]);
  let near = 0, far = room;
  for (const [a, b] of spans) {
    if (a > near) { far = Math.min(far, a); break; }
    near = Math.max(near, b);
  }
  if (near <= far) return [near, far];
  return inside ? [room, room] : [0, Math.min(room, face)];
}

/** How far the eye can go from the target along its line of sight (the far end of its `sight`). */
export const reach = (v: OrbitView, r: Room, blocks: readonly Room[] = [], fov = v.fov): number => sight(v, r, blocks, fov)[1];

/**
 * `v` with its eye inside the room: the walls, the floor and the ceiling then hide all that is outside. The target is first moved into the room
 * (`z0` may be behind the eye's own limit, `targetZ0`). A room view (a fov of `fovBase` or more) widens its fov up to `fovMax` to keep the
 * height it shows from closer; past that, or for a narrower view, the height comes down. `restore`: a widened fov goes back toward `fovBase`
 * when the room allows it (a goal); an eased view never narrows here, so it does not jump. `blocks`: the furniture, which the eye keeps out of
 * as it keeps off the walls; from a target at a piece or in it, the eye backs out through it and the height comes up (`sight`).
 */
export function keepInside(v: OrbitView, r: Room, o: { targetZ0?: number; fovBase?: number; fovMax?: number; restore?: boolean; blocks?: readonly Room[] } = {}): OrbitView {
  const base = o.fovBase ?? 26, max = o.fovMax ?? 40;
  const out = { ...v, x: clamp(v.x, r.x0, r.x1), y: clamp(v.y, r.y0, r.y1), z: clamp(v.z, o.targetZ0 ?? r.z0, r.z1) };
  // (the near plane is sized for the widest fov this view may take)
  const [near, far] = sight(out, r, o.blocks, out.fov >= base - 1e-6 ? Math.max(max, out.fov) : out.fov);
  if (out.fov >= base - 1e-6) {
    const need = (2 * Math.atan(out.height / (2 * Math.max(1, far))) * 180) / Math.PI;
    out.fov = o.restore ? clamp(need, base, max) : clamp(Math.max(need, out.fov), base, Math.max(max, out.fov));
  }
  const tan = Math.tan((out.fov * Math.PI) / 360);
  if (distanceOf(out) > far * (1 + 1e-9)) out.height = Math.max(LIMITS.heightMin, 2 * far * tan);
  if (distanceOf(out) < near * (1 - 1e-9)) out.height = Math.min(LIMITS.heightMax, 2 * near * tan);
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
  camera.near = Math.max(4, d * NEAR);
  camera.far = d + 120000;
  camera.updateProjectionMatrix();
}
