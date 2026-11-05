// The street's trees (`plan.ts` places them): planes along the avenues, limes along the streets, planes, limes and shrubs in the parks.
// A tree is its trunk and limbs, tapered tubes in bark, and its crown: a soft lump of leaves round each limb's end, solid, so a crown is a
// clean mass like the buildings' and does not glitter. The lumps take normals bent toward the crown's own, so a crown shades as one mass,
// darker inside and under; the sun behind it shines through its edge (`leafShader`), and the wind stirs them. All the trees are two meshes:
// the bark, the leaves.
import { BufferGeometry, Color, Float32BufferAttribute, IcosahedronGeometry, Mesh, Vector3, type MeshStandardMaterial } from 'three';
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

/** The leaf lumps of every crown in one geometry: places, normals (bent toward the crown's), a colour (its green, darker inside), the wind's swing and phase. */
class Lumps {
  pos: number[] = []; nor: number[] = []; col: number[] = []; wind: number[] = []; idx: number[] = [];

  /** A lump round `p`, `r` across, uneven by `bumps`: `shade` gives each vertex its normal and colour from its place and its own normal. */
  add(p: V3, r: number, bumps: number, fine: boolean, seed: number, shade: (q: V3, n: V3) => [V3, V3], swing: number, phase: number): void {
    const b = BALLS[fine ? 1 : 0]!, base = this.pos.length / 3, f = [5.1 + seed % 1.7, 4.3 + (seed * 7) % 1.9, 6.2 + (seed * 3) % 1.3];
    for (let i = 0; i < b.pos.length; i += 3) {
      const d: V3 = [b.pos[i]!, b.pos[i + 1]!, b.pos[i + 2]!];
      const k = r * (1 + bumps * Math.sin(d[0] * f[0]! + seed) * Math.sin(d[1] * f[1]! + seed * 1.3) * Math.sin(d[2] * f[2]! + seed * 0.7) * 2.2);
      const q = add(p, d, k), [n, c] = shade(q, d);
      this.pos.push(...q); this.nor.push(...n); this.col.push(...c); this.wind.push(swing, phase);
    }
    for (let i = 0; i < b.idx.length; i++) this.idx.push(base + b.idx[i]!);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('wind', new Float32BufferAttribute(this.wind, 2));
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
 * the lump's) and the shade (dark deep inside, darker under, a lump's underside darker still). A far tree's lumps are coarser.
 */
function crown(c: Lumps, cl: readonly Cluster[], o: V3, rad: V3, h: Habit, tint: V3, height: number, far: boolean, r: () => number): void {
  for (const k of cl) {
    const phase = r() * 6.28, tone = 0.88 + r() * 0.24, hue = (r() - 0.5) * 0.16, seed = r() * 100;
    const shade = (p: V3, d: V3): [V3, V3] => {
      const q: V3 = [(p[0] - o[0]) / rad[0], (p[1] - o[1]) / rad[1], (p[2] - o[2]) / rad[2]], e = len(q);
      const nrm = unit(add(unit([q[0] / rad[0], q[1] / rad[1], q[2] / rad[2]]), d, 0.55));
      const ao = (0.35 + 0.65 * smooth(0.3, 1.0, e)) * (0.7 + 0.3 * clamp01(q[1] * 0.5 + 0.5)) * (0.8 + 0.2 * (d[1] * 0.5 + 0.5)) * tone;
      return [nrm, [tint[0] * ao * (1 + hue), tint[1] * ao, tint[2] * ao * (1 - hue)]];
    };
    const swing = 0.02 + 0.05 * clamp01((k.p[1] - CURB) / height);
    c.add(k.p, k.r * 1.02, h.bumps, !far, seed, shade, swing, phase);
  }
}

/** One tree: its bark into `bark`, its leaves into the lumps. */
function grow(t: Tree, cards: Lumps, bark: BufferGeometry[], far: boolean): void {
  const h = HABIT[t.kind], r = rng(t.seed), H = t.h, R = H * h.spread, v = () => 0.94 + r() * 0.12;
  const tint: V3 = [h.tint[0] * v(), h.tint[1] * v(), h.tint[2] * v()];
  if (t.kind === 'shrub') {
    // a bush: a few clusters round its middle, on the ground
    const o: V3 = [t.x, CURB + H * 0.48, t.z], rad: V3 = [R, H * 0.5, R], cl: Cluster[] = [];
    for (let i = 0; i < 4; i++) { const d = anyDir(r); cl.push({ p: add(o, [d[0] * R * 0.4, Math.abs(d[1]) * H * 0.15, d[2] * R * 0.4]), r: R * 0.62 }); }
    crown(cards, cl, o, rad, h, tint, H, far, r);
    return;
  }
  const foot: V3 = [t.x, CURB - 0.05, t.z], bole = H * h.bole, r0 = 0.05 + H * h.girth;
  const top = add(foot, unit([(r() - 0.5) * 0.12, 1, (r() - 0.5) * 0.12]), bole + 0.05 * H);
  const lead = h.leader ? add(top, unit([(r() - 0.5) * 0.15, 1, (r() - 0.5) * 0.15]), (H - bole) * 0.82) : top;
  bark.push(h.leader ? limb([foot, lerp(foot, top, 0.5), top, lerp(top, lead, 0.5), lead], r0, 0.035, 10, 16) : limb([foot, lerp(foot, top, 0.5), top], r0, r0 * 0.72, 10, 8));
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
    bark.push(limb([from, mid, end], r0 * (h.leader ? 0.38 : 0.55), 0.03, 6, 8));
    cl.push({ p: end, r: R * 0.42 });
    // its branches, off its outer half, each fanned a little from it and up
    for (let j = 0, m = 2 + (r() < 0.5 ? 1 : 0); j < m; j++) {
      const a = az + (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.5), f = 0.4 + r() * 0.45, s = f < 0.5 ? lerp(from, mid, f * 2) : lerp(mid, end, f * 2 - 1);
      const tip = add(add(s, [Math.cos(a), 0, Math.sin(a)], R * (0.3 + r() * 0.2)), [0, R * (0.12 + r() * 0.2), 0]);
      bark.push(limb([s, lerp(s, tip, 0.5), tip], 0.05, 0.015, 5, 4));
      cl.push({ p: tip, r: R * 0.36 });
    }
  }
  // the crown's top, and a fill in its middle so it is not seen through between the lumps
  cl.push({ p: h.leader ? lead : add(o, [0, rad[1] * 0.55, 0]), r: R * 0.48 }, { p: o, r: R * 0.6 });
  crown(cards, cl, o, rad, h, tint, H, far, r);
}

/** The leaves' wind and their light from behind: the clock (s), the sun's direction in the camera's frame, the sunlight they let through. */
export interface LeafUniforms { time: { value: number }; sunView: { value: Vector3 }; glow: { value: Color } }

/**
 * The leaf material's own shading: the lumps keep the crown's bent normals (the normal map's chunk would take the face's), the wind sways
 * them (more toward the crown's top), and the sun behind them shines through: the side of a crown away from the sun glows green, the more
 * as the eye looks toward the sun; the sun's glint off the leaves is kept faint.
 */
export function leafShader(m: MeshStandardMaterial): LeafUniforms {
  const u: LeafUniforms = { time: { value: 0 }, sunView: { value: new Vector3(0, 1, 0) }, glow: { value: new Color(0, 0, 0) } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.leafTime = u.time;
    sh.uniforms.leafSun = u.sunView;
    sh.uniforms.leafGlow = u.glow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 wind;\nuniform float leafTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sway = sin(leafTime * 1.3 + wind.y) * 0.7 + sin(leafTime * 3.1 + wind.y * 2.7) * 0.3;
        transformed += vec3(0.8, 0.2, 0.55) * sway * wind.x;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 leafSun;\nuniform vec3 leafGlow;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);\n  nonPerturbedNormal = normal;')
      // a crown is no mirror: the sun's glint off its cards, seen against the light, would frost it white
      .replace('#include <aomap_fragment>', 'reflectedLight.directSpecular *= 0.15;\n#include <aomap_fragment>')
      .replace('#include <opaque_fragment>', `
        float through = max(0.0, -dot(normal, leafSun)) * (0.3 + 0.7 * pow(max(dot(normalize(-vViewPosition), leafSun), 0.0), 2.0));
        outgoingLight += diffuseColor.rgb * leafGlow * through;
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'outside-leaf';
  return u;
}

/** The trees' meshes (bark, leaves; each casts and takes shadows) and their leaves' uniforms. Far from the window they are sparser. */
export function plantTrees(list: readonly Tree[], k: Kit): { meshes: Mesh[]; leaf: LeafUniforms } {
  const cards = new Lumps(), wood: BufferGeometry[] = [];
  for (const t of list) grow(t, cards, wood, Math.hypot(t.x - GRID.av0, t.z) > 160);
  const meshes: Mesh[] = [];
  if (wood.length) meshes.push(new Mesh(mergeGeometries(wood, false)!, k.bark));
  meshes.push(new Mesh(cards.geometry(), k.leaves));
  for (const m of meshes) m.castShadow = m.receiveShadow = true;
  return { meshes, leaf: leafShader(k.leaves) };
}
