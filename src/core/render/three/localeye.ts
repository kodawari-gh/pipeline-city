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
// It is the chain's last pass (PERF21): one draw to the screen takes the picture's look (the room's grade, `post.ts`), the lift, the tone
// mapping and the screen's colour space (as three's OutputPass). Each was a full-screen pass of its own, into a half-float target; a phone's
// tile GPU writes each such target out to memory and reads it back. The math and its order are as they were; only the half-float steps between are gone.
import {
  ACESFilmicToneMapping, AgXToneMapping, CineonToneMapping, ColorManagement, CustomToneMapping, HalfFloatType, LinearFilter, LinearToneMapping, NearestFilter, NeutralToneMapping,
  RawShaderMaterial, ReinhardToneMapping, ShaderMaterial, SRGBTransfer, WebGLRenderTarget, type IUniform, type Texture, type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

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

/**
 * A look the picture takes before the eye sees it, in the scene's light (the room's grade, `post.ts`): GLSL that defines
 * `vec3 look(vec3 c, vec2 uv)` for a pixel of colour `c` at `uv`, and its uniforms.
 */
export interface Look { glsl: string; uniforms: Record<string, IUniform> }
const SAME: Look = { glsl: /* glsl */`vec3 look(vec3 c, vec2 uv) { return c; }`, uniforms: {} };

const VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const LUM = /* glsl */`dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))`;
const f = (n: number) => n.toFixed(1);

// the picture's log luminance at a quarter of its size: four taps, each the mean of four pixels. The picture is the one after the look: each
// texel takes it at its own middle (as a pass of its own over the picture did), then the four round a tap mix as the GPU's linear filter mixes them.
const downFrag = (look: Look) => /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 px;
varying vec2 vUv;
${look.glsl}
vec3 seen(ivec2 t, ivec2 n) { t = clamp(t, ivec2(0), n - 1); return look(texelFetch(tDiffuse, t, 0).rgb, (vec2(t) + 0.5) / vec2(n)); }
float l(vec2 o) {
  ivec2 n = textureSize(tDiffuse, 0);
  vec2 q = (vUv + o * px) * vec2(n) - 0.5, w = fract(q);
  ivec2 t = ivec2(floor(q));
  vec3 c = mix(mix(seen(t, n), seen(t + ivec2(1, 0), n), w.x), mix(seen(t + ivec2(0, 1), n), seen(t + ivec2(1, 1), n), w.x), w.y);
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

// each pixel, to the screen: the look; then its base from the grid (its own bin, between the cells' middles and the two nearest bins; its own
// luminance where the bin is near empty) and the lift (`lift` above), while the eye is on; then the tone mapping and the colour space, as
// three's OutputShader (`TONE`: the renderer's tone mapping function, `SRGB_TRANSFER`: an sRGB screen). A raw shader: the program is the same
// whether it draws to a target or to the screen, so `startPrograms` (`compile.ts`) links the one the screen will use.
const finishFrag = (look: Look) => /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tGrid;
uniform vec2 size;
uniform vec2 grid;
uniform float midLog;
uniform float strength;
uniform vec4 keep;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
${look.glsl}
varying vec2 vUv;
vec2 at(float u, float v, float z) { return texture2D(tGrid, vec2((u + z * grid.x) / (grid.x * ${f(BINS)}), v)).rg; }
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  c.rgb = look(c.rgb, vUv);
  if (strength > 0.0) {
    float l = log2(max(${LUM}, 1e-7)), b = clamp(l - ${f(LO)}, 0.0, ${f(BINS - 1)}), z0 = floor(b), z1 = min(z0 + 1.0, ${f(BINS - 1)});
    float u = clamp(vUv.x * size.x / ${f(CELL)}, 0.5, grid.x - 0.5), v = clamp(vUv.y * size.y / ${f(CELL)}, 0.5, grid.y - 0.5) / grid.y;
    vec2 s = mix(at(u, v, z0), at(u, v, z1), b - z0);
    float base = (s.x + 1e-4 * l) / (s.y + 1e-4), d = base - midLog;
    float up = clamp(-d * (1.0 - (d < 0.0 ? keep.x : keep.y)), -keep.w, keep.z);
    c.rgb *= exp2(up * strength);
  }
  gl_FragColor = c;
  #ifdef TONE
  gl_FragColor.rgb = TONE(gl_FragColor.rgb);
  #endif
  #ifdef SRGB_TRANSFER
  gl_FragColor = sRGBTransferOETF(gl_FragColor);
  #endif
}`;
const FINISH_VERT = /* glsl */`
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** The GLSL tone mapping function of each of three's tone mappings (as OutputPass picks them). */
const TONE: Record<number, string> = {
  [LinearToneMapping]: 'LinearToneMapping', [ReinhardToneMapping]: 'ReinhardToneMapping', [CineonToneMapping]: 'CineonToneMapping', [ACESFilmicToneMapping]: 'ACESFilmicToneMapping',
  [AgXToneMapping]: 'AgXToneMapping', [NeutralToneMapping]: 'NeutralToneMapping', [CustomToneMapping]: 'CustomToneMapping',
};

const target = (w: number, h: number, filter: typeof LinearFilter | typeof NearestFilter) =>
  new WebGLRenderTarget(w, h, { type: HalfFloatType, depthBuffer: false, magFilter: filter, minFilter: filter, generateMipmaps: false });

/** The eye's local adaptation, and the chain's last pass: the look, the lift, the tone mapping. */
export class LocalEye {
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
  private lum = target(1, 1, NearestFilter);
  private grid = target(1, 1, NearestFilter);
  private blur = target(1, 1, LinearFilter);
  private down: ShaderMaterial;
  private build = new ShaderMaterial({ uniforms: { tLum: { value: this.lum.texture }, lumSize: { value: [1, 1] }, gx: { value: 1 } }, vertexShader: VERT, fragmentShader: GRID_FRAG });
  private smooth = new ShaderMaterial({ uniforms: { tGrid: { value: this.grid.texture }, grid: { value: [1, 1] } }, vertexShader: VERT, fragmentShader: BLUR_FRAG });
  private finish: RawShaderMaterial;
  private quad = new FullScreenQuad();
  /** The renderer's tone mapping and colour space that the finish's defines stand for. */
  private outputKey = '';

  /** `look` (the room's grade): its uniforms are shared, so a value set on them holds in the eye's grid and in the finish alike. */
  constructor(w: number, h: number, look: Look = SAME) {
    this.down = new ShaderMaterial({ uniforms: { tDiffuse: { value: null }, px: { value: [0, 0] }, ...look.uniforms }, vertexShader: VERT, fragmentShader: downFrag(look) });
    this.finish = new RawShaderMaterial({
      name: 'Finish',
      uniforms: {
        tDiffuse: { value: null }, tGrid: { value: this.blur.texture }, size: { value: [1, 1] }, grid: { value: [1, 1] }, midLog: { value: 0 }, strength: { value: 1 },
        keep: { value: [SHADOW_C, HIGH_C, MAX_UP, MAX_DOWN] }, toneMappingExposure: { value: 1 }, ...look.uniforms,
      },
      vertexShader: FINISH_VERT, fragmentShader: finishFrag(look),
    });
    this.setSize(w, h);
  }

  /** Sets the finish's defines to `r`'s tone mapping and colour space (as three's OutputPass): a change makes its program again. */
  output(r: WebGLRenderer): void {
    const key = `${r.toneMapping}|${r.outputColorSpace}`;
    if (key === this.outputKey) return;
    this.outputKey = key;
    const d: Record<string, string> = {}, tone = TONE[r.toneMapping];
    if (tone) d.TONE = tone;
    if (ColorManagement.getTransfer(r.outputColorSpace) === SRGBTransfer) d.SRGB_TRANSFER = '';
    this.finish.defines = d;
    this.finish.needsUpdate = true;
  }

  setSize(w: number, h: number): void {
    const lw = Math.max(1, Math.ceil(w / DOWN)), lh = Math.max(1, Math.ceil(h / DOWN)), [gx, gy] = gridSize(w, h);
    this.lum.setSize(lw, lh);
    this.grid.setSize(gx * BINS, gy);
    this.blur.setSize(gx * BINS, gy);
    this.down.uniforms.px!.value = [1 / w, 1 / h];
    this.build.uniforms.lumSize!.value = [lw, lh];
    this.build.uniforms.gx!.value = gx;
    this.smooth.uniforms.grid!.value = [gx, gy];
    this.finish.uniforms.size!.value = [w, h];
    this.finish.uniforms.grid!.value = [gx, gy];
  }

  /** Is the eye on? Then `adapt` must run before each `draw`. */
  get on(): boolean { return this.strength > 0; }

  private step(renderer: WebGLRenderer, m: ShaderMaterial, to: WebGLRenderTarget | null): void {
    this.quad.material = m;
    renderer.setRenderTarget(to);
    this.quad.render(renderer);
  }

  /** The grid of `picture` (the scene's light), in three small passes: a quarter of the picture, the grid, its blur. */
  adapt(renderer: WebGLRenderer, picture: Texture): void {
    this.down.uniforms.tDiffuse!.value = picture;
    this.step(renderer, this.down, this.lum);
    this.step(renderer, this.build, this.grid);
    this.step(renderer, this.smooth, this.blur);
  }

  /**
   * Draws `picture` to `to` (null: the screen) with the look, the lift (from the grid `adapt` made, while the eye is `on`) and the tone
   * mapping, in one full-screen pass.
   */
  draw(renderer: WebGLRenderer, picture: Texture, to: WebGLRenderTarget | null = null): void {
    this.output(renderer);
    const a = this.finish.uniforms;
    a.tDiffuse!.value = picture;
    a.midLog!.value = Math.log2(this.key / this.exposure);
    (a.keep!.value as number[])[1] = this.high;
    a.strength!.value = this.on ? this.strength : 0;
    a.toneMappingExposure!.value = renderer.toneMappingExposure;
    this.step(renderer, this.finish, to);
  }

  dispose(): void {
    for (const t of [this.lum, this.grid, this.blur]) t.dispose();
    for (const m of [this.down, this.build, this.smooth, this.finish]) m.dispose();
    this.quad.dispose();
  }
}
