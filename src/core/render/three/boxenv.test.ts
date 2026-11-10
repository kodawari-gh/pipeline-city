import { MeshStandardMaterial, ShaderChunk, ShaderLib, type Material, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { bakedAo } from './bakedao';
import { boxEnv, boxProjected } from './boxenv';

const box = boxEnv([0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5]);
// three's shader with every chunk in place, as the GPU gets it
const expand = (s: string): string =>
  s.replace(/^[ \t]*#include +<(\w+)>/gm, (_, n: string) => expand((ShaderChunk as unknown as Record<string, string>)[n] ?? ''));
const compiled = (m: Material) => {
  const sh = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(sh, {} as WebGLRenderer);
  return { vs: expand(sh.vertexShader), fs: expand(sh.fragmentShader), uniforms: sh.uniforms };
};
const count = (s: string, x: string) => s.split(x).length - 1;
/** One declaration of the varying a stage, one ray cast, one key: a program that compiles. */
const once = (m: Material) => {
  const { vs, fs, uniforms } = compiled(m);
  expect(count(vs, 'varying vec3 vBoxPos;')).toBe(1);
  expect(count(vs, 'vBoxPos = worldPosition.xyz;')).toBe(1);
  expect(count(fs, 'varying vec3 vBoxPos;')).toBe(1);
  expect(count(fs, 'vec3 boxProject(')).toBe(1);
  expect(count(fs, 'reflectVec = boxProject( reflectVec, roughness );')).toBe(1);
  expect(fs).not.toContain('#include');
  expect(Object.keys(uniforms)).toEqual(expect.arrayContaining(['boxMin', 'boxMax', 'boxAt', 'boxOn']));
  expect(count(m.customProgramCacheKey(), '|box')).toBe(1);
};

describe('box-projected reflections', () => {
  it('patches three\'s physical shader once', () => {
    const m = new MeshStandardMaterial();
    boxProjected(m, box);
    once(m);
  });

  it('patches a material once, with a patch between (a room built again reaches its pots twice)', () => {
    const m = new MeshStandardMaterial();
    boxProjected(m, box);
    bakedAo(m);
    const key = m.customProgramCacheKey();
    boxProjected(m, boxEnv([0, 0, 0], [2, 2, 2], [1, 1, 1]));
    expect(m.customProgramCacheKey()).toBe(key);
    once(m);
    expect(compiled(m).uniforms.boxMax).toBe(box.max);
  });

  it('a copy that took the hooks stays as it is; a plain clone takes its own patch', () => {
    const m = new MeshStandardMaterial();
    boxProjected(m, box);
    const copy = m.clone();
    copy.onBeforeCompile = m.onBeforeCompile;
    copy.customProgramCacheKey = m.customProgramCacheKey;
    boxProjected(copy, box);
    once(copy);
    // (three's clone keeps neither hook)
    const clone = m.clone();
    expect(compiled(clone).vs).not.toContain('vBoxPos');
    boxProjected(clone, box);
    once(clone);
  });
});
