// The sky over the street (`view.ts`): a dome round the camera, drawn first, whose shader paints the hour's sky. The horizon's colour low down
// and the zenith's overhead (`skyAt`), at the warm hour bands of ember, rose and violet under a deep blue, brightest toward the sun with the
// earth's shadow opposite it; the sun's wide glow and its disc, a layer of clouds that drifts and is lit from the sun's side, or from below at
// dusk and by the city at night, the moon and the stars, the city's glow low in the sky. Under the horizon it is the land's haze. A small copy of
// the dome is what the view's environment sees (its sky light).
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

/** The warm hour's sky low down (linear): the ember toward the sun, and the earth's shadow away from it. `view.ts` gives the haze the same. */
export const EMBER = new Color(0.95, 0.33, 0.09), EARTH_SHADOW = new Color(0.13, 0.1, 0.18);
const vec = (c: Color): string => `vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`;

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
uniform vec3 top, hor, ground, sunDir, sunCol, moonDir, glow, mist;
uniform float night, time, clouds, dusk, duskK;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float e = d.y, cs = max(dot(d, sunDir), 0.0), up = smoothstep(-0.12, 0.03, sunDir.y);
  // the sky: the horizon's colour low down, the zenith's overhead
  vec3 c = mix(hor, top, pow(clamp(e, 0.0, 1.0), 0.3));
  // the warm hour: the low sun's light crossing the air in bands, ember on the horizon, then rose, violet and a deep blue overhead. Toward the
  // sun they burn; away from it the earth's shadow lies blue on the horizon under a pink belt
  float side = 0.5 + 0.5 * dot(normalize(d.xz + 1e-4), normalize(sunDir.xz + 1e-4)), near = side * side;
  float hi = max(e, 0.0);
  vec3 band = mix(${vec(EARTH_SHADOW)}, ${vec(EMBER)}, near);
  band = mix(band, mix(vec3(0.3, 0.14, 0.2), vec3(0.62, 0.19, 0.15), near), smoothstep(0.0, 0.045, hi));
  band = mix(band, mix(vec3(0.1, 0.075, 0.2), vec3(0.17, 0.08, 0.21), near), smoothstep(0.03, 0.125, hi));
  band = mix(band, vec3(0.016, 0.034, 0.125), smoothstep(0.09, 0.36, hi));
  c = mix(c, band * duskK, dusk);
  // the sun's glow: wide and stronger low down, where its light crosses more air; then a tight one round it
  c += sunCol * (0.07 * pow(cs, 5.0) * (1.0 + 2.5 * (1.0 - clamp(e * 4.0, 0.0, 1.0))) + 0.3 * pow(cs, 90.0)) * up;
  float disc = smoothstep(0.99986, 0.99993, cs);
  // under the horizon: the haze over the land; at night the city's light in the low air, on the sky and on the haze, the mist's light just over the roofs
  c = mix(c, ground, smoothstep(0.0, -0.07, e));
  c += glow * exp(-max(e, 0.0) * 13.0) + mist * exp(-max(e, 0.0) * 34.0);
  // clouds: a layer high over the town, met where the ray crosses it, so they shrink and crowd toward the horizon; they drift with the wind.
  // A cloud is lit on its side toward the sun and grey beneath; with the sun behind it, its edge shines
  if (e > 0.0) {
    vec2 p = d.xz / (e + 0.1) * 1.25 + vec2(time * 0.004, time * 0.0013);
    float n = fbm(p), toward = fbm(p + normalize(sunDir.xz + 1e-4) * 0.07);
    float cover = smoothstep(0.62 - 0.2 * clouds, 0.86 - 0.12 * clouds, n) * smoothstep(0.0, 0.06, e) * clouds;
    float lit = clamp(0.5 + (n - toward) * 7.0, 0.0, 1.0);
    vec3 shade = mix(hor, top, 0.45) * 0.62 + sunCol * 0.05 + vec3(0.012, 0.014, 0.02) * night;
    vec3 sunny = sunCol * 0.7 + (hor + top) * 0.22;
    vec3 cc = mix(shade, sunny, lit * (0.55 + 0.45 * up));
    cc += sunCol * pow(cs, 10.0) * (1.0 - cover) * 1.2 * up;
    // at the warm hour the low sun lights them from below: hot coral toward it and low down, rose further off, their tops dark against the blue
    vec3 lowLit = mix(vec3(0.34, 0.13, 0.19), vec3(1.5, 0.48, 0.17), near) * (0.25 + 0.75 * exp(-hi * 3.0));
    cc = mix(cc, mix(vec3(0.05, 0.05, 0.11), lowLit, 0.25 + 0.75 * lit) * duskK, dusk);
    // at night the city's light falls on them from below, stronger where they lie low over it; a thick part holds more of it
    cc += (glow * 2.2 + mist * 0.4) * (0.35 + 0.9 * smoothstep(0.55, 0.85, n)) * exp(-hi * 8.0);
    c = mix(c, cc, cover);
    disc *= 1.0 - cover;
  }
  c += sunCol * disc * 24.0 * up;
  // the moon and the stars
  float cm = max(dot(d, moonDir), 0.0), face = cm > 0.99997 ? 0.62 + 0.55 * fbm(d.xy * 260.0) : 1.0;
  c += vec3(0.85, 0.9, 1.0) * (smoothstep(0.999975, 0.99999, cm) * 0.95 * face + pow(cm, 3000.0) * 0.08 + pow(cm, 60.0) * 0.015) * night;
  vec3 sp = d * 380.0, cell = floor(sp);
  float h = hash3(cell);
  if (h > 0.996 && e > 0.04) c += vec3(0.9, 0.94, 1.0) * smoothstep(0.3, 0.0, length(fract(sp) - 0.5)) * night * (0.6 + 0.4 * sin(time * 1.7 + h * 90.0)) * 1.6;
  gl_FragColor = vec4(c, 1.0);
}`;

/** The sky's uniforms: its colours (linear), the sun's direction and its light, the moon's direction, the city's glow low down and the mist's over the roofs, the night's share, the clock, the clouds' cover, the warm hour's share and its brightness. */
export interface SkyUniforms {
  top: { value: Color }; hor: { value: Color }; ground: { value: Color }; sunDir: { value: Vector3 }; sunCol: { value: Color };
  moonDir: { value: Vector3 }; glow: { value: Color }; mist: { value: Color }; night: { value: number }; time: { value: number }; clouds: { value: number };
  dusk: { value: number }; duskK: { value: number };
}

/** Where the moon hangs at night: low, a little west of the side street, so the window's overview has it over the town. */
export const MOON_DIR = new Vector3(-0.235, 0.075, -0.97).normalize();

export function skyMaterial(): ShaderMaterial {
  const uniforms: SkyUniforms = {
    top: { value: new Color() }, hor: { value: new Color() }, ground: { value: new Color() }, sunDir: { value: new Vector3(0, 1, 0) },
    sunCol: { value: new Color() }, moonDir: { value: MOON_DIR.clone() }, glow: { value: new Color() }, mist: { value: new Color() }, night: { value: 0 }, time: { value: 0 }, clouds: { value: 0.75 },
    dusk: { value: 0 }, duskK: { value: 1 },
  };
  return new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: uniforms as unknown as ShaderMaterial['uniforms'], side: BackSide, depthWrite: false, depthTest: false, fog: false });
}

/** The dome, `radius` round its middle (set it on the camera), drawn before all else. */
export function skyDome(mat: ShaderMaterial, radius: number): Mesh {
  const m = new Mesh(new SphereGeometry(radius, 48, 24), mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}
