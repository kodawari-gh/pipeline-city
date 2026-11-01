// Level of detail for the 2D art in the 3D world (docs/GRAPHICS_3D_OVERHAUL.md "Art and LOD"). The 2D renderer's drawings (the board, the CPU
// die, a card's floorplan) are not redrawn: a flat surface wears them as a texture, baked at a few densities. Level 0 is one small texture;
// each higher level splits the surface into tiles of at most `TILE_PX` and bakes only the tiles in view, when the camera comes close enough to
// need them. A shared queue bakes a few per frame, the most wanted first. `fadeTree` fades a lid or a shroud away to show what is under it.
// The baking itself is the caller's (`Bake`): this file knows only three.
import { Box3, CanvasTexture, Frustum, Group, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, Vector3, type Material, type Object3D, type PerspectiveCamera, type Texture } from 'three';
import { anisotropy } from './geometry';

export interface Rect { x: number; y: number; w: number; h: number }

/** Draw the art inside `frame` (layout units) at `px` texture pixels per unit. Null while the baker is not ready (the job is tried again). */
export type Bake = (frame: Rect, px: number) => HTMLCanvasElement | null;

/** The widest tile, in texture pixels. */
export const TILE_PX = 2048;

/** The tiles a rect splits into at `px` texture pixels per unit, none wider or taller than `tile` pixels. */
export function tilesOf(r: Rect, px: number, tile = TILE_PX): Rect[] {
  const nx = Math.max(1, Math.ceil((r.w * px) / tile)), ny = Math.max(1, Math.ceil((r.h * px) / tile));
  const out: Rect[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push({ x: r.x + (i * r.w) / nx, y: r.y + (j * r.h) / ny, w: r.w / nx, h: r.h / ny });
  return out;
}

/** Screen pixels per layout unit at distance `d` (a perspective camera, vertical fov in degrees, viewport `H` pixels high): the 2D renderer's zoom. */
export const screenPx = (d: number, fov: number, H: number): number => H / (2 * Math.max(1, d) * Math.tan((fov * Math.PI) / 360));

/** The level to show for a screen that needs `need` pixels per unit: the first dense enough (a little under is fine), else the top one. */
export function levelFor(levels: readonly number[], need: number): number {
  for (let i = 0; i < levels.length; i++) if (levels[i]! >= need * 0.8) return i;
  return levels.length - 1;
}

/** How long a surface keeps a level it no longer needs, so a wheel wobble never re-bakes (ms). */
const KEEP_MS = 2500;

interface Job { key: string; pri: number; run: () => boolean }

/** The bake jobs of every surface: `run` does the most wanted ones within a time budget each frame. */
export class BakeQueue {
  private jobs: Job[] = [];
  private dirty = false;

  add(key: string, pri: number, run: () => boolean): void {
    const j = this.jobs.find((x) => x.key === key);
    if (j) { if (pri < j.pri) { j.pri = pri; this.dirty = true; } return; }
    this.jobs.push({ key, pri, run });
    this.dirty = true;
  }

  /** Forget the jobs whose key starts with `prefix` (a surface that was taken down). */
  drop(prefix: string): void { this.jobs = this.jobs.filter((j) => !j.key.startsWith(prefix)); }

  get size(): number { return this.jobs.length; }

  run(budgetMs = 6): void {
    if (!this.jobs.length) return;
    if (this.dirty) { this.jobs.sort((a, b) => a.pri - b.pri); this.dirty = false; }
    const t0 = performance.now();
    while (this.jobs.length && performance.now() - t0 < budgetMs) {
      const j = this.jobs[0]!;
      let done = true;
      try { done = j.run(); } catch { done = true; }
      if (!done) return; // the baker is not ready yet: try again next frame
      this.jobs.shift();
    }
  }
}

/** Fade a group (a cooler, a lid, a shroud) to `a`; at 0 it is hidden, so it neither draws nor stops a ray. */
export function fadeTree(o: Object3D, a: number): void {
  const on = a > 0.01;
  o.visible = on;
  if (!on) return;
  o.traverse((x) => {
    const m = (x as Mesh).material as Material | Material[] | undefined;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) {
      const base = (mm.userData.base ??= { opacity: mm.opacity, transparent: mm.transparent, depthWrite: mm.depthWrite }) as { opacity: number; transparent: boolean; depthWrite: boolean };
      const clear = a < 0.999, tr = base.transparent || clear;
      if (mm.transparent !== tr) { mm.transparent = tr; mm.needsUpdate = true; }
      mm.opacity = base.opacity * a;
      mm.depthWrite = clear ? false : base.depthWrite;
    }
  });
}

/** Is `o` drawn (it and every parent visible)? */
export function shown(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export interface SurfaceOpts {
  /** Texture pixels per layout unit of each level, rising. */
  levels: readonly number[];
  finish?: Finish;
}

/**
 * How a sheet of art is finished (`artMaterial`). The material maps come from the art's own colours, per pixel in the shader, so every level and
 * tile gets them for free: warm colours (the gold pins, the copper, the plated pads) turn to metal, pale grey ink (silkscreen, names) is matte, the
 * rest has the solder mask's gloss, and the brightness is a height (traces, pads and ink stand off the mask and catch the light at their edges).
 */
export interface Finish {
  /** Roughness of the plain surface (the mask). */
  gloss: number;
  /** How far warm colours turn to metal (0 to 1). */
  metal: number;
  /** Bump strength of the brightness as a height. */
  bump: number;
  /** How much the art lights itself, so a dark board still reads inside a dim case (metal never glows). */
  glow: number;
  /** Strength of the metal's reflections. */
  shine: number;
  /** How much the lights' diffuse falls on it (1: fully; less keeps a self-lit drawing near its own colours under the case's lamps). */
  lit: number;
}

export const FINISH = {
  /** A board or a card: glossy mask, gold and copper, raised traces. */
  board: { gloss: 0.3, metal: 1, bump: 2.2, glow: 0.05, shine: 1.5, lit: 1 },
  /** A card: its board with the die drawn on it, between the two. */
  card: { gloss: 0.36, metal: 0.7, bump: 1.6, glow: 0.1, shine: 1.4, lit: 1 },
  /** A die: the floorplan's own colours (the 2D die view's dark field and its neon), lit only a little; the bond pads and wires shine. */
  die: { gloss: 0.42, metal: 0.4, bump: 1.2, glow: 0.4, shine: 1.2, lit: 0.4 },
} satisfies Record<string, Finish>;

let artEnv: Texture | null = null;
/** The environment the art reflects (the scene's): set once, before the first surface bakes. */
export function setArtEnvironment(t: Texture | null): void { artEnv = t; }

/** The finish's shader helpers: the colour tests read an sRGB-ish value (hue, saturation, brightness the way the art was drawn); the height is the brightness. */
const ART_GLSL = /* glsl */`
uniform float artGloss;
uniform float artMetal;
uniform float artShine;
uniform float artLit;
float artMetalK = 0.0;
vec3 artSrgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }
float artHeight(vec4 t) { return dot(artSrgb(t.rgb), vec3(0.299, 0.587, 0.114)) * step(0.4, t.a); }
`;

/** The material of a sheet of art: `map` is the art, the finish comes from its colours (see `Finish`). */
export function artMaterial(map: Texture, f: Finish, level = 0): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    map, bumpMap: map, bumpScale: f.bump, roughness: 1, metalness: 0, alphaTest: 0.4,
    emissive: f.glow ? 0xffffff : 0x000000, emissiveMap: f.glow ? map : null, emissiveIntensity: f.glow,
    envMap: artEnv, envMapIntensity: 1,
    // each level sits a hair above the one under it
    polygonOffset: true, polygonOffsetFactor: -1 - level, polygonOffsetUnits: -2 - 2 * level,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.artGloss = { value: f.gloss };
    sh.uniforms.artMetal = { value: f.metal };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <bumpmap_pars_fragment>', `${ART_GLSL}\n#include <bumpmap_pars_fragment>`)
      // the height is the brightness, not the red channel
      .replace(/texture2D\( bumpMap, ([^)]+) \)\.x/g, 'artHeight( texture2D( bumpMap, $1 ) )')
      // far out a screen pixel covers many texels: the relief fades out there (it would only shimmer), and is whole from one texel per pixel in
      .replace('return vec2( dBx, dBy );', 'float tpp = length( dSTdx * vec2( textureSize( bumpMap, 0 ) ) ) + 1e-4;\n\t\treturn vec2( dBx, dBy ) * clamp( 1.5 / tpp - 0.5, 0.0, 1.0 );')
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      {
        vec3 s = artSrgb(diffuseColor.rgb);
        float mx = max(s.r, max(s.g, s.b)), mn = min(s.r, min(s.g, s.b)), sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
        // gold, copper, amber: red over blue, green close behind red (magenta and red are not metal), and bright enough
        float warm = smoothstep(0.02, 0.12, s.r - s.b) * (1.0 - smoothstep(0.25, 0.45, s.r - s.g)) * smoothstep(0.12, 0.3, mx);
        artMetalK = warm * artMetal;
        float ink = (1.0 - smoothstep(0.1, 0.35, sat)) * smoothstep(0.3, 0.6, mx);
        metalnessFactor = artMetalK;
        roughnessFactor = mix(mix(artGloss, 0.62, ink), 0.38, artMetalK);
      }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 1.0 - artMetalK;')
      // the environment lifts the mask little (it stays dark and glossy) and the metal a lot (gold and copper read as metal, not paint)
      // (capped under the bloom's threshold: a field of gold pins seen face-on would glow like a lamp)
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\niblIrradiance *= 0.45;\nradiance = min( radiance * mix(0.25, artShine, artMetalK), vec3( 0.8 ) );')
      // a lamp's highlight would wash the whole mask grey when it faces the camera: the mask keeps a faint sheen, the metal its glint
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular *= mix(0.3, 0.45, artMetalK);\nreflectedLight.directDiffuse *= artLit;\nreflectedLight.indirectDiffuse *= artLit;');
    sh.uniforms.artShine = { value: f.shine };
    sh.uniforms.artLit = { value: f.lit };
  };
  m.customProgramCacheKey = () => 'art-finish';
  return m;
}

/** When a tile was last in view (ms). */
interface Tile { rect: Rect; mesh: Mesh | null; queued: boolean; box: Box3; seen: number }

let nextId = 0;

/**
 * A flat rect at depth `z` that wears the art baked by `bake`. It asks for level 0 once it is drawn, and for the tiles of a higher level when the
 * camera needs them; the lower levels stay underneath as the fallback while the tiles bake. Levels above the one needed go after `KEEP_MS`.
 */
export class ArtSurface {
  readonly root = new Group();
  private readonly key = `art${nextId++}:`;
  private tiles: Tile[][];
  private want = 0;
  private lowSince = 0;
  private opacity = 1;
  private readonly box: Box3;

  constructor(readonly rect: Rect, readonly z: number, private bake: Bake, private q: BakeQueue, private o: SurfaceOpts) {
    this.box = new Box3(new Vector3(rect.x, -(rect.y + rect.h), z), new Vector3(rect.x + rect.w, -rect.y, z));
    this.tiles = o.levels.map((px) => tilesOf(rect, px).map((r) => ({ rect: r, mesh: null, queued: false, box: new Box3(new Vector3(r.x, -(r.y + r.h), z), new Vector3(r.x + r.w, -r.y, z)), seen: 0 })));
  }

  private request(level: number, k: number, pri: number) {
    const t = this.tiles[level]![k]!;
    if (t.mesh || t.queued) return;
    t.queued = true;
    this.q.add(`${this.key}${level}:${k}`, pri, () => {
      const cv = this.bake(t.rect, this.o.levels[level]!);
      if (!cv) return false;
      t.queued = false;
      t.mesh = this.mesh(t.rect, cv, level);
      this.root.add(t.mesh);
      return true;
    });
  }

  private mesh(r: Rect, cv: HTMLCanvasElement, level: number): Mesh {
    const tex = new CanvasTexture(cv);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = anisotropy;
    const mesh = new Mesh(new PlaneGeometry(r.w, r.h), artMaterial(tex, this.o.finish ?? FINISH.board, level));
    mesh.position.set(r.x + r.w / 2, -(r.y + r.h / 2), this.z + 0.5);
    mesh.receiveShadow = true;
    if (this.opacity < 1) fadeTree(mesh, this.opacity);
    return mesh;
  }

  /**
   * Per frame: the level the camera needs here (from the nearest point of the rect), and the tiles of it that are in view. The rect is where the
   * surface's parents put it (a part moved or turned in 3D carries its 2D art along).
   */
  update(cam: PerspectiveCamera, frustum: Frustum, H: number, dpr: number, now: number): void {
    if (!shown(this.root)) return;
    this.root.updateWorldMatrix(true, false);
    const m = this.root.matrixWorld, box = AT_BOX.copy(this.box).applyMatrix4(m), tile = (t: Tile) => AT_TILE.copy(t.box).applyMatrix4(m);
    if (!frustum.intersectsBox(box)) return;
    const d = box.distanceToPoint(cam.position);
    let want = levelFor(this.o.levels, screenPx(d, cam.fov, H) * dpr);
    if (want < this.want) {
      if (!this.lowSince) this.lowSince = now;
      if (now - this.lowSince < KEEP_MS) want = this.want;
    } else this.lowSince = 0;
    this.want = want;
    this.request(0, 0, -1e9 + d);
    if (want > 0) this.tiles[want]!.forEach((t, k) => { if (frustum.intersectsBox(tile(t))) this.request(want, k, want * 1e6 + AT_TILE.distanceToPoint(cam.position)); });
    for (let l = want + 1; l < this.tiles.length; l++) this.free(l);
    // a pan at a fine level leaves tiles behind: each goes once it has been out of view for a while (level 0 stays: it is the fallback)
    for (let l = 1; l <= want; l++) for (const t of this.tiles[l]!) {
      if (frustum.intersectsBox(tile(t))) t.seen = now;
      else if (t.mesh && now - t.seen > KEEP_MS) this.dropTile(t);
    }
  }

  private dropTile(t: Tile) {
    if (!t.mesh) return;
    this.root.remove(t.mesh);
    disposeMesh(t.mesh);
    t.mesh = null;
  }

  private free(level: number) {
    this.q.drop(`${this.key}${level}:`);
    for (const t of this.tiles[level]!) {
      t.queued = false;
      this.dropTile(t);
    }
  }

  setOpacity(a: number): void {
    this.opacity = a;
    fadeTree(this.root, a);
  }

  dispose(): void {
    this.q.drop(this.key);
    for (let l = 0; l < this.tiles.length; l++) this.free(l);
  }
}

/** The surface's and a tile's box where its parents put them (`update`). */
const AT_BOX = new Box3(), AT_TILE = new Box3();

function disposeMesh(m: Mesh) {
  m.geometry.dispose();
  const mm = m.material as MeshStandardMaterial;
  mm.map?.dispose();
  mm.dispose();
}

/** The camera's frustum, for `ArtSurface.update`. */
export function frustumOf(cam: PerspectiveCamera, out = new Frustum()): Frustum {
  cam.updateMatrixWorld();
  return out.setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
}
