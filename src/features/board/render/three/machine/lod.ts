// The machine's level of detail (machine3d.ts), per frame after the camera moved: each reveal gets the zoom seen at its point, the small parts
// their stand-ins by the zoom at the case's nearest point, then each surface asks for the texture tiles it needs.
import { Box3, Vector3 } from 'three';
import { seenZoom } from '@/core/render/lod/lod';
import { frustumOf, screenPx } from '@/core/render/three/artlod';
import { setCaseShade } from '@/core/render/three/caseshade';
import { lowDetail } from '@/core/render/three/detail';
import { CASE_IN } from '../../layout/layout';
import { CASE_PASS } from './consts';
import type { MachineParts, PerspectiveCamera, RectLike, Reveal } from './types';

const LOD_AT = new Vector3(),
  LOD_DIR = new Vector3(),
  NEAREST = new Vector3(),
  LOD_BOX = new Box3();

/** The point of the box `b` nearest the view's centre line: the line's point nearest the box's middle, held inside the box. */
function nearestIn(b: Box3, eye: Vector3, dir: Vector3): Vector3 {
  b.getCenter(NEAREST).sub(eye);
  const t = Math.max(0, NEAREST.dot(dir));
  return NEAREST.copy(dir).multiplyScalar(t).add(eye).clamp(b.min, b.max);
}

/** Where the view's centre line meets the plane at depth `z`, held inside the layout rect `r`. */
function nearestOn(r: RectLike, z: number, cam: PerspectiveCamera): Vector3 {
  const eye = cam.position,
    dir = LOD_DIR;
  const t = Math.abs(dir.z) > 1e-6 ? (z - eye.z) / dir.z : 0,
    x = eye.x + dir.x * t,
    y = eye.y + dir.y * t;
  return NEAREST.set(Math.max(r.x, Math.min(r.x + r.w, x)), Math.max(-(r.y + r.h), Math.min(-r.y, y)), z);
}

/** The point a reveal reads the zoom at: its box's or its area's point nearest the view's centre, or its own. */
function pointOf(r: Reveal, cam: PerspectiveCamera): Vector3 {
  if (r.box) {
    return nearestIn(r.box, cam.position, LOD_DIR);
  }
  return r.area ? nearestOn(r.area, r.at.z, cam) : r.at;
}

/** How near the view's centre a projected point is (1 there, 0 at 1.2 off it or behind the camera); `anywhere` reads 1. */
function focusOf(r: Reveal, p: Vector3): number {
  if (r.anywhere) {
    return 1;
  }
  return p.z > 1 ? 0 : Math.max(0, 1 - Math.hypot(p.x, p.y) / 1.2);
}

/**
 * Level of detail, per frame after the camera moved: each reveal gets the zoom seen at its point (screen pixels per unit there, less toward the
 * edge of the view: `seenZoom`, so the bands are the 2D ones), then each surface asks for the texture tiles it needs.
 */
export function levelOfDetail(m: MachineParts, cam: PerspectiveCamera, view: { H: number; dpr: number }): void {
  const now = performance.now(),
    { H, dpr } = view;
  frustumOf(cam, m.frustum);
  cam.getWorldDirection(LOD_DIR);
  // the board view's zoom on this screen (`boardView` in board3d.ts: the inside of the case, fitted at 0.95)
  if (m.door) {
    m.door.board = (H * 0.95) / Math.max(CASE_IN.h, CASE_IN.w / cam.aspect);
  }
  for (const r of m.reveals) {
    const at = pointOf(r, cam);
    const p = LOD_AT.copy(at).project(cam),
      focus = focusOf(r, p),
      px = screenPx(cam.position.distanceTo(at), cam.fov, H);
    r.apply(seenZoom(px, focus));
  }
  // (no router board: the room's router, if one stands, keeps its shell)
  if (!m.routerBits) {
    m.onRouterShell?.(1);
  }
  // the small parts as stand-ins from afar (after the reveals: a stand-in follows what they show and hide), by the zoom at the case's nearest point
  // Low: the case's shadow on the spot lights (`caseshade.ts`); the glass side lets the light in, the top filter a part of it
  if (lowDetail()) {
    setCaseShade(m.shadeBox, m.root.matrixWorld, CASE_PASS);
  }
  m.partLod?.update(
    screenPx(LOD_BOX.copy(m.caseBox).applyMatrix4(m.root.matrixWorld).distanceToPoint(cam.position), cam.fov, H),
  );
  m.art.update(cam, m.frustum, H, dpr, now);
}
