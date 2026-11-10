import { Scene, Texture, type PMREMGenerator, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeRenderContext } from './init';

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
