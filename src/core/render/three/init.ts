// The Three.js context: renderer, scene, camera (docs/THREE_SETUP.md). Soft shadows, a studio environment for image-based light and filmic tone
// mapping carry the warm room look (docs/LOWPOLY_STYLE.md).
import { ACESFilmicToneMapping, Color, HalfFloatType, PCFShadowMap, PMREMGenerator, PerspectiveCamera, SRGBColorSpace, Scene, WebGLCubeRenderTarget, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './arealoop';

/** `pmrem`: a prefilter for environment maps, its programs linked. */
export interface RenderContext { scene: Scene; camera: PerspectiveCamera; renderer: WebGLRenderer; canvas: HTMLCanvasElement; pmrem: PMREMGenerator }

/**
 * The tone mapping's exposure at 100 % brightness, by day (the graphics settings multiply it, `Post.apply`, and so does the eye's adaptation,
 * `Post.setEye`).
 */
export const BASE_EXPOSURE = 2.2;

export function createRenderContext(host: HTMLElement, background: string): RenderContext {
  const renderer = new WebGLRenderer({ antialias: false, powerPreference: new URLSearchParams(location.search).has('lowpower') ? 'low-power' : 'high-performance' }); // the scene's target (`post.ts`) does the antialiasing
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
  // the generator stays, a cube already prefiltered: its programs linked now, while the driver has nothing else to link. The renderer's own
  // (a cube target as a scene's environment, the city's sky) shares them; first linked behind the 3D's batch, one held the page for seconds
  // (docs/render/load.md)
  const cube = new WebGLCubeRenderTarget(16, { type: HalfFloatType });
  renderer.initRenderTarget(cube);
  pmrem.fromCubemap(cube.texture).dispose();
  cube.dispose();
  const camera = new PerspectiveCamera(30, host.clientWidth / Math.max(1, host.clientHeight), 50, 200000);
  return { scene, camera, renderer, canvas: renderer.domElement, pmrem };
}
