import { describe, expect, it, vi } from 'vitest';
import {
  BackSide, BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, Fog, FrontSide, Group, InstancedMesh, Material, Mesh, MeshStandardMaterial,
  PCFShadowMap, PointLight, Scene, SkinnedMesh, Texture, type Light, type MeshDepthMaterial, type MeshDistanceMaterial, type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LINK_MAX_MS, ProgramGate, freeWhenLinked, linked, prime, startPassPrograms, startPrograms, startShadowPrograms, whenLinked, type Program } from './compile';

/** A program that links after `n` looks. */
const after = (n: number): Program => ({ isReady: () => n-- <= 0 });

describe('whenLinked', () => {
  it('resolves at once when all are linked, and says so', async () => {
    const seen: [number, number][] = [];
    await whenLinked([after(0), after(0)], (d, t) => seen.push([d, t]), 1);
    expect(seen).toEqual([[2, 2]]);
  });

  it('waits for the last one and counts them as they link', async () => {
    const seen: number[] = [];
    await whenLinked([after(0), after(2), after(4)], (d) => seen.push(d), 1);
    expect(seen[0]).toBe(1);
    expect(seen.at(-1)).toBe(3);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it('linked: every one', () => {
    expect(linked([after(0), after(0)])).toBe(true);
    expect(linked([after(0), after(5)])).toBe(false);
    // a destroyed program (three sets its `program` to undefined) never links: it does not hold the wait
    expect(linked([after(0), { isReady: () => false, program: undefined } as Program])).toBe(true);
    expect(linked([{ isReady: () => false, program: {} } as Program])).toBe(false);
  });
});

describe('prime', () => {
  it('makes the first use of each program, once, and empties the list', () => {
    const uses = [0, 0, 0];
    const left: Program[] = uses.map((_, i) => ({ isReady: () => true, getUniforms: () => { uses[i] = (uses[i] ?? 0) + 1; } }));
    expect(prime(left, 1000)).toBe(true);
    expect(left).toEqual([]);
    expect(uses).toEqual([1, 1, 1]);
    expect(prime(left, 1000)).toBe(true); // (nothing left: nothing is used again)
    expect(uses).toEqual([1, 1, 1]);
  });

  it('stops at its time and takes the rest at the next call', () => {
    let used = 0, t = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => t);
    try {
      const left: Program[] = Array.from({ length: 5 }, () => ({ isReady: () => true, getUniforms: () => { used++; t += 1; } }));
      expect(prime(left, 2)).toBe(false); // (2 ms: two programs)
      expect(used).toBe(2);
      expect(prime(left, 10)).toBe(true);
      expect(used).toBe(5);
    } finally { spy.mockRestore(); }
  });

  it('leaves a destroyed program alone (the driver would log an invalid value for its deleted program) and one with no first use', () => {
    let used = 0;
    const left = [
      { isReady: () => false, program: undefined, getUniforms: () => { used++; } },
      { isReady: () => true },
    ] as Program[];
    expect(prime(left, 1000)).toBe(true);
    expect(used).toBe(0);
  });
});

describe('ProgramGate', () => {
  /** Programs that link when `up.on` is set; their first uses are counted. */
  const rig = () => {
    const up = { on: false }, used = vi.fn(), start = vi.fn((): Program[] => [{ isReady: () => up.on, getUniforms: used }, { isReady: () => up.on, getUniforms: used }]);
    return { up, used, start, gate: new ProgramGate(start) };
  };

  it('starts the programs at the first call, once, and is not ready until they link', () => {
    const { gate, start, up } = rig();
    expect([gate.ready(0), gate.ready(10), gate.ready(20)]).toEqual([false, false, false]);
    expect(start).toHaveBeenCalledTimes(1);
    up.on = true;
    expect(gate.ready(30)).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('makes the first use of each program once they have linked, never before, and only once', () => {
    const { gate, up, used } = rig();
    gate.ready(0); gate.ready(10);
    expect(used).not.toHaveBeenCalled();
    up.on = true;
    expect(gate.ready(20)).toBe(true);
    expect(used).toHaveBeenCalledTimes(2);
    gate.ready(30); gate.ready(40);
    expect(used).toHaveBeenCalledTimes(2);
  });

  it('is ready at the first call when the programs have linked already', () => {
    const { gate, up } = rig();
    up.on = true;
    expect(gate.ready(0)).toBe(true);
  });

  it('gives up waiting after LINK_MAX_MS, and the draw links what is left', () => {
    const { gate } = rig();
    expect(gate.ready(1000)).toBe(false);
    expect(gate.ready(1000 + LINK_MAX_MS)).toBe(false);
    expect(gate.ready(1000 + LINK_MAX_MS + 1)).toBe(true);
  });

  it('starts again after a reset, and waits for the new programs', () => {
    const { gate, up, start } = rig();
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
    const { gate } = rig();
    gate.ready(0);
    gate.reset();
    expect(gate.ready(LINK_MAX_MS + 5)).toBe(false); // (the wait began again at this call)
    expect(gate.ready(2 * LINK_MAX_MS + 10)).toBe(true);
  });
});

describe('freeWhenLinked', () => {
  const tree = (programs: Program[]) => {
    const made = new Material(), fresh = new Material(), root = new Scene();
    root.add(new Mesh(undefined, made), new Mesh(undefined, fresh));
    const r = { properties: { has: (m: Material) => m === made, get: () => ({ programs: new Map(programs.map((p, i) => [String(i), p])) }) } } as unknown as WebGLRenderer;
    return { r, root };
  };

  it('frees at once when the programs have linked (a material with no program is not asked)', () => {
    const { r, root } = tree([after(0)]);
    let n = 0;
    freeWhenLinked(r, root, () => n++, 1);
    expect(n).toBe(1);
  });

  it('waits for a program that still links, then frees once', async () => {
    const { r, root } = tree([after(0), after(3)]);
    let n = 0;
    freeWhenLinked(r, root, () => n++, 1);
    expect(n).toBe(0);
    await new Promise((done) => setTimeout(done, 40));
    expect(n).toBe(1);
  });
});

describe('startPrograms', () => {
  it('compiles into a target, puts the old target back and gives each program once', () => {
    const shared = after(0), mats = [new Material(), new Material()], targets: unknown[] = [];
    let target: unknown = 'screen';
    const r = {
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => { target = t; targets.push(t); },
      compile: () => new Set(mats),
      properties: { get: () => ({ currentProgram: shared }) },
    } as unknown as WebGLRenderer;
    const scene = new Scene();
    scene.add(new Mesh());
    expect(startPrograms(r, scene, null as never)).toEqual([shared]);
    expect((targets[0] as { isWebGLRenderTarget?: boolean }).isWebGLRenderTarget).toBe(true);
    expect(target).toBe('screen');
  });

  it('toCanvas: compiles with no target (the program key holds the tone mapping and the colour space of the canvas), and puts the old target back', () => {
    const shared = after(0), targets: unknown[] = [];
    let target: unknown = 'screen';
    const r = {
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => { target = t; targets.push(t); },
      compile: () => new Set([new Material()]),
      properties: { get: () => ({ currentProgram: shared }) },
    } as unknown as WebGLRenderer;
    const scene = new Scene();
    scene.add(new Mesh());
    expect(startPrograms(r, scene, null as never, { toCanvas: true })).toEqual([shared]);
    expect(targets).toEqual([null, 'screen']);
  });

  it('makes the see-through variant of a fade, each variant once, and leaves the fade opaque', () => {
    const lid = new Mesh(undefined, new Material()), seen: boolean[] = [];
    const progs = new Map<Material, Map<string, Program>>();
    const r = {
      getRenderTarget: () => null, setRenderTarget: () => {},
      compile: () => {
        seen.push(lid.material.transparent);
        const m = progs.get(lid.material) ?? new Map<string, Program>();
        m.set(String(lid.material.transparent), after(0));
        progs.set(lid.material, m);
        return new Set([lid.material]);
      },
      properties: { get: (m: Material) => ({ programs: progs.get(m) }) },
    } as unknown as WebGLRenderer;
    const root = new Scene();
    root.add(lid);
    expect(startPrograms(r, root, null as never, { fades: [lid] })).toHaveLength(2);
    expect(seen).toEqual([false, true]);
    expect(lid.material.transparent).toBe(false);
  });
});

describe('startShadowPrograms', () => {
  interface Seen { lights: Light[]; meshes: Mesh[]; maps: (Texture | null)[]; fog: unknown }
  /** A renderer whose `compile` notes the scene it is given: the lights and the depth meshes (with their maps, which are let go after). */
  const rig = (shadows = true) => {
    const seen: Seen[] = [];
    const r = {
      shadowMap: { enabled: shadows, type: PCFShadowMap },
      getRenderTarget: () => null, setRenderTarget: () => {},
      compile: (own: Scene) => {
        const meshes = own.children.filter((o): o is Mesh => (o as Mesh).isMesh), lights = own.children.filter((o): o is Light => (o as Light).isLight);
        seen.push({ lights, meshes, maps: meshes.map((m) => (m.material as MeshDepthMaterial).map), fog: own.fog });
        return new Set(meshes.map((m) => m.material as Material));
      },
      properties: { get: () => ({ currentProgram: { isReady: () => true } }) },
    } as unknown as WebGLRenderer;
    return { r, seen };
  };
  const lamp = (point = false) => { const l = point ? new PointLight() : new DirectionalLight(); l.castShadow = true; return l; };
  const cast = <T extends Mesh>(m: T): T => { m.castShadow = true; return m; };
  const caster = (material: Material = new MeshStandardMaterial()) => cast(new Mesh(new BoxGeometry(), material));
  const mat = (m: Mesh) => m.material as MeshDepthMaterial;
  const cam = null as never;

  it('starts nothing when shadows are off, when no light casts or when nothing casts', () => {
    const scene = new Scene(), light = lamp(), mesh = caster(), on = rig();
    scene.add(light, mesh);
    expect(startShadowPrograms(rig(false).r, scene, cam)).toEqual([]);
    light.castShadow = false;
    expect(startShadowPrograms(on.r, scene, cam)).toEqual([]);
    light.castShadow = true;
    mesh.castShadow = false;
    expect(startShadowPrograms(on.r, scene, cam)).toEqual([]);
    expect(on.seen).toEqual([]);
  });

  it('makes the depth material three would for each kind of caster: the opposite side, the map kept, one for the same state', () => {
    const { r, seen } = rig(), scene = new Scene(), flat = new MeshStandardMaterial(), map = new Texture();
    scene.add(
      lamp(), caster(flat), caster(flat), caster(new MeshStandardMaterial({ side: BackSide })), caster(new MeshStandardMaterial({ side: DoubleSide })), caster(new MeshStandardMaterial({ map })),
      // (a shadow side of its own wins: this one is the back sided one's state again)
      caster(Object.assign(new MeshStandardMaterial(), { shadowSide: FrontSide })),
    );
    expect(startShadowPrograms(r, scene, cam)).toHaveLength(4); // (the stub gives each material a program: the six casters make four depth materials)
    const s = seen[0]!;
    expect(s.meshes.every((m) => mat(m).isMeshDepthMaterial)).toBe(true);
    expect(s.meshes.map((m) => mat(m).side)).toEqual([BackSide, FrontSide, DoubleSide, BackSide]);
    expect(s.maps.map(Boolean)).toEqual([false, false, false, true]);
  });

  it('copies the alpha test: a map with a test is another program than a map alone', () => {
    const { r, seen } = rig(), scene = new Scene(), map = new Texture();
    scene.add(lamp(), caster(new MeshStandardMaterial({ map })), caster(new MeshStandardMaterial({ map, alphaTest: 0.5 })), caster(new MeshStandardMaterial({ alphaToCoverage: true })));
    startShadowPrograms(r, scene, cam);
    expect(seen[0]!.meshes.map((m) => mat(m).alphaTest)).toEqual([0, 0.5, 0.5]);
  });

  it('a point light asks for distance materials too, a lamp that does not cast for none', () => {
    const { r, seen } = rig(), scene = new Scene();
    scene.add(lamp(), lamp(true), caster());
    startShadowPrograms(r, scene, cam);
    expect(seen[0]!.meshes.map((m) => [mat(m).isMeshDepthMaterial === true, (m.material as MeshDistanceMaterial).isMeshDistanceMaterial === true])).toEqual([[true, false], [false, true]]);
    const only = rig(), dim = new Scene(), cold = new PointLight();
    dim.add(lamp(), cold, caster());
    startShadowPrograms(only.r, dim, cam);
    expect(only.seen[0]!.meshes).toHaveLength(1);
  });

  it('makes a mesh of the caster\'s kind: instanced, with its colours, skinned, with no normals', () => {
    const { r, seen } = rig(), scene = new Scene(), m = new MeshStandardMaterial(), box = new BoxGeometry();
    const coloured = cast(new InstancedMesh(box, m, 3));
    coloured.setColorAt(0, new Color());
    const bare = cast(new Mesh(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(9), 3)), m));
    scene.add(lamp(), cast(new Mesh(box, m)), cast(new InstancedMesh(box, m, 3)), coloured, cast(new SkinnedMesh(box, m)), bare);
    startShadowPrograms(r, scene, cam);
    const meshes = seen[0]!.meshes;
    expect(meshes.map((o) => [!!(o as InstancedMesh).isInstancedMesh, !!(o as InstancedMesh).instanceColor, !!(o as SkinnedMesh).isSkinnedMesh])).toEqual([
      [false, false, false], [true, false, false], [true, true, false], [false, false, true], [false, false, false],
    ]);
    // (the caster's own geometry, shared: never freed with the proxies)
    expect(meshes.slice(0, 4).every((o) => o.geometry === box)).toBe(true);
    expect(meshes[4]!.geometry).toBe(bare.geometry);
    expect((meshes[2] as InstancedMesh).instanceColor).toBe(coloured.instanceColor);
  });

  it('counts the lights of the scene and of the root, each once, and leaves them where they are', () => {
    const { r, seen } = rig(), scene = new Scene(), root = new Group(), a = lamp(), b = new PointLight();
    scene.add(a);
    root.add(b, caster());
    startShadowPrograms(r, scene, cam, root);
    expect(seen[0]!.lights).toEqual([a, b]);
    expect([a.parent, b.parent]).toEqual([scene, root]);
    // (the root in the scene already: its lights are the scene's)
    scene.add(root);
    seen.length = 0;
    startShadowPrograms(r, scene, cam, root);
    expect(seen[0]!.lights).toEqual([a, b]);
  });

  it('draws with no fog, and leaves the scene\'s fog alone', () => {
    const { r, seen } = rig(), scene = new Scene(), fog = new Fog(0x000000);
    scene.fog = fog;
    scene.add(lamp(), caster());
    startShadowPrograms(r, scene, cam);
    expect(seen[0]!.fog).toBeNull();
    expect(scene.fog).toBe(fog);
  });

  it('counts a hidden caster, not a hidden material', () => {
    const { r, seen } = rig(), scene = new Scene(), shut = caster(new MeshStandardMaterial({ side: BackSide })), gone = new MeshStandardMaterial({ side: DoubleSide });
    shut.visible = false;
    gone.visible = false;
    scene.add(lamp(), shut, caster(gone));
    startShadowPrograms(r, scene, cam);
    expect(seen[0]!.meshes.map((m) => mat(m).side)).toEqual([FrontSide]);
  });

  it('keeps its depth materials for the next start, and holds no texture after the one it made', () => {
    const { r, seen } = rig(), scene = new Scene(), map = new Texture();
    scene.add(lamp(), caster(new MeshStandardMaterial({ map })));
    startShadowPrograms(r, scene, cam);
    startShadowPrograms(r, scene, cam);
    expect(seen[0]!.maps[0]).toBe(map);
    expect(seen[1]!.meshes[0]!.material).toBe(seen[0]!.meshes[0]!.material);
    expect(mat(seen[0]!.meshes[0]!).map).toBeNull();
    // (another renderer has materials of its own: a pool is per renderer)
    const other = rig();
    startShadowPrograms(other.r, scene, cam);
    expect(other.seen[0]!.meshes[0]!.material).not.toBe(seen[0]!.meshes[0]!.material);
  });
});

describe('startPassPrograms', () => {
  it('links for the attributes a pass draws with: three makes another program for a quad with others', () => {
    const seen: string[] = [], material = new Material();
    const r = {
      getRenderTarget: () => null, setRenderTarget: () => {},
      compile: (root: Mesh) => { seen.push(...Object.keys(root.geometry.attributes)); return new Set(); },
      properties: { get: () => ({}) },
    } as unknown as WebGLRenderer;
    startPassPrograms(r, [{ material }]);
    const drawn = (new FullScreenQuad(material) as unknown as { _mesh: Mesh })._mesh.geometry;
    expect(seen.sort()).toEqual(Object.keys(drawn.attributes).sort());
  });
});
