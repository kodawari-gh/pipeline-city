// The cars (`traffic.ts` moves them, `plan.ts` parks the rest): a hatchback, a saloon and an estate, each a body extruded from its side
// profile with rounded edges and its wheel arches cut, a glasshouse set in from the body's sides under a roof in the paint, a pillar, mirrors,
// wheels with rims, lamps, a grille and plates; far off, a box with its lamps. A model is one geometry whose vertices know their part, all on
// one material (`carMaterial`) that paints each part (the paint is the car's own colour) and lights the lamps: a moving car's head and tail
// lamps at night, its brake lights. The cars are instanced, a draw per model. Under each car its soft shadow; at night the pool of a moving
// car's head lamps on the road ahead, the red of its tail lamps behind. In a car's frame x runs along it (its front at +x), y up, z across.
import {
  AdditiveBlending, BoxGeometry, Color, CylinderGeometry, DoubleSide, DynamicDrawUsage, ExtrudeGeometry, Float32BufferAttribute, Group, InstancedBufferAttribute,
  InstancedMesh, MeshPhysicalMaterial, ShaderMaterial, Shape, Vector2, type BufferGeometry, type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HAZE_FN, withHaze, type HazeUniforms } from './haze';
import { CAR_COLOURS, rng, type Car } from './plan';
import { MODELS, type Traffic } from './traffic';

/** A wheel's radius and its arch's, the sill's height (m). */
const WHEEL = 0.32, ARCH = 0.39, SILL = 0.2;
/** Within this distance of the eye (m) a car is its full model; further off, the box. */
const NEAR = 260;

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

/** An instanced mesh of `n` on a geometry of its own (its attributes shared), with its per-car paint and lamps. */
function fleetMesh(g: BufferGeometry, m: Material, n: number, moving: boolean): InstancedMesh {
  const geo = g.clone();
  const lit = new InstancedBufferAttribute(new Float32Array(n * 2), 2);
  if (moving) lit.setUsage(DynamicDrawUsage);
  geo.setAttribute('lit', lit);
  const im = new InstancedMesh(geo, m, n);
  im.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
  if (moving) { im.instanceMatrix.setUsage(DynamicDrawUsage); im.instanceColor.setUsage(DynamicDrawUsage); }
  im.frustumCulled = false;
  im.count = moving ? 0 : n;
  return im;
}

/** A car's matrix into an instance array: turned `rot` about y, at (x, 0, z). */
function place(a: Float32Array, i: number, x: number, z: number, rot: number): void {
  const c = Math.cos(rot), s = Math.sin(rot), o = i * 16;
  a[o] = c; a[o + 1] = 0; a[o + 2] = -s; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = 0; a[o + 14] = z; a[o + 15] = 1;
}

const PAINT = CAR_COLOURS.map((c) => new Color(c));

/** Every car: the parked ones set once, the moving ones placed each frame from the traffic. */
export class Fleet {
  readonly group = new Group();
  private mat: MeshPhysicalMaterial;
  private near: InstancedMesh[];
  private far: InstancedMesh;
  private pools: InstancedMesh;
  private shades: InstancedMesh;
  private poolMat: ShaderMaterial;
  private shadeMat: ShaderMaterial;

  constructor(private traffic: Traffic, parked: readonly Car[], light: CarLight, haze: HazeUniforms) {
    const mat = this.mat = carMaterial(light), n = traffic.cars.length, geos = MODELS.map((_, i) => carGeometry(i));
    withHaze(mat, haze);
    // the parked cars: each model's in one mesh, their lamps dark, casting their shadows
    const byModel = MODELS.map(() => [] as Car[]);
    for (const c of parked) byModel[Math.floor(rng(c.seed)() * MODELS.length)]!.push(c);
    byModel.forEach((cs, k) => {
      if (!cs.length) return;
      const im = fleetMesh(geos[k]!, mat, cs.length, false), a = im.instanceMatrix.array as Float32Array;
      cs.forEach((c, i) => { place(a, i, c.x, c.z, c.rot); im.setColorAt(i, PAINT[c.colour]!); });
      im.castShadow = im.receiveShadow = true;
      this.group.add(im);
    });
    // the moving ones: each model near, the box far off
    this.near = geos.map((g) => fleetMesh(g, mat, n, true));
    this.far = fleetMesh(farGeometry(), mat, n, true);
    for (const im of [...this.near, this.far]) { im.receiveShadow = true; this.group.add(im); }
    // their pools of light, and the shadows under every car
    this.poolMat = new ShaderMaterial({
      vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, uniforms: { night: light.night, ...haze },
      transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    });
    this.pools = fleetMesh(poolGeometry(), this.poolMat, n, true);
    this.pools.instanceColor = null;
    this.shadeMat = new ShaderMaterial({ vertexShader: SHADE_VERT, fragmentShader: SHADE_FRAG, uniforms: { ...haze }, transparent: true, depthWrite: false, side: DoubleSide });
    this.shades = new InstancedMesh(shadeGeometry(), this.shadeMat, n + parked.length);
    this.shades.frustumCulled = false;
    const sa = this.shades.instanceMatrix.array as Float32Array;
    parked.forEach((c, i) => place(sa, n + i, c.x, c.z, c.rot));
    this.shades.instanceMatrix.setUsage(DynamicDrawUsage);
    this.pools.renderOrder = this.shades.renderOrder = 1;
    this.group.add(this.pools, this.shades);
  }

  /** Move the traffic on by dt (s) and place each moving car: its full model within `NEAR` of the eye (x, z), else the box. */
  update(dt: number, ex: number, ez: number): void {
    const tr = this.traffic;
    tr.step(Math.min(dt, 0.1));
    for (const im of [...this.near, this.far]) im.count = 0;
    const pa = this.pools.instanceMatrix.array as Float32Array, pl = this.pools.geometry.attributes.lit!.array as Float32Array;
    const sa = this.shades.instanceMatrix.array as Float32Array;
    tr.cars.forEach((c, i) => {
      const p = tr.pose(c), near = Math.hypot(p.x - ex, p.z - ez) < NEAR, im = near ? this.near[c.model]! : this.far, k = im.count++;
      place(im.instanceMatrix.array as Float32Array, k, p.x, p.z, p.rot);
      const col = PAINT[c.colour]!, ca = im.instanceColor!.array as Float32Array, la = im.geometry.attributes.lit!.array as Float32Array;
      ca[k * 3] = col.r; ca[k * 3 + 1] = col.g; ca[k * 3 + 2] = col.b;
      la[k * 2] = 1; la[k * 2 + 1] = c.brake ? 1 : 0;
      place(pa, i, p.x, p.z, p.rot);
      pl[i * 2] = 1; pl[i * 2 + 1] = c.brake ? 1 : 0;
      place(sa, i, p.x, p.z, p.rot);
    });
    this.pools.count = tr.cars.length;
    for (const im of [...this.near, this.far, this.pools]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.geometry.attributes.lit!.needsUpdate = true;
    }
    this.shades.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => { if ((o as InstancedMesh).isInstancedMesh) { (o as InstancedMesh).geometry.dispose(); (o as InstancedMesh).dispose(); } });
    this.mat.dispose(); this.poolMat.dispose(); this.shadeMat.dispose();
  }
}
