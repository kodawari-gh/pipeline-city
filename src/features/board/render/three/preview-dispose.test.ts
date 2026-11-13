// previewCase rebuilds the room and the machine: their textures must not outlive the rebuild (the shared caches may).
import { beforeAll, describe, expect, test, vi } from 'vitest';
import type { LightShadow, Mesh, Object3D, Texture } from 'three';
import { quietCanvas, maxedSnapshot, buildMachine } from './testutil';
import { Room3D } from '@/features/room/render/three/room3d';
import { disposeTree } from '@/core/render/three/geometry';
import { setLayoutTier } from '@/features/board/render/layout/layout';

// Canvases that draw nothing, so `paint` makes real CanvasTextures in Node.
// Any call returns another such proxy (gradients need `addColorStop`); the few reads the art makes are answered.
const nothing: unknown = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => nothing, set: () => true });
const context = () => new Proxy({}, {
  get: (_t, k) => (k === 'measureText' ? () => ({ width: 1, actualBoundingBoxAscent: 1, actualBoundingBoxDescent: 1 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : nothing),
  set: () => true,
});
const canvas = () => ({ width: 1, height: 1, style: {}, getContext: context, addEventListener() {}, toDataURL: () => '' });

// The stubbed `document` would start Pixi's offscreen renderer (bake.ts), which cannot run in Node: the test does not need it.
vi.mock('./bake', async (orig) => ({ ...(await orig<typeof import('./bake')>()), startBaker: () => {} }));

quietCanvas();

describe('preview rebuild frees its textures', () => {
  // Everything the test saw under a root, and which of it has been disposed.
  const tracked = new Set<{ addEventListener(t: string, f: () => void): void }>();
  const gone = new Set<unknown>();
  const track = (o: { addEventListener(t: string, f: () => void): void }) => {
    if (tracked.has(o)) return;
    tracked.add(o);
    o.addEventListener('dispose', () => gone.add(o));
  };
  const collect = (root: Object3D) => {
    root.traverse((o) => {
      const m = o as Mesh;
      const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const x of ms) for (const v of Object.values(x)) if ((v as Texture | null)?.isTexture) track(v as Texture);
      const sm = (o as { shadow?: LightShadow }).shadow?.map;
      if (sm) track(sm);
    });
  };
  const live = () => [...tracked].filter((o) => !gone.has(o)).length;

  // Kept for the whole file (each test file runs alone): Pixi's async renderer probe reads `document` after the test returns.
  beforeAll(() => {
    vi.stubGlobal('document', { createElement: (tag: string) => (tag === 'canvas' ? canvas() : { style: {}, addEventListener() {}, appendChild() {}, setAttribute() {} }) });
  });

  test('live textures stay flat across preview cycles', () => {
    const snap = maxedSnapshot();
    const counts: number[] = [];
    // one tier: the first build adds the shared, tier-sized caches and the city; later builds must add no unique textures
    setLayoutTier(0, 0);
    for (const t of [0, 0, 0]) {
      const room = new Room3D();
      const s = { ...snap, boardTier: t, caseTier: t, devices: [], cables: [], plugged: null };
      const machine = buildMachine(s, true);
      collect(room.root);
      collect(machine.root);
      const ispText = (room as unknown as { ispText: { tex: Texture } | null }).ispText;
      if (ispText) track(ispText.tex);
      // as board3d.ts rebuild() and install() free them
      room.dispose();
      disposeTree(room.root);
      machine.dispose();
      counts.push(live());
    }
    // the first build may add the shared caches and the city; every later build may add at most a couple more
    for (const c of counts.slice(1)) expect(c - counts[0]!).toBeLessThanOrEqual(2);
  }, 60000);
});
