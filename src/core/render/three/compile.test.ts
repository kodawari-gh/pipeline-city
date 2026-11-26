import { assert, describe, expect, it, vi } from 'vitest';
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  FrontSide,
  Group,
  InstancedMesh,
  Light,
  Material,
  Mesh,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Scene,
  SkinnedMesh,
  Texture,
} from 'three';
import type * as threeTypes from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import {
  LINK_MAX_MS,
  ProgramGate,
  freeWhenLinked,
  linked,
  prime,
  startPassPrograms,
  startPrograms,
  startShadowPrograms,
  whenLinked,
} from './compile';
import type * as compileTypes from './compile';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A program that links after `n` looks. */
const after = (n: number): compileTypes.Program => {
  let left = n;
  return { isReady: () => left-- <= 0 };
};

/** A renderer as far as the compile helpers use one (its programs are in `properties`). */
const isRenderer = (x: unknown): x is threeTypes.WebGLRenderer =>
  typeof x === 'object' && x !== null && 'properties' in x;
const isMesh = (o: threeTypes.Object3D): o is Mesh => o instanceof Mesh;
const isLight = (o: threeTypes.Object3D): o is threeTypes.Light => o instanceof Light;
/** A program three destroyed: it sets the program's `program` to undefined. */
const destroyed = { isReady: () => false, program: undefined };

/** Programs that link when `up.on` is set; their first uses are counted. */
const gateRig = () => {
  const up = { on: false },
    used = vi.fn<() => unknown>(),
    start = vi.fn<() => compileTypes.Program[]>(() => [
      { isReady: () => up.on, getUniforms: used },
      { isReady: () => up.on, getUniforms: used },
    ]);
  return { up, used, start, gate: new ProgramGate(start) };
};

/** A scene of a material with a program and a fresh one, and a renderer that knows the made one's `programs`. */
const tree = (programs: compileTypes.Program[]) => {
  const made = new Material(),
    fresh = new Material(),
    root = new Scene();
  root.add(new Mesh(undefined, made), new Mesh(undefined, fresh));
  const r = {
    properties: {
      has: (m: Material) => m === made,
      get: () => ({ programs: new Map(programs.map((p, i) => [String(i), p])) }),
    },
  };
  assert(isRenderer(r));
  return { r, root };
};

/** A renderer that compiles a program per transparency of `lid`'s material, and notes the transparency it compiled with. */
const fadeRig = (lid: Mesh<threeTypes.BufferGeometry, Material>) => {
  const seen: boolean[] = [],
    progs = new Map<Material, Map<string, compileTypes.Program>>();
  const r = {
    getRenderTarget: () => null,
    setRenderTarget: vi.fn<(t: unknown) => void>(),
    compile: () => {
      seen.push(lid.material.transparent);
      const m = progs.get(lid.material) ?? new Map<string, compileTypes.Program>();
      m.set(String(lid.material.transparent), after(0));
      progs.set(lid.material, m);
      return new Set([lid.material]);
    },
    properties: { get: (m: Material) => ({ programs: progs.get(m) }) },
  };
  assert(isRenderer(r));
  return { r, seen };
};

interface Seen {
  lights: threeTypes.Light[];
  meshes: Mesh[];
  maps: (Texture | null)[];
  fog: unknown;
}
/** The map of a depth (or distance) material. */
const mapOf = (m: Mesh) =>
  m.material instanceof MeshDepthMaterial || m.material instanceof MeshDistanceMaterial ? m.material.map : null;
/** A renderer whose `compile` notes the scene it is given: the lights and the depth meshes (with their maps, which are let go after). */
const rig = (shadows = true) => {
  const seen: Seen[] = [];
  const r = {
    shadowMap: { enabled: shadows, type: PCFShadowMap },
    getRenderTarget: () => null,
    setRenderTarget: vi.fn<(t: unknown) => void>(),
    compile: (own: Scene) => {
      const meshes = own.children.filter((o) => isMesh(o)),
        lights = own.children.filter((o) => isLight(o));
      seen.push({ lights, meshes, maps: meshes.map((m) => mapOf(m)), fog: own.fog });
      return new Set(meshes.flatMap((m) => m.material));
    },
    properties: { get: () => ({ currentProgram: { isReady: () => true } }) },
  };
  assert(isRenderer(r));
  return { r, seen };
};
const lamp = (point = false) => {
  const l = point ? new PointLight() : new DirectionalLight();
  l.castShadow = true;
  return l;
};
const cast = <T extends Mesh>(m: T): T => {
  m.castShadow = true;
  return m;
};
const caster = (material: Material = new MeshStandardMaterial()) => cast(new Mesh(new BoxGeometry(), material));
/** The mesh's depth material, failing the test when it has another. */
const mat = (m: Mesh) => {
  assert.instanceOf(m.material, MeshDepthMaterial);
  return m.material;
};
/** The first mesh of the `i`th scene the renderer saw. */
const firstMesh = (seen: Seen[], i = 0) => must(must(seen[i]).meshes[0]);
/** What kind of mesh a caster's proxy is: instanced, with colours, skinned. */
const kindOf = (o: Mesh) => [
  o instanceof InstancedMesh,
  o instanceof InstancedMesh && o.instanceColor !== null,
  o instanceof SkinnedMesh,
];
/** The quad a full screen pass draws with (three keeps it in `_mesh`). */
const hasQuad = (q: unknown): q is { _mesh: Mesh } =>
  typeof q === 'object' && q !== null && '_mesh' in q && q._mesh instanceof Mesh;
const cam = new PerspectiveCamera();

describe('whenLinked', () => {
  it('resolves at once when all are linked, and says so', async () => {
    const seen: [number, number][] = [];
    await whenLinked(
      [after(0), after(0)],
      (d, t) => {
        seen.push([d, t]);
      },
      1,
    );
    expect(seen).toStrictEqual([[2, 2]]);
  });

  it('waits for the last one and counts them as they link', async () => {
    const seen: number[] = [];
    await whenLinked(
      [after(0), after(2), after(4)],
      (d) => {
        seen.push(d);
      },
      1,
    );
    expect(seen[0]).toBe(1);
    expect(seen.at(-1)).toBe(3);
    expect(seen.toSorted((a, b) => a - b)).toStrictEqual(seen);
  });

  it('linked: every one', () => {
    expect(linked([after(0), after(0)])).toBe(true);
    expect(linked([after(0), after(5)])).toBe(false);
    // a destroyed program (three sets its `program` to undefined) never links: it does not hold the wait
    expect(linked([after(0), destroyed])).toBe(true);
    const unlinked = { isReady: () => false, program: {} };
    expect(linked([unlinked])).toBe(false);
  });
});

describe('prime', () => {
  it('makes the first use of each program, once, and empties the list', () => {
    const uses = [0, 0, 0];
    const left: compileTypes.Program[] = uses.map((_, i) => ({
      isReady: () => true,
      getUniforms: () => {
        uses[i] = must(uses[i]) + 1;
      },
    }));
    expect(prime(left, 1000)).toBe(true);
    expect(left).toStrictEqual([]);
    expect(uses).toStrictEqual([1, 1, 1]);
    expect(prime(left, 1000)).toBe(true); // (nothing left: nothing is used again)
    expect(uses).toStrictEqual([1, 1, 1]);
  });

  it('stops at its time and takes the rest at the next call', () => {
    let used = 0,
      t = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => t);
    try {
      const left: compileTypes.Program[] = Array.from({ length: 5 }, () => ({
        isReady: () => true,
        getUniforms: () => {
          used++;
          t += 1;
        },
      }));
      expect(prime(left, 2)).toBe(false); // (2 ms: two programs)
      expect(used).toBe(2);
      expect(prime(left, 10)).toBe(true);
      expect(used).toBe(5);
    } finally {
      spy.mockRestore();
    }
  });

  it('leaves a destroyed program alone (the driver would log an invalid value for its deleted program) and one with no first use', () => {
    let used = 0;
    const left: compileTypes.Program[] = [
      {
        ...destroyed,
        getUniforms: () => {
          used++;
        },
      },
      { isReady: () => true },
    ];
    expect(prime(left, 1000)).toBe(true);
    expect(used).toBe(0);
  });
});

describe('ProgramGate', () => {
  it('starts the programs at the first call, once, and is not ready until they link', () => {
    const { gate, start, up } = gateRig();
    expect([gate.ready(0), gate.ready(10), gate.ready(20)]).toStrictEqual([false, false, false]);
    expect(start).toHaveBeenCalledOnce();
    up.on = true;
    expect(gate.ready(30)).toBe(true);
    expect(start).toHaveBeenCalledOnce();
  });

  it('makes the first use of each program once they have linked, never before, and only once', () => {
    const { gate, up, used } = gateRig();
    gate.ready(0);
    gate.ready(10);
    expect(used).not.toHaveBeenCalled();
    up.on = true;
    expect(gate.ready(20)).toBe(true);
    expect(used).toHaveBeenCalledTimes(2);
    gate.ready(30);
    gate.ready(40);
    expect(used).toHaveBeenCalledTimes(2);
  });

  it('is ready at the first call when the programs have linked already', () => {
    const { gate, up } = gateRig();
    up.on = true;
    expect(gate.ready(0)).toBe(true);
  });

  it('gives up waiting after LINK_MAX_MS, and the draw links what is left', () => {
    const { gate } = gateRig();
    expect(gate.ready(1000)).toBe(false);
    expect(gate.ready(1000 + LINK_MAX_MS)).toBe(false);
    expect(gate.ready(1000 + LINK_MAX_MS + 1)).toBe(true);
  });

  it('starts again after a reset, and waits for the new programs', () => {
    const { gate, up, start } = gateRig();
    up.on = true;
    expect(gate.ready(0)).toBe(true);
    up.on = false;
    gate.reset();
    expect(gate.ready(10)).toBe(false);
    expect(start).toHaveBeenCalledTimes(2);
    up.on = true;
    expect(gate.ready(20)).toBe(true);
  });

  it('a reset restarts the time limit too', () => {
    const { gate } = gateRig();
    gate.ready(0);
    gate.reset();
    expect(gate.ready(LINK_MAX_MS + 5)).toBe(false); // (the wait began again at this call)
    expect(gate.ready(2 * LINK_MAX_MS + 10)).toBe(true);
  });

  it('says it has started from the first call to a reset (a model that joins before that is in the batch)', () => {
    const { gate } = gateRig();
    expect(gate.started).toBe(false);
    gate.ready(0);
    expect(gate.started).toBe(true);
    gate.reset();
    expect(gate.started).toBe(false);
  });
});

describe('freeWhenLinked', () => {
  it('frees at once when the programs have linked (a material with no program is not asked)', () => {
    const { r, root } = tree([after(0)]);
    let n = 0;
    freeWhenLinked(
      r,
      root,
      () => {
        n++;
      },
      1,
    );
    expect(n).toBe(1);
  });

  it('waits for a program that still links, then frees once', async () => {
    const { r, root } = tree([after(0), after(3)]);
    let n = 0;
    freeWhenLinked(
      r,
      root,
      () => {
        n++;
      },
      1,
    );
    expect(n).toBe(0);
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    expect(n).toBe(1);
  });
});

describe('startPrograms', () => {
  it('compiles into a target, puts the old target back and gives each program once', () => {
    const shared = after(0),
      mats = [new Material(), new Material()],
      targets: unknown[] = [];
    let target: unknown = 'screen';
    const r = {
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => {
        target = t;
        targets.push(t);
      },
      compile: () => new Set(mats),
      properties: { get: () => ({ currentProgram: shared }) },
    };
    assert(isRenderer(r));
    const scene = new Scene();
    scene.add(new Mesh());
    expect(startPrograms(r, scene, cam)).toStrictEqual([shared]);
    expect(targets[0]).toHaveProperty('isWebGLRenderTarget', true);
    expect(target).toBe('screen');
  });

  it('toCanvas: compiles with no target (the program key holds the tone mapping and the colour space of the canvas), and puts the old target back', () => {
    const shared = after(0),
      targets: unknown[] = [];
    let target: unknown = 'screen';
    const r = {
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => {
        target = t;
        targets.push(t);
      },
      compile: () => new Set([new Material()]),
      properties: { get: () => ({ currentProgram: shared }) },
    };
    assert(isRenderer(r));
    const scene = new Scene();
    scene.add(new Mesh());
    expect(startPrograms(r, scene, cam, { toCanvas: true })).toStrictEqual([shared]);
    expect(targets).toStrictEqual([null, 'screen']);
  });

  it('makes the see-through variant of a fade, each variant once, and leaves the fade opaque', () => {
    const lid = new Mesh(undefined, new Material()),
      { r, seen } = fadeRig(lid);
    const root = new Scene();
    root.add(lid);
    expect(startPrograms(r, root, cam, { fades: [lid] })).toHaveLength(2);
    expect(seen).toStrictEqual([false, true]);
    expect(lid.material.transparent).toBe(false);
  });
});

describe('startShadowPrograms', () => {
  it('starts nothing when shadows are off, when no light casts or when nothing casts', () => {
    const scene = new Scene(),
      light = lamp(),
      mesh = caster(),
      on = rig();
    scene.add(light, mesh);
    expect(startShadowPrograms(rig(false).r, scene, cam)).toStrictEqual([]);
    light.castShadow = false;
    expect(startShadowPrograms(on.r, scene, cam)).toStrictEqual([]);
    light.castShadow = true;
    mesh.castShadow = false;
    expect(startShadowPrograms(on.r, scene, cam)).toStrictEqual([]);
    expect(on.seen).toStrictEqual([]);
  });

  it('makes the depth material three would for each kind of caster: the opposite side, the map kept, one for the same state', () => {
    const { r, seen } = rig(),
      scene = new Scene(),
      flat = new MeshStandardMaterial(),
      map = new Texture();
    scene.add(
      lamp(),
      caster(flat),
      caster(flat),
      caster(new MeshStandardMaterial({ side: BackSide })),
      caster(new MeshStandardMaterial({ side: DoubleSide })),
      caster(new MeshStandardMaterial({ map })),
      // (a shadow side of its own wins: this one is the back sided one's state again)
      caster(new MeshStandardMaterial({ shadowSide: FrontSide })),
    );
    expect(startShadowPrograms(r, scene, cam)).toHaveLength(4); // (the stub gives each material a program: the six casters make four depth materials)
    const s = must(seen[0]);
    expect(s.meshes.every((m) => m.material instanceof MeshDepthMaterial)).toBe(true);
    expect(s.meshes.map((m) => mat(m).side)).toStrictEqual([BackSide, FrontSide, DoubleSide, BackSide]);
    expect(s.maps.map(Boolean)).toStrictEqual([false, false, false, true]);
  });

  it('copies the alpha test: a map with a test is another program than a map alone', () => {
    const { r, seen } = rig(),
      scene = new Scene(),
      map = new Texture();
    scene.add(
      lamp(),
      caster(new MeshStandardMaterial({ map })),
      caster(new MeshStandardMaterial({ map, alphaTest: 0.5 })),
      caster(new MeshStandardMaterial({ alphaToCoverage: true })),
    );
    startShadowPrograms(r, scene, cam);
    expect(must(seen[0]).meshes.map((m) => mat(m).alphaTest)).toStrictEqual([0, 0.5, 0.5]);
  });

  it('a point light asks for distance materials too, a lamp that does not cast for none', () => {
    const { r, seen } = rig(),
      scene = new Scene();
    scene.add(lamp(), lamp(true), caster());
    startShadowPrograms(r, scene, cam);
    expect(
      must(seen[0]).meshes.map((m) => [
        m.material instanceof MeshDepthMaterial,
        m.material instanceof MeshDistanceMaterial,
      ]),
    ).toStrictEqual([
      [true, false],
      [false, true],
    ]);
    const only = rig(),
      dim = new Scene(),
      cold = new PointLight();
    dim.add(lamp(), cold, caster());
    startShadowPrograms(only.r, dim, cam);
    expect(must(only.seen[0]).meshes).toHaveLength(1);
  });

  it("makes a mesh of the caster's kind: instanced, with its colours, skinned, with no normals", () => {
    const { r, seen } = rig(),
      scene = new Scene(),
      m = new MeshStandardMaterial(),
      box = new BoxGeometry();
    const coloured = cast(new InstancedMesh(box, m, 3));
    coloured.setColorAt(0, new Color());
    const tri = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(9), 3)),
      bare = cast(new Mesh(tri, m));
    scene.add(
      lamp(),
      cast(new Mesh(box, m)),
      cast(new InstancedMesh(box, m, 3)),
      coloured,
      cast(new SkinnedMesh(box, m)),
      bare,
    );
    startShadowPrograms(r, scene, cam);
    const { meshes } = must(seen[0]);
    expect(meshes.map((o) => kindOf(o))).toStrictEqual([
      [false, false, false],
      [true, false, false],
      [true, true, false],
      [false, false, true],
      [false, false, false],
    ]);
    // (the caster's own geometry, shared: never freed with the proxies)
    expect(meshes.slice(0, 4).every((o) => o.geometry === box)).toBe(true);
    expect(must(meshes[4]).geometry).toBe(bare.geometry);
    const third = must(meshes[2]);
    assert.instanceOf(third, InstancedMesh);
    expect(third.instanceColor).toBe(coloured.instanceColor);
  });

  it('counts the lights of the scene and of the root, each once, and leaves them where they are', () => {
    const { r, seen } = rig(),
      scene = new Scene(),
      root = new Group(),
      a = lamp(),
      b = new PointLight();
    scene.add(a);
    root.add(b, caster());
    startShadowPrograms(r, scene, cam, root);
    expect(must(seen[0]).lights).toStrictEqual([a, b]);
    expect([a.parent, b.parent]).toStrictEqual([scene, root]);
    // (the root in the scene already: its lights are the scene's)
    scene.add(root);
    seen.length = 0;
    startShadowPrograms(r, scene, cam, root);
    expect(must(seen[0]).lights).toStrictEqual([a, b]);
  });

  it("draws with no fog, and leaves the scene's fog alone", () => {
    const { r, seen } = rig(),
      scene = new Scene(),
      fog = new Fog(0x00_00_00);
    scene.fog = fog;
    scene.add(lamp(), caster());
    startShadowPrograms(r, scene, cam);
    expect(must(seen[0]).fog).toBeNull();
    expect(scene.fog).toBe(fog);
  });

  it('counts a hidden caster, not a hidden material', () => {
    const { r, seen } = rig(),
      scene = new Scene(),
      shut = caster(new MeshStandardMaterial({ side: BackSide })),
      gone = new MeshStandardMaterial({ side: DoubleSide });
    shut.visible = false;
    gone.visible = false;
    scene.add(lamp(), shut, caster(gone));
    startShadowPrograms(r, scene, cam);
    expect(must(seen[0]).meshes.map((m) => mat(m).side)).toStrictEqual([FrontSide]);
  });

  it('keeps its depth materials for the next start, and holds no texture after the one it made', () => {
    const { r, seen } = rig(),
      scene = new Scene(),
      map = new Texture();
    scene.add(lamp(), caster(new MeshStandardMaterial({ map })));
    startShadowPrograms(r, scene, cam);
    startShadowPrograms(r, scene, cam);
    expect(must(seen[0]).maps[0]).toBe(map);
    expect(firstMesh(seen, 1).material).toBe(firstMesh(seen).material);
    expect(mat(firstMesh(seen)).map).toBeNull();
    // (another renderer has materials of its own: a pool is per renderer)
    const other = rig();
    startShadowPrograms(other.r, scene, cam);
    expect(firstMesh(other.seen).material).not.toBe(firstMesh(seen).material);
  });
});

describe('startPassPrograms', () => {
  it('links for the attributes a pass draws with: three makes another program for a quad with others', () => {
    const seen: string[] = [],
      material = new Material();
    const r = {
      getRenderTarget: () => null,
      setRenderTarget: vi.fn<(t: unknown) => void>(),
      compile: (root: Mesh) => {
        seen.push(...Object.keys(root.geometry.attributes));
        return new Set();
      },
      properties: { get: () => ({}) },
    };
    assert(isRenderer(r));
    startPassPrograms(r, [{ material }]);
    const quad = new FullScreenQuad(material);
    assert(hasQuad(quad));
    const drawn = quad._mesh.geometry;
    expect(seen.toSorted()).toStrictEqual(Object.keys(drawn.attributes).toSorted());
  });
});
