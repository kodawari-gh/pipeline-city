// Raycast picking of the 3D scene: an object answers with the hover id (`userData.id`) of the nearest ancestor that has one. The ids are the ones the Pixi renderer uses, so the HUD's tooltips and cards work as they are.
import { Raycaster, Vector2, type Camera, type Object3D } from 'three';

export const tag = <T extends Object3D>(o: T, id: string): T => { o.userData.id = id; return o; };

/** See through this object: glass, glow and light cones never stop a ray. */
export const seeThrough = <T extends Object3D>(o: T): T => { o.raycast = () => {}; return o; };

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

const ray = new Raycaster(), at = new Vector2();

/** What is under the pointer (`nx`, `ny` in -1..1, y up). The nearest surface wins, even when it has no id: a wall hides what stands behind it. */
export function pick(roots: readonly Object3D[], camera: Camera, nx: number, ny: number): Object3D | null {
  at.set(nx, ny);
  ray.setFromCamera(at, camera);
  return ray.intersectObjects(roots as Object3D[], true)[0]?.object ?? null;
}
