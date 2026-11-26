// A closed BuildStage (PERF12 lets go of its game and machine): a late call from the UI or a timer does nothing and does not throw.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
// (no Pixi renderer in a test)

import { inside, newStage, openStage } from './buildmode3d.testkit';

function createPost() {
  return {
    render: () => {
      /* no-op */
    },
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
    dispose: () => {
      /* no-op */
    },
    startPrograms: () => [],
  };
}

function createLens3D() {
  return {
    frame: () => {
      /* no-op */
    },
    dispose: () => {
      /* no-op */
    },
  };
}

const { Post, Lens3D } = vi.hoisted(() => ({ Post: createPost, Lens3D: createLens3D }));

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

vi.mock<Record<string, unknown>>(import('@/core/render/three/init'), async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    createRenderContext: () => ({
      scene: new Scene(),
      camera: new PerspectiveCamera(30, 1, 10, 1e6),
      pmrem: {
        dispose: () => {
          /* no-op */
        },
      },
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
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
          remove: () => {
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
        forceContextLoss: () => {
          /* no-op */
        },
        dispose: () => {
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
vi.mock<Record<string, unknown>>(import('./bake'), async (orig) => ({
  ...(await orig()),
  startBaker: () => {
    /* no-op */
  },
}));

interface Closed {
  runBenchmark: () => Promise<void>;
  plan: (n: string) => string[];
  partAt: (x: number, y: number) => string | null;
  slotAt: (x: number, y: number) => string | null;
  dispose: () => void;
  benching: { value: unknown };
  picture: Promise<void>;
}
/** What an opened stage keeps to itself: its game, and whether it is closed. */
interface Opened {
  _game: unknown;
  dead: boolean;
}

describe('a closed BuildStage', () => {
  let stage: Closed;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {
      /* no-op */
    });
    vi.stubGlobal('window', {}); // (the dev build's `__build` hook)
    const s = newStage({
      clientWidth: 400,
      clientHeight: 800,
    });
    const machine = {
      moving: false,
      doorOpen: true,
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
      boardRoots: () => [],
      dispose: () => {
        /* no-op */
      },
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
    stage = inside<Closed>(s);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ends the wait of an `open` that has no first picture yet', async () => {
    stage.dispose();
    await expect(stage.picture).resolves.toBeUndefined();
  });

  it('opens closed and at once for a signal that has aborted: no game, no machine, no wait (a player who left before the stage began)', async () => {
    // (a stub host: `open` reads only its size, and the stage never reaches the page)
    const s = await openStage({ clientWidth: 400, clientHeight: 800 }, AbortSignal.abort());
    expect(inside<Opened>(s)._game).toBeNull();
    expect(inside<Opened>(s).dead).toBe(true);
    vi.runAllTimers(); // (the second half of its close)
  });
  async function assert_answers_a_benchmark_a_plan_and_a_pointer_query_w(): Promise<void> {
    await expect(stage.runBenchmark()).resolves.toBeUndefined();
    expect(stage.benching.value).toBeNull();
    expect(stage.plan('dev:cpu0')).toStrictEqual([]);
    expect(stage.partAt(10, 10)).toBeNull();
    expect(stage.slotAt(10, 10)).toBeNull();
  }

  it('answers a benchmark, a plan and a pointer query with nothing once it is closed', async () => {
    expect.hasAssertions();
    stage.dispose();
    await assert_answers_a_benchmark_a_plan_and_a_pointer_query_w();
  });

  it('answers a benchmark, a plan and a pointer query with nothing once its game is gone', async () => {
    expect.hasAssertions();
    stage.dispose();
    vi.runAllTimers(); // (the second half of the close lets go of the game and the machine)
    await assert_answers_a_benchmark_a_plan_and_a_pointer_query_w();
  });
});
