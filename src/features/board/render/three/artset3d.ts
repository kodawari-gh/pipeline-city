// The 2D art a part wears when it is shown on its own (the gallery's turntable, core/render/three/viewer.ts): the bakers, the faces that wear
// them and the queue that bakes their tiles, kept as the live board keeps them (machine3d.ts). The viewer runs `frame` before each render and
// `dispose` when the part goes (`attach` hands both to it on the part's root).
import { Frustum, Group, type Material, type Object3D, type PerspectiveCamera } from 'three';
import type { Container } from 'pixi.js';
import { ArtSurface, BakeQueue, FINISH, frustumOf, type Bake, type Finish } from '@/core/render/three/artlod';
import { rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { ArtBaker, startBaker } from './bake';

/** The texture densities (pixels per unit) of the board's own face and of a part raised off it, rising. */
export const LV_BOARD = [0.2, 0.8, 2.4, 7], LV_RAISED = [0.6, 2.4, 7];

export class ArtSet {
  private readonly q = new BakeQueue();
  private readonly bakers: ArtBaker[] = [];
  private readonly surfaces: ArtSurface[] = [];
  private readonly frustum = new Frustum();

  constructor() { startBaker(); }

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

  /** Hand the set to the viewer on the part's root. */
  attach(o: Object3D): void { o.userData.frame = this.frame; o.userData.dispose = this.dispose; }

  /** Per frame: each face asks for the tiles the camera needs (`H`: the view's height in device pixels), the queue bakes a few. */
  readonly frame = (cam: PerspectiveCamera, H: number): void => {
    const now = performance.now();
    frustumOf(cam, this.frustum);
    for (const s of this.surfaces) s.update(cam, this.frustum, H, 1, now);
    this.q.run(8);
  };

  readonly dispose = (): void => {
    for (const s of this.surfaces) s.dispose();
    for (const b of this.bakers) b.dispose();
  };
}
