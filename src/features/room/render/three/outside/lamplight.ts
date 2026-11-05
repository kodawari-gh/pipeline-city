// The street lamps' light on the ground (`view.ts`): a pool under each lamp along every avenue and street of the grid, painted at night by the
// ground's own materials (the asphalt, the pavements) in the ground's own colour, so the whole city's streets glow in lines to the hills. Near
// the window the pools sit under the lamps `street.ts` stands (`plan.ts`'s `lamps`); far off, where a pool is under a pixel, each row of
// them fades to its average, so the far grid does not shimmer. The shop fronts' coloured light lies along the walls' feet the same way.
import type { Material } from 'three';
import { GRID } from './plan';

/** The lamps' share of their full light (0 by day, 1 at night). */
export interface LampUniforms { lampNight: { value: number } }

/** The pools' light (linear, over the ground's colour) at their middle, and the shop fronts' at the wall's foot, as a share of it. */
const K = 2.2, SHOPS = 0.7;

const FN = /* glsl */`
uniform float lampNight;
varying vec3 vLampW;
/** A row of pools along a line: d across from the row, s along it, every S (m), each r round; fw the pixel's size (m). */
float lampRow(float d, float s, float S, float r, float fw) {
  float k = (fract(s / S) - 0.5) * S;
  float one = exp(-(d * d + k * k) / (r * r)), row = exp(-d * d / (r * r)) * r * 1.7725 / S;
  return mix(one, row, smoothstep(0.15 * r, 0.6 * r, fw));
}
/** The shop fronts' light on the pavement: d out from the wall's foot, s along the wall on line n, a colour every 9 m, most warm, some the city's neon, some shut; fw the pixel's size (m). */
vec3 shopRow(float d, float s, float n, float fw) {
  float k = floor(s / 9.0), h = fract(sin(k * 12.9898 + n * 78.233) * 43758.5453), o = fract(h * 91.7);
  vec3 c = h < 0.5 ? vec3(1.0, 0.8, 0.58) : h < 0.64 ? vec3(0.3, 0.8, 1.0) : h < 0.78 ? vec3(1.0, 0.58, 0.2) : h < 0.92 ? vec3(1.0, 0.32, 0.2) : vec3(1.0, 0.26, 0.64);
  return mix(c * step(o, 0.8), vec3(0.8, 0.56, 0.4), smoothstep(1.5, 6.0, fw)) * step(0.0, d) * exp(-max(d, 0.0) / 2.6);
}
/** The lamps' light at a ground point w: the avenues' rows each side of the middle, the streets', and the shops' along the walls. */
vec3 lampLight(vec3 w) {
  float fw = length(fwidth(w.xz));
  float ax = w.x - ${GRID.av0.toFixed(1)}, i = floor(ax / ${GRID.px.toFixed(1)} + 0.5), dx = abs(ax - i * ${GRID.px.toFixed(1)});
  float sz = -w.z - ${(GRID.street / 2).toFixed(1)}, j = floor(sz / ${GRID.pz.toFixed(1)} + 0.5), dz = abs(sz - j * ${GRID.pz.toFixed(1)});
  float a = lampRow(dx - 9.3, w.z + 30.0, 28.0, 7.5, fw), b = lampRow(dz - 5.3, w.x + 460.0, 30.0, 6.5, fw);
  vec3 shops = shopRow(${(GRID.avenue / 2).toFixed(1)} - dx, w.z, i * 2.0 + sign(ax - i * ${GRID.px.toFixed(1)}), fw) + shopRow(${(GRID.street / 2).toFixed(1)} - dz, w.x, j * 2.0 + sign(sz - j * ${GRID.pz.toFixed(1)}) + 0.5, fw);
  return (vec3(1.0, 0.78, 0.55) * (a + b) + shops * ${SHOPS.toFixed(2)}) * lampNight;
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
