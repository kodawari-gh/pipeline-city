// The post chain: the scene, the selection outline (a yellow edge round the picked part, LOWPOLY_STYLE.md "Outline"), then tone mapping. The outline pass runs only while something is picked.
import { HalfFloatType, Vector2, WebGLRenderTarget, type Object3D, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

export class Post {
  private composer: EffectComposer;
  private outline: OutlinePass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, w: number, h: number) {
    const target = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.outline = new OutlinePass(new Vector2(w, h), scene, camera);
    this.outline.visibleEdgeColor.set(0xffff00);
    this.outline.hiddenEdgeColor.set(0x8a7a00);
    this.outline.edgeStrength = 4;
    this.outline.edgeThickness = 1.5;
    this.outline.enabled = false;
    this.composer.addPass(this.outline);
    this.composer.addPass(new OutputPass());
  }

  setOutlined(objects: Object3D[]): void {
    this.outline.selectedObjects = objects;
    this.outline.enabled = objects.length > 0;
  }

  setSize(w: number, h: number): void { this.composer.setSize(w, h); }
  render(): void { this.composer.render(); }
}
