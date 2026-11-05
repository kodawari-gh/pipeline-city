// The air over the city (`view.ts`): a haze thick at the street and thinning with height, so the far blocks fade into it, the towers' tops
// rise clear of it, and the hills beyond are only shapes. Its colour is the sky's at the horizon, warmer toward the sun; at night it is the
// city's own glow. Every material of the outside takes it in place of three's fog (`withHaze`); the lights on the road (`cars.ts`) are
// dimmed by it instead (`hzFog`).
import type { Color, Material, Vector3 } from 'three';

/** The haze's uniforms: its colour, the sun's light in it and the sun's way, its density at the street (per m) and its fall with height (per m). */
export interface HazeUniforms {
  hzCol: { value: Color }; hzSun: { value: Color }; hzDir: { value: Vector3 }; hzDensity: { value: number }; hzFall: { value: number };
}

/** The haze's maths for a fragment shader: how much of it lies between the eye and a world point, its colour that way. */
export const HAZE_FN = /* glsl */`
uniform vec3 hzCol, hzSun, hzDir;
uniform float hzDensity, hzFall;
float hzFog(vec3 w) {
  vec3 r = w - cameraPosition;
  float d = length(r), k = hzFall * r.y;
  float od = hzDensity * exp(-hzFall * cameraPosition.y) * d * (abs(k) > 1e-4 ? (1.0 - exp(-k)) / k : 1.0);
  return 1.0 - exp(-od);
}
vec3 hzApply(vec3 c, vec3 w) {
  vec3 v = normalize(w - cameraPosition);
  return mix(c, hzCol + hzSun * pow(max(dot(v, hzDir), 0.0), 8.0), hzFog(w));
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
