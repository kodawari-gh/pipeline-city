// BuildStage's first picture (docs/render/load.md "Build my PC's first open"): its programs link before the first draw, the page alive; nothing is
// drawn until they have, and `picture` (what `open` waits for) resolves with the first draw.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import { inside, newStage } from './buildmode3d.testkit';

function createLens3D() {
  return {
    frame: () => {
      /* no-op */
    },
  };
}

const { Post, Lens3D, rig } = vi.hoisted(() => {
  const rigState = {
    ready: false,
    render: vi.fn<() => void>(),
    started: vi.fn<() => void>(),
    used: vi.fn<() => void>(),
  };
  function createPost() {
    return {
      render: rigState.render,
      refine: () => false,
      meter: () => null,
      metered: () => null,
      setEye: () => {
        /* no-op */
      },
      setReach: () => {
        /* no-op */
      },
      setDark: () => {
        /* no-op */
      },
      setOutlined: () => {
        /* no-op */
      },
      apply: () => {
        /* no-op */
      },
      setSize: () => {
        /* no-op */
      },
      startPrograms: () => {
        rigState.started();
        return [{ isReady: () => rigState.ready, getUniforms: rigState.used }];
      },
    };
  }
  return { Post: createPost, Lens3D: createLens3D, rig: rigState };
});

function ResizeObserverStub() {
  return {
    observe: (): void => {
      /* no-op */
    },
    disconnect: (): void => {
      /* no-op */
    },
  };
}

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

vi.mock<Record<string, unknown>>(import('@/core/render/three/init'), async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    createRenderContext: () => ({
      scene: new Scene(),
      camera: new PerspectiveCamera(30, 1, 10, 1e6),
      renderer: {
        domElement: {
          width: 400,
          height: 400,
          addEventListener: () => {
            /* no-op */
          },
          removeEventListener: () => {
            /* no-op */
          },
        },
        setOpaqueSort: () => {
          /* no-op */
        },
        getPixelRatio: () => 1,
        setSize: () => {
          /* no-op */
        },
        properties: { get: () => ({}) },
        compile: () => new Set(),
        getRenderTarget: () => null,
        setRenderTarget: () => {
          /* no-op */
        },
      },
    }),
  };
});
vi.mock<Record<string, unknown>>(import('@/core/render/three/post'), () => ({
  Post,
}));
vi.mock<Record<string, unknown>>(import('./lens3d'), () => ({
  Lens3D,
}));

const TICK = 17; // ms; a little over 1/60 s, so the 60 fps gate lets every tick pass

interface Stage {
  frame: (now: number) => void;
  picture: Promise<void>;
}

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
    now = 1000;
    clock = now;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {
      /* no-op */
    });
    const s = newStage({
      clientWidth: 400,
      clientHeight: 800,
    });
    const machine = {
      moving: false,
      doorOpen: false,
      frame: () => {
        /* no-op */
      },
      setOpen: () => {
        /* no-op */
      },
      holdDetail: () => {
        /* no-op */
      },
      lod: () => {
        /* no-op */
      },
      root: new Group(),
    };
    Object.assign(s, {
      _machine: machine,
      _game: {},
      snaps: {
        of: () => ({}),
        drop: () => {
          /* no-op */
        },
      },
    });
    stage = inside<Stage>(s);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('draws nothing while the programs link, starts them once, and draws when they have linked', async () => {
    let done = false;
    void (async (): Promise<void> => {
      await stage.picture;
      done = true;
    })();
    tick(30);
    expect(rig.render).not.toHaveBeenCalled();
    expect(rig.started).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(done).toBe(false);
    rig.ready = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledOnce();
    await stage.picture;
    expect(done).toBe(true);
    expect(rig.started).toHaveBeenCalledOnce();
  });

  it('makes the first use of the programs only once they have linked, and before the first draw (no upload is queued then)', () => {
    tick(10);
    expect(rig.used).not.toHaveBeenCalled(); // (a first use of a program that links still would wait for its link)
    rig.ready = true;
    tick(1);
    expect(rig.used).toHaveBeenCalledOnce();
    expect(rig.used.mock.invocationCallOrder[0]).toBeLessThan(must(rig.render.mock.invocationCallOrder[0]));
  });

  it('draws at the first tick when the programs have linked already (the driver kept them)', async () => {
    rig.ready = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledOnce();
    await stage.picture;
  });

  it('draws anyway when the link takes too long, and the page is not held for ever', async () => {
    tick(5);
    expect(rig.render).not.toHaveBeenCalled();
    now += 16_000;
    tick(1);
    expect(rig.render).toHaveBeenCalledOnce();
    await stage.picture;
  });
});
