// The case's shadow without a shadow map (Low: `shadows` 0). At High the case's walls shade its inside: the sun, the window and the lamps
// reach a part only through the glass side or the top filter. Low draws no shadow map, so every spot light lit every part as if the case
// had no walls (a RAM board read bright green, High's reads near black). Here a fragment inside the case's box follows each spot light's ray
// to the face of the box it leaves through, and takes that face's share of the light. One ray-box exit a light, no texture.
import './arealoop';
import {
  Matrix4,
  ShaderChunk,
  Vector3,
  type Box3,
  type Material,
  type Mesh,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';

/** The share of a spot light each face of the case lets in: the faces toward +x, +y, +z of the case's box, then those toward -x, -y, -z. */
export interface CasePass {
  plus: readonly [number, number, number];
  minus: readonly [number, number, number];
}

/** The uniforms every shaded material shares: the world to the case's box as the cube -1..1, and the faces' shares. */
export const CASE_SHADE = {
  inv: { value: new Matrix4() },
  plus: { value: new Vector3(1, 1, 1) },
  minus: { value: new Vector3(1, 1, 1) },
};

const UNIT = new Matrix4(),
  C = new Vector3(),
  H = new Vector3();
/** Sets the case: its box in the frame of `world` (the machine's root), and what each face lets in. */
export function setCaseShade(box: Box3, world: Matrix4, pass: CasePass): void {
  box.getCenter(C);
  box.getSize(H).multiplyScalar(0.5);
  CASE_SHADE.inv.value
    .copy(world)
    .multiply(UNIT.makeScale(H.x, H.y, H.z).setPosition(C))
    .invert();
  CASE_SHADE.plus.value.fromArray(pass.plus);
  CASE_SHADE.minus.value.fromArray(pass.minus);
}

export const CASE_PARS = `
uniform mat4 uCaseInv;
uniform vec3 uCasePlus;
uniform vec3 uCaseMinus;
// the share of a light from the direction dirView (view space, toward the light) that reaches the fragment at posView through the case
float caseShade( vec3 posView, vec3 dirView ) {
  vec3 p = ( uCaseInv * vec4( cameraPosition + ( vec4( posView, 0.0 ) * viewMatrix ).xyz, 1.0 ) ).xyz;
  vec3 a = abs( p );
  if ( max( a.x, max( a.y, a.z ) ) >= 1.0 ) return 1.0;
  vec3 d = mat3( uCaseInv ) * ( vec4( dirView, 0.0 ) * viewMatrix ).xyz;
  vec3 s = mix( vec3( -1.0 ), vec3( 1.0 ), step( 0.0, d ) );
  vec3 t = ( s - p ) / ( s * max( abs( d ), vec3( 1e-6 ) ) );
  vec3 pass = mix( uCaseMinus, uCasePlus, step( 0.0, d ) );
  return t.x < t.y ? ( t.x < t.z ? pass.x : pass.z ) : ( t.y < t.z ? pass.y : pass.z );
}`;
const SPOT_INFO = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';
const BEGIN = '#include <lights_fragment_begin>';
if (!ShaderChunk.lights_fragment_begin.includes(SPOT_INFO))
  throw new Error('case shade: three has no spot light call to patch');
const SHADED = ShaderChunk.lights_fragment_begin.replace(
  SPOT_INFO,
  `${SPOT_INFO}\n\t\tdirectLight.color *= caseShade( geometryPosition, directLight.direction );`,
);

/** Patches a lit shader to shade its spot lights by the case. A shader whose light loop another patch already replaced stays as it is. */
export function caseShadePatch(sh: { fragmentShader: string; uniforms?: Record<string, unknown> }): boolean {
  const f = sh.fragmentShader;
  if (!f.includes(BEGIN) || !f.includes('#include <common>')) return false;
  sh.fragmentShader = f.replace('#include <common>', `#include <common>\n${CASE_PARS}`).replace(BEGIN, SHADED);
  if (sh.uniforms)
    Object.assign(sh.uniforms, { uCaseInv: CASE_SHADE.inv, uCasePlus: CASE_SHADE.plus, uCaseMinus: CASE_SHADE.minus });
  return true;
}

type Lit = Material & { isMeshLambertMaterial?: boolean; isMeshStandardMaterial?: boolean };
/** The materials shaded now (a Lambert shares its source's `userData`, so the mark is not kept there). */
const done = new WeakSet<Material>();
const isLit = (m: Lit): boolean => m.isMeshLambertMaterial === true || m.isMeshStandardMaterial === true;

/**
 * Shades the lit materials (Lambert, standard) of the meshes under `root` by the case, and returns the function that undoes it. Apply it after
 * `cheapMaterials`, so it takes the Lamberts. Call `sync` after a rebuild adds meshes. A material is patched once, whoever shares it.
 */
export function caseShaded(root: Object3D): { sync(): void; undo(): void } {
  const was = new Map<Material, { before: Material['onBeforeCompile']; key: Material['customProgramCacheKey'] }>();
  const shade = (m: Lit) => {
    if (!isLit(m) || done.has(m)) return;
    const before = m.onBeforeCompile,
      key = m.customProgramCacheKey,
      fixed = m.customProgramCacheKey();
    was.set(m, { before, key });
    done.add(m);
    m.onBeforeCompile = function (this: Material, sh: WebGLProgramParametersWithUniforms, r: WebGLRenderer) {
      before.call(this, sh, r);
      caseShadePatch(sh);
    };
    // (read now: three's own key is the text of `onBeforeCompile`, which changes on the line above)
    const shaded = `${fixed}|case`;
    m.customProgramCacheKey = () => shaded;
    m.needsUpdate = true;
  };
  const sync = () =>
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material)) mesh.material.forEach(shade);
      else shade(mesh.material);
    });
  sync();
  return {
    sync,
    undo() {
      for (const [m, w] of was) {
        m.onBeforeCompile = w.before;
        m.customProgramCacheKey = w.key;
        done.delete(m);
        m.needsUpdate = true;
      }
      was.clear();
    },
  };
}
