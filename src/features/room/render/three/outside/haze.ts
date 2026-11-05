// The air over the city (`view.ts`): a haze thick at the street and thinning with height, so the far blocks fade into it, the towers' tops
// rise clear of it, and the hills beyond are only shapes. Its colour is the sky's at the horizon, warmer toward the sun; at night it is the
// city's own glow. Under it at night lies a thin mist in slow banks, lit from below by the streets, so each layer of the city stands clear of the
// glow behind it. Every material of the outside takes it in place of three's fog (`withHaze`); the lights on the road (`cars.ts`) are dimmed by
// it instead (`hzFog`).
import type { Color, Material, Vector3 } from 'three';

/** The haze's uniforms: its colour, the sun's light in it and the sun's way, its density at the street (per m) and its fall with height (per m), the low mist's colour and density at the street (per m), the clock. */
export interface HazeUniforms {
  hzCol: { value: Color }; hzSun: { value: Color }; hzDir: { value: Vector3 }; hzDensity: { value: number }; hzFall: { value: number };
  hzMist: { value: Color }; hzMistD: { value: number }; hzTime: { value: number };
}

/** The low mist's fall with height (per m), and how wide its banks are (per m). */
const MIST_FALL = 1 / 70, MIST_BANK = 1 / 760;

/** The haze's maths for a fragment shader: how much of it lies between the eye and a world point, its colour that way. */
export const HAZE_FN = /* glsl */`
uniform vec3 hzCol, hzSun, hzDir, hzMist;
uniform float hzDensity, hzFall, hzMistD, hzTime;
float hzOd(vec3 r, float fall, float density) {
  float d = length(r), k = fall * r.y;
  return density * exp(-fall * cameraPosition.y) * d * (abs(k) > 1e-4 ? (1.0 - exp(-k)) / k : 1.0);
}
float hzFog(vec3 w) { return 1.0 - exp(-hzOd(w - cameraPosition, hzFall, hzDensity)); }
float hzBank(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)), dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7)), dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7)), dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7)))) * 43758.5453);
  return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
}
/** The low mist's share on the way to a point: its banks are the noise at the point's own place, so a whole tower stands in one. */
float hzLow(vec3 w) {
  if (hzMistD <= 0.0) return 0.0;
  vec2 q = w.xz * ${MIST_BANK.toFixed(6)} + vec2(hzTime * 0.004, hzTime * 0.0017);
  return 1.0 - exp(-hzOd(w - cameraPosition, ${MIST_FALL.toFixed(6)}, hzMistD) * (0.5 + 1.0 * hzBank(q)));
}
vec3 hzApply(vec3 c, vec3 w) {
  vec3 v = normalize(w - cameraPosition);
  c = mix(c, hzCol + hzSun * pow(max(dot(v, hzDir), 0.0), 8.0), hzFog(w));
  return mix(c, hzMist, hzLow(w));
}`;

/** A world point for the haze: the vertex where it stands (each instance too). */
const VERT = /* glsl */`
vec4 hzP = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
hzP = instanceMatrix * hzP;
#endif
vHzW = (modelMatrix * hzP).xyz;`;

const patched = new WeakSet<Material>();

/** Give a built-in material the haze in place of three's fog (its own `onBeforeCompile` still runs first). */
export function withHaze(m: Material, u: HazeUniforms): void {
  if (patched.has(m) || (m as { isShaderMaterial?: boolean }).isShaderMaterial) return;
  patched.add(m);
  const prev = m.onBeforeCompile, key = `${m.customProgramCacheKey()}|haze`;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <fog_pars_vertex>', 'varying vec3 vHzW;').replace('#include <fog_vertex>', VERT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <fog_pars_fragment>', `varying vec3 vHzW;\n${HAZE_FN}`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = hzApply(gl_FragColor.rgb, vHzW);');
  };
  m.customProgramCacheKey = () => key;
  m.needsUpdate = true;
}
