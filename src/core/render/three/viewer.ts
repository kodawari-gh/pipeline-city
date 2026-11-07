// The showcase viewer: one part on a turntable, turned and zoomed by the player (shop preview). It owns a small WebGL context, built on the first
// part and disposed with `dispose`. The camera is the board's orbit (`camera.ts`) with the full turn allowed.
import { ACESFilmicToneMapping, AmbientLight, Box3, CircleGeometry, Color, DirectionalLight, Mesh, MeshStandardMaterial, type Object3D, PCFShadowMap, PMREMGenerator, PerspectiveCamera, SRGBColorSpace, Scene, Vector3, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { effect } from '@preact/signals';
import { effective, FrameGate, pixelRatio } from '@/app/graphics';
import { applyView, stepView, type OrbitView } from './camera';
import { anisotropy, refilter } from './geometry';

export interface Viewer {
  /** Show another part (null: an empty stage). The old one is disposed. */
  setObject: (o: Object3D | null) => void;
  /** Back to the first view. */
  reset: () => void;
  setAutoTurn: (on: boolean) => void;
  resize: () => void;
  dispose: () => void;
}

/** The turn and zoom limits: all the way round, from just under the floor to straight above. */
export const VIEW_LIMITS = { pitchMin: -0.1, pitchMax: 1.5, zoomMin: 0.25, zoomMax: 2.5 };
/** The shadow map's side by the shadow quality (Off, Low, Med, High, Ultra). */
const SHADOW_PX = [1, 512, 1024, 2048, 4096];
const FOV = 28, START = { yaw: 0.6, pitch: 0.4 }, AUTO_SPEED = 0.35;

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

export function mountViewer(host: HTMLElement): Viewer {
  const renderer = new WebGLRenderer({ antialias: effective.peek().msaa > 0, alpha: true }); // (the multisampling is fixed at creation)
  renderer.setPixelRatio(pixelRatio(effective.peek().scale));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.6;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
  host.appendChild(renderer.domElement);
  const scene = new Scene(), pmrem = new PMREMGenerator(renderer), camera = new PerspectiveCamera(FOV, 1, 1, 100000);
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

  let obj: Object3D | null = null, size = new Vector3(1, 1, 1), centre = new Vector3();
  let yaw = START.yaw, pitch = START.pitch, zoom = 1, view = frameView(size, centre, zoom, yaw, pitch), auto = true, last = performance.now(), raf = 0, dead = false, idle = 0;

  const goal = (): OrbitView => frameView(size, centre, zoom, yaw, pitch);
  const place = () => {
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
  const setObject = (o: Object3D | null) => {
    if (obj) { scene.remove(obj); disposeTree(obj); }
    obj = o;
    if (o) {
      o.traverse((n) => { n.castShadow = true; });
      scene.add(o);
      const b = new Box3().setFromObject(o);
      b.getSize(size);
      b.getCenter(centre);
    } else { size = new Vector3(1, 1, 1); centre = new Vector3(); }
    place();
    view = goal();
  };
  const resize = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
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
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    idle += dt;
    if (auto && idle > 2) yaw += AUTO_SPEED * dt;
    view = stepView(view, goal(), dt * 3);
    applyView(camera, view, renderer.domElement.width / Math.max(1, renderer.domElement.height));
    // the depth range hugs the part: a near plane of 1 against a far plane of 100000 leaves the 24-bit depth about 10 units at the part, and its layers (panel, art, vents) fight
    const dist = camera.position.distanceTo(centre), reach = size.length();
    camera.near = Math.max(1, dist * 0.05, dist - reach);
    camera.far = dist + reach * 2;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
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
    if (down.size === 1) {
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
  const reset = () => { yaw = START.yaw; pitch = START.pitch; zoom = 1; idle = 0; };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('dblclick', reset);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    setObject, reset, resize,
    setAutoTurn: (on) => { auto = on; },
    dispose: () => {
      dead = true;
      stopSettings();
      cancelAnimationFrame(raf);
      if (obj) disposeTree(obj);
      floor.geometry.dispose();
      (floor.material as MeshStandardMaterial).dispose();
      (scene.environment as { dispose?: () => void } | null)?.dispose?.();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      el.remove();
    },
  };
}
