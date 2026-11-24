// The bridge from the HTML UI to the 3D world (docs/render/interact.md). The 3D renderer (`board3d.ts`) registers its
// anchors and flights with `setWorldAnchors`. Until then no id has a screen rectangle and no flight starts.
import type { FlyOpts } from '@/core/render/camera';

/** Screen rectangle of a world object, for popups and tutorial pointers (see `anchorOf`). */
export interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}
/** The world as the 3D renderer answers for it (`board3d.ts`): the same anchors and flights, from its own scene and camera. */
export interface WorldAnchors {
  anchorsOf(id: string): Anchor[];
  flyTo(id: string, opts: FlyOpts): boolean;
}
let world3d: WorldAnchors | null = null;
export function setWorldAnchors(w: WorldAnchors | null): void {
  world3d = w;
}

/** Every screen rectangle of a world id: for a loose cable its plug, then the sockets that take it. */
export function anchorsOf(id: string): Anchor[] {
  return world3d ? world3d.anchorsOf(id) : [];
}

/**
 * Live screen rectangle of a world id (any id in the render/interact.md table: slot ids, device ids, `psu`, `monitor`, `case`,
 * `bay`, `power`, `usb`, `tray`, `held`, `os`, `vrm`, `key:<id>`, `cable.*`, `chipset`, `board`). Client px (relative to
 * the viewport, canvas offset included). Same rects as hit testing. `visible` is false when the rect does not meet the
 * free area, or when the far-zoom exterior hides it. Returns null for unknown ids and inventory ids.
 * Recompute when `cameraRev` (src/app/interaction.ts) changes.
 */
export function anchorOf(id: string): Anchor | null {
  return anchorsOf(id)[0] ?? null;
}

/**
 * Fly the camera to a world object by id (any id listed in docs/render/interact.md: slot ids, device ids, 'key:<id>',
 * 'tray', 'usb', 'power', 'monitor', 'psu', 'chipset', 'board', 'cable.atx|cpu|video'). Unknown ids do nothing.
 * Returns whether the id was found (synchronously; `opts.onDone(false)` is then called too). Defaults and the
 * `onDone` contract are in docs/render/interact.md ("Flights"). A press, wheel, pinch or another flight cancels it.
 */
export function flyTo(id: string, opts: FlyOpts = {}): boolean {
  if (world3d) return world3d.flyTo(id, opts);
  opts.onDone?.(false);
  return false;
}

/** Does the world currently have an object with this id (so `flyTo` / `highlight` can find it)? */
export function hasTarget(id: string): boolean {
  return anchorsOf(id).length > 0;
}
