import { ACESFilmicToneMapping, BoxGeometry, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, RenderTarget, SRGBColorSpace, Scene, ShaderMaterial, Texture, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/graphics', () => ({ pixelRatio: (scale: number) => scale }));
const { Post, REFINE, jitter, meterMean, steps } = await import('./post');

/** The full-screen passes of a step list: all but the eye's small ones. */
const full = (s: string[]) => s.filter((x) => x !== 'eye').length;
const LOW = { ao: 0, bloom: 0, msaa: 0, scale: 0.6, brightness: 1 };
const HIGH = { ao: 2, bloom: 2, msaa: 4, scale: 1, brightness: 1 };

function stubRenderer(): WebGLRenderer {
  let ratio = 1;
  return {
    toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace, toneMappingExposure: 1,
    getPixelRatio: () => ratio, setPixelRatio: (r: number) => { ratio = r; }, setSize: () => {},
  } as unknown as WebGLRenderer;
}

describe('the post chain', () => {
  it('runs only what is on: at Low with nothing picked, the scene, the eye and the finish', () => {
    expect(steps({ ao: false, outline: false, bloom: false, eye: true })).toEqual(['scene', 'eye', 'finish']);
    expect(full(steps({ ao: false, outline: false, bloom: false, eye: true }))).toBeLessThanOrEqual(3);
    // the board view: no eye, the finish only tone maps
    expect(steps({ ao: false, outline: false, bloom: false, eye: false })).toEqual(['scene', 'finish']);
  });

  it('copies the picture for the outline or the bloom, and the AO copies it as it blends', () => {
    expect(steps({ ao: false, outline: true, bloom: false, eye: true })).toEqual(['scene', 'copy', 'outline', 'eye', 'finish']);
    expect(steps({ ao: false, outline: false, bloom: true, eye: true })).toEqual(['scene', 'copy', 'bloom', 'eye', 'finish']);
    expect(steps({ ao: true, outline: true, bloom: true, eye: true })).toEqual(['scene', 'ao', 'bloom', 'outline', 'eye', 'finish']);
    // the outline after the bloom: its bright edge never feeds the bloom
    expect(steps({ ao: false, outline: true, bloom: true, eye: false })).toEqual(['scene', 'copy', 'bloom', 'outline', 'finish']);
  });

  it('follows the settings, the pick and the view', () => {
    const r = stubRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300);
    post.apply(LOW, r, 400, 300);
    expect(r.getPixelRatio()).toBe(0.6);
    expect(post.steps()).toEqual(['scene', 'eye', 'finish']);
    const pick = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    post.setOutlined([pick]);
    expect(post.steps()).toEqual(['scene', 'copy', 'outline', 'eye', 'finish']);
    // the first frame after the pick ends drops the outline
    post.setOutlined([]);
    expect(post.steps()).toEqual(['scene', 'eye', 'finish']);
    // from the board view in the local eye stays, at `BOARD_EYE` of its strength
    post.setReach(0);
    expect(post.steps()).toEqual(['scene', 'eye', 'finish']);
    post.setReach(40000);
    post.apply(HIGH, r, 400, 300);
    expect(post.steps()).toEqual(['scene', 'ao', 'bloom', 'eye', 'finish']);
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

describe('the still view\'s refinement', () => {
  it('keeps the first frame in place and spreads the rest over the pixel', () => {
    expect(jitter(0)).toEqual([0, 0]);
    const pts = Array.from({ length: REFINE }, (_, n) => jitter(n));
    for (const [x, y] of pts) { expect(Math.abs(x)).toBeLessThan(0.5); expect(Math.abs(y)).toBeLessThan(0.5); }
    expect(new Set(pts.map(([x, y]) => `${x},${y}`)).size).toBe(REFINE);
    // each quarter of the pixel has samples, and the mean is near the pixel's middle (the picture does not move)
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) expect(pts.filter(([x, y]) => x * sx > 0 && y * sy > 0).length).toBeGreaterThanOrEqual(2);
    const mean = pts.reduce((a, [x, y]) => [a[0]! + x / REFINE, a[1]! + y / REFINE], [0, 0]);
    expect(Math.hypot(mean[0]!, mean[1]!)).toBeLessThan(0.08);
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
});
