// The room's baked bounce at run time (`src/features/room/light.md`, "Offline bakes"; T180). `npm run bake` (`tools/bake/`) bakes each light
// group's indirect light (the window's: all of it) into one atlas over the room's still meshes: a lightmap a group, at the group's full power.
// `LightmapMix` sums them by the groups' live levels into one lightmap, only when the light changes (a lamp's switch, a step of the evening, a
// tenth of an hour). The receivers take it as their whole indirect diffuse light (`lightmapped`), in place of the probe's, which stays for
// their reflections and for all that moves. The game finds a receiver by its geometry's hash (`meshHash`): a mesh the bake does not know (the
// room's code changed since the bake) keeps the probe, and the dev build warns.
import {
  AddEquation, BufferAttribute, Color, CustomBlending, HalfFloatType, LinearFilter, Matrix4, Mesh, NearestFilter, NoColorSpace, OneFactor, OrthographicCamera,
  PlaneGeometry, Scene, ShaderChunk, ShaderMaterial, Texture, Vector3, WebGLRenderTarget,
  type BufferGeometry, type Material, type MeshStandardMaterial, type Object3D, type WebGLProgramParametersWithUniforms, type WebGLRenderer,
} from 'three';
import './arealoop';

/** A receiver has at least this much surface (m²): a smaller thing only blocks light (a key, a cup's handle). */
export const MIN_AREA = 0.02;

/** A 32-bit FNV-1a over the positions (in the room's frame, whole units) and the triangles: the same mesh, built again, has the same hash. */
export function meshHash(pos: ArrayLike<number>, index: ArrayLike<number> | null): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 0x01000193); };
  for (let i = 0; i < pos.length; i++) mix(Math.round(pos[i]!));
  if (index) for (let i = 0; i < index.length; i++) mix(index[i]!);
  return `${pos.length / 3}-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** A lit, opaque surface that does not glow: it blocks light and bounces it (a glow's mesh would shut its own lamp in). */
export function solid(m: Material): m is MeshStandardMaterial {
  const s = m as MeshStandardMaterial;
  return !!s.isMeshStandardMaterial && !s.transparent && s.opacity >= 1 && s.emissive.getHex() === 0;
}

/** Does the geometry carry baked vertex occlusion (`vertexao.ts`): a prop or a plant, which keeps it instead of a lightmap. */
export function hasAo(g: BufferGeometry): boolean {
  const a = g.attributes._ao?.array;
  if (a) for (let i = 0; i < a.length; i++) if (a[i]! < 0.999) return true;
  return false;
}

/** Is it drawn: its own flag and all those above it. */
export const shown = (o: Object3D): boolean => { for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };

/** A geometry's positions through `k` (to the room's frame), as the bake's export reads them (Float32, so the hash rounds the same values). */
export function framed(g: BufferGeometry, k: Matrix4): Float32Array {
  const p = g.attributes.position!, out = new Float32Array(3 * p.count), v = new Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(k); out.set([v.x, v.y, v.z], 3 * i); }
  return out;
}

/** The two key frames round `hour` (`hours` rising) and each one's share; outside them, the nearest alone. */
export function keyFrames(hour: number, hours: readonly number[]): [number, number][] {
  const n = hours.length;
  if (!n) return [];
  if (hour <= hours[0]!) return [[hours[0]!, 1]];
  for (let i = 1; i < n; i++) {
    const a = hours[i - 1]!, b = hours[i]!;
    if (hour <= b) { const f = (hour - a) / (b - a); return [[a, 1 - f], [b, f]]; }
  }
  return [[hours[n - 1]!, 1]];
}

/** A light group's lightmap: its file, the scale its RGBM decodes by, a lamp group's baked lead intensity, a sun frame's hour. */
export interface BakeGroup { id: string; kind: 'lamp' | 'sky' | 'city' | 'sun'; file: string; scale: number; lead?: number; hour?: number }
/** A receiver: its hash, its corners (three a triangle, unindexed) and where its UVs start in `meshes.bin` (in corners). */
export interface BakeMesh { name: string; hash: string; corners: number; offset: number }
/** `manifest.json` (`tools/bake/bake.mjs`): the atlas's size, the groups, the sun frames with no light (`dark`), the receivers. */
export interface BakeManifest { version: number; encoding: string; width: number; height: number; texelsPerMetre: number; samples: number; groups: BakeGroup[]; dark: string[]; meshes: BakeMesh[] }
/** A bake as loaded: the manifest, each group's lightmap (RGBM, unflipped: row 0 is the atlas's top), the receivers' UVs (two Uint16 a corner). */
export interface Bake { manifest: BakeManifest; maps: Map<string, Texture>; uvs: Uint16Array }

/** Loads the bake under `base` (a URL ending in `/`). */
export async function loadBake(base: string): Promise<Bake> {
  const get = async (f: string) => { const r = await fetch(base + f); if (!r.ok) throw new Error(`${base}${f}: ${r.status}`); return r; };
  const manifest = (await (await get('manifest.json')).json()) as BakeManifest;
  if (manifest.version !== 1 || manifest.encoding !== 'rgbm-sqrt') throw new Error(`${base}: a bake this game cannot read (${manifest.version}, ${manifest.encoding})`);
  const uvs = get('meshes.bin').then((r) => r.arrayBuffer()).then((b) => new Uint16Array(b));
  const maps = Promise.all(manifest.groups.map(async (g): Promise<[string, Texture]> => {
    // the bytes as they are: the alpha is RGBM's multiplier, not a coverage, and the values are not colours
    const img = await createImageBitmap(await (await get(g.file)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const t = new Texture(img);
    t.flipY = false; t.generateMipmaps = false; t.magFilter = NearestFilter; t.minFilter = NearestFilter; t.colorSpace = NoColorSpace;
    t.needsUpdate = true;
    return [g.id, t];
  }));
  return { manifest, uvs: await uvs, maps: new Map(await maps) };
}

/**
 * A spot light with this decay stands in for a light the bake holds whole, direct and bounced (the room's window: `key` in `room3d.ts`). It
 * lights what moves; a mesh with a light map skips it, as the map has its light already. No other light has this decay.
 */
export const STAND_IN_DECAY = 0.8;

// three's light map chunk with the light map as the irradiance the probe's would be: it lights the diffuse layer and the rough reflections'
// multiple scattering, and the probe's irradiance stays out (a receiver would take the room's bounce twice)
const MAPS = ShaderChunk.lights_fragment_maps
  .replace('irradiance += lightMapIrradiance;', 'iblIrradiance += lightMapIrradiance;')
  .replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '#ifndef USE_LIGHTMAP\n\t\t\tiblIrradiance += getIBLIrradiance( geometryNormal );\n\t\t\t#endif');
// and its direct lights without the stand-in
const SPOT_INFO = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';
const BEGIN = ShaderChunk.lights_fragment_begin.replace(SPOT_INFO,
  `${SPOT_INFO}\n\t\t#ifdef USE_LIGHTMAP\n\t\tif ( abs( spotLight.decay - ${STAND_IN_DECAY.toFixed(3)} ) < 0.001 ) directLight.color = vec3( 0.0 );\n\t\t#endif`);

/**
 * Patches `m` to take its light map as its whole indirect diffuse light, in place of its environment's (which still gives its reflections),
 * and to skip the stand-in light (`STAND_IN_DECAY`). Without a light map it draws as before. Keeps an `onBeforeCompile` it already has; a
 * material patched before stays as it is.
 */
export function lightmapped(m: Material): void {
  if (m.userData.lightmapped) return;
  m.userData.lightmapped = true;
  const prev = m.onBeforeCompile.bind(m), key = `${m.customProgramCacheKey()}|lm`;
  m.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r: WebGLRenderer) => {
    prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', MAPS).replace('#include <lights_fragment_begin>', BEGIN);
  };
  m.customProgramCacheKey = () => key;
}

/** What `applyLightmap` did: the meshes it lit; the names of those that look like receivers but have no bake; the bake's meshes it found no mesh for. */
export interface Lit { meshes: Mesh[]; missing: string[]; stale: number }
export interface LitOptions {
  /** Units a metre (the receivers' least surface, `MIN_AREA`). */
  metre: number;
  /** Meshes to leave out (the blinds: they move). */
  skip?: (o: Object3D) => boolean;
  /** Hears of each material copied for the receivers (one they shared with a mesh the bake does not light): the copy keeps the source's patches. */
  twin?: (src: Material, copy: Material) => void;
}

/**
 * Gives each mesh under `root` the bake knows (by its hash in `root`'s frame) its lightmap UVs (`uv1`, unindexed, as the bake cut them) and
 * `map` as its light map. A geometry another mesh shares is copied first, and so is a material a mesh the bake does not light shares.
 */
export function applyLightmap(root: Object3D, bake: Bake, map: Texture, o: LitOptions): Lit {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert(), byHash = new Map(bake.manifest.meshes.map((e) => [e.hash, e]));
  const all: Mesh[] = [];
  root.traverse((x) => { if ((x as Mesh).isMesh) all.push(x as Mesh); });
  const uses = new Map<unknown, number>(), use = (k: unknown, d = 1) => { const n = (uses.get(k) ?? 0) + d; uses.set(k, n); return n; };
  for (const m of all) { use(m.geometry); for (const x of [m.material].flat()) use(x); }
  const lit: [Mesh, BakeMesh, string][] = [], missing: string[] = [], found = new Set<string>(), k = new Matrix4();
  for (const m of all) {
    const x = m as Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
    if (x.isInstancedMesh || x.isSkinnedMesh || Array.isArray(m.material) || !solid(m.material) || o.skip?.(m)) continue;
    const g = m.geometry, corners = g.index ? g.index.count : g.attributes.position!.count;
    // (a mesh lit before keeps the hash of its geometry as the bake saw it: its own is unindexed now)
    let hash = m.userData.bakeHash as string | undefined, pos: Float32Array | null = null;
    if (!hash) { pos = framed(g, k.multiplyMatrices(toRoot, m.matrixWorld)); hash = meshHash(pos, g.index?.array ?? null); }
    const e = byHash.get(hash);
    if (e && e.corners === corners) { lit.push([m, e, hash]); found.add(hash); continue; }
    if (hasAo(g) || !shown(m)) continue;
    pos ??= framed(g, k.multiplyMatrices(toRoot, m.matrixWorld));
    if (area(pos, g.index?.array ?? null) >= MIN_AREA * o.metre * o.metre) missing.push(`${m.name || 'mesh'} ${hash}`);
  }
  const litUses = new Map<Material, number>(), mats = new Map<Material, Material>();
  for (const [m] of lit) litUses.set(m.material as Material, (litUses.get(m.material as Material) ?? 0) + 1);
  for (const [m, e, hash] of lit) {
    const old = m.geometry, g = old.index ? old.toNonIndexed() : uses.get(old)! > 1 ? old.clone() : old;
    if (g !== old) { m.geometry = g; if (use(old, -1) === 0) old.dispose(); }
    g.setAttribute('uv1', new BufferAttribute(bake.uvs.subarray(2 * e.offset, 2 * (e.offset + e.corners)), 2, true));
    m.userData.bakeHash = hash;
    const src = m.material as MeshStandardMaterial;
    let mat = mats.get(src);
    if (!mat) {
      mat = src;
      if (litUses.get(src)! < uses.get(src)!) {
        const c = src.clone();
        c.onBeforeCompile = src.onBeforeCompile;
        c.customProgramCacheKey = src.customProgramCacheKey;
        o.twin?.(src, c);
        mat = c;
      }
      (mat as MeshStandardMaterial).lightMap = map;
      lightmapped(mat);
      mat.needsUpdate = true;
      mats.set(src, mat);
    }
    m.material = mat;
  }
  return { meshes: lit.map(([m]) => m), missing, stale: bake.manifest.meshes.filter((e) => !found.has(e.hash)).length };
}

/** The surface of the triangles (units²). */
function area(pos: Float32Array, index: ArrayLike<number> | null): number {
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = index ? index.length : pos.length / 3, at = (t: number) => 3 * (index ? index[t]! : t);
  let s = 0;
  for (let t = 0; t + 2 < n; t += 3) {
    a.fromArray(pos, at(t)); b.fromArray(pos, at(t + 1)).sub(a); c.fromArray(pos, at(t + 2)).sub(a);
    s += b.cross(c).length() / 2;
  }
  return s;
}

const MIX_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// one group's lightmap decoded (RGBM over the square root: scale times the square of rgb times a; `k` holds the scale and the level), added
// texel for texel: the target is the atlas's size, and the maps' row 0 is the atlas's top
const MIX_FRAG = /* glsl */`
uniform sampler2D map;
uniform vec3 k;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(map, vec2(vUv.x, 1.0 - vUv.y));
  vec3 e = t.rgb * t.a;
  gl_FragColor = vec4(k * e * e, 1.0);
}`;

/** The groups' lightmaps summed by their live levels into one, the receivers' light map (`texture`, on their `uv1`). */
export class LightmapMix {
  readonly texture: Texture;
  private rt: WebGLRenderTarget;
  private scene = new Scene();
  private cam = new OrthographicCamera();
  private mat: ShaderMaterial;
  private quad: Mesh;

  constructor(private readonly bake: Bake) {
    const { width, height } = bake.manifest;
    this.rt = new WebGLRenderTarget(width, height, { type: HalfFloatType, depthBuffer: false, magFilter: LinearFilter, minFilter: LinearFilter, generateMipmaps: false });
    this.texture = this.rt.texture;
    this.texture.channel = 1;
    this.mat = new ShaderMaterial({
      uniforms: { map: { value: null }, k: { value: new Vector3() } }, vertexShader: MIX_VERT, fragmentShader: MIX_FRAG,
      blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor, depthTest: false, depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /**
   * Sums the groups into `texture`, each by its level (a colour, or one number for all three): a lamp group's level is its lead light's live
   * intensity (taken over the baked one, `lead`), any other's its multiplier. A group with no level adds nothing.
   */
  mix(renderer: WebGLRenderer, levels: ReadonlyMap<string, number | Color>): void {
    const was = renderer.getRenderTarget(), clear = renderer.getClearColor(new Color()), alpha = renderer.getClearAlpha(), auto = renderer.autoClear;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    renderer.autoClear = false;
    const k = this.mat.uniforms.k!.value as Vector3;
    for (const g of this.bake.manifest.groups) {
      const l = levels.get(g.id), map = this.bake.maps.get(g.id);
      if (l === undefined || !map) continue;
      const s = g.scale / (g.kind === 'lamp' ? g.lead || 1 : 1);
      if (typeof l === 'number') k.setScalar(l * s); else k.set(l.r * s, l.g * s, l.b * s);
      if (Math.max(k.x, k.y, k.z) <= 0) continue;
      this.mat.uniforms.map!.value = map;
      renderer.render(this.scene, this.cam);
    }
    renderer.autoClear = auto;
    renderer.setClearColor(clear, alpha);
    renderer.setRenderTarget(was);
  }

  /** Frees the target and the quad (the bake's maps are the page's: a room built again shares them). */
  dispose(): void { this.rt.dispose(); this.mat.dispose(); this.quad.geometry.dispose(); }
}
