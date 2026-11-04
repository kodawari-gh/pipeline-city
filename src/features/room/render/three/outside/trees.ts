// The street's trees (`plan.ts` places them): planes along the avenues, limes along the streets, planes, limes and shrubs in the parks.
// A tree is its trunk and limbs, tapered tubes in bark, and its crown, clusters of leaf cards (the twig picture of `leaves`) round its limbs'
// ends. The cards take the crown's outward normals, so a crown shades as one mass, darker inside and under; the sun behind it shines through
// its leaves (`leafShader`), and the wind stirs them. All the trees are two meshes: the bark, the leaves.
import { BufferGeometry, Color, Float32BufferAttribute, Mesh, Vector3, type MeshStandardMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { taperTube } from '@/core/render/three/loft';
import type { Kit } from './kit';
import { CURB, GRID, rng, type Tree, type TreeKind } from './plan';

type V3 = [number, number, number];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
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
  /** A leaf card's size (m), the cards in a cluster of leaves, the green (it multiplies the picture's). */
  card: number; cards: number; tint: V3;
}

const HABIT: Record<TreeKind, Habit> = {
  plane: { bole: 0.3, spread: 0.36, limbs: 5, girth: 0.021, leader: false, card: 1.05, cards: 30, tint: [0.95, 1.0, 0.8] },
  lime: { bole: 0.26, spread: 0.24, limbs: 6, girth: 0.019, leader: true, card: 0.85, cards: 24, tint: [0.86, 1.02, 0.76] },
  shrub: { bole: 0, spread: 0.62, limbs: 0, girth: 0, leader: false, card: 0.6, cards: 14, tint: [0.66, 0.86, 0.62] },
};

/** The leaf cards of every crown in one geometry: corners, the crown's outward normals, the twig's uvs, a colour (its green, darker inside), the wind's swing and phase. */
class Cards {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; wind: number[] = []; idx: number[] = [];

  /** A card of size `s` at `p`, its face toward `facing`, turned by `turn` in its plane; it shades by the normal `n`. */
  add(p: V3, s: number, facing: V3, turn: number, n: V3, c: V3, swing: number, phase: number): void {
    const a = unit(cross(facing, Math.abs(facing[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0])), b = cross(facing, a);
    const cs = (Math.cos(turn) * s) / 2, sn = (Math.sin(turn) * s) / 2;
    const u: V3 = [a[0] * cs + b[0] * sn, a[1] * cs + b[1] * sn, a[2] * cs + b[2] * sn];
    const v: V3 = [b[0] * cs - a[0] * sn, b[1] * cs - a[1] * sn, b[2] * cs - a[2] * sn];
    const i = this.pos.length / 3;
    for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      this.pos.push(p[0] + u[0] * du + v[0] * dv, p[1] + u[1] * du + v[1] * dv, p[2] + u[2] * du + v[2] * dv);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push((du + 1) / 2, (dv + 1) / 2);
      this.col.push(c[0], c[1], c[2]);
      this.wind.push(swing, phase);
    }
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
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
interface Cluster { p: V3; r: number; share: number }

/**
 * A crown's cards round its clusters, more toward each cluster's outside. `o` and `rad`: the crown's ellipsoid, for the normals (its own outward
 * normal there, bent toward the cluster's) and the shade (dark deep inside, darker under). A far tree has fewer, larger cards.
 */
function crown(c: Cards, cl: readonly Cluster[], o: V3, rad: V3, h: Habit, tint: V3, height: number, far: boolean, r: () => number): void {
  const n = h.cards * (far ? 0.55 : 1), size = h.card * (far ? 1.3 : 1);
  for (const k of cl) {
    const phase = r() * 6.28, shade = 0.86 + r() * 0.24, hue = (r() - 0.5) * 0.14;
    for (let i = 0, m = Math.round(n * k.share); i < m; i++) {
      const dir = anyDir(r), p = add(k.p, dir, k.r * (0.35 + 0.65 * Math.cbrt(r())));
      const q: V3 = [(p[0] - o[0]) / rad[0], (p[1] - o[1]) / rad[1], (p[2] - o[2]) / rad[2]], e = len(q);
      const nrm = unit(add(unit([q[0] / rad[0], q[1] / rad[1], q[2] / rad[2]]), dir, 0.35));
      const ao = (0.3 + 0.7 * smooth(0.25, 1.0, e)) * (0.72 + 0.28 * clamp01(q[1] * 0.5 + 0.5)) * shade;
      const col: V3 = [tint[0] * ao * (1 + hue), tint[1] * ao, tint[2] * ao * (1 - hue)];
      c.add(p, size * (0.8 + r() * 0.4), unit(add(dir, anyDir(r), 0.9)), r() * 6.28, nrm, col, 0.03 + 0.07 * clamp01((p[1] - CURB) / height), phase + r() * 0.9);
    }
  }
}

/** One tree: its bark into `bark`, its leaves into the cards. */
function grow(t: Tree, cards: Cards, bark: BufferGeometry[], far: boolean): void {
  const h = HABIT[t.kind], r = rng(t.seed), H = t.h, R = H * h.spread, v = () => 0.94 + r() * 0.12;
  const tint: V3 = [h.tint[0] * v(), h.tint[1] * v(), h.tint[2] * v()];
  if (t.kind === 'shrub') {
    // a bush: a few clusters round its middle, on the ground
    const o: V3 = [t.x, CURB + H * 0.48, t.z], rad: V3 = [R, H * 0.5, R], cl: Cluster[] = [];
    for (let i = 0; i < 4; i++) { const d = anyDir(r); cl.push({ p: add(o, [d[0] * R * 0.4, Math.abs(d[1]) * H * 0.15, d[2] * R * 0.4]), r: R * 0.62, share: 1 }); }
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
    cl.push({ p: end, r: R * 0.42, share: 1 });
    // its branches, off its outer half, each fanned a little from it and up
    for (let j = 0, m = 2 + (r() < 0.5 ? 1 : 0); j < m; j++) {
      const a = az + (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.5), f = 0.4 + r() * 0.45, s = f < 0.5 ? lerp(from, mid, f * 2) : lerp(mid, end, f * 2 - 1);
      const tip = add(add(s, [Math.cos(a), 0, Math.sin(a)], R * (0.3 + r() * 0.2)), [0, R * (0.12 + r() * 0.2), 0]);
      bark.push(limb([s, lerp(s, tip, 0.5), tip], 0.05, 0.015, 5, 4));
      cl.push({ p: tip, r: R * 0.36, share: 0.8 });
    }
  }
  // the crown's top, and a dark fill in its middle so it is not seen through
  cl.push({ p: h.leader ? lead : add(o, [0, rad[1] * 0.55, 0]), r: R * 0.48, share: 1 }, { p: o, r: R * 0.5, share: 0.5 });
  crown(cards, cl, o, rad, h, tint, H, far, r);
}

/** The leaves' wind and their light from behind: the clock (s), the sun's direction in the camera's frame, the sunlight they let through. */
export interface LeafUniforms { time: { value: number }; sunView: { value: Vector3 }; glow: { value: Color } }

/**
 * The leaf material's own shading: the cards keep their outward normals on both faces (a double-sided card would turn its back face's),
 * the wind sways them (more toward the crown's top), and the sun behind them shines through: the side of a crown away from the sun glows
 * green, the more as the eye looks toward the sun; the sun's glint off the cards is kept faint.
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
  const cards = new Cards(), wood: BufferGeometry[] = [];
  for (const t of list) grow(t, cards, wood, Math.hypot(t.x - GRID.av0, t.z) > 160);
  const meshes: Mesh[] = [];
  if (wood.length) meshes.push(new Mesh(mergeGeometries(wood, false)!, k.bark));
  meshes.push(new Mesh(cards.geometry(), k.leaves));
  for (const m of meshes) m.castShadow = m.receiveShadow = true;
  return { meshes, leaf: leafShader(k.leaves) };
}
