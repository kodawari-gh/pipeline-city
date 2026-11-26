import { assert, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Box3, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Texture, Vector3 } from 'three';
import type * as threeTypes from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fitModel, joinModel, ktx2Support, loadModel, modelsIn, warmLateModels } from './gltf';
import type * as gltfTypes from './gltf';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A file's bytes, as far as this test compares them. */
interface FileBytes {
  equals: (other: FileBytes) => boolean;
}
/** The part of `node:fs` this test reads with. */
interface NodeFs {
  readFileSync: (path: string) => FileBytes;
}
const fs = await vi.importActual<NodeFs>('node:fs');
// (three's file loader tells its progress with a browser event that Node does not have)
vi.stubGlobal(
  'ProgressEvent',
  class {
    constructor(
      readonly type: string,
      init: object = {},
    ) {
      Object.assign(this, init);
    }
  },
);
// (and it reads `self.URL` for an image inside the file)
if (typeof self === 'undefined') {
  vi.stubGlobal('self', globalThis);
}

/**
 * A .glb of one triangle (the smallest model the loader reads): a header, a JSON chunk and a binary chunk. `more`: more of the JSON (a
 * material with a KTX2 texture); `material`: the triangle wears material 0.
 */
const glb = (more: Record<string, unknown> = {}, material = false): ArrayBuffer => {
  const bin = new Uint8Array(new Float32Array([0, 0, 0, 2, 0, 0, 0, 4, 0]).buffer);
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, ...(material ? { material: 0 } : {}) }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [2, 4, 0] }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
    ...more,
  });
  const text = new TextEncoder().encode(json + ' '.repeat((4 - (json.length % 4)) % 4));
  const out = new ArrayBuffer(12 + 8 + text.length + 8 + bin.length),
    v = new DataView(out);
  v.setUint32(0, 0x46_54_6c_67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.byteLength, true);
  v.setUint32(12, text.length, true);
  v.setUint32(16, 0x4e_4f_53_4a, true);
  new Uint8Array(out, 20, text.length).set(text);
  const o = 20 + text.length;
  v.setUint32(o, bin.length, true);
  v.setUint32(o + 4, 0x00_4e_49_42, true);
  new Uint8Array(out, o + 8, bin.length).set(bin);
  return out;
};
const TRIANGLE = glb();
/** The triangle with a base colour map that is a KTX2 image (`KHR_texture_basisu`, required: no PNG beside it). */
const WITH_KTX2 = glb(
  {
    extensionsUsed: ['KHR_texture_basisu'],
    extensionsRequired: ['KHR_texture_basisu'],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }],
    images: [{ uri: 'skin.ktx2' }],
  },
  true,
);
/** The model as a url the loader can fetch with no server; `tag` makes it a model of its own (the cache is by url). */
const urlOf = (model: ArrayBuffer, tag: string): string =>
  `data:model/gltf-binary;name=${tag};base64,${btoa(String.fromCodePoint(...new Uint8Array(model)))}`;
/** A KTX2 loader as far as the glTF loader uses one (it loads each image through `load`). */
const isKtx2 = (x: unknown): x is NonNullable<gltfTypes.Ktx2> => typeof x === 'object' && x !== null && 'load' in x;
/** A stand-in for three's `KTX2Loader` (it needs a worker and the wasm transcoder) that gives `tex`, noting each url asked. */
const fakeKtx2 = (tex: Texture, asked: string[] = []): NonNullable<gltfTypes.Ktx2> => {
  const loader = {
    load: (url: string, onLoad: (t: Texture) => void) => {
      asked.push(url);
      onLoad(tex);
    },
  };
  assert(isKtx2(loader));
  return loader;
};
/** A stand-in for three's `KTX2Loader` that fails every image (the glTF loader calls `load` inside a promise: a throw rejects it). */
const brokenKtx2 = (): NonNullable<gltfTypes.Ktx2> => {
  const loader = {
    load: () => {
      throw new Error('no transcoder');
    },
  };
  assert(isKtx2(loader));
  return loader;
};
/** Runs `then` once `p` settles to a value (as a user of the model would). */
const after = async (p: Promise<unknown>, then: (v: unknown) => void) => {
  then(await p);
};

/** A late model with its parent in a scene, and a warm-up whose programs link when `up.on` is set. */
const joinRig = () => {
  const up = { on: false },
    scene = new Group(),
    parent = new Group(),
    model = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  scene.add(parent);
  const order: string[] = [],
    start = vi.fn<gltfTypes.WarmModel>(() => {
      order.push('warm');
      return [{ isReady: () => up.on }];
    });
  return { up, scene, parent, model, order, start };
};

/** The base colour map of the (last) standard mesh under `o`. */
const mapOf = (o: threeTypes.Object3D): Texture | null => {
  let map: Texture | null = null;
  o.traverse((c) => {
    if (c instanceof Mesh && c.material instanceof MeshStandardMaterial) {
      ({ map } = c.material);
    }
  });
  return map;
};

describe('glTF models', () => {
  it('fitModel scales evenly into the rect and the depth, and centres on the rect', () => {
    const o = new Mesh(new BoxGeometry(2, 4, 6), new MeshBasicMaterial());
    fitModel(o, { x: 0, y: 0, w: 100, h: 100 }, 10, 40);
    const box = new Box3().setFromObject(o),
      size = box.getSize(new Vector3()),
      mid = box.getCenter(new Vector3());
    expect(size.z).toBeCloseTo(30);
    expect(size.x).toBeCloseTo(10);
    expect(size.y).toBeCloseTo(20);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(-50);
    expect(box.min.z).toBeCloseTo(10);
  });

  it('fitModel with stretch fills the rect in x and y and keeps the height to the smaller', () => {
    const o = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    fitModel(o, { x: 0, y: 0, w: 100, h: 40 }, 0, 1000, true);
    const size = new Box3().setFromObject(o).getSize(new Vector3());
    expect(size.x).toBeCloseTo(100);
    expect(size.y).toBeCloseTo(40);
    expect(size.z).toBeCloseTo(40);
  });

  it('the loader reads a model and the fit places it', async () => {
    const gltf = await new GLTFLoader().parseAsync(TRIANGLE, '');
    fitModel(gltf.scene, { x: 10, y: 20, w: 8, h: 8 }, 0, 100);
    const box = new Box3().setFromObject(gltf.scene);
    expect(box.max.y - box.min.y).toBeCloseTo(8);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(14);
  });
});

describe('modelsIn (the boot waits for the models its scene asked for)', () => {
  it('waits until the users of the models have them', async () => {
    const used: string[] = [];
    void after(loadModel(urlOf(TRIANGLE, 'wait-a')), () => {
      used.push('a');
    });
    void after(loadModel(urlOf(TRIANGLE, 'wait-b')), () => {
      used.push('b');
    });
    expect(used).toStrictEqual([]);
    await modelsIn();
    expect(used.toSorted()).toStrictEqual(['a', 'b']);
  });

  it('is done at once when no load is under way', async () => {
    await modelsIn();
    await expect(modelsIn(5)).resolves.toBeUndefined();
  });

  it('holds a model back until `until` settles (a build that must not see it), and modelsIn waits for it too', async () => {
    const { promise: until, resolve: open } = Promise.withResolvers<boolean>();
    let got: unknown = 'none';
    void after(loadModel(urlOf(TRIANGLE, 'held'), until), (m) => {
      got = m;
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(got).toBe('none');
    open(true);
    await modelsIn();
    expect(got).not.toBe('none');
    expect(got).not.toBeNull();
  });

  it('gives up after its time on a slow model, which still reaches its user later', async () => {
    const { promise: slow, resolve: arrive } = Promise.withResolvers<Response>();
    const fetched = vi.spyOn(globalThis, 'fetch').mockReturnValue(slow);
    try {
      let used = false;
      void after(loadModel('http://localhost/slow-model.glb'), () => {
        used = true;
      });
      await modelsIn(20);
      expect(used).toBe(false);
      arrive(new Response(TRIANGLE));
      await modelsIn();
      expect(used).toBe(true);
    } finally {
      fetched.mockRestore();
    }
  });
});

describe('joinModel (a model that comes in late links its programs while it is hidden)', () => {
  const rig = joinRig;

  it('joins and shows at once in a scene that holds nothing, prepare first', () => {
    const { parent, model, order } = rig();
    joinModel(parent, model, {
      prepare: () => {
        order.push('prepare');
      },
      shown: () => {
        order.push('shown');
      },
    });
    expect(model.parent).toBe(parent);
    expect(model.visible).toBe(true);
    expect(order).toStrictEqual(['prepare', 'shown']);
  });

  it('joins and shows at once while the scene has not started its programs (its batch takes the model)', () => {
    const { scene, parent, model, order } = rig();
    warmLateModels(scene, () => null);
    joinModel(parent, model, {
      shown: () => {
        order.push('shown');
      },
    });
    expect(model.visible).toBe(true);
    expect(order).toStrictEqual(['shown']);
  });

  it('holds the model hidden until its programs have linked, warms it after prepare, and shows it then', () => {
    vi.useFakeTimers();
    try {
      const { up, scene, parent, model, order, start } = rig();
      warmLateModels(scene, start);
      joinModel(parent, model, {
        prepare: () => {
          order.push('prepare');
        },
        shown: () => {
          order.push('shown');
        },
      });
      expect(start).toHaveBeenCalledWith(model, parent);
      expect(order).toStrictEqual(['prepare', 'warm']);
      expect(model.parent).toBe(parent);
      expect(model.visible).toBe(false);
      vi.advanceTimersByTime(200);
      expect(model.visible).toBe(false);
      expect(order).toStrictEqual(['prepare', 'warm']);
      up.on = true;
      vi.advanceTimersByTime(40);
      expect(model.visible).toBe(true);
      expect(order).toStrictEqual(['prepare', 'warm', 'shown']);
      vi.advanceTimersByTime(200);
      expect(order).toStrictEqual(['prepare', 'warm', 'shown']); // (once)
    } finally {
      vi.useRealTimers();
    }
  });

  it('a model that was hidden before it joined stays hidden when its programs have linked', () => {
    vi.useFakeTimers();
    try {
      const { up, scene, parent, model, start } = rig();
      warmLateModels(scene, start);
      model.visible = false;
      joinModel(parent, model);
      up.on = true;
      vi.advanceTimersByTime(40);
      expect(model.visible).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows nothing once the parent is gone (`alive`), and asks no more', () => {
    vi.useFakeTimers();
    try {
      const { up, scene, parent, model, order, start } = rig();
      let alive = true;
      warmLateModels(scene, start);
      joinModel(parent, model, {
        shown: () => {
          order.push('shown');
        },
        alive: () => alive,
      });
      alive = false;
      up.on = true;
      vi.advanceTimersByTime(200);
      expect(order).toStrictEqual(['warm']);
      expect(model.visible).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('KTX2 textures in a model (KTX1)', () => {
  it('a model with a KTX2 texture loads through the KTX2 loader', async () => {
    const tex = new Texture(),
      asked: string[] = [];
    await ktx2Support(null, vi.fn<() => Promise<gltfTypes.Ktx2>>().mockResolvedValue(fakeKtx2(tex, asked)));
    const m = await loadModel(urlOf(WITH_KTX2, 'ok'));
    expect(m).not.toBeNull();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/skin\.ktx2$/u);
    expect(mapOf(must(m))).toBe(tex);
  });

  it('a model without KTX2 loads as before', async () => {
    const m = await loadModel(urlOf(TRIANGLE, 'plain'));
    expect(m).not.toBeNull();
    expect(new Box3().setFromObject(must(m)).max.y).toBeCloseTo(4);
  });

  it('a KTX2 texture that fails gives no model (the primitives stay) and no throw', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {
      /* no-op */
    });
    await ktx2Support(null, vi.fn<() => Promise<gltfTypes.Ktx2>>().mockResolvedValue(brokenKtx2()));
    await expect(loadModel(urlOf(WITH_KTX2, 'broken'))).resolves.toBeNull();
    quiet.mockRestore();
  });

  it('a KTX2 loader that cannot be made leaves the plain loads working', async () => {
    const make = vi.fn<() => Promise<gltfTypes.Ktx2>>().mockRejectedValue(new Error('no chunk'));
    await expect(ktx2Support(null, make)).resolves.toBeUndefined();
    await expect(loadModel(urlOf(TRIANGLE, 'after'))).resolves.not.toBeNull();
  });

  it("the served transcoder is three's own (public/basis/ is a copy: copy it again after a three upgrade)", () => {
    for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
      const served = fs.readFileSync(`public/basis/${f}`),
        own = fs.readFileSync(`node_modules/three/examples/jsm/libs/basis/${f}`);
      expect(served.equals(own), `${f} is three's own`).toBe(true);
    }
  });
});
