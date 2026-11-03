// The view out of the room's window: a real street in 3D (`plan.ts`), drawn each frame from where the room's camera stands, moved out to the
// third floor (`toOutside`), into a target the size of the window on screen. The window's quad shows that picture pixel for pixel, so the
// perspective is the room camera's own: the garden under the sill, the street, the houses across, the side street to the town and the hills.
// Its light: the hour's sky (`sky.ts`, also the environment its materials take as sky light and reflections), the sun with its shadows, the
// light our own row throws back on the houses across, the lamps and the lit windows at night (the moon's light is the night sky's). Another
// camera (the room's probe) sees the window as the sky's cube instead.
import {
  Color, CubeCamera, DirectionalLight, Fog, HemisphereLight, Group, HalfFloatType, Mesh, PerspectiveCamera, PlaneGeometry, PointLight, Scene, ShaderMaterial,
  Vector2, Vector3, Vector4, WebGLCubeRenderTarget, WebGLRenderTarget, type Camera, type MeshStandardMaterial, type WebGLRenderer,
} from 'three';
import { mergeStatic } from '@/core/render/three/merge';
import { skyAt } from '../../shell/room';
import { daylight, sunDir } from '../roomplan';
import { city } from './city';
import { house } from './houses';
import { disposeKit, makeKit, type Kit } from './kit';
import { M, houses, toOutside, trees } from './plan';
import { skyDome, skyMaterial, type SkyUniforms } from './sky';
import { street } from './street';
import { plantTrees, type LeafUniforms } from './trees';

/** The sun's shadow map at each level of the graphics settings (0: none). */
const SHADOW_LEVELS = [0, 1024, 2048, 2048, 4096];
/** The sun's shadow covers this square round the near streets (m), as seen from the sun. */
const SHADOW_HALF = 80, SHADOW_AT = new Vector3(-6, 0, -30);
/** The lamps whose light is drawn (the nearest to where the window looks, down the side street); the rest only glow. */
const LIT_LAMPS = 8, LAMPS_AT = new Vector3(-9, 0, -38);
/** The window's picture over what the room's light makes of it: 1 is the outside's own exposure. */
const GAIN = 1;

const QUAD_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const QUAD_FRAG = /* glsl */`
uniform sampler2D tOut;
uniform samplerCube tEnv;
uniform vec2 off, inv;
uniform float live, gain;
varying vec3 vWorld;
const float CAP = 4.0;
void main() {
  vec3 c = live > 0.5 ? texture2D(tOut, (gl_FragCoord.xy - off) * inv).rgb : textureCube(tEnv, normalize(vWorld - cameraPosition)).rgb;
  // the sun's glints off cars and panes held to a glow: the room's bloom would spread a pixel of them over the street
  c *= min(1.0, CAP / max(max(c.r, c.g), max(c.b, 1e-4)));
  gl_FragColor = vec4(c * gain, 1.0);
}`;

const smooth = (a: number, b: number, v: number): number => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export class OutsideView {
  /** The quad in the window's opening (room units). */
  readonly mesh: Mesh;
  private quad: ShaderMaterial;
  private scene = new Scene();
  private cam = new PerspectiveCamera();
  private target: WebGLRenderTarget | null = null;
  private kit: Kit;
  private sky: ShaderMaterial;
  private dome: Mesh;
  private env = new WebGLCubeRenderTarget(64, { type: HalfFloatType });
  private envCam = new CubeCamera(0.5, 1000, this.env);
  private envScene = new Scene();
  private envDirty = true;
  private sun = new DirectionalLight(0xffffff, 0);
  private bounce = new DirectionalLight(0xfff1e2, 0);
  /** The moon's light at night, a faint blue from the sky (it casts no glints, which a moon as a light would on every roof). */
  private moon = new HemisphereLight(0x5a6fa8, 0x1c1e26, 0);
  private lamps: PointLight[] = [];
  private leaf: LeafUniforms;
  private fog = new Fog(0xffffff, 150, 15000);
  private key = -1;
  private sunKey = -1;
  private sunMoved = true;
  /** The camera the window's picture is drawn for this frame: the quad shows the picture only to it. */
  private live: Camera | null = null;

  /** The window's quad (room units: its middle, its size, the depth of the glass). */
  constructor(cx: number, cy: number, w: number, h: number, z: number) {
    this.quad = new ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: QUAD_FRAG,
      uniforms: { tOut: { value: null }, tEnv: { value: this.env.texture }, off: { value: new Vector2() }, inv: { value: new Vector2(1, 1) }, live: { value: 0 }, gain: { value: GAIN } },
    });
    this.mesh = new Mesh(new PlaneGeometry(w, h), this.quad);
    this.mesh.position.set(cx, cy, z);
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.onBeforeRender = (_r, _s, camera) => { this.quad.uniforms.live!.value = camera === this.live && this.target ? 1 : 0; };

    // the street, the houses, the town: merged by material; the trees, the town's mesh and the land keep their own attributes
    const k = this.kit = makeKit(), hs = houses(), far = city(k), ts = [...trees(), ...far.trees];
    const still = new Group(), st = street(k, hs, ts);
    for (const h of hs) still.add(house(h, k));
    still.add(st.group, far.group);
    mergeStatic(still);
    this.scene.add(still, ...far.extra);
    const plants = plantTrees(ts, k);
    this.leaf = plants.leaf;
    this.scene.add(...plants.meshes);

    // the sky round the camera, and its small copy the environment sees
    this.sky = skyMaterial();
    this.dome = skyDome(this.sky, 15000);
    this.scene.add(this.dome);
    this.envScene.add(skyDome(this.sky, 100));
    this.scene.environment = this.env.texture;
    this.scene.fog = this.fog;
    for (const m of [k.glass, k.lit, k.carGlass, ...k.car] as MeshStandardMaterial[]) m.envMap = this.env.texture;

    // the lights: the sun (its shadow over the near streets), our row's light thrown back, the lamps the window looks at
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 700;
    Object.assign(this.sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.autoUpdate = false;
    this.sun.target.position.copy(SHADOW_AT);
    this.bounce.position.set(0.15, 0.35, 1).multiplyScalar(300);
    this.scene.add(this.sun, this.sun.target, this.bounce, this.moon);
    for (const p of [...st.lights].sort((a, b) => a.distanceTo(LAMPS_AT) - b.distanceTo(LAMPS_AT)).slice(0, LIT_LAMPS)) {
      const l = new PointLight(0xffc98a, 0, 45, 2);
      l.position.copy(p);
      this.lamps.push(l);
      this.scene.add(l);
    }
    this.setShadows(3);
  }

  /** The sun's shadow map at `level` of the graphics settings. */
  setShadows(level: number): void {
    const size = SHADOW_LEVELS[level] ?? 0, sh = this.sun.shadow;
    this.sun.castShadow = size > 0;
    if (sh.mapSize.x !== size || !size) { sh.map?.dispose(); sh.map = null; }
    if (size) sh.mapSize.set(size, size);
    sh.radius = 2;
    this.sunMoved = true;
  }

  /** The hour's sky and light (a few times a game hour), the clouds' drift and the wind every frame. */
  frame(hour: number, t: number): void {
    const u = this.sky.uniforms as unknown as SkyUniforms;
    u.time.value = t;
    this.leaf.time.value = t;
    const key = Math.round(hour * 30);
    if (key === this.key) return;
    this.key = key;
    this.envDirty = true;
    const s = skyAt(hour), day = daylight(hour), night = 1 - day, sd = sunDir(hour), lift = 1 + 0.1 * day;
    const top = new Color(s.top).multiplyScalar(lift), hor = new Color(s.hor).multiplyScalar(lift);
    u.top.value.copy(top);
    u.hor.value.copy(hor);
    u.ground.value.copy(hor).lerp(new Color(0x4a5242), 0.55).multiplyScalar(0.45);
    u.sunDir.value.set(sd[0], sd[1], sd[2]);
    u.night.value = night;
    // the sun's light: white overhead, the horizon's warmth low down; gone under the horizon
    const low = 1 - smooth(0, 0.45, sd[1]), up = smooth(-0.03, 0.12, sd[1]);
    const sunCol = new Color(0xfff4e2).lerp(new Color(s.hor), low * 0.8);
    u.sunCol.value.copy(sunCol).multiplyScalar(day);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 5.6 * day * up;
    this.sun.position.set(sd[0], sd[1], sd[2]).multiplyScalar(320).add(SHADOW_AT);
    this.bounce.intensity = 0.55 * day * up;
    this.moon.intensity = 0.35 * night;
    this.scene.environmentIntensity = 1;
    this.fog.color.copy(hor).multiplyScalar(0.95);
    this.leaf.glow.value.copy(sunCol).multiplyScalar(this.sun.intensity * 0.22);
    // the lamps and the windows come on as the light goes
    const lights = Math.min(1, Math.max(0, 1.25 - day * 1.6));
    for (const l of this.lamps) l.intensity = 70 * lights;
    for (const n of this.kit.night) n.mat.emissiveIntensity = n.k * lights;
    const sk = Math.round(hour * 20);
    if (sk !== this.sunKey) { this.sunKey = sk; this.sunMoved = true; }
  }

  /**
   * Draw the view for `camera` (the room's, this frame) into the window's picture: the camera moved outside, cropped to the window's box on
   * screen. Call it before the frame's own draw. `samples`: the multisampling of the frame's scene target.
   */
  draw(renderer: WebGLRenderer, camera: PerspectiveCamera, samples: number): void {
    this.live = null;
    if (!this.mesh.parent) return;
    camera.updateMatrixWorld();
    this.mesh.updateWorldMatrix(true, false);
    const size = renderer.getDrawingBufferSize(new Vector2()), fw = size.x, fh = size.y;
    // the window's box on screen, and how near its nearest corner is
    const p = (this.mesh.geometry as PlaneGeometry).parameters, v = new Vector3(), view = new Vector4();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, nearest = Infinity, behind = false;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      v.set((sx * p.width) / 2, (sy * p.height) / 2, 0).applyMatrix4(this.mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      if (-v.z < camera.near) { behind = true; continue; }
      nearest = Math.min(nearest, -v.z);
      view.set(v.x, v.y, v.z, 1).applyMatrix4(camera.projectionMatrix);
      const nx = view.x / view.w, ny = view.y / view.w;
      x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
    }
    if (behind) { x0 = y0 = -1; x1 = y1 = 1; nearest = 0; }
    const rx = Math.max(0, Math.floor(((x0 + 1) / 2) * fw) - 2), rr = Math.min(fw, Math.ceil(((x1 + 1) / 2) * fw) + 2);
    const ry = Math.max(0, Math.floor(((1 - y1) / 2) * fh) - 2), rb = Math.min(fh, Math.ceil(((1 - y0) / 2) * fh) + 2);
    const rw = rr - rx, rh = rb - ry;
    if (rw < 1 || rh < 1) return;
    // the picture's target: it only grows, so a flight does not make a new one each frame
    let t = this.target;
    if (!t || t.width < rw || t.height < rh || t.samples !== samples) {
      const w = Math.max(rw, t?.width ?? 0), h = Math.max(rh, t?.height ?? 0);
      t?.dispose();
      t = this.target = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples });
      this.quad.uniforms.tOut!.value = t.texture;
    }
    // the camera outside: the room camera's place in metres, its turn, its lens, cropped to the box
    const c = this.cam, wp = camera.getWorldPosition(new Vector3());
    c.position.set(...toOutside(wp.x, wp.y, wp.z));
    camera.getWorldQuaternion(c.quaternion);
    c.fov = camera.fov; c.aspect = camera.aspect; c.zoom = camera.zoom;
    c.near = Math.min(100, Math.max(0.03, (nearest / M) * 0.95));
    c.far = 20000;
    c.setViewOffset(fw, fh, rx, ry, rw, rh);
    c.updateMatrixWorld();
    this.dome.position.copy(c.position);
    // the leaves' light from behind, in the camera's frame
    const sd = sunDir(this.key / 30);
    this.leaf.sunView.value.set(sd[0], sd[1], sd[2]).transformDirection(c.matrixWorldInverse);
    if (this.envDirty) { this.envDirty = false; this.envCam.update(renderer, this.envScene); this.env.texture.needsPMREMUpdate = true; }
    const was = renderer.getRenderTarget();
    this.sun.shadow.autoUpdate = this.sunMoved && this.sun.castShadow;
    t.viewport.set(0, 0, rw, rh);
    t.scissor.set(0, 0, rw, rh);
    t.scissorTest = true;
    renderer.setRenderTarget(t);
    renderer.clear();
    renderer.render(this.scene, c);
    renderer.setRenderTarget(was);
    this.sun.shadow.autoUpdate = false;
    this.sunMoved = false;
    this.quad.uniforms.off!.value.set(rx, fh - ry - rh);
    this.quad.uniforms.inv!.value.set(1 / t.width, 1 / t.height);
    this.live = camera;
  }

  dispose(): void {
    this.target?.dispose();
    this.env.dispose();
    this.sun.shadow.map?.dispose();
    this.scene.traverse((o) => { if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose(); });
    this.sky.dispose();
    disposeKit(this.kit);
    this.quad.dispose();
  }
}
