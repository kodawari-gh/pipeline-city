// A press in the game's view (board3d.ts, the pad's `press`): what a drag from it lifts. A plug or a key as the pointer moves; an installed part
// on a mouse drag when it is small and the machine is off, else after a hold.
import { snapshot } from '@/app/store';
import type { Grab } from '@/core/render/three/pad';
import type { Pt } from '@/core/render/three/gesture';
import { deviceOf } from '../drag3d';
import { anchorsOf } from './anchors';
import { BIG_AREA, BIG_SIDE } from './consts';
import { cancelFlight } from './flights';
import { idAt } from './pointer';
import type { Scope } from './world';
import type { Drag3D } from './types';

/** A part this big on the screen (its larger side, or its share of the screen) is looked at, not carried: a mouse drag on it pans (a hold lifts it). */
const bigOnScreen = (s: Scope, id: string): boolean => {
  const [a] = anchorsOf(s, id),
    { W, H } = s.stage;
  return a !== undefined && (Math.max(a.w, a.h) > BIG_SIDE * Math.min(W, H) || a.w * a.h > BIG_AREA * W * H);
};
/** `Drag3D` took the pointer (it listens on the window): the canvas lets it go. False: refused (it said why), the press goes on as a pan. */
const taken = (s: Scope, ok: boolean, e: PointerEvent): boolean => {
  if (ok) {
    try {
      s.stage.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // (already released)
    }
  }
  return ok;
};

/** A key or a plug lifted by the pointer `ev`; false: refused. */
const liftGrab = (lift: Drag3D, grab: string, ev: PointerEvent): boolean =>
  grab.startsWith('key:') ? lift.beginKey(Number(grab.slice(4)), ev) : lift.beginCable(grab.slice(6), ev);

/** The cable a socket stands for while its plug is seated in it: pulling on the socket pulls its cable. */
function seatedCable(id: string): string | undefined {
  let seated: string | null = null;
  if (id === 'atx') {
    seated = 'atx';
  } else if (id === 'cpw') {
    seated = 'cpu';
  }
  if (seated === null) {
    return undefined;
  }
  const plugged = snapshot.peek()?.cables.some((c) => c.id === seated && c.connected) === true;
  return plugged ? `cable.${seated}` : undefined;
}

/**
 * The press at `at`: a plug or a key lifts as the pointer moves, a finger's too (it is small, and a press on it means to take it); a plug seated
 * in its socket is the socket to the ray. An installed part: a mouse drag on a small one lifts it. On a finger, on a part that fills the screen
 * and on a machine that runs, a drag pans over it (as over the empty board), and holding on it lifts it (or says why it cannot be: the machine
 * must be off).
 */
export function pressAt(s: Scope, lift: Drag3D, p: { at: Pt; e: PointerEvent }): Grab | null {
  cancelFlight(s);
  s.cam.atOverview = false;
  const id = idAt(s, { clientX: p.at.x, clientY: p.at.y }, { raw: false, grab: true });
  if (id === null || id === '') {
    return null;
  }
  const grab = id.startsWith('cable.') || id.startsWith('key:') ? id : seatedCable(id);
  if (grab !== undefined && grab !== '') {
    return {
      eager: true,
      lift: (ev) => taken(s, liftGrab(lift, grab, ev), ev),
    };
  }
  const dev = deviceOf(id, snapshot.peek());
  if (!dev) {
    return null;
  }
  return {
    eager: p.e.pointerType === 'mouse' && snapshot.peek()?.powered !== true && !bigOnScreen(s, dev.id),
    lift: (ev) => taken(s, lift.beginDevice(dev, ev), ev),
  };
}
