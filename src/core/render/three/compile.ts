// The shader programs, linked without holding the page (docs/render/load.md). On ANGLE D3D11 a lit program of the room takes about a second
// to link; drawn before it is linked, it holds the frame, and the page, until it is. `startPrograms` starts the programs a scene needs, and the
// driver links them on its own threads (KHR_parallel_shader_compile); the page draws on (the boot screen, the last picture) and asks
// `linked` each frame, or `whenLinked` waits. Without the extension every program is ready at once and links at its first draw, as before.
import { HalfFloatType, Mesh, OrthographicCamera, PlaneGeometry, WebGLRenderTarget, type Camera, type Material, type Object3D, type Scene, type WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** A program as three keeps it: `isReady` asks the driver whether its link has ended, without waiting. */
export interface Program { isReady(): boolean }

/**
 * Starts linking the programs `root` draws with, lit by `scene`'s lights (default `root`), and returns them. `root` is the scene, or an object
 * about to join it: then it must not be in the scene yet, or its lights count twice. The hidden parts count too (the die under its lid), and
 * the see-through variant of each opaque material under `fades` (`fadeTree` makes it transparent: another program). The programs are made for
 * a render target (linear, not tone mapped), as the frame draws into the scene's own (`post.ts`). Set the lights as they will be drawn first: a light shown
 * or hidden, or one that casts a shadow or stops, makes every lit program again.
 */
export function startPrograms(r: WebGLRenderer, root: Object3D, cam: Camera, { scene = root as Scene, fades = [] }: { scene?: Scene; fades?: readonly Object3D[] } = {}): Program[] {
  const flip = new Set<Material>();
  for (const f of fades) f.traverse((x) => {
    const m = (x as Mesh).material as Material | Material[] | undefined;
    if (m) for (const mm of Array.isArray(m) ? m : [m]) if (!mm.transparent) flip.add(mm);
  });
  const was = r.getRenderTarget(), rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType }), out = new Set<Program>();
  // (each variant a material has made: a see-through double-sided one makes two, its back and its front)
  const take = (mats: Set<Material>) => {
    for (const m of mats) {
      const p = r.properties.get(m) as { currentProgram?: Program; programs?: Map<string, Program> };
      for (const q of p.programs?.values() ?? []) out.add(q);
      if (p.currentProgram) out.add(p.currentProgram);
    }
  };
  r.setRenderTarget(rt);
  try {
    take(r.compile(root, cam, scene));
    if (flip.size) {
      for (const m of flip) { m.transparent = true; m.needsUpdate = true; }
      take(r.compile(root, cam, scene));
    }
    return [...out];
  } finally {
    for (const m of flip) { m.transparent = false; m.needsUpdate = true; }
    r.setRenderTarget(was);
    rt.dispose();
  }
}

/**
 * Starts linking the programs of passes that draw a quad (`Pass`): each material a pass holds, or its quad (`FullScreenQuad`), or an array of
 * its own holds (the bloom's blurs). Their defines must stand as they will be drawn (a pass that sets them as it draws is left out).
 */
export function startPassPrograms(r: WebGLRenderer, passes: readonly object[]): Program[] {
  const mats = new Set<Material>();
  const add = (v: unknown) => {
    if ((v as Material | null)?.isMaterial) mats.add(v as Material);
    else if (v instanceof FullScreenQuad && v.material) mats.add(v.material);
  };
  for (const p of passes) for (const v of Object.values(p)) if (Array.isArray(v)) v.forEach(add); else add(v);
  // (no normals, as `FullScreenQuad`'s triangle has none: three makes another program for a geometry with them, and that one would be drawn unlinked)
  const quad = new Mesh(new PlaneGeometry(2, 2).deleteAttribute('normal')), cam = new OrthographicCamera(), out: Program[] = [];
  for (const m of mats) { quad.material = m; out.push(...startPrograms(r, quad, cam)); }
  quad.geometry.dispose();
  return out;
}

/** Are they all linked? */
export const linked = (programs: readonly Program[]): boolean => programs.every((p) => p.isReady());

/** Resolves once every program has linked; `onProgress` hears how many have, after each look (every `ms`, the page drawing between). */
export function whenLinked(programs: readonly Program[], onProgress?: (done: number, total: number) => void, ms = 16): Promise<void> {
  return new Promise((done) => {
    const look = () => {
      let n = 0;
      for (const p of programs) if (p.isReady()) n++;
      onProgress?.(n, programs.length);
      if (n === programs.length) done(); else setTimeout(look, ms);
    };
    look();
  });
}
