import { BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderChunk, ShaderLib, Texture, type Material, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { STAND_IN_DECAY, applyLightmap, framed, keyFrames, lightmapped, meshHash, type Bake } from './lightmapmix';

const hashOf = (m: Mesh, root: Group) => { root.updateMatrixWorld(true); return meshHash(framed(m.geometry, new Matrix4().multiplyMatrices(root.matrixWorld.clone().invert(), m.matrixWorld)), m.geometry.index?.array ?? null); };
const compile = (m: Material) => {
  const sh = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(sh, {} as WebGLRenderer);
  return sh.fragmentShader;
};

describe('the baked bounce', () => {
  it('hashes a mesh by where it stands: the same mesh built again matches, a moved one does not', () => {
    const at = (x: number) => { const g = new Group(), m = new Mesh(new BoxGeometry(1000, 500, 200)); m.position.set(x, 0, 0); g.add(m); return hashOf(m, g); };
    expect(at(3000)).toBe(at(3000));
    expect(at(3000)).not.toBe(at(3400));
    expect(at(3000)).toMatch(/^24-[0-9a-f]{8}$/);
  });

  it('blends the two key frames round the hour, and holds the end ones outside them', () => {
    const h = [6, 8, 10];
    expect(keyFrames(7, h)).toEqual([[6, 0.5], [8, 0.5]]);
    expect(keyFrames(9.5, h)).toEqual([[8, 0.25], [10, 0.75]]);
    expect(keyFrames(5, h)).toEqual([[6, 1]]);
    expect(keyFrames(23, h)).toEqual([[10, 1]]);
  });

  it("takes the light map as the probe's irradiance and skips the stand-in light, and still draws as before without one", () => {
    // three's chunks must still hold the lines the patch replaces
    expect(ShaderChunk.lights_fragment_maps).toContain('irradiance += lightMapIrradiance;');
    expect(ShaderChunk.lights_fragment_maps).toContain('iblIrradiance += getIBLIrradiance( geometryNormal );');
    expect(ShaderChunk.lights_fragment_begin.split('getSpotLightInfo( spotLight, geometryPosition, directLight );').length).toBe(2);
    const m = new MeshStandardMaterial();
    let own = 0;
    m.onBeforeCompile = () => { own++; };
    lightmapped(m); lightmapped(m);
    const f = compile(m);
    expect(own).toBe(1);
    expect(f).toContain('iblIrradiance += lightMapIrradiance;');
    expect(f).toContain('#ifndef USE_LIGHTMAP');
    expect(f).toContain(`abs( spotLight.decay - ${STAND_IN_DECAY.toFixed(3)} )`);
    expect(f).not.toContain('#include <lights_fragment_maps>');
    expect(f).not.toContain('#include <lights_fragment_begin>');
    expect(m.customProgramCacheKey().split('|lm').length).toBe(2);
  });

  it('lights the meshes the bake knows: their UVs per corner, a shared material copied, the unknown ones named', () => {
    const root = new Group(), shared = new MeshStandardMaterial({ color: 0x808080 });
    const wall = new Mesh(new BoxGeometry(20000, 10000, 500), shared), knob = new Mesh(new BoxGeometry(100, 100, 100), shared);
    const rug = new Mesh(new PlaneGeometry(30000, 20000), new MeshStandardMaterial());
    wall.position.set(0, 5000, -250);
    rug.position.set(1000, 0, 9000);
    root.add(wall, knob, rug);
    const corners = wall.geometry.index!.count, uvs = new Uint16Array(2 * (corners + 10));
    for (let i = 0; i < corners; i++) { uvs[2 * (i + 10)] = i * 100; uvs[2 * (i + 10) + 1] = 65535; }
    const bake: Bake = {
      manifest: {
        version: 1, encoding: 'rgbm-sqrt', width: 64, height: 64, texelsPerMetre: 50, samples: 1, groups: [], dark: [],
        meshes: [{ name: 'wall', hash: hashOf(wall, root), corners, offset: 10 }, { name: 'gone', hash: '6-00000000', corners: 6, offset: 0 }],
      },
      maps: new Map(), uvs,
    };
    const map = new Texture(), twins: Material[] = [];
    const lit = applyLightmap(root, bake, map, { metre: 18700, twin: (_, c) => twins.push(c) });
    expect(lit.meshes).toEqual([wall]);
    expect(lit.stale).toBe(1);
    expect(lit.missing).toHaveLength(1);
    expect(lit.missing[0]).toMatch(/^mesh 4-/);
    // the wall lost its index (its UVs split at the seams) and reads its own run of the UVs
    expect(wall.geometry.index).toBeNull();
    const uv1 = wall.geometry.attributes.uv1!;
    expect(uv1.count).toBe(corners);
    expect(uv1.normalized).toBe(true);
    expect([uv1.getX(1), uv1.getY(1)]).toEqual([100 / 65535, 1]);
    // the knob keeps the plain material; the wall's copy takes the map and the patch, and keeps the source's own patches
    expect(knob.material).toBe(shared);
    expect(shared.lightMap).toBeNull();
    expect(twins).toEqual([wall.material]);
    const copy = wall.material as MeshStandardMaterial;
    expect(copy.lightMap).toBe(map);
    expect(copy.customProgramCacheKey()).toContain('|lm');
    // lit again (a bake loaded twice): the wall keeps the hash it was found by
    expect(applyLightmap(root, bake, map, { metre: 18700 }).meshes).toEqual([wall]);
  });
});
