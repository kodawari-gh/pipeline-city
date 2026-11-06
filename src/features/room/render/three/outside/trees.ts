// The street's trees (`plan.ts` places them): planes along the avenues, limes along the streets, planes, limes and shrubs in the parks.
// A tree is its trunk and limbs, tapered tubes in bark, and its crown: a soft lump of leaves round each limb's end, near the window with sprays
// of smaller lumps on it, dark in the creases between them. The lumps take normals bent toward the crown's own, so a crown shades as one mass,
// darker inside and under. The shader (`leafShader`) breaks the mass up: clumps of leaves in their own greens, its outline bitten away leaf by
// leaf; the sun behind it shines through its edge, and the wind stirs them. All the trees are two meshes: the bark, the leaves.
import { BufferAttribute, BufferGeometry, Color, IcosahedronGeometry, Mesh, Vector3, type MeshStandardMaterial } from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { taperTube } from '@/core/render/three/loft';
import type { Kit } from './kit';
import { CURB, GRID, rng, type Tree, type TreeKind } from './plan';

type V3 = [number, number, number];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number): number => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** A direction picked evenly over the sphere. */
function anyDir(r: () => number): V3 {
  const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
  return [s * Math.cos(a), z, s * Math.sin(a)];
}

interface Habit {
  /** The clear trunk to where the limbs part and the crown's radius, as shares of the tree's height. */
  bole: number; spread: number;
  /** Main limbs, the trunk's radius per metre of height, a leader on up through the crown (else the limbs fork from the trunk's top). */
  limbs: number; girth: number; leader: boolean;
  /** The leaves' green (linear), and how uneven a lump's surface is (a share of its radius). */
  tint: V3; bumps: number;
}

const HABIT: Record<TreeKind, Habit> = {
  plane: { bole: 0.3, spread: 0.36, limbs: 5, girth: 0.021, leader: false, tint: [0.085, 0.13, 0.06], bumps: 0.07 },
  lime: { bole: 0.26, spread: 0.24, limbs: 6, girth: 0.019, leader: true, tint: [0.09, 0.145, 0.065], bumps: 0.06 },
  shrub: { bole: 0, spread: 0.62, limbs: 0, girth: 0, leader: false, tint: [0.06, 0.1, 0.05], bumps: 0.05 },
};

/** A unit ball whose vertices are shared, so its lumps shade smooth: finer near the window. */
const BALLS = [1, 2].map((d) => {
  const g = mergeVertices(new IcosahedronGeometry(1, d).deleteAttribute('normal').deleteAttribute('uv'));
  return { pos: g.attributes.position!.array as ArrayLike<number>, idx: g.index!.array as ArrayLike<number> };
});

/** How many sprays of leaves stand on each lump of a near crown. */
const SPRAYS = 4;

/**
 * How a tree is built at its distance from the window, so the triangles follow the pixels: `Sprayed` lumps with sprays and all its wood; `Round`
 * finer bare lumps; `Coarse` coarser ones, and of its wood only the trunk (the crown hides the limbs); `Sparse` also no lump on the small
 * branches, the limbs' lumps grown to fill for them.
 */
const enum Detail { Sprayed, Round, Coarse, Sparse }
const detailAt = (away: number): Detail => (away < 160 ? Detail.Sprayed : away < 250 ? Detail.Round : away < 500 ? Detail.Coarse : Detail.Sparse);
/** The grid's cell of the trees' meshes (m): what the window's box does not see is not drawn. */
const TREE_CELL = 200;

/** The leaf lumps of every crown in one geometry: places, normals (bent toward the crown's), a colour (its green, darker inside), the wind's swing and phase, the lump's own normal (for its outline). */
class Lumps {
  /** The vertices so far, and how many the arrays hold before they grow. */
  private n = 0; private room = 4096;
  private pos = new Float32Array(3 * this.room); private nor = new Float32Array(3 * this.room); private col = new Float32Array(3 * this.room);
  private wind = new Float32Array(2 * this.room); private lump = new Float32Array(3 * this.room);
  private idx: number[] = [];

  private grow(): void {
    const more = (a: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> => { const b = new Float32Array(2 * a.length); b.set(a); return b; };
    this.room *= 2;
    this.pos = more(this.pos); this.nor = more(this.nor); this.col = more(this.col); this.wind = more(this.wind); this.lump = more(this.lump);
  }

  /** A lump round `p`, `r` across, uneven by `bumps`: `shade` gives each vertex its normal and colour from its place and its own normal. */
  add(p: V3, r: number, bumps: number, fine: boolean, seed: number, shade: (q: V3, n: V3) => [V3, V3], swing: number, phase: number): void {
    const b = BALLS[fine ? 1 : 0]!, base = this.n, f = [5.1 + seed % 1.7, 4.3 + (seed * 7) % 1.9, 6.2 + (seed * 3) % 1.3];
    while (base + b.pos.length / 3 > this.room) this.grow();
    const { pos, nor, col, wind, lump } = this;
    for (let i = 0; i < b.pos.length; i += 3) {
      const d: V3 = [b.pos[i]!, b.pos[i + 1]!, b.pos[i + 2]!];
      const k = r * (1 + bumps * Math.sin(d[0] * f[0]! + seed) * Math.sin(d[1] * f[1]! + seed * 1.3) * Math.sin(d[2] * f[2]! + seed * 0.7) * 2.2);
      const q = add(p, d, k), [n, c] = shade(q, d), at = base + i / 3;
      pos[3 * at] = q[0]; pos[3 * at + 1] = q[1]; pos[3 * at + 2] = q[2];
      nor[3 * at] = n[0]; nor[3 * at + 1] = n[1]; nor[3 * at + 2] = n[2];
      col[3 * at] = c[0]; col[3 * at + 1] = c[1]; col[3 * at + 2] = c[2];
      wind[2 * at] = swing; wind[2 * at + 1] = phase;
      lump[3 * at] = d[0]; lump[3 * at + 1] = d[1]; lump[3 * at + 2] = d[2];
    }
    this.n += b.pos.length / 3;
    for (let i = 0; i < b.idx.length; i++) this.idx.push(base + b.idx[i]!);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry(), at = (a: Float32Array, k: number) => new BufferAttribute(a.slice(0, k * this.n), k);
    g.setAttribute('position', at(this.pos, 3));
    g.setAttribute('normal', at(this.nor, 3));
    g.setAttribute('color', at(this.col, 3));
    g.setAttribute('wind', at(this.wind, 2));
    g.setAttribute('lump', at(this.lump, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/** A limb (or a trunk): a tapered tube, its uvs in metres along it and round it, as the bark's repeat is. */
function limb(pts: V3[], r0: number, r1: number, sides: number, segs: number): BufferGeometry {
  const g = taperTube(pts, r0, r1, sides, segs), uv = g.attributes.uv!;
  let l = 0;
  for (let i = 1; i < pts.length; i++) { const a = pts[i]!, b = pts[i - 1]!; l += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
  const round = Math.PI * (r0 + r1);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * l, uv.getY(i) * round);
  return g;
}

/** A cluster of leaves: its middle and radius. */
interface Cluster { p: V3; r: number }

/**
 * A crown's lumps, one round each cluster. `o` and `rad`: the crown's ellipsoid, for the normals (its own outward normal there, bent toward
 * the lump's) and the shade (dark deep inside, darker under, a lump's underside darker still). A near tree's lumps carry sprays, smaller
 * lumps mostly on the side out of the crown, each dark where it meets its lump, so the mass has creases; a far tree's are bare (`Detail`).
 */
function crown(c: Lumps, cl: readonly Cluster[], o: V3, rad: V3, h: Habit, tint: V3, height: number, detail: Detail, r: () => number): void {
  for (const k of cl) {
    const phase = r() * 6.28, tone = 0.88 + r() * 0.24, hue = (r() - 0.5) * 0.16, seed = r() * 100;
    const shade = (p: V3, d: V3, crease = 1): [V3, V3] => {
      const q: V3 = [(p[0] - o[0]) / rad[0], (p[1] - o[1]) / rad[1], (p[2] - o[2]) / rad[2]], e = len(q);
      const nrm = unit(add(unit([q[0] / rad[0], q[1] / rad[1], q[2] / rad[2]]), d, 0.55));
      const ao = (0.35 + 0.65 * smooth(0.3, 1.0, e)) * (0.7 + 0.3 * clamp01(q[1] * 0.5 + 0.5)) * (0.8 + 0.2 * (d[1] * 0.5 + 0.5)) * tone * crease;
      return [nrm, [tint[0] * ao * (1 + hue), tint[1] * ao, tint[2] * ao * (1 - hue)]];
    };
    const swing = 0.02 + 0.05 * clamp01((k.p[1] - CURB) / height);
    if (detail !== Detail.Sprayed) { c.add(k.p, k.r * 1.02, h.bumps, detail === Detail.Round, seed, shade, swing, phase); continue; }
    c.add(k.p, k.r * 1.02, h.bumps, false, seed, (p, d) => shade(p, d, 0.72), swing, phase);
    const out = unit([(k.p[0] - o[0]) / rad[0], (k.p[1] - o[1]) / rad[1], (k.p[2] - o[2]) / rad[2]]);
    for (let i = 0; i < SPRAYS; i++) {
      const dir = unit(add(anyDir(r), out, 0.8)), sr = k.r * (0.34 + r() * 0.18), at = add(k.p, dir, k.r * 0.86), own = 0.9 + r() * 0.24;
      c.add(at, sr, h.bumps * 1.6, false, r() * 100, (p, d) => shade(p, d, own * (0.55 + 0.45 * smooth(0.92, 1.28, len([p[0] - k.p[0], p[1] - k.p[1], p[2] - k.p[2]]) / k.r))), swing * 1.2, phase + i * 1.3);
    }
  }
}

/** One tree: its bark into `bark`, its leaves into the lumps. */
function grow(t: Tree, cards: Lumps, bark: BufferGeometry[], detail: Detail): void {
  const h = HABIT[t.kind], r = rng(t.seed), H = t.h, R = H * h.spread, v = () => 0.94 + r() * 0.12, wood = detail < Detail.Coarse;
  const tint: V3 = [h.tint[0] * v(), h.tint[1] * v(), h.tint[2] * v()];
  if (t.kind === 'shrub') {
    // a bush: a few clusters round its middle, on the ground
    const o: V3 = [t.x, CURB + H * 0.48, t.z], rad: V3 = [R, H * 0.5, R], cl: Cluster[] = [];
    for (let i = 0; i < 4; i++) { const d = anyDir(r); cl.push({ p: add(o, [d[0] * R * 0.4, Math.abs(d[1]) * H * 0.15, d[2] * R * 0.4]), r: R * 0.62 }); }
    crown(cards, cl, o, rad, h, tint, H, detail, r);
    return;
  }
  const foot: V3 = [t.x, CURB - 0.05, t.z], bole = H * h.bole, r0 = 0.05 + H * h.girth;
  const top = add(foot, unit([(r() - 0.5) * 0.12, 1, (r() - 0.5) * 0.12]), bole + 0.05 * H);
  const lead = h.leader ? add(top, unit([(r() - 0.5) * 0.15, 1, (r() - 0.5) * 0.15]), (H - bole) * 0.82) : top;
  bark.push(!wood ? limb([foot, lerp(foot, top, 0.5), top], r0, r0 * 0.72, 6, 2) : h.leader ? limb([foot, lerp(foot, top, 0.5), top, lerp(top, lead, 0.5), lead], r0, 0.035, 10, 16) : limb([foot, lerp(foot, top, 0.5), top], r0, r0 * 0.72, 10, 8));
  // the crown's ellipsoid over the bole (a little larger than the limbs' reach, as the clusters stand out round their ends)
  const o: V3 = [top[0], CURB + bole + (H - bole) * 0.52, top[2]], rad: V3 = [R * 1.15, (H - bole) * 0.55, R * 1.15], cl: Cluster[] = [];
  for (let i = 0; i < h.limbs; i++) {
    const az = (i / h.limbs) * Math.PI * 2 + (r() - 0.5) * 0.9, out: V3 = [Math.cos(az), 0, Math.sin(az)];
    let from: V3, end: V3;
    if (h.leader) {
      // up the leader, each limb a little higher and shorter, reaching the crown's skin at its height
      from = lerp(top, lead, 0.08 + 0.72 * (i / h.limbs) + r() * 0.08);
      const y = (from[1] + 1 - o[1]) / rad[1], reach = R * Math.sqrt(Math.max(0.15, 1 - y * y)) * (0.75 + r() * 0.2);
      end = add(add(from, out, reach), [0, 0.6 + r() * 0.8, 0]);
    } else {
      // a plane forks at the bole into spreading limbs
      from = add(top, [0, -r() * 0.4, 0]);
      end = [o[0] + out[0] * R * (0.55 + r() * 0.3), o[1] + rad[1] * (-0.15 + r() * 0.7), o[2] + out[2] * R * (0.55 + r() * 0.3)];
    }
    const span = len([end[0] - from[0], end[1] - from[1], end[2] - from[2]]), mid = add(lerp(from, end, 0.45), [0, span * 0.14, 0]);
    if (wood) bark.push(limb([from, mid, end], r0 * (h.leader ? 0.38 : 0.55), 0.03, 6, 8));
    cl.push({ p: end, r: R * (detail === Detail.Sparse ? 0.52 : 0.42) });
    // its branches, off its outer half, each fanned a little from it and up
    for (let j = 0, m = 2 + (r() < 0.5 ? 1 : 0); j < m; j++) {
      const a = az + (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.5), f = 0.4 + r() * 0.45, s = f < 0.5 ? lerp(from, mid, f * 2) : lerp(mid, end, f * 2 - 1);
      const tip = add(add(s, [Math.cos(a), 0, Math.sin(a)], R * (0.3 + r() * 0.2)), [0, R * (0.12 + r() * 0.2), 0]);
      if (wood) bark.push(limb([s, lerp(s, tip, 0.5), tip], 0.05, 0.015, 5, 4));
      if (detail !== Detail.Sparse) cl.push({ p: tip, r: R * 0.36 });
    }
  }
  // the crown's top, and a fill in its middle so it is not seen through between the lumps
  cl.push({ p: h.leader ? lead : add(o, [0, rad[1] * 0.55, 0]), r: R * 0.48 }, { p: o, r: R * 0.6 });
  crown(cards, cl, o, rad, h, tint, H, detail, r);
}

/** The leaves' wind and their light: the clock (s), the sun's direction in the camera's frame, the sunlight they let through, the street's light at night (0 to 1). */
export interface LeafUniforms { time: { value: number }; sunView: { value: Vector3 }; glow: { value: Color }; night: { value: number } }

/**
 * The leaf material's own shading: the lumps keep the crown's bent normals (the normal map's chunk would take the face's), the wind sways
 * them (more toward the crown's top), and the sun behind them shines through: the side of a crown away from the sun glows green, the more
 * as the eye looks toward the sun; the sun's glint off the leaves is kept faint. Noise fixed to the tree makes its clumps of leaves: their
 * colour (the outer ones yellower, the deep ones bluer), a tilt of the normal, and bites out of a lump's outline, where it turns away from
 * the eye. Each scale fades to its average where a pixel covers it, so a far tree stays clean. At night the street's lamps light a crown from
 * under and the city's glow its top, so it stays a soft mass and not a black hole in the view.
 */
export function leafShader(m: MeshStandardMaterial): LeafUniforms {
  const u: LeafUniforms = { time: { value: 0 }, sunView: { value: new Vector3(0, 1, 0) }, glow: { value: new Color(0, 0, 0) }, night: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.leafTime = u.time;
    sh.uniforms.leafSun = u.sunView;
    sh.uniforms.leafGlow = u.glow;
    sh.uniforms.leafNight = u.night;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 wind;\nattribute vec3 lump;\nuniform float leafTime;\nvarying vec3 vLeafP;\nvarying vec3 vLeafN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLeafP = position;
        vLeafN = normalMatrix * lump;
        float sway = sin(leafTime * 1.3 + wind.y) * 0.7 + sin(leafTime * 3.1 + wind.y * 2.7) * 0.3;
        transformed += vec3(0.8, 0.2, 0.55) * sway * wind.x;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 leafSun;
uniform vec3 leafGlow;
uniform float leafNight;
varying vec3 vLeafP;
varying vec3 vLeafN;
float leafHash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float leafNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(leafHash(i), leafHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(leafHash(i + vec3(0.0, 1.0, 0.0)), leafHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(leafHash(i + vec3(0.0, 0.0, 1.0)), leafHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(leafHash(i + vec3(0.0, 1.0, 1.0)), leafHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float leafPx = length(fwidth(vLeafP));
        float leafA = 1.0 - smoothstep(0.3, 1.0, leafPx), leafB = 1.0 - smoothstep(0.07, 0.28, leafPx);
        vec3 leafQ1 = vLeafP * 1.1, leafQ2 = vLeafP * 3.7 + 11.0;
        float leafN1 = leafNoise(leafQ1), leafN2 = leafNoise(leafQ2), leafN3 = leafNoise(vLeafP * 11.0 + 5.0);
        float leafV = mix(0.5, leafN1, leafA) * 0.45 + mix(0.5, leafN2, leafA) * 0.35 + mix(0.5, leafN3, leafB) * 0.2;
        diffuseColor.rgb *= mix(vec3(0.6, 0.66, 0.78), vec3(1.42, 1.32, 1.0), smoothstep(0.3, 0.7, leafV));
        if ((leafN2 * 0.6 + leafN3 * 0.4) < smoothstep(0.42, 0.95, 1.0 - abs(dot(normalize(vLeafN), normalize(vViewPosition)))) * 0.8 * leafA) discard;`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(vNormal);
        nonPerturbedNormal = normal;
        if (leafA > 0.001) {
          vec3 leafG = vec3(leafNoise(leafQ1 + vec3(0.25, 0.0, 0.0)) - leafN1, leafNoise(leafQ1 + vec3(0.0, 0.25, 0.0)) - leafN1, leafNoise(leafQ1 + vec3(0.0, 0.0, 0.25)) - leafN1)
            + vec3(leafNoise(leafQ2 + vec3(0.25, 0.0, 0.0)) - leafN2, leafNoise(leafQ2 + vec3(0.0, 0.25, 0.0)) - leafN2, leafNoise(leafQ2 + vec3(0.0, 0.0, 0.25)) - leafN2);
          normal = normalize(normal - mat3(viewMatrix) * leafG * 2.2 * leafA);
        }`)
      // a crown is no mirror: the sun's glint off its cards, seen against the light, would frost it white
      .replace('#include <aomap_fragment>', 'reflectedLight.directSpecular *= 0.15;\n#include <aomap_fragment>')
      .replace('#include <opaque_fragment>', `
        float through = max(0.0, -dot(normal, leafSun)) * (0.3 + 0.7 * pow(max(dot(normalize(-vViewPosition), leafSun), 0.0), 2.0));
        outgoingLight += diffuseColor.rgb * leafGlow * through;
        float upward = dot(normal, normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0)));
        outgoingLight += diffuseColor.rgb * leafNight * mix(vec3(0.95, 0.62, 0.38), vec3(0.14, 0.16, 0.26), smoothstep(-0.7, 0.5, upward));
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'outside-leaf';
  return u;
}

/** The trees' meshes (for each cell of the grid: bark, leaves; each casts and takes shadows) and their leaves' uniforms. Far from the window they are sparser (`Detail`). */
export function plantTrees(list: readonly Tree[], k: Kit): { meshes: Mesh[]; leaf: LeafUniforms } {
  const cells = new Map<string, { cards: Lumps; wood: BufferGeometry[] }>();
  for (const t of list) {
    const key = `${Math.floor(t.x / TREE_CELL)},${Math.floor(t.z / TREE_CELL)}`;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { cards: new Lumps(), wood: [] }));
    grow(t, c.cards, c.wood, detailAt(Math.hypot(t.x - GRID.av0, t.z)));
  }
  const meshes: Mesh[] = [];
  for (const { cards, wood } of cells.values()) {
    if (wood.length) meshes.push(new Mesh(mergeGeometries(wood, false)!, k.bark));
    meshes.push(new Mesh(cards.geometry(), k.leaves));
  }
  for (const m of meshes) m.castShadow = m.receiveShadow = true;
  return { meshes, leaf: leafShader(k.leaves) };
}
