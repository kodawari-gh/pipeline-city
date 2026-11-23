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

/** What `keepInside` takes besides the view and the room (see there). */
export interface KeepOpts { targetZ0?: number; fovBase?: number; fovMax?: number; restore?: boolean; blocks?: readonly Room[] }

/**
 * `v` with its eye inside the room: the walls, the floor and the ceiling then hide all that is outside. The target is first moved into the room
 * (`z0` may be behind the eye's own limit, `targetZ0`). A room view (a fov of `fovBase` or more) widens its fov up to `fovMax` to keep the
 * height it shows from closer; past that, or for a narrower view, the height comes down. `restore`: a widened fov goes back toward `fovBase`
 * when the room allows it (a goal); an eased view never narrows here, so it does not jump. `blocks`: the furniture, which the eye keeps out of
 * as it keeps off the walls; from a target at a piece or in it, the eye backs out through it and the height comes up (`sight`).
 */
export function keepInside(v: OrbitView, r: Room, o: KeepOpts = {}): OrbitView {
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

/** The step (world units along y) and the number of steps each way that `keepWhole` tries. */
const SLIDE = 80, SLIDES = 60;

/**
 * `keepInside` for a view that is placed by fitting (the overview) or flies to such a place, not one the player moves. A target a little under a block's
 * face (the desk's top, with the eye above it) leaves the eye a line of sight of a few thousand units before the block, and `keepInside` shrinks the view to
 * a sliver of the room: the underside of the desk and the blind. The target slides up or down by the least that gives the view back `share` of the height
 * the room alone allows. `toward`: the y a flight goes to; the slide then goes that way (as far as it takes to clear the block), so a view on its way is never
 * held back above the block. Without it the slide is the shortest, up or down.
 */
export function keepWhole(v: OrbitView, r: Room, o: KeepOpts = {}, share = 0.6, toward?: number): OrbitView {
  const kept = keepInside(v, r, o);
  if (!o.blocks?.length) return kept;
  const room = keepInside(v, r, { ...o, blocks: [] }).height;
  if (kept.height >= room * share) return kept;
  const steps = Array.from({ length: SLIDES }, (_, i) => (i + 1) * SLIDE), way = toward !== undefined && toward < v.y ? -1 : 1;
  // (a flight: toward its goal, then back; else up and down by turns, the shortest first)
  for (const d of toward === undefined ? steps.flatMap((s) => [s, -s]) : [...steps.map((s) => way * s), ...steps.map((s) => -way * s)]) {
    const slid = keepInside({ ...v, y: v.y + d }, r, o);
    if (slid.height >= room * share) return slid;
  }
  return kept;
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

/**
 * `v` frames a small target in the middle of the band the HUD leaves free (`top` and `bottom`: its insets in px, on a screen `screen` px tall). A tall
 * card at the bottom lifts that band's middle toward the top, and the eye with it: from up there furniture in front of the desk (the hoodie on the chair)
 * hides what stands on the desk. The target goes down to the middle of the screen instead, no lower than the band lets all of it show (`h`: its height in
 * world units, `margin` px round it): the eye moves no further than the HUD forces.
 */
export function lowerInBand(v: OrbitView, inset: { top: number; bottom: number }, screen: number, h: number, margin = 24): OrbitView {
  const k = v.height / screen, half = h / k / 2 + margin;
  const at = Math.min(Math.max(screen / 2, inset.top + half), screen - inset.bottom - half), mid = (inset.top + screen - inset.bottom) / 2;
  return panBy(v, 0, (at - mid) * k);
}

/**
 * How much a turn may change the view before the room has stopped it. The height of the view may change by this share (the eye next to a wall or a piece of
 * furniture has run out of room to back off: `keepInside` would shrink the view into it); and one step of the turn may move the eye this much more than the
 * plain orbit would, in shares of its distance (the line of sight comes to a piece's edge: `keepInside` would put the eye in front of it, or on its far side, at once).
 */
const TURN_SLACK = 0.2, TURN_JUMP = 4, TURN_JUMP_PLAIN = 0.004;

/**
 * The angles a turn reaches. The view `base` turns about its target from the angles `from` toward the angles `to` (both inside the limits); `fit` is
 * the room's say on a view (`keepInside`). The turn goes all the way if the room leaves the view at about the height `ref` all along the step, and the
 * eye moves as a plain orbit moves it (a few times the arc, no jump); else it stops where it last did (found by stepping along it, then halving): a wall
 * or a piece of furniture stops a turn, it never shrinks the view into it or throws the eye to the far side of it. The step is short (a pointer event),
 * and each stops at the end of the one before, so the view never snaps back. Stopped, it slides: the yaw alone, or the pitch alone, whichever goes farther
 * (as a pan slides along a wall).
 */
export function turnReach(base: OrbitView, from: { yaw: number; pitch: number }, to: { yaw: number; pitch: number }, fit: (v: OrbitView) => OrbitView, ref = fit(base).height): { yaw: number; pitch: number } {
  const calm = (a: OrbitView, b: OrbitView, arc: number): boolean => {
    if (b.height < ref * (1 - TURN_SLACK) || b.height > ref * (1 + TURN_SLACK)) return false;
    const p = eyeOf(a), q = eyeOf(b);
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) <= distanceOf(a) * (TURN_JUMP * arc + TURN_JUMP_PLAIN);
  };
  const along = (end: { yaw: number; pitch: number }): { yaw: number; pitch: number } => {
    const at = (t: number) => ({ yaw: from.yaw + (end.yaw - from.yaw) * t, pitch: from.pitch + (end.pitch - from.pitch) * t });
    const span = Math.hypot(end.yaw - from.yaw, end.pitch - from.pitch), N = Math.max(6, Math.ceil(span / 0.02));
    let lo = 0, seen = fit({ ...base, ...from }), hi = 1;
    for (let i = 1; i <= N; i++) {
      const c = fit({ ...base, ...at(i / N) });
      if (!calm(seen, c, span / N)) { hi = i / N; break; }
      lo = i / N; seen = c;
    }
    if (hi === 1 && lo === 1) return end;
    for (let i = 0; i < 8; i++) {
      const t = (lo + hi) / 2, c = fit({ ...base, ...at(t) });
      if (calm(seen, c, span * (t - lo))) { lo = t; seen = c; } else hi = t;
    }
    return at(lo);
  };
  const whole = along(to);
  if (whole === to) return to;
  const run = (a: { yaw: number; pitch: number }) => Math.hypot(a.yaw - from.yaw, a.pitch - from.pitch);
  const best = [along({ yaw: to.yaw, pitch: from.pitch }), along({ yaw: from.yaw, pitch: to.pitch })].reduce((a, b) => (run(b) > run(a) ? b : a));
  return run(best) > run(whole) ? best : whole;
}

export function orbitBy(v: OrbitView, dYaw: number, dPitch: number): OrbitView {
  return clampView({ ...v, yaw: v.yaw + dYaw, pitch: v.pitch + dPitch });
}

/** The eye's distance to the plane at depth z along its line of sight (to the target's own plane: `distanceOf`). */
const sightTo = (v: OrbitView, z: number): number => distanceOf(v) + (v.z - z) / (Math.cos(v.yaw) * Math.cos(v.pitch));

/** The world height a view shows at depth z, where its line of sight meets that plane: it depends on the picture only, not on the target. */
export const heightAt = (v: OrbitView, z: number): number => Math.max(1e-6, sightTo(v, z)) * 2 * Math.tan((v.fov * Math.PI) / 360);

/** The same picture with its target slid along the line of sight onto the plane at depth z (the eye stays): a zoom or a turn then keeps that plane still. */
export function retarget(v: OrbitView, z: number): OrbitView {
  const k = distanceOf(v) - sightTo(v, z), c = Math.cos(v.pitch);
  return { ...v, x: v.x + k * Math.sin(v.yaw) * c, y: v.y + k * Math.sin(v.pitch), z, height: heightAt(v, z) };
}

/**
 * Zoom by `k` (under 1 closer) about the world point p (the surface under the pointer): the eye moves straight toward p, so p stays where it is
 * on the screen, and the target comes onto p's depth. The height limits hold there, at the surface: a target that floats in front of it would
 * stop the zoom short of it, and slow it down on the way.
 */
export function zoomOn(v: OrbitView, p: { x: number; y: number; z: number }, k: number): OrbitView {
  const r = retarget(v, p.z), height = zoomed(r.height, k, LIMITS.heightMin, LIMITS.heightMax), s = height / r.height;
  return { ...r, x: p.x + (r.x - p.x) * s, y: p.y + (r.y - p.y) * s, height };
}

/**
 * The height after a zoom by `k` from `h`, held in [min, max] and never against the way asked: a surface that already lies past a limit (a part
 * that stands out in front of the target's plane) stays where it is, and a zoom back toward the range goes on. A plain clamp backed off from it.
 */
const zoomed = (h: number, k: number, min: number, max: number): number => (k < 1 ? Math.min(h, Math.max(min, h * k)) : Math.max(h, Math.min(max, h * k)));

/**
 * `zoomOn` for a view that turns all the way round (the shop's viewer): a plane of constant depth z runs along the line of sight from the side. Here the
 * plane that holds still is the one through p that faces the eye. The eye moves straight toward p, p stays where it is on the screen, and the
 * target comes onto that plane. `lim`: the height limits, at that plane.
 */
export function zoomAbout(v: OrbitView, p: { x: number; y: number; z: number }, k: number, lim: { min: number; max: number }): OrbitView {
  const e = eyeOf(v), c = Math.cos(v.pitch), tan = 2 * Math.tan((v.fov * Math.PI) / 360);
  // (the line of sight, a unit vector from the eye to the target)
  const fx = -Math.sin(v.yaw) * c, fy = -Math.sin(v.pitch), fz = -Math.cos(v.yaw) * c;
  const depth = Math.max(1e-6, (p.x - e.x) * fx + (p.y - e.y) * fy + (p.z - e.z) * fz);
  const height = zoomed(depth * tan, k, lim.min, lim.max), s = height / (depth * tan);
  // (the target on the line of sight at p's depth, drawn toward p by the same share as the eye)
  return { ...v, x: p.x + (e.x + fx * depth - p.x) * s, y: p.y + (e.y + fy * depth - p.y) * s, z: p.z + (e.z + fz * depth - p.z) * s, height };
}

/** One frame of easing toward `goal`. Height eases by ratio, so a long zoom feels even. Independent of the frame rate. */
export function stepView(v: OrbitView, goal: OrbitView, dt: number): OrbitView {
  const t = 1 - Math.pow(EASE_LEFT, Math.max(0, dt)), mix = (a: number, b: number) => a + (b - a) * t;
  return {
    x: mix(v.x, goal.x), y: mix(v.y, goal.y), z: mix(v.z, goal.z), yaw: mix(v.yaw, goal.yaw), pitch: mix(v.pitch, goal.pitch), fov: mix(v.fov, goal.fov),
    height: Math.exp(mix(Math.log(v.height), Math.log(goal.height))),
  };
}

/** Has the view as good as reached its goal? (`stepView`'s ease never quite ends.) */
export function settled(v: OrbitView, goal: OrbitView): boolean {
  const far = goal.height * 1e-3;
  return Math.abs(v.x - goal.x) < far && Math.abs(v.y - goal.y) < far && Math.abs(v.z - goal.z) < far && Math.abs(v.height - goal.height) < far
    && Math.abs(v.yaw - goal.yaw) < 1e-3 && Math.abs(v.pitch - goal.pitch) < 1e-3 && Math.abs(v.fov - goal.fov) < 1e-2;
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
