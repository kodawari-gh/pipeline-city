// BuildStage and the side panel: how long a step waits for it, which cases keep it open, and how a new case or board is checked before anything moves.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import { BUILD_PRESETS } from '@/features/board/sim/buildspecs';
import { createBoard } from '@/features/board/sim/board';

vi.mock('@/core/render/three/init', async (orig) => {
  const actual = await orig<typeof import('@/core/render/three/init')>();
  return {
    ...actual,
    createRenderContext: () => ({
      scene: new Scene(),
      camera: new PerspectiveCamera(30, 1, 10, 1e6),
      renderer: {
        domElement: { width: 400, height: 400, addEventListener() {}, removeEventListener() {} },
        setOpaqueSort() {}, getPixelRatio: () => 1, setSize() {}, properties: { get: () => ({}) }, compile: () => new Set(), getRenderTarget: () => null, setRenderTarget() {},
      },
    }),
  };
});
vi.mock('@/core/render/three/post', () => ({
  Post: class {
    render() {} refine = () => false; meter = () => null; metered = () => null;
    setEye() {} setReach() {} setOutlined() {} apply() {} setSize() {}
    startPrograms = () => [];
  },
}));
vi.mock('./lens3d', () => ({ Lens3D: class { frame() {} } }));

import { BuildStage, shellRefusal } from './buildmode3d';
import { DOOR_SECONDS, doorWait } from './casedoor';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import { setLayoutTier } from '../layout/layout';
import { Game } from '@/worker/game/game';

/** What the tests reach into: the stage's private door and job. */
interface Inside {
  door(open: boolean, settle?: boolean): Promise<void>;
  job(work: () => Promise<void>): Promise<void>;
  wantOpen: boolean;
  jobOpen: boolean;
  playAll(): Promise<void>;
  _machine: { doorOpen: boolean };
}
type Stage = BuildStage;
/** The stage's private door, job and flags. */
const hid = (s: Stage): Inside => s as unknown as Inside;

/** A stage with the full rig and no 3D: the machine's drawing is stubbed (its panel too), the game and the history are the real ones. */
function stage(): Stage {
  const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({ clientWidth: 400, clientHeight: 800 });
  const machine = { moving: false, doorOpen: false, frame() {}, setOpen() {}, closeDoor() { machine.doorOpen = false; }, holdDetail() {}, lod() {}, root: new Group(), boardRoots: () => [], caseRoots: [] };
  s._machine = machine;
  s._game = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
  // (the real build sets the layout's tiers, which say what kind of case the stage shows)
  s.rebuild = s.rebuildAll = function (this: { snaps: { drop(): void }; board: { tier: number; caseTier: number } }) {
    this.snaps.drop();
    setLayoutTier(this.board.tier, Math.max(this.board.tier, this.board.caseTier));
  };
  return s as unknown as Stage;
}

describe('BuildStage and the side panel', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('waits for the panel to swing clear before the work starts: longer for the Mini\'s steel than for the Full tower\'s glass', async () => {
    vi.useFakeTimers();
    try {
      for (const tier of [3, 0]) {
        setLayoutTier(tier, tier);
        const kind = CASE_KIND[tier]!, s = stage();
        let done = false;
        const p = hid(s).door(true).then(() => { done = true; });
        const ms = DOOR_SECONDS[kind] * 1000 * doorWait(kind);
        await vi.advanceTimersByTimeAsync(ms - 50);
        expect(done, kind).toBe(false);
        await vi.advanceTimersByTimeAsync(100);
        expect(done, kind).toBe(true);
        await p;
      }
    } finally { vi.useRealTimers(); }
  });

  it('waits for the whole swing when the panel must stand shut before the case lifts, and not at all when it is shut already', async () => {
    vi.useFakeTimers();
    try {
      setLayoutTier(0, 0);
      const s = stage();
      hid(s)._machine.doorOpen = true;
      let done = false;
      const p = hid(s).door(false, true).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(DOOR_SECONDS.oem * 1000 - 100);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(done).toBe(true);
      await p;
      // (shut already: nothing to wait for)
      await hid(s).door(false, true);
    } finally { vi.useRealTimers(); }
  });

  it('keeps a steel panel open when a job ends, and leaves a glass one to the zoom', async () => {
    for (const tier of [0, 1, 2, 3]) {
      setLayoutTier(tier, tier);
      const s = stage();
      hid(s)._machine.doorOpen = true;
      await hid(s).job(async () => { hid(s).jobOpen = true; });
      expect(hid(s).jobOpen, `case ${tier}`).toBe(false);
      expect(hid(s).wantOpen, `case ${tier}`).toBe(tier < 2);
    }
  });

  it('does not hold a steel panel open that the job never opened', async () => {
    setLayoutTier(0, 0);
    const s = stage();
    await hid(s).job(async () => {});
    expect(hid(s).wantOpen).toBe(false);
  });

  it('opens a steel case for the machine that replaces the old one, and shuts what it forced when a glass case comes', async () => {
    const s = stage();
    await s.clear(); // (the empty Mini)
    expect(hid(s).wantOpen).toBe(true);
    await s.buildPreset(BUILD_PRESETS[1]!); // (the Gaming machine: a Mid tower, glass)
    expect(hid(s).wantOpen).toBe(false);
    await s.buildPreset(BUILD_PRESETS[0]!); // (the Budget machine: a Micro tower, steel again)
    expect(hid(s).wantOpen).toBe(true);
    await s.undo(); // (back to the Mid)
    expect(hid(s).wantOpen).toBe(false);
  });

  it('leaves what the player chose on a glass case when another glass machine comes', async () => {
    const s = stage();
    await s.reset(); // (the full rig: glass)
    hid(s).wantOpen = true;
    await s.buildPreset(BUILD_PRESETS[2]!);
    expect(hid(s).wantOpen).toBe(true);
  });
});

describe('a new case or board is checked before anything moves', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('says why the game would refuse a case, whatever is fitted', () => {
    const board = createBoard(3, 3);
    board.devices.push({ id: 'dev1', spec: 'cpu1', slot: 'cpu0' });
    expect(shellRefusal(board, 'case0')).toMatch(/too small/);
    expect(shellRefusal(board, 'case3')).toMatch(/already fitted/);
    expect(shellRefusal(board, 'case2')).toMatch(/too small/);
    expect(shellRefusal(createBoard(1, 3), 'case1')).toBeNull();
    expect(shellRefusal(createBoard(0, 0), 'case3')).toBeNull();
  });

  it('says why the game would refuse a board, and does not change the board it asks about', () => {
    const board = createBoard(1, 1);
    expect(shellRefusal(board, 'board1')).toMatch(/already fitted/);
    expect(shellRefusal(board, 'board3')).toBeNull();
    expect(board.tier).toBe(1);
    expect(board.caseTier).toBe(1);
  });

  it('refuses a case that is too small before the board or the case lifts, and keeps the history', async () => {
    const s = stage();
    await s.buildPreset(BUILD_PRESETS[2]!); // (a Full tower with the Full board)
    expect(s.canUndo).toBe(true);
    const play = vi.spyOn(hid(s), 'playAll');
    await s.fit('case0');
    expect(play).not.toHaveBeenCalled();
    expect(s.refusal.peek()?.text).toMatch(/Cannot fit it: .*too small/);
    expect(s.board.caseTier).toBe(3);
    expect(s.canUndo).toBe(true);
  });
});
