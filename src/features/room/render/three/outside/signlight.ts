// A sign's light on the wall behind it (`view.ts`): at night each sign fixed to a wall (`towers.ts`) lays a soft wash of its colour on it, strongest
// at its edge, stuttering with it. One flat card per sign, a little off the wall, added over what is there.
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial } from 'three';
import { HAZE_FN, type HazeUniforms } from './haze';

/** A sign on a wall: the wall's plane (x or z fixed, at `at`, facing `out`), the board's middle along it and its half width, its heights, colour (sRGB hex), seed, lit box or neon. */
export interface SignWash { fixed: 'x' | 'z'; at: number; out: number; mid: number; half: number; y0: number; y1: number; colour: number; seed: number; box: boolean }

/** How far the card stands off the wall (m), how far the light reaches past the board (m), its strength. */
const OFF = 0.25, REACH = 2.5, LIGHT = 0.16;

const VERT = /* glsl */`
attribute vec2 pl;
attribute vec4 hs;
attribute vec3 tone;
varying vec2 vP;
varying vec4 vH;
varying vec3 vC;
varying vec3 vW;
void main() {
  vP = pl; vH = hs; vC = tone;
  vW = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
}`;

const FRAG = /* glsl */`
uniform float night;
varying vec2 vP;
varying vec4 vH;
varying vec3 vC;
varying vec3 vW;
${HAZE_FN}
float swHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 d = max(abs(vP) - vH.xy, vec2(0.0));
  float k = dot(d, d) / (vH.z * vH.z);
  float stutter = 1.0 - step(swHash(vec2(vH.w, 31.7)), 0.16) * 0.65 * step(0.7, swHash(vec2(floor(hzTime * 9.0), vH.w)));
  gl_FragColor = vec4(vC * exp(-k * 3.0) * smoothstep(1.0, 0.6, k) * stutter * night * (1.0 - hzFog(vW)), 1.0);
}`;

/** The cards for these signs, in one mesh. `night`: the facade's own share of the night, so they come on with the signs. */
export function signWashes(all: readonly SignWash[], haze: HazeUniforms, night: { value: number }): Mesh {
  const pos: number[] = [], pl: number[] = [], hs: number[] = [], tone: number[] = [], index: number[] = [], c = new Color();
  all.forEach((s, i) => {
    const hw = s.half, hh = (s.y1 - s.y0) / 2, r = REACH + 0.35 * Math.min(Math.max(hw * 2, 1), hh * 2), ym = (s.y0 + s.y1) / 2, a = hw + r, b = hh + r, at = s.at + s.out * OFF;
    c.setHex(s.colour).multiplyScalar(LIGHT * (s.box ? 1.5 : 1));
    for (const [u, v] of [[-a, -b], [a, -b], [a, b], [-a, b]] as const) {
      if (s.fixed === 'z') pos.push(s.mid + u, ym + v, at); else pos.push(at, ym + v, s.mid + u);
      pl.push(u, v);
      hs.push(hw, hh, r, s.seed);
      tone.push(c.r, c.g, c.b);
    }
    const n = i * 4;
    index.push(n, n + 1, n + 2, n, n + 2, n + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('pl', new BufferAttribute(new Float32Array(pl), 2));
  g.setAttribute('hs', new BufferAttribute(new Float32Array(hs), 4));
  g.setAttribute('tone', new BufferAttribute(new Float32Array(tone), 3));
  g.setIndex(index);
  const mat = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...haze, night }, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
  });
  const mesh = new Mesh(g, mat);
  mesh.frustumCulled = false;
  return mesh;
}
