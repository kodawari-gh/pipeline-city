// The Three.js context: renderer, scene, camera (docs/THREE_SETUP.md). Soft shadows and filmic tone mapping carry the warm room look (docs/LOWPOLY_STYLE.md).
import { ACESFilmicToneMapping, Color, PCFShadowMap, PerspectiveCamera, SRGBColorSpace, Scene, WebGLRenderer } from 'three';

export interface RenderContext { scene: Scene; camera: PerspectiveCamera; renderer: WebGLRenderer; canvas: HTMLCanvasElement }

export function createRenderContext(host: HTMLElement, background: string): RenderContext {
  const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }); // the composer's target does the antialiasing
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  host.appendChild(renderer.domElement);
  const scene = new Scene();
  scene.background = new Color(background);
  const camera = new PerspectiveCamera(30, host.clientWidth / Math.max(1, host.clientHeight), 50, 200000);
  return { scene, camera, renderer, canvas: renderer.domElement };
}
