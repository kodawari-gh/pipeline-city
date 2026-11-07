// The 2D art a set of 3D parts wears: the bakers, the faces that wear them and the queue that bakes their tiles. The live machine keeps one
// (machine3d.ts, its queue run by the board's view); a part shown on its own (the gallery's turntable, core/render/three/viewer.ts) keeps its
// own, which the viewer runs with `frame` before each render and drops with `dispose` (`attach` hands both to it on the part's root).
import { Frustum, Group, Vector3, type Material, type Object3D, type PerspectiveCamera } from 'three';
import type { Container } from 'pixi.js';
import { ArtSurface, BakeQueue, FINISH, frustumOf, screenPx, type Bake, type Finish } from '@/core/render/three/artlod';
import { rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { ArtBaker, startBaker } from './bake';
import type { Raise } from './parts3d';

/** The texture densities (pixels per unit) of the board's own face and of a part raised off it, rising. */
export const LV_BOARD = [0.2, 0.8, 2.4, 7], LV_RAISED = [0.6, 2.4, 7];
/**
 * The same for a part's face and for the dies (their names are 9 to 14 units high). The finest is for the closest view (`LIMITS.heightMin`:
 * about 10 screen pixels per unit), where the silkscreen and the die names stay sharp.
 */
export const LV_PART = [0.4, 1.4, 3, 8], LV_DIE = [0.5, 1.6, 4.5, 10];

const AT = new Vector3();

export class ArtSet {
  private readonly bakers: ArtBaker[] = [];
  private readonly surfaces: ArtSurface[] = [];
  private readonly reveals: { at: Object3D; apply: (zoom: number) => void }[] = [];
  private readonly frustum = new Frustum();

  /** `q`: the queue that bakes the tiles (the live machine's, run by its view); none: its own, run by `frame`. */
  constructor(private readonly q = new BakeQueue()) { startBaker(); }

  /** One piece of 2D art, built now (with the layout as it is now). */
  baker(build: () => Container): ArtBaker {
    const b = new ArtBaker(build);
    this.bakers.push(b);
    return b;
  }

  /** A flat face at depth `z` over `r` that wears the art of `bake`. */
  surface(parent: Object3D, bake: Bake, r: RectLike, z: number, levels: readonly number[], finish: Finish = FINISH.board): ArtSurface {
    const s = new ArtSurface(r, z, bake, this.q, { levels, finish });
    this.surfaces.push(s);
    parent.add(s.root);
    return s;
  }

  /** A box whose top wears the art of its own rect: the flat drawing stood up into a part; `bevel` rounds its edges. */
  raised(parent: Object3D, b: ArtBaker, r: RectLike, z0: number, z1: number, side: Material, levels: readonly number[] = LV_RAISED, bevel = 0): Group {
    const g = new Group();
    g.add(bevel > 0 ? softBox(r, z0, z1, side, bevel) : rectBox(r, z0, z1, side));
    this.surface(g, b.bake, r, z1, levels);
    parent.add(g);
    return g;
  }

  /** The `Raise` of a part's builder (parts3d.ts): its raised boxes wear `b` on top. */
  raise(b: ArtBaker): Raise {
    return (parent, r, z0, z1, side, bevel = 0) => this.raised(parent, b, r, z0, z1, side, LV_RAISED, bevel);
  }

  /** On its own (`frame`): run `apply` every frame with the zoom seen at `at` (screen pixels per unit), as the machine's reveals do (a lid fades). */
  reveal(at: Object3D, apply: (zoom: number) => void): void { this.reveals.push({ at, apply }); }

  /** Each face asks for the tiles the camera needs (`H`: the view's height in device pixels). */
  update(cam: PerspectiveCamera, frustum: Frustum, H: number, dpr: number, now: number): void {
    for (const s of this.surfaces) s.update(cam, frustum, H, dpr, now);
  }

  /** Hand the set to the viewer on the part's root. */
  attach(o: Object3D): void { o.userData.frame = this.frame; o.userData.dispose = this.dispose; }

  /** Per frame, on its own: the reveals, then the faces' tiles; the queue bakes a few. */
  readonly frame = (cam: PerspectiveCamera, H: number): void => {
    const now = performance.now();
    for (const r of this.reveals) r.apply(screenPx(cam.position.distanceTo(r.at.getWorldPosition(AT)), cam.fov, H));
    frustumOf(cam, this.frustum);
    this.update(cam, this.frustum, H, 1, now);
    this.q.run(8);
  };

  readonly dispose = (): void => {
    for (const s of this.surfaces) s.dispose();
    for (const b of this.bakers) b.dispose();
  };
}
