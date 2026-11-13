// The distance LOD of a built model (the machine, PERF6): far away its small parts draw as a few merged stand-ins (`standIns`, merge.ts)
// in place of hundreds of meshes. A stand-in holds the same triangles with the same materials, so the picture, the shadows and the state
// looks stay as they are: only the draw count falls. The parts stay in the tree on a layer no camera draws (`UNDRAWN`), so a ray, `findById`
// and the outline find them as before. No WebGL here: the rule (which meshes, the size classes, the switch) is tested without a renderer.
// docs/render/lod.md "The machine's stand-ins".
import { Matrix4, type InstancedMesh, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { standInKey, standIns } from './merge';
import { UNDRAWN } from './pick';

/** The size classes: the greatest world radius of each (a screw, a plug, a chip, a small bracket). A greater mesh has no stand-in. */
export const LOD_RADII = [25, 50, 100, 200] as const;
/** A class draws as stand-ins while its greatest radius is under this many pixels on the screen. */
export const LOD_PX = 8;
/** The dead band: a class goes back to its parts only over `LOD_PX * (1 + LOD_BAND)`, so a zoom that wobbles at the limit switches nothing. */
export const LOD_BAND = 0.25;

/** The size class of a mesh of this world radius (an index of `LOD_RADII`), or -1: too large for a stand-in. */
export const sizeClass = (radius: number): number => LOD_RADII.findIndex((r) => radius <= r);

/**
 * Which classes draw as stand-ins at `zoom` (screen pixels per world unit at the model), given which did (`was`): on under the class's
 * limit, off over the limit plus the dead band, as it was between the two. `ceil`: a zoom from which no class is ever far (a view the
 * player works in, Build my PC's own); the limits and their dead bands stay under it.
 */
export function farClasses(zoom: number, was: readonly boolean[] = [], ceil = Infinity, px = LOD_PX): boolean[] {
  return LOD_RADII.map((r, i) => { const at = Math.min(px / r, ceil / (1 + LOD_BAND)); return zoom < at ? true : zoom >= ceil || zoom > at * (1 + LOD_BAND) ? false : !!was[i]; });
}

/**
 * Which classes are culled (not drawn at all, parts and stand-in) at `zoom`: under `cullPx` on the screen, with the same dead band as
 * `farClasses`. `cullPx` 0 (the default, today's) culls nothing.
 */
export function culledClasses(zoom: number, was: readonly boolean[] = [], cullPx = 0): boolean[] {
  return LOD_RADII.map((r, i) => { if (cullPx <= 0) return false; const at = cullPx / r; return zoom < at ? true : zoom > at * (1 + LOD_BAND) ? false : !!was[i]; });
}

/** Is `o` held in full detail: it, or an object above it, is one of `holds` (a part the player points at, selects or drags, a part a step moves). */
export function heldBy(o: Object3D, holds: ReadonlySet<Object3D>): boolean {
  if (holds.size) for (let p: Object3D | null = o; p; p = p.parent) if (holds.has(p)) return true;
  return false;
}

/**
 * The hold rule: a stand-in draws only while its class is far and none of the meshes it draws for is held (`heldBy`). One held mesh sends
 * the whole stand-in back to its parts, so a held part is never half merged.
 */
export const standInDraws = (far: boolean, sources: readonly Object3D[], holds: ReadonlySet<Object3D>): boolean => far && !sources.some((s) => heldBy(s, holds));

const COPY = new Matrix4();

/** The world radius of a mesh: its geometry's sphere at its scale; for an instanced mesh, the radius of its largest copy. World matrices set. */
export function worldRadius(m: Mesh): number {
  if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
  const im = m as Partial<InstancedMesh> & Mesh;
  let copy = 1;
  if (im.isInstancedMesh) { copy = 0; for (let i = 0; i < im.count!; i++) { im.getMatrixAt!(i, COPY); copy = Math.max(copy, COPY.getMaxScaleOnAxis()); } }
  return m.geometry.boundingSphere!.radius * m.matrixWorld.getMaxScaleOnAxis() * copy;
}

export interface LodScope {
  /**
   * Subtrees that are shown, hidden, faded or moved as a whole after the build (a lid, a cooler, a group shown by zoom, a group built again
   * alone). The stand-ins of what is inside one are its children: they follow it, and a fade reaches their materials (`fadeTree`).
   */
  anchors?: readonly Object3D[];
  /** Subtrees left out: their meshes move one by one, or are built again alone. An anchor inside one is in again. */
  skip?: readonly Object3D[];
}

/** A mesh that goes in a stand-in: its anchor (the nearest above it, else the root) and its size class. */
export interface Source { mesh: Mesh; anchor: Object3D; cls: number }

/**
 * The meshes under `root` that go in stand-ins. In: a shown mesh of a size class that can join a set (`standInKey`). Out: what is hidden now,
 * under `skip`, a moving subtree (`userData.spin`, `live`, `rig`: a rotor, a held cable, a cable's draggable end), an anchor that is a mesh
 * itself, and a stand-in.
 */
export function lodSources(root: Object3D, o: LodScope = {}): Source[] {
  root.updateWorldMatrix(true, true);
  const anchors = new Set(o.anchors ?? []), skip = new Set(o.skip ?? []), out: Source[] = [];
  const walk = (x: Object3D, anchor: Object3D, off: boolean): void => {
    const u = x.userData;
    if (!x.visible || u.spin || u.live || u.rig || u.standIn) return;
    const own = x !== root && anchors.has(x), a = own ? x : anchor, left = own ? false : off || skip.has(x), m = x as Mesh;
    if (!left && !own && x !== root && m.isMesh) {
      const cls = sizeClass(worldRadius(m));
      if (cls >= 0 && standInKey(m) !== null) out.push({ mesh: m, anchor: a, cls });
    }
    for (const c of x.children) walk(c, a, left);
  };
  walk(root, root, false);
  return out;
}

/** How many meshes under `root` a camera on layer 0 draws: shown, with a shown material, on that layer. */
export function drawnMeshes(root: Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    const m = o as Mesh;
    if (m.isMesh && (m.layers.mask & 1) && [m.material].flat().some((x) => x.visible)) n++;
  });
  return n;
}

/** One stand-in as built: its mesh under its anchor, the meshes it draws for, their class and the layers they draw on. */
interface Built { mesh: Mesh; sources: Mesh[]; anchor: Object3D; cls: number; mask: number; held: boolean }

/**
 * The stand-ins of one model and their switch. `build` makes them (all, or one anchor's again); `update` takes the zoom and swaps each
 * class between its parts and its stand-ins. A swap changes only layers: a part goes to `UNDRAWN` and its stand-in to the part's layers, or
 * back. Both stay `visible`, so the shadow scan (`ShadowCache`) sees no change, and the maps hold (the depth is the same).
 */
export class PartLod {
  private built: Built[] = [];
  /** By anchor: what was shown over each source when its stand-in was made. One of them hidden since: the anchor is built again. */
  private guards = new Map<Object3D, Object3D[]>();
  /** By anchor: the palette materials made for its stand-ins, kept over a rebuild (their programs stay linked). */
  private pals = new Map<Object3D, Map<string, MeshStandardMaterial>>();
  private far: boolean[] = LOD_RADII.map(() => false);
  /** The classes culled now (`culledClasses`): not drawn at all, far or not (`swap`). */
  private cull: boolean[] = LOD_RADII.map(() => false);
  /** The limits the switch uses (`setBudget`): the stand-ins' screen size, and the size under which a class is culled. */
  private px = LOD_PX;
  private cullPx = 0;
  /** What stays in full detail (`hold`), and the zoom from which all does. */
  private holds: ReadonlySet<Object3D> = new Set();
  private ceil = Infinity;

  /** `scope`: the anchors and the left-out subtrees as they are now (asked on each build). */
  constructor(private readonly root: Object3D, private readonly scope: () => LodScope = () => ({})) { this.build(); }

  /** The stand-in meshes (of all the classes; `far` says which draw). */
  get standIns(): readonly Mesh[] { return this.built.map((b) => b.mesh); }
  /** Which classes draw as stand-ins now. */
  get farNow(): readonly boolean[] { return this.far; }
  /** The limits the switch uses now: the stand-ins' screen size in pixels, and the size under which a class is culled (0: none). */
  get budget(): { px: number; cullPx: number } { return { px: this.px, cullPx: this.cullPx }; }
  /** Set the limits (`px`, `cullPx`); the next `update` takes them. The default is `LOD_PX` and no cull. */
  setBudget(b: { px: number; cullPx: number }): void { this.px = b.px; this.cullPx = b.cullPx; }
  /** The meshes a stand-in draws for, or none. */
  sourcesOf(standIn: Object3D): readonly Mesh[] { return this.built.find((b) => b.mesh === standIn)?.sources ?? []; }
  /** Does this stand-in draw now (its parts do not)? */
  draws(standIn: Object3D): boolean { const b = this.built.find((x) => x.mesh === standIn); return !!b && this.far[b.cls]! && !b.held && !this.cull[b.cls]!; }

  /**
   * Hold these objects in full detail, each with all under it (`standInDraws`), and all of the model from the zoom `ceil` in (`farClasses`).
   * The same holds as before: no work. The ceiling takes effect at the next `update`.
   */
  hold(objects: readonly Object3D[], ceil = Infinity): void {
    this.ceil = ceil;
    if (objects.length === this.holds.size && objects.every((o) => this.holds.has(o))) return;
    this.holds = new Set(objects);
    for (const b of this.built) {
      const held = !standInDraws(true, b.sources, this.holds);
      if (held !== b.held) { b.held = held; this.swap(b); }
    }
  }

  /** Make the stand-ins again as the model stands: all, or those of one anchor (`only`: its content changed). The old ones are freed. */
  build(only?: Object3D): void {
    this.drop(only);
    const by = new Map<Object3D, Mesh[][]>();
    for (const s of lodSources(this.root, this.scope())) {
      if (only && s.anchor !== only) continue;
      let sets = by.get(s.anchor);
      if (!sets) by.set(s.anchor, (sets = LOD_RADII.map(() => [])));
      sets[s.cls]!.push(s.mesh);
    }
    for (const [anchor, sets] of by) {
      let pals = this.pals.get(anchor);
      if (!pals) this.pals.set(anchor, (pals = new Map()));
      const guards = new Set<Object3D>();
      sets.forEach((meshes, cls) => {
        for (const { mesh, sources } of standIns(anchor, meshes, pals)) {
          const b: Built = { mesh, sources, anchor, cls, mask: mesh.layers.mask, held: !standInDraws(true, sources, this.holds) };
          for (const s of sources) for (let p: Object3D | null = s; p && p !== anchor; p = p.parent) guards.add(p);
          this.built.push(b);
          this.swap(b);
        }
      });
      if (guards.size) this.guards.set(anchor, [...guards]);
    }
  }

  /** Take the stand-ins away (all, or one anchor's) and free their geometry: the parts draw again. Call it before an anchor's content is disposed. */
  drop(only?: Object3D): void {
    this.built = this.built.filter((b) => {
      if (only && b.anchor !== only) return true;
      this.swap(b, false);
      b.mesh.removeFromParent();
      b.mesh.userData.standIn = false;
      b.mesh.geometry.dispose();
      return false;
    });
    if (only) this.guards.delete(only); else this.guards.clear();
  }

  /**
   * The switch, after the camera moved: `zoom` is the screen pixels per world unit at the model. A class that crossed its limit swaps (with
   * the dead band, `farClasses`). While any class is far, an anchor with a part hidden since its build is built again without it (the part
   * draws itself when it shows again). No class crossed and nothing hidden: a few compares and one read per guard, no other work.
   */
  update(zoom: number): void {
    const far = farClasses(zoom, this.far, this.ceil, this.px), was = this.far;
    const cull = culledClasses(zoom, this.cull, this.cullPx), wasCull = this.cull;
    this.far = far;
    this.cull = cull;
    if (far.some(Boolean)) {
      const stale = [...this.guards].filter(([, nodes]) => nodes.some((o) => !o.visible)).map(([anchor]) => anchor);
      for (const anchor of stale) this.build(anchor);
    }
    far.forEach((f, cls) => { if (f !== was[cls] || cull[cls] !== wasCull[cls]) for (const b of this.built) if (b.cls === cls) this.swap(b); });
  }

  /**
   * Put a stand-in and its parts on the layers of the side that draws (`far`: default as the class and the holds say). A culled class's
   * stand-in goes too; its parts go with the rest of the far side (they are undrawn while it is far).
   */
  private swap(b: Built, far = this.far[b.cls]! && !b.held): void {
    const gone = far && this.cull[b.cls]!;
    b.mesh.layers.mask = far && !gone ? b.mask : 1 << UNDRAWN;
    for (const s of b.sources) s.layers.mask = far ? 1 << UNDRAWN : b.mask;
  }

  /** Free the stand-ins and the palette materials made for them. */
  dispose(): void {
    this.drop();
    for (const pals of this.pals.values()) for (const m of pals.values()) m.dispose();
    this.pals.clear();
  }
}
