// glTF models for parts (docs/render/three.md): a part whose key is in `MODEL_FILES` (features/board/render/three/models3d.ts) wears a
// loaded model in place of its primitives. The file loads once and is cloned for each use; until it is there, and when it fails, the primitives stay.
import { Box3, Vector3 } from 'three';
import type * as threeTypes from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ProgramGate } from './compile';
import type * as compileTypes from './compile';
import { sceneChanged } from './ondemand';

// Models may carry meshopt-compressed geometry (`npm run bake:models`).
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<threeTypes.Object3D | null>>();

/** A loader of KTX2 textures, as the model loader takes it (three's `KTX2Loader`). */
export type Ktx2 = Parameters<GLTFLoader['setKTX2Loader']>[0];
/** Where the Basis transcoder is served from (`public/basis/`, a copy of three's: `gltf.test.ts` checks it is the same). */
export const BASIS_PATH = `${import.meta.env.BASE_URL}basis/`;
/** The KTX2 loader on its way (`ktx2Support`): a model load waits for it. */
let ktx2: Promise<void> | null = null;

/**
 * Let the models carry KTX2 (Basis) textures, which stay compressed on the GPU (KTX1). Call it with the renderer before the first model
 * loads: the loader asks it which formats the GPU takes. The loader's code is its own chunk; the transcoder loads with the first KTX2
 * texture, so a game with no KTX2 model pays for one small request. A failure here leaves the plain loader: a KTX2 model then fails to
 * load, and its primitives stay (`loadModel`). The first call wins; `make` is the test's own loader, and replaces it.
 */
export function ktx2Support(renderer: threeTypes.WebGLRenderer | null, make?: () => Promise<Ktx2>): Promise<void> {
  if (ktx2 && !make) {
    return ktx2;
  }
  const made =
    make ??
    (async () => {
      const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
      return new KTX2Loader().setTranscoderPath(BASIS_PATH).detectSupport(renderer!);
    });
  return (ktx2 = made().then(
    (l) => {
      loader.setKTX2Loader(l);
    },
    () => {},
  ));
}

/**
 * The file at a url as its scene. The loader gives a model even when one of its textures failed (that map is then absent): such a model is
 * refused here, so a part never shows half dressed.
 */
async function sceneOf(url: string): Promise<threeTypes.Object3D> {
  await ktx2;
  const g = await loader.loadAsync(url);
  const textures = g.parser.json.textures ? await g.parser.getDependencies('texture') : [];
  if (textures.some((t) => !t)) {
    throw new Error(`a texture of ${url} did not load`);
  }
  return g.scene;
}

/** The loads that have not ended: each ends when the model is there (or has failed), and its users, which came first, have had it. */
const pending = new Set<Promise<unknown>>();

/**
 * The model of a url, loaded once; null when it cannot be loaded (or a texture of it: the primitives stay). With `until` the model is not
 * given before that settles: a build that must not see it (the room's merges and its bake, `Room3D.make`) runs meanwhile.
 */
export function loadModel(url: string, until?: Promise<unknown>): Promise<threeTypes.Object3D | null> {
  let p = cache.get(url);
  if (!p) {
    p = sceneOf(url).catch(() => null);
    cache.set(url, p);
  }
  // (a model that comes in changes a still view: its users add it before the next frame, which then draws, docs/render/load.md)
  const done = (until ? Promise.all([p, until]).then(([m]) => m) : p).then((m) => {
    sceneChanged();
    return m;
  });
  pending.add(done);
  void done.then(() => pending.delete(done));
  return done;
}

/**
 * Resolves once the models asked for so far are in, their users having added them (they ask first, so they hear first), or after `ms`: a model
 * that is slow must not hold the page. A scene whose programs start before its models are in links the models' own at their first draw, each
 * holding the page for its link, 0.4 s for a lit one (docs/render/load.md).
 */
export function modelsIn(ms = 2000): Promise<void> {
  if (pending.size === 0) {
    return Promise.resolve();
  }
  return new Promise((done) => {
    const timer = setTimeout(done, ms);
    void Promise.all([...pending]).then(() => {
      clearTimeout(timer);
      done();
    });
  });
}

/**
 * How a scene starts the programs of a model that joins it late (`joinModel`). It gets the model, set up as it will be drawn, and the parent it
 * stands on, and returns the programs it started (`startPrograms` and `startShadowPrograms`, with the scene's renderer, camera and lights); or
 * null while the scene's own programs have not started: the model then joins at once, and the scene's batch takes it.
 */
export type WarmModel = (model: threeTypes.Object3D, parent: threeTypes.Object3D) => compileTypes.Program[] | null;
/** The scenes that hold their late models, by scene (a scene that goes takes its entry with it). */
const warmers = new WeakMap<threeTypes.Object3D, WarmModel>();

/** A scene's owner says how a model that joins after its programs have started is warmed (`joinModel`). */
export function warmLateModels(scene: threeTypes.Object3D, warm: WarmModel): void {
  warmers.set(scene, warm);
}

/** How often a held model asks the driver whether its programs have linked (ms). */
const LOOK_MS = 16;

/**
 * Puts `model` on `parent`. In a scene whose programs have started (`warmLateModels`) a model that comes in late (a slow network) would link
 * its own at its first draw, 0.4 s for a lit one with the page held (docs/render/load.md). So it joins hidden, its programs start, and it shows
 * once they have linked (`ProgramGate`: and each has had its first use); `shown` runs then, and not before: the primitives it replaces hide in it.
 * `prepare` runs first, once the model is on the parent: what changes its programs (the room's environment) must be done before they start.
 * Anywhere else, or before the scene's programs have started, it joins and shows at once. `alive` false ends the wait (the parent is gone).
 */
export function joinModel(
  parent: threeTypes.Object3D,
  model: threeTypes.Object3D,
  { prepare, shown, alive = () => true }: { prepare?: () => void; shown?: () => void; alive?: () => boolean } = {},
): void {
  parent.add(model);
  prepare?.();
  let top = parent;
  while (top.parent) {
    top = top.parent;
  }
  const programs = warmers.get(top)?.(model, parent) ?? null;
  if (!programs) {
    shown?.();
    return;
  }
  const was = model.visible,
    gate = new ProgramGate(() => programs);
  model.visible = false;
  const look = (): void => {
    if (!alive()) {
      return;
    }
    if (!gate.ready()) {
      setTimeout(look, LOOK_MS);
      return;
    }
    model.visible = was;
    shown?.();
    sceneChanged();
  };
  look();
}

/**
 * Scale `o` to fit the layout rect `r` (x right, y down) and stand it on depth `z0`, no taller than up to `z1`; its middle goes to the rect's middle.
 * Evenly by default; `stretch`: x and y each fill the rect (a part that is only a block, like a heat sink), the height keeps to the smaller of them.
 */
export function fitModel(
  o: threeTypes.Object3D,
  r: { x: number; y: number; w: number; h: number },
  z0: number,
  z1: number,
  stretch = false,
): threeTypes.Object3D {
  const box = new Box3().setFromObject(o),
    size = box.getSize(new Vector3()),
    mid = box.getCenter(new Vector3());
  const kx = r.w / (size.x || 1),
    ky = r.h / (size.y || 1),
    kz = Math.min((z1 - z0) / (size.z || 1), stretch ? Math.min(kx, ky) : Infinity);
  const k = stretch ? new Vector3(kx, ky, kz) : new Vector3().setScalar(Math.min(kx, ky, kz));
  o.scale.multiply(k);
  o.position.set(r.x + r.w / 2 - mid.x * k.x, -(r.y + r.h / 2) - mid.y * k.y, z0 - box.min.z * k.z);
  return o;
}

/**
 * Put the model at `url` on `parent`, fitted to `r`, and hide `replace` (the primitives it stands for) once it has loaded. Does nothing if it fails,
 * or if `parent` was thrown away meanwhile (`alive`).
 */
export function useModel(
  parent: threeTypes.Group,
  url: string,
  r: { x: number; y: number; w: number; h: number },
  z0: number,
  z1: number,
  replace: threeTypes.Object3D[],
  alive: () => boolean = () => true,
  stretch = false,
): void {
  void loadModel(url).then((m) => {
    if (!m || !alive()) {
      return;
    }
    joinModel(parent, fitModel(m.clone(true), r, z0, z1, stretch), {
      shown: () => {
        for (const o of replace) {
          o.visible = false;
        }
      },
      alive,
    });
  });
}
