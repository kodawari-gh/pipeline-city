import { afterEach, assert, describe, expect, it, vi } from 'vitest';
import { Texture } from 'three';
import { Monitor } from './props3d';

// a canvas whose 2D context takes any call
const ctx: unknown = new Proxy(
  () => {
    // takes any call, and answers with itself
  },
  { get: () => ctx, apply: () => ctx },
);

/** Whether a stub stands in for a canvas (it has the size and the context the monitor asks for). */
const isCanvas = (o: unknown): o is HTMLCanvasElement => typeof o === 'object' && o !== null && 'getContext' in o;

const cv = (): HTMLCanvasElement => {
  const c = { width: 1280, height: 720, getContext: () => ctx };
  assert(isCanvas(c), 'the stub stands in for a canvas');
  return c;
};

/** The monitor's live texture (it keeps it to itself). */
function liveTexOf(m: Monitor): Texture {
  const tex: unknown = new Map<string, unknown>(Object.entries(m)).get('liveTex');
  assert.instanceOf(tex, Texture);
  return tex;
}

// a missed upload freezes the monitor
const setup = () => {
  vi.stubGlobal('document', { createElement: cv });
  const m = new Monitor({ x: 0, y: 0, w: 1000, h: 600 }, { x: 50, y: 50, w: 900, h: 500 }, 700, 0);
  return { m, version: () => liveTexOf(m).version };
};

describe('Monitor.useLive', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uploads the live canvas only when it was drawn again', () => {
    vi.stubGlobal('document', { createElement: cv });
    const m = new Monitor({ x: 0, y: 0, w: 1000, h: 600 }, { x: 50, y: 50, w: 900, h: 500 }, 700, 0);
    const canvas = cv(),
      version = () => liveTexOf(m).version;
    m.useLive({ canvas, w: 900, h: 500, rev: 1 });
    const v = version(); // (a texture's `version` rises with each upload it asks for)
    m.useLive({ canvas, w: 900, h: 500, rev: 1 });
    expect(version()).toBe(v);
    m.useLive({ canvas, w: 900, h: 500, rev: 2 });
    expect(version()).toBe(v + 1);
  });

  it('uploads when the size changes with the same rev', () => {
    const { m, version } = setup(),
      canvas = cv();
    m.useLive({ canvas, w: 900, h: 500, rev: 1 });
    const v = version();
    m.useLive({ canvas, w: 800, h: 450, rev: 1 });
    expect(version()).toBe(v + 1);
  });

  it('shows a new canvas with the same rev', () => {
    const { m, version } = setup();
    m.useLive({ canvas: cv(), w: 900, h: 500, rev: 1 });
    const first = liveTexOf(m),
      canvas = cv();
    m.useLive({ canvas, w: 900, h: 500, rev: 1 });
    const tex = liveTexOf(m);
    expect(tex).not.toBe(first);
    expect(tex.image).toBe(canvas);
    expect(version()).toBeGreaterThan(0);
  });

  it('uploads at every call when rev is undefined', () => {
    const { m, version } = setup(),
      canvas = cv();
    m.useLive({ canvas, w: 900, h: 500 });
    const v = version();
    m.useLive({ canvas, w: 900, h: 500 });
    expect(version()).toBe(v + 1);
    m.useLive({ canvas, w: 900, h: 500 });
    expect(version()).toBe(v + 2);
  });

  it('uploads when the monitor goes off and on again with the same canvas', () => {
    const { m, version } = setup(),
      canvas = cv();
    m.useLive({ canvas, w: 900, h: 500, rev: 1 });
    const v = version();
    m.useLive(null);
    m.useLive({ canvas, w: 900, h: 500, rev: 1 });
    expect(version()).toBeGreaterThan(v);
  });
});
