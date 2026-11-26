import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  RenderTarget,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Texture,
} from 'three';
import type * as threeTypes from 'three';
import { assert, describe, expect, it, vi } from 'vitest';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

vi.mock(import('@/app/graphics'), () => ({ pixelRatio: (scale: number) => scale }));
const { Post, REFINE, jitter, meterMean, steps } = await import('./post');

/** The full-screen passes of a step list: all but the eye's small ones. */
const full = (s: string[]) => s.filter((x) => x !== 'eye').length;
const LOW = { ao: 0, bloom: 0, msaa: 0, scale: 0.6, brightness: 1 };
const HIGH = { ao: 2, bloom: 2, msaa: 4, scale: 1, brightness: 1 };

/** A renderer as far as the post chain uses one (it sizes itself by the pixel ratio). */
const isRenderer = (x: unknown): x is threeTypes.WebGLRenderer =>
  typeof x === 'object' && x !== null && 'getPixelRatio' in x && 'setPixelRatio' in x;

/** The parts of a renderer the chain reads as it is made and sized. */
function stubParts() {
  let ratio = 1;
  return {
    toneMapping: ACESFilmicToneMapping,
    outputColorSpace: SRGBColorSpace,
    toneMappingExposure: 1,
    getPixelRatio: () => ratio,
    setPixelRatio: (r: number) => {
      ratio = r;
    },
    setSize: vi.fn<() => void>(),
  };
}

function stubRenderer(): threeTypes.WebGLRenderer {
  const r = stubParts();
  assert(isRenderer(r));
  return r;
}

/** Every target, texture and shader under `x`, a few fields deep (the passes keep theirs in fields and arrays), not the renderer
 * `r`'s nor the scene's. */
function ownedBy(x: unknown, r: threeTypes.WebGLRenderer) {
  const owned = new Set<RenderTarget | Texture | ShaderMaterial>(),
    seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): void => {
    if (typeof v !== 'object' || v === null || seen.has(v) || depth > 3 || v === r || v instanceof Object3D) {
      return;
    }
    seen.add(v);
    if (v instanceof RenderTarget || v instanceof Texture || v instanceof ShaderMaterial) {
      owned.add(v);
    }
    if (v instanceof RenderTarget) {
      return;
    }
    for (const w of Array.isArray(v) ? v : Object.values(v)) {
      walk(w, depth + 1);
    }
  };
  walk(x, 0);
  return owned;
}

/** Whether a jitter point lies in the quarter of the pixel on the sides `sx`, `sy`. */
const inQuarter = ([x, y]: readonly [number, number], sx: number, sy: number) => x * sx > 0 && y * sy > 0;
/** The mean of the points. */
const meanOf = (pts: readonly (readonly [number, number])[]) => {
  let mx = 0,
    my = 0;
  for (const [x, y] of pts) {
    mx += x / pts.length;
    my += y / pts.length;
  }
  return [mx, my] as const;
};

/** The cells a pixel read reads into (its sixth argument). */
const cellsOf = (call: Parameters<threeTypes.WebGLRenderer['readRenderTargetPixelsAsync']>) => call[5];

/** A renderer whose pixel reads end when the test says so: each read waits in `reads` with the cells it reads into. */
function meterRenderer() {
  const reads: { buf: threeTypes.TypedArray; done: () => void; fail: () => void }[] = [];
  const readAsync = vi.fn<threeTypes.WebGLRenderer['readRenderTargetPixelsAsync']>(async () => {
    const { promise, resolve, reject } = Promise.withResolvers<threeTypes.TypedArray>(),
      buf = cellsOf(must(readAsync.mock.lastCall));
    reads.push({
      buf,
      done: () => {
        resolve(buf);
      },
      fail: () => {
        reject(new Error('lost'));
      },
    });
    const cells = await promise;
    return cells;
  });
  const r = {
    ...stubParts(),
    extensions: { has: () => true },
    getRenderTarget: () => null,
    setRenderTarget: vi.fn<() => void>(),
    render: vi.fn<() => void>(),
    readRenderTargetPixels: () => {
      throw new Error('a read that holds the frame');
    },
    readRenderTargetPixelsAsync: readAsync,
  };
  assert(isRenderer(r));
  return { r, reads };
}
/** Lets the pending reads settle. */
const tick = async () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('the post chain', () => {
  it('runs only what is on: at Low with nothing picked, the scene, the eye and the finish', () => {
    expect(steps({ ao: false, outline: false, bloom: false, eye: true })).toStrictEqual(['scene', 'eye', 'finish']);
    expect(full(steps({ ao: false, outline: false, bloom: false, eye: true }))).toBeLessThanOrEqual(3);
    // the board view: no eye, the finish only tone maps
    expect(steps({ ao: false, outline: false, bloom: false, eye: false })).toStrictEqual(['scene', 'finish']);
  });

  it('copies the picture for the outline or the bloom, and the AO copies it as it blends', () => {
    expect(steps({ ao: false, outline: true, bloom: false, eye: true })).toStrictEqual([
      'scene',
      'copy',
      'outline',
      'eye',
      'finish',
    ]);
    expect(steps({ ao: false, outline: false, bloom: true, eye: true })).toStrictEqual([
      'scene',
      'copy',
      'bloom',
      'eye',
      'finish',
    ]);
    expect(steps({ ao: true, outline: true, bloom: true, eye: true })).toStrictEqual([
      'scene',
      'ao',
      'bloom',
      'outline',
      'eye',
      'finish',
    ]);
    // the outline after the bloom: its bright edge never feeds the bloom
    expect(steps({ ao: false, outline: true, bloom: true, eye: false })).toStrictEqual([
      'scene',
      'copy',
      'bloom',
      'outline',
      'finish',
    ]);
  });

  it('follows the settings, the pick and the view', () => {
    const r = stubRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300);
    post.apply(LOW, r, 400, 300);
    expect(r.getPixelRatio()).toBe(0.6);
    expect(post.steps()).toStrictEqual(['scene', 'eye', 'finish']);
    const pick = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    post.setOutlined([pick]);
    expect(post.steps()).toStrictEqual(['scene', 'copy', 'outline', 'eye', 'finish']);
    // the first frame after the pick ends drops the outline
    post.setOutlined([]);
    expect(post.steps()).toStrictEqual(['scene', 'eye', 'finish']);
    // from the board view in the local eye stays, at `BOARD_EYE` of its strength
    post.setReach(0);
    expect(post.steps()).toStrictEqual(['scene', 'eye', 'finish']);
    post.setReach(40_000);
    post.apply(HIGH, r, 400, 300);
    expect(post.steps()).toStrictEqual(['scene', 'ao', 'bloom', 'eye', 'finish']);
  });

  it('puts the local eye out while a lens darkens the picture on purpose, and back when it ends', () => {
    const r = stubRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300);
    post.apply(LOW, r, 400, 300);
    post.setReach(0);
    expect(post.steps()).toContain('eye');
    // (the host sets it before the frame's `setReach`, which holds it at 0)
    post.setDark(true);
    post.setReach(0);
    expect(post.steps()).not.toContain('eye');
    post.setReach(40_000);
    expect(post.steps()).not.toContain('eye');
    post.setDark(false);
    post.setReach(0);
    expect(post.steps()).toContain('eye');
  });

  it('frees every target, texture and material of its own at a close (PERF12), not the scene', () => {
    const r = stubRenderer(),
      scene = new Scene(),
      box = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    scene.add(box);
    const post = new Post(r, scene, new PerspectiveCamera(), 400, 300);
    // every target, texture and shader the chain holds, a few fields deep (the passes keep theirs in fields and arrays)
    const owned = ownedBy(post, r);
    expect([...owned].filter((x) => x instanceof RenderTarget).length).toBeGreaterThanOrEqual(8);
    const freed = new Set<unknown>();
    for (const x of owned) {
      x.addEventListener('dispose', () => {
        freed.add(x);
      });
    }
    let sceneFreed = false;
    box.geometry.addEventListener('dispose', () => {
      sceneFreed = true;
    });
    post.dispose();
    expect([...owned].filter((x) => !freed.has(x)).map((x) => x.constructor.name)).toStrictEqual([]);
    expect(sceneFreed).toBe(false);
  });
});

describe("the still view's refinement", () => {
  it('keeps the first frame in place and spreads the rest over the pixel', () => {
    expect(jitter(0)).toStrictEqual([0, 0]);
    const pts = Array.from({ length: REFINE }, (_, n) => jitter(n));
    for (const [x, y] of pts) {
      expect(Math.abs(x)).toBeLessThan(0.5);
      expect(Math.abs(y)).toBeLessThan(0.5);
    }
    expect(new Set(pts.map(([x, y]) => `${x},${y}`)).size).toBe(REFINE);
    // each quarter of the pixel has samples, and the mean is near the pixel's middle (the picture does not move)
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      expect(pts.filter((pt) => inQuarter(pt, sx, sy)).length).toBeGreaterThanOrEqual(2);
    }
    const mean = meanOf(pts);
    expect(Math.hypot(mean[0], mean[1])).toBeLessThan(0.08);
  });
});

describe('the light meter', () => {
  it('reads a flat grid as its luminance, and weights the middle', () => {
    const flat = new Float32Array(16 * 9 * 4).fill(Math.log(0.25));
    expect(meterMean(flat, 16, 9)).toBeCloseTo(0.25, 6);
    // a bright middle counts for more than a bright corner
    const mid = [...flat],
      corner = [...flat];
    mid[4 * (8 + 16 * 4)] = Math.log(8);
    corner[0] = Math.log(8);
    expect(meterMean(mid, 16, 9)).toBeGreaterThan(meterMean(corner, 16, 9));
    expect(meterMean(corner, 16, 9)).toBeGreaterThan(0.25);
  });

  it('starts a read every fourth frame, never two at once, and gives each reading once when it has come', async () => {
    const { r, reads } = meterRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300);
    for (let i = 0; i < 3; i++) {
      expect(post.meter()).toBeNull();
    }
    expect(reads).toHaveLength(0);
    expect(post.meter()).toBeNull(); // (started, not yet back)
    expect(reads).toHaveLength(1);
    for (let i = 0; i < 8; i++) {
      expect(post.meter()).toBeNull();
    }
    expect(reads).toHaveLength(1);
    must(reads[0]).buf.fill(Math.log(0.5));
    must(reads[0]).done();
    await tick();
    expect(post.metered()).toBeCloseTo(0.5, 6);
    expect(post.metered()).toBeNull();
    for (let i = 0; i < 4; i++) {
      post.meter();
    }
    expect(reads).toHaveLength(2);
  });

  it('goes on after a read that failed, and drops a reading that comes after the close', async () => {
    const { r, reads } = meterRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300);
    for (let i = 0; i < 4; i++) {
      post.meter();
    }
    must(reads[0]).fail();
    await tick();
    expect(post.metered()).toBeNull();
    for (let i = 0; i < 4; i++) {
      post.meter();
    }
    expect(reads).toHaveLength(2);
    post.dispose();
    must(reads[1]).buf.fill(0);
    must(reads[1]).done();
    await tick();
    expect(post.metered()).toBeNull();
  });
});
