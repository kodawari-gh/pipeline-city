// BuildStage.frame, idle path: a still stage draws nothing, and a late meter reading can wake it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';

// the controllable parts: what the meter says, and the draws
const rig = vi.hoisted(() => ({ lum: null as number | null, render: vi.fn(), refine: vi.fn(() => false) }));

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
    render = rig.render;
    refine = rig.refine;
    meter = () => null;
    metered = () => rig.lum;
    setEye() {} setReach() {} setOutlined() {} apply() {} setSize() {}
    startPrograms = () => [];
  },
}));
vi.mock('./lens3d', () => ({ Lens3D: class { frame() {} } }));

import { BuildStage } from './buildmode3d';
import { BASE_EXPOSURE } from '@/core/render/three/init';
import { setLowDetail } from '@/core/render/three/detail';

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

  it('offers each idle tick to the still view\'s refinement (the chain bounds its frames)', () => {
    rig.refine.mockClear();
    tick(5);
    expect(rig.refine.mock.calls.length).toBe(5);
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

describe('BuildStage.frame and the distance stand-ins (PHONE-01)', () => {
  const hold = vi.fn();
  let stage: { frame: (now: number) => void; status: { value: { busy: boolean; step: string; log: string[]; rev: number } } };
  let machineRoot: Group;
  let now = 1000;

  beforeEach(() => {
    hold.mockClear();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({ clientWidth: 400, clientHeight: 800 });
    machineRoot = new Group();
    s._machine = { moving: false, doorOpen: false, frame() {}, setOpen() {}, holdDetail: hold, lod() {}, root: machineRoot };
    s._game = {};
    s.snaps = { of: () => ({}), drop() {} };
    stage = s as unknown as typeof stage;
    now = 1000;
  });
  afterEach(() => { setLowDetail(false); });

  const lastHold = (): { held: unknown[]; ceil: number | undefined } => { const c = hold.mock.calls.at(-1)!; return { held: c[0] as unknown[], ceil: c[1] as number | undefined }; };

  it('High keeps every part itself from the stage\'s own zoom in, and holds nothing by hand', () => {
    setLowDetail(false);
    now += TICK; stage.frame(now);
    const { held, ceil } = lastHold();
    expect(held).toEqual([]);
    expect(ceil).toBeGreaterThan(0);
    expect(Number.isFinite(ceil)).toBe(true);
  });

  it('Low lets the stand-ins draw at any zoom, and holds the whole machine only while a step runs', () => {
    setLowDetail(true);
    now += TICK; stage.frame(now);
    expect(lastHold()).toEqual({ held: [], ceil: undefined });
    stage.status.value = { ...stage.status.value, busy: true };
    now += TICK; stage.frame(now);
    expect(lastHold()).toEqual({ held: [machineRoot], ceil: undefined });
    stage.status.value = { ...stage.status.value, busy: false };
    now += TICK; stage.frame(now);
    expect(lastHold().held).toEqual([]);
  });
});

describe('BuildStage.frame and the shut side panel', () => {
  it('lets the panel take a click while no step plays, and not while one does (machine3d.ts: the plate over it answers a ray only then)', () => {
    const setOpen = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({ clientWidth: 400, clientHeight: 800 });
    s._machine = { moving: false, doorOpen: false, frame() {}, setOpen, holdDetail() {}, lod() {}, root: new Group() };
    s._game = {};
    s.snaps = { of: () => ({}), drop() {} };
    const stage = s as unknown as { frame: (now: number) => void; status: { value: { busy: boolean; step: string; log: string[]; rev: number } } };
    stage.frame(1000 + TICK);
    expect(setOpen).toHaveBeenLastCalledWith(false, false);
    stage.status.value = { ...stage.status.value, busy: true };
    stage.frame(1000 + 2 * TICK);
    expect(setOpen).toHaveBeenLastCalledWith(false, true);
  });
});
