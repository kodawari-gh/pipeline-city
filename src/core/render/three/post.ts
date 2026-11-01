// The post chain: the scene, ambient occlusion (contact shadows in every corner and under every part), the selection outline (a yellow edge round
// the picked part, LOWPOLY_STYLE.md "Outline"), bloom (the RGB, the screen, the lamp glow), then tone mapping. The outline runs only while something is picked.
import { HalfFloatType, Vector2, WebGLRenderTarget, type Object3D, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { pixelRatio, type Graphics } from '@/app/graphics';
import { BASE_EXPOSURE } from './init';

/** GTAO that skips what light passes through (glass, steam, glow sprites): the stock pass hides only points and lines, so a pane of glass got a dark AO halo. */
class ClearAO extends GTAOPass {
  _overrideVisibility(): void {
    const cache = (this as unknown as { _visibilityCache: Object3D[] })._visibilityCache;
    this.scene.traverse((o) => {
      const m = (o as Object3D & { material?: { transparent?: boolean } | { transparent?: boolean }[] }).material;
      const clear = (o as Object3D & { isSprite?: boolean }).isSprite || (o as Object3D & { isPoints?: boolean; isLine?: boolean }).isPoints
        || (o as Object3D & { isLine?: boolean }).isLine || (Array.isArray(m) ? m.some((x) => x.transparent) : !!m?.transparent);
      if (clear && o.visible) { o.visible = false; cache.push(o); }
    });
  }
}

/** What the post chain takes from the graphics settings. */
export type PostOptions = Pick<Graphics, 'ao' | 'bloom' | 'msaa' | 'scale' | 'brightness'>;

/** The ambient occlusion's samples at each level (0: the pass is off; 16 is the pass's own default). */
const AO_LEVELS = [0, 8, 16, 32];
/** The bloom's strength at each level (0: the pass is off). */
const BLOOM_LEVELS = [0, 0.3, 0.5];

export class Post {
  private composer: EffectComposer;
  private outline: OutlinePass;
  private ao: ClearAO;
  private bloom: UnrealBloomPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, w: number, h: number) {
    const target = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new ClearAO(scene, camera, w, h);
    this.ao.updateGtaoMaterial({ radius: 900, distanceExponent: 1.4, thickness: 600, scale: 1.2 });
    this.ao.blendIntensity = 0.85;
    this.composer.addPass(this.ao);
    this.outline = new OutlinePass(new Vector2(w, h), scene, camera);
    this.outline.visibleEdgeColor.set(0xffff00);
    this.outline.hiddenEdgeColor.set(0x8a7a00);
    this.outline.edgeStrength = 4;
    this.outline.edgeThickness = 1.5;
    this.outline.enabled = false;
    this.composer.addPass(this.outline);
    this.bloom = new UnrealBloomPass(new Vector2(w, h), 0.5, 0.4, 1.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /** The graphics settings (`app/graphics.ts`): the passes, the multisampling and the pixels drawn. A new sample count frees the targets, so it costs a frame; the same one costs nothing. */
  apply(g: PostOptions, renderer: WebGLRenderer, w: number, h: number): void {
    const ao = AO_LEVELS[g.ao] ?? 0;
    this.ao.enabled = ao > 0;
    if (ao) { this.ao.updateGtaoMaterial({ samples: ao }); this.ao.updatePdMaterial({ samples: ao }); }
    const bloom = BLOOM_LEVELS[g.bloom] ?? 0;
    this.bloom.enabled = bloom > 0;
    this.bloom.strength = bloom;
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) if (t.samples !== g.msaa) { t.samples = g.msaa; t.dispose(); }
    const ratio = pixelRatio(g.scale);
    renderer.toneMappingExposure = BASE_EXPOSURE * g.brightness;
    if (ratio === renderer.getPixelRatio()) return;
    renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  setOutlined(objects: Object3D[]): void {
    this.outline.selectedObjects = objects;
    this.outline.enabled = objects.length > 0;
  }

  setSize(w: number, h: number): void { this.composer.setSize(w, h); }
  render(): void { this.composer.render(); }
}
