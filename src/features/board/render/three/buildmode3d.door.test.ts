// BuildStage and the side panel: how long a step waits for it, which cases keep it open, and how a new case or board is checked before anything moves.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import { BUILD_PRESETS } from '@/features/board/sim/buildspecs';
import { createBoard } from '@/features/board/sim/board';
import { shellRefusal } from './buildmode3d';
import { inside, newStage } from './buildmode3d.testkit';
import { DOOR_SECONDS, doorWait } from './casedoor';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import { setLayoutTier } from '../layout/layout';
import { Game } from '@/worker/game/game';

/** The stage these tests drive (its type, without a second import of the module). */
type BuildStage = ReturnType<typeof newStage>;

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

/** What the tests reach into: the stage's private door and job. */
interface Inside {
  door: (open: boolean, settle?: boolean) => Promise<void>;
  job: (work: () => Promise<void> | void) => Promise<void>;
  wantOpen: boolean;
  jobOpen: boolean;
  playAll: () => Promise<void>;
  _machine: { doorOpen: boolean; doorT?: number | null };
}
type Stage = BuildStage;
/** The stage's private members that `Inside` names. */
const hid = (s: BuildStage): Inside => inside<Inside>(s);

/** The stage's rebuild without 3D: the real build sets the layout's tiers, which say what kind of case the stage shows. */
function rebuild(this: { snaps: { drop: () => void }; board: { tier: number; caseTier: number } }): void {
  this.snaps.drop();
  setLayoutTier(this.board.tier, Math.max(this.board.tier, this.board.caseTier));
}

/** A stage with the full rig and no 3D: the machine's drawing is stubbed (its panel too), the game and the history are the real ones. */
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
    closeDoor: () => {
      machine.doorOpen = false;
    },
    holdDetail: () => {
      /* no-op */
    },
    lod: () => {
      /* no-op */
    },
    root: new Group(),
    boardRoots: () => [],
    caseRoots: [],
  };
  Object.assign(s, {
    _machine: machine,
    _game: new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true }),
    rebuild,
    rebuildAll: rebuild,
  });
  return s;
}

/** Starts `door(open, settle)` on `s`; `done()` says if it has resolved yet. */
function startDoor(s: Stage, open: boolean, settle?: boolean): { p: Promise<void>; done: () => boolean } {
  let finished = false;
  const p = (async (): Promise<void> => {
    await hid(s).door(open, settle);
    finished = true;
  })();
  return { p, done: () => finished };
}

async function assert_waits_for_the_panel_to_swing_clear_before_the_wo(tier: number): Promise<void> {
  vi.useFakeTimers();
  try {
    setLayoutTier(tier, tier);
    const kind = must(CASE_KIND[tier]),
      s = stage();
    const { p, done } = startDoor(s, true);
    const ms = DOOR_SECONDS[kind] * 1000 * doorWait(kind);
    await vi.advanceTimersByTimeAsync(ms - 50);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(done()).toBe(true);
    await p;
  } finally {
    vi.useRealTimers();
  }
}

async function assert_waits_for_the_panel_itself_when_a_slow_frame_lef(tier: number): Promise<void> {
  vi.useFakeTimers();
  try {
    setLayoutTier(tier, tier);
    const kind = must(CASE_KIND[tier]),
      s = stage(),
      m = hid(s)._machine;
    m.doorT = 0.1; // (a hitch in the frames: the panel is a tenth open when the clock says it is clear)
    const { p, done } = startDoor(s, true);
    await vi.advanceTimersByTimeAsync(DOOR_SECONDS[kind] * 1000 * doorWait(kind) + 200);
    expect(done(), `${kind}: the clock ran out, the panel did not`).toBe(false);
    m.doorT = doorWait(kind); // (now it is clear)
    await vi.advanceTimersByTimeAsync(40);
    expect(done()).toBe(true);
    await p;
  } finally {
    vi.useRealTimers();
  }
}

async function assert_keeps_a_steel_panel_open_when_a_job_ends_and_lea(tier: number): Promise<void> {
  setLayoutTier(tier, tier);
  const s = stage();
  hid(s)._machine.doorOpen = true;
  await hid(s).job(() => {
    hid(s).jobOpen = true;
  });
  expect(hid(s).jobOpen, `case ${tier}`).toBe(false);
  expect(hid(s).wantOpen, `case ${tier}`).toBe(tier < 2);
}

describe('BuildStage and the side panel', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {
      /* no-op */
    });
  });

  it.each([3, 0])(
    "waits for the panel to swing clear before the work starts: longer for the Mini's steel than for the Full tower's glass (case %i)",
    async (tier) => {
      expect.hasAssertions();
      await assert_waits_for_the_panel_to_swing_clear_before_the_wo(tier);
    },
  );

  it.each([3, 2, 1, 0])(
    'waits for the panel itself when a slow frame left it behind the clock (case %i)',
    async (tier) => {
      expect.hasAssertions();
      await assert_waits_for_the_panel_itself_when_a_slow_frame_lef(tier);
    },
  );

  it('waits for a panel the zoom is still opening, before a step moves a part through it', async () => {
    vi.useFakeTimers();
    try {
      setLayoutTier(3, 3);
      const s = stage(),
        m = hid(s)._machine;
      m.doorOpen = true;
      m.doorT = 0.2; // (opening: a step that starts now would go through the glass)
      const { p, done } = startDoor(s, true);
      await vi.advanceTimersByTimeAsync(100);
      expect(done()).toBe(false);
      m.doorT = 1;
      await vi.advanceTimersByTimeAsync(40);
      expect(done()).toBe(true);
      await p;
      // (a panel that stands open: no wait at all)
      hid(s).jobOpen = false;
      await hid(s).door(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits until the panel is really shut before the case lifts', async () => {
    vi.useFakeTimers();
    try {
      setLayoutTier(3, 3);
      const s = stage(),
        m = hid(s)._machine;
      m.doorOpen = true;
      m.doorT = 0.6;
      const { p, done } = startDoor(s, false, true);
      await vi.advanceTimersByTimeAsync(DOOR_SECONDS.show * 1000 + 200);
      expect(done()).toBe(false);
      m.doorT = 0;
      await vi.advanceTimersByTimeAsync(40);
      expect(done()).toBe(true);
      await p;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait for ever for a panel that does not move (a stage that draws no frames)', async () => {
    vi.useFakeTimers();
    try {
      setLayoutTier(3, 3);
      const s = stage(),
        m = hid(s)._machine;
      m.doorT = 0;
      const { p, done } = startDoor(s, true);
      await vi.advanceTimersByTimeAsync(DOOR_SECONDS.show * 1000 * 6);
      expect(done()).toBe(true);
      await p;
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for the whole swing when the panel must stand shut before the case lifts, and not at all when it is shut already', async () => {
    vi.useFakeTimers();
    try {
      setLayoutTier(0, 0);
      const s = stage();
      hid(s)._machine.doorOpen = true;
      const { p, done } = startDoor(s, false, true);
      await vi.advanceTimersByTimeAsync(DOOR_SECONDS.oem * 1000 - 100);
      expect(done()).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(done()).toBe(true);
      await p;
      // (shut already: nothing to wait for)
      await hid(s).door(false, true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([0, 1, 2, 3])(
    'keeps a steel panel open when a job ends, and leaves a glass one to the zoom (case %i)',
    async (tier) => {
      expect.hasAssertions();
      await assert_keeps_a_steel_panel_open_when_a_job_ends_and_lea(tier);
    },
  );

  it('does not hold a steel panel open that the job never opened', async () => {
    setLayoutTier(0, 0);
    const s = stage();
    await hid(s).job(async () => {
      /* no-op */
    });
    expect(hid(s).wantOpen).toBe(false);
  });

  it('opens a steel case for the machine that replaces the old one, and shuts what it forced when a glass case comes', async () => {
    const s = stage();
    await s.buildPreset(must(BUILD_PRESETS[0])); // (the Budget machine: a Micro tower, steel)
    expect(hid(s).wantOpen).toBe(true);
    await s.buildPreset(must(BUILD_PRESETS[1])); // (the Gaming machine: a Mid tower, glass)
    expect(hid(s).wantOpen).toBe(false);
    await s.buildPreset(must(BUILD_PRESETS[0])); // (the Budget machine: a Micro tower, steel again)
    expect(hid(s).wantOpen).toBe(true);
    await s.undo(); // (back to the Mid)
    expect(hid(s).wantOpen).toBe(false);
  });

  it('holds no panel open for an empty stage (there is no case to open), whatever was forced before', async () => {
    const s = stage();
    await s.buildPreset(must(BUILD_PRESETS[0])); // (a steel Micro tower: its panel opens)
    expect(hid(s).wantOpen).toBe(true);
    await s.clear(); // (nothing on the stage)
    expect(hid(s).wantOpen).toBe(false);
    s.openInside(true);
    expect(hid(s).wantOpen).toBe(false);
    expect(s.insideOpen).toBe(false);
  });

  it('leaves what the player chose on a glass case when another glass machine comes', async () => {
    const s = stage();
    await s.reset(); // (the full rig: glass)
    hid(s).wantOpen = true;
    await s.buildPreset(must(BUILD_PRESETS[2]));
    expect(hid(s).wantOpen).toBe(true);
  });
});

describe('a new case or board is checked before anything moves', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {
      /* no-op */
    });
  });

  it('says why the game would refuse a case, whatever is fitted', () => {
    const board = createBoard(3, 3);
    board.devices.push({ id: 'dev1', spec: 'cpu1', slot: 'cpu0' });
    expect(shellRefusal(board, 'case0')).toMatch(/too small/u);
    expect(shellRefusal(board, 'case3')).toMatch(/already fitted/u);
    expect(shellRefusal(board, 'case2')).toMatch(/too small/u);
    expect(shellRefusal(createBoard(1, 3), 'case1')).toBeNull();
    expect(shellRefusal(createBoard(0, 0), 'case3')).toBeNull();
  });

  it('says why the game would refuse a board, and does not change the board it asks about', () => {
    const board = createBoard(1, 1);
    expect(shellRefusal(board, 'board1')).toMatch(/already fitted/u);
    expect(shellRefusal(board, 'board3')).toBeNull();
    expect(board.tier).toBe(1);
    expect(board.caseTier).toBe(1);
  });

  it('refuses a case that is too small before the board or the case lifts, and keeps the history', async () => {
    const s = stage();
    await s.buildPreset(must(BUILD_PRESETS[2])); // (a Full tower with the Full board)
    expect(s.canUndo).toBe(true);
    const play = vi.spyOn(hid(s), 'playAll');
    await s.fit('case0');
    expect(play).not.toHaveBeenCalled();
    expect(s.refusal.peek()?.text).toMatch(/Cannot fit it: .*too small/u);
    expect(s.board.caseTier).toBe(3);
    expect(s.canUndo).toBe(true);
  });
});
