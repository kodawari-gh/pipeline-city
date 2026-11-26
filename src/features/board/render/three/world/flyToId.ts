// The tutorial's and the cards' flights to an id (board3d.ts `flyToId`, the same contract as the 2D renderer's `flyTo` in board.ts): the
// target framed with room round it, a plug or a key close enough to grab, under the desk from low down.
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { Box3 } from 'three';
import { viewInset } from '@/app/hover';
import type { FlyOpts } from '@/core/render/camera';
import { lowerInBand } from '@/core/render/three/camera';
import type { OrbitView } from '@/core/render/three/camera';
import { boxesOf } from './anchors';
import { flyTo } from './flights';
import { windowFor } from './flyWindow';
import { inFree, overview } from './view';
import type { Scope } from './world';

/** Flies to what the id stands for (a key with its port); false: nothing of it in the scene. */
export const flyToId = (s: Scope, id: string, o: FlyOpts): boolean => {
  const box = new Box3();
  // a key shows with its port
  for (const i of id.startsWith('key:') ? [id, 'usb'] : [id]) {
    for (const b of boxesOf(s, i)) {
      box.union(b);
    }
  }
  if (box.isEmpty()) {
    o.onDone?.(false);
    return false;
  }
  const { H } = s.stage,
    bh = box.max.y - box.min.y,
    win = windowFor(s, id, box);
  let v: OrbitView = inFree(s, win.rect, win.fit);
  v = { ...v, height: Math.min(v.height, overview(s).height) };
  if (o.zoom !== undefined && Boolean(o.zoom)) {
    v = { ...v, height: H / o.zoom };
  }
  // A key and its port are small: the eye moves no further than the HUD forces. Centred in the band the tutorial card leaves (it takes the bottom third),
  // the eye would sit so high that the hoodie on the chair hides the key on its rack, and a press on it would pan instead of lift (`lowerInBand`).
  if (id.startsWith('key:')) {
    v = lowerInBand(v, viewInset.peek(), H, bh);
  }
  flyTo(s, v);
  if (o.smooth === false) {
    s.cam.view = s.cam.goal;
  }
  s.cam.pending = o.onDone ?? ((): void => undefined);
  return true;
};
