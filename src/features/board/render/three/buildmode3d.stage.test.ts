// BuildStage.frame, idle path: a still stage draws nothing, and a late meter reading can wake it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';

// the controllable parts: what the meter says, and the draws
const rig = vi.hoisted(() => ({ lum: null as number | null, render: vi.fn() }));

vi.mock('@/core/render/three/init', async (orig) => {
  const actual = await orig<typeof import('@/core/render/three/init')>();
  return {
    ...actual,
    createRenderContext: () => ({
      scene: new Scene(),
      camera: new PerspectiveCamera(30, 1, 10, 1e6),
      renderer: {
        domElement: { width: 400, height: 400, addEventListener() {}, removeEventListener() {} },
        setOpaqueSort() {}, getPixelRatio: () => 1, setSize() {}, properties: { get: () => ({}) },
      },
    }),
  };
});
vi.mock('@/core/render/three/post', () => ({
  Post: class {
    render = rig.render;
    meter = () => null;
    metered = () => rig.lum;
    setEye() {} setReach() {} apply() {} setSize() {}
  },
}));
vi.mock('./lens3d', () => ({ Lens3D: class { frame() {} } }));

import { BuildStage } from './buildmode3d';
import { BASE_EXPOSURE } from '@/core/render/three/init';

/** The reading that holds the eye at its start goal of 1 (key / lum). */
const HOLD = 0.04 / BASE_EXPOSURE; // (EYE_KEY over BASE_EXPOSURE in buildmode3d.ts)
const TICK = 17; // ms; a little over 1/60 s, so the 60 fps gate lets every tick pass

describe('BuildStage.frame when idle', () => {
  let stage: { frame: (now: number) => void };
  let now: number;
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { now += TICK; stage.frame(now); } };
  const draws = (n: number) => { rig.render.mockClear(); tick(n); return rig.render.mock.calls.length; };

  beforeEach(() => {
    rig.lum = null;
    rig.render.mockClear();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({ clientWidth: 400, clientHeight: 800 });
    s._machine = { moving: false, doorOpen: false, frame() {}, setOpen() {}, holdDetail() {}, lod() {}, root: new Group() };
    s._game = {}; // (the snapshot getter wants a game; the stub below gives the snapshot)
    s.snaps = { of: () => ({}), drop() {} };
    stage = s as unknown as { frame: (now: number) => void };
    now = 1000;
    rig.lum = HOLD;
    tick(20); // warm-up: the first ask and the eye settling
  });

  it('draws nothing when idle', () => {
    expect(draws(120)).toBe(0);
  });

  it('wakes on a late meter reading', () => {
    expect(draws(10)).toBe(0);
    rig.lum = HOLD / 2; // asks for twice the exposure: far outside the dead band
    rig.render.mockClear();
    tick(2);
    expect(rig.render).toHaveBeenCalled();
    rig.lum = HOLD / 2; // (the meter keeps its last reading)
    tick(400); // the eye settles
    expect(draws(120)).toBe(0);
  });

  it('stays idle for a reading inside the dead band', () => {
    rig.lum = HOLD * 1.01;
    expect(draws(60)).toBe(0);
  });
});
