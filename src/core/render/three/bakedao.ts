// Baked occlusion on a material (docs/render/cloth.md): a mesh whose vertices carry `_ao` (how open each is on its normal's side and on the
// other, 1 open, 0 shut) darkens by it the ambient light, the sheen and the reflections, and the direct light by `direct` of it (a shadow map
// is too coarse for a fold). Each face takes its own side's value, so a double-sided cloth is dark where it lies on the chair and in its folds.
import type { Material, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';

const shade = (direct: number) => /* glsl */`
#include <aomap_fragment>
float bakedAo = gl_FrontFacing ? vBakedAo.x : vBakedAo.y;
reflectedLight.indirectDiffuse *= bakedAo;
reflectedLight.directDiffuse *= mix( 1.0, bakedAo, ${direct.toFixed(3)} );
#ifdef USE_SHEEN
  sheenSpecularIndirect *= bakedAo;
#endif
#if defined( USE_ENVMAP ) && defined( STANDARD )
  reflectedLight.indirectSpecular *= computeSpecularOcclusion( saturate( dot( geometryNormal, geometryViewDir ) ), bakedAo, material.roughness );
#endif
`;

/** Patches `m` to darken by its mesh's `_ao` attribute; keeps an `onBeforeCompile` it already has. A material patched before stays as it is. */
export function bakedAo(m: Material, direct = 0.5): void {
  if (m.userData.bakedAo) return;
  m.userData.bakedAo = true;
  const prev = m.onBeforeCompile.bind(m), key = `${m.customProgramCacheKey()}|ao${direct}`;
  m.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r: WebGLRenderer) => {
    prev(sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 _ao;\nvarying vec2 vBakedAo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBakedAo = _ao;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBakedAo;')
      .replace('#include <aomap_fragment>', shade(direct));
  };
  m.customProgramCacheKey = () => key;
}
