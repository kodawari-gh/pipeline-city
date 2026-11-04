// Box-projected reflections: a probe sees the room from one point, so a plain cube map puts what it saw at an infinite distance and a glossy floor
// shows the window in the wrong place. Here each fragment follows its reflected ray to the room's box (a wall, the floor, the ceiling) and looks up
// the probe toward that hit point instead: the window lands in the floor where it should, near things grow and slide as the eye moves. One ray
// against six planes a fragment; the same program for all, switched on and off by a uniform (the studio's environment is not a room).
import { ShaderChunk, Vector3, type Material, type WebGLProgramParametersWithUniforms } from 'three';

/** The box and the probe's point (world), shared by all the materials it patches; `on` is 0 until the probe holds the room. */
export interface BoxEnv { min: { value: Vector3 }; max: { value: Vector3 }; at: { value: Vector3 }; on: { value: number } }

export function boxEnv(min: readonly number[], max: readonly number[], at: readonly number[]): BoxEnv {
  return { min: { value: new Vector3(...min) }, max: { value: new Vector3(...max) }, at: { value: new Vector3(...at) }, on: { value: 0 } };
}

const PARS = /* glsl */`
uniform vec3 boxMin, boxMax, boxAt;
uniform float boxOn;
varying vec3 vBoxPos;
// the reflected ray (world) from this fragment, turned toward where it meets the room's box as the probe sees it; rough surfaces keep more of
// the plain direction (their blur hides the shift, and a wide lobe has no single hit point)
vec3 boxProject( vec3 d, float roughness ) {
  vec3 a = ( boxMax - vBoxPos ) / d, b = ( boxMin - vBoxPos ) / d, f = max( a, b );
  float t = max( min( min( f.x, f.y ), f.z ), 0.0 );
  vec3 p = normalize( vBoxPos + d * t - boxAt );
  // only inside the room (with a margin for the window's reveal): the city out there is not in the box
  float inside = float( all( greaterThan( vBoxPos, boxMin - 4000.0 ) ) && all( lessThan( vBoxPos, boxMax + 4000.0 ) ) );
  return normalize( mix( d, p, boxOn * inside * ( 1.0 - roughness * roughness ) ) );
}
`;

const RADIANCE = ShaderChunk.envmap_physical_pars_fragment.replace(
  'vec4 envMapColor = textureLod( envMap, envMapRotation * reflectVec, roughnessToMip( roughness ) );',
  'reflectVec = boxProject( reflectVec, roughness );\n\t\t\tvec4 envMapColor = textureLod( envMap, envMapRotation * reflectVec, roughnessToMip( roughness ) );',
);

/** Patches a material's shader to project its reflections onto `box`; keeps an `onBeforeCompile` it already has. */
export function boxProjected(m: Material, box: BoxEnv): void {
  const prev = m.onBeforeCompile.bind(m), key = m.customProgramCacheKey() + '|box';
  m.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, { boxMin: box.min, boxMax: box.max, boxAt: box.at, boxOn: box.on });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBoxPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBoxPos = worldPosition.xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <envmap_physical_pars_fragment>', `${PARS}\n${RADIANCE}`);
  };
  m.customProgramCacheKey = () => key;
}
