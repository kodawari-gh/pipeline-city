// The post chain: the scene, ambient occlusion (contact shadows in every corner and under every part), the selection outline (a yellow edge round
// the picked part, LOWPOLY_STYLE.md "Outline"), bloom (the RGB, the screen, the lamp glow), the room's grade, the eye's local adaptation (`localeye.ts`:
// the dark lifted, the bright held back), then tone mapping. The outline runs only while something is picked.
// The scene is drawn once a frame: the passes after it read its depth. A stock GTAOPass and OutlinePass each draw the whole scene again, shadow maps included.
import { DepthTexture, FloatType, HalfFloatType, InstancedMesh, Mesh, NoBlending, Scene, ShaderMaterial, UniformsUtils, Vector2, WebGLRenderTarget, type Object3D, type PerspectiveCamera, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { pixelRatio, type Graphics } from '@/app/graphics';
import { BASE_EXPOSURE } from './init';
import { HIGH_C, LocalEye, MID } from './localeye';

/** Draws the scene into a target of its own: the multisampling and the depth stay here, so the screen passes after it pay for neither. */
class ScenePass extends RenderPass {
  readonly target: WebGLRenderTarget;
  private copy = new ShaderMaterial({ ...CopyShader, uniforms: UniformsUtils.clone(CopyShader.uniforms), blending: NoBlending, depthTest: false, depthWrite: false });
  private quad = new FullScreenQuad(this.copy);

  constructor(scene: Scene, camera: PerspectiveCamera, w: number, h: number) {
    super(scene, camera);
    this.target = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 4, depthTexture: new DepthTexture(w, h) });
    this.copy.uniforms.tDiffuse!.value = this.target.texture;
  }

  override setSize(w: number, h: number): void { this.target.setSize(w, h); }

  override render(renderer: WebGLRenderer, write: WebGLRenderTarget, read: WebGLRenderTarget, dt: number, mask: boolean): void {
    super.render(renderer, write, this.target, dt, mask);
    renderer.setRenderTarget(read);
    this.quad.render(renderer);
  }
}

/** Is it drawn? Its own flag and all those above it. */
const shown = (o: Object3D): boolean => { for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };

/** A stand-in for a picked mesh, in the outline's own small scene. It shares the mesh's matrix, so it follows without an update of its own. */
function standIn(m: Mesh): Mesh {
  const c = (m as InstancedMesh).isInstancedMesh ? new InstancedMesh(m.geometry, m.material, 0) : new Mesh(m.geometry, m.material);
  c.matrixWorld = m.matrixWorld;
  c.matrixAutoUpdate = c.matrixWorldAutoUpdate = c.frustumCulled = false;
  return c;
}

/**
 * The outline without a scene draw. The stock pass draws all that is not picked into a depth buffer, then hides the whole scene to draw the picked
 * meshes. Here its scene holds only stand-ins for them, so the first draw is empty, and the mask compares them with the depth the scene already left.
 */
class PickOutline extends OutlinePass {
  private standIns = new WeakMap<Mesh, Mesh>();

  constructor(size: Vector2, camera: PerspectiveCamera, depth: DepthTexture) {
    super(size, new Scene(), camera);
    const mask = this.prepareMaskMaterial;
    mask.uniforms.sceneDepth = { value: depth };
    // the picked part is in this depth too: the small margin keeps its own surface from reading as hidden behind itself
    mask.fragmentShader = `#include <packing>
      varying vec4 vPosition;
      varying vec4 projTexCoord;
      uniform sampler2D sceneDepth;
      uniform vec2 cameraNearFar;
      void main() {
        float depth = texture2DProj(sceneDepth, projTexCoord).r;
        float viewZ = -perspectiveDepthToViewZ(depth, cameraNearFar.x, cameraNearFar.y);
        gl_FragColor = vec4(0.0, -vPosition.z > viewZ * 1.001 ? 1.0 : 0.0, 1.0, 1.0);
      }`;
    this.renderTargetDepthBuffer.setSize(1, 1);
  }

  override setSize(w: number, h: number): void { super.setSize(w, h); this.renderTargetDepthBuffer.setSize(1, 1); }

  /** Outline these (meshes, or groups of them), as they stand this frame. */
  pick(objects: Object3D[]): void {
    const meshes: Mesh[] = [];
    for (const o of objects) if (shown(o)) o.traverseVisible((m) => { if ((m as Mesh).isMesh) meshes.push(m as Mesh); });
    const stage = this.renderScene;
    stage.clear();
    this.selectedObjects = meshes.map((m) => {
      let c = this.standIns.get(m);
      if (!c) this.standIns.set(m, c = standIn(m));
      c.geometry = m.geometry;
      c.material = m.material;
      if ((m as InstancedMesh).isInstancedMesh) { (c as InstancedMesh).instanceMatrix = (m as InstancedMesh).instanceMatrix; (c as InstancedMesh).count = (m as InstancedMesh).count; }
      stage.add(c);
      return c;
    });
  }
}

/** What the post chain takes from the graphics settings. */
export type PostOptions = Pick<Graphics, 'ao' | 'bloom' | 'msaa' | 'scale' | 'brightness'>;

/** How much a view `height` world units tall is a room view: 0 at the board view and closer, 1 from the room's overview out. */
export const roomness = (height: number): number => Math.min(1, Math.max(0, (height - 9000) / 20000));

/**
 * The room's look over the picture, in its own light (before the tone mapping): the corners a little darker, as a lens's fall-off, and the
 * shadows a little warmer. `k` (`roomness`) fades it out toward the board view, where a part must read to the corners.
 */
const GRADE = {
  name: 'Grade',
  uniforms: { tDiffuse: { value: null }, k: { value: 1 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float k;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float edge = 1.0 - 0.34 * smoothstep(0.25, 1.0, dot(d, d) * 2.0);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 warm = mix(vec3(1.07, 1.0, 0.9), vec3(1.0), smoothstep(0.0, 0.5, l));
      gl_FragColor = vec4(c.rgb * mix(vec3(1.0), warm * edge, k), c.a);
    }`,
};

/** The light meter's grid (`Post.meter`): each cell the mean log luminance of its block of the scene, from 8 x 8 taps. */
const METER_W = 16, METER_H = 9;
const METER = {
  name: 'Meter',
  uniforms: { tDiffuse: { value: null } },
  vertexShader: GRADE.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec2 cell = vec2(${(1 / METER_W).toFixed(6)}, ${(1 / METER_H).toFixed(6)}), o = vUv - 0.5 * cell;
      float s = 0.0;
      for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) {
        vec3 c = texture2D(tDiffuse, o + (vec2(float(i), float(j)) + 0.5) / 8.0 * cell).rgb;
        s += log(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5));
      }
      gl_FragColor = vec4(s / 64.0, 0.0, 0.0, 1.0);
    }`,
};

/** The ambient occlusion's samples at each level (0: the pass is off; 16 is the pass's own default). */
const AO_LEVELS = [0, 8, 16, 32];
/** The bloom's strength at each level (0: the pass is off). */
const BLOOM_LEVELS = [0, 0.3, 0.5];

export class Post {
  private composer: EffectComposer;
  private scene: ScenePass;
  private outline: PickOutline;
  private ao: GTAOPass;
  private bloom: UnrealBloomPass;
  private grade = new ShaderPass(GRADE);
  private local: LocalEye;
  private reach = 900;
  private brightness = 1;
  private eye = 1;
  private meterTarget = new WebGLRenderTarget(METER_W, METER_H, { type: FloatType, depthBuffer: false });
  private meterQuad = new FullScreenQuad(new ShaderMaterial({ ...METER, uniforms: UniformsUtils.clone(METER.uniforms) }));
  private meterCells = new Float32Array(METER_W * METER_H * 4);
  private meterFrame = 0;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, w: number, h: number) {
    this.composer = new EffectComposer(renderer, new WebGLRenderTarget(w, h, { type: HalfFloatType, depthBuffer: false }));
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.scene = new ScenePass(scene, camera, w, h);
    this.composer.addPass(this.scene);
    const depth = this.scene.target.depthTexture!;
    this.ao = new GTAOPass(scene, camera, w, h, { depthTexture: depth }); // no normals given: it works them out from the depth, so it draws no scene
    this.ao.updateGtaoMaterial({ radius: 900, distanceExponent: 1.4, thickness: 600, scale: 1.2 });
    this.ao.blendIntensity = 0.85;    this.composer.addPass(this.ao);
    this.outline = new PickOutline(new Vector2(w, h), camera, depth);
    this.outline.visibleEdgeColor.set(0xffff00);
    this.outline.hiddenEdgeColor.set(0x8a7a00);
    this.outline.edgeStrength = 4;
    this.outline.edgeThickness = 1.5;
    this.outline.enabled = false;
    this.composer.addPass(this.outline);
    this.bloom = new UnrealBloomPass(new Vector2(w, h), 0.5, 0.4, 1.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.local = new LocalEye(w, h);
    this.composer.addPass(this.local);
    this.composer.addPass(new OutputPass());
  }

  /** The exposure the tone mapping applies: the base, the player's brightness and the eye's adaptation. The local eye's middle grey follows it. */
  private expose(): void {
    this.composer.renderer.toneMappingExposure = this.local.exposure = BASE_EXPOSURE * this.brightness * this.eye;
  }

  /** The graphics settings (`app/graphics.ts`): the passes, the multisampling and the pixels drawn. A new sample count frees the targets, so it costs a frame; the same one costs nothing. */
  apply(g: PostOptions, renderer: WebGLRenderer, w: number, h: number): void {
    const ao = AO_LEVELS[g.ao] ?? 0;
    this.ao.enabled = ao > 0;
    if (ao) { this.ao.updateGtaoMaterial({ samples: ao }); this.ao.updatePdMaterial({ samples: ao }); }
    const bloom = BLOOM_LEVELS[g.bloom] ?? 0;
    this.bloom.enabled = bloom > 0;
    this.bloom.strength = bloom;
    const t = this.scene.target;
    if (t.samples !== g.msaa) { t.samples = g.msaa; t.dispose(); }
    const ratio = pixelRatio(g.scale);
    this.brightness = g.brightness;
    this.expose();
    if (ratio === renderer.getPixelRatio()) return;
    renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  /**
   * The occlusion's reach for a view `height` world units tall: a board part's 900 up to the board view, then wider with the view, so a room
   * view darkens its corners, the floor under the bed and the desk (4000, about 20 cm, from the room's overview out). The grade and the local
   * eye fade out on the way in: from the board view in, the metered eye alone adapts (`board3d.ts`), and the board keeps its tuned look.
   */
  setReach(height: number): void {
    const k = roomness(height), r = Math.round(900 + k * 3100);
    this.grade.uniforms.k!.value = k;
    this.local.strength = k;
    this.local.enabled = k > 0;
    if (this.reach === r) return;
    this.reach = r;
    // a wide reach samples evenly out to its edge (a room corner fades over its whole width), a part's stays weighted to the contact. Only
    // what is near in depth occludes (the bed's side must not shade the wall a metre behind it); the sparser samples are smoothed over more pixels.
    // Uniforms only: the pass rebuilds its shader for a new fall-off (set here straight on the uniform) or a new ring count, and a flight would
    // rebuild it every frame, slow enough for auto-adjust to drop the AO.
    this.ao.updateGtaoMaterial({ radius: r, thickness: 600 + k * 1200, distanceExponent: 1.4 - k * 0.4 });
    this.ao.gtaoMaterial.uniforms.distanceFallOff!.value = 1 - k * 0.6;
    this.ao.updatePdMaterial({ radius: 4 + k * 16 });
  }

  /** The eye's adaptation (`board3d.ts`): the exposure's factor `k` over the base and the player's brightness, the local eye's `key` and `high`. */
  setEye(k: number, key = MID, high = HIGH_C): void {
    this.eye = k;
    this.local.key = key;
    this.local.high = high;
    this.expose();
  }

  /**
   * The last frame's mean luminance, before the exposure: log-averaged over the picture, weighted to its middle, as a camera's meter. It reads
   * every fourth frame (null between, and always where a float target cannot be read back).
   */
  meter(): number | null {
    const r = this.composer.renderer;
    if (++this.meterFrame % 4 || !r.extensions.has('EXT_color_buffer_float')) return null;
    const was = r.getRenderTarget();
    (this.meterQuad.material as ShaderMaterial).uniforms.tDiffuse!.value = this.scene.target.texture;
    r.setRenderTarget(this.meterTarget);
    this.meterQuad.render(r);
    r.setRenderTarget(was);
    r.readRenderTargetPixels(this.meterTarget, 0, 0, METER_W, METER_H, this.meterCells);
    let s = 0, w = 0;
    for (let j = 0; j < METER_H; j++) for (let i = 0; i < METER_W; i++) {
      const dx = (i + 0.5) / METER_W - 0.5, dy = (j + 0.5) / METER_H - 0.5, k = Math.exp(-(dx * dx + dy * dy) / 0.08);
      s += k * this.meterCells[4 * (i + METER_W * j)]!; w += k;
    }
    return Math.exp(s / w);
  }

  setOutlined(objects: Object3D[]): void {
    this.outline.enabled = objects.length > 0;
    if (this.outline.enabled || this.outline.selectedObjects.length) this.outline.pick(objects);
  }

  setSize(w: number, h: number): void { this.composer.setSize(w, h); }
  render(): void { this.composer.render(); }
}
