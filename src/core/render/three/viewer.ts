// The showcase viewer: one part on a turntable, turned and zoomed by the player (shop preview). It owns a small WebGL context, built on the first
// part and disposed with `dispose`. The camera is the board's orbit (`camera.ts`) with the full turn allowed.
import { ACESFilmicToneMapping, AmbientLight, Box3, CircleGeometry, Color, DirectionalLight, Mesh, MeshStandardMaterial, type Object3D, PCFShadowMap, PMREMGenerator, PerspectiveCamera, SRGBColorSpace, Scene, Vector3, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { effect } from '@preact/signals';
import { effective, FrameGate, pixelRatio } from '@/app/graphics';
import { applyView, stepView, type OrbitView } from './camera';
import { anisotropy, refilter } from './geometry';
import { disposeRenderContext } from './init';
import { DrawGate, STILL_PX, ViewWatch, frameDt } from './ondemand';

export interface Viewer {
  /** Show another part (null: an empty stage). The old one is disposed. */
  setObject: (o: Object3D | null) => void;
  /** Back to the first view. */
  reset: () => void;
  setAutoTurn: (on: boolean) => void;
  resize: () => void;
  dispose: () => void;
}

/**
 * What a node of the part may carry in its userData: work before each render (`H`: the view's height in device pixels), its own disposal,
 * and `open`: show the part as from up close (a CPU's die under its lid). A shop tile's still opens it, so each part's tile tells it apart.
 */
export interface PartHooks { frame?: (cam: PerspectiveCamera, H: number) => void; dispose?: () => void; open?: () => void }

/** The turn and zoom limits: all the way round, from just under the floor to straight above; in close enough to read a chip's marking. */
export const VIEW_LIMITS = { pitchMin: -0.1, pitchMax: 1.5, zoomMin: 0.06, zoomMax: 2.5 };
/** The shadow map's side by the shadow quality (Off, Low, Med, High, Ultra). */
const SHADOW_PX = [1, 512, 1024, 2048, 4096];
const FOV = 28, START = { yaw: 0.6, pitch: 0.4 }, AUTO_SPEED = 0.35;
/** How much of its tile a still's part fills, edge to edge (its box's corners). */
const STILL_FILL = 0.9;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The view that frames a box of this size (its largest side, the fov and the zoom factor). */
export function frameView(size: Vector3, centre: Vector3, zoom: number, yaw: number, pitch: number): OrbitView {
  const side = Math.max(size.x, size.y, size.z, 1);
  return { x: centre.x, y: centre.y, z: centre.z, yaw, pitch, fov: FOV, height: side * 1.05 * zoom };
}

function disposeTree(o: Object3D): void {
  o.traverse((n) => {
    const m = n as Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(x)) if (v && typeof v === 'object' && 'isTexture' in v) (v as { dispose: () => void }).dispose();
      x.dispose();
    }
  });
}

/** The studio a part is shown in (the showcase, and the stills of the shop's tiles): the room's reflections, a warm key light with its shadow, a cool rim, the floor disc. */
function studio(antialias: boolean, still = false) {
  const renderer = new WebGLRenderer({ antialias, alpha: true, preserveDrawingBuffer: still }); // (the multisampling is fixed at creation)
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.6;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene(), pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new AmbientLight(0xffffff, 0.25));
  const key = new DirectionalLight(0xfff0dc, 2.4), rim = new DirectionalLight(0x9ab8ff, 1.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key, key.target, rim, rim.target);
  const floor = new Mesh(new CircleGeometry(1, 64).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: new Color(0x1a1d26), roughness: 0.6, metalness: 0.2 }));
  floor.receiveShadow = true;
  scene.add(floor);
  /** Light a part of this size round this centre. */
  const place = (size: Vector3, centre: Vector3) => {
    const r = Math.max(size.x, size.y, size.z, 1);
    floor.scale.setScalar(r * 0.8);
    floor.position.set(centre.x, centre.y - size.y / 2 - r * 0.01, centre.z);
    key.position.set(centre.x + r * 1.5, centre.y + r * 2, centre.z + r * 1.2);
    key.target.position.copy(centre);
    const s = r * 1.6;
    Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: r * 8 });
    key.shadow.camera.updateProjectionMatrix();
    // flat panels shade themselves without a bias (stripes across a side panel)
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = r * 0.004;
    rim.position.set(centre.x - r * 2, centre.y + r, centre.z - r * 1.5);
    rim.target.position.copy(centre);
  };
  return { renderer, scene, pmrem, key, floor, place };
}

/**
 * Aim a camera at a part. The depth range hugs the part: a near plane of 1 against a far plane of 100000 leaves the 24-bit depth about 10
 * units at the part, and its layers (panel, art, vents) fight.
 */
function aim(camera: PerspectiveCamera, view: OrbitView, aspect: number, size: Vector3, centre: Vector3): void {
  applyView(camera, view, aspect);
  const dist = camera.position.distanceTo(centre), reach = size.length();
  camera.near = Math.max(1, dist * 0.05, dist - reach);
  camera.far = dist + reach * 2;
  camera.updateProjectionMatrix();
}

/**
 * The still of a part on a shop tile (`tools/stills.mjs` bakes them): the showcase's first view of it, in the same studio without the floor,
 * on a clear ground, `w` x `h` pixels. The part is disposed after.
 */
export async function renderStill(o: Object3D, w: number, h: number): Promise<HTMLCanvasElement> {
  const { renderer, scene, pmrem, key, floor, place } = studio(true, true), camera = new PerspectiveCamera(FOV, w / h, 1, 100000);
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  key.shadow.mapSize.set(2048, 2048);
  floor.visible = false;
  const hooks: PartHooks[] = [];
  o.traverse((n) => { n.castShadow = true; if (n.userData.frame || n.userData.dispose) hooks.push(n.userData as PartHooks); });
  for (const k of hooks) k.open?.();
  scene.add(o);
  const b = new Box3().setFromObject(o), size = b.getSize(new Vector3()), centre = b.getCenter(new Vector3());
  place(size, centre);
  // the showcase's first view, drawn in or out until the part's box fills 90 % of the tile's height or width
  let view = frameView(size, centre, 1, START.yaw, START.pitch);
  const v = new Vector3();
  for (let i = 0; i < 4; i++) {
    aim(camera, view, w / h, size, centre);
    let m = 0;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { v.set(x, y, z).project(camera); m = Math.max(m, Math.abs(v.x), Math.abs(v.y)); }
    view = { ...view, height: (view.height * m) / STILL_FILL };
  }
  aim(camera, view, w / h, size, centre);
  // (a part's baked art comes in over a few frames: render until it has)
  for (let i = 0; i < 8; i++) {
    for (const k of hooks) k.frame?.(camera, h);
    renderer.render(scene, camera);
    await new Promise((r) => setTimeout(r, 120));
  }
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
  scene.remove(o);
  for (const k of hooks) k.dispose?.();
  disposeTree(o);
  floor.geometry.dispose();
  (floor.material as MeshStandardMaterial).dispose();
  disposeRenderContext({ scene, pmrem, renderer });
  return out;
}

export function mountViewer(host: HTMLElement): Viewer {
  const { renderer, scene, pmrem, key, floor, place: light } = studio(effective.peek().msaa > 0), camera = new PerspectiveCamera(FOV, 1, 1, 100000);
  renderer.setPixelRatio(pixelRatio(effective.peek().scale));
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
  host.appendChild(renderer.domElement);

  // a part that wears baked art (`ArtSet`) carries its per-frame work and its disposal in a node's userData
  let obj: Object3D | null = null, hooks: PartHooks[] = [], size = new Vector3(1, 1, 1), centre = new Vector3();
  let yaw = START.yaw, pitch = START.pitch, zoom = 1, view = frameView(size, centre, zoom, yaw, pitch), auto = true, last = performance.now(), raf = 0, dead = false, idle = 0;
  // the view's target moved off the part's centre (a right drag), kept inside the part's box
  const pan = new Vector3(), at = new Vector3(), RIGHT = new Vector3(), UP = new Vector3();

  const goal = (): OrbitView => frameView(size, at.copy(centre).add(pan), zoom, yaw, pitch);
  const place = () => light(size, centre);
  const setObject = (o: Object3D | null) => {
    if (obj) { scene.remove(obj); for (const h of hooks) h.dispose?.(); disposeTree(obj); }
    obj = o;
    hooks = [];
    pan.set(0, 0, 0);
    if (o) {
      o.traverse((n) => { n.castShadow = true; if (n.userData.frame || n.userData.dispose) hooks.push(n.userData as PartHooks); });
      scene.add(o);
      const b = new Box3().setFromObject(o);
      b.getSize(size);
      b.getCenter(centre);
    } else { size = new Vector3(1, 1, 1); centre = new Vector3(); }
    place();
    view = goal();
    demand.ask();
  };
  // drawn on demand (docs/render/load.md): a still part draws no frame; a new part, size or setting, a baked tile or a camera move draws one
  const demand = new DrawGate(), moved = new ViewWatch();
  const resize = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    demand.ask(); // (a new size clears the canvas)
  };
  // the graphics settings (`app/graphics.ts`): the pixels drawn, the brightness, the shadows and the texture filtering
  const stopSettings = effect(() => {
    const g = effective.value;
    renderer.setPixelRatio(pixelRatio(g.scale));
    renderer.toneMappingExposure = 1.6 * g.brightness;
    renderer.shadowMap.enabled = g.shadows > 0;
    const px = SHADOW_PX[g.shadows] ?? 1024;
    if (key.shadow.mapSize.x !== px) { key.shadow.mapSize.set(px, px); key.shadow.map?.dispose(); key.shadow.map = null; }
    if (g.filtering !== anisotropy) refilter(scene, g.filtering);
    resize();
  });
  const gate = new FrameGate();
  const frame = (now: number) => {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    if (!gate.ready(now, effective.peek().fps)) return;
    const dt = frameDt(now, last);
    last = now;
    idle += dt;
    if (auto && idle > 2) yaw += AUTO_SPEED * dt;
    view = stepView(view, goal(), dt * 3);
    const W = renderer.domElement.width, H = renderer.domElement.height;
    aim(camera, view, W / Math.max(1, H), size, centre);
    for (const h of hooks) h.frame?.(camera, H);
    // (the turntable and an eased drag move the picture; at rest it stands)
    if (!demand.want(now, moved.shift(camera, W, H, camera.near, camera.far) >= STILL_PX)) return;
    renderer.render(scene, camera);
    moved.mark(camera, W, H);
  };

  // the pointer: one finger or the left button turns, two fingers pinch, the wheel zooms
  const down = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const el = renderer.domElement;
  const onDown = (e: PointerEvent) => { el.setPointerCapture(e.pointerId); down.set(e.pointerId, { x: e.clientX, y: e.clientY }); idle = 0; pinch = 0; };
  const onMove = (e: PointerEvent) => {
    const p = down.get(e.pointerId);
    if (!p) return;
    idle = 0;
    if (down.size === 1 && (e.buttons & 2 || e.shiftKey)) {
      // pan: the target follows the pointer across the view's plane
      const k = view.height / Math.max(1, el.clientHeight);
      RIGHT.setFromMatrixColumn(camera.matrixWorld, 0);
      UP.setFromMatrixColumn(camera.matrixWorld, 1);
      pan.addScaledVector(RIGHT, -(e.clientX - p.x) * k).addScaledVector(UP, (e.clientY - p.y) * k);
      pan.clamp(at.copy(size).multiplyScalar(-0.5), UP.copy(size).multiplyScalar(0.5));
    } else if (down.size === 1) {
      yaw -= (e.clientX - p.x) * 0.008;
      pitch = clamp(pitch + (e.clientY - p.y) * 0.008, VIEW_LIMITS.pitchMin, VIEW_LIMITS.pitchMax);
    }
    p.x = e.clientX; p.y = e.clientY;
    if (down.size === 2) {
      const [a, b] = [...down.values()] as [{ x: number; y: number }, { x: number; y: number }], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoom = clamp(zoom * (pinch / d), VIEW_LIMITS.zoomMin, VIEW_LIMITS.zoomMax);
      pinch = d;
    }
  };
  const onUp = (e: PointerEvent) => { down.delete(e.pointerId); pinch = 0; };
  const onWheel = (e: WheelEvent) => { e.preventDefault(); idle = 0; zoom = clamp(zoom * Math.exp(e.deltaY * 0.0012), VIEW_LIMITS.zoomMin, VIEW_LIMITS.zoomMax); };
  const reset = () => { yaw = START.yaw; pitch = START.pitch; zoom = 1; idle = 0; pan.set(0, 0, 0); };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('dblclick', reset);
  el.addEventListener('contextmenu', (e) => e.preventDefault()); // the browser's image menu has no place on a 3D view
  el.addEventListener('webglcontextrestored', () => demand.ask());
  resize();
  raf = requestAnimationFrame(frame);

  return {
    setObject, reset, resize,
    setAutoTurn: (on) => { auto = on; },
    dispose: () => {
      dead = true;
      stopSettings();
      cancelAnimationFrame(raf);
      for (const h of hooks) h.dispose?.();
      if (obj) disposeTree(obj);
      floor.geometry.dispose();
      (floor.material as MeshStandardMaterial).dispose();
      obj = null;
      hooks = [];
      disposeRenderContext({ scene, pmrem, renderer });
    },
  };
}
