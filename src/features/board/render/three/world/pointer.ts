// What lies under the pointer (board3d.ts): the surface a zoom and a pan go at, the id a hover or a click finds, and a loose or seated plug
// within a thumb's reach.
import { Vector3 } from 'three';
import { INERT_REGIONS } from '@/app/hover';
import { snapshot } from '@/app/store';
import { idOf, pick, pickPoint } from '@/core/render/three/pick';
import { eyeRoom } from '@/features/room/render/three/roomplan';
import { GRAB_PX, SEATED_PX, TARGET_Z0 } from './consts';
import { anchorsOf, ndc, roots } from './anchors';
import type { Scope } from './world';
import type { At } from './types';

/**
 * The surface under a client point (world), if a target may lie there (not on a wall or the floor, not out of the window): a zoom and a pan go at its depth.
 * The shut side panel is glass, and the plate that takes a click on it (`case.side`) is no surface: the ray goes through it to the board, so a zoom and a pan
 * take hold of what is seen (at the plate's depth the board would move slower than the pointer, and a zoom would stop at the glass).
 */
export const anchor = (s: Scope, e: At): Vector3 | null => {
  const { nx, ny } = ndc(s, e),
    p = pickPoint(roots(s), s.stage.camera, nx, ny, (o) => idOf(o) === 'case.side'),
    r = eyeRoom();
  return p && p.z >= TARGET_Z0 && p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1 ? p : null;
};

/** The seated plugs' seats on the screen: a fan's header plug is a few pixels, so its seat is a handle too, a shorter reach. */
function seatedPlugs(s: Scope): Scope['grip']['plugs']['list'] {
  const r = s.stage.canvas.getBoundingClientRect(),
    out: Scope['grip']['plugs']['list'] = [];
  for (const c of (snapshot.peek()?.cables ?? []).filter((x) => x.connected)) {
    const rig = s.held.machine?.rig(c.id);
    if (!rig) {
      continue;
    }
    const q = new Vector3(...rig.seat.at).project(s.stage.camera);
    if (q.z < 1 && Math.abs(q.x) < 1 && Math.abs(q.y) < 1) {
      out.push({
        id: `cable.${c.id}`,
        x: r.left + ((q.x + 1) / 2) * r.width,
        y: r.top + ((1 - q.y) / 2) * r.height,
        reach: SEATED_PX,
      });
    }
  }
  return out;
}

/** The loose plugs' screen centres, measured again after a moment (they fall and the camera moves). */
function measurePlugs(s: Scope, now: number) {
  const { grip, cam } = s;
  const loose = (snapshot.peek()?.cables ?? []).filter((c) => !c.connected);
  grip.plugs = {
    at: now,
    key: cam.revKey,
    list: loose.flatMap((c) => {
      const [a] = anchorsOf(s, `cable.${c.id}`);
      return a ? [{ id: `cable.${c.id}`, x: a.x + a.w / 2, y: a.y + a.h / 2 }] : [];
    }),
  };
  grip.plugs.list.push(...seatedPlugs(s));
}

/** The plug nearest the client point (x, y) within `maxPx` and its own reach, or null. */
const looseNear = (s: Scope, at: { x: number; y: number }, maxPx = GRAB_PX): string | null => {
  const now = performance.now();
  if (now - s.grip.plugs.at > 120 || s.grip.plugs.key !== s.cam.revKey) {
    measurePlugs(s, now);
  }
  let best: string | null = null,
    d = maxPx;
  for (const p of s.grip.plugs.list) {
    const k = Math.hypot(p.x - at.x, p.y - at.y);
    if (k <= Math.min(d, p.reach ?? GRAB_PX)) {
      d = k;
      best = p.id;
    }
  }
  return best;
};

/** The id under a client point; `raw`: the backdrops too (the board, the case), which hover nothing but take a dropped plug; `grab`: a plug near it wins. */
export const idAt = (s: Scope, e: At, how: { raw?: boolean; grab?: boolean } = {}): string | null => {
  const { raw = false, grab = false } = how,
    { nx, ny } = ndc(s, e),
    hit = s.live.chips.hitAt(s.stage.camera, s.stage.H, nx, ny) ?? idOf(pick(roots(s), s.stage.camera, nx, ny)),
    id = s.held.machine ? s.held.machine.pickId(hit) : hit;
  // a loose plug is small and lies among parts: one within a thumb's reach of the pointer is the one meant (not for a drop's raw id)
  // on a cable hit the nearest seat still wins: fan headers lie 11 px apart, the ray may hit the neighbour
  if (grab && !raw) {
    const p = looseNear(s, { x: e.clientX, y: e.clientY }, id?.startsWith('cable.') === true ? SEATED_PX : GRAB_PX);
    if (p !== null) {
      return p;
    }
  }
  return id !== null && id !== undefined && id !== '' && (raw || !INERT_REGIONS.has(id)) ? id : null;
};
