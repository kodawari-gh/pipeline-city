import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderChunk,
  ShaderLib,
  ShaderMaterial,
  Texture,
  Vector3,
} from 'three';
import type * as threeTypes from 'three';
import { assert, describe, expect, it } from 'vitest';
import { LightmapMix, STAND_IN_DECAY, applyLightmap, framed, keyFrames, lightmapped, meshHash } from './lightmapmix';
import type * as lightmapmixTypes from './lightmapmix';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const hashOf = (m: Mesh, root: Group) => {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert(),
    local = new Matrix4().multiplyMatrices(toRoot, m.matrixWorld);
  return meshHash(framed(m.geometry, local), m.geometry.index?.array ?? null);
};
/** The hash of a box standing at `x`, alone in its group. */
const hashAt = (x: number) => {
  const g = new Group(),
    m = new Mesh(new BoxGeometry(1000, 500, 200));
  m.position.set(x, 0, 0);
  g.add(m);
  return hashOf(m, g);
};
const isCompileParams = (x: unknown): x is threeTypes.WebGLProgramParametersWithUniforms =>
  typeof x === 'object' && x !== null && 'vertexShader' in x && 'fragmentShader' in x && 'uniforms' in x;
/** A renderer as far as the code under test reaches into one (each fake has the parts its test needs). */
const isRenderer = (x: unknown): x is threeTypes.WebGLRenderer =>
  typeof x === 'object' && x !== null && 'getRenderTarget' in x;
const isMesh = (o: unknown): o is Mesh => o instanceof Mesh;
/** The shader material of a mesh the mix drew or compiled, failing the test when it is something else. */
function shaderOf(o: unknown): ShaderMaterial {
  assert(isMesh(o), 'expected a mesh');
  assert.instanceOf(o.material, ShaderMaterial);
  return o.material;
}
/** The value of a vector uniform, as a list. */
function vectorOf(u: threeTypes.IUniform | undefined): number[] {
  const v: unknown = must(u).value;
  assert.instanceOf(v, Vector3);
  return v.toArray();
}
/** The channel selector a draw of a direct map carries, if it carries one. */
const selOf = (u: Record<string, threeTypes.IUniform>) => (u['sel'] === undefined ? {} : { sel: vectorOf(u['sel']) });
/** The mix's own quad (private: the test reads it to see the sum's material is left on it). */
function quadOf(mix: unknown): Mesh {
  assert(typeof mix === 'object' && mix !== null && 'quad' in mix && isMesh(mix.quad), 'the mix has its quad');
  return mix.quad;
}
const compile = (m: threeTypes.Material) => {
  const sh = {
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
      uniforms: {},
    },
    renderer = { getRenderTarget: () => null };
  assert(isCompileParams(sh));
  assert(isRenderer(renderer));
  m.onBeforeCompile(sh, renderer);
  return sh.fragmentShader;
};

describe('the baked bounce', () => {
  it('hashes a mesh by where it stands: the same mesh built again matches, a moved one does not', () => {
    expect(hashAt(3000)).toBe(hashAt(3000));
    expect(hashAt(3000)).not.toBe(hashAt(3400));
    expect(hashAt(3000)).toMatch(/^24-[0-9a-f]{8}$/u);
  });

  it('blends the two key frames round the hour, and holds the end ones outside them', () => {
    const h = [6, 8, 10];
    expect(keyFrames(7, h)).toStrictEqual([
      [6, 0.5],
      [8, 0.5],
    ]);
    expect(keyFrames(9.5, h)).toStrictEqual([
      [8, 0.25],
      [10, 0.75],
    ]);
    expect(keyFrames(5, h)).toStrictEqual([[6, 1]]);
    expect(keyFrames(23, h)).toStrictEqual([[10, 1]]);
  });

  it("takes the light map as the probe's irradiance and skips the stand-in light, and still draws as before without one", () => {
    // three's chunks must still hold the lines the patch replaces
    expect(ShaderChunk.lights_fragment_maps).toContain('irradiance += lightMapIrradiance;');
    expect(ShaderChunk.lights_fragment_maps).toContain('iblIrradiance += getIBLIrradiance( geometryNormal );');
    expect(
      ShaderChunk.lights_fragment_begin.split('getSpotLightInfo( spotLight, geometryPosition, directLight );'),
    ).toHaveLength(2);
    const m = new MeshStandardMaterial();
    let own = 0;
    m.onBeforeCompile = () => {
      own++;
    };
    lightmapped(m);
    lightmapped(m);
    const f = compile(m);
    expect(own).toBe(1);
    expect(f).toContain('iblIrradiance += lightMapIrradiance;');
    expect(f).toContain('#ifndef USE_LIGHTMAP');
    expect(f).toContain(`abs( spotLight.decay - ${STAND_IN_DECAY.toFixed(3)} )`);
    expect(f).not.toContain('#include <lights_fragment_maps>');
    expect(f).not.toContain('#include <lights_fragment_begin>');
    expect(m.customProgramCacheKey().split('|lm')).toHaveLength(2);
  });

  it('lights the meshes the bake knows: their UVs per corner, a shared material copied, the unknown ones named', () => {
    const root = new Group(),
      shared = new MeshStandardMaterial({ color: 0x80_80_80 });
    const wall = new Mesh(new BoxGeometry(20_000, 10_000, 500), shared),
      knob = new Mesh(new BoxGeometry(100, 100, 100), shared);
    const rug = new Mesh(new PlaneGeometry(30_000, 20_000), new MeshStandardMaterial());
    wall.position.set(0, 5000, -250);
    rug.position.set(1000, 0, 9000);
    root.add(wall, knob, rug);
    const corners = must(wall.geometry.index).count,
      uvs = new Uint16Array(2 * (corners + 10));
    for (let i = 0; i < corners; i++) {
      uvs[2 * (i + 10)] = i * 100;
      uvs[2 * (i + 10) + 1] = 65_535;
    }
    const bake: lightmapmixTypes.Bake = {
      manifest: {
        version: 1,
        encoding: 'rgbm-sqrt',
        width: 64,
        height: 64,
        texelsPerMetre: 50,
        samples: 1,
        groups: [],
        dark: [],
        meshes: [
          { name: 'wall', hash: hashOf(wall, root), corners, offset: 10 },
          { name: 'gone', hash: '6-00000000', corners: 9, offset: 0 },
        ],
      },
      maps: new Map(),
      uvs,
    };
    const map = new Texture(),
      twins: threeTypes.Material[] = [];
    const lit = applyLightmap(root, bake, map, {
      metre: 18_700,
      twin: (_, c) => {
        twins.push(c);
      },
    });
    expect(lit.meshes).toStrictEqual([wall]);
    expect(lit.stale).toBe(1);
    expect(lit.missing).toHaveLength(1);
    expect(lit.missing[0]).toMatch(/^mesh 4-/u);
    // the wall lost its index (its UVs split at the seams) and reads its own run of the UVs
    expect(wall.geometry.index).toBeNull();
    const uv1 = must(wall.geometry.attributes['uv1']);
    expect(uv1.count).toBe(corners);
    expect(uv1.normalized).toBe(true);
    expect([uv1.getX(1), uv1.getY(1)]).toStrictEqual([100 / 65_535, 1]);
    // the knob keeps the plain material; the wall's copy takes the map and the patch, and keeps the source's own patches
    expect(knob.material).toBe(shared);
    expect(shared.lightMap).toBeNull();
    expect(twins).toStrictEqual([wall.material]);
    const copy = wall.material;
    expect(copy.lightMap).toBe(map);
    expect(copy.customProgramCacheKey()).toContain('|lm');
    // lit again (a bake loaded twice): the wall keeps the hash it was found by
    expect(applyLightmap(root, bake, map, { metre: 18_700 }).meshes).toStrictEqual([wall]);
  });

  it('a mesh that moved since the bake keeps its baked light: found by its count of corners, in the order of the tree', () => {
    const root = new Group(),
      top = new Mesh(new BoxGeometry(20_000, 500, 8000), new MeshStandardMaterial());
    const matA = new Mesh(new PlaneGeometry(9000, 4000), new MeshStandardMaterial()),
      matB = new Mesh(new PlaneGeometry(4000, 4000), new MeshStandardMaterial());
    root.add(top, matA, matB);
    const n = must(top.geometry.index).count,
      uvs = new Uint16Array(2 * (n + 12));
    const entries = [
      { name: 'top', hash: hashOf(top, root), corners: n, offset: 0 },
      { name: 'a', hash: hashOf(matA, root), corners: 6, offset: n },
      { name: 'b', hash: hashOf(matB, root), corners: 6, offset: n + 6 },
    ];
    const bake: lightmapmixTypes.Bake = {
      manifest: {
        version: 1,
        encoding: 'rgbm-sqrt',
        width: 64,
        height: 64,
        texelsPerMetre: 50,
        samples: 1,
        groups: [],
        dark: [],
        meshes: entries,
      },
      maps: new Map(),
      uvs,
    };
    // the desk rises with a larger case: the three move, the top grows too
    top.scale.x = 1.1;
    const moved: Mesh[] = [top, matA, matB];
    for (const m of moved) {
      m.position.y = 2800;
    }
    const lit = applyLightmap(root, bake, new Texture(), { metre: 18_700 });
    expect(lit).toMatchObject({ stale: 0, missing: [], loose: 3 });
    expect(lit.meshes).toStrictEqual(moved);
    expect(matA.userData['bakeHash']).toBe(must(entries[1]).hash);
    expect(matB.userData['bakeHash']).toBe(must(entries[2]).hash);
  });

  it("starts the programs of both its materials, each once, and leaves the quad with the sum's", () => {
    const bake: lightmapmixTypes.Bake = {
      manifest: {
        version: 1,
        encoding: 'rgbm-sqrt',
        width: 8,
        height: 8,
        texelsPerMetre: 50,
        samples: 1,
        dark: [],
        meshes: [],
        groups: [],
      },
      maps: new Map(),
      uvs: new Uint16Array(0),
    };
    const mix = new LightmapMix(bake),
      shaders: string[] = [],
      quad = quadOf(mix),
      sum = quad.material;
    const renderer = {
      getRenderTarget: () => null,
      setRenderTarget() {
        /* none */
      },
      compile: (m: unknown) => {
        const mat = shaderOf(m);
        shaders.push(mat.fragmentShader);
        return new Set([mat]);
      },
      properties: { get: () => ({ currentProgram: { isReady: () => true } }) },
    };
    assert(isRenderer(renderer));
    expect(mix.startPrograms(renderer)).toHaveLength(2);
    expect(new Set(shaders).size).toBe(2);
    expect(quad.material).toBe(sum);
    mix.dispose();
  });

  it("adds a capped lamp group's direct light from its channel, with its hue and its level over the baked one", () => {
    const bounce = new Texture(),
      packed = new Texture();
    const bake: lightmapmixTypes.Bake = {
      manifest: {
        version: 1,
        encoding: 'rgbm-sqrt',
        width: 8,
        height: 8,
        texelsPerMetre: 50,
        samples: 1,
        dark: [],
        meshes: [],
        groups: [{ id: 'led', kind: 'lamp', file: 'led.png', scale: 2, lead: 4 }],
        direct: {
          files: ['direct-0.png'],
          groups: [
            { id: 'floor', map: 0, channel: 0, scale: 1, colour: [1, 1, 1], lead: 1 },
            { id: 'led', map: 0, channel: 2, scale: 10, colour: [0.5, 1, 1], lead: 4 },
          ],
        },
      },
      maps: new Map([['led', bounce]]),
      uvs: new Uint16Array(0),
    };
    const mix = new LightmapMix(bake),
      draws: { map: unknown; k: number[]; sel?: number[] }[] = [];
    const renderer = {
      getRenderTarget: () => null,
      getClearColor: (c: threeTypes.Color) => c,
      getClearAlpha: () => 1,
      autoClear: true,
      setRenderTarget() {
        /* none */
      },
      setClearColor() {
        /* none */
      },
      clear() {
        /* none */
      },
      render(scene: threeTypes.Scene) {
        const u = shaderOf(scene.children[0]).uniforms,
          map: unknown = must(u['map']).value;
        draws.push({ map, k: vectorOf(u['k']), ...selOf(u) });
      },
    };
    assert(isRenderer(renderer));
    // not loaded yet: the bounce alone, and the room keeps its lift
    expect(mix.hasDirect('led')).toBe(false);
    mix.mix(renderer, new Map([['led', 2]]), new Map([['led', 2]]));
    expect(draws).toStrictEqual([{ map: bounce, k: [1, 1, 1] }]);
    // loaded: the capped group's channel is added; a group at no level (`floor`) and one with no direct map (`desk`) add nothing
    bake.direct = [packed];
    expect(mix.hasDirect('led')).toBe(true);
    expect(mix.hasDirect('desk')).toBe(false);
    draws.length = 0;
    mix.mix(
      renderer,
      new Map([['led', 2]]),
      new Map([
        ['led', 2],
        ['floor', 0],
        ['desk', 3],
      ]),
    );
    expect(draws).toStrictEqual([
      { map: bounce, k: [1, 1, 1] },
      { map: packed, k: [2.5, 5, 5], sel: [0, 0, 1] },
    ]);
    // and the next mix starts with the bounce's material again
    draws.length = 0;
    mix.mix(renderer, new Map([['led', 2]]));
    expect(draws).toStrictEqual([{ map: bounce, k: [1, 1, 1] }]);
  });
});
