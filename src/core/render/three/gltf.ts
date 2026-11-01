// glTF models for parts (docs/GRAPHICS_3D_OVERHAUL.md "Models"): a part whose key is in `MODEL_FILES` (features/board/render/three/models3d.ts) wears a
// loaded model in place of its primitives. The file loads once and is cloned for each use; until it is there, and when it fails, the primitives stay.
import { Box3, Vector3, type Group, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<Object3D | null>>();

/** The model of a url, loaded once; null when it cannot be loaded. */
export function loadModel(url: string): Promise<Object3D | null> {
  let p = cache.get(url);
  if (!p) { p = loader.loadAsync(url).then((g) => g.scene, () => null); cache.set(url, p); }
  return p;
}

/**
 * Scale `o` to fit the layout rect `r` (x right, y down) and stand it on depth `z0`, no taller than up to `z1`; its middle goes to the rect's middle.
 * Evenly by default; `stretch`: x and y each fill the rect (a part that is only a block, like a heat sink), the height keeps to the smaller of them.
 */
export function fitModel(o: Object3D, r: { x: number; y: number; w: number; h: number }, z0: number, z1: number, stretch = false): Object3D {
  const box = new Box3().setFromObject(o), size = box.getSize(new Vector3()), mid = box.getCenter(new Vector3());
  const kx = r.w / (size.x || 1), ky = r.h / (size.y || 1), kz = Math.min((z1 - z0) / (size.z || 1), stretch ? Math.min(kx, ky) : Infinity);
  const k = stretch ? new Vector3(kx, ky, kz) : new Vector3().setScalar(Math.min(kx, ky, kz));
  o.scale.multiply(k);
  o.position.set(r.x + r.w / 2 - mid.x * k.x, -(r.y + r.h / 2) - mid.y * k.y, z0 - box.min.z * k.z);
  return o;
}

/**
 * Put the model at `url` on `parent`, fitted to `r`, and hide `replace` (the primitives it stands for) once it has loaded. Does nothing if it fails,
 * or if `parent` was thrown away meanwhile (`alive`).
 */
export function useModel(parent: Group, url: string, r: { x: number; y: number; w: number; h: number }, z0: number, z1: number, replace: Object3D[], alive: () => boolean = () => true, stretch = false): void {
  void loadModel(url).then((m) => {
    if (!m || !alive()) return;
    parent.add(fitModel(m.clone(true), r, z0, z1, stretch));
    for (const o of replace) o.visible = false;
  });
}
