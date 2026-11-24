import { describe, expect, it } from 'vitest';
import {
  Group,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  SpotLight,
  WebGLCoordinateSystem,
  type WebGLRenderer,
} from 'three';
import { Probe } from './probe';

/** A renderer that only records the faces drawn into a target. */
function stub() {
  const faces: number[] = [];
  let face = 0;
  const r = {
    coordinateSystem: WebGLCoordinateSystem,
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: (t: unknown, f = 0) => {
      face = t ? f : -1;
    },
    render: () => {
      faces.push(face);
    },
  };
  return { r: r as unknown as WebGLRenderer, faces };
}

describe('Probe', () => {
  it('draws one face a step and is ready after the sixth', () => {
    const p = new Probe(1, 100),
      { r, faces } = stub(),
      scene = new Scene();
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
    const p = new Probe(1, 100),
      scene = new Scene(),
      root = new Object3D(),
      seen: boolean[] = [];
    scene.add(root);
    const r = {
      ...stub().r,
      render: () => {
        seen.push(root.visible);
      },
    } as unknown as WebGLRenderer;
    p.request();
    for (let i = 0; i < 6; i++) p.step(r, scene, root);
    expect(seen).toEqual([false, false, false, false, false, false]);
    expect(root.visible).toBe(true);
  });

  it("keeps the root's lights in the light state at no strength, and draws nothing of the root", () => {
    const scene = new Scene(),
      root = new Group(),
      cam = new PerspectiveCamera();
    const rgb = new PointLight(0xffffff, 0.9),
      deep = new SpotLight(0xffffff, 3),
      off = new PointLight(0xffffff, 2);
    const part = new Mesh(),
      holder = new Mesh(),
      inner = new Group(),
      under = new Mesh(),
      lamp = new PointLight(0xffffff, 5),
      wall = new Mesh();
    off.visible = false;
    holder.add(inner.add(deep, under));
    scene.add(root.add(rgb, part, holder, off), lamp, wall);
    deep.castShadow = true;
    deep.shadow.autoUpdate = false;
    deep.shadow.needsUpdate = true;
    // what three's walk finds: an object not shown ends the walk, an object off the camera's layers is passed and its children walked
    const walk = (o: Object3D, lights: Object3D[], drawn: Object3D[]): void => {
      if (!o.visible) return;
      if (o.layers.test(cam.layers)) {
        if ((o as PointLight).isLight) lights.push(o);
        else if ((o as Mesh).isMesh) drawn.push(o);
      }
      for (const c of o.children) walk(c, lights, drawn);
    };
    const find = () => {
      const lights: Object3D[] = [],
        drawn: Object3D[] = [];
      walk(scene, lights, drawn);
      return { lights, drawn };
    };
    const before = find(),
      masks = [holder, inner].map((o) => o.layers.mask);
    let during: ReturnType<typeof find> | null = null,
      strengths: number[] = [],
      owed = true;
    const r = {
      ...stub().r,
      render: () => {
        during = find();
        strengths = [rgb, deep, lamp].map((l) => l.intensity);
        owed = deep.shadow.needsUpdate;
      },
    } as unknown as WebGLRenderer;
    const p = new Probe(1, 100);
    p.request();
    p.step(r, scene, root);
    // the same lights (so three keeps every material's program), dark; of the meshes, only the room's
    expect(during!.lights).toEqual(before.lights);
    expect(before.lights).toEqual([rgb, deep, lamp]);
    expect(strengths).toEqual([0, 0, 5]);
    expect(during!.drawn).toEqual([wall]);
    expect(owed).toBe(false);
    // and all of it back
    expect(find()).toEqual(before);
    expect([rgb, deep, off, lamp].map((l) => l.intensity)).toEqual([0.9, 3, 2, 5]);
    expect([holder, inner].map((o) => o.layers.mask)).toEqual(masks);
    expect([root, part, holder, under].every((o) => o.visible)).toBe(true);
    expect(off.visible).toBe(false);
    expect(deep.shadow.needsUpdate).toBe(true);
  });

  it("with a calm share, draws its six calm faces at the capture's end and gives the calm cube", () => {
    const plain = new Probe(1, 100),
      p = new Probe(1, 100, 0.5),
      { r, faces } = stub(),
      scene = new Scene();
    p.request();
    for (let i = 0; i < 5; i++) p.step(r, scene);
    expect(faces).toHaveLength(5);
    expect(p.step(r, scene)).toBe(true);
    expect(faces).toEqual([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]);
    expect(p.texture.pmremVersion).toBe(1);
    expect(p.texture).not.toBe(plain.texture);
    p.dispose();
  });

  it('starts the program of the calm pass, and has none to start without one', () => {
    const seen: unknown[] = [];
    const r = {
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      compile: (root: Scene) => {
        seen.push(root);
        return new Set((root.children as Mesh[]).map((m) => m.material));
      },
      properties: { get: () => ({ currentProgram: { isReady: () => true } }) },
    } as unknown as WebGLRenderer;
    expect(new Probe(1, 100).startPrograms(r)).toEqual([]);
    expect(seen).toEqual([]);
    const p = new Probe(1, 100, 0.5);
    expect(p.startPrograms(r)).toHaveLength(1);
    expect(seen).toHaveLength(1);
    p.dispose();
  });

  it('starts a request made during a capture after it ends', () => {
    const p = new Probe(1, 100),
      { r, faces } = stub(),
      scene = new Scene();
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
