// BuildStage's swaps: a preset, a saved build, the full rig and an empty stage replace the whole machine, and Undo and Redo bring the machines back
// (the right panel's "Start from" has no confirm: the way back is Undo).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import { BUILD_PRESETS } from '@/features/board/sim/buildspecs';

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
    setEye() {} setReach() {} setDark() {} setOutlined() {} apply() {} setSize() {}
    startPrograms = () => [];
  },
}));
vi.mock('./lens3d', () => ({ Lens3D: class { frame() {} } }));

import { BuildStage } from './buildmode3d';
import { Game } from '@/worker/game/game';

type Stage = BuildStage;

/** A stage with the full rig and no 3D: the machine's drawing is stubbed, the game and the history are the real ones. */
function stage(): Stage {
  const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({ clientWidth: 400, clientHeight: 800 });
  s._machine = { moving: false, doorOpen: false, frame() {}, setOpen() {}, holdDetail() {}, lod() {}, root: new Group() };
  s._game = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true });
  s.rebuild = function (this: { snaps: { drop(): void } }) { this.snaps.drop(); };
  return s as unknown as Stage;
}

const fitted = (s: Stage): number => s.board.devices.length;

describe('BuildStage swaps and Undo', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('brings the old machine back on Undo, and the new one on Redo', async () => {
    const s = stage(), full = fitted(s), game = s.game;
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
    const s = stage(), full = fitted(s);
    await s.buildPreset(BUILD_PRESETS[0]!);
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
    const s = stage(), at = s.swaps;
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
    await s.buildPreset(BUILD_PRESETS[1]!);
    expect(s.canRedo).toBe(false);
  });

  it('keeps only the last few machines', async () => {
    const s = stage();
    for (let i = 0; i < 12; i++) await s.clear();
    let undone = 0;
    while (s.canUndo && undone < 20) { await s.undo(); undone++; }
    expect(undone).toBe(8);
  });

  it('lets go of the picked part and its row of the old machine', async () => {
    const s = stage();
    const id = s.board.devices[0]!.id;
    s.select(id);
    expect(s.selected.peek()).toBe(id);
    await s.buildPreset(BUILD_PRESETS[0]!);
    expect(s.selected.peek()).toBeNull();
  });

  it('raises a refusal for the hint line, and keeps the history when a case that is already fitted is asked for', async () => {
    const s = stage();
    await s.buildPreset(BUILD_PRESETS[0]!);
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
      const s = stage(), caseId = `case${s.board.caseTier}`;
      await s.fit(caseId);
      expect(s.refusal.peek()).not.toBeNull();
      vi.advanceTimersByTime(5900);
      expect(s.refusal.peek()).not.toBeNull();
      vi.advanceTimersByTime(200);
      expect(s.refusal.peek()).toBeNull();
      await s.fit(caseId);
      const first = s.refusal.peek();
      await s.fit(caseId); // (the next job clears the old one first; the new refusal is another one)
      expect(s.refusal.peek()?.n).toBeGreaterThan(first!.n);
      await s.clear(); // (a new machine: what was refused belonged to the old one)
      expect(s.refusal.peek()).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('keeps the scores of the machine it leaves as the ones to compare with', async () => {
    const s = stage();
    s.bench.value = { t1: { id: 't1', score: 900 } as never };
    await s.clear();
    expect(Object.keys(s.bench.peek())).toEqual([]);
    expect(Object.keys(s.benchWas.peek())).toEqual(['t1']);
  });
});
