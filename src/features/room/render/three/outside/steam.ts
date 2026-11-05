// Steam over the city's roofs (`view.ts`): here and there a roof's plant breathes out a slow plume that leans with the wind and thins as it
// rises, pale in the sun by day, at night lit from below by the streets. Each is a quad turned to the eye, its plume drawn by its shader.
import { Color, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { HAZE_FN, type HazeUniforms } from './haze';
import { rng, topOf, type Building } from './plan';

/** The share of the buildings with a plume, and the heights they stand between (m). */
const SHARE = 0.05, LOW = 22, HIGH = 240;

const VERT = /* glsl */`
attribute vec4 plume;
attribute float seed;
varying vec2 vP;
varying float vSeed;
varying vec3 vW;
void main() {
  // turned to the eye round its own height, leaning with the wind more the higher it goes
  vec3 to = cameraPosition - plume.xyz, across = normalize(vec3(to.z, 0.0, -to.x));
  vW = plume.xyz + across * position.x * plume.w * 0.62 + vec3(0.0, position.y * plume.w * 1.3, 0.0) + vec3(0.8, 0.0, -0.3) * position.y * position.y * plume.w * 0.5;
  vP = vec2(position.x * 2.0, position.y);
  vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
}`;

const FRAG = /* glsl */`
uniform vec3 stCol, stLow;
varying vec2 vP;
varying float vSeed;
varying vec3 vW;
${HAZE_FN}
void main() {
  float t = hzTime * 0.16, y = clamp(vP.y, 0.0, 1.0);
  float n = 0.6 * hzBank(vec2(vP.x * 2.0 + vSeed, y * 8.0 - t + vSeed)) + 0.4 * hzBank(vec2(vP.x * 5.0 - vSeed, y * 19.0 - t * 2.1));
  float w = 0.1 + 0.62 * y, body = smoothstep(w, w * 0.2, abs(vP.x + (n - 0.5) * 1.1 * y));
  float a = body * smoothstep(0.0, 0.05, y) * pow(1.0 - y, 2.0) * smoothstep(0.26, 0.66, n + 0.32 * (1.0 - y));
  gl_FragColor = vec4(hzApply(mix(stLow, stCol, smoothstep(0.0, 0.7, y)), vW), a * 0.34);
}`;

/** The plumes' colours, set with the hour: high up, and low down where the streets light them at night. */
export interface SteamUniforms { stCol: { value: Color }; stLow: { value: Color } }

/** The plumes over these buildings, in one mesh. */
export function roofSteam(all: readonly Building[], haze: HazeUniforms): { mesh: Mesh; u: SteamUniforms } {
  const plumes: number[] = [], seeds: number[] = [];
  for (const b of all) {
    const r = rng(b.seed ^ 0x57ea), t = b.tiers[b.tiers.length - 1]!, h = topOf(b);
    if (r() > SHARE || h < LOW || h > HIGH || b.crown === 'spire' || b.crown === 'lantern') continue;
    plumes.push(t.x0 + (t.x1 - t.x0) * (0.25 + 0.5 * r()), h, t.z0 + (t.z1 - t.z0) * (0.25 + 0.5 * r()), 14 + 18 * r() + h * 0.04);
    seeds.push(r() * 100);
  }
  const quad = new PlaneGeometry(1, 1).translate(0, 0.5, 0), g = new InstancedBufferGeometry().copy(quad as unknown as InstancedBufferGeometry);
  quad.dispose();
  g.setAttribute('plume', new InstancedBufferAttribute(new Float32Array(plumes), 4));
  g.setAttribute('seed', new InstancedBufferAttribute(new Float32Array(seeds), 1));
  g.instanceCount = seeds.length;
  const u: SteamUniforms = { stCol: { value: new Color() }, stLow: { value: new Color() } };
  const mesh = new Mesh(g, new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...haze, ...u }, transparent: true, depthWrite: false }));
  mesh.frustumCulled = false;
  return { mesh, u };
}
