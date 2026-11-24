// BuildStage's first picture (docs/render/load.md "Build my PC's first open"): its programs link before the first draw, the page alive; nothing is
// drawn until they have, and `picture` (what `open` waits for) resolves with the first draw.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';

const rig = vi.hoisted(() => ({ ready: false, render: vi.fn(), started: vi.fn(), used: vi.fn() }));

vi.mock('@/core/render/three/init', async (orig) => {
  const actual = await orig<typeof import('@/core/render/three/init')>();
  return {
    ...actual,
    createRenderContext: () => ({
      scene: new Scene(),
      camera: new PerspectiveCamera(30, 1, 10, 1e6),
      renderer: {
        domElement: { width: 400, height: 400, addEventListener() {}, removeEventListener() {} },
        setOpaqueSort() {},
        getPixelRatio: () => 1,
        setSize() {},
        properties: { get: () => ({}) },
        compile: () => new Set(),
        getRenderTarget: () => null,
        setRenderTarget() {},
      },
    }),
  };
});
vi.mock('@/core/render/three/post', () => ({
  Post: class {
    render = rig.render;
    refine = () => false;
    meter = () => null;
    metered = () => null;
    setEye() {}
    setReach() {}
    setDark() {}
    setOutlined() {}
    apply() {}
    setSize() {}
    /** One program that links when the test says so, and counts its first use. */
    startPrograms = () => {
      rig.started();
      return [{ isReady: () => rig.ready, getUniforms: rig.used }];
    };
  },
}));
vi.mock('./lens3d', () => ({
  Lens3D: class {
    frame() {}
  },
}));

import { BuildStage } from './buildmode3d';

const TICK = 17; // ms; a little over 1/60 s, so the 60 fps gate lets every tick pass

type Stage = { frame: (now: number) => void; picture: Promise<void> };

describe('BuildStage first picture', () => {
  let stage: Stage;
  let clock: number;
  let now: number;
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += TICK;
      clock = now;
      stage.frame(now);
    }
  };

  beforeEach(() => {
    rig.ready = false;
    rig.render.mockClear();
    rig.started.mockClear();
    rig.used.mockClear();
    clock = now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({
      clientWidth: 400,
      clientHeight: 800,
    });
    s._machine = {
      moving: false,
      doorOpen: false,
      frame() {},
      setOpen() {},
      holdDetail() {},
      lod() {},
      root: new Group(),
    };
    s._game = {};
    s.snaps = { of: () => ({}), drop() {} };
    stage = s as unknown as Stage;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('draws nothing while the programs link, starts them once, and draws when they have linked', async () => {
    let done = false;
    void stage.picture.then(() => {
      done = true;
    });
    tick(30);
    expect(rig.render).not.toHaveBeenCalled();
    expect(rig.started).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(done).toBe(false);
    rig.ready = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledTimes(1);
    await stage.picture;
    expect(done).toBe(true);
    expect(rig.started).toHaveBeenCalledTimes(1);
  });

  it('makes the first use of the programs only once they have linked, and before the first draw (no upload is queued then)', () => {
    tick(10);
    expect(rig.used).not.toHaveBeenCalled(); // (a first use of a program that links still would wait for its link)
    rig.ready = true;
    tick(1);
    expect(rig.used).toHaveBeenCalledTimes(1);
    expect(rig.used.mock.invocationCallOrder[0]).toBeLessThan(rig.render.mock.invocationCallOrder[0]!);
  });

  it('draws at the first tick when the programs have linked already (the driver kept them)', async () => {
    rig.ready = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledTimes(1);
    await stage.picture;
  });

  it('draws anyway when the link takes too long, and the page is not held for ever', async () => {
    tick(5);
    expect(rig.render).not.toHaveBeenCalled();
    now += 16000;
    tick(1);
    expect(rig.render).toHaveBeenCalledTimes(1);
    await stage.picture;
  });
});
