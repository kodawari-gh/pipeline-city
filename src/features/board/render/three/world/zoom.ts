// The zoom (board3d.ts): toward the surface under the pointer, which stays under it, as far as the walls and the furniture let the eye go.
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { retarget, zoomAt, zoomOn } from '@/core/render/three/camera';
import type { OrbitView } from '@/core/render/three/camera';
import { ndc } from './anchors';
import { cancelFlight } from './flights';
import { anchor } from './pointer';
import type { At } from './pointer';
import { aspect, inRoom, settle } from './view';
import type { Scope } from './world';

/**
 * The goal after a zoom by `k` that the room leaves as it is: `by(f)` is the view after a zoom by `f`. The whole zoom if the walls and the furniture
 * change neither the height nor the target of it (`inRoom`; a target that went into a piece makes the eye back out to the far wall), else the most of it
 * that they leave (found by halving), else null.
 */
const zoomHeld = (s: Scope, by: (f: number) => OrbitView, k: number): OrbitView | null => {
  const stands = (f: number): OrbitView | null => {
    const z = by(f),
      c = inRoom(s, z),
      tol = z.height * 0.004 + 1;
    return Math.abs(c.height - z.height) <= tol && Math.hypot(c.x - z.x, c.y - z.y, c.z - z.z) <= tol ? c : null;
  };
  const whole = stands(k);
  if (whole) {
    return whole;
  }
  // (the share of the zoom, in the log of its factor)
  let lo = 0,
    hi = 1,
    best: OrbitView | null = null;
  for (let i = 0; i < 8; i++) {
    const t = (lo + hi) / 2,
      c = stands(k ** t);
    if (c) {
      best = c;
      lo = t;
    } else {
      hi = t;
    }
  }
  return lo > 0.03 ? best : null;
};

/**
 * Zoom by the factor `k` (above 1 out) toward the point `e` (a wheel notch, or the middle of a pinch). `at`: the surface it goes toward when the
 * gesture has fixed it (a pinch: the one under its first fingers; null: none); else the one under the pointer now.
 */
export function zoomToward(
  s: Scope,
  e: At,
  by: { k: number; at: { x: number; y: number; z: number } | null | undefined },
): void {
  const { k, at } = by;
  cancelFlight(s);
  s.cam.atOverview = false;
  const { nx, ny } = ndc(s, e),
    a = aspect(s);
  // the zoom goes toward the surface under the pointer, which stays under it (`zoomOn`): each notch takes the same share of the way to it
  const p = at === undefined ? anchor(s, e) : at,
    base = p ? retarget(s.cam.goal, p.z) : s.cam.goal;
  const toward = (f: number) => (p ? zoomOn(base, p, f) : zoomAt(base, f, nx, ny, a));
  // out against a wall the zoom stops, and in against a piece of furniture it goes as far as the room lets the eye. Where it can go no further toward the
  // pointer (a piece stands between), it goes on about the middle of the view, so the view is never held where it is, and never thrown back out
  s.cam.goal = zoomHeld(s, toward, k) ?? zoomHeld(s, (f) => zoomAt(s.cam.goal, f, 0, 0, a), k) ?? s.cam.goal;
  settle(s);
}
