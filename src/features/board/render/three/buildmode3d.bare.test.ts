// BuildStage's empty start: a bare case with no motherboard in it. Only a board (or another case) goes in; the board lowers into the case and the machine stands
// as any other; Undo and Redo bring the bare case and the board back.
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
    setEye() {} setReach() {} setOutlined() {} apply() {} setSize() {}
    startPrograms = () => [];
  },
}));
vi.mock('./lens3d', () => ({ Lens3D: class { frame() {} } }));

import { BuildStage, binParts } from './buildmode3d';
import { setLayoutTier } from '../layout/layout';
import { Game } from '@/worker/game/game';

/** What the tests reach into: the steps that wait for the frame loop and the panel are made instant. */
interface Inside { playAll(): Promise<void>; door(): Promise<void> }
const hid = (s: BuildStage): Inside => s as unknown as Inside;

/** A stage with the full rig and no 3D: the machine's drawing is stubbed, the game and the history are the real ones. */
function stage(): BuildStage {
  const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({ clientWidth: 400, clientHeight: 800 });
  s._machine = { moving: false, doorOpen: false, frame() {}, setOpen() {}, closeDoor() {}, holdDetail() {}, lod() {}, root: new Group(), boardRoots: () => [], caseRoots: [], empty: false, rig: () => null };
  s._game = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
  s.rebuild = s.rebuildAll = function (this: { snaps: { drop(): void }; board: { tier: number; caseTier: number } }) {
    this.snaps.drop();
    setLayoutTier(this.board.tier, Math.max(this.board.tier, this.board.caseTier));
  };
  s.playAll = () => Promise.resolve();
  s.door = () => Promise.resolve();
  return s as unknown as BuildStage;
}

const cpu = (): string => binParts().find((b) => b.kind === 'cpu')!.id;

describe('the empty start', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('is a bare case: no board, no part, the smallest case', async () => {
    const s = stage();
    expect(s.bare.peek()).toBe(false);
    await s.clear();
    expect(s.bare.peek()).toBe(true);
    expect(s.board.devices).toHaveLength(0);
    expect(s.board.caseTier).toBe(0);
    expect(s.canUndo).toBe(true);
  });

  it('takes no part until a board is in: a refusal says why, and nothing changes', async () => {
    const s = stage();
    await s.clear();
    const past = s.canUndo;
    await s.fit(cpu());
    expect(s.refusal.peek()?.text).toMatch(/Fit a motherboard first/);
    expect(s.board.devices).toHaveLength(0);
    expect(s.bare.peek()).toBe(true);
    expect(s.canUndo).toBe(past);
    // (a drop has no socket to land on, but a board or a case has the PC itself)
    expect(s.dropTarget(cpu())).toBeNull();
    expect(s.dropTarget('board1')).toBe('board1');
    expect(s.dropTarget('case2')).toBe('case2');
  });

  it('takes the board it holds aside as the one to lower in, and then stands as any machine', async () => {
    const s = stage();
    await s.clear();
    await s.fit('board0');
    expect(s.bare.peek()).toBe(false);
    expect(s.board.tier).toBe(0);
    expect(s.board.caseTier).toBe(0);
    expect(s.refusal.peek()).toBeNull();
    // (it takes parts now)
    await s.fit(cpu());
    expect(s.refusal.peek()).toBeNull();
    expect(s.board.devices.some((d) => d.spec === cpu())).toBe(true);
  });

  it('brings a bigger case with a bigger board (the sandbox lets the case follow the board)', async () => {
    const s = stage();
    await s.clear();
    await s.fit('board2');
    expect(s.bare.peek()).toBe(false);
    expect(s.board.tier).toBe(2);
    expect(s.board.caseTier).toBe(2);
  });

  it('keeps the case bare when a case is swapped, and says a case that stands is already fitted', async () => {
    const s = stage();
    await s.clear();
    await s.fit('case0');
    expect(s.refusal.peek()?.text).toBe('That one is already fitted');
    await s.fit('case2');
    expect(s.bare.peek()).toBe(true);
    expect(s.board.caseTier).toBe(2);
    expect(s.board.devices).toHaveLength(0);
  });

  it('is a step Undo takes back and Redo brings again: the bare case, then the board, then the machine before', async () => {
    const s = stage(), full = s.board.devices.length;
    await s.clear();
    await s.fit('board0');
    expect(s.bare.peek()).toBe(false);
    await s.undo(); // (the board out: the bare case it was)
    expect(s.bare.peek()).toBe(true);
    expect(s.board.devices).toHaveLength(0);
    expect(s.canRedo).toBe(true);
    await s.redo();
    expect(s.bare.peek()).toBe(false);
    expect(s.board.tier).toBe(0);
    await s.undo();
    await s.undo(); // (the start itself: the machine that was here)
    expect(s.bare.peek()).toBe(false);
    expect(s.board.devices).toHaveLength(full);
    expect(s.canUndo).toBe(false);
  });

  it('puts the bare case back as it was after a case swap and a board', async () => {
    const s = stage();
    await s.clear();
    await s.fit('case1');
    expect(s.board.caseTier).toBe(1);
    await s.fit('board1');
    expect(s.bare.peek()).toBe(false);
    await s.undo(); // (the bare Micro)
    expect(s.bare.peek()).toBe(true);
    expect(s.board.caseTier).toBe(1);
    await s.undo(); // (the bare Mini)
    expect(s.bare.peek()).toBe(true);
    expect(s.board.caseTier).toBe(0);
  });

  it('is left by a preset, a saved build or the full rig', async () => {
    const s = stage();
    await s.clear();
    await s.buildPreset(BUILD_PRESETS[0]!);
    expect(s.bare.peek()).toBe(false);
    expect(s.board.devices.length).toBeGreaterThan(0);
    await s.clear();
    await s.reset();
    expect(s.bare.peek()).toBe(false);
    await s.clear();
    await s.loadLayout({ caseTier: 0, boardTier: 0, parts: [] }, 'x');
    expect(s.bare.peek()).toBe(false);
  });

  it('does not count the board it holds aside: the stage has no layout of its own to save', async () => {
    const s = stage();
    await s.clear();
    expect(s.layout.parts).toHaveLength(0);
  });
});
