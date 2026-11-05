// The view out of the room's window: a real city in 3D (`plan.ts`), drawn each frame from where the room's camera stands, moved out to the
// fifteenth floor (`toOutside`), into a supersampled target the size of the window on screen. The window's quad shows that picture, each
// screen pixel its block's average, so the perspective is the room camera's own: the street below, the roofs of the blocks across, the avenue
// down to the downtown towers, the hills. Its light: the hour's sky (`sky.ts`, also the environment its materials take as sky light and
// reflections, so the glass towers mirror it), the sun with its shadows, the light our own tower throws back, the lamps, the lit windows at
// night (the moon's light is the night sky's), the soft glow round every bright thing at night (`glow.ts`), and the haze over it all
// (`haze.ts`). The traffic moves on each frame (`traffic.ts`, drawn by `cars.ts`), the signals with it.
// Another camera (the room's probe) sees the window as the sky's cube instead.
import {
  Color, CubeCamera, DirectionalLight, HemisphereLight, Group, HalfFloatType, Mesh, PerspectiveCamera, PlaneGeometry, PointLight, Scene, ShaderMaterial,
  Vector2, Vector3, Vector4, WebGLCubeRenderTarget, WebGLRenderTarget, type Camera, type Material, type WebGLRenderer,
} from 'three';
import { mergeStatic } from '@/core/render/three/merge';
import { skyAt } from '../../shell/room';
import { daylight, sunDir } from '../roomplan';
import { Fleet, type CarLight } from './cars';
import { land } from './city';
import { CityGlow } from './glow';
import { withHaze, type HazeUniforms } from './haze';
import { disposeKit, makeKit, type Kit } from './kit';
import { withLampLight, type LampUniforms } from './lamplight';
import { GRID, M, buildings, parked, toOutside, trees } from './plan';
import { skyDome, skyMaterial, type SkyUniforms } from './sky';
import { Signals, street } from './street';
import { facadeMaterial, massGeometry, type FacadeUniforms } from './towers';
import { Traffic } from './traffic';
import { plantTrees, type LeafUniforms } from './trees';

/** The sun's shadow map at each level of the graphics settings (0: none). */
const SHADOW_LEVELS = [0, 1024, 2048, 2048, 4096];
/** The sun's shadow covers this square round the near blocks (m), as seen from the sun. */
const SHADOW_HALF = 420, SHADOW_AT = new Vector3(GRID.av0, 0, -380);
/** The lamps whose light is drawn (the nearest to where the window looks, down the avenue); the rest only glow. */
const LIT_LAMPS = 8, LAMPS_AT = new Vector3(GRID.av0, 0, -70);
/**
 * The glass's tint at noon (`setTint`): smart glass that darkens with the day, so the bright city keeps to the room's exposure, a little cool. At
 * night it is clear (1 is the outside's own exposure).
 */
const TINT = new Color(0.42, 0.46, 0.52);
/** The city's light in the low sky and the haze at night (linear), the haze's density (per m) by day and at night, its fall with height (per m). */
const CITY_GLOW = new Color(0.055, 0.036, 0.042), HAZE_DAY = 1.5e-4, HAZE_NIGHT = 2.4e-4, HAZE_FALL = 1 / 320;
/** How much of the soft glow round the lights (`glow.ts`) the picture takes at night. */
const GLOW = 0.3;

const QUAD_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** The picture is drawn at this many pixels per screen pixel each way (with multisampling on), and the quad averages each block of them. */
const SUPER = 2;

// the picture's pixel for a screen pixel: at the corner its block's texels share, so the linear filter averages the block in one tap
const QUAD_FRAG = /* glsl */`
uniform sampler2D tOut, tGlow;
uniform samplerCube tEnv;
uniform vec2 off, inv;
uniform float live, ss, glowK;
uniform vec3 tint;
varying vec3 vWorld;
const float CAP = 4.0;
void main() {
  vec2 uv = (gl_FragCoord.xy - off) * ss * inv;
  vec3 c = live > 0.5 ? texture2D(tOut, uv).rgb : textureCube(tEnv, normalize(vWorld - cameraPosition)).rgb;
  // a bad pixel out there must not reach the room's bloom, which would spread it over the whole frame
  c = min(max(c, vec3(0.0)), vec3(1e3));
  if (live > 0.5 && glowK > 0.0) c += texture2D(tGlow, uv).rgb * glowK;
  // the sun's glints off cars and panes held to a glow: the room's bloom would spread a pixel of them over the street
  c *= min(1.0, CAP / max(max(c.r, c.g), max(c.b, 1e-4)));
  gl_FragColor = vec4(c * tint, 1.0);
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
  private facade: FacadeUniforms;
  private haze: HazeUniforms = {
    hzCol: { value: new Color() }, hzSun: { value: new Color() }, hzDir: { value: new Vector3(0, 1, 0) }, hzDensity: { value: HAZE_DAY }, hzFall: { value: HAZE_FALL },
  };
  private traffic = new Traffic();
  private carLight: CarLight = { night: { value: 0 } };
  private lampLight: LampUniforms = { lampNight: { value: 0 } };
  private fleet: Fleet;
  private signals: Signals;
  private glow = new CityGlow();
  /** The clock (s) the frame set, and the one the traffic has run to. */
  private clock = 0;
  private ran = -1;
  /** Materials of the view's own, outside the kit. */
  private disposables: Material[] = [];
  private key = -1;
  private sunKey = -1;
  private sunMoved = true;
  /** The camera the window's picture is drawn for this frame: the quad shows the picture only to it. */
  private live: Camera | null = null;

  /** The window's quad (room units: its middle, its size, the depth of the glass). */
  constructor(cx: number, cy: number, w: number, h: number, z: number) {
    this.quad = new ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: QUAD_FRAG,
      uniforms: { tOut: { value: null }, tEnv: { value: this.env.texture }, off: { value: new Vector2() }, inv: { value: new Vector2(1, 1) }, live: { value: 0 }, ss: { value: 1 }, tGlow: { value: null }, glowK: { value: 0 }, tint: { value: new Color(1, 1, 1) } },
    });
    this.mesh = new Mesh(new PlaneGeometry(w, h), this.quad);
    this.mesh.position.set(cx, cy, z);
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.onBeforeRender = (_r, _s, camera) => { this.quad.uniforms.live!.value = camera === this.live && this.target ? 1 : 0; };

    // the streets merged by material; the buildings in one mesh on their facade's material, the trees and the land in their own
    const k = this.kit = makeKit(), ts = trees();
    const still = new Group(), st = street(k, ts);
    still.add(st.group);
    mergeStatic(still);
    const facade = facadeMaterial(), mass = new Mesh(massGeometry(buildings()), facade.mat);
    mass.castShadow = mass.receiveShadow = true;
    this.facade = facade.u;
    this.scene.add(still, mass, land(k));
    const plants = plantTrees(ts, k);
    this.leaf = plants.leaf;
    this.scene.add(...plants.meshes);
    // the cars, moving and parked, and the signals' lamps
    this.fleet = new Fleet(this.traffic, parked(), this.carLight, this.haze);
    this.signals = new Signals(st.signals);
    this.scene.add(this.fleet.group, this.signals.mesh);

    // the sky round the camera, and its small copy the environment sees
    this.sky = skyMaterial();
    this.dome = skyDome(this.sky, 15000);
    this.scene.add(this.dome);
    this.envScene.add(skyDome(this.sky, 100));
    this.scene.environment = this.env.texture;
    this.disposables.push(facade.mat);
    // the lamps' pools on the ground, the haze on every material in place of fog
    for (const m of [k.asphalt, k.paving, k.kerb]) withLampLight(m, this.lampLight);
    this.scene.traverse((o) => { for (const m of [(o as Mesh).material ?? []].flat()) withHaze(m, this.haze); });

    // the lights: the sun (its shadow over the near blocks), our tower's light thrown back, the lamps the window looks at
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 3200;
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

  /** The glass's tint for the day's light `day` (0 night, 1 day): clear at night, `TINT` at noon. */
  setTint(day: number): void { (this.quad.uniforms.tint!.value as Color).setRGB(1, 1, 1).lerp(TINT, day); }

  /** The hour's sky and light (a few times a game hour), the clouds' drift and the wind every frame. */
  frame(hour: number, t: number): void {
    const u = this.sky.uniforms as unknown as SkyUniforms;
    u.time.value = t;
    this.leaf.time.value = t;
    this.facade.time.value = t;
    this.clock = t;
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
    this.sun.position.set(sd[0], sd[1], sd[2]).multiplyScalar(1600).add(SHADOW_AT);
    this.bounce.intensity = 0.55 * day * up;
    this.moon.intensity = 0.35 * night;
    this.scene.environmentIntensity = 1;
    // the haze: the horizon's colour by day, the sun's light in it toward the sun, the city's glow at night
    const hz = this.haze;
    u.glow.value.copy(CITY_GLOW).multiplyScalar(night);
    hz.hzCol.value.copy(hor).multiplyScalar(0.95).add(u.glow.value);
    hz.hzSun.value.copy(sunCol).multiplyScalar(0.45 * day * up);
    hz.hzDir.value.set(sd[0], sd[1], sd[2]);
    hz.hzDensity.value = HAZE_DAY + (HAZE_NIGHT - HAZE_DAY) * night;
    this.leaf.glow.value.copy(sunCol).multiplyScalar(this.sun.intensity * 0.22);
    // the lamps, the cars' lights and the windows come on as the light goes
    const lights = Math.min(1, Math.max(0, 1.25 - day * 1.6));
    for (const l of this.lamps) l.intensity = 70 * lights;
    for (const n of this.kit.night) n.mat.emissiveIntensity = n.k * lights;
    this.facade.night.value = lights;
    this.leaf.night.value = lights;
    this.carLight.night.value = lights;
    this.lampLight.lampNight.value = lights;
    this.quad.uniforms.glowK!.value = GLOW * lights * lights;
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
    if (rr - rx < 1 || rb - ry < 1) return;
    // the picture's target, supersampled (then fewer samples each): it only grows, so a flight does not make a new one each frame
    const ss = samples > 0 ? SUPER : 1, ms = ss > 1 ? Math.min(samples, 2) : samples, rw = (rr - rx) * ss, rh = (rb - ry) * ss;
    let t = this.target;
    if (!t || t.width < rw || t.height < rh || t.samples !== ms) {
      const w = Math.max(rw, t?.width ?? 0), h = Math.max(rh, t?.height ?? 0);
      t?.dispose();
      t = this.target = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: ms });
      this.quad.uniforms.tOut!.value = t.texture;
    }
    // the camera outside: the room camera's place in metres, its turn, its lens, cropped to the box
    const c = this.cam, wp = camera.getWorldPosition(new Vector3());
    c.position.set(...toOutside(wp.x, wp.y, wp.z));
    camera.getWorldQuaternion(c.quaternion);
    c.fov = camera.fov; c.aspect = camera.aspect; c.zoom = camera.zoom;
    c.near = Math.min(100, Math.max(0.03, (nearest / M) * 0.95));
    c.far = 20000;
    c.setViewOffset(fw * ss, fh * ss, rx * ss, ry * ss, rw, rh);
    c.updateMatrixWorld();
    this.dome.position.copy(c.position);
    // the traffic on to the frame's clock, each car placed for this eye, the signals lit
    const dt = this.ran < 0 ? 0.1 : this.clock - this.ran;
    this.ran = this.clock;
    this.fleet.update(Math.max(0, dt), c.position.x, c.position.z);
    this.signals.update(this.traffic.t);
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
    if (this.quad.uniforms.glowK!.value > 0) {
      this.glow.run(renderer, t, rw, rh);
      this.quad.uniforms.tGlow!.value = this.glow.texture;
    }
    renderer.setRenderTarget(was);
    this.sun.shadow.autoUpdate = false;
    this.sunMoved = false;
    this.quad.uniforms.off!.value.set(rx, fh - rb);
    this.quad.uniforms.ss!.value = ss;
    this.quad.uniforms.inv!.value.set(1 / t.width, 1 / t.height);
    this.live = camera;
  }

  dispose(): void {
    this.target?.dispose();
    this.env.dispose();
    this.sun.shadow.map?.dispose();
    this.fleet.dispose();
    this.glow.dispose();
    this.signals.mesh.dispose();
    (this.signals.mesh.material as Material).dispose();
    this.scene.traverse((o) => { if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose(); });
    this.sky.dispose();
    for (const m of this.disposables) m.dispose();
    disposeKit(this.kit);
    this.quad.dispose();
  }
}
