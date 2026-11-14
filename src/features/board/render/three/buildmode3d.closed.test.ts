// A closed BuildStage (PERF12 lets go of its game and machine): a late call from the UI or a timer does nothing and does not throw.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';

vi.mock('@/core/render/three/init', async (orig) => {
  const actual = await orig<typeof import('@/core/render/three/init')>();
  return {
    ...actual,
    createRenderContext: () => ({
      scene: new Scene(),
      camera: new PerspectiveCamera(30, 1, 10, 1e6),
      pmrem: { dispose() {} },
      renderer: {
        domElement: { width: 400, height: 400, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }), remove() {} },
        setOpaqueSort() {}, getPixelRatio: () => 1, setSize() {}, properties: { get: () => ({}) }, forceContextLoss() {}, dispose() {},
      },
    }),
  };
});
vi.mock('@/core/render/three/post', () => ({
  Post: class { render() {} meter = () => null; metered = () => null; setEye() {} setReach() {} apply() {} setSize() {} dispose() {} },
}));
vi.mock('./lens3d', () => ({ Lens3D: class { frame() {} dispose() {} } }));

import { BuildStage } from './buildmode3d';

type Closed = { runBenchmark(): Promise<void>; plan(n: string): string[]; partAt(x: number, y: number): string | null; slotAt(x: number, y: number): string | null; dispose(): void; benching: { value: unknown } };

describe('a closed BuildStage', () => {
  let stage: Closed;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('window', {}); // (the dev build's `__build` hook)
    const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({ clientWidth: 400, clientHeight: 800 });
    s._machine = { moving: false, doorOpen: true, frame() {}, setOpen() {}, holdDetail() {}, lod() {}, root: new Group(), boardRoots: () => [], dispose() {} };
    s._game = {};
    s.snaps = { of: () => ({}), drop() {} };
    stage = s as unknown as Closed;
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('answers a benchmark, a plan and a pointer query with nothing, whether or not its game is gone', async () => {
    stage.dispose();
    for (const freed of [false, true]) {
      if (freed) vi.runAllTimers(); // (the second half of the close lets go of the game and the machine)
      await expect(stage.runBenchmark()).resolves.toBeUndefined();
      expect(stage.benching.value).toBeNull();
      expect(stage.plan('dev:cpu0')).toEqual([]);
      expect(stage.partAt(10, 10)).toBeNull();
      expect(stage.slotAt(10, 10)).toBeNull();
    }
  });
});
