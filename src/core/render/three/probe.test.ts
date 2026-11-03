import { describe, expect, it } from 'vitest';
import { Scene, WebGLCoordinateSystem, type WebGLRenderer } from 'three';
import { Probe } from './probe';

/** A renderer that only records the faces drawn into a target. */
function stub() {
  const faces: number[] = [];
  let face = 0;
  const r = {
    coordinateSystem: WebGLCoordinateSystem,
    getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    setRenderTarget: (t: unknown, f = 0) => { face = t ? f : -1; },
    render: () => { faces.push(face); },
  };
  return { r: r as unknown as WebGLRenderer, faces };
}

describe('Probe', () => {
  it('draws one face a step and is ready after the sixth', () => {
    const p = new Probe(1, 100), { r, faces } = stub(), scene = new Scene();
    expect(p.step(r, scene)).toBe(false);
    expect(faces).toEqual([]);
    p.request();
    const ends = Array.from({ length: 6 }, () => p.step(r, scene));
    expect(faces).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ends).toEqual([false, false, false, false, false, true]);
    expect(p.ready).toBe(true);
    expect(p.busy).toBe(false);
    expect(p.texture.pmremVersion).toBe(1);
  });

  it('starts a request made during a capture after it ends', () => {
    const p = new Probe(1, 100), { r, faces } = stub(), scene = new Scene();
    p.request();
    p.step(r, scene);
    p.request();
    for (let i = 0; i < 5; i++) p.step(r, scene);
    expect(p.busy).toBe(true);
    for (let i = 0; i < 6; i++) p.step(r, scene);
    expect(p.busy).toBe(false);
    expect(faces).toHaveLength(12);
    expect(p.texture.pmremVersion).toBe(2);
  });
});
