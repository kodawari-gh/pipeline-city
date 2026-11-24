// The showcase viewer: one part on a turntable, turned and zoomed by the player (shop preview). It owns a small WebGL context, built on the first
// part and disposed with `dispose`. The camera is the board's orbit (`camera.ts`) with the full turn allowed.
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  type Object3D,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { effect } from '@preact/signals';
import { effective, FrameGate, pixelRatio } from '@/app/graphics';
import { applyView, stepView, zoomAbout, type OrbitView } from './camera';
import { ProgramGate, startPrograms, startShadowPrograms } from './compile';
import { SEG, anisotropy, refilter } from './geometry';
import { warmLateModels } from './gltf';
import { turnOf, type Pt } from './gesture';
import { disposeRenderContext, restoreStudioEnv, studioEnv, trackRender } from './init';
import { DrawGate, STILL_PX, ViewWatch, frameDt } from './ondemand';
import { attachPad, type PadHost } from './pad';
import { pickPoint } from './pick';

/** The strips of the stage that panels float over (CSS pixels): the part is framed and centred in what is left. */
export interface StageInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Viewer {
  /** Show another part (null: an empty stage). The old one is disposed. */
  setObject: (o: Object3D | null) => void;
  /** Keep the part clear of the panels over the stage (Gallery: the categories and the dock). Zero all round: the whole stage. */
  setInsets: (i: StageInsets) => void;
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
export interface PartHooks {
  frame?: (cam: PerspectiveCamera, H: number) => void;
  dispose?: () => void;
  open?: () => void;
}

/** The turn and zoom limits: all the way round, from just under the floor to straight above; in close enough to read a chip's marking. */
export const VIEW_LIMITS = { pitchMin: -0.1, pitchMax: 1.5, zoomMin: 0.06, zoomMax: 2.5 };
/** The shadow map's side by the shadow quality (Off, Low, Med, High, Ultra). */
const SHADOW_PX = [1, 512, 1024, 2048, 4096];
const FOV = 28,
  START = { yaw: 0.6, pitch: 0.4 },
  AUTO_SPEED = 0.35;
/** How much of its tile a still's part fills, edge to edge (its box's corners). */
const STILL_FILL = 0.9;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The view that frames a box of this size (`base`: the height it shows at zoom 1, by default the box's largest side plus a margin). */
export function frameView(
  size: Vector3,
  centre: Vector3,
  zoom: number,
  yaw: number,
  pitch: number,
  base = Math.max(size.x, size.y, size.z, 1) * 1.05,
): OrbitView {
  return { x: centre.x, y: centre.y, z: centre.z, yaw, pitch, fov: FOV, height: base * zoom };
}

/** Breathing room round a part that the turntable frames. */
const FIT = 1.08;
const probe = new PerspectiveCamera(FOV, 1, 1, 1e6),
  corner = new Vector3();

/**
 * The height a view must show to hold a part (a box of this size round `centre`) in the free part of a stage: `fw` x `fh` of its `w` x `h`
 * pixels. The box's corners are projected from twelve turns of the table at the first pitch, and the height is set again until the widest
 * just fits, so a tall box (a case) or a long one (a stick coming at the camera) is not cut off at any angle of the turn.
 */
export function holdHeight(size: Vector3, centre: Vector3, w: number, h: number, fw: number, fh: number): number {
  let height = Math.max(size.x, size.y, size.z, 1) * 2;
  const halfW = Math.max(1, fw) / w,
    halfH = Math.max(1, fh) / h; // (the free rectangle's half-size in the stage's -1..1 space)
  for (let i = 0; i < 4; i++) {
    let widest = 0;
    for (let k = 0; k < 12; k++) {
      applyView(
        probe,
        { x: centre.x, y: centre.y, z: centre.z, yaw: (k * Math.PI) / 6, pitch: START.pitch, fov: FOV, height },
        w / h,
      );
      probe.updateMatrixWorld(true);
      for (const sx of [-0.5, 0.5])
        for (const sy of [-0.5, 0.5])
          for (const sz of [-0.5, 0.5]) {
            corner.set(centre.x + sx * size.x, centre.y + sy * size.y, centre.z + sz * size.z).project(probe);
            widest = Math.max(widest, Math.abs(corner.x) / halfW, Math.abs(corner.y) / halfH);
          }
    }
    height *= Math.max(widest, 0.05) * FIT;
  }
  return height;
}

/** A soft round fade for the floor's alpha: solid under the part, gone at the rim, so the floor has no edge to see. */
function floorFade(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!,
    ramp = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  ramp.addColorStop(0, '#fff');
  ramp.addColorStop(0.5, '#fff');
  ramp.addColorStop(1, '#000');
  g.fillStyle = ramp;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  return t;
}

function disposeTree(o: Object3D): void {
  o.traverse((n) => {
    const m = n as Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(x))
        if (v && typeof v === 'object' && 'isTexture' in v) (v as { dispose: () => void }).dispose();
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
  const scene = new Scene(),
    pmrem = new PMREMGenerator(renderer);
  scene.environment = studioEnv(pmrem);
  scene.environmentIntensity = 0.55;
  scene.add(new AmbientLight(0xffffff, 0.25));
  const key = new DirectionalLight(0xfff0dc, 2.4),
    rim = new DirectionalLight(0xffffff, 1.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key, key.target, rim, rim.target);
  // the floor of Build my PC's stage (`buildmode3d.ts`: the same roughness and metal), faded out at the rim over the studio's backdrop. This studio's key light
  // is about three times as strong as that stage's, so the paint is as much darker: lit, the two floors come out as one grey
  const floor = new Mesh(
    new CircleGeometry(1, SEG.fineDisc).rotateX(-Math.PI / 2),
    new MeshStandardMaterial({
      color: new Color(0x1c1c1e),
      roughness: 0.55,
      metalness: 0.25,
      ...(still ? {} : { transparent: true, alphaMap: floorFade() }),
    }),
  );
  floor.receiveShadow = true;
  scene.add(floor);
  /** Light a part of this size round this centre. */
  const place = (size: Vector3, centre: Vector3) => {
    const r = Math.max(size.x, size.y, size.z, 1);
    floor.scale.setScalar(r * 1.5);
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
  trackRender(renderer, scene);
  return { renderer, scene, pmrem, key, floor, place };
}

/**
 * Aim a camera at a part. The depth range hugs the part: a near plane of 1 against a far plane of 100000 leaves the 24-bit depth about 10
 * units at the part, and its layers (panel, art, vents) fight.
 */
function aim(camera: PerspectiveCamera, view: OrbitView, aspect: number, size: Vector3, centre: Vector3): void {
  applyView(camera, view, aspect);
  const dist = camera.position.distanceTo(centre),
    reach = size.length();
  camera.near = Math.max(1, dist * 0.05, dist - reach);
  camera.far = dist + reach * 2;
  camera.updateProjectionMatrix();
}

/**
 * The still of a part on a shop tile (`tools/stills.mjs` bakes them): the showcase's first view of it, in the same studio without the floor,
 * on a clear ground, `w` x `h` pixels. The part is disposed after.
 */
export async function renderStill(o: Object3D, w: number, h: number): Promise<HTMLCanvasElement> {
  const { renderer, scene, pmrem, key, floor, place } = studio(true, true),
    camera = new PerspectiveCamera(FOV, w / h, 1, 100000);
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  key.shadow.mapSize.set(2048, 2048);
  floor.visible = false;
  const hooks: PartHooks[] = [];
  o.traverse((n) => {
    n.castShadow = true;
    if (n.userData.frame || n.userData.dispose) hooks.push(n.userData as PartHooks);
  });
  for (const k of hooks) k.open?.();
  scene.add(o);
  const b = new Box3().setFromObject(o),
    size = b.getSize(new Vector3()),
    centre = b.getCenter(new Vector3());
  place(size, centre);
  // the showcase's first view, drawn in or out until the part's box fills 90 % of the tile's height or width
  let view = frameView(size, centre, 1, START.yaw, START.pitch);
  const v = new Vector3();
  for (let i = 0; i < 4; i++) {
    aim(camera, view, w / h, size, centre);
    let m = 0;
    for (const x of [b.min.x, b.max.x])
      for (const y of [b.min.y, b.max.y])
        for (const z of [b.min.z, b.max.z]) {
          v.set(x, y, z).project(camera);
          m = Math.max(m, Math.abs(v.x), Math.abs(v.y));
        }
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
  out.width = w;
  out.height = h;
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
  const { renderer, scene, pmrem, key, floor, place: light } = studio(effective.peek().msaa > 0),
    camera = new PerspectiveCamera(FOV, 1, 1, 100000);
  floor.visible = false; // flat studio (SPEC 5.8): no floor disc, no glow, the stage shows its flat colour
  renderer.setPixelRatio(pixelRatio(effective.peek().scale));
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block'; // (the pad takes the fingers: `attachPad`)
  host.appendChild(renderer.domElement);

  // a part that wears baked art (`ArtSet`) carries its per-frame work and its disposal in a node's userData
  let obj: Object3D | null = null,
    hooks: PartHooks[] = [],
    size = new Vector3(1, 1, 1),
    centre = new Vector3();
  let yaw = START.yaw,
    pitch = START.pitch,
    zoom = 1,
    view = frameView(size, centre, zoom, yaw, pitch),
    auto = true,
    last = performance.now(),
    raf = 0,
    dead = false,
    idle = 0;
  // the view's target moved off the part's centre (a drag, a zoom toward a point), kept inside the part's box
  const pan = new Vector3(),
    at = new Vector3(),
    RIGHT = new Vector3(),
    UP = new Vector3(),
    AHEAD = new Vector3(),
    FROM = new Vector3();

  // what the panels leave free of the stage, and the stage's size (both in CSS pixels): the part is framed in it; (midX, midY): where the target shows
  let ins: StageInsets = { left: 0, right: 0, top: 0, bottom: 0 },
    stageW = 1,
    stageH = 1,
    freeW = 1,
    freeH = 1,
    midX = 0.5,
    midY = 0.5,
    base = 1;
  /** The height the view shows at zoom 1: the part fits the free stage at every turn of the table (set again with a new part or a new layout). */
  const refit = () => {
    base = holdHeight(size, centre, stageW, stageH, freeW, freeH);
  };
  const goal = (): OrbitView => frameView(size, at.copy(centre).add(pan), zoom, yaw, pitch, base);
  const place = () => light(size, centre);
  // a part's programs link before it is drawn (docs/render/load.md): drawn unlinked, the ten and more of a lit part link at that draw and hold the page for 0.4 s
  const programs = new ProgramGate(() => [
    ...startPrograms(renderer, scene, camera, { toCanvas: true }),
    ...startShadowPrograms(renderer, scene, camera),
  ]);
  // (a model that comes in after them, a slow network, links its own while it is hidden: `joinModel`)
  warmLateModels(scene, (model) =>
    programs.started
      ? [
          ...startPrograms(renderer, model, camera, { scene, toCanvas: true }),
          ...startShadowPrograms(renderer, scene, camera, model),
        ]
      : null,
  );
  const setObject = (o: Object3D | null) => {
    if (obj) {
      scene.remove(obj);
      for (const h of hooks) h.dispose?.();
      disposeTree(obj);
    }
    obj = o;
    hooks = [];
    programs.reset();
    pan.set(0, 0, 0);
    if (o) {
      o.traverse((n) => {
        n.castShadow = true;
        if (n.userData.frame || n.userData.dispose) hooks.push(n.userData as PartHooks);
      });
      scene.add(o);
      const b = new Box3().setFromObject(o);
      b.getSize(size);
      b.getCenter(centre);
    } else {
      size = new Vector3(1, 1, 1);
      centre = new Vector3();
    }
    place();
    refit();
    view = goal();
    demand.ask();
  };
  // drawn on demand (docs/render/load.md): a still part draws no frame; a new part, size or setting, a baked tile or a camera move draws one
  const demand = new DrawGate(),
    moved = new ViewWatch();
  // the free part of the stage centres on the picture: the projection slides over by half of what the panels cover on each side
  const layout = () => {
    stageW = Math.max(1, host.clientWidth);
    stageH = Math.max(1, host.clientHeight);
    const l = clamp(ins.left, 0, stageW * 0.6),
      r = clamp(ins.right, 0, stageW * 0.6),
      t = clamp(ins.top, 0, stageH * 0.6),
      b = clamp(ins.bottom, 0, stageH * 0.6);
    freeW = stageW - l - r;
    freeH = stageH - t - b;
    midX = l + freeW / 2;
    midY = t + freeH / 2;
    if (l || r || t || b) camera.setViewOffset(stageW, stageH, (r - l) / 2, (b - t) / 2, stageW, stageH);
    else camera.clearViewOffset();
    refit();
    demand.ask();
  };
  const resize = () => {
    renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), false);
    layout(); // (a new size clears the canvas: the layout asks for a frame)
  };
  // the graphics settings (`app/graphics.ts`): the pixels drawn, the brightness, the shadows and the texture filtering
  const stopSettings = effect(() => {
    const g = effective.value;
    renderer.setPixelRatio(pixelRatio(g.scale));
    renderer.toneMappingExposure = 1.6 * g.brightness;
    renderer.shadowMap.enabled = g.shadows > 0;
    const px = SHADOW_PX[g.shadows] ?? 1024;
    if (key.shadow.mapSize.x !== px) {
      key.shadow.mapSize.set(px, px);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    }
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
    const W = renderer.domElement.width,
      H = renderer.domElement.height;
    aim(camera, view, W / Math.max(1, H), size, centre);
    for (const h of hooks) h.frame?.(camera, H);
    // (the turntable and an eased drag move the picture; at rest it stands)
    if (!demand.want(now, moved.shift(camera, W, H, camera.near, camera.far) >= STILL_PX)) return;
    // (the programs of a new part first: the ticks until they have linked draw nothing and ask again, the page alive)
    if (!programs.ready()) {
      demand.ask();
      return;
    }
    renderer.render(scene, camera);
    moved.mark(camera, W, H);
  };

  // the pointers (`pad.ts`), read as on the board and in Build my PC (docs/render/interact.md "Camera"): a drag pans, a right or shift drag and two fingers'
  // swipe turn, the wheel and a pinch zoom toward the surface under them, a double click or tap starts over. The part's box holds the pan; the turn has no end.
  const el = renderer.domElement,
    TAN = 2 * Math.tan((FOV * Math.PI) / 360);
  // the surface a drag or a pinch holds (found as it starts: the part follows the pointers there, and a pinch zooms about it)
  let grip: Vector3 | null = null;
  const holdPan = () => pan.clamp(at.copy(size).multiplyScalar(-0.5), FROM.copy(size).multiplyScalar(0.5));
  /** The part's surface under a client point; on the empty stage, the point of the target's plane there. */
  const surfaceAt = (q: Pt): Vector3 => {
    const r = el.getBoundingClientRect(),
      x = q.x - r.left,
      y = q.y - r.top;
    camera.updateMatrixWorld();
    const hit = obj
      ? pickPoint([obj], camera, (x / Math.max(1, r.width)) * 2 - 1, 1 - (y / Math.max(1, r.height)) * 2)
      : null;
    if (hit) return hit.clone();
    const k = view.height / Math.max(1, stageH);
    RIGHT.setFromMatrixColumn(camera.matrixWorld, 0);
    UP.setFromMatrixColumn(camera.matrixWorld, 1);
    return new Vector3(view.x, view.y, view.z)
      .addScaledVector(RIGHT, (x - midX) * k)
      .addScaledVector(UP, (midY - y) * k);
  };
  const gestures: PadHost = {
    // (any press holds the turntable still for a moment: `idle`)
    press: () => {
      idle = 0;
      return null;
    },
    begin: (kind, q) => {
      idle = 0;
      grip = kind === 'turn' ? null : surfaceAt(q);
    },
    pan: (dx, dy) => {
      idle = 0;
      // the content follows the pointer at the depth of the surface the drag holds
      camera.getWorldDirection(AHEAD);
      const k =
        ((grip ? Math.max(1e-6, FROM.copy(grip).sub(camera.position).dot(AHEAD)) : view.height / TAN) * TAN) /
        Math.max(1, stageH);
      RIGHT.setFromMatrixColumn(camera.matrixWorld, 0);
      UP.setFromMatrixColumn(camera.matrixWorld, 1);
      pan.addScaledVector(RIGHT, -dx * k).addScaledVector(UP, dy * k);
      holdPan();
    },
    turn: (dx, dy) => {
      idle = 0;
      const t = turnOf(dx, dy, stageH);
      yaw += t.yaw;
      pitch = clamp(pitch + t.pitch, VIEW_LIMITS.pitchMin, VIEW_LIMITS.pitchMax);
    },
    zoom: (k, q) => {
      idle = 0;
      const z = zoomAbout(goal(), grip ?? surfaceAt(q), k, {
        min: base * VIEW_LIMITS.zoomMin,
        max: base * VIEW_LIMITS.zoomMax,
      });
      pan.set(z.x - centre.x, z.y - centre.y, z.z - centre.z);
      holdPan();
      zoom = z.height / base;
    },
    twist: (rad) => {
      idle = 0;
      yaw += rad;
    },
    end: () => {
      grip = null;
    },
    focus: () => reset(),
  };
  const pad = attachPad(el, gestures);
  const reset = () => {
    yaw = START.yaw;
    pitch = START.pitch;
    zoom = 1;
    idle = 0;
    pan.set(0, 0, 0);
  };
  if (import.meta.env.DEV)
    (window as unknown as { __viewer?: unknown }).__viewer = {
      goal,
      view: () => view,
      camera,
      size: () => size,
      centre: () => centre,
    };
  // a restored context lost the studio's environment map: made again, then a frame
  el.addEventListener('webglcontextrestored', () => {
    restoreStudioEnv(scene, pmrem);
    programs.reset();
    demand.ask();
  });
  resize();
  raf = requestAnimationFrame(frame);

  return {
    setObject,
    reset,
    resize,
    setInsets: (i) => {
      ins = i;
      layout();
    },
    setAutoTurn: (on) => {
      auto = on;
    },
    dispose: () => {
      dead = true;
      stopSettings();
      pad.dispose();
      cancelAnimationFrame(raf);
      for (const h of hooks) h.dispose?.();
      if (obj) disposeTree(obj);
      floor.geometry.dispose();
      (floor.material as MeshStandardMaterial).alphaMap?.dispose();
      (floor.material as MeshStandardMaterial).dispose();
      obj = null;
      hooks = [];
      disposeRenderContext({ scene, pmrem, renderer });
    },
  };
}
