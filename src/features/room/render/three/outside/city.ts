// What lies past the streets (`view.ts` sees it down the side street): the town, roofs and gables round the street's line on, its windows lit at
// night, its trees, a church's spire; the city's towers two and three kilometres out; the land, fields that rise to wooded hills at five to nine
// kilometres, hazed by the fog. Far things in vertex colours, so the town is one mesh; the towers on the kit's facade, the land its own mesh.
import { BoxGeometry, BufferGeometry, Color, ConeGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { block } from './houses';
import type { Kit } from './kit';
import { SIDE, SIDE_TURN, Z, rng, sidePoint, type Tree } from './plan';

/** Where the town begins down the side street, and how far it reaches (m). */
const TOWN0 = 330, TOWN1 = 1150;
/** The church, by the street's line on: how far along, how far across. */
const CHURCH = { s: 620, t: 16 } as const;

const WALLS = [0x9c5a44, 0xb7735a, 0xd8cdb6, 0xc9c1b2, 0xe4dcc9, 0x8f8a80, 0xbfa58a].map((c) => new Color(c));
const ROOFS = [0x4a4e55, 0x6a3f33, 0x8a4c37, 0x3b3f45].map((c) => new Color(c));

/** A piece in colour: a geometry (unindexed, with uvs) in its place, every vertex `c`. */
function coloured(g: BufferGeometry, m: Matrix4, c: Color): BufferGeometry {
  const out = (g.index ? g.toNonIndexed() : g).applyMatrix4(m), n = out.attributes.position!.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  out.setAttribute('color', new Float32BufferAttribute(col, 3));
  if (!out.attributes.uv) out.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
  return out;
}

/** A pitched roof w wide (x), d deep (z), `rise` high, its ridge along z: two slopes and two gables, flat shaded. */
function roof(w: number, d: number, rise: number): BufferGeometry {
  const a = -w / 2, b = w / 2, f = d / 2, k = -d / 2;
  const tris = [
    [a, 0, f, 0, rise, f, 0, rise, k], [a, 0, f, 0, rise, k, a, 0, k],
    [b, 0, f, b, 0, k, 0, rise, k], [b, 0, f, 0, rise, k, 0, rise, f],
    [a, 0, f, b, 0, f, 0, rise, f], [b, 0, k, a, 0, k, 0, rise, k],
  ].flat();
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(tris, 3));
  g.computeVertexNormals();
  return g;
}

/** A frame in the side street's (x across it, -z along it away from us, +z toward us) at (s, t), at height y, turned a little more by `turn`. */
function sideMatrix(s: number, t: number, y = 0, turn = 0): Matrix4 {
  const [x, z] = sidePoint(s, t);
  return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), SIDE_TURN + turn), new Vector3(1, 1, 1));
}

/** One building of the town: its walls, its roof (a pitched one or a flat one's parapet), its front's windows toward us (some lit). */
function building(parts: BufferGeometry[], glass: BufferGeometry[], lit: BufferGeometry[], m: Matrix4, w: number, d: number, h: number, r: () => number, near: boolean): void {
  const wall = WALLS[Math.floor(r() * WALLS.length)]!.clone().multiplyScalar(0.9 + r() * 0.2), top = ROOFS[Math.floor(r() * ROOFS.length)]!;
  parts.push(coloured(new BoxGeometry(w, h, d).translate(0, h / 2, 0), m, wall));
  if (r() < 0.7) {
    const along = r() < 0.5, g = along ? roof(w + 0.4, d + 0.4, Math.min(w, 9) * 0.38) : roof(d + 0.4, w + 0.4, Math.min(d, 9) * 0.38).rotateY(Math.PI / 2);
    parts.push(coloured(g.translate(0, h, 0), m, top));
  } else parts.push(coloured(new BoxGeometry(w + 0.2, 0.6, d + 0.2).translate(0, h + 0.3, 0), m, wall.clone().multiplyScalar(0.8)));
  if (!near) return;
  const floors = Math.floor((h - 0.8) / 3), cols = Math.max(1, Math.floor(w / 3.2));
  for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
    const x = -w / 2 + (w * (c + 0.5)) / cols, y = 1.4 + f * 3, q = new BoxGeometry(1.2, 1.5, 0.05).translate(x, y, d / 2 + 0.03).applyMatrix4(m);
    (r() < 0.32 ? lit : glass).push(q.index ? q.toNonIndexed() : q);
  }
}

/** The land round the view: flat under the town, fields beyond, hills rising from 2.5 km to 9 km, coloured by height and patch. */
function land(): BufferGeometry {
  const A = 120, R = 64, mid = Math.atan2(SIDE.dir[0], SIDE.dir[1]), spread = 1.4;
  const hash = (i: number, j: number) => { const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return v - Math.floor(v); };
  const noise = (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (hash(i, j) * (1 - u) + hash(i + 1, j) * u) * (1 - v) + (hash(i, j + 1) * (1 - u) + hash(i + 1, j + 1) * u) * v;
  };
  const fbm = (x: number, y: number) => noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.28 + noise(x * 4.3, y * 4.3) * 0.17;
  const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const town = new Color(0x6f7268), field = [new Color(0x7f8c4f), new Color(0x9c9a5c), new Color(0x6c8547)], wood = new Color(0x3d5636), high = new Color(0x56664f);
  for (let j = 0; j <= R; j++) {
    const rad = 60 * Math.pow(11000 / 60, j / R);
    for (let i = 0; i <= A; i++) {
      const a = mid - spread + (2 * spread * i) / A, x = Math.sin(a) * rad, z = Math.cos(a) * rad, px = a * 9, py = rad / 1400;
      const hill = smooth(2500, 6500, rad) * (90 + 330 * fbm(px * 0.7, py * 0.6)) + smooth(6000, 9500, rad) * 160 * fbm(px * 1.3 + 5, py);
      pos.push(x, rad < 1300 ? -0.06 : hill * smooth(1300, 2600, rad) - 0.06, z);
      const patch = field[Math.floor(hash(Math.floor(px * 3), Math.floor(py * 6)) * 3)]!;
      const c = rad < 1300 ? town.clone() : patch.clone().lerp(wood, smooth(0.45, 0.65, fbm(px * 2, py * 2)) * 0.8 + smooth(2500, 5000, rad) * 0.5);
      if (rad > 6000) c.lerp(high, smooth(6000, 10000, rad) * 0.6);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < A; i++) {
    const a = j * (A + 1) + i, b = a + A + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The far things: `group` on the kit's materials (to merge), `extra` in their own geometry (added after the merge), the town's trees. */
export function city(k: Kit): { group: Group; extra: Mesh[]; trees: Tree[] } {
  const r = rng(91), parts: BufferGeometry[] = [], glass: BufferGeometry[] = [], lit: BufferGeometry[] = [], trees: Tree[] = [];
  // the town: blocks of buildings either side of the street's line, taller toward its middle; the church in its own plot
  for (let s = TOWN0; s < TOWN1; s += 34 + r() * 10) {
    for (let t = -230; t < 230; t += 30 + r() * 12) {
      if (Math.abs(t) < 9) continue;
      if (Math.abs(s - CHURCH.s) < 30 && t > 4 && t < 34) continue;
      const near = s < 760, n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const w = 7 + r() * 9, d = 9 + r() * 8, h = 6 + r() * 7 + (s > 600 && Math.abs(t) < 90 ? r() * 10 : 0);
        building(parts, glass, lit, sideMatrix(s + i * (d + 1.5), t + (r() - 0.5) * 6, 0, (r() - 0.5) * 0.08), w, d, h, r, near);
      }
      if (s < 800 && r() < 0.45) { const [x, z] = sidePoint(s + 10 + r() * 15, t + (r() - 0.5) * 14); trees.push({ x, z, kind: 'lime', h: 9 + r() * 4, seed: Math.floor(r() * 1e6) }); }
    }
  }
  // the main street on past the houses, each way: plainer houses in a row
  for (const side of [-1, 1]) for (let a = 120; a < 400; a += 7 + r() * 3) {
    const w = 6.5 + r() * 2, h = 6 + r() * 3, m = new Matrix4().makeTranslation(side * (a + w / 2), 0, Z.front - 5);
    building(parts, glass, lit, m, w, 10, h, r, false);
  }
  // the church: its nave, the tower at its front, a stone spire
  const stone = new Color(0xbdb4a0), lead = new Color(0x5f6d68), cm = sideMatrix(CHURCH.s, CHURCH.t);
  parts.push(coloured(new BoxGeometry(11, 13, 30).translate(0, 6.5, -6), cm, stone), coloured(roof(11.6, 30.6, 6).translate(0, 13, -6), cm, ROOFS[0]!));
  parts.push(coloured(new BoxGeometry(7, 27, 7).translate(0, 13.5, 11.5), cm, stone), coloured(new BoxGeometry(7.6, 1, 7.6).translate(0, 27.5, 11.5), cm, stone));
  parts.push(coloured(new ConeGeometry(4.6, 24, 4).rotateY(Math.PI / 4).translate(0, 40, 11.5), cm, lead));
  // the streets' lamps on into the town (only their glow reaches this far)
  const lanterns: Mesh[] = [];
  for (let s = TOWN0; s < 900; s += 30) for (const t of [-4.2, 4.2]) {
    const [x, z] = sidePoint(s + (t > 0 ? 15 : 0), t);
    lanterns.push(block(x - 0.2, 4.8, z - 0.2, x + 0.2, 5.3, z + 0.2, k.lantern));
  }
  const group = new Group();
  group.add(...lanterns);
  // the city's towers, out past the town round the street's line
  const spots = [[1800, -430], [1950, 120], [2150, -160], [2300, 380], [2500, 30], [2650, -560], [2800, 240], [3050, -260], [3200, 620], [2400, -900], [2900, 900]] as const;
  spots.forEach(([s, t], i) => {
    const w = 24 + r() * 20, d = 22 + r() * 18, h = 70 + r() * 95, tg = new Group();
    tg.add(block(-w / 2, 0, -d / 2, w / 2, h, d / 2, k.towers[i % k.towers.length]!), block(-w / 2 + 2, h, -d / 2 + 2, w / 2 - 2, h + 5, d / 2 - 2, k.lead));
    tg.applyMatrix4(sideMatrix(s, t, 0, (r() - 0.5) * 0.5));
    group.add(tg);
  });
  group.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });

  const extra: Mesh[] = [new Mesh(mergeGeometries(parts, false)!, k.town), new Mesh(land(), k.land)];
  const glassMat = new MeshStandardMaterial({ color: 0x2a3038, roughness: 0.25, metalness: 0.3 });
  const litMat = new MeshStandardMaterial({ color: 0x2a3038, roughness: 0.25, metalness: 0.3, emissive: 0xffc27a, emissiveIntensity: 0 });
  k.night.push({ mat: litMat, k: 1.6 }, { mat: glassMat, k: 0 });
  if (glass.length) extra.push(new Mesh(mergeGeometries(glass, false)!, glassMat));
  if (lit.length) extra.push(new Mesh(mergeGeometries(lit, false)!, litMat));
  return { group, extra, trees };
}
