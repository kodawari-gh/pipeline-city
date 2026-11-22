// Raycast picking of the 3D scene: an object answers with the hover id (`userData.id`) of the nearest ancestor that has one. The ids are the ones the Pixi renderer uses, so the HUD's tooltips and cards work as they are.
import { Raycaster, Vector2, type Camera, type Object3D, type Vector3 } from 'three';

export const tag = <T extends Object3D>(o: T, id: string): T => { o.userData.id = id; return o; };

/** The ray test of an object no ray stops at. One function for all: the merges keep meshes with different ray tests apart (`mergeSiblings`). */
export const NO_RAY = (): void => {};

/** See through this object: glass, glow and light cones never stop a ray. */
export const seeThrough = <T extends Object3D>(o: T): T => { o.raycast = NO_RAY; return o; };

export function idOf(o: Object3D | null): string | null {
  for (let p = o; p; p = p.parent) if (typeof p.userData.id === 'string') return p.userData.id;
  return null;
}

/** The object that carries the id (what the outline draws round). */
export function ownerOf(o: Object3D | null): Object3D | null {
  for (let p = o; p; p = p.parent) if (typeof p.userData.id === 'string') return p;
  return null;
}

export function findById(root: Object3D, id: string): Object3D | null {
  let hit: Object3D | null = null;
  root.traverse((o) => { if (!hit && o.userData.id === id) hit = o; });
  return hit;
}

/**
 * The layer of a mesh that is not drawn (no camera has it) and still answers a ray: a part whose stand-in draws in its place at a distance
 * (`partlod.ts`), so a pick and its outline find the part itself.
 */
export const UNDRAWN = 1;

/**
 * An unseen box that only answers a ray (an empty socket, a thin part easy to click): on the undrawn layer it costs no draw. With a clear
 * material alone it was a blended draw of the full light shader over all it covers, for no pixel.
 */
export const unseen = <T extends Object3D>(o: T): T => { o.layers.set(UNDRAWN); o.castShadow = o.receiveShadow = false; return o; };

const ray = new Raycaster(), at = new Vector2();
ray.layers.enable(UNDRAWN);

function hit(roots: readonly Object3D[], camera: Camera, nx: number, ny: number, skip?: (o: Object3D) => boolean) {
  at.set(nx, ny);
  ray.setFromCamera(at, camera);
  // a ray meets hidden objects too (a faded cooler, a shroud): skip them
  return ray.intersectObjects(roots as Object3D[], true).find((h) => shown(h.object) && !skip?.(h.object));
}

/** What is under the pointer (`nx`, `ny` in -1..1, y up). The nearest surface wins, even when it has no id: a wall hides what stands behind it. */
export const pick = (roots: readonly Object3D[], camera: Camera, nx: number, ny: number): Object3D | null => hit(roots, camera, nx, ny)?.object ?? null;

/**
 * Where the ray under the pointer meets that nearest surface (world), or null: the camera zooms and pans at its depth. `skip`: an object the ray goes through (a plate
 * that only takes a click over a window: the camera's depth is the surface behind it).
 */
export const pickPoint = (roots: readonly Object3D[], camera: Camera, nx: number, ny: number, skip?: (o: Object3D) => boolean): Vector3 | null => hit(roots, camera, nx, ny, skip)?.point ?? null;

export function shown(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
