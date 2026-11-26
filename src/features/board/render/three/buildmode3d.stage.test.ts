// BuildStage.frame, idle path: a still stage draws nothing, and a late meter reading can wake it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import { inside, newStage } from './buildmode3d.testkit';
import { BASE_EXPOSURE } from '@/core/render/three/init';
import { setLowDetail } from '@/core/render/three/detail';

function createLens3D() {
  return {
    frame: () => {
      /* no-op */
    },
  };
}

// the controllable parts: what the meter says, and the draws
const { Post, Lens3D, rig } = vi.hoisted(() => {
  const rigState = {
    lum: null as number | null,
    render: vi.fn<() => void>(),
    refine: vi.fn<() => boolean>(() => false),
  };
  function createPost() {
    return {
      render: rigState.render,
      refine: rigState.refine,
      meter: () => null,
      metered: () => rigState.lum,
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
      startPrograms: () => [],
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

/** What the tests drive: the stage's protected frame, and its status. */
interface Frame {
  frame: (now: number) => void;
  status: { value: { busy: boolean; step: string; log: string[]; rev: number } };
}

/** A stage on a stub host with `machine` as its machine: the snapshot getter wants a game, the snapshot cache below gives the snapshot. */
function rigged(machine: object): Frame {
  const s = newStage();
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
  return inside<Frame>(s);
}

/** The reading that holds the eye at its start goal of 1 (key / lum). */
const HOLD = 0.04 / BASE_EXPOSURE; // (EYE_KEY over BASE_EXPOSURE in buildmode3d.ts)
const TICK = 17; // ms; a little over 1/60 s, so the 60 fps gate lets every tick pass

describe('BuildStage.frame when idle', () => {
  let stage: { frame: (now: number) => void };
  let now: number;
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += TICK;
      stage.frame(now);
    }
  };
  const draws = (n: number) => {
    rig.render.mockClear();
    tick(n);
    return rig.render.mock.calls.length;
  };

  beforeEach(() => {
    rig.lum = null;
    rig.render.mockClear();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {
      /* no-op */
    });
    stage = rigged({
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
    });
    now = 1000;
    rig.lum = HOLD;
    tick(20); // warm-up: the first ask and the eye settling
  });

  it('draws nothing when idle', () => {
    expect(draws(120)).toBe(0);
  });

  it("offers each idle tick to the still view's refinement (the chain bounds its frames)", () => {
    rig.refine.mockClear();
    tick(5);
    expect(rig.refine).toHaveBeenCalledTimes(5);
  });

  it('wakes on a late meter reading', () => {
    expect(draws(10)).toBe(0);
    rig.lum = HOLD / 2; // asks for twice the exposure: far outside the dead band
    rig.render.mockClear();
    tick(2);
    expect(rig.render).toHaveBeenCalledWith();
    rig.lum = HOLD / 2; // (the meter keeps its last reading)
    tick(400); // the eye settles
    expect(draws(120)).toBe(0);
  });

  it('stays idle for a reading inside the dead band', () => {
    rig.lum = HOLD * 1.01;
    expect(draws(60)).toBe(0);
  });
});

describe('BuildStage.frame and the distance stand-ins (PHONE-01)', () => {
  const hold = vi.fn<(held: unknown[], ceil?: number) => void>();
  let stage: Frame;
  let machineRoot: Group;
  let now = 1000;

  beforeEach(() => {
    hold.mockClear();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {
      /* no-op */
    });
    machineRoot = new Group();
    stage = rigged({
      moving: false,
      doorOpen: false,
      frame: () => {
        /* no-op */
      },
      setOpen: () => {
        /* no-op */
      },
      holdDetail: hold,
      lod: () => {
        /* no-op */
      },
      root: machineRoot,
    });
    now = 1000;
  });
  afterEach(() => {
    setLowDetail(false);
  });

  const lastHold = (): { held: unknown[]; ceil: number | undefined } => {
    const c = must(hold.mock.calls.at(-1));
    return { held: c[0], ceil: c[1] };
  };

  it("High keeps every part itself from the stage's own zoom in, and holds nothing by hand", () => {
    setLowDetail(false);
    now += TICK;
    stage.frame(now);
    const { held, ceil } = lastHold();
    expect(held).toStrictEqual([]);
    expect(ceil).toBeGreaterThan(0);
    expect(Number.isFinite(ceil)).toBe(true);
  });

  it('Low lets the stand-ins draw at any zoom, and holds the whole machine only while a step runs', () => {
    setLowDetail(true);
    now += TICK;
    stage.frame(now);
    expect(lastHold()).toStrictEqual({ held: [], ceil: undefined });
    stage.status.value = { ...stage.status.value, busy: true };
    now += TICK;
    stage.frame(now);
    expect(lastHold()).toStrictEqual({ held: [machineRoot], ceil: undefined });
    stage.status.value = { ...stage.status.value, busy: false };
    now += TICK;
    stage.frame(now);
    expect(lastHold().held).toStrictEqual([]);
  });
});

describe('BuildStage.frame and the shut side panel', () => {
  it('lets the panel take a click while no step plays, and not while one does (machine3d.ts: the plate over it answers a ray only then)', () => {
    const setOpen = vi.fn<(open: boolean, clickable: boolean) => void>();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {
      /* no-op */
    });
    const stage = rigged({
      moving: false,
      doorOpen: false,
      frame: () => {
        /* no-op */
      },
      setOpen,
      holdDetail: () => {
        /* no-op */
      },
      lod: () => {
        /* no-op */
      },
      root: new Group(),
    });
    stage.frame(1000 + TICK);
    expect(setOpen).toHaveBeenLastCalledWith(false, false);
    stage.status.value = { ...stage.status.value, busy: true };
    stage.frame(1000 + 2 * TICK);
    expect(setOpen).toHaveBeenLastCalledWith(false, true);
  });
});
