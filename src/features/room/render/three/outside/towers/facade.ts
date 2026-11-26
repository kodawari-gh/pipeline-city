// The buildings' material (`rings.ts` builds their geometry): a standard one whose colour, roughness, metalness and glow the facade's shader
// paints (`shaderLib.ts`, `shaderWall.ts`, `shaderKinds.ts`), with the uniforms the view sets by the hour.
import { Color, MeshStandardMaterial, Vector3 } from 'three';
import { FRAG_COMMON, VERT_BEGIN, VERT_COMMON } from './shaderLib';
import { FRAG_KINDS } from './shaderKinds';
import { FRAG_WALL } from './shaderWall';
import type { WebGLProgramParametersWithUniforms } from './types';

/** The facade's light by the hour: the lit rooms' share of their full glow at night, the clock for the beacons, the sun (direction, colour) and the horizon's colour, for what the glass mirrors and the shadows on a wall; and a picture's pixel in metres for each metre away. */
export interface FacadeUniforms {
  night: { value: number };
  time: { value: number };
  sun: { value: Vector3 };
  sunCol: { value: Color };
  hor: { value: Color };
  pixel: { value: number };
}

/** The sky's light, a little less blue than the sky: the clouds and the city's own walls send some of it. */
const AO_FRAGMENT =
  'reflectedLight.directDiffuse *= fVis;\nreflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, vec3(dot(reflectedLight.indirectDiffuse, vec3(0.3, 0.55, 0.15))), 0.45) * fAo;\nreflectedLight.indirectSpecular *= fAo * fSpec;\n#include <aomap_fragment>';

/** Three's standard shader sh with the facade's: its uniforms u, its attributes, and its colour, roughness, metalness and glow. */
function facadeShader(sh: WebGLProgramParametersWithUniforms, u: FacadeUniforms): void {
  sh.uniforms['fNight'] = u.night;
  sh.uniforms['fTime'] = u.time;
  sh.uniforms['fSun'] = u.sun;
  sh.uniforms['fSunCol'] = u.sunCol;
  sh.uniforms['fHor'] = u.hor;
  sh.uniforms['fPixel'] = u.pixel;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', VERT_COMMON)
    .replace('#include <begin_vertex>', VERT_BEGIN);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', FRAG_COMMON)
    .replace('#include <color_fragment>', `${FRAG_WALL}\n${FRAG_KINDS}`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;')
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + fTilt);')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fGlow;')
    .replace('#include <aomap_fragment>', AO_FRAGMENT);
}

/** The buildings' material: a standard one whose colour, roughness, metalness and glow the facade's shader paints. */
export function facadeMaterial(): { mat: MeshStandardMaterial; u: FacadeUniforms } {
  const u: FacadeUniforms = {
    night: { value: 0 },
    time: { value: 0 },
    sun: { value: new Vector3(0, 1, 0) },
    sunCol: { value: new Color(0, 0, 0) },
    hor: { value: new Color(0, 0, 0) },
    pixel: { value: 0 },
  };
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  mat.onBeforeCompile = (sh) => {
    facadeShader(sh, u);
  };
  mat.customProgramCacheKey = () => 'outside-facade';
  return { mat, u };
}
