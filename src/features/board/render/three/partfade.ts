// A part that leaves the machine, or comes to it, fades (Build my PC, buildmode3d.ts): it goes see-through over the last stretch of its way out
// instead of popping out of sight, and comes in from see-through (`solidAt` in buildmotion.ts says how solid, when). The machine shares
// materials between its parts (a stick's fade must not fade the other sticks), so the part's meshes get their own copies for the fade, and get
// their own materials back when it ends. A copy keeps its shader patches (`onBeforeCompile`), as the light bake's copies do (lightmapmix.ts).
// The see-through variant of each program links ahead (`startPrograms` with `fades`, in the stage's frame), so a fade holds no frame.
import type { Material, Object3D } from 'three';

type Drawn = Object3D & { material?: Material | Material[] };

export class PartFade {
  private readonly meshes: { o: Drawn; was: Material | Material[] }[] = [];
  private readonly copies: { m: Material; opacity: number; transparent: boolean; depthWrite: boolean }[] = [];
  private ended = false;

  constructor(objs: readonly Object3D[]) {
    const copy = new Map<Material, Material>();
    const own = (m: Material): Material => {
      let c = copy.get(m);
      if (!c) {
        c = m.clone();
        c.onBeforeCompile = m.onBeforeCompile;
        c.customProgramCacheKey = m.customProgramCacheKey;
        copy.set(m, c);
        // (the fade's start: a material another fade left half-way is not one this sees; `fadeTree` keeps the true start in `userData.base`)
        const base = m.userData.base as { opacity: number; transparent: boolean; depthWrite: boolean } | undefined;
        this.copies.push({ m: c, opacity: base?.opacity ?? m.opacity, transparent: base?.transparent ?? m.transparent, depthWrite: base?.depthWrite ?? m.depthWrite });
      }
      return c;
    };
    for (const root of objs) root.traverse((x) => {
      const o = x as Drawn, was = o.material;
      if (!was) return;
      this.meshes.push({ o, was });
      o.material = Array.isArray(was) ? was.map(own) : own(was);
    });
  }

  /** How solid the part is drawn: 1 as it was, 0 not at all. A solid part keeps writing depth, so it reads as one body fading, not as its insides. */
  set(a: number): void {
    if (this.ended) return;
    for (const c of this.copies) {
      const tr = c.transparent || a < 0.999;
      if (c.m.transparent !== tr) { c.m.transparent = tr; c.m.needsUpdate = true; }
      c.m.opacity = c.opacity * Math.max(0, Math.min(1, a));
      c.m.depthWrite = c.depthWrite;
    }
  }

  /** The meshes get their own materials back and the copies go (once). Hide a part that faded out before this: it would show solid again. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const x of this.meshes) x.o.material = x.was;
    for (const c of this.copies) c.m.dispose();
  }

  /** The meshes under the fade. */
  get size(): number { return this.meshes.length; }
}
