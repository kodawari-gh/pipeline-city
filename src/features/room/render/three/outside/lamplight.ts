// The street lamps' light on the ground (`view.ts`): a pool under each lamp along every avenue and street of the grid, painted at night by the
// ground's own materials (the asphalt, the pavements) in the ground's own colour, so the whole city's streets glow in lines to the hills. Near
// the window the pools sit under the lamps `street.ts` stands (`plan.ts`'s `lamps`); far off, where a pool is under a pixel, each row of
// them fades to its average, so the far grid does not shimmer.
import type { Material } from 'three';
import { GRID } from './plan';

/** The lamps' share of their full light (0 by day, 1 at night). */
export interface LampUniforms { lampNight: { value: number } }

/** The pools' light (linear, over the ground's colour) at their middle. */
const K = 2.2;

const FN = /* glsl */`
uniform float lampNight;
varying vec3 vLampW;
/** A row of pools along a line: d across from the row, s along it, every S (m), each r round; fw the pixel's size (m). */
float lampRow(float d, float s, float S, float r, float fw) {
  float k = (fract(s / S) - 0.5) * S;
  float one = exp(-(d * d + k * k) / (r * r)), row = exp(-d * d / (r * r)) * r * 1.7725 / S;
  return mix(one, row, smoothstep(0.15 * r, 0.6 * r, fw));
}
/** The lamps' light at a ground point w: the avenues' rows each side of the middle, the streets'. */
vec3 lampLight(vec3 w) {
  float fw = length(fwidth(w.xz));
  float ax = w.x - ${GRID.av0.toFixed(1)}, i = floor(ax / ${GRID.px.toFixed(1)} + 0.5), dx = abs(ax - i * ${GRID.px.toFixed(1)});
  float sz = -w.z - ${(GRID.street / 2).toFixed(1)}, j = floor(sz / ${GRID.pz.toFixed(1)} + 0.5), dz = abs(sz - j * ${GRID.pz.toFixed(1)});
  float a = lampRow(dx - 9.3, w.z + 30.0, 28.0, 7.5, fw), b = lampRow(dz - 5.3, w.x + 460.0, 30.0, 6.5, fw);
  return vec3(1.0, 0.78, 0.55) * (a + b) * lampNight;
}`;

/** Give a ground material the lamps' pools at night (its own `onBeforeCompile` still runs first). */
export function withLampLight(m: Material, u: LampUniforms): void {
  const prev = m.onBeforeCompile, key = `${m.customProgramCacheKey()}|lamps`;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.lampNight = u.lampNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLampW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLampW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FN}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * lampLight(vLampW) * ${K.toFixed(2)};`);
  };
  m.customProgramCacheKey = () => key;
  m.needsUpdate = true;
}
