// previewCase rebuilds the room and the machine: their textures must not outlive the rebuild (the shared caches may).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Mesh, Texture, LightShadow, Object3D } from 'three';

import { quietCanvas, maxedSnapshot, buildMachine } from './testutil';
import { Room3D } from '@/features/room/render/three/room3d';
import { disposeTree } from '@/core/render/three/geometry';
import { setLayoutTier } from '@/features/board/render/layout/layout';
import type * as bake from './bake';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is Mesh => typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a Mesh');
  }
  return o;
}

const isTexture = (o: unknown): o is Texture =>
  typeof o === 'object' && o !== null && 'isTexture' in o && o.isTexture === true;
function asTexture(o: unknown): Texture {
  if (!isTexture(o)) {
    throw new Error('expected a Texture');
  }
  return o;
}

// Canvases that draw nothing, so `paint` makes real CanvasTextures in Node.
// Any call returns another such proxy (gradients need `addColorStop`); the few reads the art makes are answered.
const nothing: unknown = new Proxy(
  () => {
    /* no-op */
  },
  {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing),
    apply: () => nothing,
    set: () => true,
  },
);
const context = () =>
  new Proxy(
    {},
    {
      get: (_t, k) =>
        k === 'measureText'
          ? () => ({ width: 1, actualBoundingBoxAscent: 1, actualBoundingBoxDescent: 1 })
          : k === 'getImageData'
            ? () => ({ data: new Uint8ClampedArray(4) })
            : nothing,
      set: () => true,
    },
  );
const canvas = () => ({
  width: 1,
  height: 1,
  style: {},
  getContext: context,
  addEventListener: () => {
    /* no-op */
  },
  toDataURL: () => '',
});

// The stubbed `document` would start Pixi's offscreen renderer (bake.ts), which cannot run in Node: the test does not need it.
vi.mock(import('./bake'), async (orig) => ({
  ...(await orig<typeof bake>()),
  startBaker: () => {
    /* no-op */
  },
}));

quietCanvas();

describe('preview rebuild frees its textures', () => {
  // Everything the test saw under a root, and which of it has been disposed.
  const tracked = new Set<object>();
  const gone = new Set<object>();
  const track = (o: object) => {
    if (tracked.has(o)) {
      return;
    }
    tracked.add(o);
    const listen = (o as { addEventListener?: (t: string, f: () => void) => void }).addEventListener;
    if (typeof listen === 'function') {
      listen.call(o, 'dispose', () => {
        gone.add(o);
      });
    }
  };
  const collect = (root: Object3D) => {
    root.traverse((o) => {
      if (!isMesh(o)) {
        return;
      }
      const m = asMesh(o);
      const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const x of ms) {
        for (const v of Object.values(x)) {
          if ((v as Texture | null)?.isTexture) {
            track(asTexture(v));
          }
        }
      }
      const sm = (o as { shadow?: LightShadow }).shadow?.map;
      if (sm) {
        track(sm);
      }
    });
  };
  const live = () => [...tracked].filter((o) => !gone.has(o)).length;

  // Kept for the whole file (each test file runs alone): Pixi's async renderer probe reads `document` after the test returns.
  beforeAll(() => {
    vi.stubGlobal('document', {
      createElement: (tag: string) =>
        tag === 'canvas'
          ? canvas()
          : {
              style: {},
              addEventListener: () => {
                /* no-op */
              },
              appendChild: () => {
                /* no-op */
              },
              setAttribute: () => {
                /* no-op */
              },
            },
    });
  });

  function assert_live_textures_stay_flat_across_preview_cycles(): void {
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
      const { ispText } = room as unknown as { ispText: { tex: Texture } | null };
      if (ispText) {
        track(ispText.tex);
      }
      // as board3d.ts rebuild() and install() free them
      room.dispose();
      disposeTree(room.root);
      machine.dispose();
      counts.push(live());
    }
    // the first build may add the shared caches and the city; every later build may add at most a couple more
    for (const c of counts.slice(1)) {
      expect(c - must(counts[0])).toBeLessThanOrEqual(2);
    }
  }

  it('live textures stay flat across preview cycles', () => {
    expect.hasAssertions();
    assert_live_textures_stay_flat_across_preview_cycles();
  }, 180_000);
});
