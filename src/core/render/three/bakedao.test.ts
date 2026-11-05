import { MeshPhysicalMaterial, ShaderLib, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { bakedAo } from './bakedao';

describe('baked occlusion', () => {
  it("patches three's physical shader where it applies occlusion, and keeps the material's own patch", () => {
    const m = new MeshPhysicalMaterial({ sheen: 1 });
    let own = 0;
    m.onBeforeCompile = () => { own++; };
    bakedAo(m, 0.4);
    const sh = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(sh, {} as WebGLRenderer);
    expect(own).toBe(1);
    expect(sh.vertexShader).toContain('attribute vec2 _ao;');
    expect(sh.vertexShader).toContain('vBakedAo = _ao;');
    expect(sh.fragmentShader).toContain('varying vec2 vBakedAo;');
    expect(sh.fragmentShader).toContain('reflectedLight.directDiffuse *= mix( 1.0, bakedAo, 0.400 );');
    expect(m.customProgramCacheKey()).toContain('|ao0.4');
  });
});
