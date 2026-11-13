import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, type Object3D } from 'three';
import { Monitor } from './props3d';

/** The monitor's face: the box of its screen, a basic material. */
const faceOf = (root: Object3D): MeshBasicMaterial => {
  let face: MeshBasicMaterial | null = null;
  root.traverse((o) => { if (!face && (o as Mesh).isMesh && (o as Mesh).geometry instanceof BoxGeometry && (o as Mesh).material instanceof MeshBasicMaterial) face = (o as Mesh).material as MeshBasicMaterial; });
  if (!face) throw new Error('no face');
  return face;
};

// a canvas whose 2D context takes any call
const ctx: unknown = new Proxy(function () {}, { get: () => ctx, apply: () => ctx });
const cv = () => ({ width: 1280, height: 720, getContext: () => ctx }) as unknown as HTMLCanvasElement;

describe('Monitor face tone mapping', () => {
  it('is not tone mapped by default (the shop showcase), and is when the game room asks for it', () => {
    const shop = new Monitor({ x: 0, y: 0, w: 1000, h: 600 }, { x: 50, y: 50, w: 900, h: 500 }, 700, 0);
    expect(faceOf(shop.root).toneMapped).toBe(false);
    const room = new Monitor({ x: 0, y: 0, w: 1000, h: 600 }, { x: 50, y: 50, w: 900, h: 500 }, 700, 0, { toneMapped: true });
    expect(faceOf(room.root).toneMapped).toBe(true);
  });
});

describe('Monitor.useLive', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uploads the live canvas only when it was drawn again', () => {
    vi.stubGlobal('document', { createElement: cv });
    const m = new Monitor({ x: 0, y: 0, w: 1000, h: 600 }, { x: 50, y: 50, w: 900, h: 500 }, 700, 0);
    const canvas = cv(), version = () => (m as unknown as { liveTex: { version: number } }).liveTex.version;
    m.useLive({ canvas, w: 900, h: 500, rev: 1 });
    const v = version(); // (a texture's `version` rises with each upload it asks for)
    m.useLive({ canvas, w: 900, h: 500, rev: 1 });
    expect(version()).toBe(v);
    m.useLive({ canvas, w: 900, h: 500, rev: 2 });
    expect(version()).toBe(v + 1);
  });

  // a missed upload freezes the monitor
  const setup = () => {
    vi.stubGlobal('document', { createElement: cv });
    const m = new Monitor({ x: 0, y: 0, w: 1000, h: 600 }, { x: 50, y: 50, w: 900, h: 500 }, 700, 0);
    return { m, version: () => (m as unknown as { liveTex: { version: number } }).liveTex.version };
  };

  it('uploads when the size changes with the same rev', () => {
    const { m, version } = setup(), canvas = cv();
    m.useLive({ canvas, w: 900, h: 500, rev: 1 });
    const v = version();
    m.useLive({ canvas, w: 800, h: 450, rev: 1 });
    expect(version()).toBe(v + 1);
  });

  it('shows a new canvas with the same rev', () => {
    const { m, version } = setup();
    m.useLive({ canvas: cv(), w: 900, h: 500, rev: 1 });
    const first = (m as unknown as { liveTex: unknown }).liveTex, canvas = cv();
    m.useLive({ canvas, w: 900, h: 500, rev: 1 });
    const tex = (m as unknown as { liveTex: { image: unknown } }).liveTex;
    expect(tex).not.toBe(first);
    expect(tex.image).toBe(canvas);
    expect(version()).toBeGreaterThan(0);
  });

  it('uploads at every call when rev is undefined', () => {
    const { m, version } = setup(), canvas = cv();
    m.useLive({ canvas, w: 900, h: 500 });
    const v = version();
    m.useLive({ canvas, w: 900, h: 500 });
    expect(version()).toBe(v + 1);
    m.useLive({ canvas, w: 900, h: 500 });
    expect(version()).toBe(v + 2);
  });

  it('uploads when the monitor goes off and on again with the same canvas', () => {
    const { m, version } = setup(), canvas = cv();
    m.useLive({ canvas, w: 900, h: 500, rev: 1 });
    const v = version();
    m.useLive(null);
    m.useLive({ canvas, w: 900, h: 500, rev: 1 });
    expect(version()).toBeGreaterThan(v);
  });
});
