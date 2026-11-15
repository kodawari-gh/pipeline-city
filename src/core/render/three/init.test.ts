import { Scene, Texture, type PMREMGenerator, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeRenderContext, restoreStudioEnv, studioEnv } from './init';

describe('studioEnv (the studio map after a context restore)', () => {
  it('prefilters the room into a fresh texture, and a restore frees the old one before it sets the new', () => {
    const made = [new Texture(), new Texture()];
    const fromScene = vi.fn(() => ({ texture: made.shift()! }));
    const pmrem = { fromScene } as unknown as PMREMGenerator;
    const first = studioEnv(pmrem);
    expect(first).toBeInstanceOf(Texture);
    const order: string[] = [];
    const scene = new Scene();
    scene.environment = first;
    first.addEventListener('dispose', () => order.push('old'));
    restoreStudioEnv(scene, pmrem);
    expect(order).toEqual(['old']);
    expect(scene.environment).not.toBe(first);
    expect(scene.environment).toBeInstanceOf(Texture);
    expect(fromScene).toHaveBeenCalledTimes(2);
  });
});

describe('disposeRenderContext (PERF12: a closed screen keeps no WebGL context)', () => {
  it('loses the context first (the frees after it skip their GL calls), then frees the environment, the prefilter, the renderer and the canvas', () => {
    const order: string[] = [];
    const scene = new Scene(), env = new Texture();
    scene.environment = env;
    env.addEventListener('dispose', () => order.push('environment'));
    const renderer = {
      dispose: vi.fn(() => order.push('renderer')),
      forceContextLoss: vi.fn(() => order.push('context')),
      domElement: { remove: vi.fn(() => order.push('canvas')) },
    } as unknown as WebGLRenderer;
    const pmrem = { dispose: vi.fn(() => order.push('pmrem')) } as unknown as PMREMGenerator;
    disposeRenderContext({ scene, renderer, pmrem });
    expect(order).toEqual(['context', 'environment', 'pmrem', 'renderer', 'canvas']);
    expect(scene.environment).toBeNull();
  });

  it('works on a scene without an environment', () => {
    const renderer = { dispose: vi.fn(), forceContextLoss: vi.fn(), domElement: { remove: vi.fn() } } as unknown as WebGLRenderer;
    disposeRenderContext({ scene: new Scene(), renderer, pmrem: { dispose: vi.fn() } as unknown as PMREMGenerator });
    expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
  });
});
