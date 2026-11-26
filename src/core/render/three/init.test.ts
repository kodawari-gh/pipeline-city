import { Scene, Texture } from 'three';
import type * as threeTypes from 'three';
import { assert, describe, expect, it, vi } from 'vitest';
import { disposeRenderContext, restoreStudioEnv, studioEnv } from './init';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A prefilter as far as the code under test reaches into one. */
const isPmrem = (x: unknown): x is threeTypes.PMREMGenerator =>
  typeof x === 'object' && x !== null && 'fromScene' in x && 'dispose' in x;
/** A renderer as far as the code under test reaches into one. */
const isRenderer = (x: unknown): x is threeTypes.WebGLRenderer =>
  typeof x === 'object' && x !== null && 'forceContextLoss' in x && 'domElement' in x;
/** A call that pushes `name` onto `order`. */
const logs = (order: string[], name: string) => () => {
  order.push(name);
};

describe('studioEnv (the studio map after a context restore)', () => {
  it('prefilters the room into a fresh texture, and a restore frees the old one before it sets the new', () => {
    const made = [new Texture(), new Texture()];
    const fromScene = vi.fn<() => { texture: Texture }>(() => ({ texture: must(made.shift()) }));
    const pmrem = { fromScene, dispose: vi.fn<() => void>() };
    assert(isPmrem(pmrem));
    const first = studioEnv(pmrem);
    expect(first).toBeInstanceOf(Texture);
    const order: string[] = [];
    const scene = new Scene();
    scene.environment = first;
    first.addEventListener('dispose', logs(order, 'old'));
    restoreStudioEnv(scene, pmrem);
    expect(order).toStrictEqual(['old']);
    expect(scene.environment).not.toBe(first);
    expect(scene.environment).toBeInstanceOf(Texture);
    expect(fromScene).toHaveBeenCalledTimes(2);
  });
});

describe('disposeRenderContext (PERF12: a closed screen keeps no WebGL context)', () => {
  it('loses the context first (the frees after it skip their GL calls), then frees the environment, the prefilter, the renderer and the canvas', () => {
    const order: string[] = [];
    const scene = new Scene(),
      env = new Texture();
    scene.environment = env;
    env.addEventListener('dispose', logs(order, 'environment'));
    const renderer = {
      dispose: vi.fn<() => void>(logs(order, 'renderer')),
      forceContextLoss: vi.fn<() => void>(logs(order, 'context')),
      domElement: { remove: vi.fn<() => void>(logs(order, 'canvas')) },
    };
    const pmrem = { fromScene: vi.fn<() => void>(), dispose: vi.fn<() => void>(logs(order, 'pmrem')) };
    assert(isRenderer(renderer));
    assert(isPmrem(pmrem));
    disposeRenderContext({ scene, renderer, pmrem });
    expect(order).toStrictEqual(['context', 'environment', 'pmrem', 'renderer', 'canvas']);
    expect(scene.environment).toBeNull();
  });

  it('works on a scene without an environment', () => {
    const forceContextLoss = vi.fn<() => void>(),
      renderer = { dispose: vi.fn<() => void>(), forceContextLoss, domElement: { remove: vi.fn<() => void>() } },
      pmrem = { fromScene: vi.fn<() => void>(), dispose: vi.fn<() => void>() };
    assert(isRenderer(renderer));
    assert(isPmrem(pmrem));
    disposeRenderContext({ scene: new Scene(), renderer, pmrem });
    expect(forceContextLoss).toHaveBeenCalledOnce();
  });
});
