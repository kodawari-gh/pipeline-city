// Baked textures (docs/render/three.md "Textures"): the painted maps that never change, stored as KTX2 in `public/tex/` by
// `npm run bake:tex` (tools/bake/textures.mjs). They stay compressed on the GPU: a quarter to an eighth of the RGBA8 size. The boot loads the
// set before the first build (`loadBaked`); a painter asks for its key (`bakedTex`) and paints its canvas only when the key is not there
// (no file, a load that failed, a test with no DOM, `?nobaked`). So the canvas painters stay the source: the bake runs them.
import type { Texture, WebGLRenderer } from 'three';
import { anisotropy } from './geometry';
import { BASIS_PATH } from './gltf';

/** Where the set is served from. */
export const BAKED_URL = `${import.meta.env.BASE_URL}tex/`;
/** `manifest.json`: the keys of the set; `<key>.ktx2` is the file of each. */
export interface BakedManifest { keys: string[] }

const BAKED = new Map<string, Texture>();
let loading: Promise<void> | null = null;

/** The baked texture of a key, or null: the caller then paints its canvas. The texture is shared, so clone it for an own repeat. */
export function bakedTex(key: string): Texture | null {
  const t = BAKED.get(key) ?? null;
  if (t) t.anisotropy = anisotropy;
  return t;
}

/** The keys that are loaded (the debug overlay and the tests). */
export const bakedKeys = (): string[] => [...BAKED.keys()];

/** A KTX2 loader for this renderer's GPU (the formats it can take). The caller disposes it when its files are in: that ends its transcoder threads. */
export async function ktx2Loader(renderer: WebGLRenderer) {
  const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
  return new KTX2Loader().setTranscoderPath(BASIS_PATH).detectSupport(renderer);
}

/**
 * Load the set, once a page. It never fails: a key that did not load is absent, and its painter paints. Call it with the first renderer,
 * and wait for it before the first build. `?nobaked` skips it (the painted look, to compare).
 */
export function loadBaked(renderer: WebGLRenderer): Promise<void> {
  return (loading ??= (async () => {
    if (new URLSearchParams(location.search).has('nobaked')) return;
    const res = await fetch(`${BAKED_URL}manifest.json`);
    if (!res.ok) return;
    const { keys } = (await res.json()) as BakedManifest;
    const l = await ktx2Loader(renderer);
    await Promise.all(keys.map((k) => l.loadAsync(`${BAKED_URL}${k}.ktx2`).then((t) => { t.name = `baked:${k}`; BAKED.set(k, t); }, () => {})));
    l.dispose();
  })().catch(() => {}));
}
