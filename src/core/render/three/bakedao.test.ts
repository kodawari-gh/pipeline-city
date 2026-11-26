import { MeshPhysicalMaterial, ShaderLib } from 'three';
import type * as threeTypes from 'three';
import { assert, describe, expect, it, vi } from 'vitest';
import { bakedAo } from './bakedao';

const isCompileParams = (x: unknown): x is threeTypes.WebGLProgramParametersWithUniforms =>
  typeof x === 'object' && x !== null && 'vertexShader' in x && 'fragmentShader' in x && 'uniforms' in x;
/** A renderer as far as a shader patch sees one (none of them draws with it). */
const isRenderer = (x: unknown): x is threeTypes.WebGLRenderer => typeof x === 'object' && x !== null && 'render' in x;
/** Three's physical shaders, as three gives them to `onBeforeCompile`. */
function compileParams(): threeTypes.WebGLProgramParametersWithUniforms {
  const sh = {
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
    uniforms: {},
  };
  assert(isCompileParams(sh));
  return sh;
}
/** A renderer that draws nothing. */
function stubRenderer(): threeTypes.WebGLRenderer {
  const r = { render: vi.fn<() => void>() };
  assert(isRenderer(r));
  return r;
}

describe('baked occlusion', () => {
  it("patches three's physical shader where it applies occlusion, and keeps the material's own patch", () => {
    const m = new MeshPhysicalMaterial({ sheen: 1 });
    let own = 0;
    m.onBeforeCompile = () => {
      own++;
    };
    bakedAo(m, 0.4);
    const sh = compileParams();
    m.onBeforeCompile(sh, stubRenderer());
    expect(own).toBe(1);
    expect(sh.vertexShader).toContain('attribute vec2 _ao;');
    expect(sh.vertexShader).toContain('vBakedAo = _ao;');
    expect(sh.fragmentShader).toContain('varying vec2 vBakedAo;');
    expect(sh.fragmentShader).toContain('reflectedLight.directDiffuse *= mix( 1.0, bakedAo, 0.400 );');
    expect(m.customProgramCacheKey()).toContain('|ao0.4');
  });

  it('patches a material once (a room built again shares its pots)', () => {
    const m = new MeshPhysicalMaterial();
    bakedAo(m);
    bakedAo(m);
    const sh = compileParams();
    m.onBeforeCompile(sh, stubRenderer());
    expect(sh.vertexShader.split('attribute vec2 _ao;')).toHaveLength(2);
    expect(m.customProgramCacheKey().split('|ao')).toHaveLength(2);
  });
});
