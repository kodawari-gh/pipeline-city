// The room's plants in 3D (docs/LOWPOLY_STYLE.md "Look decision"): each leaf a curved blade (its outline, a crease down the midrib, a curl, a
// wavy edge) painted with its veins, on a petiole off a tapered stem: a fiddle-leaf fig in a ribbed pot on the floor, pothos trailing off the
// shelves, succulent rosettes in small pots, an aloe on the sill. The builders take layout points (2D y down) and return world meshes (y up).
// All the leaves of a kind share a few materials, so the room's merge (`mergeStatic`) draws each plant in a handful of calls. Pure scenery.
import { BufferGeometry, CatmullRomCurve3, DoubleSide, Float32BufferAttribute, Group, IcosahedronGeometry, LatheGeometry, Matrix4, Mesh, Vector2, Vector3, type Material, type Texture } from 'three';
import { paint, place, post, rod } from '@/core/render/three/geometry';
import { taperTube } from '@/core/render/three/loft';
import { mat } from '@/core/render/three/materials';
import { floorShadow } from './furniture3d';
import { FLOOR_Y } from './roomplan';

type V3 = [number, number, number];

let seedN = 29;
const rnd = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647);

// ---------------------------------------------------------------- leaves
/** A leaf's half width (a share of its full half width) at u, from its base (0) to its tip (1). */
const OUTLINE = {
  /** the fiddle-leaf fig: a wedge at the base, widest past the middle, a waist below that, a broad round tip */
  fig: (u: number) => Math.pow(Math.max(0, Math.sin(Math.PI * u * u)), 0.55) * (1 - 0.12 * Math.exp(-(((u - 0.42) / 0.1) ** 2))),
  /** pothos: a heart, wide at its lobes, to a pointed tip */
  heart: (u: number) => Math.pow(Math.sin(Math.PI * (0.22 + 0.78 * u)), 0.9),
  /** a succulent's or an aloe's fleshy blade: wide at its base, to a point */
  lance: (u: number) => Math.pow(1 - u, 0.9) * Math.min(1, 0.55 + u * 3),
} as const;
export type LeafShape = keyof typeof OUTLINE;

/**
 * A leaf blade `len` long (+y from its base at the origin) and `wid` across (x), its face to +z: the halves rise off the midrib by `fold` (a
 * share of the half width), the blade curls toward its face by `curl` (a share of its length) and its edge waves by `wave`. A heart's lobes
 * sweep back past its base. u runs across the blade, v from its base to its tip (the texture's veins follow).
 */
export function leafBlade(len: number, wid: number, shape: LeafShape, o: { fold?: number; curl?: number; wave?: number; nu?: number; nv?: number } = {}): BufferGeometry {
  const nu = o.nu ?? 10, nv = o.nv ?? 6, f = OUTLINE[shape], fold = o.fold ?? 0.25, curl = o.curl ?? 0.12, wave = o.wave ?? 0;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu, half = (f(u) * wid) / 2;
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1, a = Math.abs(v);
      const y = u * len - (shape === 'heart' ? 0.14 * len * a * a * (1 - u) ** 3 : 0);
      const z = fold * a ** 1.3 * half + curl * len * u * u + wave * half * 0.18 * Math.sin(u * 13 + v * 2) * a * a;
      pos.push(v * half, y, z);
      uv.push((v + 1) / 2, u);
      if (i && j) { const k = i * (nv + 1) + j; idx.push(k - nv - 2, k - nv - 1, k, k - nv - 2, k, k - 1); }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A leaf's painted face (the canvas's top is its tip): the ground, a pale midrib, side veins curving to the edge, `extra` on top. */
function leafTex(ground: string, vein: string, veins: number, extra?: (c: CanvasRenderingContext2D, w: number, h: number) => void): Texture | null {
  return paint(128, 256, (c, w, h) => {
    c.fillStyle = ground; c.fillRect(0, 0, w, h);
    // a soft sheen down the middle of each half, the edge a little darker
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.16)'); g.addColorStop(0.28, 'rgba(255,255,255,0.06)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(0.72, 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0.16)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = vein; c.lineCap = 'round';
    for (let k = 1; k <= veins; k++) {
      const y = h - (k / (veins + 1)) * h * 0.95;
      for (const s of [-1, 1]) {
        c.globalAlpha = 0.55; c.lineWidth = 2;
        c.beginPath(); c.moveTo(w / 2, y); c.quadraticCurveTo(w / 2 + s * w * 0.25, y - h * 0.02, w / 2 + s * w * 0.5, y - h * 0.09); c.stroke();
      }
    }
    c.globalAlpha = 0.9;
    c.beginPath(); c.moveTo(w / 2 - 3, h); c.lineTo(w / 2 + 3, h); c.lineTo(w / 2 + 0.5, 0); c.lineTo(w / 2 - 0.5, 0); c.closePath();
    c.fillStyle = vein; c.fill();
    c.globalAlpha = 1;
    extra?.(c, w, h);
  });
}

/** Three tones of one leaf material (light, mid, deep): the leaves of a plant take turns. */
function leafMats(tex: Texture | null, roughness: number): Material[] {
  return [0xffffff, 0xd7e4c9, 0xaebb9f].map((c) => mat(c, { map: tex, roughness, side: DoubleSide }));
}

/** A leaf from base point `at` along `dir`, its face turned toward `face` (and rolled about its midrib by `roll`). */
function aimed(geo: BufferGeometry, m: Material, at: Vector3, dir: Vector3, face: Vector3, roll = 0): Mesh {
  const y = dir.clone().normalize();
  let z = face.clone().addScaledVector(y, -face.dot(y));
  if (z.lengthSq() < 1e-6) z = new Vector3(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = new Vector3().crossVectors(y, z), zr = z.clone().multiplyScalar(Math.cos(roll)).addScaledVector(x, Math.sin(roll)), xr = new Vector3().crossVectors(y, zr);
  const o = place(new Mesh(geo, m));
  o.applyMatrix4(new Matrix4().makeBasis(xr, y, zr).setPosition(at));
  return o;
}

const UP = new Vector3(0, 1, 0);

// ---------------------------------------------------------------- pots
/** A pot turned on a lathe from its profile ([radius, height] up from its foot), at the layout point (x, y). `ribs` flutes its body. */
function lathePot(x: number, y: number, z: number, profile: readonly (readonly [number, number])[], m: Material, o: { ribs?: number; from?: number; to?: number } = {}): Mesh {
  const ribs = o.ribs ?? 0, g = new LatheGeometry(profile.map(([r, h]) => new Vector2(r, h)), ribs ? ribs * 4 : 32);
  if (ribs) {
    const p = g.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const h = p.getY(i);
      if (h < (o.from ?? 0) || h > (o.to ?? Infinity)) continue;
      const a = Math.atan2(p.getZ(i), p.getX(i)), k = 1 + 0.022 * Math.max(0, Math.cos(a * ribs)) ** 0.6;
      p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
    }
    g.computeVertexNormals();
  }
  const pot = new Mesh(g, m);
  pot.position.set(x, -y, z);
  return place(pot);
}

let soilTex: Texture | null = null;
/** Potting soil: dark crumbs, a fleck of perlite. */
function soil(): Material {
  soilTex ??= paint(128, 128, (c, w, h) => {
    c.fillStyle = '#3a2a1e'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 900; k++) { c.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.3)' : 'rgba(120,90,60,0.25)'; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2); }
    for (let k = 0; k < 40; k++) { c.fillStyle = 'rgba(235,230,215,0.8)'; c.beginPath(); c.arc(rnd() * w, rnd() * h, 0.8 + rnd() * 1.2, 0, Math.PI * 2); c.fill(); }
  }, [2, 2]);
  return mat(0xffffff, { map: soilTex, roughness: 1 });
}

// ---------------------------------------------------------------- the fiddle-leaf fig
/** A fiddle-leaf fig in a ribbed ceramic pot on its saucer, standing on the floor at (x, z): a tapered trunk, two branches, big glossy leaves. */
export function floorPlant(x: number, z: number): Group {
  const g = new Group(), fl = FLOOR_Y;
  const ceramic = mat(0xe8e1d4, { roughness: 0.45 });
  // the pot: a foot, a ribbed body swelling to a rolled rim, the rim's lip turned in
  const potH = 4500, profile = [[0, 0], [1500, 0], [1620, 60], [1700, 260], [2050, 600], [2280, 3700], [2440, 4300], [2500, 4440], [2450, 4520], [2330, 4500], [2260, 4380], [2200, 4200]] as const;
  g.add(lathePot(x, fl, z, profile, ceramic, { ribs: 24, from: 600, to: 3700 }));
  g.add(post(x, fl, z, 1950, 200, mat(0xd8cfbf, { roughness: 0.5 }), 32, 2150), post(x, fl - 200, z, 1980, 60, mat(0xcfc5b3, { roughness: 0.5 }), 32));
  const top = -fl + potH - 250;
  g.add(post(x, fl - potH + 250, z, 2210, 40, soil(), 28), mulch(x, top + 40, z, 1800, 12));
  const bark = mat(0x70584a, { roughness: 0.85 });
  // the trunk and two branches: tapered, a little crooked
  const trunk: V3[] = [[x, top, z], [x + 180, top + 6000, z + 120], [x + 520, top + 12000, z + 320], [x + 380, top + 17800, z + 160]];
  const branches: V3[][] = [
    [[x + 300, top + 8800, z + 180], [x + 1300, top + 11200, z + 900], [x + 2500, top + 13600, z + 1600]],
    [[x + 470, top + 12400, z + 270], [x + 250, top + 14400, z - 900], [x - 150, top + 16400, z - 2100]],
  ];
  g.add(place(new Mesh(taperTube(trunk, 280, 90, 9), bark)));
  for (const b of branches) g.add(place(new Mesh(taperTube(b, 150, 60, 7), bark)));
  // the leaves: on short thick petioles round each stem by the golden angle, the low ones big and drooping, the top ones small and upright
  const tex = leafTex('#3f6e34', '#a9c98a', 9, (c, w, h) => {
    // the fig's gloss: a few broad pale smears
    for (let k = 0; k < 6; k++) { c.fillStyle = 'rgba(255,255,255,0.05)'; c.beginPath(); c.ellipse(w * (0.25 + rnd() * 0.5), h * rnd(), w * 0.25, h * 0.08, 0, 0, Math.PI * 2); c.fill(); }
  });
  const leaves = leafMats(tex, 0.36), stalk = mat(0x6d8a46, { roughness: 0.6 }), knob = new IcosahedronGeometry(1, 1);
  const shapes = [0, 1, 2, 3].map((k) => leafBlade(1, 0.62, 'fig', { fold: 0.2 + k * 0.04, curl: 0.06 + k * 0.04, wave: 0.3 + k * 0.12, nu: 14 }));
  let n = 0;
  const along = (pts: V3[], from: number, count: number, size: number) => {
    const curve = new CatmullRomCurve3(pts.map((p) => new Vector3(...p)));
    for (let i = 0; i < count; i++, n++) {
      const t = from + (1 - from) * (i / Math.max(1, count - 1)), p = curve.getPointAt(Math.min(1, t)), rise = t * t;
      const az = n * 2.4, out = new Vector3(Math.cos(az), 0, Math.sin(az));
      // away from the wall at its back: the west wall is close
      if (out.x < 0) out.x *= 0.35;
      out.normalize();
      // the petiole: out of a small swollen node, arching out and up, thinning to the blade
      const stalkEnd = p.clone().addScaledVector(out, 420).addScaledVector(UP, 260 + 200 * rise), bend = p.clone().addScaledVector(out, 260).addScaledVector(UP, 60 + 90 * rise);
      g.add(place(new Mesh(taperTube([p, bend, stalkEnd].map((q) => [q.x, q.y, q.z] as V3), 58, 26, 7), stalk)));
      const node = place(new Mesh(knob, bark));
      node.position.copy(p); node.scale.setScalar(95);
      g.add(node);
      const len = size * (1.1 - 0.35 * rise) * (0.9 + rnd() * 0.2), el = -0.25 + 1.1 * rise + (rnd() - 0.5) * 0.3;
      const dir = out.clone().multiplyScalar(Math.cos(el)).addScaledVector(UP, Math.sin(el));
      const geo = shapes[n % shapes.length]!.clone().scale(len, len, len);
      g.add(aimed(geo, leaves[n % 3]!, stalkEnd, dir, UP.clone().addScaledVector(out, 0.35), (rnd() - 0.5) * 0.7));
    }
  };
  along(trunk, 0.38, 13, 5600);
  along(branches[0]!, 0.3, 6, 5000);
  along(branches[1]!, 0.3, 6, 5000);
  g.add(floorShadow(x, z, 7600, 7600, 0.8));
  return g;
}

// ---------------------------------------------------------------- pothos
/** Golden pothos: heart leaves, green streaked with cream along the veins. */
let pothosM: Material[] | null = null;
function pothosLeaves(): Material[] {
  return pothosM ??= leafMats(leafTex('#4c8a3a', '#9cc77c', 6, (c, w, h) => {
    for (let k = 0; k < 14; k++) {
      const x = w * (0.2 + rnd() * 0.6), y = h * rnd();
      c.strokeStyle = `rgba(226,214,140,${0.35 + rnd() * 0.35})`; c.lineWidth = 2 + rnd() * 5;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + (rnd() - 0.5) * 30, y - 20, x + (x < w / 2 ? -1 : 1) * (10 + rnd() * 30), y - 40 - rnd() * 30); c.stroke();
    }
  }), 0.45);
}

/** A pothos in a small pot standing at (x, y, z) (y its base, 2D down), its vines trailing over an edge at x `edge` and down toward the room (+x). */
export function pothos(x: number, y: number, z: number, edge: number, vines: readonly { dz: number; len: number }[]): Group {
  const g = new Group(), leaves = pothosLeaves(), stem = mat(0x6f9442, { roughness: 0.6 });
  g.add(lathePot(x, y, z, [[0, 0], [760, 0], [820, 80], [900, 1500], [990, 1620], [1000, 1720], [930, 1720], [900, 1600]], mat(0xe3ddd2, { roughness: 0.4 })));
  g.add(post(x, y - 1560, z, 905, 40, soil(), 20));
  const heart = [0, 1, 2].map((k) => leafBlade(1, 0.78, 'heart', { fold: 0.18 + k * 0.08, curl: 0.1 + k * 0.05, wave: 0.2 }));
  // a tuft out of the pot: leaves on long petioles arching up and out, to the room and the sides, none back into the wall behind it (-x)
  for (let k = 0; k < 11; k++) {
    const a = 0.6 * ((k * 2.4) % (2 * Math.PI)) - 0.6 * Math.PI, out = new Vector3(Math.cos(a), 0, Math.sin(a)), base = new Vector3(x, -y + 1600, z).addScaledVector(out, 200);
    const tip = base.clone().addScaledVector(out, 500 + (k % 3) * 160).addScaledVector(UP, 700 + (k % 4) * 250);
    g.add(rod([base.x, base.y, base.z], [tip.x, tip.y, tip.z], 28, stem, 5));
    const dir = out.clone().multiplyScalar(0.8).addScaledVector(UP, 0.35 - (k % 3) * 0.2), s = 1400 + rnd() * 400;
    g.add(aimed(heart[k % 3]!.clone().scale(s, s, s), leaves[k % 3]!, tip, dir, UP, (rnd() - 0.5) * 0.6));
  }
  // the vines: over the edge and down, a leaf at each node on alternate sides, smaller toward the end
  vines.forEach((v, i) => {
    const sway = (rnd() - 0.5) * 1600, pts: V3[] = [[x + 500, -y + 1700, z + v.dz * 0.3], [edge + 120, -y + 380, z + v.dz * 0.8], [edge + 260, -y - v.len * 0.45, z + v.dz + sway * 0.5], [edge + 320, -y - v.len, z + v.dz + sway]];
    const curve = new CatmullRomCurve3(pts.map((p) => new Vector3(...p)));
    g.add(place(new Mesh(taperTube(pts, 34, 18, 5), stem)));
    for (let t = 0.1, k = 0; t < 0.98; t += 0.075, k++) {
      const p = curve.getPointAt(t), tan = curve.getTangentAt(t), side = k % 2 ? 1 : -1;
      // a node's leaf: off a short petiole to one side, hanging tip down, its face to the room
      const across = new Vector3(0, 0, side), stalkEnd = p.clone().addScaledVector(across, 260).addScaledVector(new Vector3(1, 0, 0), 120);
      g.add(rod([p.x, p.y, p.z], [stalkEnd.x, stalkEnd.y, stalkEnd.z], 20, stem, 4));
      const dir = tan.clone().multiplyScalar(0.7).addScaledVector(across, 0.55).addScaledVector(UP, -0.25), s = (1250 - t * 450) * (0.9 + rnd() * 0.2);
      g.add(aimed(heart[(k + i) % 3]!.clone().scale(s, s, s), leaves[(k + i) % 3]!, stalkEnd, dir, new Vector3(1, 0.4, 0), (rnd() - 0.5) * 0.5));
    }
  });
  return g;
}

// ---------------------------------------------------------------- succulents
/** A small succulent rosette in a white pot standing on the layout point (x, y): three rings of fleshy leaves, blushed at their tips. */
export function succulent(x: number, y: number, z: number, r: number): Group {
  const g = new Group();
  g.add(lathePot(x, y, z, [[0, 0], [r * 0.82, 0], [r * 0.9, r * 0.08], [r * 1.0, r * 1.1], [r * 1.08, r * 1.2], [r * 1.0, r * 1.22], [r * 0.95, r * 1.12]], mat(0xe9e4da, { roughness: 0.4 }), { ribs: 12, from: r * 0.1, to: r * 1.05 }));
  g.add(post(x, y - r * 1.1, z, r * 0.96, r * 0.04, soil(), 16));
  const tex = leafTex('#86a893', '#a9c4b0', 0, (c, w, h) => {
    const b = c.createLinearGradient(0, 0, 0, h * 0.35);
    b.addColorStop(0, 'rgba(206,120,128,0.75)'); b.addColorStop(1, 'rgba(206,120,128,0)');
    c.fillStyle = b; c.fillRect(0, 0, w, h * 0.35);
  });
  const ms = leafMats(tex, 0.5), base = new Vector3(x, -y + r * 1.15, z);
  for (const [ring, count, el, len] of [[0, 5, 1.15, 0.55], [1, 7, 0.75, 0.8], [2, 9, 0.35, 0.95]] as const) {
    const geo = leafBlade(r * len, r * len * 0.62, 'lance', { fold: 0.55, curl: 0.18 });
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + ring * 0.45, out = new Vector3(Math.cos(a), 0, Math.sin(a));
      const dir = out.clone().multiplyScalar(Math.cos(el)).addScaledVector(UP, Math.sin(el));
      g.add(aimed(geo, ms[(k + ring) % 3]!, base.clone().addScaledVector(out, r * 0.08 * ring), dir, UP.clone().addScaledVector(out, -0.4)));
    }
  }
  return g;
}

/** An aloe in a stoneware pot on the sill at the layout point (x, y): long spotted blades fanning out of the soil, arching over. */
export function aloe(x: number, y: number, z: number): Group {
  const g = new Group();
  // the pot: dark stoneware, speckled, a plain cylinder a little tapered to its foot, its rim rounded over
  const speckle = paint(128, 64, (c, w, h) => {
    c.fillStyle = '#3d3e40'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 500; k++) { c.fillStyle = rnd() < 0.7 ? `rgba(205,198,184,${0.25 + rnd() * 0.35})` : 'rgba(20,18,16,0.5)'; c.fillRect(rnd() * w, rnd() * h, 0.6 + rnd(), 0.6 + rnd()); }
  }, [2, 1]);
  g.add(lathePot(x, y, z, [[0, 0], [880, 0], [950, 40], [1000, 200], [1050, 1300], [1062, 1420], [1032, 1462], [992, 1452], [972, 1350]], mat(0xffffff, { map: speckle, roughness: 0.75 })));
  g.add(post(x, y - 1280, z, 970, 40, soil(), 20));
  const tex = leafTex('#5c9656', '#8fbf7f', 0, (c, w, h) => {
    for (let k = 0; k < 70; k++) { c.fillStyle = `rgba(232,240,214,${0.4 + rnd() * 0.3})`; c.beginPath(); c.ellipse(w * (0.15 + rnd() * 0.7), h * rnd(), 2.4, 1.4, 0, 0, Math.PI * 2); c.fill(); }
  });
  const ms = leafMats(tex, 0.45), base = new Vector3(x, -y + 1320, z);
  for (let k = 0; k < 11; k++) {
    const a = k * 2.4, out = new Vector3(Math.cos(a), 0, Math.sin(a)), el = 1.25 - (k / 11) * 0.7, len = 2100 + (k % 4) * 280;
    const geo = leafBlade(len, len * 0.2, 'lance', { fold: 0.7, curl: -0.12 - (k / 11) * 0.12, nu: 8, nv: 4 });
    const dir = out.clone().multiplyScalar(Math.cos(el)).addScaledVector(UP, Math.sin(el));
    g.add(aimed(geo, ms[k % 3]!, base.clone().addScaledVector(out, 120), dir, UP.clone().addScaledVector(out, -0.5)));
  }
  return g;
}

/** A few pebbles of bark on the soil (flat-shaded chips), round (x, top, z) within r. */
export function mulch(x: number, top: number, z: number, r: number, n: number): Group {
  const g = new Group(), m = mat(0x7a5a40, { roughness: 0.9, flatShading: true }), geo = new IcosahedronGeometry(1, 0);
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r, s = 120 + rnd() * 120, o = new Mesh(geo, m);
    o.scale.set(s, s * 0.45, s * 0.8); o.position.set(x + Math.cos(a) * d, top + s * 0.2, z + Math.sin(a) * d); o.rotation.set(rnd(), rnd() * 3, rnd());
    g.add(place(o));
  }
  return g;
}

/** Where the fig stands: a little off the west wall, past the bookcase's end, so its leaves clear both. */
export { FIG_AT } from './roomplan';
