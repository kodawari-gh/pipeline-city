// The eye's local adaptation (the owner's call at T180, 2026-11-06; `src/features/room/light.md`, "The eye"). In a dark room by a bright
// window the eye sees the walls and the sky at once; a camera with one exposure cannot. Like the eye (and a phone's HDR photo), this pass lifts
// the dark parts of the picture and holds back the bright ones, and keeps the detail in each. The light stays real: it changes only how the
// picture is shown. It runs in the scene's light, before the exposure and the tone mapping (`post.ts`), and scales each pixel.
//
// A pixel's log luminance is its base (the broad light round it) plus its detail. The base comes from a bilateral grid: the picture in cells
// of `CELL` pixels, each cell split into bins of one stop, each bin the mean of the cell's pixels of about that brightness, then blurred over
// the cells. A pixel reads the bin of its own brightness, so a dark column against the sky has a dark base, and no halo forms at the edge. The
// base's distance from the eye's middle grey shrinks (to `SHADOW_C` of it below, `HIGH_C` above); the detail stays.
//
// It is the post chain's last pass (PERF21): its last step also does the room's grade before the lift, and the tone mapping and the output's
// colour space after it. These were three full-screen passes (a `ShaderPass`, this one, an `OutputPass`), each a write and a read of a
// half-float picture; the sums are the same.
import {
  ACESFilmicToneMapping, AgXToneMapping, CineonToneMapping, ColorManagement, CustomToneMapping, HalfFloatType, LinearFilter, LinearToneMapping, NearestFilter,
  NeutralToneMapping, RawShaderMaterial, ReinhardToneMapping, SRGBTransfer, ShaderMaterial, WebGLRenderTarget,
  type ColorSpace, type Texture, type ToneMapping, type WebGLRenderer,
} from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/** A grid cell's side (pixels), the picture's step down before the grid (each grid cell reads `CELL / DOWN` squared of its pixels). */
export const CELL = 32, DOWN = 4;
/** The grid's bins: one a stop, from `LO` (2^-18, a black) to `LO + BINS - 1` (2^5, a bulb). */
export const LO = -18, BINS = 24;
/**
 * The base's distance from middle grey keeps this share below it (the dark is lifted) and above it (the bright is held back). Above it by
 * day: the bright glass held back; at night the eye keeps more of it (`LocalEye.high`).
 */
export const SHADOW_C = 0.18, HIGH_C = 0.4;
/** At most this many stops up or down. */
export const MAX_UP = 9, MAX_DOWN = 3;
/** The scene's luminance that shows as middle grey at an exposure of 1 (ACES: 0.18 out at 0.22 in, after its own 1 / 0.6). */
export const MID = 0.13;

/** The grid's cells across and down for a picture `w` x `h` pixels. */
export const gridSize = (w: number, h: number): [number, number] => [Math.max(1, Math.ceil(w / CELL)), Math.max(1, Math.ceil(h / CELL))];

/**
 * The stops a pixel whose base is `base` (log2 luminance) is lifted (or lowered, below 0) at exposure `exposure`, the eye adapted to `key`
 * (`LocalEye.key`) and keeping `high` of the bright (`LocalEye.high`): the shader's own sum.
 */
export function lift(base: number, exposure: number, key = MID, high = HIGH_C): number {
  const d = base - Math.log2(key / exposure);
  return Math.min(MAX_UP, Math.max(-MAX_DOWN, -d * (1 - (d < 0 ? SHADOW_C : high))));
}

const VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const LUM = /* glsl */`dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))`;
const f = (n: number) => n.toFixed(1);

/**
 * The room's look over the picture, in its own light (before the tone mapping): the corners a little darker, as a lens's fall-off, and the
 * shadows a little warmer. `gradeK` (`roomness`, `post.ts`) fades it out toward the board view, where a part must read to the corners.
 */
export const GRADE = /* glsl */`
uniform float gradeK;
vec3 graded(vec3 c, vec2 uv) {
  vec2 d = uv - 0.5;
  float edge = 1.0 - 0.34 * smoothstep(0.25, 1.0, dot(d, d) * 2.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 warm = mix(vec3(1.07, 1.0, 0.9), vec3(1.0), smoothstep(0.0, 0.5, l));
  return c * mix(vec3(1.0), warm * edge, gradeK);
}`;

// the graded picture's log luminance at a quarter of its size: four taps, each the mean of four pixels. Each tap is the linear filter's own sum
// over the graded pixels (the grade is applied to each pixel first, as when it was a pass of its own)
const DOWN_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 px;
varying vec2 vUv;
${GRADE}
vec3 at(vec2 p) { vec2 q = clamp(p, vec2(0.0), 1.0 / px - 1.0), uv = (q + 0.5) * px; return graded(texture2D(tDiffuse, uv).rgb, uv); }
float l(vec2 o) {
  vec2 p = (vUv + o * px) / px - 0.5, p0 = floor(p), t = p - p0;
  vec3 c = mix(mix(at(p0), at(p0 + vec2(1.0, 0.0)), t.x), mix(at(p0 + vec2(0.0, 1.0)), at(p0 + vec2(1.0)), t.x), t.y);
  return ${LUM};
}
void main() {
  float m = 0.25 * (l(vec2(-1.0, -1.0)) + l(vec2(1.0, -1.0)) + l(vec2(-1.0, 1.0)) + l(vec2(1.0, 1.0)));
  gl_FragColor = vec4(log2(max(m, 1e-7)), 0.0, 0.0, 1.0);
}`;

// a grid texel (its cell, its bin): the sum of its cell's log luminances, each weighed by how near it is to the bin, and the sum of the weights,
// both over the cell's texel count (the targets are half floats: a plain sum would overflow in the blur)
const GRID_FRAG = /* glsl */`
uniform sampler2D tLum;
uniform vec2 lumSize;
uniform float gx;
void main() {
  float tx = floor(gl_FragCoord.x), z = floor(tx / gx), cx = tx - z * gx, cy = floor(gl_FragCoord.y);
  float sl = 0.0, sw = 0.0;
  for (int j = 0; j < ${CELL / DOWN}; j++) for (int i = 0; i < ${CELL / DOWN}; i++) {
    vec2 t = vec2(cx, cy) * ${f(CELL / DOWN)} + vec2(float(i), float(j)) + 0.5;
    if (t.x > lumSize.x || t.y > lumSize.y) continue;
    float l = texture2D(tLum, t / lumSize).r, b = clamp(l - ${f(LO)}, 0.0, ${f(BINS - 1)});
    float w = max(0.0, 1.0 - abs(b - z));
    sl += w * l; sw += w;
  }
  gl_FragColor = vec4(vec2(sl, sw) / ${f((CELL / DOWN) ** 2)}, 0.0, 1.0);
}`;

// the grid blurred: five cells each way across the picture (1 4 6 4 1), three bins (1 2 1)
const BLUR_FRAG = /* glsl */`
uniform sampler2D tGrid;
uniform vec2 grid;
float g(int i) { return i == 0 ? 6.0 : (i == 1 || i == -1) ? 4.0 : 1.0; }
void main() {
  float tx = floor(gl_FragCoord.x), z = floor(tx / grid.x), cx = tx - z * grid.x, cy = floor(gl_FragCoord.y);
  vec2 s = vec2(0.0);
  for (int k = -1; k <= 1; k++) for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    float zz = clamp(z + float(k), 0.0, ${f(BINS - 1)}), xx = clamp(cx + float(i), 0.0, grid.x - 1.0), yy = clamp(cy + float(j), 0.0, grid.y - 1.0);
    float w = (k == 0 ? 2.0 : 1.0) * g(i) * g(j);
    s += w * texture2D(tGrid, (vec2(xx + zz * grid.x, yy) + 0.5) / vec2(grid.x * ${f(BINS)}, grid.y)).rg;
  }
  gl_FragColor = vec4(s / 1024.0, 0.0, 1.0);
}`;

// each pixel: the grade, its base from the grid (its own bin, between the cells' middles and the two nearest bins; its own luminance where the
// bin is near empty), then the lift (`lift` above; none at strength 0), the tone mapping and the output's colour space (as three's `OutputPass`)
const APPLY_VERT = /* glsl */`
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const APPLY_FRAG = /* glsl */`
precision highp float;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
${GRADE}
uniform sampler2D tDiffuse;
uniform sampler2D tGrid;
uniform vec2 size;
uniform vec2 grid;
uniform float midLog;
uniform float strength;
uniform vec4 keep;
varying vec2 vUv;
vec2 at(float u, float v, float z) { return texture2D(tGrid, vec2((u + z * grid.x) / (grid.x * ${f(BINS)}), v)).rg; }
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  c.rgb = graded(c.rgb, vUv);
  if (strength > 0.0) {
    float l = log2(max(${LUM}, 1e-7)), b = clamp(l - ${f(LO)}, 0.0, ${f(BINS - 1)}), z0 = floor(b), z1 = min(z0 + 1.0, ${f(BINS - 1)});
    float u = clamp(vUv.x * size.x / ${f(CELL)}, 0.5, grid.x - 0.5), v = clamp(vUv.y * size.y / ${f(CELL)}, 0.5, grid.y - 0.5) / grid.y;
    vec2 s = mix(at(u, v, z0), at(u, v, z1), b - z0);
    float base = (s.x + 1e-4 * l) / (s.y + 1e-4), d = base - midLog;
    float up = clamp(-d * (1.0 - (d < 0.0 ? keep.x : keep.y)), -keep.w, keep.z);
    c.rgb *= exp2(up * strength);
  }
  gl_FragColor = c;
  #ifdef LINEAR_TONE_MAPPING
    gl_FragColor.rgb = LinearToneMapping(gl_FragColor.rgb);
  #elif defined(REINHARD_TONE_MAPPING)
    gl_FragColor.rgb = ReinhardToneMapping(gl_FragColor.rgb);
  #elif defined(CINEON_TONE_MAPPING)
    gl_FragColor.rgb = CineonToneMapping(gl_FragColor.rgb);
  #elif defined(ACES_FILMIC_TONE_MAPPING)
    gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
  #elif defined(AGX_TONE_MAPPING)
    gl_FragColor.rgb = AgXToneMapping(gl_FragColor.rgb);
  #elif defined(NEUTRAL_TONE_MAPPING)
    gl_FragColor.rgb = NeutralToneMapping(gl_FragColor.rgb);
  #elif defined(CUSTOM_TONE_MAPPING)
    gl_FragColor.rgb = CustomToneMapping(gl_FragColor.rgb);
  #endif
  #ifdef SRGB_TRANSFER
    gl_FragColor = sRGBTransferOETF(gl_FragColor);
  #endif
}`;

/** The defines of the output's tone mapping and colour space, as three's `OutputPass` sets them. */
export function outputDefines(toneMapping: ToneMapping, colorSpace: string): Record<string, string> {
  const d: Record<string, string> = {};
  if (ColorManagement.getTransfer(colorSpace as ColorSpace) === SRGBTransfer) d.SRGB_TRANSFER = '';
  const tm = new Map<ToneMapping, string>([
    [LinearToneMapping, 'LINEAR'], [ReinhardToneMapping, 'REINHARD'], [CineonToneMapping, 'CINEON'], [ACESFilmicToneMapping, 'ACES_FILMIC'],
    [AgXToneMapping, 'AGX'], [NeutralToneMapping, 'NEUTRAL'], [CustomToneMapping, 'CUSTOM'],
  ]).get(toneMapping);
  if (tm) d[`${tm}_TONE_MAPPING`] = '';
  return d;
}

const target = (w: number, h: number, filter: typeof LinearFilter | typeof NearestFilter) =>
  new WebGLRenderTarget(w, h, { type: HalfFloatType, depthBuffer: false, magFilter: filter, minFilter: filter, generateMipmaps: false });

/** The post chain's last pass: the room's grade, the eye's local adaptation, then the tone mapping and the output's colour space. */
export class LocalEye extends Pass {
  /** The exposure the tone mapping will apply (the base, the player's brightness, the eye's): middle grey follows it. */
  exposure = 1;
  /**
   * The luminance (times the exposure) the eye adapts to: the base moves toward it. `MID` shows it as middle grey; a lower one keeps a
   * picture low-key (the room at night), and the metered eye's key keeps the mean where the meter put it (`board3d.ts`).
   */
  key = MID;
  /** The share of the base's distance above the key it keeps: `HIGH_C` by day; more at night, so the lamps' pools stand out of the dark. */
  high = HIGH_C;
  /** 0: off; 1: the whole lift. */
  strength = 1;
  /** The room's grade (`GRADE`): 0, none; 1, all of it. */
  grade = 1;
  /** The picture to read in place of the chain's last (the scene's own target, when no pass stands between: `Post.render`); null, the chain's. */
  source: Texture | null = null;
  private outKey = '';
  private lum = target(1, 1, NearestFilter);
  private grid = target(1, 1, NearestFilter);
  private blur = target(1, 1, LinearFilter);
  private build = new ShaderMaterial({ uniforms: { tLum: { value: this.lum.texture }, lumSize: { value: [1, 1] }, gx: { value: 1 } }, vertexShader: VERT, fragmentShader: GRID_FRAG });
  private smooth = new ShaderMaterial({ uniforms: { tGrid: { value: this.grid.texture }, grid: { value: [1, 1] } }, vertexShader: VERT, fragmentShader: BLUR_FRAG });
  private down = new ShaderMaterial({ uniforms: { tDiffuse: { value: null }, px: { value: [0, 0] }, gradeK: { value: 1 } }, vertexShader: VERT, fragmentShader: DOWN_FRAG });
  private apply = new RawShaderMaterial({
    name: 'LocalEyeOutput',
    uniforms: {
      tDiffuse: { value: null }, tGrid: { value: this.blur.texture }, size: { value: [1, 1] }, grid: { value: [1, 1] }, midLog: { value: 0 }, strength: { value: 1 },
      keep: { value: [SHADOW_C, HIGH_C, MAX_UP, MAX_DOWN] }, gradeK: { value: 1 }, toneMappingExposure: { value: 1 },
    },
    vertexShader: APPLY_VERT, fragmentShader: APPLY_FRAG,
  });
  private quad = new FullScreenQuad();

  constructor(w: number, h: number) {
    super();
    this.setSize(w, h);
  }

  override setSize(w: number, h: number): void {
    const lw = Math.max(1, Math.ceil(w / DOWN)), lh = Math.max(1, Math.ceil(h / DOWN)), [gx, gy] = gridSize(w, h);
    this.lum.setSize(lw, lh);
    this.grid.setSize(gx * BINS, gy);
    this.blur.setSize(gx * BINS, gy);
    this.down.uniforms.px!.value = [1 / w, 1 / h];
    this.build.uniforms.lumSize!.value = [lw, lh];
    this.build.uniforms.gx!.value = gx;
    this.smooth.uniforms.grid!.value = [gx, gy];
    this.apply.uniforms.size!.value = [w, h];
    this.apply.uniforms.grid!.value = [gx, gy];
  }

  /** Takes the renderer's tone mapping and output colour space (its program changes only when they do). Call it before its programs link. */
  setOutput(renderer: WebGLRenderer): void {
    const key = `${renderer.toneMapping}|${renderer.outputColorSpace}`;
    if (key === this.outKey) return;
    this.outKey = key;
    this.apply.defines = outputDefines(renderer.toneMapping, renderer.outputColorSpace);
    this.apply.needsUpdate = true;
  }

  override render(renderer: WebGLRenderer, write: WebGLRenderTarget, read: WebGLRenderTarget): void {
    const step = (m: ShaderMaterial, to: WebGLRenderTarget | null) => { this.quad.material = m; renderer.setRenderTarget(to); this.quad.render(renderer); };
    const src = this.source ?? read.texture;
    // (at strength 0 the lift is off: its grid is not read, so it is not built)
    if (this.strength > 0) {
      this.down.uniforms.tDiffuse!.value = src;
      this.down.uniforms.gradeK!.value = this.grade;
      step(this.down, this.lum);
      step(this.build, this.grid);
      step(this.smooth, this.blur);
    }
    this.setOutput(renderer);
    const a = this.apply.uniforms;
    a.tDiffuse!.value = src;
    a.midLog!.value = Math.log2(this.key / this.exposure);
    (a.keep!.value as number[])[1] = this.high;
    a.strength!.value = this.strength;
    a.gradeK!.value = this.grade;
    a.toneMappingExposure!.value = renderer.toneMappingExposure;
    step(this.apply, this.renderToScreen ? null : write);
  }

  override dispose(): void {
    for (const t of [this.lum, this.grid, this.blur]) t.dispose();
    for (const m of [this.down, this.build, this.smooth, this.apply]) m.dispose();
    this.quad.dispose();
  }
}
