// The street's floor between the blocks (`view.ts`): the sky's light falls off toward the foot of a wall, where the wall hides most of the sky.
// A ground material takes it from the grid's lines; only the light from the sky goes, so the sunlit road stays bright and the shaded side of a
// street goes properly dark.
import type { Material } from 'three';
import { GRID } from './plan';

const FN = /* glsl */`
varying vec3 vCanyonW;
/** How much of the sky a ground point w sees: least at the foot of a wall, more toward the road's middle, all of it inside a block. */
float canyonSky(vec3 w) {
  float ax = w.x - ${GRID.av0.toFixed(1)}, dx = abs(ax - floor(ax / ${GRID.px.toFixed(1)} + 0.5) * ${GRID.px.toFixed(1)});
  float sz = -w.z - ${(GRID.street / 2).toFixed(1)}, dz = abs(sz - floor(sz / ${GRID.pz.toFixed(1)} + 0.5) * ${GRID.pz.toFixed(1)});
  vec2 d = vec2(${(GRID.avenue / 2).toFixed(1)} - dx, ${(GRID.street / 2).toFixed(1)} - dz);
  float s = 0.26 + 0.5 * smoothstep(0.0, 13.0, length(max(d, 0.0)));
  return max(d.x, d.y) < 0.0 ? 1.0 : s;
}`;

/** Give a ground material the street's shade (its own `onBeforeCompile` still runs first). */
export function withCanyon(m: Material): void {
  const prev = m.onBeforeCompile, key = `${m.customProgramCacheKey()}|canyon`;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCanyonW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCanyonW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FN}`)
      .replace('#include <aomap_fragment>', 'float canyon = canyonSky(vCanyonW);\nreflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, vec3(dot(reflectedLight.indirectDiffuse, vec3(0.3, 0.55, 0.15))), 0.45) * canyon;\nreflectedLight.indirectSpecular *= canyon;\n#include <aomap_fragment>');
  };
  m.customProgramCacheKey = () => key;
  m.needsUpdate = true;
}
