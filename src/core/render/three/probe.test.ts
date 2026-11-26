import { assert, describe, expect, it } from 'vitest';
import {
  Group,
  Light,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  SpotLight,
  WebGLCoordinateSystem,
} from 'three';
import type * as threeTypes from 'three';
import { Probe } from './probe';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A renderer as far as the probe reaches into one (each fake has the parts its test needs). */
const isRenderer = (x: unknown): x is threeTypes.WebGLRenderer =>
  typeof x === 'object' && x !== null && 'getRenderTarget' in x;
const isLight = (o: Object3D): o is Light => o instanceof Light;
const isMesh = (o: Object3D | undefined): o is Mesh => o instanceof Mesh;
/** The object as a mesh, failing the test when it is something else. */
function asMesh(o: Object3D | undefined): Mesh {
  assert(isMesh(o), 'expected a mesh');
  return o;
}

/** A renderer that only records the faces drawn into a target, and calls `onRender` at each draw. */
function stub(onRender?: () => void) {
  const faces: number[] = [];
  let face = 0;
  const r = {
    coordinateSystem: WebGLCoordinateSystem,
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: (t: unknown, f = 0) => {
      face = t === null ? -1 : f;
    },
    render: () => {
      faces.push(face);
      onRender?.();
    },
  };
  assert(isRenderer(r));
  return { r, faces };
}

/** What three's walk of a scene finds: the lights it keeps, the meshes it draws. */
interface Found {
  lights: Object3D[];
  drawn: Object3D[];
}
/** Three's walk: an object not shown ends the walk, an object off the camera's layers is passed and its children walked. */
function walk(o: Object3D, layers: threeTypes.Layers, found: Found): void {
  if (!o.visible) {
    return;
  }
  if (o.layers.test(layers)) {
    if (isLight(o)) {
      found.lights.push(o);
    } else if (isMesh(o)) {
      found.drawn.push(o);
    }
  }
  for (const c of o.children) {
    walk(c, layers, found);
  }
}
/** A drawing call that draws nothing. */
function noop(): void {
  // (nothing is drawn)
}

describe('Probe', () => {
  it('draws one face a step and is ready after the sixth', () => {
    const p = new Probe(1, 100),
      { r, faces } = stub(),
      scene = new Scene();
    expect(p.step(r, scene)).toBe(false);
    expect(faces).toStrictEqual([]);
    p.request();
    const ends = Array.from({ length: 6 }, () => p.step(r, scene));
    expect(faces).toStrictEqual([0, 1, 2, 3, 4, 5]);
    expect(ends).toStrictEqual([false, false, false, false, false, true]);
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
    const { r } = stub(() => {
      seen.push(root.visible);
    });
    p.request();
    for (let i = 0; i < 6; i++) {
      p.step(r, scene, root);
    }
    expect(seen).toStrictEqual([false, false, false, false, false, false]);
    expect(root.visible).toBe(true);
  });

  it("keeps the root's lights in the light state at no strength, and draws nothing of the root", () => {
    const scene = new Scene(),
      root = new Group(),
      cam = new PerspectiveCamera();
    const rgb = new PointLight(0xff_ff_ff, 0.9),
      deep = new SpotLight(0xff_ff_ff, 3),
      off = new PointLight(0xff_ff_ff, 2);
    const part = new Mesh(),
      holder = new Mesh(),
      inner = new Group(),
      under = new Mesh(),
      lamp = new PointLight(0xff_ff_ff, 5),
      wall = new Mesh();
    off.visible = false;
    holder.add(inner.add(deep, under));
    scene.add(root.add(rgb, part, holder, off), lamp, wall);
    deep.castShadow = true;
    deep.shadow.autoUpdate = false;
    deep.shadow.needsUpdate = true;
    // what three's walk finds (`walk`)
    const find = () => {
      const found: Found = { lights: [], drawn: [] };
      walk(scene, cam.layers, found);
      return found;
    };
    const before = find(),
      masks = [holder, inner].map((o) => o.layers.mask),
      during: Found[] = [];
    let strengths: number[] = [],
      owed = true;
    const { r } = stub(() => {
      during.push(find());
      strengths = [rgb, deep, lamp].map((l) => l.intensity);
      owed = deep.shadow.needsUpdate;
    });
    const p = new Probe(1, 100);
    p.request();
    p.step(r, scene, root);
    // the same lights (so three keeps every material's program), dark; of the meshes, only the room's
    expect(must(during[0]).lights).toStrictEqual(before.lights);
    expect(before.lights).toStrictEqual([rgb, deep, lamp]);
    expect(strengths).toStrictEqual([0, 0, 5]);
    expect(must(during[0]).drawn).toStrictEqual([wall]);
    expect(owed).toBe(false);
    // and all of it back
    expect(find()).toStrictEqual(before);
    expect([rgb, deep, off, lamp].map((l) => l.intensity)).toStrictEqual([0.9, 3, 2, 5]);
    expect([holder, inner].map((o) => o.layers.mask)).toStrictEqual(masks);
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
    for (let i = 0; i < 5; i++) {
      p.step(r, scene);
    }
    expect(faces).toHaveLength(5);
    expect(p.step(r, scene)).toBe(true);
    expect(faces).toStrictEqual([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]);
    expect(p.texture.pmremVersion).toBe(1);
    expect(p.texture).not.toBe(plain.texture);
    p.dispose();
  });

  it('starts the program of the calm pass, and has none to start without one', () => {
    const seen: unknown[] = [];
    const r = {
      getRenderTarget: () => null,
      setRenderTarget: noop,
      compile: (root: Scene) => {
        seen.push(root);
        return new Set(root.children.map((o) => asMesh(o).material));
      },
      properties: { get: () => ({ currentProgram: { isReady: () => true } }) },
    };
    assert(isRenderer(r));
    expect(new Probe(1, 100).startPrograms(r)).toStrictEqual([]);
    expect(seen).toStrictEqual([]);
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
    for (let i = 0; i < 5; i++) {
      p.step(r, scene);
    }
    expect(p.busy).toBe(true);
    for (let i = 0; i < 6; i++) {
      p.step(r, scene);
    }
    expect(p.busy).toBe(false);
    expect(faces).toHaveLength(12);
    expect(p.texture.pmremVersion).toBe(2);
  });
});
