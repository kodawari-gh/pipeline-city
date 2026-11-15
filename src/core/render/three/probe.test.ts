import { describe, expect, it } from 'vitest';
import { Object3D, Scene, WebGLCoordinateSystem, type WebGLRenderer } from 'three';
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

  it('leaves the hidden root out of each face and shows it again after', () => {
    const p = new Probe(1, 100), scene = new Scene(), root = new Object3D(), seen: boolean[] = [];
    scene.add(root);
    const r = { ...stub().r, render: () => { seen.push(root.visible); } } as unknown as WebGLRenderer;
    p.request();
    for (let i = 0; i < 6; i++) p.step(r, scene, root);
    expect(seen).toEqual([false, false, false, false, false, false]);
    expect(root.visible).toBe(true);
  });

  it('with a calm share, draws its six calm faces at the capture\'s end and gives the calm cube', () => {
    const plain = new Probe(1, 100), p = new Probe(1, 100, 0.5), { r, faces } = stub(), scene = new Scene();
    p.request();
    for (let i = 0; i < 5; i++) p.step(r, scene);
    expect(faces).toHaveLength(5);
    expect(p.step(r, scene)).toBe(true);
    expect(faces).toEqual([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]);
    expect(p.texture.pmremVersion).toBe(1);
    expect(p.texture).not.toBe(plain.texture);
    p.dispose();
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
