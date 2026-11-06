// The room's reflections on its materials (`room3d.ts`): the studio's environment at first, dimmed at night, then the room's probe. One register,
// so a material that comes after the room is built (a model that loads late: the mouse, the hoodie) takes the same map, the same strength for the
// hour and the same box projection as the rest. Before it, the mouse kept the studio's map at full strength and shone at night. A mesh with the
// baked bounce (`lightmapmix.ts`) takes only the reflections from it: its light map is its indirect diffuse light.
import type { Material, Mesh, MeshStandardMaterial, Object3D, Texture } from 'three';
import { boxProjected, type BoxEnv } from '@/core/render/three/boxenv';

export class RoomEnv {
  /** The materials that take the room's environment. */
  readonly mats = new Set<MeshStandardMaterial>();
  private map: Texture | null;
  private k = 1;

  constructor(private readonly studio: Texture | null, private readonly box: BoxEnv) {
    this.map = studio;
  }

  /**
   * Takes every standard material under `root` with no environment of its own: none, or a copy of the room's (a material cloned from one of the
   * room's keeps its map, but not its box projection or its strength).
   */
  adopt(root: Object3D): void {
    root.traverse((o) => {
      const m = (o as Mesh).material;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) {
        const s = x as MeshStandardMaterial;
        if (!s.isMeshStandardMaterial || this.mats.has(s)) continue;
        if (s.envMap && s.envMap !== this.studio && s.envMap !== this.map) continue;
        s.envMap = this.map;
        s.envMapIntensity = this.k;
        boxProjected(s, this.box);
        this.mats.add(s);
      }
    });
  }

  /**
   * A copy of one of its materials (the baked bounce copies one for the meshes it lights, `applyLightmap`): it has the source's patches
   * already, so it joins as it is and takes the room's map and strength with the rest.
   */
  twin(src: Material, copy: Material): void {
    if (!this.mats.has(src as MeshStandardMaterial)) return;
    const c = copy as MeshStandardMaterial;
    c.envMap = this.map;
    c.envMapIntensity = this.k;
    this.mats.add(c);
  }

  /** The room's probe in place of the studio's map. */
  setMap(t: Texture): void {
    this.map = t;
    for (const m of this.mats) m.envMap = t;
  }

  /** The reflections' strength: the hour's on the studio's map, the probe's own once it holds the room. */
  setStrength(k: number): void {
    if (k === this.k) return;
    this.k = k;
    for (const m of this.mats) m.envMapIntensity = k;
  }
}
