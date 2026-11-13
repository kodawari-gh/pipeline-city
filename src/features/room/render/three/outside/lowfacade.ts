// The Low city's facade: a cheap Lambert in place of `facadeMaterial`'s per-pixel shader (`towers.ts`), which keeps High. Its day map is an
// atlas of bay × storey cells, linear albedo with the AO baked in (the window's reveals, the slab's shadow over it, the sill). Its night map is
// its own map (the lit rooms' light, linear), the emissive, scaled live by the facade's night uniform. A cell repeats per bay; each wall picks
// its cells by its seed. The maps are built once, in JS, so they exist without a canvas.
import { ClampToEdgeWrapping, Color, DataTexture, DataUtils, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, MeshLambertMaterial, NoColorSpace, RGBAFormat, ShaderChunk, Vector3 } from 'three';
import type { FacadeUniforms } from './towers';

/** The city's lamps the buildings take their light from at Low: the view's eight PointLights, here as an analytic term. */
export const LOW_LAMPS = 8;
/** The lamps' reach (the view's PointLight distance). */
const LAMP_REACH = 45;
/** The lamps' live state: `k` is the lamps' intensity (0 by day), `col` their colour, `pos` their world positions (padded to LOW_LAMPS, far off). */
export interface LowLamps { k: { value: number }; col: { value: Color }; pos: { value: Vector3[] } }

/** The atlas: CELLS × CELLS cells of CELL texels; a cell is one bay across and one storey up, its outer EDGE texels the wall's frame (so the cells meet unseen). */
const CELLS = 8, CELL = 32, SIZE = CELLS * CELL, EDGE = 2;
/** The atlas's anisotropic taps (the renderer clamps them to its maximum). */
export const LOW_ANISO = 8;
/** Night walls: the day albedo times this tint at full night. Cool and dark, as base's unlit walls read (a warm grey reads brown under the lamps). */
export const LOW_NIGHT_WALL: readonly [number, number, number] = [0.36, 0.44, 0.58];
/** Far walls (m from the eye): from `near` to `far` each lit room survives only if its hash clears a threshold that rises to `1 - keep`,
 * so the lit rooms stay discrete and get sparser with distance (no mean wash). */
export const LOW_FAR = { near: 150, far: 450, keep: 0.35 };
/** The window in its cell (a fraction of the bay across and the storey up), and its rooms: three across, two up. */
const WIN = { u0: 0.19, u1: 0.81, v0: 0.24, v1: 0.84 }, COLS = 3, ROWS = 2;

/** A seeded generator (mulberry32): the bake is the same every time. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface LowFacadeMaps { day: DataTexture; night: DataTexture }

/** The day and night atlases, baked once and shared. */
let baked: LowFacadeMaps | null = null;
export function lowFacadeMaps(): LowFacadeMaps {
  if (!baked) baked = bakeFacadeMaps();
  return baked;
}

/** A linear RGBA half-float texture: no colour conversion, filtered with mipmaps. */
function atlas(data: Float32Array): DataTexture {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = DataUtils.toHalfFloat(data[i]!);
  const t = new DataTexture(half, SIZE, SIZE, RGBAFormat, HalfFloatType);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  // a wall seen at a grazing angle squashes its bays along one axis: anisotropic taps keep its windows from smearing into one band
  t.anisotropy = LOW_ANISO;
  t.needsUpdate = true;
  return t;
}

function bakeFacadeMaps(): LowFacadeMaps {
  const day = new Float32Array(SIZE * SIZE * 4), night = new Float32Array(SIZE * SIZE * 4);
  for (let cy = 0; cy < CELLS; cy++) {
    for (let cx = 0; cx < CELLS; cx++) {
      const rand = rng(cy * CELLS + cx + 1);
      // this cell's frame tone, its glass, how many of its rooms are lit, and each room's lamp
      const frame = 0.8 + 0.08 * rand(), glassK = 0.85 + 0.3 * rand(), share = 0.2 + 0.4 * rand();
      const lit: number[] = [], warm: boolean[] = [];
      for (let r = 0; r < COLS * ROWS; r++) {
        lit.push(rand() < share ? 0.6 + 0.4 * rand() : 0);
        warm.push(rand() < 0.7);
      }
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          const u = (x + 0.5) / CELL, v = (y + 0.5) / CELL;
          const o = ((cy * CELL + y) * SIZE + (cx * CELL + x)) * 4;
          const edge = x < EDGE || y < EDGE || x >= CELL - EDGE || y >= CELL - EDGE;
          const inW = u > WIN.u0 && u < WIN.u1 && v > WIN.v0 && v < WIN.v1;
          // the frame: the wall's own colour, shaded by the slab above the window and the reveal beside it, lighter on the sill
          let ao = 1;
          if (!inW && v >= WIN.v1 && v < WIN.v1 + 0.07 && u > WIN.u0 - 0.03 && u < WIN.u1 + 0.03) ao = 0.6 + 0.4 * smooth(WIN.v1, WIN.v1 + 0.07, v);
          else if (!inW && v <= WIN.v0 && v > WIN.v0 - 0.06) ao = 0.92;
          else if (!inW && u > WIN.u0 - 0.04 && u < WIN.u1 + 0.04 && v > WIN.v0 && v < WIN.v1) ao = 0.78;
          let r = frame * ao, g = frame * ao, b = frame * ao, nr = 0, ng = 0, nb = 0, glass = 0;
          if (inW) {
            // the glass: dark, its upper part mirroring the sky; the reveal's shade inside the edge; mullions and a transom in the frame's tone
            const d = Math.min(u - WIN.u0, WIN.u1 - u, v - WIN.v0, WIN.v1 - v);
            const reveal = 0.5 + 0.5 * smooth(0, 0.07, d);
            const cw = (WIN.u1 - WIN.u0) / COLS, ch = (WIN.v1 - WIN.v0) / ROWS;
            const onMullion = [1, 2].some((k) => Math.abs(u - (WIN.u0 + k * cw)) < 0.012);
            const onTransom = Math.abs(v - (WIN.v0 + ch)) < 0.015;
            if (onMullion || onTransom) {
              r = g = b = frame * 0.7;
            } else {
              glass = 1;
              const sky = smooth(0.5, 1, v) * 1.2;
              r = 0.06 * glassK * (1 + sky) * reveal;
              g = 0.07 * glassK * (1 + sky) * reveal;
              b = 0.085 * glassK * (1 + sky) * reveal;
            }
            // the lit rooms' light, at night only, in the emissive map (never in the albedo)
            const col = Math.min(COLS - 1, Math.floor(((u - WIN.u0) / (WIN.u1 - WIN.u0)) * COLS));
            const row = Math.min(ROWS - 1, Math.floor(((v - WIN.v0) / (WIN.v1 - WIN.v0)) * ROWS));
            const idx = row * COLS + col, L = lit[idx] ?? 0;
            if (L > 0 && !onMullion && !onTransom) {
              const gradient = 0.75 + 0.25 * (1 - (v - WIN.v0) / (WIN.v1 - WIN.v0));
              const k = L * gradient;
              if (warm[idx]) { nr = 0.9 * k; ng = 0.7 * k; nb = 0.45 * k; } else { nr = 0.42 * k; ng = 0.52 * k; nb = 0.7 * k; }
            }
          }
          if (edge) { r = g = b = frame; nr = ng = nb = 0; }
          // the alpha is the glass's mask (not sampled as opacity): the shader tints the glass by its building's tint
          day[o] = r; day[o + 1] = g; day[o + 2] = b; day[o + 3] = glass;
          night[o] = nr; night[o + 1] = ng; night[o + 2] = nb; night[o + 3] = 1;
        }
      }
    }
  }
  return { day: atlas(day), night: atlas(night) };
}

/** The buildings' lambert material: the baked day map times the vertex colour, the night map as its emissive. Its uniforms are `facadeMaterial`'s, so the view's updates reach it.
 * The lamps do not light it as PointLights do (the scene's PointLights skip its fragments: the point loop is cut from its lights chunk); `lamps` gives the analytic lamp term instead. */
export function lowFacadeMaterial(lampAt: Vector3[] = []): { mat: MeshLambertMaterial; u: FacadeUniforms; lamps: LowLamps } {
  const { day, night } = lowFacadeMaps();
  const u: FacadeUniforms = { night: { value: 0 }, time: { value: 0 }, sun: { value: new Vector3(0, 1, 0) }, sunCol: { value: new Color(0, 0, 0) }, hor: { value: new Color(0, 0, 0) }, pixel: { value: 0 } };
  const far = new Vector3(0, -1e5, 0);
  const lamps: LowLamps = { k: { value: 0 }, col: { value: new Color(0xffc98a) }, pos: { value: Array.from({ length: LOW_LAMPS }, (_, i) => lampAt[i]?.clone() ?? far.clone()) } };
  const mat = new MeshLambertMaterial({ vertexColors: true, map: day, emissiveMap: night, emissive: new Color(0xffffff) });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.fNight = u.night;
    sh.uniforms.fTime = u.time;
    sh.uniforms.fPixel = u.pixel;
    sh.uniforms.fLampK = lamps.k;
    sh.uniforms.fLampCol = lamps.col;
    sh.uniforms.fLampPos = lamps.pos;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 fuv;
attribute vec4 look;
attribute vec3 aux;
attribute vec3 tint;
uniform float fPixel;
varying vec2 vLowBay, vLowFuv;
varying float vLowWide, vLowY;
flat varying vec2 vLowOff;
flat varying vec4 vLowLook;
flat varying vec3 vLowTint;
flat varying float vLowFac, vLowKind, vLowNight, vLowSeed, vLowMetal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
int lowKind = int(aux.y + 0.5);
// a thin thing far off holds a whole pixel's width, as facadeMaterial's does (plain, beacon, LED band)
float lowWide = 1.0;
if (look.w > 0.5 && (lowKind == 2 || lowKind == 3 || lowKind == 5)) {
  vec3 wo = transformed - look.xyz, wa = abs(wo), wm = look.w < 1.5 ? vec3(1.0, 0.0, 1.0) : look.w < 2.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0);
  vec3 wg = mix(wa, max(wa, vec3(distance(transformed, cameraPosition) * fPixel)), wm);
  transformed += sign(wo) * (wg - wa);
  lowWide = dot(wa / wg, wm) / dot(wm, wm);
}
// the wall in bays and storeys, and the atlas cell its seed picks; a seed also mirrors the wall across, so the cells do not repeat as one grid
vLowBay = fuv / max(look.xy, vec2(0.1));
if (fract(aux.x * 0.7548776662) > 0.5) vLowBay.x = -vLowBay.x;
if (fract(aux.x * 0.4142135624) > 0.5) vLowBay.y = -vLowBay.y;
// the building's own cell phase: whole cells, so the frame's edges still meet
vLowOff = floor(vec2(fract(aux.x * 0.6180339), fract(aux.x * 0.3247)) * ${CELLS}.0);
vLowFuv = fuv; vLowLook = look; vLowTint = tint; vLowWide = lowWide; vLowY = (modelMatrix * vec4(transformed, 1.0)).y;
vLowFac = lowKind == 0 || lowKind == 6 ? 1.0 : 0.0;
vLowKind = float(lowKind);
vLowSeed = aux.x;
vLowMetal = aux.z;
// each building's own night level, so the lit rooms do not all come up together
vLowNight = 0.9 + 0.2 * fract(aux.x * 0.5698402909);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float fNight, fTime, fLampK;
uniform vec3 fLampCol, fLampPos[${LOW_LAMPS}];
varying vec2 vLowBay, vLowFuv;
varying float vLowWide, vLowY;
flat varying vec2 vLowOff;
flat varying vec4 vLowLook;
flat varying vec3 vLowTint;
flat varying float vLowFac, vLowKind, vLowNight, vLowSeed, vLowMetal;
// the atlas cell of this bay: the building's phase, and a cell picked per bay by a hash, so no two bays repeat one grid
vec2 lowAtlas() {
  vec2 bay = floor(vLowBay) + vLowOff;
  float h = fract(sin(dot(bay, vec2(12.9898, 78.233)) + vLowSeed * 3.1) * 43758.5453);
  vec2 pick = floor(vec2(h, fract(h * 7.31)) * ${CELLS}.0);
  return (mod(bay + pick, ${CELLS}.0) + fract(vLowBay)) / ${CELLS}.0;
}
// a hash per lit room (this bay, this room of the window's grid): far off, a room stays lit only if its hash clears the distance threshold
float lowRoomHash() {
  vec2 wc = (fract(vLowBay) - vec2(${WIN.u0}, ${WIN.v0})) / vec2(${WIN.u1 - WIN.u0}, ${WIN.v1 - WIN.v0}) * vec2(${COLS}.0, ${ROWS}.0);
  float room = clamp(floor(wc.y), 0.0, ${ROWS - 1}.0) * ${COLS}.0 + clamp(floor(wc.x), 0.0, ${COLS - 1}.0);
  vec2 bay = floor(vLowBay) + vLowOff;
  return fract(sin(dot(bay + room * vec2(0.371, 0.713), vec2(127.1, 311.7)) + vLowSeed * 2.3) * 43758.5453);
}`)
      // the point lights' loop is cut from this wall's lights (`#if 0`): the scene's PointLights stay live for the street, cars and other meshes
      .replace('#include <lights_fragment_begin>', ShaderChunk.lights_fragment_begin.replace('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )', '#if 0'))
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
// the lamps at night, analytic per pixel (the PointLights' falloff and Lambert term, on the wall's view-space normal); off by day (fLampK 0)
if (fLampK > 0.0) {
  vec3 lowP = -vViewPosition, lowL = vec3(0.0);
  for (int i = 0; i < ${LOW_LAMPS}; i++) {
    vec3 d = (viewMatrix * vec4(fLampPos[i], 1.0)).xyz - lowP;
    float dist = max(length(d), 0.001);
    lowL += fLampCol * (saturate(1.0 - dist / ${LAMP_REACH}.0) / max(dist * dist, 0.01)) * max(dot(normal, d / dist), 0.0);
  }
  reflectedLight.directDiffuse += lowL * (fLampK * RECIPROCAL_PI) * diffuseColor.rgb;
}`)
      .replace('#include <map_fragment>', `{
  vec2 lowUv = lowAtlas(), lowDx = dFdx(vLowBay) / ${CELLS}.0, lowDy = dFdy(vLowBay) / ${CELLS}.0;
  vec4 lowTex = textureGrad(map, lowUv, lowDx, lowDy);
  diffuseColor.rgb *= mix(vec3(1.0), lowTex.rgb, vLowFac);
  // a glass pane takes its building's own tint (scaled to its brightest channel, so the atlas's dark glass keeps its level), by the glass mask (alpha)
  vec3 lowTn = vLowTint / max(max(vLowTint.r, vLowTint.g), max(vLowTint.b, 1e-3));
  diffuseColor.rgb *= mix(vec3(1.0), lowTn, lowTex.a * vLowFac);
  // at night the walls go cool and dark between the windows, as base's do (the lamps light the darker albedo too); by day fNight is 0
  diffuseColor.rgb *= mix(vec3(1.0), vec3(${LOW_NIGHT_WALL.join(', ')}), fNight * vLowFac);
}`)
      // by day the non-facade kinds take facadeMaterial's daytime diffuse, not the vertex colour (a dark LED line, pale metal, a dark sign board);
      // this runs after color_fragment, which multiplies the vertex colour in. Their glow stays on the emissive step, scaled by the night
      .replace('#include <color_fragment>', `#include <color_fragment>
if (vLowFac == 0.0) {
  if (vLowKind == 5.0) diffuseColor.rgb = mix(vec3(0.04), vec3(0.55, 0.58, 0.6), vLowMetal);
  else if (vLowKind == 9.0) diffuseColor.rgb = vec3(0.55, 0.58, 0.6);
  else if (vLowKind == 4.0) diffuseColor.rgb = vec3(0.32, 0.34, 0.36);
  else if (vLowKind == 8.0) diffuseColor.rgb = vec3(0.022, 0.024, 0.027);
}`)
      .replace('#include <emissivemap_fragment>', `{
  vec2 lowUv = lowAtlas(), lowDx = dFdx(vLowBay) / ${CELLS}.0, lowDy = dFdy(vLowBay) / ${CELLS}.0;
  // the night map's lit rooms on the walls, and each kind's live glow at facadeMaterial's night strength (LED band, flood, beacon, lantern,
  // sign). Both are scaled by the night, so nothing shows by day
  vec3 lowGlow = vec3(0.0);
  if (vLowKind == 5.0) lowGlow = vColor.rgb * 2.22 * pow(vLowWide, 0.6);
  else if (vLowKind == 9.0) lowGlow = vColor.rgb * (0.12 + 1.5 * exp(-3.0 * clamp((vLowY - vLowLook.y) / max(vLowLook.z, 1.0), 0.0, 1.0)));
  else if (vLowKind == 3.0) lowGlow = vec3(1.0, 0.06, 0.03) * 9.0 * vLowWide * step(0.55, fract(fTime * 0.45 + vLowSeed));
  else if (vLowKind == 4.0) lowGlow = vColor.rgb * (1.0 + vLowLook.w) * 0.75 * (0.2 + 0.9 * exp(-3.0 * clamp((vLowFuv.y - vLowLook.y) / max(vLowLook.z, 1.0), 0.0, 1.0)));
  else if (vLowKind == 8.0 && vLowLook.w > -0.5) lowGlow = vColor.rgb * mix(1.8, 0.72, clamp(vLowLook.w, 0.0, 1.0));
  // the lit rooms stay discrete at every range (the atlas's own mips, no mean wash). Far off, each lit room is kept only if its hash
  // clears a threshold that rises with distance, so the far towers get sparser windows, not a warm average
  vec3 lowLit = textureGrad(emissiveMap, lowUv, lowDx, lowDy).rgb;
  float lowFar = smoothstep(${LOW_FAR.near}.0, ${LOW_FAR.far}.0, length(vViewPosition));
  lowLit *= step(lowFar * ${1 - LOW_FAR.keep}, lowRoomHash());
  totalEmissiveRadiance = emissive * (lowLit * vLowFac * vLowNight + lowGlow) * fNight;
}`);
  };
  mat.customProgramCacheKey = () => 'outside-facade-low';
  return { mat, u, lamps };
}
