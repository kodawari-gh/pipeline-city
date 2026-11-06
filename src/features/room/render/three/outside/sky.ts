// The sky over the street (`view.ts`): a dome round the camera, drawn first, whose shader paints the hour's sky. The horizon's colour low down
// and the zenith's overhead (`skyAt`), at the warm hour bands of ember, rose and violet under a deep blue, brightest toward the sun with the
// earth's shadow opposite it; the sun's wide glow and its disc, a layer of clouds that drifts and is lit from the sun's side, or from below at
// dusk and by the city at night, the moon's face and the stars, a few far aircraft's lights, the city's glow low in the sky. Under the horizon it
// is the land's haze. A small copy of the dome is what the view's environment sees (its sky light). The moon moves with the hour (`moonDir`,
// set by `view.ts`): it rises in the east in the evening, is over the town near midnight and low in the west at dawn.
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
const vec3 MOON_COL = vec3(1.0, 0.9, 0.76);

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
  float veil = 0.0, cm = max(dot(d, moonDir), 0.0);
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
    // near the moon a cloud takes its silver
    cc += MOON_COL * (0.07 * pow(cm, 1400.0) + 0.012 * pow(cm, 120.0)) * night;
    c = mix(c, cc, cover);
    disc *= 1.0 - cover;
    veil = cover;
  }
  c += sunCol * disc * 24.0 * up;
  // the moon: a gibbous face low over the town, warm from the air it shines through, its dark seas and pale highlands under a soft halo. A cloud
  // veils it. Its night side is the sky's
  c += MOON_COL * (pow(cm, 2500.0) * 0.05 + pow(cm, 240.0) * 0.012) * night * (1.0 - 0.6 * veil);
  vec3 mx = normalize(cross(vec3(0.0, 1.0, 0.0), moonDir)), my = cross(moonDir, mx);
  vec2 mq = vec2(dot(d, mx), dot(d, my)) / 0.0066;
  float mr = dot(mq, mq);
  if (mr < 1.0 && dot(d, moonDir) > 0.0) {
    vec3 mn = vec3(mq, sqrt(1.0 - mr));
    float seas = smoothstep(0.42, 0.6, fbm(mq * 1.5 + vec2(3.1, 7.7))), land = 0.5 + 0.5 * noise(mq * 9.0 + 4.2);
    float lit = smoothstep(-0.02, 0.2, dot(mn, normalize(vec3(-0.42, -0.26, 0.87))));
    vec3 face = MOON_COL * (0.62 - 0.26 * seas + 0.12 * land * (1.0 - seas)) * (0.65 + 0.35 * mn.z);
    c = mix(c, c * 0.4 + face * 0.85, smoothstep(1.0, 0.92, mr) * lit * night * (1.0 - 0.6 * veil));
  }
  // the stars
  vec3 sp = d * 380.0, cell = floor(sp);
  float h = hash3(cell);
  if (h > 0.996 && e > 0.04) c += vec3(0.9, 0.94, 1.0) * smoothstep(0.3, 0.0, length(fract(sp) - 0.5)) * night * (0.6 + 0.4 * sin(time * 1.7 + h * 90.0)) * 1.6;
  // aircraft far off, each on its own line and its own long clock: a steady red or green light and a white strobe. Small, so they show only at night
  for (int k = 0; k < 3; k++) {
    float fk = float(k), span = 170.0 + 70.0 * fk, u = fract(time / span + fk * 0.37);
    float az = -0.95 + 1.9 * (mod(fk, 2.0) < 0.5 ? u : 1.0 - u) + 0.3 * fk, ee = 0.05 + 0.055 * fk + 0.03 * u;
    vec3 ad = normalize(vec3(sin(az), ee, -cos(az)));
    float blink = smoothstep(0.08, 0.0, fract(time / 1.3 + fk * 0.31)) + 0.6 * smoothstep(0.06, 0.0, abs(fract(time / 1.3 + fk * 0.31) - 0.16));
    float ar = length(d - ad);
    c += ((fk == 1.0 ? vec3(0.3, 1.0, 0.45) : vec3(1.0, 0.18, 0.1)) * 0.75 * smoothstep(0.0012, 0.0003, ar) + vec3(1.0, 0.97, 0.9) * 2.2 * blink * smoothstep(0.0016, 0.0002, ar)) * night * step(0.0, e);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

/** The sky's uniforms: its colours (linear), the sun's direction and its light, the moon's direction, the city's glow low down and the mist's over the roofs, the night's share, the clock, the clouds' cover, the warm hour's share and its brightness. */
export interface SkyUniforms {
  top: { value: Color }; hor: { value: Color }; ground: { value: Color }; sunDir: { value: Vector3 }; sunCol: { value: Color };
  moonDir: { value: Vector3 }; glow: { value: Color }; mist: { value: Color }; night: { value: number }; time: { value: number }; clouds: { value: number };
  dusk: { value: number }; duskK: { value: number };
}

/**
 * The moon's night (hours; past midnight they count on from 24): it rises in the east at `MOON_RISE` and sets in the west at `MOON_SET`.
 * Its side to side (radians from north, east positive) and its height at the top of its arc.
 */
export const MOON_RISE = 18, MOON_SET = 32;
const MOON_EAST = 0.6, MOON_WEST = -0.308, MOON_HIGH = 0.122;

/**
 * Where the moon is at an hour (north is -z, east +x). Its path is drawn for the window, not the sky's real one, which would take it behind
 * the room: it rises in the east, crosses the north low over the town, highest past midnight, and is low in the west at dawn. It moves
 * fastest just after it rises. Under the horizon outside its night.
 */
export function moonDir(hour: number): Vector3 {
  const h = hour < 12 ? hour + 24 : hour, u = Math.min(1, Math.max(0, (h - MOON_RISE) / (MOON_SET - MOON_RISE)));
  const az = MOON_EAST + (MOON_WEST - MOON_EAST) * (1 - (1 - u) ** 2.75);
  const el = u > 0 && u < 1 ? MOON_HIGH * Math.sqrt(Math.sin(u * Math.PI)) : -0.2;
  return new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

export function skyMaterial(): ShaderMaterial {
  const uniforms: SkyUniforms = {
    top: { value: new Color() }, hor: { value: new Color() }, ground: { value: new Color() }, sunDir: { value: new Vector3(0, 1, 0) },
    sunCol: { value: new Color() }, moonDir: { value: moonDir(23) }, glow: { value: new Color() }, mist: { value: new Color() }, night: { value: 0 }, time: { value: 0 }, clouds: { value: 0.75 },
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
