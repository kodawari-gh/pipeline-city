// The bedroom's furniture in 3D, round the desk: plain modern flat-pack pieces in black-brown veneer and black steel, the bookcase in the
// room's one smoked oak (`smokedOak`: the floor's and the desk top's wood, its grain along each board), cloth in muted tones, a
// Japanese lean (a low platform bed, a paper lantern, an ink-wash print), cyan LED strips that light at night, warm ones under the shelves
// (`shelfStrips`). The bed against the back wall
// east of the desk, the bedside drawer and its lantern, the bookcase on the west wall and a tall paper lantern by it, the door and the sconce
// beside it, the ceiling light, the print over the bed and its picture light, the shelf on the east wall, the arc lamp over the desk's front. Every builder takes the room plan (`roomplan.ts`, 2D y down; z out of the back wall) and its tones
// (`palette.ts`) and returns world meshes, each part its own mesh: the room merges the still ones by material (`mergeStatic`). Pure scenery:
// nothing answers a click.
import {
  BoxGeometry, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh, LatheGeometry, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, NoColorSpace, Object3D, PlaneGeometry, RectAreaLight, SphereGeometry, SpotLight, TorusGeometry, Vector2, Vector3, type Material,
  type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DepthMap, bake, type V3 } from '@/core/render/three/contact';
import { instanced, paint, place, post, rectBox, rod, shadowBlob, softBox, tube } from '@/core/render/three/geometry';
import { cloth, mat } from '@/core/render/three/materials';
import { seeThrough } from '@/core/render/three/pick';
import { Drape, breaks, settlePillow, slab, smooth, type BedForm } from './bedding3d';
import { DUVET, LANTERN, NEON, OAK, OAK_GRAIN, RUNNER, SHEET, STEEL, TRIM, VENEER, VENEER_GRAIN, kelvin, shadeOf } from './palette';
import { pothos, succulent } from './plants3d';
import { ARC_LAMP, BED, BOOKCASE, DOOR, EAST_X, FLOOR_LANTERN, FLOOR_Y, NIGHTSTAND, RUG, SCONCE, SHELF, WEST_X, onRug } from './roomplan';

let seedN = 11;
const rnd = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647);

// ---------------------------------------------------------------- materials
/** Cloth: a fine weave with a slub here and there. */
export function weave(base: string, o: { knit?: boolean; repeat?: [number, number] } = {}): Texture | null {
  return paint(256, 256, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    if (o.knit) {
      // rows of little V stitches
      for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
        c.fillStyle = `rgba(255,255,255,${0.06 + rnd() * 0.05})`; c.beginPath(); c.ellipse(x + 2, y + 4, 2.2, 4, 0.5, 0, Math.PI * 2); c.fill();
        c.fillStyle = `rgba(0,0,0,${0.08 + rnd() * 0.05})`; c.beginPath(); c.ellipse(x + 6, y + 4, 2.2, 4, -0.5, 0, Math.PI * 2); c.fill();
      }
    } else {
      for (let i = 0; i < w; i += 2) { c.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.04})`; c.fillRect(i, 0, 1, h); c.fillRect(0, i, w, 1); }
      for (let k = 0; k < 40; k++) { c.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.05})`; c.fillRect(rnd() * w, rnd() * h, 6 + rnd() * 20, 1); }
    }
  }, o.repeat ?? [6, 6]);
}

/** Wood veneer: a close straight grain along the texture's u (pale oak by default). `size` texels a side, the grain as close at every size. */
export function oak(base = '#c49a6c', line = '#8a6440', repeat: [number, number] = [1, 1], size = 256): Texture | null {
  return paint(size, size, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    const k = size / 256;
    for (let i = 0; i < 70 * k; i++) {
      c.strokeStyle = line; c.globalAlpha = 0.05 + rnd() * 0.12; c.lineWidth = (0.6 + rnd() * 1.6) * Math.sqrt(k);
      // a line that waves and comes back to its height at the tile's edge, drawn again a tile up and down: the tile repeats with no seam
      const y = rnd() * h, c1 = (rnd() * 8 - 4) * k, c2 = (rnd() * 8 - 4 + rnd() * 6 - 3) * k;
      for (const dy of [0, -h, h]) { c.beginPath(); c.moveTo(0, y + dy); c.bezierCurveTo(w * 0.3, y + dy + c1, w * 0.6, y + dy + c2, w, y + dy); c.stroke(); }
    }
    c.globalAlpha = 1;
  }, repeat);
}

/**
 * A normal map from a painted map's shade: its dark strokes (the grain's pores, a joint) are grooves, a full stroke `depth` deep (in the
 * map's own texels). It wraps and repeats as the map does. Null with no canvas.
 */
export function relief(map: Texture | null, depth: number): Texture | null {
  const src = map?.image as HTMLCanvasElement | undefined;
  if (!map || !src?.getContext) return null;
  const w = src.width, h = src.height, d = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const at = (x: number, y: number) => { const i = (((y + h) % h) * w + ((x + w) % w)) * 4; return (d[i]! * 0.3 + d[i + 1]! * 0.59 + d[i + 2]! * 0.11) / 255; };
  const t = paint(w, h, (c) => {
    const img = c.createImageData(w, h), o = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // the slope by central differences; the canvas runs down, the texture's v up
      const nx = -(at(x + 1, y) - at(x - 1, y)) * depth, ny = (at(x, y + 1) - at(x, y - 1)) * depth, l = Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
      o[i] = 128 + 127 * (nx / l); o[i + 1] = 128 + 127 * (ny / l); o[i + 2] = 128 + 127 / l; o[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  })!;
  t.colorSpace = NoColorSpace;
  t.wrapS = map.wrapS; t.wrapT = map.wrapT; t.repeat.copy(map.repeat);
  return t;
}

/** Smoked oak's finish: oiled, a soft sheen (rough enough that the window's bars leave no streaks in it). */
export const OAK_ROUGH = 0.68;
/** World units to one width of the oak's grain (`smokedOak`): 60 cm. */
export const OAK_TILE = 11200;
/** How deep the oak's grain is (`relief`). */
const OAK_DEPTH = 3;

/**
 * Smoked oak, the room's one wood (`OAK`): the floor, the desk top, the bookcase. The palette's oak is the material's colour; its map only
 * shades it (white, with the grain in `OAK_GRAIN`'s share of `OAK`), so the planks and every board read as one wood in every light; the
 * grain's relief is a normal map from the same strokes (`relief`). The map is a board's close straight grain by default (lay it along each
 * board with `grainUv`); the floor passes its planks. The grain is the same in every room built: its own stream of random numbers.
 */
export function smokedOak(map?: Texture | null): MeshStandardMaterial {
  if (map === undefined) {
    const keep = seedN;
    seedN = 7919; map = oak('#ffffff', shadeOf(OAK_GRAIN, OAK), [1, 1], 512); seedN = keep;
  }
  return mat(new Color(OAK).getHex(), { map, normalMap: relief(map, OAK_DEPTH), roughness: OAK_ROUGH });
}

/**
 * Lay the grain along each board: as `worldUv`, uvs from where the faces are, `tile` units to the texture's width, but each face's u runs
 * along the longer of its two sides (the grain runs along u), so it stands up a bookcase's side and runs the length of a shelf.
 */
export function grainUv<T extends Mesh>(o: T, tile: number): T {
  const g = o.geometry, at = o.position.toArray(), p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
  g.computeBoundingBox();
  const size = g.boundingBox!.getSize(new Vector3()).toArray();
  for (let i = 0; i < p.count; i++) {
    const q = [p.getX(i) + at[0]!, p.getY(i) + at[1]!, p.getZ(i) + at[2]!], ax = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))];
    // the face's two axes, the longer first
    const [a, b] = ax[0]! >= ax[1]! && ax[0]! >= ax[2]! ? [1, 2] : ax[1]! >= ax[2]! ? [0, 2] : [0, 1];
    const [u, v] = size[a!]! >= size[b!]! ? [a!, b!] : [b!, a!];
    uv.setXY(i, q[u]! / tile, q[v]! / tile);
  }
  uv.needsUpdate = true;
  return o;
}

// ---------------------------------------------------------------- shapes
/** A cushion or pillow: a box whose faces puff out, thick in the middle and thin at the seams. */
export function cushion(w: number, h: number, d: number, puff = 1): BufferGeometry {
  const g = new BoxGeometry(2, 2, 2, 10, 4, 10), p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const fall = (1 - Math.pow(Math.abs(x), 3)) * (1 - Math.pow(Math.abs(z), 3));
    const r = Math.hypot(x, z) || 1, round = Math.max(Math.abs(x), Math.abs(z)) / r;
    p.setXYZ(i, (x * (0.82 + 0.18 * round) * w) / 2, (y * (0.25 + 0.75 * Math.pow(Math.max(0, fall), 0.6 * puff)) * h) / 2, (z * (0.82 + 0.18 * round) * d) / 2);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A stuffed pillow: two cloth panels sewn round their edge. Thick and round in the middle, down to a thin welt at the seam; each edge drawn in
 * between its corners (the stuffing pulls the cloth); the top a little lumpy, `seed` setting where. `w` across (x), `d` deep (z), `h` thick (y).
 */
export function pillow(w: number, h: number, d: number, o: { pinch?: number; lumps?: number; seed?: number } = {}): BufferGeometry {
  const g = new BoxGeometry(2, 2, 2, 24, 2, 18), p = g.attributes.position!;
  const pinch = o.pinch ?? 0.11, lumps = o.lumps ?? 0.06, s = o.seed ?? 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const fill = Math.pow(Math.max(0, (1 - x * x) * (1 - z * z)), 0.3);
    const lump = 1 + lumps * (Math.sin(x * 2.3 + s) * Math.sin(z * 1.9 + s * 1.7) + 0.5 * Math.sin(x * 4.1 - z * 3.3 + s * 2.3)) * fill;
    const px = x * (1 - pinch * (1 - z * z)), pz = z * (1 - pinch * (1 - x * x));
    p.setXYZ(i, (px * w) / 2, (y * (0.14 + 0.86 * fill) * lump * h) / 2, (pz * d) / 2);
  }
  g.computeVertexNormals();
  return g;
}

/** A soft dark patch on the floor under a thing, `lift` over it (more to lie over the rug): a baked contact shadow. */
export function floorShadow(x: number, z: number, w: number, d: number, k = 1, lift = 140): Mesh {
  const m = new Mesh(new PlaneGeometry(w, d), new MeshBasicMaterial({ map: shadowBlob(), transparent: true, opacity: 0.9 * k, depthWrite: false, color: 0x000000 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, -FLOOR_Y + lift, z);
  return seeThrough(m);
}

// ---------------------------------------------------------------- the bed
/** The bed and its night lights: the LED strips' glow, and the area lights they stand for (the floor round the bed, the wall over the headboard). */
export interface Bed { root: Group; glow: MeshStandardMaterial; under: RectAreaLight; halo: RectAreaLight }

/**
 * A low platform bed, plain and flat-pack: a thick black-brown top board on a recessed black apron and feet, so it seems to float, an LED
 * strip under its edge; a flat headboard panel just off the wall, a strip behind its top. Made up as a bed is: the mattress in its fitted
 * sheet, the duvet over it, turned down below the pillows, falling over the sides and the foot and round the foot's corners, a runner across
 * it, two pillows stood against the headboard and two in front leant on them. The cloth lies over what is under it, the pillows are set down
 * and leant back by contact (`bedding3d.ts`): nothing goes into what it lies on.
 */
export function bed(): Bed {
  const g = new Group(), { x, w, z0, z1, head: hd, headTop } = BED, fl = FLOOR_Y, x1 = x + w, cx = x + w / 2;
  const veneer = mat(0xffffff, { map: oak(VENEER, VENEER_GRAIN, [3, 1]), roughness: 0.5 }), black = mat(STEEL, { roughness: 0.8 });
  // the frame (2D y down): the platform's top board down to `under`; the apron, set back `set` from its edges, down to `apron`
  const plat = fl - 4600, under = fl - 3000, apron = fl - 1100, set = 2200;
  const headboard = softBox({ x, y: headTop, w, h: under - headTop }, z0, z0 + hd, veneer, 40), platform = softBox({ x, y: plat, w, h: under - plat }, z0 + hd, z1, veneer, 60);
  headboard.name = 'headboard'; platform.name = 'platform';
  g.add(headboard, platform);
  g.add(softBox({ x: x + set, y: under, w: w - 2 * set, h: apron - under }, z0 + hd + 600, z1 - set, black, 30));
  // its feet under the apron's corners and middles (shorter where they stand on the rug)
  for (const fx of [x + set + 700, x1 - set - 700]) for (const fz of [z0 + hd + 1300, (z0 + z1) / 2, z1 - set - 700]) {
    const ground = onRug(fx, fz) ? fl - RUG.h : fl;
    g.add(softBox({ x: fx - 500, y: apron, w: 1000, h: ground - apron }, fz - 500, fz + 500, black, 30));
  }
  // the LED strips, round the apron's top under the platform's edge and across the headboard's back near its top; each stands for an area light
  const glow = mat(0x101416, { roughness: 0.6, emissive: new Color(NEON), emissiveIntensity: 0 });
  g.add(rectBox({ x: x + set - 40, y: under, w: w - 2 * set + 80, h: 160 }, z0 + hd + 560, z1 - set + 40, glow));
  g.add(rectBox({ x: x + 600, y: headTop + 300, w: w - 1200, h: 160 }, z0 - 60, z0, glow));
  const underL = new RectAreaLight(NEON, 0, w - 800, z1 - z0 - hd - 800);
  underL.position.set(cx, -under - 60, (z0 + hd + z1) / 2);
  underL.rotation.x = -Math.PI / 2;
  const halo = new RectAreaLight(NEON, 0, w - 1200, 300);
  halo.position.set(cx, -(headTop + 380), z0 - 80);
  g.add(underL, halo);

  // the mattress (its top 9000 over the floor, its edges rounded) in its fitted sheet, set in from the platform's edges
  const sheet = cloth(0xffffff, { map: weave(SHEET), roughness: 0.92 });
  const mTop = BED.top, mr = 700, inset = 1100, mx0 = x + inset, mx1 = x1 - inset, mz0 = z0 + hd + 60, mz1 = z1 - inset, mw = mx1 - mx0;
  const mattress = place(new Mesh(new RoundedBoxGeometry(mw, plat - mTop, mz1 - mz0, 4, mr), sheet));
  mattress.position.set(cx, -(mTop + plat) / 2, (mz0 + mz1) / 2);
  g.add(mattress);
  const form: BedForm = { mx0, mx1, mz0, mz1, top: -mTop, r: mr, x0: x, x1, z1, rim: -plat, base: -under };

  // the duvet: from below the pillows (turned down there: doubled) over the foot, its hem down the platform's edge, thinner toward its edges
  const cover = new Drape(form, 40, 260), D = cover.dropTo(-(fl - 4000)), A = cover.a + D, V = cover.b + D;
  const v0 = 14500, band = 3600, T = 620;
  const tD = (u: number, v: number) => T * (0.45 + 0.55 * smooth(0, 1600, Math.min(A - Math.abs(u), V - v))) * (2 - smooth(v0 + band - 220, v0 + band + 220, v));
  // a runner across the foot, on the duvet, its hem a little higher: its edges are rows and columns of the duvet's grid too, so it follows the
  // duvet's own triangles, out along their normals, and never crosses them
  const Dr = cover.dropTo(-(fl - 4800)), Ar = cover.a + Dr, rv0 = 26500, rv1 = 34500;
  const grid = (xs: number[], add: number[]) => [...new Set([...xs, ...add])].sort((a, b) => a - b);
  const us = grid(breaks(-A, A, 500, 260, [[-A, -A + D + 1500], [A - D - 1500, A]]), [-Ar, Ar]);
  const vs = grid(breaks(v0, V, 500, 240, [[v0, v0 + band + 800], [V - D - 1500, V]]), [rv0, rv1]);
  const duvet = slab((u, v) => cover.at(u, v), us, vs, tD, 6000, cloth(0xffffff, { map: weave(DUVET, { repeat: [1, 1] }), roughness: 0.9 }));
  const lift = (u: number, v: number) => tD(u, v) + 50 + 70 * (1 + Math.sin(u / 1300 + v / 900));
  const runner = slab((u, v) => { const { p, n } = cover.at(u, v), k = lift(u, v); return { p: [p[0] + n[0] * k, p[1] + n[1] * k, p[2] + n[2] * k], n }; },
    us.filter((u) => Math.abs(u) <= Ar), vs.filter((v) => v >= rv0 && v <= rv1),
    (u, v) => 260 * (0.6 + 0.4 * smooth(0, 700, Math.min(Ar - Math.abs(u), v - rv0, rv1 - v))), 4000, cloth(0xffffff, { map: weave(RUNNER, { repeat: [1, 1] }), roughness: 0.94 }));
  duvet.name = 'duvet'; runner.name = 'runner'; mattress.name = 'mattress';
  g.add(duvet, runner);

  // the pillows: each set down on what is under it and leant back on what is behind it (the headboard, then the pillows behind), pressed in
  // a little and flattened where it touches; then it holds up those in front
  const down = new DepthMap(1, 1, [x, 0, z0], [x1, 0, z1], 200).add(bake(mattress)).add(duvet.geometry);
  const back = new DepthMap(2, 1, [x, -fl, 0], [x1, -headTop, 0], 120).face(z0 + hd, [x, -fl, 0], [x1, -headTop, 0]);
  const press = { down: 260, back: 320, soft: 140 };
  const lay = (geo: BufferGeometry, m: Material, at: V3, tilt: number, turn: number, order: 'XYZ' | 'YXZ'): Mesh => {
    const o = place(new Mesh(geo, m));
    o.rotation.set(tilt, turn, 0, order);
    o.position.set(...at);
    settlePillow(o, down, back, press);
    o.name = 'pillow';
    g.add(o);
    return o;
  };
  // two in the duvet's cover stood against the headboard, leaning back; two pale ones lying in front, their backs up on them
  const sham = cloth(0xffffff, { map: weave(DUVET, { repeat: [3, 3] }), roughness: 0.92 }), pale = cloth(0xffffff, { map: weave(SHEET, { repeat: [3, 3] }), roughness: 0.9 });
  const shams = [-1, 1].map((s, i) => lay(pillow(mw * 0.48, 2500, 7600, { seed: i * 2.1 }), sham, [cx + s * mw * 0.255, -mTop + 4500, z0 + hd + 3000], -Math.PI / 2 - 0.2, s * 0.02, 'YXZ'));
  for (const o of shams) back.add(o.geometry);
  ([[-1, 0.03, 0.7], [1, -0.04, 3.3]] as const).forEach(([s, turn, seed]) => lay(pillow(mw * 0.45, 3000, 7200, { seed, lumps: 0.08 }), pale, [cx + s * mw * 0.245, -mTop + 2500, z0 + hd + 9000], 0.42, turn, 'XYZ'));
  g.add(floorShadow(cx, (z0 + z1) / 2 + 300, w * 1.05, (z1 - z0) * 1.02, 0.9, 330));
  return { root: g, glow, under: underL, halo };
}

// ---------------------------------------------------------------- the bedside drawer
/** A paper lantern: what holds it, its paper (glows with its bulb), its bulb's glow and where the bulb is (the light's place). */
export interface Lantern { root: Group; shade: MeshStandardMaterial; glow: MeshStandardMaterial; bulb: [number, number, number] }
export type Bedside = Lantern;

/** The lantern's bamboo ribs: rings evenly up its paper (by length along its side). */
const RIBS = 16;
/**
 * Washi paper: long fibres in it, the lantern's ribs dark rings round it (they shade the light from inside), a faint paste line at each. `lit`
 * (0 at the paper's foot, 1 at its top) darkens it away from the bulb: the glow of a tall lantern, brightest at the bulb's height.
 */
function washiTex(lit?: (v: number) => number, r: () => number = rnd): Texture | null {
  return paint(256, 512, (c, w, h) => {
    c.fillStyle = '#ddd6c6'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 900; k++) { c.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.08})`; c.fillRect(r() * w, r() * h, 1, 4 + r() * 14); }
    for (let k = 0; k < 160; k++) { c.fillStyle = `rgba(120,100,70,${0.03 + r() * 0.04})`; c.fillRect(r() * w, r() * h, 1, 6 + r() * 20); }
    for (let k = 0; k <= RIBS; k++) {
      const y = (k * h) / RIBS;
      c.fillStyle = 'rgba(150,130,100,0.18)'; c.fillRect(0, y - 6, w, 12);
      c.fillStyle = 'rgba(62,50,36,0.6)'; c.fillRect(0, y - 1.5, w, 3);
    }
    if (!lit) return;
    // (the canvas's top is the paper's top)
    c.globalCompositeOperation = 'multiply';
    for (let y = 0; y < h; y++) { const k = Math.round(255 * lit(1 - (y + 0.5) / h)); c.fillStyle = `rgb(${k},${k},${k})`; c.fillRect(0, y, w, 1); }
  }, [1, 1]);
}

/** A seeded random stream of its own, so a new builder leaves the shared one (and every piece after it) as it was. */
const stream = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/**
 * The lantern's side, bottom opening to top: a round a little squat (a superellipse, wider than tall, not an egg), resampled evenly along its
 * length so the ribs fall on the paper's rings; between each two ribs the paper sags a little toward the middle.
 */
function lanternProfile(R: number, H: number, rBottom: number, rTop: number): Vector2[] {
  const e = 2.6, f = (t: number) => new Vector2(R * Math.abs(Math.cos(t)) ** (2 / e), (H / 2) * (1 + Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** (2 / e)));
  const t0 = -Math.acos((rBottom / R) ** (e / 2)), t1 = Math.acos((rTop / R) ** (e / 2)), fine: Vector2[] = [], len = [0];
  for (let i = 0; i <= 600; i++) { fine.push(f(t0 + ((t1 - t0) * i) / 600)); if (i) len.push(len[i - 1]! + fine[i]!.distanceTo(fine[i - 1]!)); }
  const out: Vector2[] = [], n = RIBS * 8, mid = new Vector2(0, H / 2);
  for (let k = 0, j = 0; k <= n; k++) {
    const s = (len[600]! * k) / n;
    while (j < 599 && len[j + 1]! < s) j++;
    const p = fine[j]!.clone().lerp(fine[j + 1]!, (s - len[j]!) / Math.max(1e-6, len[j + 1]! - len[j]!));
    out.push(p.sub(mid).multiplyScalar(1 - 0.016 * Math.sin((Math.PI * (k % 8)) / 8)).add(mid));
  }
  return out;
}

/** A floating bedside drawer on the wall (black-brown, one flush push-open front in a shadow line), a paper lantern on a black wire stand, a book and a phone. */
export function nightstand(): Bedside {
  const g = new Group(), { x, w, z0, z1, top, h, lamp } = NIGHTSTAND, fl = FLOOR_Y, cx = x + w / 2, cz = (z0 + z1) / 2;
  const veneer = mat(0xffffff, { map: oak(VENEER, VENEER_GRAIN), roughness: 0.5 }), black = mat(STEEL, { roughness: 0.45, metalness: 0.3 });
  // the box on the wall, the drawer's front nearly flush in it, a dark gap round the front
  g.add(softBox({ x, y: top, w, h }, z0, z1, veneer, 40));
  g.add(rectBox({ x: x + 180, y: top + 180, w: w - 360, h: h - 360 }, z1 - 40, z1 + 6, mat(0x0b0b0c, { roughness: 0.9 })));
  g.add(softBox({ x: x + 210, y: top + 210, w: w - 420, h: h - 420 }, z1 - 40, z1 + 10, veneer, 25));
  // the lantern: a paper round on bamboo ribs, open top and bottom (a black wire ring at each), on a wire stand of three legs; it glows from
  // the bulb inside
  const lx = x + lamp.dx, lz = cz + lamp.dz, legH = 300, sh = lamp.h - legH, R = lamp.r, rb = 0.5 * R, rt = 0.42 * R;
  const paper = washiTex();
  const shade = mat(0xffffff, { map: paper, roughness: 0.9, side: DoubleSide, emissive: new Color(LANTERN), emissiveMap: paper, emissiveIntensity: 0 });
  const prof = lanternProfile(R, sh, rb, rt), y0 = -top + legH;
  const lantern = place(new Mesh(new LatheGeometry(prof, 48), shade));
  lantern.position.set(lx, y0, lz);
  g.add(lantern);
  const yb = y0 + prof[0]!.y, yt = y0 + prof[prof.length - 1]!.y;
  for (const [r, y] of [[rb, yb], [rt, yt]] as const) {
    const ring = place(new Mesh(new TorusGeometry(r, 26, 6, 40), black));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(lx, y, lz);
    g.add(ring);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4, c = Math.cos(a), s = Math.sin(a);
    g.add(rod([lx + c * (rb + 260), -top + 20, lz + s * (rb + 260)], [lx + c * rb, yb, lz + s * rb], 24, black, 6));
  }
  const glow = mat(0xfff3dc, { roughness: 0.4, emissive: new Color(LANTERN), emissiveIntensity: 0 });
  const bulb = new Mesh(new SphereGeometry(420, 18, 12), glow), by = y0 + sh / 2;
  bulb.position.set(lx, by, lz);
  g.add(seeThrough(bulb));
  // a hardcover lying flat (linen boards over a cream page block, its spine east), the phone on it, a little turned
  const bx0 = cx + 950, bx1 = x + w - 100, bz0 = cz - 1900, bz1 = cz + 2100, bh = 420, linen = cloth(0xffffff, { map: weave('#8d8a80', { repeat: [2, 2] }), roughness: 0.85 });
  g.add(softBox({ x: bx0, y: top - 55, w: bx1 - bx0, h: 55 }, bz0, bz1, linen, 20), softBox({ x: bx0, y: top - bh, w: bx1 - bx0, h: 55 }, bz0, bz1, linen, 20));
  g.add(rectBox({ x: bx0 + 50, y: top - bh + 50, w: bx1 - bx0 - 160, h: bh - 100 }, bz0 + 70, bz1 - 70, mat(0xe9e1cf, { roughness: 0.9 })));
  g.add(softBox({ x: bx1 - 170, y: top - bh, w: 170, h: bh }, bz0, bz1, linen, 70));
  const phone = new Group(), alu = mat(0x34363a, { metalness: 0.7, roughness: 0.35 }), glass = mat(0x060708, { roughness: 0.06, metalness: 0.1 });
  phone.add(softBox({ x: -700, y: -150, w: 1400, h: 150 }, -1425, 1425, alu, 60), softBox({ x: -665, y: -162, w: 1330, h: 24 }, -1390, 1390, glass, 10));
  phone.position.set(cx + 2200, -(top - bh), cz + 100);
  phone.rotation.y = 0.18;
  g.add(phone);
  // (it floats: its shadow on the floor is soft and faint)
  g.add(floorShadow(cx, cz + 300, w * 1.3, (z1 - z0) * 1.4, 0.3));
  return { root: g, shade, glow, bulb: [lx, by, lz] };
}

/**
 * A tall paper floor lantern (`FLOOR_LANTERN`): a column of the same washi on bamboo rings, a little barrelled, open at the top, on a black
 * wire foot of three legs; its bulb on a stem up the middle, its paper glowing with it.
 */
export function floorLantern(): Lantern {
  const g = new Group(), { x, z, r: R, h: H, legs } = FLOOR_LANTERN, fl = FLOOR_Y, bulbAt = 0.55;
  const black = mat(STEEL, { roughness: 0.45, metalness: 0.3 });
  // (the same paper twice, the glow's darker away from the bulb: a tall paper is lit by it unevenly)
  const paper = washiTex(undefined, stream(29)), lit = washiTex((v) => 0.42 + 0.58 * Math.exp(-(((v - bulbAt) / 0.32) ** 2)), stream(29));
  const shade = mat(0xffffff, { map: paper, roughness: 0.9, side: DoubleSide, emissive: new Color(LANTERN), emissiveMap: lit, emissiveIntensity: 0 });
  // the side, bottom to top: fullest at the middle, the paper sagging a little between each two ribs
  const n = RIBS * 8, prof: Vector2[] = [];
  for (let k = 0; k <= n; k++) prof.push(new Vector2(R * (0.93 + 0.07 * Math.sin((Math.PI * k) / n)) * (1 - 0.012 * Math.sin((Math.PI * (k % 8)) / 8)), (H * k) / n));
  const y0 = -fl + legs, r0 = prof[0]!.x, col = place(new Mesh(new LatheGeometry(prof, 48), shade));
  col.position.set(x, y0, z);
  g.add(col);
  for (const [r, y] of [[r0, y0], [prof[n]!.x, y0 + H]] as const) {
    const ring = place(new Mesh(new TorusGeometry(r, 30, 6, 48), black));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, y, z);
    g.add(ring);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.9, c = Math.cos(a), s = Math.sin(a);
    g.add(rod([x + c * (r0 + 500), -fl + 20, z + s * (r0 + 500)], [x + c * r0, y0, z + s * r0], 30, black, 6));
  }
  // a cross of wire in the bottom ring holds the stem; the bulb a little over the middle
  const by = y0 + H * bulbAt;
  g.add(rod([x - r0, y0, z], [x + r0, y0, z], 22, black, 4), rod([x, y0, z - r0], [x, y0, z + r0], 22, black, 4), rod([x, y0, z], [x, by - 400, z], 40, black, 6));
  const glow = mat(0xfff3dc, { roughness: 0.4, emissive: new Color(LANTERN), emissiveIntensity: 0 });
  const bulb = new Mesh(new SphereGeometry(420, 18, 12), glow);
  bulb.position.set(x, by, z);
  g.add(seeThrough(bulb));
  g.add(floorShadow(x, z, R * 2.6, R * 2.6, 0.35));
  return { root: g, shade, glow, bulb: [x, by, z] };
}

// ---------------------------------------------------------------- the bookcase
/**
 * A book's spine: a pale cloth ground (each book's own colour tints it) with bands near its ends and a title running up it. Four modern designs:
 * fine rules and a dark label, broad dark ends and a light label, plain with fine rules, a paperback (a long dark title, a white logo at its foot).
 */
const SPINES = 4;
function spineTex(kind: number): Texture | null {
  return paint(64, 512, (c, w, h) => {
    c.fillStyle = '#d2d2d2'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)'; c.fillRect(rnd() * w, rnd() * h, 1, 2 + rnd() * 6); }
    const band = (y: number, t: number, col: string) => { c.fillStyle = col; c.fillRect(0, y, w, t); };
    if (kind === 3) {
      band(0, 18, '#f4f4f4');
      c.fillStyle = '#3a3a3a';
      for (let y = 60; y < h - 120;) { const lh = 9 + rnd() * 7; c.fillRect(w / 2 - 9, y, 18, lh); y += lh + 3 + (rnd() < 0.12 ? 14 : 0); }
      c.fillStyle = '#ffffff'; c.fillRect(w / 2 - 12, h - 80, 24, 30);
      return;
    }
    if (kind === 0) { band(30, 7, '#fff'); band(43, 3, '#fff'); band(h - 46, 3, '#fff'); band(h - 37, 7, '#fff'); }
    else if (kind === 1) { band(0, 64, '#6e6e6e'); band(h - 64, 64, '#6e6e6e'); band(64, 3, '#fff'); band(h - 67, 3, '#fff'); }
    else { band(54, 2, '#fff'); band(h - 56, 2, '#fff'); }
    const ty = kind === 1 ? 140 : 110, th = kind === 1 ? 200 : 250;
    if (kind !== 2) { c.fillStyle = kind === 0 ? '#565656' : '#f6f6f6'; c.fillRect(9, ty, w - 18, th); }
    // the title's letters, up the spine, and the publisher's mark at its foot
    c.fillStyle = kind === 1 ? '#4a4a4a' : '#ffffff';
    for (let y = ty + 16; y < ty + th - 18;) { const lh = 7 + rnd() * 5; c.fillRect(w / 2 - 6, y, 12, lh); y += lh + 4 + (rnd() < 0.18 ? 10 : 0); }
    c.fillStyle = '#ffffff'; c.fillRect(w / 2 - 7, h - 112, 14, 22);
  });
}

/** A book on a shelf: its centre, its depth into the shelf (sx), height (sy) and thickness (sz), its lean round x, its colour and spine design. */
interface Book { x: number; y: number; z: number; sx: number; sy: number; sz: number; lean: number; tone: number; kind: number }

/**
 * The books of a bookcase in four draws: per spine design one instanced box (spine and boards in the book's colour, no top: the page block shows
 * there), and the cream page blocks inside them, set back from the spine and in from the boards.
 */
function shelvedBooks(books: readonly Book[]): Group {
  const g = new Group(), box = new BoxGeometry(1, 1, 1), d = new Object3D(), col = new Color();
  // the cover: its spine (+x) rounded across the book's thickness, as a bound book's back is
  const cover = new BoxGeometry(1, 1, 1, 1, 1, 8), cp = cover.attributes.position!;
  for (let i = 0; i < cp.count; i++) if (cp.getX(i) > 0.49) cp.setX(i, 0.5 + 0.035 * (1 - 4 * cp.getZ(i) ** 2));
  cover.computeVertexNormals();
  const board = mat(0xd2d2d2, { roughness: 0.75 }), hidden = new MeshBasicMaterial({ visible: false });
  const pages = paint(128, 128, (c, w, h) => { c.fillStyle = '#efe7d4'; c.fillRect(0, 0, w, h); for (let i = 0; i < h; i += 2) { c.fillStyle = `rgba(120,100,70,${0.05 + rnd() * 0.08})`; c.fillRect(0, i, w, 1); } });
  const put = (m: InstancedMesh, i: number, b: Book, sx: number, sy: number, sz: number, dx: number) => {
    d.position.set(b.x + dx, b.y, b.z); d.rotation.set(b.lean, 0, 0); d.scale.set(sx, sy, sz); d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
  };
  for (let kind = 0; kind < SPINES; kind++) {
    const set = books.filter((b) => b.kind === kind);
    if (!set.length) continue;
    // BoxGeometry's groups: +x (the spine, to the room), -x, +y, -y, +z, -z
    const m = new InstancedMesh(cover, [mat(0xffffff, { map: spineTex(kind), roughness: 0.7 }), board, hidden, hidden, board, board], set.length);
    set.forEach((b, i) => { put(m, i, b, b.sx, b.sy, b.sz, 0); m.setColorAt(i, col.setHex(b.tone)); });
    g.add(place(m));
  }
  const p = new InstancedMesh(box, mat(0xffffff, { map: pages, roughness: 0.9 }), books.length);
  books.forEach((b, i) => put(p, i, b, b.sx - 90, b.sy - 70, b.sz - 70, -45));
  g.add(place(p));
  return g;
}

/** The bookcase's sides' and boards' thickness, and how many shelves of books it holds (a board over each, one under the last). */
const CASE_BOARDS = { side: 450, board: 400, n: 5 } as const;

/** A shelf strip's width (units; about 1 cm), its line's and its light's. */
export const STRIP_W = 200;

/** A warm LED strip's line under a board, along z: `x` its front's x, `y` the board's underside (2D y down). */
function stripLine(x: number, y: number, z0: number, z1: number, glow: Material): Mesh { return rectBox({ x: x - STRIP_W, y, w: STRIP_W, h: 110 }, z0, z1, glow); }

/**
 * The warm LED strips (2700 K) under the bookcase's boards, one over each shelf of books at its front edge, and under the east wall's shelf:
 * each a thin glowing line and the area light it stands for, shining down. Their light comes on with the evening (the room sets it).
 */
export function shelfStrips(): { root: Group; glow: MeshStandardMaterial; lights: RectAreaLight[] } {
  const g = new Group(), lights: RectAreaLight[] = [], glow = mat(0x16130f, { roughness: 0.6, emissive: new Color(kelvin(2700)), emissiveIntensity: 0 });
  // (each at its board's front edge, its light tilted `tilt` back toward the books, or toward the wall: a strip in an angled profile)
  const add = (x: number, y: number, z0: number, z1: number, tilt: number) => {
    g.add(stripLine(x, y, z0, z1, glow));
    const l = new RectAreaLight(kelvin(2700), 0, STRIP_W, z1 - z0);
    l.position.set(x - STRIP_W / 2, -y - 120, (z0 + z1) / 2);
    l.rotation.set(-Math.PI / 2, tilt, 0);
    lights.push(l);
  };
  const { x, w, z0, z1, top } = BOOKCASE, { side, board, n } = CASE_BOARDS, gap = (FLOOR_Y - top - 1400) / n;
  for (let s = 0; s < n; s++) add(x + w - 120, top + s * gap + board, z0 + side + 200, z1 - side - 200, 0.6);
  add(EAST_X - SHELF.d + STRIP_W + 120, SHELF.y + 900, SHELF.z0 + 400, SHELF.z1 - 400, -0.6);
  g.add(...lights);
  return { root: g, glow, lights };
}

/**
 * A plain flat-pack bookcase in smoked oak on the west wall, facing the room: square sides, a flat top flush between them, a plain back, a
 * set-back plinth; five shelves of books (upright, leaning, stacked), a plant, a box, a bookend, a pothos on top.
 */
export function bookcase(): Group {
  const g = new Group(), { x, w, z0, z1, top } = BOOKCASE, fl = FLOOR_Y, xf = x + w;
  const oakMat = smokedOak(), wood = (m: Mesh) => grainUv(m, OAK_TILE);
  const { side, board: shelf } = CASE_BOARDS;
  g.add(wood(softBox({ x, y: top, w, h: fl - top }, z0, z0 + side, oakMat, 50)), wood(softBox({ x, y: top, w, h: fl - top }, z1 - side, z1, oakMat, 50)));
  // the back: one plain board in the same finish, between the sides
  g.add(wood(rectBox({ x, y: top, w: 300, h: fl - top }, z0 + side, z1 - side, oakMat)));
  // the shelf-pin holes up the inside of each side, two rows (front and back)
  const pins: { x: number; y: number; z: number }[] = [];
  for (const pz of [z0 + side, z1 - side]) for (const px of [x + 1300, xf - 900]) for (let py = top + 1200; py < fl - 1600; py += 640) pins.push({ x: px, y: -py, z: pz });
  const hole = new CylinderGeometry(70, 70, 24, 8); hole.rotateX(Math.PI / 2);
  g.add(instanced(hole, mat(0x0c0c0d, { roughness: 0.9 }), pins));
  const { n } = CASE_BOARDS, gap = (fl - top - 1400) / n;
  // the bindings: neutrals, slate blues, a sage, a sand, and the room's terracotta as the one warm colour
  const tones = [0x1f2023, 0xd9d6cf, 0x5b6470, 0x2f4a63, 0xb5532f, 0x8a8f96, 0x3c4a3e, 0xc9b28a, 0x26303d, 0x3a3f47];
  const books: Book[] = [];
  const steel = mat(0x3a3c40, { metalness: 0.6, roughness: 0.4 });
  // (the same books in every room built: the light bake finds the bookend by where it stands, `lightmapmix.ts`)
  seedN = 11;
  for (let s = 0; s <= n; s++) {
    const y = top + s * gap, base = y + gap;
    g.add(wood(softBox({ x, y, w, h: shelf }, z0 + side - 10, z1 - side + 10, oakMat, 40)));
    if (s === n) continue;
    // upright books along the shelf (spines to the room); some shelves leave room for a thing or two
    let z = z0 + side + 160;
    const end = z1 - side - (s % 2 ? 4200 : s === 0 ? 5900 : s === 2 ? 2700 : 400);
    let last = 0;
    while (z < end) {
      const bw = 380 + rnd() * 560, bh = gap * (0.6 + rnd() * 0.3) * (s === n - 1 ? 1.08 : 1), bd = 2900 + rnd() * 1300;
      if (z + bw > end) break;
      books.push({ x: x + 360 + bd / 2, y: -base + bh / 2, z: z + bw / 2, sx: bd, sy: bh, sz: bw, lean: 0, tone: tones[Math.floor(rnd() * tones.length)]!, kind: Math.floor(rnd() * SPINES) });
      z += bw + 15 + (rnd() < 0.12 ? 120 : 0);
      last = bh;
    }
    if (s === 0) {
      // a stack lying flat at the end, the biggest at the bottom
      let sy = base;
      for (let k = 0; k < 4; k++) {
        const t = 380 + rnd() * 220, bd = 3600 - k * 260, bl = 5200 - k * 400;
        books.push({ x: x + 360 + bd / 2, y: -sy + t / 2, z: z1 - side - 2900 + (rnd() - 0.5) * 300, sx: bd, sy: bl, sz: t, lean: Math.PI / 2, tone: tones[Math.floor(rnd() * tones.length)]!, kind: k % 3 });
        sy -= t;
      }
    } else if (s === 2) {
      // the last book leans on the run, its top on the last upright one
      const bh = gap * 0.78, t = 520, a = 0.32;
      books.push({ x: x + 360 + 1700, y: -base + (bh / 2) * Math.cos(a) + (t / 2) * Math.sin(a), z: z + (t / 2) * Math.cos(a) + (bh / 2) * Math.sin(a), sx: 3400, sy: bh, sz: t, lean: -a, tone: tones[(s * 3) % tones.length]!, kind: 1 });
    } else if (s === n - 1) {
      // a steel bookend holds the end of the bottom run, its foot under the last books
      const bh = Math.min(last, gap * 0.6);
      g.add(rectBox({ x: x + 1400, y: base - 50, w: 2200, h: 50 }, z - 1500, z + 60, steel), rectBox({ x: x + 1400, y: base - bh, w: 2200, h: bh }, z, z + 60, steel));
    }
    if (s % 2) {
      const tz = z1 - side - 2200;
      if (s === 1) g.add(succulent(xf - 2600, base, tz, 1000));
      else g.add(softBox({ x: x + 900, y: base - 1800, w: 3800, h: 1800 }, tz - 1600, tz + 1600, mat(0x1b1c1f, { roughness: 0.6 }), 120), softBox({ x: x + 880, y: base - 1880, w: 3840, h: 200 }, tz - 1640, tz + 1640, mat(0x26272b, { roughness: 0.6 }), 60));
    }
  }
  g.add(shelvedBooks(books));
  // the plinth, set back under the bottom shelf (a shadow line along the floor)
  g.add(wood(softBox({ x: x + 300, y: fl - 1000, w: w - 700, h: 1000 }, z0 + side, z1 - side, oakMat, 40)));
  // a pothos on the top, trailing over the front edge
  g.add(pothos(x + w / 2 + 300, top, z1 - 2200, xf + 80, [{ dz: 600, len: 9000 }, { dz: -900, len: 5200 }, { dz: 1500, len: 13000 }]));
  g.add(floorShadow(x + w / 2, (z0 + z1) / 2, w * 1.6, (z1 - z0) * 1.1, 0.7));
  return g;
}

// ---------------------------------------------------------------- the door, the ceiling light, the print, the plant
/**
 * A flush charcoal door in the west wall near the front: a slim square architrave in the trim's tone, the plain leaf in its frame with a dark
 * gap round it, hidden hinges, a black lever on a square rose and a small keyhole plate, a black threshold strip, a stop on the floor, and a
 * flat black light switch beside it.
 */
export function door(): Group {
  const g = new Group(), { z0, z1, top } = DOOR, fl = FLOOR_Y, trim = mat(TRIM, { roughness: 0.45 }), xs = WEST_X;
  // (in the wall's plane: y down, z along the wall; x out of the wall into the room)
  const slab = (y0: number, y1: number, za: number, zb: number, x0: number, x1: number, m: Material, r = 40) => softBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, za, zb, m, r);
  // the architrave: three square-edged boards round the opening
  const cw = 900;
  g.add(slab(top - cw, top, z0 - cw, z1 + cw, xs, xs + 160, trim, 20));
  for (const [a, b] of [[z0 - cw, z0], [z1, z1 + cw]] as const) g.add(slab(top, fl, a, b, xs, xs + 160, trim, 20));
  // the frame's dark gap round the leaf, the leaf
  g.add(rectBox({ x: xs - 320, y: top, w: 100, h: fl - top }, z0, z1, mat(0x0e0f11, { roughness: 0.9 })));
  const face = xs + 110, leaf = mat(0x2a2e35, { roughness: 0.5 });
  g.add(slab(top + 70, fl - 150, z0 + 70, z1 - 70, xs - 220, face, leaf, 25));
  // the lever: a square rose, a short neck, a straight square-section bar along the door; a keyhole plate under it
  const black = mat(0x1d1e20, { metalness: 0.4, roughness: 0.4 }), dark = mat(0x0d0d0e, { roughness: 0.7 }), hy = fl - 19000, hz = z0 + 1350;
  g.add(slab(hy - 480, hy + 480, hz - 480, hz + 480, face, face + 90, black, 40));
  g.add(slab(hy - 110, hy + 110, hz - 110, hz + 110, face + 90, face + 620, black, 40));
  g.add(slab(hy - 120, hy + 120, hz - 110, hz + 2300, face + 520, face + 760, black, 60));
  g.add(slab(hy + 1400, hy + 2000, hz - 300, hz + 300, face, face + 70, black, 30), slab(hy + 1600, hy + 1800, hz - 40, hz + 40, face + 70, face + 76, dark, 5));
  // the threshold: a black aluminium strip across the opening on the floor
  g.add(softBox({ x: xs - 300, y: fl - 120, w: 900, h: 120 }, z0, z1, mat(STEEL, { roughness: 0.4, metalness: 0.5 }), 40));
  // a stop on the floor where the door swings open
  g.add(post(xs + 12500, fl, z1 - 1200, 330, 700, black, 20), post(xs + 12500, fl - 700, z1 - 1200, 300, 120, mat(0x2b2c2e, { roughness: 0.9 }), 20));
  // the light switch beside the door: a thin square plate in black glass, a wide rocker
  g.add(slab(fl - 22300, fl - 20900, z1 + 1500, z1 + 2900, xs, xs + 110, mat(0x141518, { roughness: 0.2, metalness: 0.1 }), 40));
  g.add(slab(fl - 22100, fl - 21100, z1 + 1700, z1 + 2700, xs + 110, xs + 170, mat(0x1d1f23, { roughness: 0.35 }), 40));
  return g;
}

/**
 * A slim round LED ceiling light (y: the ceiling, 2D y down): a dark body off the ceiling on a short shadow line, its opal face; the face
 * glows when lit.
 */
export function ceilingLight(x: number, y: number, z: number): { root: Group; glow: MeshStandardMaterial } {
  const g = new Group(), r = 5000;
  g.add(place(post(x, y + 250, z, r - 300, 250, mat(0x0e0f11, { roughness: 0.9 }), 64), false));
  g.add(place(post(x, y + 900, z, r, 650, mat(0x2a2d33, { roughness: 0.5 }), 64), false));
  const glow = mat(0xcfccc6, { roughness: 0.5, emissive: new Color(0xffe6c4), emissiveIntensity: 0 });
  g.add(place(post(x, y + 940, z, r - 250, 40, glow, 64), false));
  return { root: g, glow };
}

/** A framed print over the bed: a thin black frame, an ink-wash scene on warm paper (misty ridges, a small vermilion sun, a red seal). */
export function print(r: { x: number; y: number; w: number; h: number }, z: number): Group {
  const g = new Group();
  g.add(softBox(r, z, z + 380, mat(0x111214, { roughness: 0.45 }), 30));
  const art = paint(512, 360, (c, w, h) => {
    c.fillStyle = '#bdb5a3'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 500; k++) { c.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.05})`; c.fillRect(rnd() * w, rnd() * h, 1, 3 + rnd() * 8); }
    c.fillStyle = '#b8432c'; c.beginPath(); c.arc(w * 0.7, h * 0.27, h * 0.065, 0, Math.PI * 2); c.fill();
    // the ridges, far to near: each darker, its peaks sharp, its foot fading into mist
    for (const [tone, base, amp, f, ph] of [['118,114,106', 0.5, 0.2, 1.7, 0.4], ['82,80,76', 0.66, 0.17, 2.3, 2.1], ['40,39,38', 0.82, 0.13, 1.3, 4.2]] as const) {
      const fog = c.createLinearGradient(0, h * (base - amp), 0, h * (base + 0.2));
      fog.addColorStop(0, `rgba(${tone},0.95)`); fog.addColorStop(1, `rgba(${tone},0)`);
      c.fillStyle = fog; c.beginPath(); c.moveTo(0, h);
      for (let i = 0; i <= 96; i++) {
        const u = i / 96, peak = 0.6 * Math.abs(Math.sin(u * Math.PI * f + ph)) + 0.3 * Math.abs(Math.sin(u * Math.PI * f * 2.7 + ph * 1.7)) + 0.1 * Math.sin(u * 47 + ph);
        c.lineTo(u * w, h * (base - amp * peak));
      }
      c.lineTo(w, h); c.closePath(); c.fill();
    }
    c.fillStyle = '#a8352a'; c.fillRect(w * 0.08, h * 0.8, 12, 16);
  });
  const face = new Mesh(new PlaneGeometry(r.w - 500, r.h - 500), mat(0xffffff, { map: art, roughness: 0.85 }));
  face.position.set(r.x + r.w / 2, -(r.y + r.h / 2), z + 392);
  g.add(face);
  return g;
}

/**
 * A picture light over a framed print (`r` the frame, `z` the wall): a slim black bar on a short arm from a wall plate over the frame, a warm
 * slot under it; its area light (3000 K) shines down and back onto the print.
 */
export function pictureLight(r: { x: number; y: number; w: number; h: number }, z: number): { root: Group; glow: MeshStandardMaterial; light: RectAreaLight } {
  const g = new Group(), black = mat(0x1d1e20, { metalness: 0.4, roughness: 0.4 }), cx = r.x + r.w / 2, len = r.w * 0.6, by = r.y - 900, bz = z + 2600;
  // the wall plate, the arm out from it and down to the bar, the bar (`by` its underside)
  g.add(softBox({ x: cx - 900, y: by - 1300, w: 1800, h: 900 }, z, z + 120, black, 30));
  g.add(rectBox({ x: cx - 90, y: by - 940, w: 180, h: 180 }, z + 120, bz, black), rectBox({ x: cx - 90, y: by - 940, w: 180, h: 500 }, bz - 90, bz + 90, black));
  g.add(softBox({ x: cx - len / 2, y: by - 450, w: len, h: 450 }, bz - 260, bz + 260, black, 60));
  const glow = mat(0x16130f, { roughness: 0.6, emissive: new Color(kelvin(3000)), emissiveIntensity: 0 });
  g.add(rectBox({ x: cx - len / 2 + 200, y: by, w: len - 400, h: 70 }, bz - 150, bz + 150, glow));
  // (tilted back toward the wall, onto the print's middle)
  const light = new RectAreaLight(kelvin(3000), 0, len - 400, 300);
  light.position.set(cx, -by - 80, bz);
  light.rotation.x = -Math.PI / 2 + 0.45;
  g.add(light);
  return { root: g, glow, light };
}

/**
 * The wall sconce north of the door (`SCONCE`): a slim black box off the west wall on a plate, open at both ends; a warm glow in each opening
 * and the two spots (2700 K) it stands for, one up and one down the plaster.
 */
export function sconce(): { root: Group; glow: MeshStandardMaterial; up: SpotLight; down: SpotLight } {
  const g = new Group(), { z, y } = SCONCE, xs = WEST_X, h = 4200, w = 1500, d = 1500, x0 = xs + 700, black = mat(0x1d1e20, { metalness: 0.3, roughness: 0.5 });
  // (in the wall's plane: 2D y down, z along the wall; x out of the wall into the room)
  g.add(softBox({ x: xs, y: y - 900, w: 120, h: 1800 }, z - 500, z + 500, black, 30), rectBox({ x: xs + 120, y: y - 200, w: x0 - xs - 120, h: 400 }, z - 200, z + 200, black));
  g.add(softBox({ x: x0, y: y - h / 2, w: d, h }, z - w / 2, z + w / 2, black, 60));
  const glow = mat(0x16130f, { roughness: 0.6, emissive: new Color(kelvin(2700)), emissiveIntensity: 0 });
  for (const gy of [y - h / 2 - 10, y + h / 2 - 10]) g.add(rectBox({ x: x0 + 160, y: gy, w: d - 320, h: 20 }, z - w / 2 + 160, z + w / 2 - 160, glow));
  // the two spots, each out of its opening along the wall: a cone up to the ceiling, a wider one down, its head turned a little to the door
  // (`lean`: along z, a part of the way down)
  const spot = (dy: number, angle: number, lean: number) => {
    const s = new SpotLight(kelvin(2700), 0, 0, angle, 0.6, 2), sy = -(y + dy);
    s.position.set(x0 + d / 2, sy, z);
    s.target.position.set(x0 + d / 2, sy - Math.sign(dy) * 20000, z + lean * 20000);
    g.add(s, s.target);
    return s;
  };
  return { root: g, glow, up: spot(-h / 2 - 100, 0.5, 0), down: spot(h / 2 + 100, 0.6, 0.3) };
}

/**
 * The arc floor lamp east of the desk (`ARC_LAMP`): a round slab of dark stone on the rug, a black steel stem straight up from it that arcs over
 * and down onto a knuckle over a washi dome on bamboo ribs (the lanterns' paper), hung level over the desk east of the case, its mouth down.
 * A warm diffuser in its mouth, the paper glowing with it; the wide spot it stands for (2700 K) is an overhead cozy light: a soft pool on the
 * desk, the case's top and its open side.
 */
export function arcLamp(): { root: Group; shade: MeshStandardMaterial; glow: MeshStandardMaterial; light: SpotLight } {
  const g = new Group(), { x, z, head } = ARC_LAMP, on = onRug(x, z), fl = FLOOR_Y - (on ? RUG.h : 0), R = 2600, H = 1900;
  const black = mat(0x1a1b1e, { metalness: 0.5, roughness: 0.4 }), stone = mat(0x26272a, { roughness: 0.3 });
  g.add(post(x, fl, z, 2600, 800, stone, 48), post(x, fl - 800, z, 360, 600, black, 20), floorShadow(x, z, 7000, 7000, 0.4, on ? RUG.h + 140 : 140));
  // the dome: its mouth, its axis straight down, its crown over it; the arc comes down onto a knuckle over the crown
  const mouth = new Vector3(head.x, -head.y, head.z), axis = new Vector3(0, -1, 0);
  const crown = mouth.clone().addScaledVector(axis, -H), knuckle = crown.clone().add(new Vector3(0, 900, 0));
  // (a cubic curve: straight up out of the base, straight down onto the knuckle, its top about 2.1 m over the floor)
  const b0 = new Vector3(x, -fl + 1400, z), b1 = new Vector3(x, 28000, z), b2 = new Vector3(knuckle.x, 28000, knuckle.z), arc: V3[] = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16, u = 1 - t, p = b0.clone().multiplyScalar(u * u * u).addScaledVector(b1, 3 * u * u * t).addScaledVector(b2, 3 * u * t * t).addScaledVector(knuckle, t * t * t);
    arc.push([p.x, p.y, p.z]);
  }
  g.add(tube(arc, 200, black, 12), rod([knuckle.x, knuckle.y, knuckle.z], [crown.x, crown.y, crown.z], 110, black, 8));
  const ball = new Mesh(new SphereGeometry(280, 16, 10), black);
  ball.position.copy(knuckle);
  g.add(place(ball));
  // (the paper's side, mouth to crown: a quarter round, a little flattened, a small hole at the crown for the stem; the paper glows most near
  // the bulb, a little in from its mouth; a black wire ring round the mouth)
  const dome = new Group(), prof: Vector2[] = [];
  for (let k = 0; k <= RIBS * 2; k++) { const t = (k / (RIBS * 2)) * (Math.PI / 2 - 0.12); prof.push(new Vector2(R * Math.cos(t), H * Math.sin(t))); }
  const paper = washiTex(undefined, stream(53)), lit = washiTex((v) => 0.45 + 0.55 * Math.exp(-(((v - 0.3) / 0.4) ** 2)), stream(53));
  const shade = mat(0xffffff, { map: paper, roughness: 0.9, side: DoubleSide, emissive: new Color(LANTERN), emissiveMap: lit, emissiveIntensity: 0 });
  const rim = new Mesh(new TorusGeometry(R, 30, 6, 48), black);
  rim.rotation.x = Math.PI / 2;
  const glow = mat(0xfff3dc, { roughness: 0.4, emissive: new Color(kelvin(2700)), emissiveIntensity: 0 });
  const disc = new Mesh(new CircleGeometry(R * 0.8, 40), glow);
  disc.rotation.x = Math.PI / 2;
  disc.position.y = 500;
  // (the paper lets the light through: it casts no shadow)
  dome.add(new Mesh(new LatheGeometry(prof, 48), shade), place(rim), seeThrough(disc));
  dome.position.copy(mouth);
  g.add(dome);
  // (the bulb sits just inside the mouth: the paper lets it light nearly a half sphere, fading out to its edge)
  const light = new SpotLight(kelvin(2700), 0, 0, 1.25, 0.3, 2);
  light.position.copy(mouth).addScaledVector(axis, -300);
  light.target.position.copy(mouth).addScaledVector(axis, 20000);
  g.add(light, light.target);
  return { root: g, shade, glow, light };
}

/**
 * The east wall's shelf past the bed's foot: a thick black-brown floating board with two books, a small speaker with a cyan status light and a
 * trailing plant, and a framed poster above it (a thin cyan circle on a dark ground). The east wall faces -x: this group builds on a back wall
 * (z out of it) and turns to it.
 */
export function eastWall(): Group {
  const g = new Group(), wall = new Group(), wood = mat(0xffffff, { map: oak(VENEER, VENEER_GRAIN), roughness: 0.5 });
  // (a layout x here runs along the east wall from its back corner: x = the room's z)
  const sx = SHELF.z0, sw = SHELF.z1 - SHELF.z0, sy = SHELF.y, sd = SHELF.d;
  wall.add(softBox({ x: sx, y: sy, w: sw, h: 900 }, 0, sd, wood, 70));
  let y = sy;
  ([0xd9d6cf, 0x26303d] as const).forEach((c, k) => {
    const t = 480 - k * 60;
    wall.add(softBox({ x: sx + 900 + k * 160, y: y - t, w: 4200 - k * 420, h: t }, 400 + k * 90, 3300 - k * 140, mat(c, { roughness: 0.75 }), 40));
    y -= t;
  });
  // the speaker: a cylinder in dark fabric, a black top, its status light
  const cx = sx + 7400, cz = sd / 2;
  wall.add(post(cx, sy, cz, 760, 2000, cloth(0x2a2b2e, { roughness: 0.95 }), 32), post(cx, sy - 2000, cz, 740, 50, mat(0x111214, { roughness: 0.35 }), 32));
  wall.add(post(cx, sy - 2050, cz, 150, 10, mat(0x0b1a1d, { roughness: 0.4, emissive: new Color(NEON), emissiveIntensity: 0.8 }), 16));
  // a pothos at the east end: built facing +x, turned so its vines trail over the shelf's front edge
  const vine = pothos(0, 0, 0, sd - 1500, [{ dz: 300, len: 7000 }, { dz: -500, len: 4200 }]);
  vine.rotation.y = -Math.PI / 2;
  vine.position.set(sx + sw - 2400, -sy, 1500);
  wall.add(vine);
  // a framed poster above: a thin cyan circle and a fine grid on a dark ground
  const r = { x: sx + 1500, y: -18500, w: 11000, h: 13800 };
  wall.add(softBox(r, 0, 320, mat(0x111214, { roughness: 0.45 }), 30));
  const art = paint(384, 480, (c, w, h) => {
    c.fillStyle = '#16181d'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(120,130,150,0.12)'; c.lineWidth = 1;
    for (let x = 24; x < w; x += 24) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let y = 24; y < h; y += 24) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.strokeStyle = '#3be3ff'; c.lineWidth = 3; c.beginPath(); c.arc(w * 0.5, h * 0.42, w * 0.3, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#c8432b'; c.beginPath(); c.arc(w * 0.5 + w * 0.3 * Math.cos(-0.7), h * 0.42 + w * 0.3 * Math.sin(-0.7), 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(200,210,225,0.55)';
    for (let k = 0; k < 4; k++) c.fillRect(w * 0.2, h * 0.8 + k * 9, w * (0.6 - k * 0.12), 3);
  });
  const face = new Mesh(new PlaneGeometry(r.w - 500, r.h - 500), mat(0xffffff, { map: art, roughness: 0.6 }));
  face.position.set(r.x + r.w / 2, -(r.y + r.h / 2), 330);
  wall.add(face);
  wall.rotation.y = -Math.PI / 2;
  wall.position.x = EAST_X;
  g.add(wall);
  return g;
}
