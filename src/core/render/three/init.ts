// The Three.js context: renderer, scene, camera (docs/THREE_SETUP.md). Soft shadows, a studio environment for image-based light and filmic tone
// mapping carry the warm room look (docs/3D_STYLE.md).
import { ACESFilmicToneMapping, Color, HalfFloatType, PCFShadowMap, PMREMGenerator, PerspectiveCamera, SRGBColorSpace, Scene, Texture, WebGLCubeRenderTarget, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './arealoop';
import { ktx2Support } from './gltf';

/** `pmrem`: a prefilter for environment maps, its programs linked. */
export interface RenderContext { scene: Scene; camera: PerspectiveCamera; renderer: WebGLRenderer; canvas: HTMLCanvasElement; pmrem: PMREMGenerator }

/**
 * The tone mapping's exposure at 100 % brightness, by day (the graphics settings multiply it, `Post.apply`, and so does the eye's adaptation,
 * `Post.setEye`).
 */
export const BASE_EXPOSURE = 2.2;

/**
 * The studio's environment map: the room's reflections, prefiltered by `pmrem`. It is a render target's picture, so a lost WebGL context takes
 * it: a screen that restores its context (`webglcontextrestored`) disposes the old one and sets this again. The caller owns the result.
 */
export function studioEnv(pmrem: PMREMGenerator): Texture {
  return pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
}

/** Sets a new studio environment after a context restore: the old one (lost with its context) is freed first. */
export function restoreStudioEnv(scene: Scene, pmrem: PMREMGenerator): void {
  scene.environment?.dispose();
  scene.environment = studioEnv(pmrem);
}

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
  // the models may carry KTX2 textures: the loader learns this GPU's formats before the first model loads (the first context's call wins)
  void ktx2Support(renderer);
  const scene = new Scene();
  scene.background = new Color(background);
  // reflections and soft fill on every PBR surface: metal, glass, lacquered wood read as materials, not flat colour
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = studioEnv(pmrem);
  scene.environmentIntensity = 0.35;
  // the generator stays, a cube already prefiltered: its programs linked now, while the driver has nothing else to link. The renderer's own
  // (a cube target as a scene's environment, the city's sky) shares them; first linked behind the 3D's batch, one held the page for seconds
  // (docs/render/load.md)
  const cube = new WebGLCubeRenderTarget(16, { type: HalfFloatType });
  renderer.initRenderTarget(cube);
  pmrem.fromCubemap(cube.texture).dispose();
  cube.dispose();
  const camera = new PerspectiveCamera(30, host.clientWidth / Math.max(1, host.clientHeight), 50, 200000);
  trackRender(renderer, scene);
  return { scene, camera, renderer, canvas: renderer.domElement, pmrem };
}

/** Dev only: the live renders (renderer -> scene), for the memory probe (`tools/bench-modes.mjs`, PHONE-03). `disposeRenderContext` drops one. */
export function trackRender(renderer: WebGLRenderer, scene: Scene): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  const w = window as unknown as { __renders?: Map<WebGLRenderer, Scene> };
  (w.__renders ??= new Map()).set(renderer, scene);
}

function untrackRender(renderer: WebGLRenderer): void {
  if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __renders?: Map<WebGLRenderer, Scene> }).__renders?.delete(renderer);
}

/**
 * The end of a context that a screen owns (Gallery, Build my PC: PERF12). The context goes first (`forceContextLoss`): the browser frees all its
 * GPU memory at once, now, not at a garbage collection that may never come, and each free after it skips its GL call. Then the environment map,
 * the prefilter, the renderer (it drops the geometries and textures it tracked) and the canvas. Dispose the scene's own meshes and materials
 * after it, which is cheap then: a material shared with the room still holds this renderer's listener until its `dispose`. Shared caches stay.
 */
export function disposeRenderContext(c: Pick<RenderContext, 'scene' | 'renderer' | 'pmrem'>): void {
  untrackRender(c.renderer);
  c.renderer.forceContextLoss();
  c.scene.environment?.dispose();
  c.scene.environment = null;
  c.pmrem.dispose();
  c.renderer.dispose();
  c.renderer.domElement.remove();
}
