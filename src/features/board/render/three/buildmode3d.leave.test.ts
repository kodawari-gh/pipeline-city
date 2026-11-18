// A player who leaves while Build my PC's first machine builds (BOOT-04: it builds a slice at a time, so the page answers meanwhile, and a click on
// "back" frees the stage at once): `open` comes back closed, the machine that was building is let go, and nothing throws.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';

vi.mock('@/core/render/three/init', async (orig) => {
  const actual = await orig<typeof import('@/core/render/three/init')>();
  return {
    ...actual,
    createRenderContext: () => ({
      scene: new Scene(),
      camera: new PerspectiveCamera(30, 1, 10, 1e6),
      pmrem: { dispose() {} },
      renderer: {
        domElement: { width: 400, height: 400, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }), remove() {} },
        setOpaqueSort() {}, getPixelRatio: () => 1, setSize() {}, properties: { get: () => ({}) }, compile: () => new Set(), getRenderTarget: () => null, setRenderTarget() {}, forceContextLoss() {}, dispose() {},
      },
    }),
  };
});
vi.mock('@/core/render/three/post', () => ({
  Post: class { render() {} meter = () => null; metered = () => null; setEye() {} setReach() {} setOutlined() {} apply() {} setSize() {} dispose() {} startPrograms = () => []; },
}));
vi.mock('./lens3d', () => ({ Lens3D: class { frame() {} dispose() {} } }));
vi.mock('./bake', async (orig) => ({ ...(await orig<typeof import('./bake')>()), startBaker: () => {} })); // (no Pixi renderer in a test)

import { BuildStage } from './buildmode3d';
import { Machine3D } from './machine3d';
import { quietCanvas } from './testutil';

quietCanvas();

type Steps = { buildBoard(...a: unknown[]): unknown };

describe('BuildStage.open when the player leaves during the machine\'s build', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('window', {}); // (the dev build's `__build` hook)
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('comes back closed with no machine, builds no further than the next turn, and its second half of the close runs clean', async () => {
    // (the clock moves 40 ms a look, so every step of the build is past its budget and gives the page a turn)
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 40));
    const ctl = new AbortController(), steps = Machine3D.prototype as unknown as Steps, buildBoard = steps.buildBoard;
    let built = 0;
    vi.spyOn(steps, 'buildBoard').mockImplementation(function (this: Machine3D, ...a: unknown[]) { built++; ctl.abort(); return buildBoard.apply(this, a); });
    const stage = await BuildStage.open({ clientWidth: 400, clientHeight: 800 } as HTMLElement, ctl.signal);
    expect(built).toBe(1);
    const s = stage as unknown as { dead: boolean; _machine: unknown; _game: unknown };
    expect(s.dead).toBe(true);
    expect(s._machine).toBeNull();
    // (its meshes and game go in a second task, 20 ms after the close: nothing in it throws)
    await new Promise((done) => setTimeout(done, 60));
    expect(s._game).toBeNull();
  });
});
