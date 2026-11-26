// The facade shader's own lines (`facade.ts` puts them into three's standard shader): the vertex's attributes and how a thin thing holds a
// pixel's width far off, and the fragment's uniforms and helpers (hash, noise, a lamp's colour, the city a pane mirrors, a sign's glyph).
import { Kind } from './basics';

/** The vertex shader's facade attributes and what it hands the fragment, after three's common chunk. */
export const VERT_COMMON =
  '#include <common>\nattribute vec2 fuv;\nattribute vec4 look;\nattribute vec3 tint;\nattribute vec3 aux;\nattribute vec3 wash;\nattribute vec2 washY;\nuniform float fPixel;\nvarying vec2 vFuv;\nflat varying vec4 vLook;\nvarying vec3 vTint;\nflat varying vec3 vAux;\nflat varying vec3 vWash;\nflat varying vec2 vWashY;\nvarying float vWide;\nvarying vec3 vFW;\nvarying vec3 vFN;';

/** After three's begin_vertex: a thin thing far off holds a whole pixel of the window's (two of the picture's); a lit one dims as it grows. */
export const VERT_BEGIN = `#include <begin_vertex>
vFuv = fuv; vLook = look; vTint = tint; vAux = aux; vWash = wash; vWashY = washY; vWide = 1.0;
int fk = int(aux.y + 0.5);
if (look.w > 0.5 && (fk == ${Kind.Plain} || fk == ${Kind.Beacon} || fk == ${Kind.Led})) {
  vec3 wo = transformed - look.xyz, wa = abs(wo), wm = look.w < 1.5 ? vec3(1.0, 0.0, 1.0) : look.w < 2.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0);
  vec3 wg = mix(wa, max(wa, vec3(distance(transformed, cameraPosition) * fPixel)), wm);
  transformed += sign(wo) * (wg - wa);
  vWide = dot(wa / wg, wm) / dot(wm, wm);
}
vFW = (modelMatrix * vec4(transformed, 1.0)).xyz; vFN = normalize(mat3(modelMatrix) * normal);`;

/** The fragment shader's uniforms, varyings and helpers, after three's common chunk. */
export const FRAG_COMMON = `#include <common>
uniform float fNight, fTime;
uniform vec3 fSun, fSunCol, fHor;
varying vec2 vFuv;
// flat: a wall's seed interpolated comes out a hair different from pixel to pixel, and any hash of it a different number, in specks
flat varying vec4 vLook;
varying vec3 vTint;
flat varying vec3 vAux;
flat varying vec3 vWash;
flat varying vec2 vWashY;
varying float vWide;
varying vec3 vFW;
varying vec3 vFN;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
/** A band from a to b across x, its edges softened by the pixel's width w. */
float fBand(float a, float b, float x, float w) { return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }
/** How much the rooms in use gather at a place on a wall: in patches up it and along it. */
float fGather(vec2 p, float seed) { return (0.35 + 1.3 * fNoise(vec2(seed * 3.3, p.y / 34.0))) * (0.55 + 0.9 * fNoise(p / vec2(23.0, 16.0) + seed * 5.1)); }
/** A lamp's colour by its warmth, from 0 (a cold daylight tube) through a neutral white to 1 (an old warm bulb). */
vec3 fLampCol(float t) {
  vec3 c = mix(vec3(0.74, 0.87, 1.0), vec3(1.0, 0.87, 0.68), smoothstep(0.0, 0.5, t));
  return mix(c, vec3(1.0, 0.62, 0.32), smoothstep(0.5, 1.0, t));
}
/**
 * The city as a pane's ray r sees it past the street's far side: two rows of towers round the horizon, the far one paler in the haze, each its own
 * height, against the sky; by day the hour's haze on them, one side of each in the sun; at night dark, their lit rooms and now and then a sign.
 * px: how far r turns over a pixel. Its colour, and how much of the ray it stops.
 */
vec4 fCityMirrored(vec3 r, float px) {
  float az = atan(r.x, r.z), el = r.y;
  vec4 o = vec4(0.0);
  for (int k = 0; k < 2; k++) {
    float fk = 1.0 - float(k), nz = mix(26.0, 47.0, fk), ny = mix(310.0, 520.0, fk), c = az * nz + fk * 3.7, cid = floor(c), cu = c - cid, th = fHash(vec2(cid, 4.1 + fk));
    float top = mix(0.03 + 0.2 * th * th, 0.012 + 0.085 * th * th * th, fk), a = smoothstep(top + px, top - px, el);
    a *= mix(smoothstep(0.0, 0.05, cu) * smoothstep(1.0, 0.95, cu), 0.9, smoothstep(0.03, 0.2, px * nz)) * step(0.14, fHash(vec2(cid, 7.7 + fk)));
    float roomLit = smoothstep(0.42, 0.8, fNoise(vec2(c * 1.7, el * ny * 0.13 + cid))) * (0.12 + 0.5 * fHash(vec2(cid, 2.3)));
    vec3 wall = fHor * mix(0.2 + 0.25 * th, 0.5 + 0.2 * th, fk) + fSunCol * 0.05 * (1.0 - fk) * smoothstep(0.35, 0.75, cu);
    vec3 col = wall * (1.0 - 0.5 * fNight) + fLampCol(fHash(vec2(cid, 11.3))) * roomLit * fNight * mix(1.0, 0.6, fk);
    float sn = fHash(vec2(cid, 23.9));
    if (sn > 0.9) col += (sn > 0.97 ? vec3(1.0, 0.25, 0.62) : sn > 0.935 ? vec3(0.3, 0.84, 1.0) : vec3(1.0, 0.68, 0.34)) * smoothstep(0.1, 0.0, abs(el - top * (0.55 + 0.3 * sn)) / max(top, 0.01)) * 1.2 * fNight;
    o = mix(o, vec4(col, 1.0), a);
  }
  return o;
}
/** How far a point in a sign's glyph's box (0 to 1) is from the nearest stroke: up to three across and three up, each whole or part way. No real letters. */
float fGlyph(vec2 c, float gh) {
  float d = 9.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k), a = fHash(vec2(gh, fk + 0.5)), b = fHash(vec2(gh, fk + 3.5));
    if (fHash(vec2(gh, fk + 6.5)) > 0.35) d = min(d, length(max(abs(c - vec2(a < 0.5 ? 0.5 : a < 0.75 ? 0.28 : 0.72, 0.5 * fk)) - vec2(a < 0.5 ? 0.5 : 0.28, 0.0), 0.0)));
    if (fHash(vec2(gh, fk + 9.5)) > 0.45) d = min(d, length(max(abs(c - vec2(0.5 * fk, b < 0.5 ? 0.5 : b < 0.75 ? 0.28 : 0.72)) - vec2(0.0, b < 0.5 ? 0.5 : 0.28), 0.0)));
  }
  return d;
}`;
