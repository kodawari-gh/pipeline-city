// The city's soft glow (`view.ts`): the light a night photo spreads round every bright thing. The picture's bright parts go down a chain of
// targets, each half the last and blurred on the way, then back up it, each step added to the sharper one above. So a lit window has a tight
// halo, a lit street a wide one. The window's quad adds the result to the picture.
import { AdditiveBlending, HalfFloatType, NoBlending, ShaderMaterial, Vector2, WebGLRenderTarget, type Blending, type Texture, type WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** The chain's length: its last target is 1/32 of the picture each way. */
const LEVELS = 5;
/** Under the first the picture adds nothing to the glow, over the second all of it. */
const LOW = '0.45', HIGH = '1.3';

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// `fr`: the share of the source its picture fills (the targets only grow); `px`: the source's texel. A tap stays in the picture
const TAP = /* glsl */`
uniform sampler2D src;
uniform vec2 fr, px;
varying vec2 vUv;
vec3 tap(float x, float y) { return texture2D(src, min(vUv * fr + vec2(x, y) * px, fr - 0.5 * px)).rgb; }`;

/** The first step: the bright parts. A stray glint is held down, so it does not flash a whole halo. */
const BRIGHT = /* glsl */`${TAP}
vec3 safe(vec3 c) { return min(max(c, vec3(0.0)), vec3(4.0)); }
void main() {
  vec3 c = (safe(tap(-1.0, -1.0)) + safe(tap(1.0, -1.0)) + safe(tap(-1.0, 1.0)) + safe(tap(1.0, 1.0))) * 0.25;
  gl_FragColor = vec4(c * smoothstep(${LOW}, ${HIGH}, max(c.r, max(c.g, c.b))), 1.0);
}`;

const DOWN = /* glsl */`${TAP}
void main() {
  gl_FragColor = vec4((tap(0.0, 0.0) * 4.0 + tap(-1.0, -1.0) + tap(1.0, -1.0) + tap(-1.0, 1.0) + tap(1.0, 1.0)) / 8.0, 1.0);
}`;

const UP = /* glsl */`${TAP}
void main() {
  vec3 side = tap(-2.0, 0.0) + tap(2.0, 0.0) + tap(0.0, -2.0) + tap(0.0, 2.0);
  vec3 corner = tap(-1.0, -1.0) + tap(1.0, -1.0) + tap(-1.0, 1.0) + tap(1.0, 1.0);
  gl_FragColor = vec4((side + corner * 2.0) / 12.0, 1.0);
}`;

const step = (fragmentShader: string, blending: Blending): ShaderMaterial => new ShaderMaterial({
  vertexShader: VERT, fragmentShader, blending, depthTest: false, depthWrite: false, toneMapped: false,
  uniforms: { src: { value: null }, fr: { value: new Vector2(1, 1) }, px: { value: new Vector2(1, 1) } },
});

export class CityGlow {
  private levels: WebGLRenderTarget[] = [];
  private bright = step(BRIGHT, NoBlending);
  private down = step(DOWN, NoBlending);
  private up = step(UP, AdditiveBlending);
  private quad = new FullScreenQuad(this.bright);

  /** The glow, the size of half the picture. */
  get texture(): Texture | null { return this.levels[0]?.texture ?? null; }

  /** The glow of `source`, whose first `w` by `h` pixels hold the picture. */
  run(renderer: WebGLRenderer, source: WebGLRenderTarget, w: number, h: number): void {
    this.fit(source.width, source.height);
    const auto = renderer.autoClear, sizes: [number, number][] = [];
    renderer.autoClear = false;
    let from = source, fw = w, fh = h;
    this.levels.forEach((to, i) => {
      const tw = Math.max(1, Math.ceil(fw / 2)), th = Math.max(1, Math.ceil(fh / 2));
      this.pass(renderer, i ? this.down : this.bright, from, fw, fh, to, tw, th);
      sizes.push([tw, th]);
      from = to; fw = tw; fh = th;
    });
    for (let i = LEVELS - 2; i >= 0; i--) this.pass(renderer, this.up, this.levels[i + 1]!, sizes[i + 1]![0], sizes[i + 1]![1], this.levels[i]!, sizes[i]![0], sizes[i]![1]);
    renderer.autoClear = auto;
  }

  private pass(renderer: WebGLRenderer, mat: ShaderMaterial, from: WebGLRenderTarget, fw: number, fh: number, to: WebGLRenderTarget, tw: number, th: number): void {
    mat.uniforms.src!.value = from.texture;
    (mat.uniforms.fr!.value as Vector2).set(fw / from.width, fh / from.height);
    (mat.uniforms.px!.value as Vector2).set(1 / from.width, 1 / from.height);
    to.viewport.set(0, 0, tw, th);
    to.scissor.set(0, 0, tw, th);
    to.scissorTest = true;
    renderer.setRenderTarget(to);
    this.quad.material = mat;
    this.quad.render(renderer);
  }

  /** The chain for a picture of this size: it only changes with the picture's target. */
  private fit(w: number, h: number): void {
    const first = this.levels[0], tw = Math.ceil(w / 2), th = Math.ceil(h / 2);
    if (first && first.width === tw && first.height === th) return;
    for (const t of this.levels) t.dispose();
    this.levels = [];
    let lw = w, lh = h;
    for (let i = 0; i < LEVELS; i++) {
      lw = Math.max(1, Math.ceil(lw / 2)); lh = Math.max(1, Math.ceil(lh / 2));
      this.levels.push(new WebGLRenderTarget(lw, lh, { type: HalfFloatType, depthBuffer: false }));
    }
  }

  dispose(): void {
    for (const t of this.levels) t.dispose();
    this.bright.dispose(); this.down.dispose(); this.up.dispose();
    this.quad.dispose();
  }
}
