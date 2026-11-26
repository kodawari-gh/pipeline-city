// The showcase viewer's first picture of a part (docs/render/load.md "The Gallery's first open"): its programs link before the draw, the page
// alive; nothing is drawn until they have, a new part or a restored context waits again, and the first use of the programs comes before the draw.
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { mountViewer } from './viewer';
import type * as viewerTypes from './viewer';
import type * as initTypes from './init';

const rig = vi.hoisted(() => ({
  ready: false,
  depthReady: true,
  render: vi.fn<() => void>(),
  started: vi.fn<(...a: unknown[]) => void>(),
  depth: vi.fn<(...a: unknown[]) => void>(),
  used: vi.fn<() => void>(),
  restored: null as null | (() => void),
  frame: null as null | ((now: number) => void),
}));

// (the renderer and the light probe are stand-ins with only the parts the viewer reaches, not three's classes: the module type is left open)
vi.mock<object>(import('three'), async (orig) => {
  const actual = await orig();
  class WebGLRenderer {
    domElement = {
      style: { setProperty: noop },
      width: 400,
      height: 300,
      addEventListener: (k: string, f: () => void) => {
        if (k === 'webglcontextrestored') {
          rig.restored = f;
        }
      },
      removeEventListener: noop,
    };
    shadowMap = { enabled: false, type: 0 };
    outputColorSpace = '';
    toneMapping = 0;
    toneMappingExposure = 1;
    setPixelRatio = noop;
    setSize = noop;
    render = rig.render;
  }
  const PMREMGenerator = vi.fn<typeof pmremStandIn>(pmremStandIn);
  return { ...actual, WebGLRenderer, PMREMGenerator };
});
vi.mock(import('./init'), async (orig) => ({
  ...(await orig()),
  studioEnv: vi.fn<typeof initTypes.studioEnv>(),
  restoreStudioEnv: vi.fn<typeof initTypes.restoreStudioEnv>(),
  trackRender: vi.fn<typeof initTypes.trackRender>(),
  disposeRenderContext: vi.fn<typeof initTypes.disposeRenderContext>(),
}));
vi.mock(import('./compile'), async (orig) => ({
  ...(await orig()),
  /** One program that links when the test says so, and counts its first use. */
  startPrograms: (...a: unknown[]) => {
    rig.started(...a);
    return [{ isReady: () => rig.ready, getUniforms: rig.used }];
  },
  /** One depth program of the shadows, that links when the test says so. */
  startShadowPrograms: (...a: unknown[]) => {
    rig.depth(...a);
    return [{ isReady: () => rig.depthReady }];
  },
}));

/** A stand-in that does nothing. */
function noop(): void {
  // (nothing to do)
}
/** The light probe's stand-in, made with `new` as the class is. */
function pmremStandIn(): { dispose: () => void } {
  return { dispose: noop };
}
const isElement = (x: unknown): x is HTMLElement => typeof x === 'object' && x !== null && 'appendChild' in x;
/** The viewer's host element: one that takes the canvas, 400 by 300. */
function host(): HTMLElement {
  const el: unknown = { appendChild: noop, clientWidth: 400, clientHeight: 300 };
  assert(isElement(el));
  return el;
}

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const TICK = 17; // ms; a little over 1/60 s, so the frame gate lets every tick pass
const part = () => new Mesh(new BoxGeometry(10, 10, 10), new MeshStandardMaterial());

describe('mountViewer, the first picture of a part', () => {
  let viewer: viewerTypes.Viewer, clock: number;
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      clock += TICK;
      must(rig.frame)(clock);
    }
  };

  beforeEach(() => {
    rig.ready = false;
    rig.depthReady = true;
    rig.render.mockClear();
    rig.started.mockClear();
    rig.depth.mockClear();
    rig.used.mockClear();
    rig.restored = null;
    rig.frame = null;
    clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ createRadialGradient: () => ({ addColorStop: noop }), fillRect: noop }),
      }),
    });
    vi.stubGlobal('requestAnimationFrame', (f: (now: number) => void) => {
      rig.frame = f;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', noop);
    viewer = mountViewer(host());
    viewer.setObject(part());
  });
  afterEach(() => {
    viewer?.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('draws nothing while the programs link, starts them once, and draws when they have linked', () => {
    tick(30);
    expect(rig.render).not.toHaveBeenCalled();
    expect(rig.started).toHaveBeenCalledOnce();
    rig.ready = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledOnce();
    expect(rig.started).toHaveBeenCalledOnce();
    // (the viewer draws to the canvas, tone mapped: the programs are made for that, or the draw would link its own)
    expect(must(rig.started.mock.calls[0])[3]).toStrictEqual({ toCanvas: true });
  });

  it('waits for the depth programs of the shadows too, started with the same scene (the key light casts)', () => {
    rig.ready = true;
    rig.depthReady = false;
    tick(10);
    expect(rig.render).not.toHaveBeenCalled();
    expect(rig.depth).toHaveBeenCalledOnce();
    expect(must(rig.depth.mock.calls[0])[1]).toBe(must(rig.started.mock.calls[0])[1]);
    rig.depthReady = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledOnce();
  });

  it('makes the first use of the programs only once they have linked, and before the draw (no upload is queued then)', () => {
    tick(10);
    expect(rig.used).not.toHaveBeenCalled(); // (a first use of a program that links still would wait for its link)
    rig.ready = true;
    tick(1);
    expect(rig.used).toHaveBeenCalledOnce();
    expect(rig.used.mock.invocationCallOrder[0]).toBeLessThan(must(rig.render.mock.invocationCallOrder[0]));
  });

  it('draws at the first tick when the programs have linked already (the driver kept them)', () => {
    rig.ready = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledOnce();
  });

  it('draws anyway when the link takes too long, and the page is not held for ever', () => {
    tick(5);
    expect(rig.render).not.toHaveBeenCalled();
    clock += 16_000;
    tick(1);
    expect(rig.render).toHaveBeenCalledOnce();
  });

  it('a new part waits for its programs again', () => {
    rig.ready = true;
    tick(2);
    expect(rig.started).toHaveBeenCalledOnce();
    rig.ready = false;
    viewer.setObject(part());
    rig.render.mockClear();
    tick(20);
    expect(rig.started).toHaveBeenCalledTimes(2);
    expect(rig.render).not.toHaveBeenCalled();
    rig.ready = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledOnce();
  });

  it('a restored context starts the programs again: the old ones are gone with the old context', () => {
    rig.ready = true;
    tick(2);
    expect(rig.started).toHaveBeenCalledOnce();
    rig.ready = false;
    must(rig.restored)();
    rig.render.mockClear();
    tick(20);
    expect(rig.started).toHaveBeenCalledTimes(2);
    expect(rig.render).not.toHaveBeenCalled();
    rig.ready = true;
    tick(1);
    expect(rig.render).toHaveBeenCalledOnce();
  });
});
