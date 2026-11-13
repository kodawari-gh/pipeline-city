import { ACESFilmicToneMapping, BoxGeometry, Color, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, RenderTarget, SRGBColorSpace, Scene, ShaderMaterial, Texture, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BASE_EXPOSURE } from './init';
import { HIGH_C, MID } from './localeye';

vi.mock('@/app/graphics', () => ({ pixelRatio: (scale: number) => scale }));
const { Post, isDirect, meterMean, steps } = await import('./post');

/** The full-screen passes of a step list: all but the eye's small ones. */
const full = (s: string[]) => s.filter((x) => x !== 'eye').length;
const LOW = { ao: 0, bloom: 0, msaa: 0, scale: 0.6, brightness: 1 };
const HIGH = { ao: 2, bloom: 2, msaa: 4, scale: 1, brightness: 1 };
/** Medium: no AO, the bloom on, multisampling 2. */
const MEDIUM = { ao: 0, bloom: 1, msaa: 2, scale: 0.75, brightness: 1 };

function stubRenderer(): WebGLRenderer {
  let ratio = 1;
  return {
    toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace, toneMappingExposure: 1,
    getPixelRatio: () => ratio, setPixelRatio: (r: number) => { ratio = r; }, setSize: () => {},
  } as unknown as WebGLRenderer;
}

/** A renderer that logs each `render` with the target it draws into (null: the screen). */
function recorder() {
  const log: { target: unknown; scene: unknown }[] = [];
  let target: unknown = null, alpha = 0;
  const r = {
    ...stubRenderer(),
    getRenderTarget: () => target, setRenderTarget: (t: unknown) => { target = t; },
    render: (scene: unknown) => { log.push({ target, scene }); },
    getClearColor: (c: Color) => c, setClearColor: () => {},
    getClearAlpha: () => alpha, setClearAlpha: (a: number) => { alpha = a; }, clear: () => {},
  } as unknown as WebGLRenderer;
  return { r, log };
}

describe('the post chain', () => {
  it('runs only what is on: without the direct draw, the scene, the eye and the finish', () => {
    expect(steps({ ao: false, outline: false, bloom: false, eye: true, direct: false })).toEqual(['scene', 'eye', 'finish']);
    expect(full(steps({ ao: false, outline: false, bloom: false, eye: true, direct: false }))).toBeLessThanOrEqual(3);
    // the board view: no eye, the finish only tone maps
    expect(steps({ ao: false, outline: false, bloom: false, eye: false, direct: false })).toEqual(['scene', 'finish']);
  });

  it('copies the picture for the outline or the bloom, and the AO copies it as it blends', () => {
    expect(steps({ ao: false, outline: true, bloom: false, eye: true, direct: false })).toEqual(['scene', 'copy', 'outline', 'eye', 'finish']);
    expect(steps({ ao: false, outline: false, bloom: true, eye: true, direct: false })).toEqual(['scene', 'copy', 'bloom', 'eye', 'finish']);
    expect(steps({ ao: true, outline: true, bloom: true, eye: true, direct: false })).toEqual(['scene', 'ao', 'outline', 'bloom', 'eye', 'finish']);
  });

  it('direct: nothing picked is one step, the scene drawn to the screen; with the outline, the chain without the eye', () => {
    expect(steps({ ao: false, outline: false, bloom: false, eye: false, direct: true })).toEqual(['direct']);
    expect(steps({ ao: false, outline: true, bloom: false, eye: false, direct: true })).toEqual(['scene', 'copy', 'outline', 'finish']);
  });

  it('direct is Low and its variants only: no AO, no bloom, no multisampling', () => {
    expect(isDirect(LOW)).toBe(true);
    expect(isDirect(HIGH)).toBe(false);
    expect(isDirect(MEDIUM)).toBe(false);
    expect(isDirect({ ...LOW, ao: 1 })).toBe(false);
  });

  it('follows the settings, the pick and the view', () => {
    const r = stubRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300, { direct: true });
    post.apply(LOW, r, 400, 300);
    expect(r.getPixelRatio()).toBe(0.6);
    post.setReach(40000);
    expect(post.steps()).toEqual(['direct']);
    const pick = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    post.setOutlined([pick]);
    expect(post.steps()).toEqual(['scene', 'copy', 'outline', 'finish']);
    // the first frame after the pick ends drops the outline
    post.setOutlined([]);
    expect(post.steps()).toEqual(['direct']);
    // the board view: the chain, with no eye (its strength is the room view's)
    post.setReach(0);
    expect(post.steps()).toEqual(['scene', 'finish']);
    post.setReach(40000);
    expect(post.steps()).toEqual(['direct']);
    post.setReach(40000);
    post.apply(HIGH, r, 400, 300);
    expect(post.steps()).toEqual(['scene', 'ao', 'bloom', 'eye', 'finish']);
  });

  it('direct at Low: draws the scene straight to the screen, and the finish never runs', () => {
    const { r, log } = recorder();
    const scene = new Scene();
    const post = new Post(r, scene, new PerspectiveCamera(), 400, 300, { direct: true });
    post.apply(LOW, r, 400, 300);
    post.setReach(40000);
    expect(post.direct).toBe(true);
    expect(post.steps()).toEqual(['direct']);
    const finish = vi.spyOn(post['local'], 'draw');
    post.render();
    expect(finish).not.toHaveBeenCalled();
    expect(log.length).toBe(1);
    expect(log[0]!.target).toBeNull();
    expect(log[0]!.scene).toBe(scene);
  });

  it('a direct frame at the room view has its grade and its eye off, so a picked frame looks like an unpicked one', () => {
    const r = stubRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300, { direct: true });
    post.apply(LOW, r, 400, 300);
    post.setReach(40000);
    expect(post['look'].uniforms.k!.value).toBe(0);
    expect(post['local'].strength).toBe(0);
    post.setOutlined([new Mesh(new BoxGeometry(), new MeshBasicMaterial())]);
    expect(post.steps()).toEqual(['scene', 'copy', 'outline', 'finish']);
    // the same room view on the chain: the grade and the eye on
    const high = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300);
    high.apply(HIGH, r, 400, 300);
    high.setReach(40000);
    expect(high['look'].uniforms.k!.value).toBe(1);
    expect(high['local'].strength).toBe(1);
  });

  it('without the option, Low keeps the chain: the eye and the finish, no screen draw, the meter reads, no lift', () => {
    const { r, log } = recorder();
    const scene = new Scene();
    const post = new Post(r, scene, new PerspectiveCamera(), 400, 300);
    post.apply(LOW, r, 400, 300);
    expect(post.direct).toBe(false);
    expect(post.steps()).toEqual(['scene', 'eye', 'finish']);
    post.render();
    expect(log.some((x) => x.scene === scene && x.target === null)).toBe(false);
    expect(log.some((x) => x.scene === scene && x.target !== null)).toBe(true);
    // no lift at the room view
    post.setReach(40000);
    post.setEye(0.8, MID, HIGH_C, 1.5);
    expect(r.toneMappingExposure).toBeCloseTo(BASE_EXPOSURE * 0.8, 9);
  });

  it('not direct at High or Medium: the scene goes to its own target, never to the screen', () => {
    for (const g of [HIGH, MEDIUM]) {
      const { r, log } = recorder();
      const scene = new Scene();
      const post = new Post(r, scene, new PerspectiveCamera(), 400, 300);
      post.apply(g, r, 400, 300);
      expect(post.direct).toBe(false);
      post.render();
      expect(log.some((x) => x.scene === scene && x.target === null)).toBe(false);
      expect(log.some((x) => x.scene === scene && x.target !== null)).toBe(true);
    }
    const r = stubRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300);
    post.apply(MEDIUM, r, 400, 300);
    post.setReach(40000);
    expect(post.steps()).toEqual(['scene', 'copy', 'bloom', 'eye', 'finish']);
  });

  it('the eye lifts the exposure at the room view at Low only, by the lift the board gives it', () => {
    const r = stubRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300, { direct: true });
    post.apply(LOW, r, 400, 300);
    post.setReach(40000);
    post.setEye(0.8, MID, HIGH_C, 1.5);
    expect(r.toneMappingExposure).toBeCloseTo(BASE_EXPOSURE * 1 * 0.8 * 1.5, 9);
    // the board view: no lift
    post.setReach(0);
    post.setEye(0.8, MID, HIGH_C, 1.5);
    expect(r.toneMappingExposure).toBeCloseTo(BASE_EXPOSURE * 0.8, 9);
  });

  it('High gives no lift at the room view', () => {
    const r = stubRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300);
    post.apply(HIGH, r, 400, 300);
    post.setReach(40000);
    post.setEye(0.8, MID, HIGH_C, 1.5);
    expect(r.toneMappingExposure).toBeCloseTo(BASE_EXPOSURE * 0.8, 9);
  });

  it('frees every target, texture and material of its own at a close (PERF12), not the scene', () => {
    const r = stubRenderer(), scene = new Scene(), box = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    scene.add(box);
    const post = new Post(r, scene, new PerspectiveCamera(), 400, 300);
    // every target, texture and shader the chain holds, a few fields deep (the passes keep theirs in fields and arrays)
    const owned = new Set<RenderTarget | Texture | ShaderMaterial>(), seen = new Set<unknown>();
    const walk = (x: unknown, depth: number): void => {
      if (!x || typeof x !== 'object' || seen.has(x) || depth > 3 || x === r || x instanceof Object3D) return;
      seen.add(x);
      if (x instanceof RenderTarget || x instanceof Texture || x instanceof ShaderMaterial) owned.add(x);
      if (x instanceof RenderTarget) return;
      for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v, depth + 1);
    };
    walk(post, 0);
    expect([...owned].filter((x) => x instanceof RenderTarget).length).toBeGreaterThanOrEqual(8);
    const freed = new Set<unknown>();
    for (const x of owned) x.addEventListener('dispose', () => freed.add(x));
    let sceneFreed = false;
    box.geometry.addEventListener('dispose', () => { sceneFreed = true; });
    post.dispose();
    expect([...owned].filter((x) => !freed.has(x)).map((x) => x.constructor.name)).toEqual([]);
    expect(sceneFreed).toBe(false);
  });
});

describe('the light meter', () => {
  it('reads a flat grid as its luminance, and weights the middle', () => {
    const flat = new Float32Array(16 * 9 * 4).fill(Math.log(0.25));
    expect(meterMean(flat, 16, 9)).toBeCloseTo(0.25, 6);
    // a bright middle counts for more than a bright corner
    const mid = flat.slice(), corner = flat.slice();
    mid[4 * (8 + 16 * 4)] = Math.log(8);
    corner[0] = Math.log(8);
    expect(meterMean(mid, 16, 9)).toBeGreaterThan(meterMean(corner, 16, 9));
    expect(meterMean(corner, 16, 9)).toBeGreaterThan(0.25);
  });

  /** A renderer whose pixel reads end when the test says so. */
  function meterRenderer() {
    const reads: { buf: Float32Array; done: () => void; fail: () => void }[] = [];
    const r = {
      ...stubRenderer(), extensions: { has: () => true }, getRenderTarget: () => null, setRenderTarget: () => {}, render: () => {},
      readRenderTargetPixels: () => { throw new Error('a read that holds the frame'); },
      readRenderTargetPixelsAsync: (_t: unknown, _x: number, _y: number, _w: number, _h: number, buf: Float32Array) =>
        new Promise<Float32Array>((done, fail) => { reads.push({ buf, done: () => done(buf), fail: () => fail(new Error('lost')) }); }),
    } as unknown as WebGLRenderer;
    return { r, reads };
  }
  const tick = () => new Promise((ok) => setTimeout(ok, 0));

  it('starts a read every fourth frame, never two at once, and gives each reading once when it has come', async () => {
    const { r, reads } = meterRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300);
    for (let i = 0; i < 3; i++) expect(post.meter()).toBeNull();
    expect(reads.length).toBe(0);
    expect(post.meter()).toBeNull(); // (started, not yet back)
    expect(reads.length).toBe(1);
    for (let i = 0; i < 8; i++) expect(post.meter()).toBeNull();
    expect(reads.length).toBe(1);
    reads[0]!.buf.fill(Math.log(0.5));
    reads[0]!.done();
    await tick();
    expect(post.metered()).toBeCloseTo(0.5, 6);
    expect(post.metered()).toBeNull();
    for (let i = 0; i < 4; i++) post.meter();
    expect(reads.length).toBe(2);
  });

  it('goes on after a read that failed, and drops a reading that comes after the close', async () => {
    const { r, reads } = meterRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300);
    for (let i = 0; i < 4; i++) post.meter();
    reads[0]!.fail();
    await tick();
    expect(post.metered()).toBeNull();
    for (let i = 0; i < 4; i++) post.meter();
    expect(reads.length).toBe(2);
    post.dispose();
    reads[1]!.buf.fill(0);
    reads[1]!.done();
    await tick();
    expect(post.metered()).toBeNull();
  });

  it('at Low (direct) at the board view, the meter reads as the chain does: a read on the fourth call', () => {
    const { r, reads } = meterRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300, { direct: true });
    post.apply(LOW, r, 400, 300);
    post.setReach(0);
    for (let i = 0; i < 3; i++) expect(post.meter()).toBeNull();
    expect(reads.length).toBe(0);
    expect(post.meter()).toBeNull(); // (started, not yet back)
    expect(reads.length).toBe(1);
  });

  it('without the option, Low still reads the meter: a read starts every fourth frame', () => {
    const { r, reads } = meterRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300);
    post.apply(LOW, r, 400, 300);
    for (let i = 0; i < 4; i++) post.meter();
    expect(reads.length).toBe(1);
  });

  it('at Low (direct) it starts no read and gives none: the scene is not in its target', () => {
    const { r, reads } = meterRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300, { direct: true });
    post.apply(LOW, r, 400, 300);
    post.setReach(40000);
    for (let i = 0; i < 12; i++) expect(post.meter()).toBeNull();
    expect(reads.length).toBe(0);
  });
});
