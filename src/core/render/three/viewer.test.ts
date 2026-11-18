// The showcase viewer's first picture of a part (docs/render/load.md "The Gallery's first open"): its programs link before the draw, the page
// alive; nothing is drawn until they have, a new part or a restored context waits again, and the first use of the programs comes before the draw.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';

const rig = vi.hoisted(() => ({ ready: false, depthReady: true, render: vi.fn(), started: vi.fn(), depth: vi.fn(), used: vi.fn(), restored: null as null | (() => void), frame: null as null | ((now: number) => void) }));

vi.mock('three', async (orig) => {
  const actual = await orig<typeof import('three')>();
  class WebGLRenderer {
    domElement = {
      style: {}, width: 400, height: 300,
      addEventListener: (k: string, f: () => void) => { if (k === 'webglcontextrestored') rig.restored = f; },
    };
    shadowMap = { enabled: false, type: 0 };
    outputColorSpace = ''; toneMapping = 0; toneMappingExposure = 1;
    setPixelRatio() {} setSize() {}
    render = rig.render;
  }
  class PMREMGenerator { dispose() {} }
  return { ...actual, WebGLRenderer, PMREMGenerator };
});
vi.mock('./init', async (orig) => ({ ...(await orig<typeof import('./init')>()), studioEnv: () => null, restoreStudioEnv() {}, trackRender() {}, disposeRenderContext() {} }));
vi.mock('./compile', async (orig) => ({
  ...(await orig<typeof import('./compile')>()),
  /** One program that links when the test says so, and counts its first use. */
  startPrograms: (...a: unknown[]) => { rig.started(...a); return [{ isReady: () => rig.ready, getUniforms: rig.used }]; },
  /** One depth program of the shadows, that links when the test says so. */
  startShadowPrograms: (...a: unknown[]) => { rig.depth(...a); return [{ isReady: () => rig.depthReady }]; },
}));

import { mountViewer, type Viewer } from './viewer';

const TICK = 17; // ms; a little over 1/60 s, so the frame gate lets every tick pass
const part = () => new Mesh(new BoxGeometry(10, 10, 10), new MeshStandardMaterial());

describe('mountViewer, the first picture of a part', () => {
  let viewer: Viewer, clock: number;
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { clock += TICK; rig.frame!(clock); } };

  beforeEach(() => {
    rig.ready = false; rig.depthReady = true;
    rig.render.mockClear(); rig.started.mockClear(); rig.depth.mockClear(); rig.used.mockClear();
    rig.restored = null; rig.frame = null;
    clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) });
    vi.stubGlobal('requestAnimationFrame', (f: (now: number) => void) => { rig.frame = f; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    viewer = mountViewer({ appendChild() {}, clientWidth: 400, clientHeight: 300 } as unknown as HTMLElement);
    viewer.setObject(part());
  });
  afterEach(() => { viewer?.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('draws nothing while the programs link, starts them once, and draws when they have linked', () => {
    tick(30);
    expect(rig.render).not.toHaveBeenCalled();
    expect(rig.started).toHaveBeenCalledTimes(1);
    rig.ready = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledTimes(1);
    expect(rig.started).toHaveBeenCalledTimes(1);
    // (the viewer draws to the canvas, tone mapped: the programs are made for that, or the draw would link its own)
    expect(rig.started.mock.calls[0]![3]).toEqual({ toCanvas: true });
  });

  it('waits for the depth programs of the shadows too, started with the same scene (the key light casts)', () => {
    rig.ready = true;
    rig.depthReady = false;
    tick(10);
    expect(rig.render).not.toHaveBeenCalled();
    expect(rig.depth).toHaveBeenCalledTimes(1);
    expect(rig.depth.mock.calls[0]![1]).toBe(rig.started.mock.calls[0]![1]);
    rig.depthReady = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledTimes(1);
  });

  it('makes the first use of the programs only once they have linked, and before the draw (no upload is queued then)', () => {
    tick(10);
    expect(rig.used).not.toHaveBeenCalled(); // (a first use of a program that links still would wait for its link)
    rig.ready = true;
    tick(1);
    expect(rig.used).toHaveBeenCalledTimes(1);
    expect(rig.used.mock.invocationCallOrder[0]).toBeLessThan(rig.render.mock.invocationCallOrder[0]!);
  });

  it('draws at the first tick when the programs have linked already (the driver kept them)', () => {
    rig.ready = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledTimes(1);
  });

  it('draws anyway when the link takes too long, and the page is not held for ever', () => {
    tick(5);
    expect(rig.render).not.toHaveBeenCalled();
    clock += 16000;
    tick(1);
    expect(rig.render).toHaveBeenCalledTimes(1);
  });

  it('a new part waits for its programs again', () => {
    rig.ready = true;
    tick(2);
    expect(rig.started).toHaveBeenCalledTimes(1);
    rig.ready = false;
    viewer.setObject(part());
    rig.render.mockClear();
    tick(20);
    expect(rig.started).toHaveBeenCalledTimes(2);
    expect(rig.render).not.toHaveBeenCalled();
    rig.ready = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledTimes(1);
  });

  it('a restored context starts the programs again: the old ones are gone with the old context', () => {
    rig.ready = true;
    tick(2);
    expect(rig.started).toHaveBeenCalledTimes(1);
    rig.ready = false;
    rig.restored!();
    rig.render.mockClear();
    tick(20);
    expect(rig.started).toHaveBeenCalledTimes(2);
    expect(rig.render).not.toHaveBeenCalled();
    rig.ready = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledTimes(1);
  });
});
