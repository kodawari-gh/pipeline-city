// BuildStage's empty start: nothing on the stage. The player brings a case in from the shelf (a bare case, with no motherboard in it), then a board (the
// machine then stands as any other), then the parts. Undo and Redo walk the same way back and forth: the machine, the bare case, nothing, the machine before.
// A new case on a machine moves the parts the case holds with it, as the game does; a case the game refuses is said on the hint line.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import { BUILD_PRESETS } from '@/features/board/sim/buildspecs';
import { deviceSpec, fanHost } from '@/features/board/sim/board';

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
    render() {}
    refine = () => false;
    meter = () => null;
    metered = () => null;
    setEye() {}
    setReach() {}
    setDark() {}
    setOutlined() {}
    apply() {}
    setSize() {}
    startPrograms = () => [];
  },
}));
vi.mock('./lens3d', () => ({
  Lens3D: class {
    frame() {}
  },
}));

import { BuildStage, binParts } from './buildmode3d';
import { setLayoutTier } from '../layout/layout';
import { Game } from '@/worker/game/game';

/** A stage with the full rig and no 3D: the machine's drawing is stubbed, the game and the history are the real ones. */
function stage(): BuildStage {
  const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({
    clientWidth: 400,
    clientHeight: 800,
  });
  s['_machine'] = {
    moving: false,
    doorOpen: false,
    frame() {},
    setOpen() {},
    closeDoor() {},
    holdDetail() {},
    lod() {},
    root: new Group(),
    boardRoots: () => [],
    caseRoots: [],
    rig: () => null,
    holdBack() {},
    letRun() {},
    isHeldBack: () => false,
    panelIds: () => [],
    syncPanel() {},
  };
  s['_game'] = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true });
  s['rebuild'] = s['rebuildAll'] = function (this: {
    snaps: { drop(): void };
    board: { tier: number; caseTier: number };
  }) {
    this.snaps.drop();
    setLayoutTier(this.board.tier, Math.max(this.board.tier, this.board.caseTier));
  };
  s['playAll'] = () => Promise.resolve();
  s['door'] = () => Promise.resolve();
  return s as unknown as BuildStage;
}

const cpu = (): string => binParts().find((b) => b.kind === 'cpu')!.id;

// (each test of the file: the stage's browser hooks)
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

describe('the empty start', () => {
  it('is nothing: no case, no board, no part', async () => {
    const s = stage();
    expect(s.shown.peek()).toBe('machine');
    expect(s.bare.peek()).toBe(false);
    await s.clear();
    expect(s.shown.peek()).toBe('nothing');
    expect(s.bare.peek()).toBe(true);
    expect(s.board.devices).toHaveLength(0);
    expect(s.canUndo).toBe(true);
  });

  it('takes no board and no part until a case is in: a refusal says why, and nothing changes', async () => {
    const s = stage();
    await s.clear();
    const past = s.canUndo;
    await s.fit(cpu());
    expect(s.refusal.peek()?.text).toMatch(/Fit a case first/);
    await s.fit('board1');
    expect(s.refusal.peek()?.text).toMatch(/Fit a case first/);
    expect(s.board.devices).toHaveLength(0);
    expect(s.shown.peek()).toBe('nothing');
    expect(s.canUndo).toBe(past);
    // (a drop has nothing to land on, but a case has the stage itself)
    expect(s.dropTarget(cpu())).toBeNull();
    expect(s.dropTarget('board1')).toBeNull();
    expect(s.dropTarget('case2')).toBe('case2');
  });

  it('brings a case in from the shelf: a bare case, with no board in it, of the tier asked', async () => {
    const s = stage();
    await s.clear();
    await s.fit('case0');
    expect(s.refusal.peek()).toBeNull();
    expect(s.shown.peek()).toBe('case');
    expect(s.bare.peek()).toBe(true);
    expect(s.board.caseTier).toBe(0);
    expect(s.board.devices).toHaveLength(0);
    const t = stage();
    await t.clear();
    await t.fit('case2');
    expect(t.shown.peek()).toBe('case');
    expect(t.board.caseTier).toBe(2);
    expect(t.board.devices).toHaveLength(0);
  });

  it('takes no part in a bare case until a board is in: a refusal says why, and a board or a case has the PC itself to land on', async () => {
    const s = stage();
    await s.clear();
    await s.fit('case0');
    const past = s.canUndo;
    await s.fit(cpu());
    expect(s.refusal.peek()?.text).toMatch(/Fit a motherboard first/);
    expect(s.board.devices).toHaveLength(0);
    expect(s.shown.peek()).toBe('case');
    expect(s.canUndo).toBe(past);
    expect(s.dropTarget(cpu())).toBeNull();
    expect(s.dropTarget('board1')).toBe('board1');
    expect(s.dropTarget('case2')).toBe('case2');
  });

  it('takes the board it holds aside as the one to lower in, and then stands as any machine', async () => {
    const s = stage();
    await s.clear();
    await s.fit('case0');
    await s.fit('board0');
    expect(s.shown.peek()).toBe('machine');
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
    await s.fit('case0');
    await s.fit('board2');
    expect(s.shown.peek()).toBe('machine');
    expect(s.board.tier).toBe(2);
    expect(s.board.caseTier).toBe(2);
  });

  it('keeps the case bare when a case is swapped, and says a case that stands is already fitted', async () => {
    const s = stage();
    await s.clear();
    await s.fit('case0');
    await s.fit('case0');
    expect(s.refusal.peek()?.text).toBe('That one is already fitted');
    await s.fit('case2');
    expect(s.shown.peek()).toBe('case');
    expect(s.board.caseTier).toBe(2);
    expect(s.board.devices).toHaveLength(0);
  });

  it('is a chain Undo takes back and Redo brings again: the machine, the bare case, nothing, then the machine before', async () => {
    const s = stage(),
      full = s.board.devices.length;
    await s.clear();
    await s.fit('case0');
    await s.fit('board0');
    expect(s.shown.peek()).toBe('machine');
    await s.undo(); // (the board out: the bare case it was)
    expect(s.shown.peek()).toBe('case');
    expect(s.board.devices).toHaveLength(0);
    expect(s.canRedo).toBe(true);
    await s.redo();
    expect(s.shown.peek()).toBe('machine');
    expect(s.board.tier).toBe(0);
    await s.undo();
    await s.undo(); // (the case out: the empty stage it was)
    expect(s.shown.peek()).toBe('nothing');
    expect(s.canUndo).toBe(true);
    await s.redo();
    expect(s.shown.peek()).toBe('case');
    await s.undo();
    expect(s.shown.peek()).toBe('nothing');
    await s.undo(); // (the start itself: the machine that was here)
    expect(s.shown.peek()).toBe('machine');
    expect(s.board.devices).toHaveLength(full);
    expect(s.canUndo).toBe(false);
  });

  it('puts the stage back as it was after a case, a case swap and a board', async () => {
    const s = stage();
    await s.clear();
    await s.fit('case1');
    expect(s.board.caseTier).toBe(1);
    await s.fit('case2');
    expect(s.board.caseTier).toBe(2);
    await s.fit('board2');
    expect(s.shown.peek()).toBe('machine');
    await s.undo(); // (the bare Full tower)
    expect(s.shown.peek()).toBe('case');
    expect(s.board.caseTier).toBe(2);
    await s.undo(); // (the bare Micro)
    expect(s.shown.peek()).toBe('case');
    expect(s.board.caseTier).toBe(1);
    await s.undo(); // (nothing)
    expect(s.shown.peek()).toBe('nothing');
  });

  it('is left by a preset, a saved build or the full rig', async () => {
    const s = stage();
    await s.clear();
    await s.buildPreset(BUILD_PRESETS[0]!);
    expect(s.shown.peek()).toBe('machine');
    expect(s.board.devices.length).toBeGreaterThan(0);
    await s.clear();
    await s.reset();
    expect(s.shown.peek()).toBe('machine');
    await s.clear();
    await s.loadLayout({ caseTier: 0, boardTier: 0, parts: [] }, 'x');
    expect(s.shown.peek()).toBe('machine');
  });

  it('does not count what the game holds aside: the stage has no layout of its own to save', async () => {
    const s = stage();
    await s.clear();
    expect(s.layout.parts).toHaveLength(0);
  });

  it('has no side panel to open with no case, and no picture to take', async () => {
    const s = stage();
    await s.clear();
    s.openInside(true);
    expect(s.insideOpen).toBe(false);
    expect(await s.capture(320, 240)).toBeNull();
  });
});

/** A Mini tower on a Starter board, its OS on the SSD in the cage, its fans on the case's mounts and the cooler's. */
const SMALL = {
  caseTier: 0,
  boardTier: 0,
  parts: [
    { spec: 'cpu2', slot: 'cpu0' },
    { spec: 'cooler1', slot: 'cooler0' },
    { spec: 'fan120', slot: 'cooler0.fan0' },
    { spec: 'fan120', slot: 'cooler0.fan1' },
    { spec: 'ram1b', slot: 'dimm0' },
    { spec: 'ssd1', slot: 'sata0' },
    { spec: 'display0', slot: 'display0' },
    { spec: 'fan92', slot: 'front0' },
    { spec: 'fan92', slot: 'front1' },
    { spec: 'psu1', slot: 'atx0' },
  ],
  os: 1,
};

/** The parts the case holds, not the board (the supply, the drives in the cage, the monitor, the radiator, the fans on the case's mounts), with their ids. */
function caseParts(g: Game): string[] {
  return g.board.devices
    .filter((d) => {
      const { kind } = deviceSpec(d);
      return (
        ['psu', 'display', 'radiator'].includes(kind) ||
        d.slot.startsWith('sata') ||
        (kind === 'fan' && fanHost(d.slot) === null)
      );
    })
    .map((d) => `${d.id}:${d.spec}@${d.slot}`)
    .toSorted();
}

/** Each part by spec and slot, whatever its id. */
const fittedParts = (g: Game): string[] => g.board.devices.map((d) => `${d.spec}@${d.slot}`).toSorted();

describe('a new case on a machine', () => {
  it('moves the parts the case holds with it: the same ids, the drive in the cage with its files, and its OS', async () => {
    const s = stage();
    await s.loadLayout(SMALL, 'small');
    const { game } = s,
      held = caseParts(game),
      parts = fittedParts(game),
      os = { ...game.os },
      drive = String(game.os?.deviceId),
      disk = game.disks.get(drive);
    expect(game.board.devices.find((d) => d.id === drive)?.slot).toBe('sata0');
    expect(disk).toBeDefined();
    expect(held).toHaveLength(5);
    await s.fit('case1');
    expect(s.refusal.peek()).toBeNull();
    expect(s.board.caseTier).toBe(1);
    expect(s.shown.peek()).toBe('machine');
    expect(caseParts(s.game)).toStrictEqual(held);
    expect(s.game.disks.get(drive)).toBe(disk);
    expect(s.game.os).toStrictEqual(os);
    // (the parts on the board came out and are all in their slots again)
    expect(fittedParts(s.game)).toStrictEqual(parts);
  });

  it('says on the hint line why the game refuses a case with no mounts for the radiator, and the radiator stays where it is', async () => {
    const s = stage();
    await s.loadLayout({ caseTier: 1, boardTier: 0, parts: [{ spec: 'rad1', slot: 'rad-top' }] }, 'radiator');
    const held = caseParts(s.game);
    expect(fittedParts(s.game)).toStrictEqual(['rad1@rad-top']);
    await s.fit('case0');
    expect(String(s.refusal.peek()?.text)).toMatch(/^Cannot fit it: .*no top fan mounts/u);
    expect(s.board.caseTier).toBe(1);
    expect(caseParts(s.game)).toStrictEqual(held);
  });
});
