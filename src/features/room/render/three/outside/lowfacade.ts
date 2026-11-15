// The Low city's facade: a cheap Lambert in place of `facadeMaterial`'s per-pixel shader (`towers.ts`), which keeps High. Its day map is an
// atlas of bay × storey cells, linear albedo with the AO baked in (the window's reveals, the slab's shadow over it, the sill). Its night map is
// its own map (the lit rooms' light, linear), the emissive, scaled live by the facade's night uniform. A cell repeats per bay; each wall picks
// its cells by its seed. The maps are built once, in JS, so they exist without a canvas.
import { ClampToEdgeWrapping, Color, DataTexture, DataUtils, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, MeshLambertMaterial, NoColorSpace, RGBAFormat, ShaderChunk, Vector3 } from 'three';
import type { FacadeUniforms } from './towers';
import { STYLES } from './plan';

/** The city's lamps the buildings take their light from at Low: the view's eight PointLights, here as an analytic term. */
export const LOW_LAMPS = 8;
/** The lamps' reach (the view's PointLight distance). */
const LAMP_REACH = 45;
/** The lamps' live state: `k` is the lamps' intensity (0 by day), `col` their colour, `pos` their world positions (padded to LOW_LAMPS, far off). */
export interface LowLamps { k: { value: number }; col: { value: Color }; pos: { value: Vector3[] } }

/** The atlas: CELLS × CELLS cells of CELL texels; a cell is one bay across and one storey up, its outer EDGE texels the wall's frame (so the cells meet unseen). */
const CELLS = 8, CELL = 32, SIZE = CELLS * CELL, EDGE = 2;
/** The atlas's anisotropic taps (the renderer clamps them to its maximum). */
export const LOW_ANISO = 2;
/** Night walls: the day albedo times this tint at full night. Cool and dark, as base's unlit walls read (a warm grey reads brown under the lamps). */
export const LOW_NIGHT_WALL: readonly [number, number, number] = [0.36, 0.44, 0.58];
/** By day a glass pane takes its building's raw tint (linear) times this, lit as base's glass is; the frame keeps the tower's own colour. */
export const LOW_DAY_GLASS = 1.5;
/** By day a pane far off (past `LOW_FAR`) takes the frame's brightness, with this share of its tower's hue: a grey wall that keeps its tint. */
export const LOW_FAR_HUE = 0.35;
/** Far walls (m from the eye): from `near` to `far` a wall's lit rooms go from the night map's texels to analytic windows (`lowFarWin`), one
 * a bay and a storey. Past `far` no window texel is read: the albedo is the map's mean (the top mip). A building lights from `occ[0]` to
 * `occ[1]` of its windows (its own share), each at `glow`; a band's far ribbon is its runs' mean, `ribMean`. So a far tower reads as dark
 * graphite with many small warm windows, as High's does, and never as flat lit slabs. */
export const LOW_FAR = { near: 150, far: 300, occ: [0.1, 0.42] as readonly [number, number], glow: 0.4, ribMean: 0.16 };
/** The top mip of a SIZE atlas (a 1×1 texel: the map's mean). */
const LOW_TOP_MIP = Math.log2(SIZE);
/** The atlas's window in its cell (a fraction of the bay across and the storey up; each facade maps its own share onto it), and its rooms: three across, two up. */
const WIN = { u0: 0.19, u1: 0.81, v0: 0.24, v1: 0.84 }, COLS = 3, ROWS = 2;
/** A band's ribbon (`STYLES.band`): its window across the bay and up the storey, from its sill. Its mullions are the frame at each bay's edge.
 * Its lit runs are RIB_RUN bays long, one run per storey: the whole bottom storey is one blue run. */
const RIB_WIN = STYLES.band.win, RIB_LO = (1 - RIB_WIN[1]) * 0.6, RIB_MULL = (1 - RIB_WIN[0]) / 2, RIB_RUN = 4;
/** A room's width behind a ribbon (m along the wall): each is dark or lit at its own level, so a lit run reads as a row of windows. */
const RIB_PANE = 3.2;

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
// the day wall's parts, set by the map step and read after the vertex colour: the atlas shade (the frame's tone, the glass mixed in by its mask) and the glass mask
vec3 lowShade = vec3(1.0);
float lowGlassM = 0.0;
// the facade's own window (look.zw, as base's towers.ts sets it: centred across, win.y tall from a sill up) mapped onto the atlas's window,
// so a band keeps its ribbon and a glass front its pane. lowLocal is the pixel's place in the atlas cell, unclamped
vec2 lowWin() { return max(vLowLook.zw, vec2(0.05)); }
vec2 lowLocal() {
  vec2 win = lowWin(), lo = vec2(0.5 - 0.5 * win.x, (1.0 - win.y) * 0.6);
  return vec2(${WIN.u0}, ${WIN.v0}) + (fract(vLowBay) - lo) / win * vec2(${WIN.u1 - WIN.u0}, ${WIN.v1 - WIN.v0});
}
// the atlas's window per facade window: how far the cell's derivatives stretch (the mip follows the remapped pixel)
vec2 lowScale() { return vec2(${WIN.u1 - WIN.u0}, ${WIN.v1 - WIN.v0}) / lowWin(); }
// the atlas cell of this bay: the building's phase, and a cell picked per bay by a hash, so no two bays repeat one grid
vec2 lowAtlas() {
  vec2 bay = floor(vLowBay) + vLowOff;
  float h = fract(sin(dot(bay, vec2(12.9898, 78.233)) + vLowSeed * 3.1) * 43758.5453);
  vec2 pick = floor(vec2(h, fract(h * 7.31)) * ${CELLS}.0);
  return (mod(bay + pick, ${CELLS}.0) + clamp(lowLocal(), 0.0, 1.0)) / ${CELLS}.0;
}
// a far wall's lit windows, with no texel read: one window a bay and a storey, lit by a hash of its cell. A building has its own share of
// lit windows, and each storey its own (an office lit in whole floors, a dark one between). The window's edge is as wide as the pixel
// (fwidth), and the hash changes only in the frame between two windows, so a still or a moving eye sees no speck. Where a bay is under
// a pixel wide the windows are their mean (the share, the window's part of the cell), and where a storey is too, the storeys' mean
vec3 lowFarWin() {
  vec2 fw = fwidth(vLowBay) + 1e-4, f = fract(vLowBay), id = floor(vLowBay) + vLowOff;
  vec2 win = lowWin(), lo = vec2(0.5 - 0.5 * win.x, (1.0 - win.y) * 0.6), hi = lo + win;
  vec2 e = min(fw, 0.5 * win);
  vec2 m = smoothstep(lo - e, lo + e, f) * (1.0 - smoothstep(hi - e, hi + e, f));
  float occ = mix(${LOW_FAR.occ[0]}, ${LOW_FAR.occ[1]}, fract(sin(vLowSeed * 91.7 + 3.3) * 43758.5453));
  float fl = fract(sin(id.y * 12.9898 + vLowSeed * 5.7) * 43758.5453);
  float share = clamp(occ * mix(0.35, 1.9, fl * fl), 0.0, 0.95);
  float h = fract(sin(dot(id, vec2(127.1, 311.7)) + vLowSeed * 2.3) * 43758.5453), h2 = fract(h * 7.31), h3 = fract(h * 23.7);
  // (the lamp: most warm, some a cool tube; a building leans one way)
  vec3 warm = vec3(0.9, 0.7, 0.45), cool = vec3(0.42, 0.52, 0.7);
  float coolK = mix(0.1, 0.45, fract(vLowSeed * 0.7391));
  vec3 one = mix(warm, cool, step(h3, coolK)) * (step(h, share) * (0.55 + 0.45 * h2));
  vec3 mean = mix(warm, cool, coolK) * 0.775;
  vec2 k = smoothstep(vec2(0.3), vec2(0.8), fw);
  vec3 lit = mix(mix(one, mean * share, k.x), mean * occ, k.y);
  return lit * (m.x * m.y) * ${LOW_FAR.glow};
}
// a band's ribbon: the glass band of each storey (its window across the bay, from its sill), its mullions the frame at each bay's edge. Its rows
// are the world's storeys, so a mirrored wall keeps its ribbon at its height. The mask is the glass (0..1), antialiased by the pixel's width
float lowRibGlass() {
  vec2 fw = vec2(fwidth(vLowBay.x), fwidth(vLowY / max(vLowLook.y, 0.1))) + 1e-4;
  vec2 p = vec2(fract(vLowBay.x), fract(vLowY / max(vLowLook.y, 0.1)));
  vec2 lo = vec2(${RIB_MULL}, ${RIB_LO}), hi = vec2(${1 - RIB_MULL}, ${RIB_LO + RIB_WIN[1]});
  vec2 m = smoothstep(lo - fw, lo + fw, p) * (1.0 - smoothstep(hi - fw, hi + fw, p));
  return m.x * m.y;
}
// the ribbon's night light: per storey, runs of ${RIB_RUN} bays, a run lit by a hash (amber, its level by the same hash). The bottom storey's
// whole bottom storey is blue and always lit (one continuous run, as on base)
vec3 lowRibLight() {
  float st = floor(vLowY / max(vLowLook.y, 0.1));
  float off = floor(fract(vLowSeed * 0.6180339) * ${RIB_RUN}.0);
  float run = floor((floor(vLowBay.x) + off) / ${RIB_RUN}.0);
  float h = fract(sin(dot(vec2(run, st), vec2(127.1, 311.7)) + vLowSeed * 2.3) * 43758.5453);
  float blue = 1.0 - step(0.5, st);
  float on = max(step(0.45, h), blue), level = mix(0.6 + 0.4 * fract(h * 7.3), 1.0, blue);
  // each bay of a lit run is its own room: some dark, the others at their own level, so a run reads as a row of windows, not one slab
  float pane = fract(sin(dot(vec2(floor(vLowFuv.x / ${RIB_PANE}), st), vec2(12.9898, 78.233)) + vLowSeed * 4.1) * 43758.5453);
  level *= mix(mix(0.06, 0.3 + 0.5 * fract(pane * 5.7), step(0.35, pane)), 0.6, blue);
  return mix(vec3(0.9, 0.7, 0.45), vec3(0.42, 0.52, 0.7), blue) * (on * level);
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
  vec2 lowUv = lowAtlas(), lowDx = dFdx(vLowBay) * lowScale() / ${CELLS}.0, lowDy = dFdy(vLowBay) * lowScale() / ${CELLS}.0;
  // far off at night, the wall's albedo is the map's mean (its top mip), not its window texels: no dark dots on a far tower
  float lowFarM = smoothstep(${LOW_FAR.near}.0, ${LOW_FAR.far}.0, length(vViewPosition)) * fNight;
  // a band's wall is its ribbon by day (the frame's beige, the glass's dark pane), not the atlas's punched windows; lowRib is 1 on a band's wall
  float lowRib = 1.0 - step(0.001, abs(vLowLook.w - ${RIB_WIN[1]}));
  float lowG = lowRibGlass();
  vec4 lowNear = mix(textureGrad(map, lowUv, lowDx, lowDy), vec4(mix(vec3(0.9), vec3(0.09, 0.1, 0.12), lowG), lowG), lowRib);
  vec4 lowTex = mix(lowNear, textureLod(map, lowUv, ${LOW_TOP_MIP}.0), lowFarM);
  diffuseColor.rgb *= mix(vec3(1.0), lowTex.rgb, vLowFac);
  // a glass pane takes its building's own tint (scaled to its brightest channel, so the atlas's dark glass keeps its level), by the glass mask (alpha)
  vec3 lowTn = vLowTint / max(max(vLowTint.r, vLowTint.g), max(vLowTint.b, 1e-3));
  diffuseColor.rgb *= mix(vec3(1.0), lowTn, lowTex.a * vLowFac);
  // the day parts for the colour step: the frame's shade (the glass mask's mean at a distance counts as the frame's own tone), the glass mask
  lowShade = mix(lowTex.rgb, vec3(0.84), lowTex.a);
  lowGlassM = lowTex.a * vLowFac;
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
  // a sign's case is dark; its lit face (look.w 0 or 1) keeps the sign's colour, the orange of base's board
  else if (vLowKind == 8.0 && vLowLook.w < -0.5) diffuseColor.rgb = vec3(0.022, 0.024, 0.027);
  else if (vLowKind == 7.0) {
    // a solar panel, as facadeMaterial's day diffuse: dark blue cells on fine silver lines
    vec2 sg = vLowFuv * 2.0, sw = fwidth(sg), sd = abs(fract(sg) - 0.5);
    float sl = mix(max(smoothstep(0.44 - sw.x, 0.44 + sw.x, sd.x), smoothstep(0.44 - sw.y, 0.44 + sw.y, sd.y)), 0.2, smoothstep(0.2, 0.6, max(sw.x, sw.y)));
    diffuseColor.rgb = mix(vec3(0.012, 0.022, 0.06), vec3(0.3, 0.32, 0.34), sl * 0.6);
  }
}
// by day a wall takes its own colour: its frame is the tower's vertex colour shaded by the atlas, its glass its raw tint, lit (not the frame's
// colour dimmed by the glass). At night (fNight 1) the diffuse is what the map step left, as before; between, they mix
// far off a pane is not resolved: its glass reads as the frame's brightness with the tower's hue (a dark tint would wall the building navy)
vec3 lowFrameD = vColor.rgb * lowShade;
vec3 lowHue = vLowTint / max(max(vLowTint.r, vLowTint.g), max(vLowTint.b, 1e-3));
float lowFarD = smoothstep(${LOW_FAR.near}.0, ${LOW_FAR.far}.0, length(vViewPosition));
vec3 lowGlassD = mix(vLowTint * ${LOW_DAY_GLASS}, lowFrameD * mix(vec3(1.0), lowHue, ${LOW_FAR_HUE}), lowFarD);
vec3 lowDayWall = mix(lowFrameD, lowGlassD, lowGlassM);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(lowDayWall, diffuseColor.rgb, fNight), vLowFac);`)
      .replace('#include <emissivemap_fragment>', `{
  vec2 lowUv = lowAtlas(), lowDx = dFdx(vLowBay) * lowScale() / ${CELLS}.0, lowDy = dFdy(vLowBay) * lowScale() / ${CELLS}.0;
  // the night map's lit rooms on the walls, and each kind's live glow at facadeMaterial's night strength (LED band, flood, beacon, lantern,
  // sign). Both are scaled by the night, so nothing shows by day
  vec3 lowGlow = vec3(0.0);
  if (vLowKind == 5.0) lowGlow = vColor.rgb * 2.22 * pow(vLowWide, 0.6);
  else if (vLowKind == 9.0) lowGlow = vColor.rgb * (0.12 + 1.5 * exp(-3.0 * clamp((vLowY - vLowLook.y) / max(vLowLook.z, 1.0), 0.0, 1.0)));
  else if (vLowKind == 3.0) lowGlow = vec3(1.0, 0.06, 0.03) * 9.0 * vLowWide * mix(0.55, 1.0, 0.5 + 0.5 * sin(6.2831853 * (fTime / 3.5 + vLowSeed)));
  else if (vLowKind == 4.0) lowGlow = vColor.rgb * (1.0 + vLowLook.w) * 0.75 * (0.2 + 0.9 * exp(-3.0 * clamp((vLowFuv.y - vLowLook.y) / max(vLowLook.z, 1.0), 0.0, 1.0)));
  else if (vLowKind == 8.0 && vLowLook.w > -0.5) lowGlow = vColor.rgb * mix(1.8, 0.72, clamp(vLowLook.w, 0.0, 1.0));
  // near, the lit rooms are the night map's texels. From LOW_FAR.near to LOW_FAR.far they give way to analytic windows (lowFarWin: one
  // a bay and a storey, lit by a hash, antialiased by the pixel's width, their mean where a bay is under a pixel), so a far tower keeps
  // many small warm windows with no texel to alias. The mix is smooth, with no branch on the distance, so the derivatives stay in
  // uniform control flow (by day fNight is 0 and the whole term is 0: the night map's read and the hashes are skipped, one uniform branch)
  vec3 lowLit = vec3(0.0);
  if (fNight > 0.0) {
    float lowFar = smoothstep(${LOW_FAR.near}.0, ${LOW_FAR.far}.0, length(vViewPosition));
    vec3 lowRooms = textureGrad(emissiveMap, lowUv, lowDx, lowDy).rgb;
    // a band's wall: its ribbon's runs on the glass, not the atlas's rooms; far off the runs are their mean on the glass
    float lowRib = 1.0 - step(0.001, abs(vLowLook.w - ${RIB_WIN[1]}));
    float lowRunM = smoothstep(0.3, 0.8, fwidth(vLowFuv.x / ${RIB_PANE}));
    vec3 lowRibbon = mix(lowRibLight(), vec3(0.9, 0.7, 0.45) * ${LOW_FAR.ribMean}, lowRunM) * lowRibGlass();
    lowLit = mix(mix(lowRooms, lowFarWin(), lowFar), lowRibbon, lowRib);
  }
  totalEmissiveRadiance = emissive * (lowLit * vLowFac * vLowNight + lowGlow) * fNight;
}`);
  };
  mat.customProgramCacheKey = () => 'outside-facade-low';
  return { mat, u, lamps };
}
