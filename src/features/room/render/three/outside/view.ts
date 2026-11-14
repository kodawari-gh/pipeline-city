// The view out of the room's window: a real city in 3D (`plan.ts`), drawn from where the room's camera stands, moved out to the
// fifteenth floor (`toOutside`), into a supersampled target the size of the window on screen: each frame while the eye moves, each few
// (`EVERY`) while it holds still, and only what the camera sees (`sweep.ts`). The window's quad shows that picture, each
// screen pixel its block's average, so the perspective is the room camera's own: the street below, the roofs of the blocks across, the avenue
// down to the downtown towers, the hills. Its light: the hour's sky (`sky.ts`, also the environment its materials take as sky light and
// reflections, so the glass towers mirror it), the sun with its shadows, the light our own tower throws back, the lamps, the lit windows at
// night (the moon's light is the night sky's; the lights follow the sky's dark from 17:00, not the room's daylight, and each building's
// windows come on at their own time, `lightsAt`), each sign's light on its wall (`signlight.ts`), the soft glow round every bright thing at night
// (`glow.ts`), and the haze over it all, with a lit mist under it at night (`haze.ts`). At the warm hour the air takes the sky's bands. The traffic
// moves on each frame (`traffic.ts`, drawn by `cars.ts`), the signals with it, steam rises off a few roofs (`steam.ts`). As the light goes the room
// itself shows faintly in the glass (`mirror.ts`), only its lit screen and lamps over the dark city.
// Another camera (the room's probe) sees the window as the sky's cube instead.
import {
  Color, CubeCamera, DirectionalLight, Frustum, HemisphereLight, Group, HalfFloatType, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, PMREMGenerator, PointLight, Scene, ShaderMaterial,
  Vector2, Vector3, Vector4, WebGLCubeRenderTarget, WebGLRenderTarget, type Camera, type Material, type Object3D, type WebGLRenderer,
} from 'three';
import { mergePalette, mergeStatic } from '@/core/render/three/merge';
import { startPrograms, type Program } from '@/core/render/three/compile';
import { skyAt } from '../../shell/room';
import { daylight, sunDir } from '../roomplan';
import { Fleet, type CarLight } from './cars';
import { withCanyon } from './canyon';
import { land } from './city';
import { LOW_CELL, LOW_EVERY, LOW_FLEET, cityCuts, type CityCuts, type CityDetail } from './detail';
import { CityGlow } from './glow';
import { withHaze, type HazeUniforms } from './haze';
import { disposeKit, makeKit, type Kit } from './kit';
import { withLampLight, type LampUniforms } from './lamplight';
import { GlassMirror } from './mirror';
import { GRID, M, buildings, parked, toOutside, trees } from './plan';
import { Sight, outsideDraws, type QueryGL } from './sight';
import { EARTH_SHADOW, moonDir, skyDome, skyMaterial, type SkyUniforms } from './sky';
import { signWashes, type SignWash } from './signlight';
import { roofSteam, steamUniforms, type SteamUniforms } from './steam';
import { Signals, street } from './street';
import { SunMap } from './sunmap';
import { Sweep, sweptMerge } from './sweep';
import { lowFacadeMaterial, type LowLamps } from './lowfacade';
import { facadeMaterial, massGeometries, type FacadeUniforms } from './towers';
import { Traffic } from './traffic';
import { plantTrees, type LeafUniforms } from './trees';

/** The sun's shadow map at each level of the graphics settings (0: none). */
const SHADOW_LEVELS = [0, 1024, 2048, 4096, 4096];
/** The sun's shadow covers this square round the near blocks (m), as seen from the sun. */
const SHADOW_HALF = 420, SHADOW_AT = new Vector3(GRID.av0, 0, -380);
/** The lamps whose light is drawn (the nearest to where the window looks, down the avenue); the rest only glow. */
const LIT_LAMPS = 8, LAMPS_AT = new Vector3(GRID.av0, 0, -70);
/**
 * The glass's share of the light: a neutral grey glass, the same at every hour, so the bright day keeps to the room's exposure and the night
 * city is as dim through it as the day's. The room's light from outside (the sky's, the sun's) takes the same share (`room3d.ts`).
 */
export const GLASS_T = 0.47;
/*
 * The night out here is in the room's units (`nits` in `room3d.ts`: a unit is about 700 cd/m2): the sky's glow, the haze and the mist over a
 * city are a few cd/m2, the moon's light far less, all far below the room's lamps. So at night the room is the picture and the city the dark
 * behind it, its lit windows and signs its brightest parts (`light.md` "Targets": at 23:00 the city is half the room's mean or less).
 */
/** The city's light in the low sky and the haze at night (linear), the haze's density (per m) by day and at night, its fall with height (per m). */
const CITY_GLOW = new Color(0.0062, 0.0036, 0.005), HAZE_DAY = 1.5e-4, HAZE_NIGHT = 2.4e-4, HAZE_FALL = 1 / 320;
/** The low mist at night (`haze.ts`): its colour, lit from below by the streets (linear), and its density at the street (per m). */
const MIST = new Color(0.0105, 0.007, 0.0105), MIST_DENSITY = 4e-4;
/** The sky at full night (linear) overhead and low down, a navy the room's own `skyAt` does not need to be. The moon's light at full night. */
const NIGHT_TOP = new Color(0.00035, 0.0007, 0.0032), NIGHT_HOR = new Color(0.0011, 0.0014, 0.005), MOON = 0.035;
/** The sun's light low down, where it has crossed the most air. */
const SUN_LOW = new Color(1, 0.2, 0.045), STEAM_LOW = new Color(0.2, 0.125, 0.1), HOR_CLEAR = new Color(0xc2e7ff), BOUNCE_LATE = new Color(0xffc48f);
/** The haze toward a low sun: the rose over the ember, so the far towers fade rose in front of the fire on the horizon. */
const DUSK_ROSE = new Color(0.56, 0.2, 0.25);
/** The warm hour's share of the sky at an hour, its bands' brightness as the light goes, how bright the haze is against them. */
const duskShare = (h: number): number => Math.max(smooth(17.2, 18.9, h) * (1 - smooth(20.1, 21.4, h)), smooth(4.7, 5.7, h) * (1 - smooth(6.6, 8, h)));
const duskLight = (h: number): number => 1 - 0.7 * smooth(19, 20.9, h) - 0.65 * (1 - smooth(4.7, 6, h));
const DUSK_HAZE = 0.6;
/**
 * The city's lights at an hour (0 to 1): they come on as its sky darkens, evenly from 17:00 to 20:00 (the room's daylight is still about .76
 * at 18:30, under a purple sky), and go off with the dawn. Each building has its own time in the ramp (`towers.ts`), so they come on one by
 * one: a few at 17:30, about half at 18:30, all by 20:00.
 */
const lightsAt = (h: number): number => (h < 12 ? 1 - smooth(5.2, 7.4, h) : Math.min(1, Math.max(0, (h - 17) / 3)));
/** How much of the soft glow round the lights (`glow.ts`) the picture takes at night. */
const GLOW = 0.3;
/** How far the room's picture in the glass (`mirror.ts`) is lifted at full night: the room is far darker than the screen's exposure shows it. From what share of the night's lights it starts. */
const MIRROR = 65, MIRROR_FROM = 0.55;
/** With the eye still, that picture is drawn each this many frames: its LEDs and its screen a few frames late do not show in so faint a ghost. */
const MIRROR_EVERY = 4;
/**
 * How far west the sun out here stands of the room's at the same hour (radians). The room's own, nearly behind the window through the
 * afternoon, would light the faces the window sees head on, flat. Turned, it rakes them, one face bright and one in shade, the shadows
 * lie across the streets, and it sets in the view.
 */
const SUN_TURN = 0.7;
const sunOutside = (hour: number): [number, number, number] => {
  const [x, y, z] = sunDir(hour), c = Math.cos(SUN_TURN), s = Math.sin(SUN_TURN);
  return [x * c - z * s, y, x * s + z * c];
};

const QUAD_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** The picture is drawn at this many pixels per screen pixel each way (with multisampling on), and the quad averages each block of them. */
const SUPER = 2;
/**
 * While the eye holds still the picture is drawn each this many frames: the traffic, the leaves, the clouds and the steam move on slowly at
 * that distance. An eye that moves the window's box by `HOLD_PX` (the frame's pixels) or more has it drawn again at once.
 */
export const EVERY = 3, HOLD_PX = 1;
/** At Low the steam and the leaves' sway stand at this clock (s): their poses at that instant, for good. */
const STILL_T = 0;

// the picture's pixel for a screen pixel: at the corner its block's texels share, so the linear filter averages the block in one tap
const QUAD_FRAG = /* glsl */`
uniform sampler2D tOut, tGlow, tMirror;
uniform samplerCube tEnv;
uniform vec2 off, inv, mirrorPx;
uniform float live, ss, glowK, mirrorK;
uniform vec3 tint, glassN;
uniform mat4 mirrorOf;
varying vec3 vWorld;
const float CAP = 4.0;
/** The room's picture in the glass at this point, blurred a little, as the glass reflects it (little head on, much at a slant). */
vec3 inGlass() {
  vec4 q = mirrorOf * vec4(vWorld, 1.0);
  vec2 u = q.xy / q.w;
  vec3 r = texture2D(tMirror, u).rgb * 0.28;
  r += (texture2D(tMirror, u + mirrorPx * vec2(1.6, 0.4)).rgb + texture2D(tMirror, u + mirrorPx * vec2(-1.6, -0.4)).rgb) * 0.12;
  r += (texture2D(tMirror, u + mirrorPx * vec2(0.5, 1.5)).rgb + texture2D(tMirror, u + mirrorPx * vec2(-0.5, -1.5)).rgb) * 0.12;
  r += (texture2D(tMirror, u + mirrorPx * vec2(1.1, -1.2)).rgb + texture2D(tMirror, u + mirrorPx * vec2(-1.1, 1.2)).rgb) * 0.12;
  r = min(max(r, vec3(0.0)), vec3(CAP));
  // the room's dim things (its walls, the plant) would only veil the city: what shows is its lamps and screens, and the brightest stays a ghost
  float l = max(max(r.r, r.g), r.b);
  r = mix(r, vec3(l), 0.35) * smoothstep(0.02, 0.14, l);
  float s = 1.0 - abs(dot(normalize(vWorld - cameraPosition), glassN));
  r *= min(0.2, 0.09 + 0.91 * s * s * s * s * s) * mirrorK;
  return r / (1.0 + max(max(r.r, r.g), r.b) / 0.1);
}
void main() {
  vec2 uv = (gl_FragCoord.xy - off) * ss * inv;
  vec3 c = live > 0.5 ? texture2D(tOut, uv).rgb : textureCube(tEnv, normalize(vWorld - cameraPosition)).rgb;
  // a bad pixel out there must not reach the room's bloom, which would spread it over the whole frame
  c = min(max(c, vec3(0.0)), vec3(1e3));
  if (live > 0.5 && glowK > 0.0) c += texture2D(tGlow, uv).rgb * glowK;
  // the sun's glints off cars and panes held to a glow: the room's bloom would spread a pixel of them over the street
  c *= min(1.0, CAP / max(max(c.r, c.g), max(c.b, 1e-4)));
  c *= tint;
  if (live > 0.5 && mirrorK > 0.0) c += inGlass();
  gl_FragColor = vec4(c, 1.0);
}`;

const smooth = (a: number, b: number, v: number): number => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Two views the same to the eye: a view that has settled still creeps by far less than this (its ease never quite ends), a move soon adds up past it. */
const nearly = (a: Matrix4, b: Matrix4): boolean => a.elements.every((x, i) => Math.abs(x - b.elements[i]!) < 1e-4);

export class OutsideView {
  /** The quad in the window's opening (room units). */
  readonly mesh: Mesh;
  private quad: ShaderMaterial;
  /** Read and set by the `?debug` layers (`app/debug/city-layers.ts`), not by other callers. */
  scene = new Scene();
  private cam = new PerspectiveCamera();
  private target: WebGLRenderTarget | null = null;
  /** The scale (`SUPER` or 1) the target was made at. */
  private targetSS = 1;
  private kit: Kit;
  private sky: ShaderMaterial;
  private dome: Mesh;
  private env = new WebGLCubeRenderTarget(128, { type: HalfFloatType });
  private envCam = new CubeCamera(0.5, 1000, this.env);
  private envScene = new Scene();
  private envDirty = true;
  // (the sky's environment, filtered: made here and freed in `dispose`; a scene's own cube target would keep its filtered copy for good)
  private pmrem: PMREMGenerator | null = null;
  private envMap: WebGLCubeRenderTarget | null = null;
  private sun = new DirectionalLight(0xffffff, 0);
  private bounce = new DirectionalLight(0xfff1e2, 0);
  /** The moon's light at night, a faint blue from the sky (it casts no glints, which a moon as a light would on every roof). */
  private moon = new HemisphereLight(0x5a6fa8, 0x1c1e26, 0);
  lamps: PointLight[] = [];
  /** Low's buildings' analytic lamp term (null at High, where the PointLights light the walls). */
  lowLamps: LowLamps | null = null;
  private leaf: LeafUniforms;
  private facade: FacadeUniforms;
  private steam: SteamUniforms;
  private haze: HazeUniforms = {
    hzCol: { value: new Color() }, hzSun: { value: new Color() }, hzDir: { value: new Vector3(0, 1, 0) }, hzDensity: { value: HAZE_DAY }, hzFall: { value: HAZE_FALL },
    hzMist: { value: new Color() }, hzMistD: { value: 0 }, hzTime: { value: 0 },
  };
  private traffic = new Traffic();
  private carLight: CarLight = { night: { value: 0 } };
  private lampLight: LampUniforms = { lampNight: { value: 0 } };
  private fleet: Fleet;
  private signals: Signals;
  private glow = new CityGlow();
  private mirror = new GlassMirror();
  /** How much the room shows in the glass at this hour. */
  private mirrorAt = 0;
  /** The clock (s) the frame set, and the one the traffic has run to. */
  private clock = 0;
  private ran = -1;
  /** Materials of the view's own, outside the kit. */
  private disposables: Material[] = [];
  key = -1;
  /** When the sun's shadow map is drawn: on its steps, and not while it is at 0 (`sunmap.ts`). */
  private sunMap = new SunMap();
  /** The camera the window's picture is drawn for this frame: the quad shows the picture only to it. */
  private live: Camera | null = null;
  /** Whether the eye sees the window; the eye (its whole view and the frame's size) at the last draw. */
  private sight = new Sight();
  private sightCanvas: HTMLCanvasElement | null = null;
  private eye = new Matrix4();
  private eyeNow = new Matrix4();
  private eyeFrame = '';
  /** Frames since the room's picture in the glass was drawn, and whether it shows. */
  private mirrorAge = 0;
  private mirrorShown = false;
  /** What the picture's camera sees: the buildings, the trees and the cars out of it are not drawn (`sweep.ts`, `Fleet.update`). */
  private seen = new Frustum();
  private seenOf = new Matrix4();
  private sweeps: Sweep[] = [];
  /** The camera's view at the last cut, and whether that cut kept all of it (for the sun's shadows). */
  private cutOf = new Matrix4();
  private cutAll = false;
  /** The window's box (its corners in the frame, -1 to 1) and the frame, at the picture's last draw, and the ticks (`frame`) it has stood since. */
  private box = new Vector4();
  private boxFrame = '';
  age = 0;
  /** `?debug` only (`app/debug/city-layers.ts`): the layers that are off, and the objects of those that hide objects. Empty unless the overlay turns one off. */
  off = new Set<string>();
  parts: Record<string, Object3D[]> = {};
  /** The picture is due for its next draw (each `EVERY` ticks): a frame drawn on demand (docs/render/load.md) draws on this beat. */
  get due(): boolean { return this.age >= this.every; }
  /** The ticks between two draws of a still eye (`EVERY`; `LOW_EVERY` at Low). */
  private every = EVERY;
  /** The Low cut of the steam and leaves' clock (`clock`, `detail.ts`): they stand at `STILL_T`. */
  private clockCut = false;

  /** The window's quad (room units: its middle, its size, the depth of the glass). `detail`: how much of the city is built (`detail.ts`). */
  constructor(cx: number, cy: number, w: number, h: number, z: number, readonly detail: CityDetail = 'high', cuts: CityCuts = cityCuts(detail)) {
    this.quad = new ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: QUAD_FRAG,
      uniforms: {
        tOut: { value: null }, tEnv: { value: this.env.texture }, off: { value: new Vector2() }, inv: { value: new Vector2(1, 1) }, live: { value: 0 }, ss: { value: 1 }, tGlow: { value: null }, glowK: { value: 0 }, tint: { value: new Color(GLASS_T, GLASS_T, GLASS_T) },
        tMirror: { value: null }, mirrorOf: { value: new Matrix4() }, mirrorK: { value: 0 }, mirrorPx: { value: new Vector2() }, glassN: { value: new Vector3(0, 0, 1) },
      },
    });
    this.mesh = new Mesh(new PlaneGeometry(w, h), this.quad);
    this.mesh.position.set(cx, cy, z);
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    // (after what stands before it, so the query in `Sight` sees what hides it)
    this.mesh.renderOrder = 1;
    this.mesh.onBeforeRender = (r, _s, camera) => {
      const live = camera === this.live && this.target;
      this.quad.uniforms.live!.value = live ? 1 : 0;
      if (live) this.sight.begin(r.getContext() as QueryGL);
    };
    this.mesh.onAfterRender = (r) => this.sight.end(r.getContext() as QueryGL);

    // the streets merged by material (their many small things in bearing order, cut by a sweep); the buildings on their facade's material,
    // ring by ring, the trees and the land in their own
    // (each Low cut by its flag, `detail.ts`: High has none)
    const on = (c: boolean): CityDetail => (c ? 'low' : 'high');
    this.every = cuts.cadence ? LOW_EVERY : EVERY;
    this.clockCut = cuts.clock;
    const k = this.kit = makeKit(), ts = trees();
    const still = new Group(), st = street(k, ts, on(cuts.streets), on(cuts.furniture));
    still.add(st.group);
    // (with the palette cut the plain materials, which differ only in colour and shine, are palette meshes; each is swept like the plain ones, or it would draw whole)
    const palette: Material[] = [];
    if (cuts.palette) {
      mergePalette(still);
      still.traverse((o) => { if (o.name === 'merged') palette.push((o as Mesh).material as Material); });
    }
    const cell = cuts.streets ? LOW_CELL : undefined;
    this.sweeps.push(...(cuts.palette
      ? [...sweptMerge(still, palette, cell, ['_pc', '_prm']), ...sweptMerge(still, [k.lantern], cell)]
      : sweptMerge(still, [k.paint, k.yellow, k.iron, k.post, k.soil, k.lantern, k.trim, k.kerb], cell)));
    mergeStatic(still);
    // (no steam with the steam cut: a plume is a draw for a few roofs)
    // the lamps the window looks at: the buildings take them as an analytic term at Low (`lowfacade.ts`), the street takes them as PointLights
    const lampAt = [...st.lights].sort((a, b) => a.distanceTo(LAMPS_AT) - b.distanceTo(LAMPS_AT)).slice(0, LIT_LAMPS);
    const lowFac = cuts.facade ? lowFacadeMaterial(lampAt) : null, facade = lowFac ?? facadeMaterial();
    this.lowLamps = lowFac?.lamps ?? null;
    const blocks = buildings(), washes: SignWash[] = [], steam = cuts.steam ? null : roofSteam(blocks, this.haze);
    const mass = massGeometries(blocks, washes, on(cuts.far)).map((r) => {
      const m = new Mesh(r.geometry, facade.mat);
      m.castShadow = m.receiveShadow = true;
      this.sweeps.push(new Sweep(r.balls, [{ mesh: m, at: r.at }]));
      return m;
    });
    const signLight = signWashes(washes, this.haze, facade.u.night);
    this.facade = facade.u;
    this.steam = steam?.u ?? steamUniforms();
    const ground = land(k);
    this.scene.add(still, ...mass, ground, ...(steam ? [steam.mesh] : []), signLight);
    const plants = plantTrees(ts, k, on(cuts.trees));
    this.sweeps.push(...plants.sweeps);
    this.leaf = plants.leaf;
    this.scene.add(...plants.meshes);
    this.parts = { buildings: [still, ...mass, ground, ...plants.meshes], steam: steam ? [steam.mesh] : [], signs: [signLight] };
    // the cars, moving and parked, and the signals' lamps
    this.fleet = cuts.fleet ? new Fleet(this.traffic, parked(), this.carLight, this.haze, LOW_FLEET, 1) : new Fleet(this.traffic, parked(), this.carLight, this.haze);
    this.signals = new Signals(st.signals);
    this.scene.add(this.fleet.group, this.signals.mesh);
    this.parts.cars = [this.fleet.group, this.signals.mesh];

    // the sky round the camera, and its small copy the environment sees
    this.sky = skyMaterial(cuts.sky);
    this.dome = skyDome(this.sky, 15000);
    this.scene.add(this.dome);
    this.parts.sky = [this.dome];
    this.envScene.add(skyDome(this.sky, 100));
    this.disposables.push(facade.mat, signLight.material as Material);
    if (steam) this.disposables.push(steam.mesh.material as Material);
    // the lamps' pools on the ground, the haze on every material in place of fog
    for (const m of [k.asphalt, k.paving, k.kerb]) withLampLight(m, this.lampLight);
    for (const m of [k.asphalt, k.paving, k.kerb, k.paint, k.yellow, ...palette]) withCanyon(m);
    this.disposables.push(...palette);
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
    for (const p of lampAt) {
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
    this.sunMap.ask();
  }


  /** The hour's sky and light (a few times a game hour), the clouds' drift and the wind every frame. */
  frame(hour: number, t: number): void {
    this.age++;
    // (debug: frozen animations keep the clock where the toggle found it)
    if (this.off.has('freeze')) t = this.clock;
    const u = this.sky.uniforms as unknown as SkyUniforms;
    u.time.value = t;
    // at Low the steam and the leaves hold still (their clock stands at `STILL_T`); the sky, the facade's beacons and the haze keep the clock
    const still = this.clockCut ? STILL_T : t;
    this.leaf.time.value = still;
    this.steam.time.value = still;
    this.facade.time.value = t;
    this.haze.hzTime.value = t;
    this.clock = t;
    const key = Math.round(hour * 30);
    if (key === this.key) return;
    this.key = key;
    this.envDirty = true;
    const s = skyAt(hour), day = daylight(hour), night = 1 - day, sd = sunOutside(hour), lift = 1 + 0.1 * day, dusk = duskShare(hour), duskK = duskLight(hour);
    const dark = smooth(0.6, 1, night), gone = Math.min(1, Math.max(0, 1.25 - day * 1.6));
    // the room's table warms its horizon for hours round the warm hour; out here the bands see to that, and until they come the air stays clear
    const clear = smooth(6.4, 8, hour) * (1 - smooth(17.6, 19, hour));
    const top = new Color(s.top).multiplyScalar(lift).lerp(NIGHT_TOP, dark), hor = new Color(s.hor).lerp(HOR_CLEAR, clear * 0.9).multiplyScalar(lift).lerp(NIGHT_HOR, dark);
    u.top.value.copy(top);
    u.hor.value.copy(hor);
    u.sunDir.value.set(sd[0], sd[1], sd[2]);
    u.moonDir.value.copy(moonDir(hour));
    u.night.value = night;
    u.dusk.value = dusk;
    u.duskK.value = duskK;
    // the sun's light: white overhead, a burning orange low down; gone under the horizon
    const low = 1 - smooth(0.1, 0.75, sd[1]), up = smooth(-0.03, 0.12, sd[1]);
    const sunCol = new Color(0xfff4e2).lerp(SUN_LOW, low * 0.85);
    u.sunCol.value.copy(sunCol).multiplyScalar(day);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 5.6 * day * up;
    this.sun.position.set(sd[0], sd[1], sd[2]).multiplyScalar(1600).add(SHADOW_AT);
    // what the sun's side of the city throws back on the walls in its shade: the window sees those all the late afternoon, so more, and warm
    const late = smooth(14.5, 16.5, hour) * (1 - smooth(18.5, 20, hour));
    this.bounce.color.set(0xfff1e2).lerp(BOUNCE_LATE, late);
    this.bounce.intensity = (0.55 + 0.85 * late) * day * up;
    this.moon.intensity = MOON * night;
    this.scene.environmentIntensity = 1;
    // the haze: the horizon's colour by day (at the warm hour the sky's own low down, the view's way), the sun's light in it toward the sun, the
    // city's glow at night, the low mist lit by the streets as the lamps come on
    const side = 0.5 - 0.5 * sd[2] / Math.max(Math.hypot(sd[0], sd[2]), 1e-3);
    const hz = this.haze, warm = new Color().copy(EARTH_SHADOW).lerp(DUSK_ROSE, side * side).multiplyScalar(duskK * DUSK_HAZE);
    u.glow.value.copy(CITY_GLOW).multiplyScalar(night);
    hz.hzCol.value.copy(hor).multiplyScalar(0.95).lerp(warm, dusk).add(u.glow.value);
    hz.hzSun.value.copy(sunCol).multiplyScalar(0.45 * day * up);
    hz.hzDir.value.set(sd[0], sd[1], sd[2]);
    hz.hzDensity.value = HAZE_DAY + (HAZE_NIGHT - HAZE_DAY) * night;
    const mist = smooth(0.35, 1, gone);
    hz.hzMist.value.copy(MIST);
    hz.hzMistD.value = MIST_DENSITY * mist;
    u.mist.value.copy(MIST).multiplyScalar(mist);
    u.ground.value.copy(hor).lerp(new Color(0x4a5242), 0.55).multiplyScalar(0.45).lerp(hz.hzCol.value, dusk);
    this.leaf.glow.value.copy(sunCol).multiplyScalar(this.sun.intensity * 0.22);
    // the lamps, the cars' lights and the windows come on as the sky darkens; the room shows in the glass only once the daylight has gone
    const lights = this.off.has('lights') ? 0 : lightsAt(hour);
    for (const l of this.lamps) l.intensity = 70 * lights;
    if (this.lowLamps) this.lowLamps.k.value = 70 * lights;
    for (const n of this.kit.night) n.mat.emissiveIntensity = n.k * lights;
    this.facade.night.value = lights;
    this.facade.sun.value.set(sd[0], sd[1], sd[2]);
    this.facade.sunCol.value.copy(sunCol).multiplyScalar(day * up);
    this.facade.hor.value.copy(hor).lerp(hz.hzCol.value, dusk);
    // the roofs' steam: the haze's colour with the sun on it, at night the mist's, warm low down from the streets
    this.steam.stCol.value.copy(hz.hzCol.value).multiplyScalar(1.2).add(new Color().copy(sunCol).multiplyScalar(0.3 * day * up)).lerp(new Color().copy(MIST).multiplyScalar(1.5), lights);
    this.steam.stLow.value.copy(this.steam.stCol.value).multiplyScalar(0.72).lerp(STEAM_LOW, lights);
    this.leaf.night.value = lights;
    this.carLight.night.value = lights;
    this.lampLight.lampNight.value = lights;
    this.quad.uniforms.glowK!.value = this.off.has('glow') ? 0 : GLOW * lights * lights;
    this.mirrorAt = this.off.has('mirror') ? 0 : MIRROR * smooth(MIRROR_FROM, 1, gone);
    this.sunMap.frame(hour);
  }

  /**
   * Draw the view for `camera` (the room's, this frame) into the window's picture: the camera moved outside, cropped to the window's box on
   * screen, and the room in the glass as the light goes. Call it before the frame's own draw. `room`: the scene the window stands in; `samples`:
   * the multisampling of the frame's scene target.
   */
  draw(renderer: WebGLRenderer, room: Scene, camera: PerspectiveCamera, samples: number): void {
    if (!outsideDraws(!!this.mesh.parent, this.mesh.visible)) { this.live = null; this.age = 0; return; }
    camera.updateMatrixWorld();
    this.mesh.updateWorldMatrix(true, false);
    const size = renderer.getDrawingBufferSize(new Vector2()), fw = size.x, fh = size.y;
    this.eyeNow.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frame = `${fw}x${fh}x${samples}`, moved = frame !== this.eyeFrame || !nearly(this.eyeNow, this.eye);
    if (moved) { this.eye.copy(this.eyeNow); this.eyeFrame = frame; }
    if (this.sightCanvas !== renderer.domElement) {
      // a lost context takes the query with it (see `Sight.lose`)
      const el = this.sightCanvas = renderer.domElement;
      el.addEventListener('webglcontextlost', () => this.sight.lose());
      el.addEventListener('webglcontextrestored', () => this.sight.restore());
    }
    this.sight.frame(renderer.getContext() as QueryGL, moved);
    // the eye sees no window, and has not moved: the picture stands as it is, ready when something moves off the window
    if (this.sight.hidden && this.live === camera) { this.age = 0; return; }
    const shown = this.live === camera;
    this.live = null;
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
    if (rr - rx < 1 || rb - ry < 1) { this.age = 0; return; }
    // the eye has held (nearly) still since the picture was drawn: it stands for a few ticks (`EVERY`, counted by `frame`)
    const b = this.box, drift = behind ? (moved ? Infinity : 0) : Math.max(Math.abs(x0 - b.x) * fw, Math.abs(x1 - b.z) * fw, Math.abs(y0 - b.y) * fh, Math.abs(y1 - b.w) * fh) / 2;
    if (shown && frame === this.boxFrame && drift < HOLD_PX && this.age < this.every) { this.live = camera; return; }
    this.age = 0;
    b.set(x0, y0, x1, y1);
    this.boxFrame = frame;
    // the picture's target, supersampled (then at most 2 samples each; City 1x draws it at 1 pixel, the same samples): within one scale it only
    // grows, so a flight does not make a new one each frame; a change of scale (the `flat` toggle) takes the size it needs, and frees the old
    const ss = samples > 0 && !this.off.has('flat') ? SUPER : 1, ms = Math.min(samples, 2), rw = (rr - rx) * ss, rh = (rb - ry) * ss;
    let t = this.target;
    if (!t || this.targetSS !== ss || t.width < rw || t.height < rh || t.samples !== ms) {
      const same = !!t && this.targetSS === ss;
      const w = same ? Math.max(rw, t!.width) : rw, h = same ? Math.max(rh, t!.height) : rh;
      t?.dispose();
      t = this.target = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: ms });
      this.targetSS = ss;
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
    this.facade.pixel.value = (2 * Math.tan((c.fov * Math.PI) / 360)) / c.zoom / (fh * ss);
    this.dome.position.copy(c.position);
    // the traffic on to the frame's clock, each car placed for this eye, the signals lit
    const dt = this.ran < 0 ? 0.1 : this.clock - this.ran;
    this.ran = this.clock;
    // (only what the camera sees, cut again once it has moved; all of it when the sun's shadows are drawn this frame: what is out of sight
    // casts them too. A sun at 0 draws none: its map waits for its first lit frame, `sunmap.ts`)
    const shadowNow = this.sunMap.due(this.sun.castShadow, this.sun.intensity);
    this.seen.setFromProjectionMatrix(this.seenOf.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
    const seen = shadowNow ? undefined : this.seen;
    if (shadowNow || this.cutAll || !nearly(this.seenOf, this.cutOf)) {
      for (const s of this.sweeps) s.cut(seen);
      this.fleet.park(seen, c.position.x, c.position.z);
      this.cutOf.copy(this.seenOf);
      this.cutAll = shadowNow;
    }
    // (the moving cars always for the eye alone: they cast no shadows in the sun's map)
    this.fleet.update(Math.max(0, dt), c.position.x, c.position.z, this.seen);
    this.signals.update(this.traffic.t);
    // the leaves' light from behind, in the camera's frame
    const sd = sunOutside(this.key / 30);
    this.leaf.sunView.value.set(sd[0], sd[1], sd[2]).transformDirection(c.matrixWorldInverse);
    if (this.envDirty) {
      this.envDirty = false;
      this.envCam.update(renderer, this.envScene);
      // (the filtered copy reuses its target: `fromCubemap` fills `envMap` in place)
      this.pmrem ??= new PMREMGenerator(renderer);
      this.envMap = this.pmrem.fromCubemap(this.env.texture, this.envMap);
      this.scene.environment = this.envMap.texture;
    }
    const was = renderer.getRenderTarget();
    this.sun.shadow.autoUpdate = shadowNow;
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
    // the room in the glass (it does not see the window's own quad, whose back is to it); the eye still, only each few frames: it is a faint ghost
    const qu = this.quad.uniforms;
    if (this.mirrorAt <= 0) this.mirrorShown = false;
    else if (moved || !this.mirrorShown || ++this.mirrorAge >= MIRROR_EVERY) {
      this.mirrorAge = 0;
      const n = (qu.glassN!.value as Vector3).set(0, 0, 1).transformDirection(this.mesh.matrixWorld);
      // the window itself out of that picture: it samples the picture, and the glass does not mirror what lies past it
      this.mesh.visible = false;
      this.mirrorShown = this.mirror.draw(renderer, room, camera, this.mesh.getWorldPosition(v), n, fw, fh);
      this.mesh.visible = true;
      if (this.mirrorShown) {
        qu.tMirror!.value = this.mirror.target!.texture;
        (qu.mirrorOf!.value as Matrix4).copy(this.mirror.uvOf);
        (qu.mirrorPx!.value as Vector2).set(1 / this.mirror.target!.width, 1 / this.mirror.target!.height);
      }
    }
    qu.mirrorK!.value = this.mirrorShown ? this.mirrorAt : 0;
    renderer.setRenderTarget(was);
    this.sun.shadow.autoUpdate = false;
    if (shadowNow) this.sunMap.drawn();
    this.quad.uniforms.off!.value.set(rx, fh - rb);
    this.quad.uniforms.ss!.value = ss;
    this.quad.uniforms.inv!.value.set(1 / t.width, 1 / t.height);
    this.live = camera;
  }

  /** Starts linking the programs the view draws with (`compile.ts`): its city's and its sky's, and with the `room` it stands in, its glass's. */
  startPrograms(r: WebGLRenderer, room?: Scene): Program[] {
    return [...startPrograms(r, this.scene, this.cam), ...startPrograms(r, this.envScene, this.cam), ...(room ? this.mirror.startPrograms(r, room) : [])];
  }

  dispose(): void {
    this.target?.dispose();
    this.envMap?.dispose();
    this.pmrem?.dispose();
    this.env.dispose();
    this.sun.shadow.map?.dispose();
    this.fleet.dispose();
    this.glow.dispose();
    this.mirror.dispose();
    this.signals.mesh.dispose();
    (this.signals.mesh.material as Material).dispose();
    for (const s of [this.scene, this.envScene]) s.traverse((o) => { if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose(); });
    this.mesh.geometry.dispose();
    this.sky.dispose();
    for (const m of this.disposables) m.dispose();
    disposeKit(this.kit);
    this.quad.dispose();
  }
}
