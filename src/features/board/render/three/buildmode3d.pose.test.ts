// A part keeps its own turn through its motion: a fan on a case mount or a tower heatsink is built with a quarter turn, and its motion must not turn it flat.
// A card still tips as it comes out and comes level. Undo of a removal puts the fan back with the turn it had.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Box3, Group, PerspectiveCamera, Scene } from 'three';

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

import { BuildStage } from './buildmode3d';
import { setLayoutTier } from '../layout/layout';
import { coolerFanBox, coolerModel } from './cooler3d';
import { Game } from '@/worker/game/game';
import { deviceSpec } from '@/features/board/sim/board';
import { devNode } from '@/features/board/sim/removal';
import { getSpec, type FanSpec } from '@/features/board/sim/specs';
import { findById } from '@/core/render/three/pick';

/** A stage with the full rig and no 3D, as the stage opens its game (`looseFit`): the machine's drawing is stubbed, the game and the history are the real ones. `playAll` is the real one. */
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
  s['door'] = () => Promise.resolve();
  return s as unknown as BuildStage;
}

/** The stage's private members (the motion's clock and its steps). */
const hid = (s: BuildStage) => s as unknown as Record<string, any>;

/**
 * Plays a motion to its end: the stage's own clock is the animation frame, which the test does not run, so a timer steps the motion by hand (0.05 s a step)
 * and `onTick` sees each step. Resolves when `work` does.
 */
async function pump(s: BuildStage, work: Promise<unknown>, onTick?: () => void): Promise<void> {
  const timer = setInterval(() => {
    const h = hid(s);
    if (h['anim']) {
      h['step'](0.05);
      onTick?.();
    }
  }, 1);
  try {
    await work;
  } finally {
    clearInterval(timer);
  }
}

const of = (s: BuildStage, kind: string) => s.board.devices.filter((d) => deviceSpec(d).kind === kind);

describe('a part keeps its own turn through its motion', () => {
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

  it('a fan with a quarter turn keeps it while it comes in', async () => {
    const s = stage();
    const o = new Group();
    o.rotation.y = Math.PI / 2;
    o.position.set(100, 200, 300);
    const turns: number[] = [];
    const tick = () => turns.push(o.rotation.y);
    await pump(s, hid(s)['playAll']([o], 'fan', 'in'), tick);
    expect(turns.length).toBeGreaterThan(0);
    for (const y of turns) expect(y).toBeCloseTo(Math.PI / 2, 5);
    expect(o.rotation.y).toBeCloseTo(Math.PI / 2, 5);
    expect(o.position.x).toBeCloseTo(100, 5);
    expect(o.position.y).toBeCloseTo(200, 5);
    expect(o.position.z).toBeCloseTo(300, 5);
  });

  it('a fan with a quarter turn keeps it when it goes out, and ends hidden', async () => {
    const s = stage();
    const o = new Group();
    o.rotation.y = Math.PI / 2;
    o.position.set(100, 200, 300);
    await pump(s, hid(s)['playAll']([o], 'fan', 'out'));
    expect(o.visible).toBe(false);
    expect(o.rotation.y).toBeCloseTo(Math.PI / 2, 5);
  });

  it('the fans on the two ends of a tower heatsink end inside their spots, edge-on to the fins, after a motion in and a motion out', async () => {
    setLayoutTier(3, 3);
    const s = stage();
    const fans = [0, 1].map((k) => ({ id: `d-${k}`, slot: `cooler0.fan${k}`, spec: getSpec('fan120') as FanSpec }));
    const m = coolerModel('cooler-tower', fans);
    const proud = 32; // (the fan's light stands a little proud of its face)
    for (const [k, f] of fans.entries()) {
      const o = findById(m.root, f.id)!,
        spot = coolerFanBox('cooler-tower', k)!;
      // in: it ends at its seat, in its spot (a fan laid flat is 2760 wide along x and 600 thin along z: out of the spot on both)
      await pump(s, hid(s)['playAll']([o], 'fan', 'in'));
      let c = new Box3().setFromObject(o, true);
      expect(c.min.x, `${f.slot} in`).toBeGreaterThanOrEqual(spot.r.x - proud);
      expect(c.max.x, `${f.slot} in`).toBeLessThanOrEqual(spot.r.x + spot.r.w + proud);
      expect(c.min.z, `${f.slot} in`).toBeGreaterThanOrEqual(spot.z0 - proud);
      expect(c.max.z, `${f.slot} in`).toBeLessThanOrEqual(spot.z1 + proud);
      // out: it leaves along z (hidden where its way ends) and is still as thin along x as its spot
      await pump(s, hid(s)['playAll']([o], 'fan', 'out'));
      c = new Box3().setFromObject(o, true);
      expect(c.min.x, `${f.slot} out`).toBeGreaterThanOrEqual(spot.r.x - proud);
      expect(c.max.x, `${f.slot} out`).toBeLessThanOrEqual(spot.r.x + spot.r.w + proud);
    }
  });

  it('a card still tips as it comes out, and comes level', async () => {
    const s = stage();
    const o = new Group();
    o.rotation.y = 0;
    const tips: number[] = [];
    const tick = () => tips.push(Math.abs(o.rotation.y));
    await pump(s, hid(s)['playAll']([o], 'gpu', 'out'), tick);
    const peak = Math.max(...tips);
    expect(peak).toBeGreaterThan(0.02);
    expect(peak).toBeLessThanOrEqual(0.0701);
    expect(o.rotation.y).toBeCloseTo(0, 5);
  });

  it('Undo of a removal puts a fan back with its turn', async () => {
    const s = stage();
    await pump(
      s,
      (async () => {
        await s.clear();
        for (const part of ['case1', 'board1', 'psu1', 'cpu1', 'cooler0', 'ram0']) await s.fit(part);
        await s.fit('fan92', 'front0');
      })(),
    );
    const fan = of(s, 'fan')[0]!;
    expect(fan).toBeDefined();
    // the fan's built object, turned a quarter as a case mount is built
    const g = new Group();
    g.userData['id'] = fan.id;
    g.rotation.y = Math.PI / 2;
    hid(s)['_machine'].root.add(g);
    await pump(s, s.remove(devNode(fan.id)));
    expect(of(s, 'fan')).toHaveLength(0);
    await pump(s, s.undo());
    expect(of(s, 'fan')).toHaveLength(1);
    expect(g.rotation.y).toBeCloseTo(Math.PI / 2, 5);
    expect(g.visible).toBe(true);
  });
});
