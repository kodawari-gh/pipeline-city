// The stage takes the network from the shelf (`BuildStage.fit` of an OS, a router or an internet plan; `removeNet`): each goes in the room, not in a socket, replaces the one of
// its kind, shows in the snapshot, and Undo and Redo set the one that was there.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';

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

import { BuildStage, binParts } from './buildmode3d';
import { setLayoutTier } from '../layout/layout';
import { Game } from '@/worker/game/game';

/** A stage with the full rig and no 3D (the best OS, router and plan are in): the machine's drawing is stubbed, the game and the history are the real ones. */
function stage(): BuildStage {
  const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({ clientWidth: 400, clientHeight: 800 });
  s._machine = { moving: false, doorOpen: false, frame() {}, setOpen() {}, closeDoor() {}, holdDetail() {}, lod() {}, root: new Group(), boardRoots: () => [], caseRoots: [], rig: () => null, holdBack() {}, letRun() {}, isHeldBack: () => false, panelIds: () => [], syncPanel() {} };
  s._game = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true });
  s.rebuild = s.rebuildAll = function (this: { snaps: { drop(): void }; board: { tier: number; caseTier: number } }) {
    this.snaps.drop();
    setLayoutTier(this.board.tier, Math.max(this.board.tier, this.board.caseTier));
  };
  s.playAll = () => Promise.resolve();
  s.door = () => Promise.resolve();
  return s as unknown as BuildStage;
}

/** What stands: the OS, the router and the plan, by id. */
const net = (s: BuildStage) => ({ os: s.snapshot.os?.spec ?? null, router: s.snapshot.net.router?.id ?? null, isp: s.snapshot.net.isp?.id ?? null });

describe('the shelf lists the network', () => {
  it('has every OS for sale, every router and every internet plan, each with its kind and tier', () => {
    const bin = binParts();
    const ids = (k: string): string[] => bin.filter((p) => p.kind === k).map((p) => p.id);
    expect(ids('router')).toEqual(['router1', 'router2', 'router3', 'router4']);
    expect(ids('isp')).toEqual(['isp1', 'isp2', 'isp3', 'isp4', 'isp5']);
    expect(ids('os').length).toBeGreaterThanOrEqual(3);
    expect(ids('os')[0]).toBe('os1');
    expect(bin.find((p) => p.id === 'router2')).toMatchObject({ name: 'Gigabit router', tier: 2 });
  });
});

describe('the stage fits the network', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('takes any of them anywhere on the stage: a drop answers with the item itself', () => {
    const s = stage();
    for (const id of ['os1', 'router3', 'isp2']) expect(s.dropTarget(id)).toBe(id);
  });

  it('puts a router in place of the one that stands, and the snapshot says so', async () => {
    const s = stage();
    expect(net(s).router).toBe('router4');
    await s.fit('router1');
    expect(net(s).router).toBe('router1');
    expect(s.refusal.peek()).toBeNull();
    expect(s.snapshot.net.router).toMatchObject({ name: 'Home router', mbps: 100 });
  });

  it('puts an internet plan in place of the one that stands, and an OS in place of the OS', async () => {
    const s = stage();
    await s.fit('isp2');
    await s.fit('os2');
    expect(net(s)).toEqual({ os: 'os2', router: 'router4', isp: 'isp2' });
  });

  it('refuses the item that is already in place, and keeps the history as it was', async () => {
    const s = stage();
    await s.fit('router4');
    expect(s.refusal.peek()?.text).toMatch(/already in place/);
    expect(s.canUndo).toBe(false);
  });

  it('takes each out from the panel, and the machine has none of it then', async () => {
    const s = stage();
    await s.removeNet('router');
    await s.removeNet('isp');
    await s.removeNet('os');
    expect(net(s)).toEqual({ os: null, router: null, isp: null });
    expect(s.snapshot.net.state).toBe('no-device');
    // (nothing to take out: no refusal, no step)
    const n = s.canUndo;
    await s.removeNet('os');
    expect(s.canUndo).toBe(n);
  });

  it('cables a router that comes in, and a router that leaves takes the cable with it', async () => {
    const s = stage();
    await s.removeNet('router');
    expect(s.cables.lan).toBe(false);
    await s.fit('router2');
    expect(s.cables.lan).toBe(true);
    await s.removeNet('router');
    expect(s.cables.lan).toBe(false);
  });

  it('says why an OS does not go in (no drive), and leaves the stage as it was', async () => {
    const s = stage();
    await s.clear();
    await s.removeNet('os');
    await s.fit('os1');
    expect(s.refusal.peek()?.text).toMatch(/^Cannot fit Resident OS 1\.0: .*drive/i);
    expect(net(s).os).toBeNull();
  });

  it('is undone and done again, step by step', async () => {
    const s = stage();
    await s.fit('router1');
    await s.removeNet('isp');
    await s.fit('os1');
    expect(net(s)).toEqual({ os: 'os1', router: 'router1', isp: null });
    await s.undo();
    expect(net(s)).toEqual({ os: 'os4', router: 'router1', isp: null });
    await s.undo();
    expect(net(s)).toEqual({ os: 'os4', router: 'router1', isp: 'isp5' });
    await s.undo();
    expect(net(s)).toEqual({ os: 'os4', router: 'router4', isp: 'isp5' });
    expect(s.canUndo).toBe(false);
    await s.redo();
    await s.redo();
    await s.redo();
    expect(net(s)).toEqual({ os: 'os1', router: 'router1', isp: null });
    expect(s.canRedo).toBe(false);
  });

  it('keeps an OS the player took out off the drive when a later part fits (the game puts back only an OS whose drive left)', async () => {
    const s = stage();
    await s.removeNet('os');
    await s.fit('ram0');
    expect(net(s).os).toBeNull();
  });
});

describe('the Wall camera preset', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('frames the wall\'s plates and router, not the whole machine: nearer, higher, to the west, nearly head on', () => {
    const s = stage() as unknown as { preset(name: string): void; resetView(): void; goal: { x: number; y: number; height: number; yaw: number } };
    s.resetView();
    const whole = { ...s.goal };
    s.preset('wall');
    expect(s.goal.height).toBeLessThan(whole.height);
    expect(s.goal.y).toBeGreaterThan(whole.y);
    expect(s.goal.x).toBeLessThan(whole.x);
    expect(Math.abs(s.goal.yaw)).toBeLessThan(0.3);
    // (the other presets take the whole machine in as they did)
    s.preset('side');
    expect(s.goal.height).toBeCloseTo(whole.height, 3);
  });
});
