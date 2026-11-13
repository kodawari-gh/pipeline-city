// The cars (`traffic.ts` moves them, `plan.ts` parks the rest): a hatchback, a saloon and an estate, each a body extruded from its side
// profile with rounded edges and its wheel arches cut, a glasshouse set in from the body's sides under a roof in the paint, a pillar, mirrors,
// wheels with rims, lamps, a grille and plates; far off, a box with its lamps. A model is one geometry whose vertices know their part, all on
// one material (`carMaterial`) that paints each part (the paint is the car's own colour) and lights the lamps: a moving car's head and tail
// lamps at night, its brake lights. The cars are instanced, a draw per model. Under each car its soft shadow; at night the pool of a moving
// car's head lamps on the road ahead, the red of its tail lamps behind. In a car's frame x runs along it (its front at +x), y up, z across.
import {
  AdditiveBlending, BoxGeometry, Color, CylinderGeometry, DoubleSide, DynamicDrawUsage, ExtrudeGeometry, Float32BufferAttribute, Group, InstancedBufferAttribute,
  InstancedMesh, MeshPhysicalMaterial, ShaderMaterial, Shape, Sphere, Vector2, Vector3, type BufferAttribute, type BufferGeometry, type Frustum, type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HAZE_FN, withHaze, type HazeUniforms } from './haze';
import { CAR_COLOURS, GRID, heading, rng, type Car } from './plan';
import { MODELS, type Route, type Traffic } from './traffic';

/** A wheel's radius and its arch's, the sill's height (m). */
const WHEEL = 0.32, ARCH = 0.39, SILL = 0.2;
/** Within this distance of the eye (m) a car is its full model; further off, the box. */
const NEAR = 260;
/** At Low (the capped fleet), the same, the full model's range (m): further off, the box. */
const NEAR_LOW = 100;
/** At Low, a car further than this from the eye (m) is not drawn at all, neither its full model nor its box: the far grid goes, the near avenue stays. */
const CLIP_LOW = 350;
/** A ball round a car (m: its radius; its middle at half that height), for the eye's frustum. */
const CAR_R = 3;
/**
 * Balls on the road under a car's middle (m: their radii): one round its soft shadow and its body, one round its lamps' pools too (they
 * reach 17 m ahead). A moving car is placed only where its ball meets the eye's frustum.
 */
const SHADE_R = CAR_R * 1.5, POOL_R = 17.5;
/** The parked cars are cut by cells of the ground this size (m): a cell out of the frustum skips its cars, one wholly in it takes them all. */
const PARK_CELL = 48;

/** Where a ball stands to a frustum: -1 out of it, else the planes it crosses (a bit each, so 0 when it is wholly in it). */
export function within(f: Frustum, b: Sphere): number {
  let cut = 0;
  for (let i = 0; i < 6; i++) {
    const d = f.planes[i]!.distanceToPoint(b.center);
    if (d < -b.radius) return -1;
    if (d < b.radius) cut |= 1 << i;
  }
  return cut;
}

/**
 * The stretch of a route where a ball of radius `r`, its middle `y` over the road at a car's middle, meets the frustum (each plane, as
 * `Frustum.intersectsSphere`): the cars' middles from `out[0]` to `out[1]` m along it (none when `out[0] > out[1]`); all of it with no `seen`.
 */
export function reach(rt: Route, seen: Frustum | undefined, y: number, r: number, out: number[]): void {
  let lo = -Infinity, hi = Infinity;
  if (seen) for (const p of seen.planes) {
    const n = p.normal, a = n.x * rt.dx + n.z * rt.dz, b = n.x * rt.x + n.y * y + n.z * rt.z + p.constant + r;
    if (a > 0) lo = Math.max(lo, -b / a);
    else if (a < 0) hi = Math.min(hi, -b / a);
    else if (b < 0) { lo = Infinity; hi = -Infinity; }
  }
  out[0] = lo; out[1] = hi;
}
const AROUND = [0, 0], BODY = [0, 0];

/** Upload instances `from` to `from + n` of an attribute, what was written this draw (none: nothing to send). */
function upload(a: BufferAttribute, from: number, n: number): void {
  if (n <= 0) return;
  a.clearUpdateRanges();
  a.addUpdateRange(from * a.itemSize, n * a.itemSize);
  a.needsUpdate = true;
}

const enum Part { Paint = 0, Glass = 1, Tyre = 2, Rim = 3, Head = 4, Tail = 5, Plate = 6, Trim = 7 }

/** A shape of (x, y) points, extruded `w` wide across z about the middle, its edges rounded by `round`. */
function extrude(pts: readonly (readonly [number, number])[], w: number, round: number): BufferGeometry {
  const g = new ExtrudeGeometry(new Shape(pts.map(([x, y]) => new Vector2(x, y))), {
    depth: w - 2 * round, bevelEnabled: true, bevelThickness: round, bevelSize: round, bevelOffset: -round, bevelSegments: 3, curveSegments: 4,
  });
  return g.translate(0, 0, -(w - 2 * round) / 2);
}
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BufferGeometry =>
  new BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

/** The arc over a wheel at x, from its back to its front (the body's lower edge runs that way). */
function arch(x: number): [number, number][] {
  const out: [number, number][] = [[x - ARCH, SILL]];
  for (let i = 0; i <= 8; i++) { const a = Math.PI - (i / 8) * Math.PI; out.push([x + Math.cos(a) * ARCH, WHEEL + Math.sin(a) * ARCH]); }
  out.push([x + ARCH, SILL]);
  return out;
}

/** Pieces into one geometry, each vertex's part in `part`. */
function merge(pieces: [BufferGeometry, Part][]): BufferGeometry {
  return mergeGeometries(pieces.map(([g, p]) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    n.clearGroups();
    return n.setAttribute('part', new Float32BufferAttribute(new Float32Array(n.attributes.position!.count).fill(p), 1));
  }))!;
}

/** A model's geometry (`MODELS`), in its frame, on the road at y = 0. */
export function carGeometry(model: number): BufferGeometry {
  const { tail, len: L } = MODELS[model]!, W = 1.78, H = tail === 'estate' ? 1.5 : tail === 'hatch' ? 1.47 : 1.43, out: [BufferGeometry, Part][] = [];
  const half = L / 2, belt = 0.94, hood = tail === 'hatch' ? 0.98 : 1.12, xf = half - 0.86, xr = -half + (tail === 'estate' ? 0.92 : 0.8);
  // the body to the belt line: the nose, the bonnet, the boot (a saloon's deck stands a little higher), the tail, the sills over the wheels
  const deck: [number, number][] = tail === 'boot' ? [[-half + 1.0, belt + 0.03], [-half + 0.16, belt + 0.01]] : [[-half + 0.2, belt]];
  out.push([extrude([
    [half - 0.2, SILL], [half - 0.02, 0.3], [half, 0.5], [half - 0.07, 0.68], [half - 0.45, 0.8], [half - hood, belt + 0.02], ...deck,
    [-half + 0.03, belt - 0.12], [-half, 0.5], [-half + 0.05, 0.3], [-half + 0.22, SILL], ...arch(xr), ...arch(xf),
  ], W, 0.06), Part.Paint]);
  // the glasshouse, set in from the sides: the windscreen, the roof's line, the rear screen or the tailgate
  const fx = half - hood + 0.04, rf = fx - (tail === 'hatch' ? 0.72 : 0.8), rb = tail === 'boot' ? -half + 1.32 : tail === 'estate' ? -half + 0.24 : -half + 0.5;
  const back: [number, number][] = tail === 'boot' ? [[-half + 1.02, belt + 0.03]] : [[-half + (tail === 'estate' ? 0.07 : 0.12), belt + 0.08]];
  const Wc = W - 0.24;
  out.push([extrude([[fx, belt], [rf, H - 0.04], [rb, H - 0.05], ...back, [fx - 0.2, belt]], Wc, 0.05), Part.Glass]);
  // the roof in the paint over the glass, the pillar between the doors, the mirrors
  out.push([box(rf - 0.1, H - 0.07, -Wc / 2 - 0.02, rb + 0.06, H + 0.005, Wc / 2 + 0.02), Part.Paint]);
  const bx = (rf + rb) / 2 + 0.12;
  out.push([box(bx - 0.06, belt, -Wc / 2 - 0.012, bx + 0.06, H - 0.06, Wc / 2 + 0.012), Part.Trim]);
  for (const s of [-1, 1]) out.push([box(fx - 0.2, belt + 0.06, s * (W / 2 - 0.02), fx - 0.06, belt + 0.17, s * (W / 2 + 0.13)), Part.Paint]);
  // the wheels: a tyre and its rim at each corner
  for (const x of [xf, xr]) for (const s of [-1, 1]) {
    out.push([new CylinderGeometry(WHEEL, WHEEL, 0.21, 18).rotateX(Math.PI / 2).translate(x, WHEEL, s * (W / 2 - 0.15)), Part.Tyre]);
    out.push([new CylinderGeometry(0.2, 0.2, 0.216, 12).rotateX(Math.PI / 2).translate(x, WHEEL, s * (W / 2 - 0.15)), Part.Rim]);
  }
  // the front's lamps, grille and plate; the tail's lamps and plate
  for (const s of [-1, 1]) {
    out.push([box(half - 0.14, 0.58, s * (W / 2 - 0.44), half - 0.02, 0.68, s * (W / 2 - 0.1)), Part.Head]);
    out.push([box(-half - 0.004, 0.74, s * (W / 2 - 0.4), -half + 0.1, 0.87, s * (W / 2 - 0.09)), Part.Tail]);
  }
  out.push([box(half - 0.06, 0.4, -0.42, half + 0.006, 0.56, 0.42), Part.Trim], [box(half - 0.01, 0.29, -0.26, half + 0.014, 0.4, 0.26), Part.Plate]);
  out.push([box(-half - 0.012, 0.46, -0.26, -half + 0.03, 0.57, 0.26), Part.Plate]);
  return merge(out);
}

/** The far model: the body and the glasshouse as boxes, the lamps as plates on its ends (a car of 4.5 m). */
function farGeometry(): BufferGeometry {
  const h = 2.25, W = 1.78;
  const out: [BufferGeometry, Part][] = [[box(-h, 0.2, -W / 2, h, 0.92, W / 2), Part.Paint], [box(-h + 0.6, 0.92, -W / 2 + 0.1, h - 1.1, 1.42, W / 2 - 0.1), Part.Glass]];
  for (const s of [-1, 1]) out.push([box(h, 0.56, s * 0.85 - 0.18, h + 0.02, 0.7, s * 0.85 + 0.18), Part.Head], [box(-h - 0.02, 0.72, s * 0.8 - 0.2, -h, 0.86, s * 0.8 + 0.2), Part.Tail]);
  return merge(out);
}

/** The cars' light by the hour: 0 by day, 1 at full night. */
export interface CarLight { night: { value: number } }

/** The cars' one material: each part painted by its vertices' `part`, the paint from the instance's colour, the lamps lit by its `lit` (head lamps, brake). */
export function carMaterial(u: CarLight): MeshPhysicalMaterial {
  const mat = new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.cNight = u.night;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float part;\nattribute vec2 lit;\nvarying float vPart;\nvarying vec2 vLit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = part; vLit = lit;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float cNight;\nvarying float vPart;\nvarying vec2 vLit;')
      .replace('#include <color_fragment>', `
int cp = int(vPart + 0.5);
float cR = 0.5, cM = 0.0, cCoat = 0.0;
vec3 cGlow = vec3(0.0);
if (cp == 0) { diffuseColor.rgb = vColor.rgb; cR = 0.36; cM = 0.45; cCoat = 1.0; }
else if (cp == 1) { diffuseColor.rgb = vec3(0.01, 0.012, 0.016); cR = 0.05; cM = 0.6; }
else if (cp == 2) { diffuseColor.rgb = vec3(0.018); cR = 0.92; }
else if (cp == 3) { diffuseColor.rgb = vec3(0.55, 0.56, 0.58); cR = 0.3; cM = 0.9; }
else if (cp == 4) { diffuseColor.rgb = vec3(0.8, 0.82, 0.85); cR = 0.1; cM = 0.3; cGlow = vec3(1.0, 0.95, 0.86) * vLit.x * (0.5 + cNight * 16.0); }
else if (cp == 5) { diffuseColor.rgb = vec3(0.3, 0.02, 0.02); cR = 0.25; cGlow = vec3(1.0, 0.05, 0.02) * (vLit.x * cNight * 3.5 + vLit.y * (1.5 + cNight * 7.0)); }
else if (cp == 6) { diffuseColor.rgb = vec3(0.85); cR = 0.5; }
else { diffuseColor.rgb = vec3(0.015); cR = 0.6; }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = cR;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = cM;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= cCoat;\n#endif')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += cGlow;');
  };
  mat.customProgramCacheKey = () => 'outside-car';
  return mat;
}

/** The lights on the road: ahead of a car the pool of its head lamps, behind it the red of its tail lamps, dimmed by the haze. */
const POOL_VERT = /* glsl */`
attribute float kind;
attribute vec2 lit;
varying vec2 vUv;
varying float vKind;
varying vec2 vLit;
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz; vUv = uv; vKind = kind; vLit = lit;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const POOL_FRAG = /* glsl */`
uniform float night;
varying vec2 vUv;
varying float vKind;
varying vec2 vLit;
varying vec3 vW;
${HAZE_FN}
void main() {
  float a, across = abs(vUv.y - 0.5) * 2.0, t = clamp(vUv.x, 0.0, 1.0), r = 1.0 - t;
  vec3 c;
  if (vKind < 0.5) {
    // the beam widens from the lamps and fades ahead; brightest a few metres out, where it meets the road, soft at every edge
    float spread = mix(0.35, 1.0, t), q = (t - 0.2) / mix(0.12, 0.45, step(0.2, t));
    a = exp(-across * across / (spread * spread) * 3.0) * exp(-q * q) * r;
    c = vec3(1.0, 0.9, 0.76) * 0.22 * vLit.x;
  } else {
    a = exp(-across * across * 3.0) * r * r * r;
    c = vec3(1.0, 0.06, 0.02) * (0.2 * vLit.x + 0.5 * vLit.y);
  }
  gl_FragColor = vec4(c * a * night * (1.0 - hzFog(vW)), 1.0);
}`;

/** The pools' geometry in a car's frame (a car of 4.5 m): the head lamps' cone ahead, the tail lamps' glow behind, a little over the road. */
function poolGeometry(): BufferGeometry {
  const quad = (x0: number, x1: number, w: number, kind: number): BufferGeometry => {
    const pos = [x0, 0, -w, x1, 0, -w, x1, 0, w, x0, 0, -w, x1, 0, w, x0, 0, w].map((v, i) => (i % 3 === 1 ? 0.04 : v));
    const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
    const g = new BoxGeometry().toNonIndexed();
    for (const n of Object.keys(g.attributes)) g.deleteAttribute(n);
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new Float32BufferAttribute(new Array(18).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    return g.setAttribute('kind', new Float32BufferAttribute(new Array(6).fill(kind), 1));
  };
  return mergeGeometries([quad(2.0, 17, 2.6, 0), quad(-2.2, -5.2, 1.3, 1)])!;
}

/** The soft shadow under a car: dark under its middle, fading out past its sides. */
const SHADE_FRAG = /* glsl */`
varying vec2 vUv;
varying vec3 vW;
${HAZE_FN}
void main() {
  vec2 d = abs(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.55, 1.0, d.x)) * (1.0 - smoothstep(0.45, 1.0, d.y)) * 0.6;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * (1.0 - hzFog(vW)));
}`;
const SHADE_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz; vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

function shadeGeometry(): BufferGeometry {
  const g = new BoxGeometry(1, 1, 1).toNonIndexed();
  for (const n of Object.keys(g.attributes)) g.deleteAttribute(n);
  const x = 2.9, z = 1.25, y = 0.03;
  g.setAttribute('position', new Float32BufferAttribute([-x, y, -z, x, y, -z, x, y, z, -x, y, -z, x, y, z, -x, y, z], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
  return g;
}

/** An instanced mesh of up to `n` on a geometry of its own (its attributes shared), with its per-car paint and lamps; placed each draw (`Fleet.update`). */
function fleetMesh(g: BufferGeometry, m: Material, n: number): InstancedMesh {
  const geo = g.clone();
  const lit = new InstancedBufferAttribute(new Float32Array(n * 2), 2);
  lit.setUsage(DynamicDrawUsage);
  geo.setAttribute('lit', lit);
  const im = new InstancedMesh(geo, m, n);
  im.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
  im.instanceMatrix.setUsage(DynamicDrawUsage);
  im.instanceColor.setUsage(DynamicDrawUsage);
  im.frustumCulled = false;
  im.count = 0;
  return im;
}

/** A car's matrix into an instance array: turned `rot` about y, at (x, 0, z). */
function place(a: Float32Array, i: number, x: number, z: number, rot: number): void {
  turned(a, i, x, z, Math.cos(rot), Math.sin(rot));
}
/** A car's matrix into an instance array: turned about y by the angle of cosine `c` and sine `s`, at (x, 0, z). */
function turned(a: Float32Array, i: number, x: number, z: number, c: number, s: number): void {
  const o = i * 16;
  a[o] = c; a[o + 1] = 0; a[o + 2] = -s; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = 0; a[o + 14] = z; a[o + 15] = 1;
}

const PAINT = CAR_COLOURS.map((c) => new Color(c));
/** An instance's paint into a colour array. */
function paint(a: Float32Array, k: number, colour: number): void {
  const c = PAINT[colour]!;
  a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b;
}

/** A cell of parked cars: its ball (round its cars' balls) and its run of them in the mesh's list. */
interface Cell { ball: Sphere; from: number; to: number }

/** Parked cars in cells of the ground (`PARK_CELL`): the list sorted cell by cell, each car's turn (its cosine and sine), and the cells. */
export function parkCells(cars: readonly Car[]): { cars: Car[]; turn: Float64Array; cells: Cell[] } {
  const by = new Map<string, Car[]>();
  for (const c of cars) {
    const key = `${Math.floor(c.x / PARK_CELL)},${Math.floor(c.z / PARK_CELL)}`;
    by.set(key, [...(by.get(key) ?? []), c]);
  }
  const out: Car[] = [], cells: Cell[] = [];
  for (const run of by.values()) {
    const mid = new Vector3(run.reduce((s, c) => s + c.x, 0) / run.length, CAR_R / 2, run.reduce((s, c) => s + c.z, 0) / run.length);
    const r = Math.max(...run.map((c) => Math.hypot(c.x - mid.x, c.z - mid.z))) + CAR_R;
    cells.push({ ball: new Sphere(mid, r), from: out.length, to: out.length + run.length });
    out.push(...run);
  }
  return { cars: out, turn: Float64Array.from(out.flatMap((c) => [Math.cos(c.rot), Math.sin(c.rot)])), cells };
}

/** Every car, only those the eye sees: the parked ones where they stand (`park`), the moving ones from the traffic at each draw (`update`). */
export class Fleet {
  readonly group = new Group();
  private mat: MeshPhysicalMaterial;
  private near: InstancedMesh[];
  private far: InstancedMesh;
  /** The moving cars' meshes: each model near, the box. */
  private moving: InstancedMesh[];
  private pools: InstancedMesh;
  private shades: InstancedMesh;
  private poolMat: ShaderMaterial;
  private shadeMat: ShaderMaterial;
  /** The parked cars, each model's mesh with its cars in cells (`parkCells`); their shadows lead the shadows' mesh. */
  private still: ({ im: InstancedMesh } & ReturnType<typeof parkCells>)[] = [];
  private parked: number;

  /** The share of the moving cars that drive (1: all), and how many models there are (fewer than `MODELS`: one mesh of them, the range `NEAR_LOW`). */
  private scale: number;
  private capped: boolean;
  /** Within this distance of the eye (m) a moving car is its full model; further off, the far box. */
  private range: number;
  /** Past this distance of the eye (m) a car is not drawn (`CLIP_LOW` at Low, none at High). */
  private clip: number;

  constructor(private traffic: Traffic, parked: readonly Car[], private light: CarLight, haze: HazeUniforms, scale = 1, models: number = MODELS.length) {
    this.scale = scale;
    this.capped = models < MODELS.length;
    this.range = this.capped ? NEAR_LOW : NEAR;
    this.clip = this.capped ? CLIP_LOW : Infinity;
    const mat = this.mat = carMaterial(light), n = traffic.cars.length, geos = MODELS.map((_, i) => carGeometry(i)).slice(0, models), box = farGeometry();
    withHaze(mat, haze);
    // the parked cars: each model's in one mesh, the box past `NEAR` of the window as for a moving car, their lamps dark, casting their shadows
    const byModel = geos.map(() => [] as Car[]), boxed: Car[] = [];
    for (const c of parked) (Math.hypot(c.x - GRID.av0, c.z) < NEAR && !this.capped ? byModel[Math.min(Math.floor(rng(c.seed)() * MODELS.length), models - 1)]! : boxed).push(c);
    [...byModel, boxed].forEach((all, k) => {
      if (!all.length) return;
      const im = fleetMesh(geos[k] ?? box, mat, all.length);
      im.castShadow = im.receiveShadow = true;
      this.still.push({ im, ...parkCells(all) });
      this.group.add(im);
    });
    this.park();
    // the moving ones: each model near, the box far off
    this.near = geos.map((g) => fleetMesh(g, mat, n));
    this.far = fleetMesh(box, mat, n);
    this.moving = [...this.near, this.far];
    for (const im of this.moving) { im.receiveShadow = true; this.group.add(im); }
    // their pools of light, and the shadows under every car
    this.poolMat = new ShaderMaterial({
      vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, uniforms: { night: light.night, ...haze },
      transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    });
    this.pools = fleetMesh(poolGeometry(), this.poolMat, n);
    this.pools.instanceColor = null;
    this.shadeMat = new ShaderMaterial({ vertexShader: SHADE_VERT, fragmentShader: SHADE_FRAG, uniforms: { ...haze }, transparent: true, depthWrite: false, side: DoubleSide });
    // (the parked cars' shadows first, where they stand; the moving ones' after them, each draw)
    this.parked = parked.length;
    this.shades = new InstancedMesh(shadeGeometry(), this.shadeMat, n + parked.length);
    this.shades.frustumCulled = false;
    const sa = this.shades.instanceMatrix.array as Float32Array;
    parked.forEach((c, i) => place(sa, i, c.x, c.z, c.rot));
    this.shades.count = parked.length;
    this.shades.instanceMatrix.setUsage(DynamicDrawUsage);
    this.pools.renderOrder = this.shades.renderOrder = 1;
    // (the capped fleet of Low has no pools of light and no soft shadows: two draws fewer)
    if (!this.capped) this.group.add(this.pools, this.shades);
  }

  /**
   * The parked cars in their meshes: those in `seen` (the eye's frustum), or all of them (for a frame that draws the sun's shadows, which they
   * cast). They do not move: call it when the eye's frustum or the eye (`ex`, `ez`) changes. A cell of them out of `seen` costs one test; in a
   * cell across its side, a car is tested on the planes the cell crosses (as `Frustum.intersectsSphere` on its ball). With the eye, a car past
   * `clip` of it is not placed (Low only).
   */
  park(seen?: Frustum, ex?: number, ez?: number): void {
    const clip2 = ex === undefined || ez === undefined ? Infinity : this.clip * this.clip;
    for (const { im, cars, turn, cells } of this.still) {
      const a = im.instanceMatrix.array as Float32Array, ca = im.instanceColor!.array as Float32Array;
      let k = 0;
      for (const { ball, from, to } of cells) {
        const cut = seen ? within(seen, ball) : 0;
        if (cut < 0) continue;
        next: for (let i = from; i < to; i++) {
          const c = cars[i]!;
          if ((c.x - (ex ?? 0)) ** 2 + (c.z - (ez ?? 0)) ** 2 > clip2) continue;
          if (cut) for (let q = 0; q < 6; q++) {
            if (!(cut & (1 << q))) continue;
            const p = seen!.planes[q]!, n = p.normal;
            if (n.x * c.x + n.y * (CAR_R / 2) + n.z * c.z + p.constant < -CAR_R) continue next;
          }
          turned(a, k, c.x, c.z, turn[i * 2]!, turn[i * 2 + 1]!);
          paint(ca, k++, c.colour);
        }
      }
      im.count = k;
      upload(im.instanceMatrix, 0, k);
      upload(im.instanceColor!, 0, k);
    }
  }

  /**
   * Move the traffic on by dt (s) and place each moving car the eye may see: its full model within `range` of the eye (x, z), else the box.
   * `seen`: the eye's frustum. Each route is cut to it first (`reach`), so a car out of it costs nothing: not drawn, nor its soft shadow, nor
   * (at night) its lamps' pools, which reach into the view from a little further (`POOL_R`). The lamps' pools are drawn only at night.
   */
  update(dt: number, ex: number, ez: number, seen?: Frustum): void {
    const tr = this.traffic, night = this.light.night.value > 0, P = this.parked;
    // (0.4 s at most a draw: after a pause the traffic does not run on for its whole length)
    tr.step(Math.min(dt, 0.4));
    for (const im of this.moving) im.count = 0;
    const pa = this.pools.instanceMatrix.array as Float32Array, pl = this.pools.geometry.attributes.lit!.array as Float32Array;
    const sa = this.shades.instanceMatrix.array as Float32Array;
    let n = 0, seenN = 0;
    const clip2 = this.clip * this.clip;
    for (let ri = 0; ri < tr.lanes.length; ri++) {
      const rt = tr.routes[ri]!, lane = tr.lanes[ri]!;
      reach(rt, seen, 0, night ? POOL_R : SHADE_R, AROUND);
      if (!lane.length || AROUND[0]! > AROUND[1]!) continue;
      reach(rt, seen, CAR_R / 2, CAR_R, BODY);
      const f = tr.phase(ri), rot = heading(rt.dx, rt.dz), cr = Math.cos(rot), sr = Math.sin(rot);
      // (the lane runs front first, so `was` and `s` fall: a car is drawn between the two, so the first that may be in the stretch is the
      // first whose step began short of its far end, and once a car's step ends short of its near end, so do those of all behind it)
      let k0 = 0;
      for (let hi = lane.length; k0 < hi;) { const mid = (k0 + hi) >> 1, c = lane[mid]!; if (c.was - c.len / 2 > AROUND[1]!) k0 = mid + 1; else hi = mid; }
      for (let q = k0; q < lane.length; q++) {
        const c = lane[q]!;
        if (c.s - c.len / 2 < AROUND[0]!) break;
        const m = tr.front(c, f) - c.len / 2;
        if (m < AROUND[0]! || m > AROUND[1]!) continue;
        // (a fleet of a share: every car that takes the running count over a whole number drives, so they are spread and ceil(n * scale) in all)
        if (this.scale < 1 && Math.ceil(++seenN * this.scale) === Math.ceil((seenN - 1) * this.scale)) continue;
        const x =rt.x + rt.dx * m, z = rt.z + rt.dz * m, brake = c.brake ? 1 : 0;
        // (past the clip: not drawn, and not counted, as if it were off the road; the drive count above is already set)
        if ((x - ex) ** 2 + (z - ez) ** 2 > clip2) continue;
        turned(sa, P + n, x, z, cr, sr);
        if (night) { turned(pa, n, x, z, cr, sr); pl[n * 2] = 1; pl[n * 2 + 1] = brake; }
        n++;
        if (m < BODY[0]! || m > BODY[1]!) continue;
        const ox = x - ex, oz = z - ez, im = ox * ox + oz * oz < this.range * this.range ? this.near[Math.min(c.model, this.near.length - 1)]! : this.far, k = im.count++;
        turned(im.instanceMatrix.array as Float32Array, k, x, z, cr, sr);
        paint(im.instanceColor!.array as Float32Array, k, c.colour);
        const la = im.geometry.attributes.lit!.array as Float32Array;
        la[k * 2] = 1; la[k * 2 + 1] = brake;
      }
    }
    for (const im of this.moving) {
      upload(im.instanceMatrix, 0, im.count);
      upload(im.instanceColor!, 0, im.count);
      upload(im.geometry.attributes.lit as BufferAttribute, 0, im.count);
    }
    this.pools.count = night ? n : 0;
    upload(this.pools.instanceMatrix, 0, this.pools.count);
    upload(this.pools.geometry.attributes.lit as BufferAttribute, 0, this.pools.count);
    this.shades.count = P + n;
    upload(this.shades.instanceMatrix, P, n);
  }

  dispose(): void {
    this.group.traverse((o) => { if ((o as InstancedMesh).isInstancedMesh) { (o as InstancedMesh).geometry.dispose(); (o as InstancedMesh).dispose(); } });
    if (this.capped) for (const im of [this.pools, this.shades]) { im.geometry.dispose(); im.dispose(); }
    this.mat.dispose(); this.poolMat.dispose(); this.shadeMat.dispose();
  }
}
