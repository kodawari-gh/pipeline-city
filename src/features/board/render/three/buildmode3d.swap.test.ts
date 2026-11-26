// BuildStage's swaps: a preset, a saved build, the full rig and an empty stage replace the whole machine, and Undo and Redo bring the machines back
// (the right panel's "Start from" has no confirm: the way back is Undo).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import { BUILD_PRESETS } from '@/features/board/sim/buildspecs';
import type { BuildStage } from './buildmode3d';
import { newStage } from './buildmode3d.testkit';
import { Game } from '@/worker/game/game';

function createPost() {
  return {
    render: () => {
      /* no-op */
    },
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
    startPrograms: () => [],
  };
}

function createLens3D() {
  return {
    frame: () => {
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

type Stage = BuildStage;

/** A stage with the full rig and no 3D: the machine's drawing is stubbed, the game and the history are the real ones. */
function stage(): Stage {
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
    _game: new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true }),
    rebuild,
  });
  return s;
}

/** The stage's rebuild without 3D. */
function rebuild(this: { snaps: { drop: () => void } }): void {
  this.snaps.drop();
}

const fitted = (s: Stage): number => s.board.devices.length;

/** Clears the stage `n` times, one job after the other. */
async function clearTimes(s: Stage, n: number): Promise<void> {
  if (n <= 0) {
    return;
  }
  await s.clear();
  await clearTimes(s, n - 1);
}

/** Undoes while the stage can, at most `max` times, one step after the other; returns how many steps it undid. */
async function undoAll(s: Stage, max: number): Promise<number> {
  if (!s.canUndo || max <= 0) {
    return 0;
  }
  await s.undo();
  return 1 + (await undoAll(s, max - 1));
}

async function assert_keeps_only_the_last_few_machines(): Promise<void> {
  const s = stage();
  await clearTimes(s, 12);
  await expect(undoAll(s, 20)).resolves.toBe(8);
}

describe('BuildStage swaps and Undo', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {
      /* no-op */
    });
  });

  it('brings the old machine back on Undo, and the new one on Redo', async () => {
    const s = stage(),
      full = fitted(s),
      { game } = s;
    expect(s.canUndo).toBe(false);
    await s.clear();
    expect(fitted(s)).toBe(0);
    expect(s.lastWasSwap).toBe(true);
    expect(s.canUndo).toBe(true);
    await s.undo();
    // (the very game that was on the stage, not a copy of it)
    expect(s.game).toBe(game);
    expect(fitted(s)).toBe(full);
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(true);
    await s.redo();
    expect(fitted(s)).toBe(0);
    expect(s.canRedo).toBe(false);
  });

  it('undoes a chain of swaps one machine at a time', async () => {
    const s = stage(),
      full = fitted(s);
    await s.buildPreset(must(BUILD_PRESETS[0]));
    const budget = fitted(s);
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThan(full);
    await s.clear();
    await s.reset();
    expect(fitted(s)).toBe(full);
    await s.undo(); // the full rig, undone: the empty stage
    expect(fitted(s)).toBe(0);
    await s.undo(); // the empty stage, undone: the budget machine
    expect(fitted(s)).toBe(budget);
    await s.undo(); // the budget machine, undone: where it began
    expect(fitted(s)).toBe(full);
    expect(s.canUndo).toBe(false);
  });

  it('counts each swap, Undo included, so a line about one swap is stale after the next', async () => {
    const s = stage(),
      at = s.swaps;
    await s.clear();
    expect(s.swaps).toBe(at + 1);
    await s.undo();
    expect(s.swaps).toBe(at + 2);
  });

  it('forgets the machines that Redo would bring back once a new one is made', async () => {
    const s = stage();
    await s.clear();
    await s.undo();
    expect(s.canRedo).toBe(true);
    await s.buildPreset(must(BUILD_PRESETS[1]));
    expect(s.canRedo).toBe(false);
  });

  it('keeps only the last few machines', async () => {
    expect.hasAssertions();
    await assert_keeps_only_the_last_few_machines();
  });

  it('lets go of the picked part and its row of the old machine', async () => {
    const s = stage();
    const { id } = must(s.board.devices[0]);
    s.select(id);
    expect(s.selected.peek()).toBe(id);
    await s.buildPreset(must(BUILD_PRESETS[0]));
    expect(s.selected.peek()).toBeNull();
  });

  it('raises a refusal for the hint line, and keeps the history when a case that is already fitted is asked for', async () => {
    const s = stage();
    await s.buildPreset(must(BUILD_PRESETS[0]));
    expect(s.canUndo).toBe(true);
    await s.fit(`case${s.board.caseTier}`);
    expect(s.refusal.peek()?.text).toBe('That one is already fitted');
    expect(s.status.peek().log.at(-1)).toBe('That one is already fitted');
    expect(s.canUndo).toBe(true);
    s.clearRefusal();
    expect(s.refusal.peek()).toBeNull();
  });

  it('lets a refusal go after a few seconds from the end of the job, and at once for the next job or machine', async () => {
    vi.useFakeTimers();
    try {
      const s = stage(),
        caseId = `case${s.board.caseTier}`;
      await s.fit(caseId);
      expect(s.refusal.peek()).not.toBeNull();
      vi.advanceTimersByTime(5900);
      expect(s.refusal.peek()).not.toBeNull();
      vi.advanceTimersByTime(200);
      expect(s.refusal.peek()).toBeNull();
      await s.fit(caseId);
      const first = s.refusal.peek();
      await s.fit(caseId); // (the next job clears the old one first; the new refusal is another one)
      expect(s.refusal.peek()?.n).toBeGreaterThan(must(first).n);
      await s.clear(); // (a new machine: what was refused belonged to the old one)
      expect(s.refusal.peek()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the scores of the machine it leaves as the ones to compare with', async () => {
    const s = stage();
    s.bench.value = { t1: { id: 't1', score: 900, seconds: null } };
    await s.clear();
    expect(Object.keys(s.bench.peek())).toStrictEqual([]);
    expect(Object.keys(s.benchWas.peek())).toStrictEqual(['t1']);
  });
});
