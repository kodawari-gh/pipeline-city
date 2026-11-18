// The shader programs, linked without holding the page (docs/render/load.md). On ANGLE D3D11 a lit program of the room takes about a second
// to link; drawn before it is linked, it holds the frame, and the page, until it is. `startPrograms` starts the programs a scene needs, and the
// driver links them on its own threads (KHR_parallel_shader_compile); the page draws on (the boot screen, the last picture) and asks
// `linked` each frame, or `whenLinked` waits. Without the extension every program is ready at once and links at its first draw, as before.
import { HalfFloatType, Mesh, OrthographicCamera, PlaneGeometry, WebGLRenderTarget, type Camera, type Material, type Object3D, type Scene, type WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** A program as three keeps it: `isReady` asks the driver whether its link has ended, without waiting; `getUniforms` is its first use (`prime`). */
export interface Program { isReady(): boolean; getUniforms?(): unknown }

/**
 * Starts linking the programs `root` draws with, lit by `scene`'s lights (default `root`), and returns them. `root` is the scene, or an object
 * about to join it: then it must not be in the scene yet, or its lights count twice. The hidden parts count too (the die under its lid), and
 * the see-through variant of each opaque material under `fades` (`fadeTree` makes it transparent: another program). The programs are made for
 * a render target (linear, not tone mapped), as the frame draws into the scene's own (`post.ts`); `toCanvas`: for a frame that draws to the canvas
 * itself, with the renderer's tone mapping and colour space (the showcase viewer): the key of a program holds both, so the other kind is never used.
 * Set the lights as they will be drawn first: a light shown or hidden, or one that casts a shadow or stops, makes every lit program again.
 */
export function startPrograms(r: WebGLRenderer, root: Object3D, cam: Camera, { scene = root as Scene, fades = [], toCanvas = false }: { scene?: Scene; fades?: readonly Object3D[]; toCanvas?: boolean } = {}): Program[] {
  const flip = new Set<Material>();
  for (const f of fades) f.traverse((x) => {
    const m = (x as Mesh).material as Material | Material[] | undefined;
    if (m) for (const mm of Array.isArray(m) ? m : [m]) if (!mm.transparent) flip.add(mm);
  });
  const was = r.getRenderTarget(), rt = toCanvas ? null : new WebGLRenderTarget(1, 1, { type: HalfFloatType }), out = new Set<Program>();
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
    rt?.dispose();
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

/**
 * Has its link ended, or is the program gone? Three sets a destroyed program's `program` to undefined (its material was disposed while it
 * linked: a machine built again, a Lambert of Low dropped). The driver never calls such a program ready, so a wait on it would not end.
 */
const gone = (p: Program): boolean => 'program' in p && (p as { program?: unknown }).program === undefined;
export const programDone = (p: Program): boolean => gone(p) || p.isReady();

/** Are they all linked (or gone)? */
export const linked = (programs: readonly Program[]): boolean => programs.every(programDone);

/**
 * Makes the first use of linked programs now, for as long as `ms`, and takes them off `left`. Returns whether none is left. A program's first
 * use (`getUniforms`: three asks the driver for the link's log and the program's uniforms) waits for the driver to finish all the commands sent
 * before it. At the first draw those are the uploads of the whole scene: the 66 programs of a machine cost 0.4 s that way, with the page held.
 * With the queue empty each takes a fraction of a millisecond. Only for programs that have linked (`linked`): the first use of one that has not
 * waits for its link.
 */
export function prime(left: Program[], ms: number): boolean {
  const end = performance.now() + ms;
  while (left.length && performance.now() < end) {
    const p = left.pop()!;
    if (!gone(p)) p.getUniforms?.();
  }
  return !left.length;
}

/** The longest a first picture waits for its programs to link; then it draws, and the driver finishes the link in that draw. */
export const LINK_MAX_MS = 15000;
/** The time a tick spends on the first use of linked programs (`prime`): the page stays alive between the ticks. */
export const PRIME_MS = 4;

/**
 * The wait for a scene's programs before it is drawn (docs/render/load.md). Call `ready` in each tick that would draw, and draw when it says so.
 * The first call starts the programs (`start`: `startPrograms` and what else the draw needs). Each call after asks the driver, without waiting.
 * Once they have linked, `PRIME_MS` of each tick makes their first use (`prime`), while no upload is queued: at the draw it would wait for the
 * whole scene's uploads. After `LINK_MAX_MS` the draw goes on and links what is left. `reset` when the scene's materials change (a new part)
 * or its context came back (the old programs are gone): the next call starts again.
 */
export class ProgramGate {
  private linking: Program[] | null = null;
  private priming: Program[] | null = null;
  private from = 0;

  constructor(private readonly start: () => Program[]) {}

  ready(now = performance.now()): boolean {
    if (!this.linking) { this.from = now; this.linking = this.start(); }
    if (!linked(this.linking)) return now - this.from > LINK_MAX_MS;
    this.priming ??= [...this.linking];
    return prime(this.priming, PRIME_MS);
  }

  reset(): void { this.linking = this.priming = null; }
}

/** The programs the materials under `root` have made so far (none is made here). */
export function programsOf(r: WebGLRenderer, root: Object3D): Program[] {
  const out = new Set<Program>();
  root.traverse((x) => {
    const m = (x as Mesh).material as Material | Material[] | undefined;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) {
      if (!r.properties.has(mm)) continue;
      for (const q of (r.properties.get(mm) as { programs?: Map<string, Program> }).programs?.values() ?? []) out.add(q);
    }
  });
  return [...out];
}

/**
 * Calls `free` (which disposes the materials under `root`) once the programs they made have linked: now if they have. The browser asks the
 * driver about a program that still links, and a program deleted meanwhile logs `GL_INVALID_VALUE: glGetProgramiv` for each such ask (a preset
 * change that builds the room again, with a program of the old room not yet linked).
 */
export function freeWhenLinked(r: WebGLRenderer, root: Object3D, free: () => void, ms = 100): void {
  const programs = programsOf(r, root);
  const look = () => { if (linked(programs)) free(); else setTimeout(look, ms); };
  look();
}

/** Resolves once every program has linked; `onProgress` hears how many have, after each look (every `ms`, the page drawing between). */
export function whenLinked(programs: readonly Program[], onProgress?: (done: number, total: number) => void, ms = 16): Promise<void> {
  return new Promise((done) => {
    const look = () => {
      let n = 0;
      for (const p of programs) if (programDone(p)) n++;
      onProgress?.(n, programs.length);
      if (n === programs.length) done(); else setTimeout(look, ms);
    };
    look();
  });
}
