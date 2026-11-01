// The Three.js context: renderer, scene, camera (docs/THREE_SETUP.md). Soft shadows, a studio environment for image-based light and filmic tone
// mapping carry the warm room look (docs/LOWPOLY_STYLE.md).
import { ACESFilmicToneMapping, Color, PCFShadowMap, PMREMGenerator, PerspectiveCamera, SRGBColorSpace, Scene, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface RenderContext { scene: Scene; camera: PerspectiveCamera; renderer: WebGLRenderer; canvas: HTMLCanvasElement }

/** The tone mapping's exposure at 100 % brightness (the graphics settings multiply it, `Post.apply`). */
export const BASE_EXPOSURE = 1.1;

export function createRenderContext(host: HTMLElement, background: string): RenderContext {
  const renderer = new WebGLRenderer({ antialias: false, powerPreference: new URLSearchParams(location.search).has('lowpower') ? 'low-power' : 'high-performance' }); // the composer's target does the antialiasing
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = BASE_EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  host.appendChild(renderer.domElement);
  const scene = new Scene();
  scene.background = new Color(background);
  // reflections and soft fill on every PBR surface: metal, glass, lacquered wood read as materials, not flat colour
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();
  const camera = new PerspectiveCamera(30, host.clientWidth / Math.max(1, host.clientHeight), 50, 200000);
  return { scene, camera, renderer, canvas: renderer.domElement };
}
