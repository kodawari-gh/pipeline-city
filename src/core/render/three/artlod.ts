// Level of detail for the 2D art in the 3D world (docs/GRAPHICS_3D_OVERHAUL.md "Art and LOD"). The 2D renderer's drawings (the board, the CPU
// die, a card's floorplan) are not redrawn: a flat surface wears them as a texture, baked at a few densities. Level 0 is one small texture;
// each higher level splits the surface into tiles of at most `TILE_PX` and bakes only the tiles in view, when the camera comes close enough to
// need them. A shared queue bakes a few per frame, the most wanted first. `fadeTree` fades a lid or a shroud away to show what is under it.
// The baking itself is the caller's (`Bake`): this file knows only three.
import { Box3, CanvasTexture, Frustum, Group, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, Vector3, type Material, type Object3D, type PerspectiveCamera } from 'three';

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
  roughness?: number;
  metalness?: number;
  /** How much the art lights itself, so a dark board still reads inside a dim case. */
  glow?: number;
}

interface Tile { rect: Rect; mesh: Mesh | null; queued: boolean; box: Box3 }

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
    this.tiles = o.levels.map((px) => tilesOf(rect, px).map((r) => ({ rect: r, mesh: null, queued: false, box: new Box3(new Vector3(r.x, -(r.y + r.h), z), new Vector3(r.x + r.w, -r.y, z)) })));
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
    tex.anisotropy = 8;
    const glow = this.o.glow ?? 0;
    const m = new MeshStandardMaterial({
      map: tex, roughness: this.o.roughness ?? 0.6, metalness: this.o.metalness ?? 0.05, alphaTest: 0.4,
      emissive: glow ? 0xffffff : 0x000000, emissiveMap: glow ? tex : null, emissiveIntensity: glow,
      // each level sits a hair above the one under it
      polygonOffset: true, polygonOffsetFactor: -1 - level, polygonOffsetUnits: -2 - 2 * level,
    });
    const mesh = new Mesh(new PlaneGeometry(r.w, r.h), m);
    mesh.position.set(r.x + r.w / 2, -(r.y + r.h / 2), this.z + 0.5);
    mesh.receiveShadow = true;
    if (this.opacity < 1) fadeTree(mesh, this.opacity);
    return mesh;
  }

  /** Per frame: the level the camera needs here (from the nearest point of the rect), and the tiles of it that are in view. */
  update(cam: PerspectiveCamera, frustum: Frustum, H: number, dpr: number, now: number): void {
    if (!shown(this.root) || !frustum.intersectsBox(this.box)) return;
    const d = this.box.distanceToPoint(cam.position);
    let want = levelFor(this.o.levels, screenPx(d, cam.fov, H) * dpr);
    if (want < this.want) {
      if (!this.lowSince) this.lowSince = now;
      if (now - this.lowSince < KEEP_MS) want = this.want;
    } else this.lowSince = 0;
    this.want = want;
    this.request(0, 0, -1e9 + d);
    if (want > 0) this.tiles[want]!.forEach((t, k) => { if (frustum.intersectsBox(t.box)) this.request(want, k, want * 1e6 + t.box.distanceToPoint(cam.position)); });
    for (let l = want + 1; l < this.tiles.length; l++) this.free(l);
  }

  private free(level: number) {
    this.q.drop(`${this.key}${level}:`);
    for (const t of this.tiles[level]!) {
      t.queued = false;
      if (!t.mesh) continue;
      this.root.remove(t.mesh);
      disposeMesh(t.mesh);
      t.mesh = null;
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
