# Three.js Setup & Integration

## Installation

```bash
npm install three
npm install --save-dev @types/three
```

## Module Structure

### `src/core/render/three/init.ts`

Bootstraps the 3D scene, camera, and renderer.

```ts
import * as THREE from 'three';

interface RenderContext {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls?: OrbitControls; // optional
}

export function createRenderContext(canvas: HTMLCanvasElement): RenderContext {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060f); // dark theme default
  
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  
  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
  directionalLight.position.set(10, 20, 15);
  directionalLight.castShadow = true;
  scene.add(directionalLight);
  
  // Orthographic camera for board view
  const camera = createOrthoCamera(canvas);
  scene.add(camera);
  
  return { scene, camera, renderer };
}

function createOrthoCamera(canvas: HTMLCanvasElement): THREE.OrthographicCamera {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const aspect = w / h;
  
  const frustumHeight = 10000; // world units visible at zoom=1
  const frustumWidth = frustumHeight * aspect;
  
  const camera = new THREE.OrthographicCamera(
    -frustumWidth / 2, frustumWidth / 2,
    frustumHeight / 2, -frustumHeight / 2,
    0.1, 100000
  );
  camera.position.z = 5000;
  return camera;
}

export function onWindowResize(ctx: RenderContext, canvas: HTMLCanvasElement) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h);
  
  if (camera instanceof THREE.OrthographicCamera) {
    const aspect = w / h;
    const frustumHeight = camera.top - camera.bottom;
    const frustumWidth = frustumHeight * aspect;
    camera.left = -frustumWidth / 2;
    camera.right = frustumWidth / 2;
    camera.updateProjectionMatrix();
  }
}
```

### `src/core/render/three/camera.ts`

Manages zoom, pan, and camera transitions (ortho ↔ perspective).

```ts
import * as THREE from 'three';

interface CameraState {
  position: THREE.Vector3;
  zoom: number; // 1.0 = fit board overview
  target: THREE.Vector3;
  targetZoom: number;
  mode: 'ortho' | 'perspective';
}

const ZOOM_SPEED = 0.1; // per mousewheel delta
const PAN_SPEED = 0.001; // per pixel dragged
const TWEEN_SPEED = 0.05; // lerp factor per frame

export function createCameraState(): CameraState {
  return {
    position: new THREE.Vector3(0, 0, 5000),
    zoom: 1.0,
    target: new THREE.Vector3(0, 0, 0),
    targetZoom: 1.0,
    mode: 'ortho',
  };
}

export function updateCameraZoom(
  camera: THREE.OrthographicCamera,
  state: CameraState,
  zoomDelta: number
) {
  state.targetZoom = Math.max(0.1, Math.min(20, state.targetZoom * (1 - zoomDelta * ZOOM_SPEED)));
}

export function updateCameraPan(
  state: CameraState,
  deltaX: number,
  deltaY: number
) {
  // Pan in world space proportional to zoom
  const panScale = state.zoom * PAN_SPEED;
  state.target.x -= deltaX * panScale;
  state.target.y += deltaY * panScale;
}

export function updateCamera(
  camera: THREE.OrthographicCamera,
  state: CameraState,
  deltaTime: number
) {
  // Smooth zoom
  state.zoom = THREE.MathUtils.lerp(state.zoom, state.targetZoom, TWEEN_SPEED);
  
  // Smooth pan
  state.position.lerp(state.target, TWEEN_SPEED);
  
  // Apply zoom to camera (scale frustum)
  const zoom = state.zoom;
  const aspect = camera.right - camera.left / (camera.top - camera.bottom);
  const h = (camera.top - camera.bottom) * zoom;
  const w = h * aspect;
  
  camera.left = -w / 2;
  camera.right = w / 2;
  camera.top = h / 2;
  camera.bottom = -h / 2;
  camera.position.copy(state.position).add(state.target);
  camera.lookAt(state.target);
  camera.updateProjectionMatrix();
}

export function flyTo(
  state: CameraState,
  targetPos: THREE.Vector3,
  targetZoom: number,
  duration: number = 1000
) {
  // Async tween target position and zoom over duration
  state.target.copy(targetPos);
  state.targetZoom = targetZoom;
  // (In real code, use a tween library or custom lerp with time tracking)
}
```

### `src/core/render/three/materials.ts`

Defines materials for parts, with state overrides (powered, throttled, burnt).

```ts
import * as THREE from 'three';
import { Theme } from '../theme';

export function createPartMaterial(
  color: string,
  theme: Theme
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    metalness: 0.2,
    roughness: 0.6,
    emissive: 0x000000,
  });
}

export function updateMaterialState(
  material: THREE.Material,
  state: { powered: boolean; throttled: boolean; burnt: boolean; tempC: number },
  theme: Theme
) {
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  
  if (state.burnt) {
    material.emissive.setHex(0xff0000);
    material.emissiveIntensity = 0.3;
    material.opacity = 0.7;
    return;
  }
  
  if (!state.powered) {
    material.color.multiplyScalar(0.5); // desaturate
    material.emissive.setHex(0x000000);
    return;
  }
  
  // Heat glow (cyan → amber → red)
  if (state.tempC > 42) {
    const heatFactor = Math.min(1, (state.tempC - 42) / 40);
    const glowColor = new THREE.Color()
      .lerpColors(
        new THREE.Color(0x3be3ff), // cyan
        new THREE.Color(0xff5a78), // red
        heatFactor
      );
    material.emissive.copy(glowColor);
    material.emissiveIntensity = 0.2 + heatFactor * 0.4;
  }
  
  if (state.throttled) {
    material.color.multiplyScalar(0.8);
  }
}

export function createOutlineMaterial(baseColor: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(baseColor),
    emissive: 0xffff00,
    emissiveIntensity: 0.5,
    wireframe: false,
  });
}
```

### `src/core/render/three/geometry.ts`

Loads and caches 3D models (gltf/glb format).

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const gltfLoader = new GLTFLoader();
const modelCache = new Map<string, THREE.Group>();

export async function loadModel(path: string): Promise<THREE.Group> {
  if (modelCache.has(path)) {
    return modelCache.get(path)!.clone();
  }
  
  const { scene } = await gltfLoader.loadAsync(path);
  modelCache.set(path, scene);
  return scene.clone();
}

export function createPrimitiveDimm(): THREE.Mesh {
  // Placeholder geometry for RAM stick
  const geometry = new THREE.BoxGeometry(8, 32, 4);
  const material = new THREE.MeshStandardMaterial({ color: 0x228b22 });
  return new THREE.Mesh(geometry, material);
}

export function createPrimitiveCPU(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(32, 32, 4);
  const material = new THREE.MeshStandardMaterial({ color: 0x1a1a2e });
  return new THREE.Mesh(geometry, material);
}

export function createPrimitiveGPU(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(20, 48, 4);
  const material = new THREE.MeshStandardMaterial({ color: 0x0f3460 });
  return new THREE.Mesh(geometry, material);
}
```

## Integration with Existing Code

### `src/core/render/board.ts` (adapt from PixiJS)

```ts
import * as THREE from 'three';
import { createRenderContext, onWindowResize } from './three/init';
import { createCameraState, updateCamera } from './three/camera';
import { Snapshot } from 'src/worker/game/types';

export function mountBoard(host: HTMLElement) {
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  
  const ctx = createRenderContext(canvas);
  const cameraState = createCameraState();
  
  let lastTime = performance.now();
  
  function frame() {
    const now = performance.now();
    const deltaTime = (now - lastTime) / 1000;
    lastTime = now;
    
    // Update from snapshot (live.ts will call this)
    // updateScene(ctx.scene, snapshot);
    
    updateCamera(ctx.camera, cameraState, deltaTime);
    ctx.renderer.render(ctx.scene, ctx.camera);
    
    requestAnimationFrame(frame);
  }
  
  window.addEventListener('resize', () =>
    onWindowResize(ctx, canvas)
  );
  
  requestAnimationFrame(frame);
  
  return { scene: ctx.scene, renderer: ctx.renderer, camera: cameraState };
}
```

## Asset Pipeline (Future)

Models will be created in Blender and exported as glTF 2.0 (glb):
1. Design low-poly geometry (100-1000 tris per part)
2. Unwrap UVs
3. Bake material colors
4. Export → `assets/models/<feature>/<part>.glb`
5. Load via `loadModel()` in geometry.ts

For now, use primitive geometry (Box, Cylinder, etc.) to bootstrap rendering.

## Build Configuration

No changes to `vite.config.ts` initially. Assets directory `public/assets/models/` will be served as static.

```json
// vite.config.ts amendment
{
  "publicDir": "public",
  "optimizeDeps": {
    "include": ["three"]
  }
}
```

## Performance Baseline

**Target metrics:**
- 60 FPS at 1920x1080 on desktop GPU
- < 5ms render time per frame (excluding UI)
- Instant model loading (cached)
- Smooth zoom to 20x magnification

**Optimization techniques (Phase 4):**
- Instancing for repeated parts (RAM sticks, PCIe slots)
- Frustum culling for offscreen objects
- LOD meshes (3 detail levels)
- Draw-call batching
