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
/** By day a far pane's brightness, as a share of the frame's: darker than the wall, so the rows of windows read, but not the near glass's dark. */
export const LOW_FAR_GLASS = 0.55;
/** Far walls (m from the eye): from `near` to `far` a wall's lit rooms go from the night map's texels to analytic windows (`lowFarWin`), one
 * a bay and a storey. Past `far` no window texel is read: the albedo is the map's mean (the top mip). A building lights from `occ[0]` to
 * `occ[1]` of its windows (its own share), each at `glow`; a band's far ribbon is its rooms' mean (`lowRibLight`). So a far tower reads as
 * dark graphite with many small warm windows, as High's does, and never as flat lit slabs. */
export const LOW_FAR = { near: 150, far: 300, occ: [0.1, 0.42] as readonly [number, number], glow: 0.4 };
/** The top mip of a SIZE atlas (a 1×1 texel: the map's mean). */
const LOW_TOP_MIP = Math.log2(SIZE);
/** The atlas's window in its cell (a fraction of the bay across and the storey up; each facade maps its own share onto it), and its rooms: three across, two up. */
const WIN = { u0: 0.19, u1: 0.81, v0: 0.24, v1: 0.84 }, COLS = 3, ROWS = 2;
/** A band's ribbon (`STYLES.band`): its window across the bay and up the storey, from its sill, on High's grid (the facade's own uv), so
 * each window, its curtain and its room are High's. Behind it, rooms as High's (`lowRibLight`); the ground floor is High's shops. */
const RIB_WIN = STYLES.band.win;
/** A ribbon's lites: slim dark mullions about this far apart (m), as High's. */
const RIB_LITE = 1.2;
/** A ribbon's frame tone (times the tower's colour): this lambert's lit wall then reads as High's lit beige (sRGB about 147, 144, 138). */
const RIB_FRAME: readonly [number, number, number] = [0.72, 0.7, 0.68];
/** By day a ribbon's glass is its building's tint times this: the dark room behind a half-mirror, as base's reads (a curtain wall's glass
 * mirrors the sky: `LOW_DAY_GLASS`). Its curtains and blinds add their fabric times `RIB_FABRIC`, seen through the same mirror. */
export const LOW_RIB_GLASS = 0.26;
const RIB_FABRIC = 0.13;
/** A ribbon's lit rooms at night times this: High's lit window (sRGB about 79, 64, 48) under this lambert's emissive. */
const RIB_LIT = 1.3;

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
      const frame = 0.8 + 0.08 * rand(), glassK = 0.85 + 0.3 * rand(), share = 0.08 + 0.3 * rand();
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
    sh.uniforms.fHor = u.hor;
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
uniform vec3 fHor, fLampCol, fLampPos[${LOW_LAMPS}];
varying vec2 vLowBay, vLowFuv;
varying float vLowWide, vLowY;
flat varying vec2 vLowOff;
flat varying vec4 vLowLook;
flat varying vec3 vLowTint;
flat varying float vLowFac, vLowKind, vLowNight, vLowSeed, vLowMetal;
// the day wall's parts, set by the map step and read after the vertex colour: the atlas shade (the frame's tone, the glass mixed in by its mask) and the glass mask
vec3 lowShade = vec3(1.0);
float lowGlassM = 0.0;
// a band's ribbon room by room (lowRibCover), set by the map step for the colour and the night steps: its mullions, its cover, the fabric's fold
vec4 lowRibC = vec4(0.0, 0.0, 1.0, 0.0);
float lowH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// a room's lamp by its warmth, from 0 (a cold daylight tube) through a neutral white to 1 (an old warm bulb), as High's fLampCol
vec3 lowLampCol(float t) {
  vec3 c = mix(vec3(0.74, 0.87, 1.0), vec3(1.0, 0.87, 0.68), smoothstep(0.0, 0.5, t));
  return mix(c, vec3(1.0, 0.62, 0.32), smoothstep(0.5, 1.0, t));
}
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
float lowWinMask() {
  vec2 fw = fwidth(vLowBay) + 1e-4, f = fract(vLowBay);
  vec2 win = lowWin(), lo = vec2(0.5 - 0.5 * win.x, (1.0 - win.y) * 0.6), hi = lo + win;
  vec2 e = min(fw, 0.5 * win);
  vec2 m = smoothstep(lo - e, lo + e, f) * (1.0 - smoothstep(hi - e, hi + e, f));
  return m.x * m.y;
}
vec3 lowFarWin() {
  vec2 fw = fwidth(vLowBay) + 1e-4, id = floor(vLowBay) + vLowOff;
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
  return lit * lowWinMask() * ${LOW_FAR.glow};
}
// a band's ribbon in High's bays and storeys (the facade's own uv, not mirrored, so each window is High's), and a pixel's share of each
vec2 lowRibUv() { return vLowFuv / max(vLowLook.xy, vec2(0.1)); }
vec2 lowRibFw() { return fwidth(lowRibUv()) + 1e-4; }
// a band's window in its cell, as High's: xy its sill's corner, zw its size. The ground floor's shop window is wider and down to the pavement
vec4 lowRibWin(float shop) {
  vec2 win = mix(vec2(${RIB_WIN[0]}, ${RIB_WIN[1]}), vec2(0.94, 0.66), shop);
  return vec4(0.5 - 0.5 * win.x, mix((1.0 - win.y) * 0.6, 0.05, shop), win);
}
float lowBand(float a, float b, float x, float w) { return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }
// a band's ribbon: the glass of each storey's window, the frame between. The mask is the glass (0..1), antialiased by the pixel's width;
// where a bay or a storey is under a pixel, its mean (the window's part of the cell)
float lowRibGlass() {
  vec2 g = lowRibUv(), fw = lowRibFw(), f = fract(g);
  vec4 w = lowRibWin(1.0 - step(0.5, floor(g.y)));
  vec2 e = mix(smoothstep(w.xy - fw, w.xy + fw, f) - smoothstep(w.xy + w.zw - fw, w.xy + w.zw + fw, f), w.zw, smoothstep(0.1, 0.35, fw));
  return e.x * e.y;
}
float lowNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lowH(i), lowH(i + vec2(1.0, 0.0)), f.x), mix(lowH(i + vec2(0.0, 1.0)), lowH(i + vec2(1.0, 1.0)), f.x), f.y);
}
// how much the rooms in use gather at a place on a wall: in patches up it and along it (High's fGather)
float lowGather(vec2 p, float seed) { return (0.35 + 1.3 * lowNoise(vec2(seed * 3.3, p.y / 34.0))) * (0.55 + 0.9 * lowNoise(p / vec2(23.0, 16.0) + seed * 5.1)); }
// a band's ribbon window by window, as High's: its place in the window (o: 0..1 across, up the glass), its lites' slim dark mullions about
// ${RIB_LITE} m apart, a home's curtains drawn to the sides (a few closed) or an office's blind part way down, by High's hashes. Each goes to
// its mean where a pixel covers it, so a far ribbon does not shimmer. The window sits back in the wall: its reveal's shadow along the head
// and down one side. x: the mullions' share of the glass, y: the cover's, z: the fold, w: the reveal's shade
vec4 lowRibCover(vec2 g, vec2 fw) {
  vec2 id = floor(g);
  float shop = 1.0 - step(0.5, id.y);
  vec4 w = lowRibWin(shop);
  vec2 win = w.zw, o = clamp((fract(g) - w.xy) / win, 0.0, 1.0), ow = fw / win;
  float home = step(5.5, vLowKind) * step(vLowKind, 6.5), cf = smoothstep(0.1, 0.35, max(fw.x, fw.y)), fine = smoothstep(0.05, 0.18, max(fw.x, fw.y));
  float wm = win.x * vLowLook.x, lite = wm / max(1.0, floor(wm / ${RIB_LITE} + 0.5)), mpx = fw.x * vLowLook.x;
  float mull = 1.0 - smoothstep(0.035 - mpx, 0.035 + mpx, (0.5 - abs(fract(o.x * wm / lite) - 0.5)) * lite);
  mull = mix(mull, 0.07 / lite, smoothstep(0.1, 0.35, mpx / lite));
  float h2 = lowH(id * 1.37 + vLowSeed + 7.1);
  float drop = step(0.55, h2) * fract(h2 * 13.7), cw = 0.06 + 0.22 * fract(h2 * 7.3), sheer = step(0.84, h2);
  float cov = home > 0.5
    ? max(sheer, max(1.0 - smoothstep(cw - ow.x, cw + ow.x, o.x), smoothstep(1.0 - cw - ow.x, 1.0 - cw + ow.x, o.x)))
    : step(0.01, drop) * smoothstep(1.0 - drop - ow.y, 1.0 - drop + ow.y, o.y);
  // (a curtain's pleats, about 0.29 m apart, go to their mean before they are two pixels wide)
  float pleat = mix(0.82 + 0.18 * sin(o.x * wm * 22.0), 0.82, smoothstep(0.04, 0.08, mpx));
  float fold = mix(home > 0.5 ? pleat : 0.86 + 0.14 * o.y, 1.0, fine);
  vec2 f = fract(g);
  float hi = w.y + w.w - 0.14 * w.w, si = w.x + 0.07 * w.z;
  float rev = max(smoothstep(hi - fw.y, hi + fw.y, f.y), 1.0 - smoothstep(si - fw.x, si + fw.x, f.x));
  return vec4(mull, mix(cov, mix(0.22, 0.44, home), cf) * (1.0 - shop), fold, mix(rev, 0.1, cf) * 0.6);
}
// a lit room's lamp and level, for the frame round its window (lowRibLight sets it)
vec3 lowRibLamp = vec3(0.0);
// a band's ribbon at night, room by room as High's, by its hashes: each building has its share of lit rooms and its habit (a home lit room
// by room, one or two bays; an office in whole floors, in zones of a few bays, desk by desk, or in stacks a few storeys high), gathered in
// patches; a zone now and then turns its lights on or off on its own slow clock. Its lamps' own warmth, each room a little off it and at its
// own level, a few a fluorescent green or a screen's blue, tinted by the glass. A dark room still shows a little (a corridor's light, a
// standby lamp); a curtain or a blind lets less through; a home's lamp shade hangs in the room, in depth. The ground floor is shops, each a
// few bays wide, open or shut as one, in its own light. A building's rooms come on at its own time as the night comes. The glass mirrors the
// walls across the street (their lit windows) under a roof line that wanders, the night sky over it. Far off, each goes to its mean.
// c: lowRibCover's; V: the eye's ray to the wall, N: the wall's normal (both world)
vec3 lowRibLight(vec2 g, vec2 fw, vec4 c, vec3 V, vec3 N) {
  vec2 id = floor(g), f = fract(g);
  float seed = vLowSeed, refl = vLowMetal, home = step(5.5, vLowKind) * step(vLowKind, 6.5), shop = 1.0 - step(0.5, id.y);
  float cx = smoothstep(0.1, 0.35, fw.x), cf = max(cx, smoothstep(0.1, 0.35, fw.y)), fine = smoothstep(0.05, 0.18, max(fw.x, fw.y));
  float h = lowH(id + seed), h3 = lowH(id * 2.71 + seed * 0.13 + 3.3);
  float habit = lowH(vec2(floor(seed) * 0.37, 21.7)), share = 0.06 + 0.42 * lowH(vec2(seed * 0.731, 5.3)), hw = lowH(vec2(seed, 8.1));
  float zw = home > 0.5 ? 1.0 + step(0.55, lowH(vec2(seed, 8.7))) : habit < 0.2 ? 7.0 + floor(8.0 * hw) : habit < 0.55 ? 2.0 + floor(4.0 * hw) : habit < 0.8 ? 1.0 : 2.0 + floor(2.0 * hw);
  float zh = home < 0.5 && habit >= 0.8 ? 3.0 + floor(6.0 * lowH(vec2(seed, 19.3))) : 1.0;
  float zone = floor(id.x / zw), fl = floor(id.y / zh), cz = smoothstep(0.08, 0.25, fw.x / zw), cv = smoothstep(0.1, 0.35, fw.y / zh), cr = max(cz, cv);
  float gather = lowGather(vLowFuv, seed), gatherZ = lowGather(vec2(zone * zw * vLowLook.x, fl * zh * vLowLook.y), seed);
  float rf = lowH(vec2(fl * 0.37 + seed, 2.9)), zt = fract(vLowFuv.x / (vLowLook.x * zw)), zs = 0.5 * smoothstep(0.04, 0.16, fw.x / zw);
  float occ = home > 0.5 ? share * gatherZ : min(1.0, share * 2.6 * rf * rf * gatherZ);
  float swN = floor(fTime / (70.0 + 170.0 * lowH(vec2(zone + seed, fl + 1.7))) + lowH(vec2(fl + seed, zone + 2.3)));
  float zlit = abs(step(lowH(vec2(zone * 1.91 + seed, fl * 0.83 + 4.7)), occ) - step(0.94, lowH(vec2(zone * 3.1 + seed + swN * 0.77, fl * 1.3 + 6.1))));
  if (zs > 0.0) zlit = mix(zlit, 0.5 * (zlit + step(lowH(vec2((zt < 0.5 ? zone - 1.0 : zone + 1.0) * 1.91 + seed, fl * 0.83 + 4.7)), occ)), 1.0 - smoothstep(0.0, zs, min(zt, 1.0 - zt)));
  float lit = mix(mix(zlit, occ, cz), share * gather * mix(0.86, 1.0, home), cv);
  lit *= mix(mix(step(h3, 0.9), 0.9, cx), 1.0, home);
  lit = max(lit, 0.05);
  float sw = 1.0 + floor(3.0 * lowH(vec2(seed, 13.7))), sid = floor(id.x / sw), hs = lowH(vec2(sid + seed * 2.3, 11.3)), sOpen = step(lowH(vec2(sid + seed, 17.1)), 0.8);
  vec3 sCol = hs < 0.5 ? vec3(1.0, 0.8, 0.58) : hs < 0.64 ? vec3(0.3, 0.8, 1.0) : hs < 0.78 ? vec3(1.0, 0.58, 0.2) : hs < 0.92 ? vec3(1.0, 0.32, 0.2) : vec3(1.0, 0.26, 0.64);
  sCol = mix(sCol, vec3(1.0, 0.7, 0.5), cx);
  lit = mix(lit, mix(sOpen, 0.8, cx), shop);
  float hc = lowH(vec2(zone + seed * 3.1, fl + 9.2)), bt = lowH(vec2(floor(seed) * 0.61, 33.1));
  float kz = mix(0.55 + 0.7 * lowH(vec2(hc, 3.7)), 1.0, cr) * (0.72 + 0.56 * lowH(vec2(floor(seed) * 0.43, 41.9)));
  vec3 lamp = lowLampCol(mix(0.68 * bt, 0.55 + 0.45 * bt, home) + (hc - 0.5) * 0.55 * (1.0 - cr));
  lamp = mix(lamp, mix(vec3(0.7, 1.0, 0.82), vec3(0.42, 0.56, 1.0), home), step(0.95, hc) * (1.0 - cr));
  lamp = mix(lamp, sCol, shop) * mix(vec3(1.0), vLowTint / max(max(vLowTint.r, vLowTint.g), max(vLowTint.b, 1e-3)), refl * 0.5 * (1.0 - shop));
  // a home's lamp shade, in depth: the eye's ray goes on into the room (its bays wide, a storey high, a few metres deep) and meets the shade
  float inLit = mix(0.36, 0.4, home);
  if (home > 0.5 && fine < 0.999) {
    vec3 rd = vec3(dot(V, vec3(N.z, 0.0, -N.x)), V.y, max(-dot(V, N), 0.02));
    vec4 w = lowRibWin(shop);
    float rw = zw * vLowLook.x, rc = (w.y + w.w) * vLowLook.y + 0.12, hr = lowH(vec2(zone + seed, id.y + 0.5)), dep = 3.4 + 1.8 * lowH(vec2(seed, 1.9));
    vec3 oc = vec3(clamp(vLowFuv.x - zone * rw, 0.0, rw), clamp(f.y * vLowLook.y, 0.01, rc - 0.01), 0.0) - vec3(rw * (0.3 + 0.4 * hr), rc - 0.55, dep * 0.55);
    float b = dot(oc, rd), q = dot(oc, oc) - 0.05;
    inLit = mix(inLit, b < 0.0 && b * b > q ? 3.0 : inLit, 1.0 - fine);
  }
  float through = mix(inLit, mix(0.3, 0.4, home) * c.z, c.y);
  float bNight = mix(smoothstep(0.0, 0.2, fNight - 0.8 * lowH(vec2(floor(seed) * 0.29, 51.3))), fNight, shop);
  lowRibLamp = lamp * lit * 0.06 * bNight;
  vec3 rooms = lamp * (${RIB_LIT} * kz * lit * through * (1.0 - 0.5 * refl * (1.0 - shop)) * (bNight * mix(0.6, 1.2, shop) + 0.02));
  // the mirror: the eye's ray turned by the glass meets the walls across (their lit windows, a pane each, some lit), the road under them, the
  // sky over their roof line
  vec3 R = reflect(V, N);
  vec2 rs = vec2(dot(R, vec3(N.z, 0.0, -N.x)), R.y) / max(dot(R, N), 0.1) + (vec2(h, lowH(id * 1.37 + seed + 7.1)) - 0.5) * (0.01 + 0.025 * refl) * (1.0 - cf);
  vec2 rp = vec2(vLowFuv.x, vLowY) + rs * (abs(N.x) > 0.5 ? 32.0 : 24.0), rg = rp / vec2(3.0, 3.4), rq = fract(rg);
  float hit = 1.0 - smoothstep(-0.7, 0.7, rp.y - 13.0 - 32.0 * lowNoise(vec2(rp.x / 34.0, seed * 0.37)));
  float road = 1.0 - smoothstep(-0.4, 0.4, rp.y), pane = mix(lowBand(0.18, 0.82, rq.x, 0.1) * lowBand(0.22, 0.78, rq.y, 0.1), 0.34, cf);
  vec3 across = fHor * 0.3 * (1.0 - 0.3 * pane) + vec3(1.0, 0.76, 0.5) * pane * mix(step(0.74, lowH(floor(rg) + seed)), 0.26, cf) * 0.55 * fNight;
  vec3 mirrorK = mix(mix(vec3(0.1 + 0.09 * h), vLowTint * 1.7, refl * 0.9), vec3(1.0), pow(1.0 - clamp(-dot(V, N), 0.0, 1.0), 5.0));
  return rooms + mirrorK * (hit * mix(across, fHor * 0.09, road) + (1.0 - hit) * fHor * 0.3);
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
  // (its frame each storey a touch different, as High's; its tone is High's lit beige under this lambert)
  float lowG = lowRibGlass();
  vec2 lowRg2 = lowRibUv(), lowRfw = lowRibFw();
  if (lowRib > 0.5) lowRibC = lowRibCover(lowRg2, lowRfw);
  vec3 lowRibFr = vec3(${RIB_FRAME.join(', ')}) * (0.92 + 0.14 * mix(lowH(vec2(floor(lowRg2.y), vLowSeed)), 0.5, smoothstep(0.1, 0.35, lowRfw.y)));
  vec4 lowNear = mix(textureGrad(map, lowUv, lowDx, lowDy), vec4(mix(lowRibFr, vec3(0.09, 0.1, 0.12), lowG), lowG), lowRib);
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
float lowRibD = 1.0 - step(0.001, abs(vLowLook.w - ${RIB_WIN[1]}));
// a band's glass: the dark room behind its half-mirror, its curtains or blinds pale, on slim dark mullions (lowRibC). It keeps its dark at
// any range, as base's bands do (a ribbon is half the wall: it reads as stripes, not navy); its cover goes to its mean far off
vec3 lowRibFab = mix(vec3(0.42, 0.43, 0.44), vec3(0.62, 0.57, 0.5), step(5.5, vLowKind) * step(vLowKind, 6.5)) * lowRibC.z;
vec3 lowRibGl = mix(vLowTint * ${LOW_RIB_GLASS} + lowRibFab * (${RIB_FABRIC} * lowRibC.y), vec3(0.03), lowRibC.x) * (1.0 - lowRibC.w);
vec3 lowGlassD = mix(mix(vLowTint * ${LOW_DAY_GLASS}, lowFrameD * mix(vec3(1.0), lowHue, ${LOW_FAR_HUE}) * ${LOW_FAR_GLASS}, lowFarD), lowRibGl, lowRibD);
// far off the pane's place is the analytic window (its edge the pixel's width), not the atlas's mean: a far tower keeps its rows of windows
float lowGlassF = mix(lowGlassM, lowWinMask() * vLowFac, lowFarD * (1.0 - lowRibD));
vec3 lowDayWall = mix(lowFrameD, lowGlassD, lowGlassF);
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
    // a band's wall: its ribbon's rooms on the glass between the mullions, not the atlas's rooms (far off, their mean)
    // (the frame round a lit window catches a little of its light)
    float lowRib = 1.0 - step(0.001, abs(vLowLook.w - ${RIB_WIN[1]}));
    vec2 lowRg2 = lowRibUv(), lowRfw = lowRibFw();
    float lowRg = lowRibGlass() * (1.0 - lowRibC.x);
    vec3 lowRibbon = vec3(0.0);
    if (lowRib > 0.5) {
      vec3 lowV = inverseTransformDirection(normalize(-vViewPosition), viewMatrix), lowN = inverseTransformDirection(normal, viewMatrix);
      lowRibbon = lowRibLight(lowRg2, lowRfw, lowRibC, lowV, lowN) * lowRg;
      lowRibbon += vColor.rgb * lowShade * lowRibLamp * (1.0 - lowRg);
    }
    lowLit = mix(mix(lowRooms, lowFarWin(), lowFar), lowRibbon, lowRib);
  }
  totalEmissiveRadiance = emissive * (lowLit * vLowFac * vLowNight + lowGlow) * fNight;
}`);
  };
  mat.customProgramCacheKey = () => 'outside-facade-low';
  return { mat, u, lamps };
}
