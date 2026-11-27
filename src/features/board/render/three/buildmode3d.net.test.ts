// The stage takes the network from the shelf (`BuildStage.fit` of an OS, a router or an internet plan): the shelf, the drop, the snapshot, the build log and
// the hint line. The rules are the session's (sim/buildsession.edits.test.ts, sim/buildnet.test.ts).
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

/** A stage with the full rig and no 3D (the best OS, router and plan are in): the machine's drawing is stubbed, the game and the history are the real ones. */
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
  s['_game'] = new Game({
    seed: 1,
    sandbox: true,
    preassembled: true,
    maxed: true,
    looseFit: true,
  });
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

/** What stands: the OS, the router and the plan, by id. */
const net = (s: BuildStage) => ({
  os: s.snapshot.os?.spec ?? null,
  router: s.snapshot.net.router?.id ?? null,
  isp: s.snapshot.net.isp?.id ?? null,
});

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

  it('takes any of them anywhere on the stage: a drop answers with the item itself', () => {
    const s = stage();
    for (const id of ['os1', 'router3', 'isp2']) expect(s.dropTarget(id)).toBe(id);
  });

  it('shows the router that came in, and says so in the build log', async () => {
    const s = stage();
    expect(net(s).router).toBe('router4');
    await s.fit('router1');
    expect(net(s).router).toBe('router1');
    expect(s.refusal.peek()).toBeNull();
    expect(s.snapshot.net.router).toMatchObject({ name: 'Home router', mbps: 100 });
    // (the build log says what went in, as words)
    expect(s.status.peek().log.at(-1)).toBe('Fit Home router');
  });

  it('says on the hint line that an item is already in place', async () => {
    const s = stage();
    await s.fit('router4');
    expect(s.refusal.peek()?.text).toMatch(/already in place/);
    expect(s.canUndo).toBe(false);
  });
});

describe('the Wall camera preset', () => {
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

  it("frames the wall's plates and router, not the whole machine: nearer, higher, to the west, nearly head on", () => {
    const s = stage() as unknown as {
      preset(name: string): void;
      resetView(): void;
      goal: { x: number; y: number; height: number; yaw: number };
    };
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
