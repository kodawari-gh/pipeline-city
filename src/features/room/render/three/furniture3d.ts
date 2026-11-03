// The bedroom's furniture in 3D, round the desk (docs/LOWPOLY_STYLE.md "Look decision": soft edges, warm wood, soft cloth): the bed against the back
// wall east of the desk, the bedside table and its lamp, the bookcase on the west wall, the radiator under the window, the curtains, the door, the
// ceiling light, a print over the bed, the shelf on the east wall, plants. Every builder takes the room plan (`roomplan.ts`,
// 2D y down; z out of the back wall) and returns world meshes, built as a maker would (rails, fronts, mouldings, seams), each part its own mesh:
// the room merges the still ones by material (`mergeStatic`). Pure scenery: nothing answers a click.
import {
  BackSide, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh, LatheGeometry, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, SphereGeometry, SplineCurve, TorusGeometry, Vector2, type Material,
  type Texture,
} from 'three';
import { drum, instanced, paint, place, post, rectBox, rod, shadowBlob, softBox, tube } from '@/core/render/three/geometry';
import { frameLoft, ribbon, taperTube, type ProfilePt } from '@/core/render/three/loft';
import { cloth, mat } from '@/core/render/three/materials';
import { seeThrough } from '@/core/render/three/pick';
import { pothos, succulent } from './plants3d';
import { BED, BOOKCASE, DOOR, EAST_X, FLOOR_Y, NIGHTSTAND, WEST_X, WINDOW } from './roomplan';

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

/** A quilted cover: the weave, stitched in squares (`n` a side per tile), each square puffed (lighter in its middle). Also its bump map. */
function quilt(base: string, n: number, repeat: [number, number]): Texture | null {
  return paint(512, 512, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 2) { c.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.03})`; c.fillRect(i, 0, 1, h); c.fillRect(0, i, w, 1); }
    const s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const g = c.createRadialGradient((i + 0.5) * s, (j + 0.5) * s, s * 0.05, (i + 0.5) * s, (j + 0.5) * s, s * 0.72);
      g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(1, 'rgba(60,45,30,0.14)');
      c.fillStyle = g; c.fillRect(i * s, j * s, s, s);
    }
    c.strokeStyle = 'rgba(70,55,40,0.35)'; c.lineWidth = 2; c.setLineDash([7, 5]);
    for (let k = 0; k <= n; k++) { c.beginPath(); c.moveTo(k * s, 0); c.lineTo(k * s, h); c.stroke(); c.beginPath(); c.moveTo(0, k * s); c.lineTo(w, k * s); c.stroke(); }
  }, repeat);
}

/** A chunky knit: rows of fat V stitches, deep shadow between them (for a throw: its colour, and its bump). */
function chunky(base: string, repeat: [number, number]): Texture | null {
  return paint(256, 256, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
      c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(x + 7, y, 2, 16);
      for (const [dx, a] of [[4, 0.55], [12, -0.55]] as const) {
        const g = c.createLinearGradient(x + dx - 4, 0, x + dx + 4, 0);
        g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(0.5, `rgba(255,255,255,${0.2 + rnd() * 0.06})`); g.addColorStop(1, 'rgba(0,0,0,0.12)');
        c.fillStyle = g; c.beginPath(); c.ellipse(x + dx, y + 8, 3.6, 7.6, a, 0, Math.PI * 2); c.fill();
      }
    }
  }, repeat);
}

/** Pale oak: a close straight grain. */
export function oak(base = '#c49a6c', line = '#8a6440', repeat: [number, number] = [1, 1]): Texture | null {
  return paint(256, 256, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      c.strokeStyle = line; c.globalAlpha = 0.05 + rnd() * 0.12; c.lineWidth = 0.6 + rnd() * 1.6;
      const y = rnd() * h;
      c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(w * 0.3, y + rnd() * 8 - 4, w * 0.6, y + rnd() * 8 - 4, w, y + rnd() * 6 - 3); c.stroke();
    }
    c.globalAlpha = 1;
  }, repeat);
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

/**
 * A soft slab of cloth (a duvet, a throw) laid over a box: its edges fall over the sides, its top rumpled a little. `hem` folds the hanging
 * cloth: soft flutes that grow toward the hem (in and out, as cloth hangs), the hem itself only a little uneven.
 */
function drape(w: number, h: number, d: number, rumple: number, radius: number, hem = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d, 32, 6, 32), p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ex = Math.max(0, Math.abs(x) - (w / 2 - radius)), ez = Math.max(0, Math.abs(z) - (d / 2 - radius)), ey = Math.max(0, y - (h / 2 - radius));
    // round the top edges and corners
    const e = Math.hypot(ex, ez, ey);
    if (e > radius) { const k = radius / e; x -= Math.sign(x) * ex * (1 - k); z -= Math.sign(z) * ez * (1 - k); y -= ey * (1 - k); }
    if (y > -h / 2 + 1) y += rumple * (Math.sin(x / 2300 + z / 3100) * 0.6 + Math.sin(z / 1700 - x / 4100) * 0.4) * (y > 0 ? 1 : 0.4);
    if (hem && y < h / 2 - radius) {
      const down = Math.min(1, (h / 2 - radius - y) / (h - radius)), along = Math.abs(x) > w / 2 - radius ? z : x;
      const fold = Math.sin(along / 1100 + 0.7) * 0.6 + Math.sin(along / 530 + 2.1) * 0.4;
      y += hem * 0.2 * fold * down * down;
      const out = hem * (0.15 + 0.55 * fold * down) * Math.sin(Math.PI * 0.5 * Math.min(1, down * 1.6));
      if (Math.abs(x) > w / 2 - radius) x += Math.sign(x) * out;
      if (Math.abs(z) > d / 2 - radius) z += Math.sign(z) * out;
    }
    p.setXYZ(i, x, y, z);
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
/** The bed: an oak frame on short legs, a channel-tufted headboard, the mattress, a rumpled duvet folded back, two pillows, a cushion, a knitted throw. */
export function bed(): Group {
  const g = new Group(), { x, w, z0, z1 } = BED, fl = FLOOR_Y, cx = x + w / 2;
  const wood = mat(0xffffff, { map: oak('#c79d6e', '#8f6743', [3, 1]), roughness: 0.55 });
  const rail = { y: fl - 5600, h: 3400 };
  // the frame: two side rails, the foot rail, four legs
  g.add(softBox({ x, y: rail.y, w: 900, h: rail.h }, z0 + 1800, z1, wood, 120));
  g.add(softBox({ x: x + w - 900, y: rail.y, w: 900, h: rail.h }, z0 + 1800, z1, wood, 120));
  g.add(softBox({ x, y: rail.y, w, h: rail.h }, z1 - 900, z1, wood, 120));
  // (each leg tapered to a brass cap on the floor)
  const cap = mat(0xc9a25a, { metalness: 0.85, roughness: 0.3 });
  for (const [lx, lz] of [[x + 450, z1 - 450], [x + w - 450, z1 - 450], [x + 450, z0 + 2300], [x + w - 450, z0 + 2300]] as const) {
    g.add(post(lx, fl, lz, 220, fl - rail.y - rail.h, wood, 16, 300), post(lx, fl, lz, 232, 520, cap, 16, 236));
  }
  // the headboard: an oak base and five upholstered channels, down behind the mattress
  const fabric = cloth(0xffffff, { map: weave('#a8ae98', { repeat: [2, 4] }), roughness: 0.95 });
  g.add(softBox({ x: x - 300, y: fl - 21000, w: w + 600, h: 21000 - 2200 }, z0, z0 + 900, wood, 150));
  const n = 5, cw = (w + 200) / n;
  for (let k = 0; k < n; k++) g.add(softBox({ x: x - 100 + k * cw + 40, y: fl - 20400, w: cw - 80, h: 11400 }, z0 + 900, z0 + 2100, fabric, 560));
  // the slats' rail inside the frame, seen in the gap under the mattress
  g.add(softBox({ x: x + 900, y: rail.y + 900, w: w - 1800, h: 500 }, z0 + 2100, z1 - 900, mat(0x8f6a46, { roughness: 0.7 }), 40));
  // the mattress (its top 10000 over the floor) in its fitted sheet, a piped seam round its top
  // (the whites a little under white, so the light can still model them: a paper white flattens in the sun)
  const sheet = cloth(0xffffff, { map: weave('#e7e2d8'), roughness: 0.9 }), mTop = fl - 10000;
  g.add(softBox({ x: x + 400, y: mTop, w: w - 800, h: 4400 }, z0 + 2200, z1 - 500, sheet, 700));
  // (straight rods and quarter rings: a spline through the corners bows out along the long sides)
  const piping = mat(0xe4ded2, { roughness: 0.85 }), pr = 700, py = -mTop - 320, rx0 = x + 440, rx1 = x + w - 440, rz0 = z0 + 2240, rz1 = z1 - 540;
  g.add(rod([rx0 + pr, py, rz0], [rx1 - pr, py, rz0], 70, piping, 6), rod([rx0 + pr, py, rz1], [rx1 - pr, py, rz1], 70, piping, 6));
  g.add(rod([rx0, py, rz0 + pr], [rx0, py, rz1 - pr], 70, piping, 6), rod([rx1, py, rz0 + pr], [rx1, py, rz1 - pr], 70, piping, 6));
  for (const [ax, az, turn] of [[rx1 - pr, rz1 - pr, 0], [rx0 + pr, rz1 - pr, -Math.PI / 2], [rx0 + pr, rz0 + pr, Math.PI], [rx1 - pr, rz0 + pr, Math.PI / 2]] as const) {
    const arc = new TorusGeometry(pr, 70, 6, 6, Math.PI / 2);
    arc.rotateX(Math.PI / 2); arc.rotateY(turn);
    const m = place(new Mesh(arc, piping));
    m.position.set(ax, py, az);
    g.add(m);
  }
  // the duvet: quilted, rumpled, falling over the sides in loose folds, turned back below the pillows
  const quiltTex = quilt('#ebe4d6', 4, [1.4, 1.6]);
  const linen = cloth(0xffffff, { map: quiltTex, bumpMap: quiltTex, bumpScale: 1.6, roughness: 0.92 });
  const dvZ0 = z0 + 12500, dv = place(new Mesh(drape(w - 120, 5600, z1 - dvZ0 + 200, 240, 1500, 420), linen));
  dv.position.set(cx, -(mTop - 1200 + 2800), (dvZ0 + z1) / 2 + 100);
  g.add(dv);
  const turnTex = weave('#e8e2d5', { repeat: [5, 2] });
  // (rounded to its full thickness: a soft roll, not a block)
  const fold = place(new Mesh(drape(w - 60, 1700, 3200, 110, 849, 160), cloth(0xffffff, { map: turnTex, roughness: 0.9 })));
  fold.position.set(cx, -(mTop - 850), dvZ0);
  g.add(fold);
  // two oat shams standing against the headboard, two sleeping pillows leaning on them, a mustard cushion in front
  // (each stands or leans on what is behind it, its bottom on the mattress: a stuffed pillow, its seam a welt round its edge)
  const shamM = cloth(0xffffff,{ map: weave('#d8d2bf', { repeat: [3, 3] }), roughness: 0.92 });
  const lean = (o: Mesh, x: number, foot: number, z: number, tall: number, a: number, turn = 0) => {
    o.rotation.set(-Math.PI / 2 - a, turn, 0, 'YXZ');
    o.position.set(x, -mTop + foot + (tall / 2) * Math.cos(a), z - (tall / 2) * Math.sin(a));
    g.add(o);
  };
  [cx - w * 0.245, cx + w * 0.245].forEach((px, i) => lean(place(new Mesh(pillow(w * 0.46, 2500, 7600, { seed: i * 2.1 }), shamM)), px, 0, z0 + 4700, 7600, 0.2, i ? 0.02 : -0.02));
  // two sleeping pillows lie in front of them, their backs up on the shams
  const pillowM = cloth(0xffffff,{ map: weave('#eae5db', { repeat: [3, 3] }), roughness: 0.9 });
  for (const [px, rz, seed] of [[cx - w * 0.235, 0.03, 0.7], [cx + w * 0.235, -0.04, 3.3]] as const) {
    const p = place(new Mesh(pillow(w * 0.43, 3000, 7200, { seed, lumps: 0.08 }), pillowM));
    p.position.set(px, -mTop + 1950, z0 + 8900);
    p.rotation.set(0.42, rz, 0);
    g.add(p);
  }
  // a mustard knit cushion leaning on the right-hand pillow, a little turned
  lean(place(new Mesh(pillow(7400, 2600, 7400, { pinch: 0.09, seed: 5 }), cloth(0xffffff,{ map: weave('#d4a24c', { knit: true, repeat: [3, 3] }), roughness: 0.95 }))),
    cx + w * 0.14, 1550, z0 + 13600, 7400, 1.0, -0.12);
  // the chunky knitted throw across the foot, down both sides to a tasselled edge
  const knit = chunky('#b8653f', [1.9, 0.45]);
  const throwM = cloth(0xffffff,{ map: knit, bumpMap: knit, bumpScale: 2.2, roughness: 0.97 });
  // (its top over the duvet's highest rumple: the duvet must not poke through it)
  const thW = w + 380, thD = 6400, thZ = z1 - 6600, thH = 6200, thTop = mTop - 1800;
  const th = place(new Mesh(drape(thW, thH, thD, 140, 1500, 260), throwM));
  th.position.set(cx, -(thTop + thH / 2), thZ);
  g.add(th);
  const tassels: { x: number; y: number; z: number; sy: number }[] = [];
  for (const side of [-1, 1]) for (let k = 0; k < 26; k++) {
    const tz = thZ - thD / 2 + 300 + (k / 25) * (thD - 600), len = 700 + rnd() * 260;
    tassels.push({ x: cx + side * (thW / 2 + 60), y: -(thTop + thH) - len / 2 + 120 + Math.sin(tz / 1100 + 0.7) * 150, z: tz, sy: len });
  }
  g.add(instanced(new CylinderGeometry(55, 35, 1, 5), mat(0xa5552f, { roughness: 0.95 }), tassels));
  g.add(floorShadow(cx, (z0 + z1) / 2 + 600, w * 1.25, (z1 - z0) * 1.15, 1, 330));
  return g;
}

// ---------------------------------------------------------------- the bedside table
export interface Bedside { root: Group; shade: MeshStandardMaterial; glow: MeshStandardMaterial; bulb: [number, number, number] }

/** An oak bedside table on tapered legs (a drawer, an open shelf), a ceramic lamp with a linen shade, books and a small plant. */
export function nightstand(): Bedside {
  const g = new Group(), { x, w, z0, z1, top } = NIGHTSTAND, fl = FLOOR_Y, cx = x + w / 2, cz = (z0 + z1) / 2;
  const wood = mat(0xffffff, { map: oak(), roughness: 0.55 }), brass = mat(0xc9a25a, { metalness: 0.85, roughness: 0.3 });
  const body = { y: top, h: 7200 };
  g.add(softBox({ x, y: body.y, w, h: 400 }, z0, z1, wood, 90));
  g.add(softBox({ x, y: body.y + 400, w: 380, h: body.h - 400 }, z0, z1, wood, 40), softBox({ x: x + w - 380, y: body.y + 400, w: 380, h: body.h - 400 }, z0, z1, wood, 40));
  g.add(softBox({ x, y: body.y + body.h - 380, w, h: 380 }, z0, z1, wood, 40));
  g.add(rectBox({ x: x + 380, y: body.y + 400, w: w - 760, h: body.h - 780 }, z0, z0 + 200, wood));
  // the drawer (its box dark in the gap round the front), its knob, and the shelf under it with a book
  g.add(rectBox({ x: x + 380, y: body.y + 400, w: w - 760, h: 3200 }, z1 - 1400, z1 - 380, mat(0x5a4330, { roughness: 0.8 })));
  g.add(softBox({ x: x + 460, y: body.y + 520, w: w - 920, h: 2900 }, z1 - 380, z1 - 20, wood, 60));
  const knob = new Mesh(new SphereGeometry(230, 16, 10), brass);
  knob.position.set(cx, -(body.y + 1970), z1 + 120);
  g.add(place(knob));
  g.add(rectBox({ x: x + 380, y: body.y + 3600, w: w - 760, h: 260 }, z0 + 200, z1 - 60, wood));
  g.add(softBox({ x: x + 900, y: body.y + body.h - 380 - 900, w: 4200, h: 900 }, z0 + 1400, z0 + 5800, mat(0x3f5468, { roughness: 0.8 }), 60));
  for (const [lx, lz] of [[x + 400, z0 + 500], [x + w - 400, z0 + 500], [x + 400, z1 - 500], [x + w - 400, z1 - 500]] as const) {
    const h = fl - (body.y + body.h);
    const leg = post(lx, fl, lz, 170, h, wood, 10, 260);
    leg.rotation.set((lz > cz ? 1 : -1) * 0.07, 0, (lx > cx ? -1 : 1) * 0.07);
    g.add(leg);
  }
  // the lamp: a round ceramic body, a brass neck, a linen drum
  const lx = cx - 1100, lz = cz - 400, ceramic = mat(0x8fa48c, { roughness: 0.35 });
  const profile = [[0, 0], [900, 0], [1300, 300], [1650, 1000], [1700, 1600], [1450, 2300], [800, 2800], [300, 3000], [250, 3040]] as const;
  // (the profile through a smooth curve, so the belly turns without facets)
  const curve = new SplineCurve(profile.map(([r, y]) => new Vector2(r, y)));
  const vase = new Mesh(new LatheGeometry(curve.getPoints(40), 40), ceramic);
  vase.position.set(lx, -top, lz);
  g.add(place(vase));
  g.add(post(lx, top - 3040, lz, 90, 1500, brass, 10));
  const shade = mat(0xffffff, { map: weave('#efe6d2', { repeat: [3, 2] }), roughness: 0.9, side: DoubleSide, emissive: new Color(0xffc27a), emissiveIntensity: 0 });
  const drumM = new Mesh(new CylinderGeometry(1900, 2300, 2700, 32, 1, true), shade);
  const sy = -(top - 4500 - 1350);
  drumM.position.set(lx, sy, lz);
  g.add(place(drumM));
  // the shade's wire rings top and bottom, the spider on its neck, the bulb inside (it glows when lit)
  for (const [r, dy] of [[1900, 1350], [2300, -1350]] as const) { const t = new Mesh(new TorusGeometry(r, 34, 6, 40), brass); t.rotation.x = Math.PI / 2; t.position.set(lx, sy + dy, lz); g.add(place(t, false)); }
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; g.add(rod([lx, sy + 1350, lz], [lx + Math.cos(a) * 1880, sy + 1350, lz + Math.sin(a) * 1880], 22, brass, 4)); }
  const glow = mat(0xfff3dc, { roughness: 0.4, emissive: new Color(0xffc98a), emissiveIntensity: 0 });
  const bulb = new Mesh(new SphereGeometry(420, 18, 12), glow);
  bulb.position.set(lx, sy - 150, lz);
  g.add(seeThrough(bulb));
  // its cord: off the back of the base, over the table's back edge, down to the socket over the skirting
  const sx = lx + 1200, cord = mat(0xf2efe8, { roughness: 0.6 });
  g.add(tube([[lx, -top + 60, lz - 1150], [lx + 250, -top + 40, z0 + 500], [lx + 420, -top - 600, z0 + 160], [lx + 700, -(fl - 6000), 150], [sx, -(fl - 3300), 150], [sx, -(fl - 2600), 160]], 45, cord, 6));
  g.add(softBox({ x: sx - 550, y: fl - 3100, w: 1100, h: 950 }, 0, 90, mat(0xf3f1ec, { roughness: 0.4 }), 30));
  g.add(drum(sx, fl - 2600, 90, 300, 220, cord, 16));
  // two books and a small plant
  g.add(softBox({ x: cx + 900, y: top - 520, w: 3000, h: 520 }, cz - 1500, cz + 2400, mat(0xc5b79a, { roughness: 0.8 }), 40));
  g.add(softBox({ x: cx + 1100, y: top - 920, w: 2600, h: 400 }, cz - 1200, cz + 2000, mat(0x7d3b32, { roughness: 0.8 }), 40));
  g.add(softBox({ x: cx + 1180, y: top - 900, w: 2440, h: 360 }, cz + 2000, cz + 2040, mat(0xf1ead9, { roughness: 0.9 }), 10));
  g.add(succulent(cx + 2700, top, cz - 2700, 650));
  g.add(floorShadow(cx, cz + 300, w * 1.4, (z1 - z0) * 1.4, 0.8));
  return { root: g, shade, glow, bulb: [lx, sy - 150, lz] };
}

// ---------------------------------------------------------------- the bookcase
/**
 * A book's spine: a pale cloth ground (each book's own colour tints it) with bands near its ends and a title running up it. Five designs:
 * gilt rules and a dark label, broad dark ends and a light label, plain with fine rules, a paperback (a long dark title, a white logo at its
 * foot), an old leather binding (raised bands, gilt panels between them).
 */
const SPINES = 5;
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
    if (kind === 4) {
      // the raised bands over the cords: each a dark ridge with a lit top; gilt fleurons in the panels, a red title label in the second
      for (let k = 0; k < 5; k++) { const y = 40 + k * 100; band(y, 14, '#5a5a5a'); band(y, 3, '#f0f0f0'); band(y + 14, 2, '#3a3a3a'); }
      for (let k = 0; k < 4; k++) {
        const y = 54 + k * 100;
        if (k === 1) { c.fillStyle = '#7a2a24'; c.fillRect(8, y + 14, w - 16, 58); c.fillStyle = '#f6e7b0'; for (let x = 14; x < w - 16; x += 6) c.fillRect(x, y + 36, 4, 12); continue; }
        c.fillStyle = '#f6e7b0'; c.beginPath(); c.arc(w / 2, y + 43, 8, 0, Math.PI * 2); c.fill(); c.fillRect(w / 2 - 18, y + 41, 36, 3);
      }
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

/** An oak bookcase on the west wall, facing the room: five shelves of books (upright, leaning, stacked), a plant, a box, bookends, a pothos on top. */
export function bookcase(): Group {
  const g = new Group(), { x, w, z0, z1, top } = BOOKCASE, fl = FLOOR_Y, xf = x + w;
  const wood = mat(0xffffff, { map: oak('#c9a273', '#8f6743'), roughness: 0.55 });
  const side = 450, shelf = 400;
  g.add(softBox({ x, y: top, w, h: fl - top }, z0, z0 + side, wood, 50), softBox({ x, y: top, w, h: fl - top }, z1 - side, z1, wood, 50));
  // the back: tongue-and-groove boards, a dark V between each pair
  g.add(rectBox({ x, y: top, w: 300, h: fl - top }, z0, z1, mat(0xffffff, { map: oak('#b48a5c', '#7d5a3a'), roughness: 0.7 })));
  const groove = mat(0x5e4329, { roughness: 0.8 });
  for (let gz = z0 + side + 1900; gz < z1 - side - 600; gz += 1900) g.add(rectBox({ x: x + 290, y: top, w: 30, h: fl - top }, gz - 35, gz + 35, groove));
  // the cornice: a cove flaring out over the sides and the front, a flat fillet over it, its top closed
  const CORNICE: readonly ProfilePt[] = [[300, 0], [300, 40], [260, 70], [170, 120], [90, 190], [40, 260], [10, 330], [0, 360], [0, 360], [0, 520], [0, 520]];
  const crown = place(new Mesh(frameLoft(w + 300, z1 - z0 + 600, CORNICE, { cap: true }), wood));
  crown.geometry.rotateX(-Math.PI / 2);
  crown.position.set(x + (w + 300) / 2, -top, (z0 + z1) / 2);
  g.add(crown);
  // the shelf-pin holes up the inside of each side, two rows (front and back), a pin under each shelf
  const pins: { x: number; y: number; z: number }[] = [];
  for (const pz of [z0 + side, z1 - side]) for (const px of [x + 1300, xf - 900]) for (let py = top + 1200; py < fl - 1600; py += 640) pins.push({ x: px, y: -py, z: pz });
  const hole = new CylinderGeometry(70, 70, 24, 8); hole.rotateX(Math.PI / 2);
  g.add(instanced(hole, mat(0x3b2a1b, { roughness: 0.9 }), pins));
  const n = 5, gap = (fl - top - 1400) / n;
  const tones = [0x34506b, 0xa95c40, 0xcfa24c, 0xe6dfcf, 0x758b6b, 0x75363a, 0x45464c, 0xbcae90, 0x648aa6, 0x8a6a4a];
  const books: Book[] = [];
  const steel = mat(0x3a3c40, { metalness: 0.6, roughness: 0.4 });
  for (let s = 0; s <= n; s++) {
    const y = top + s * gap, base = y + gap;
    g.add(softBox({ x, y, w, h: shelf }, z0 + side - 10, z1 - side + 10, wood, 40));
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
      else g.add(softBox({ x: x + 900, y: base - 1800, w: 3800, h: 1800 }, tz - 1600, tz + 1600, mat(0xe7dfd0, { roughness: 0.8 }), 120), softBox({ x: x + 880, y: base - 1880, w: 3840, h: 200 }, tz - 1640, tz + 1640, mat(0xd6cbb6, { roughness: 0.8 }), 60));
    }
  }
  g.add(shelvedBooks(books));
  // the plinth, set back under the bottom shelf (a shadow line along the floor)
  g.add(softBox({ x: x + 300, y: fl - 1000, w: w - 700, h: 1000 }, z0 + side, z1 - side, wood, 40));
  // a pothos on the top, trailing over the front edge
  g.add(pothos(x + w / 2 + 300, top - 520, z1 - 2200, xf + 80, [{ dz: 600, len: 9000 }, { dz: -900, len: 5200 }, { dz: 1500, len: 13000 }]));
  g.add(floorShadow(x + w / 2, (z0 + z1) / 2, w * 1.6, (z1 - z0) * 1.1, 0.7));
  return g;
}

// ---------------------------------------------------------------- the window's furnishings
/** A white panel radiator under the window: vertical flutes, a valve at one end, its pipes into the floor. */
export function radiator(): Group {
  const g = new Group(), white = mat(0xf1efea, { roughness: 0.35 }), x0 = WINDOW.x + 700, x1 = WINDOW.x + WINDOW.w - 700;
  const y0 = FLOOR_Y - 12800, y1 = FLOOR_Y - 2400;
  g.add(softBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 800, 1500, white, 120));
  const flutes: { x: number; y: number; z: number; sy: number }[] = [];
  for (let x = x0 + 300; x < x1 - 200; x += 520) flutes.push({ x, y: -(y0 + y1) / 2, z: 1560, sy: (y1 - y0) * 0.86 });
  g.add(instanced(new CylinderGeometry(150, 150, 1, 10), white, flutes));
  // the top grille: a cap with slots over the convector fins
  g.add(softBox({ x: x0 + 200, y: y0 - 60, w: x1 - x0 - 400, h: 260 }, 600, 1600, white, 80));
  const slots: { x: number; y: number; z: number; sx: number }[] = [];
  for (let x = x0 + 600; x < x1 - 600; x += 380) slots.push({ x, y: -(y0 - 60) + 5, z: 1100, sx: 1 });
  g.add(instanced(new BoxGeometry(130, 20, 700), mat(0x3a3a3a, { roughness: 0.8 }), slots));
  // the thermostatic valve on the flow at the east end (a brass body, a ribbed white head with its dial), a lockshield cap at the west end
  const pipe = mat(0xdedbd4, { metalness: 0.4, roughness: 0.3 }), brass = mat(0xc9a25a, { metalness: 0.85, roughness: 0.3 }), vx = x1 + 450;
  g.add(post(vx, FLOOR_Y, 1200, 120, FLOOR_Y - y1 + 300, pipe, 10), rod([x1 - 100, -(y1 - 500), 1200], [vx, -(y1 - 500), 1200], 120, pipe, 10));
  g.add(post(vx, y1 - 200, 1200, 200, 650, brass, 14));
  const head: [number, number][] = [[200, 0], [260, 60], [260, 160]];
  for (let k = 0; k < 7; k++) head.push([300, 200 + k * 90], [272, 245 + k * 90]);
  head.push([300, 860], [290, 940], [180, 980], [0, 990]);
  const trv = new Mesh(new LatheGeometry(head.map(([r, y]) => new Vector2(r, y)), 24), white);
  trv.position.set(vx, -(y1 - 850), 1200);
  g.add(place(trv), post(vx, y1 - 1834, 1200, 150, 14, mat(0x8a8f96, { roughness: 0.5 }), 20));
  g.add(post(x0 + 300, FLOOR_Y, 1200, 120, FLOOR_Y - y1, pipe, 10), post(x0 + 300, y1 + 900, 1200, 190, 480, white, 14));
  return g;
}

/** Curtain linen: a fine weave with slubs along the weft, the heading tape across its top (the rod's end) and the turned hem across its foot. */
function curtainTex(base: string): Texture | null {
  return paint(256, 1024, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 2) { c.fillStyle = `rgba(0,0,0,${0.025 + rnd() * 0.035})`; c.fillRect(i, 0, 1, h); }
    for (let i = 0; i < h; i += 2) { c.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.03})`; c.fillRect(0, i, w, 1); }
    for (let k = 0; k < 220; k++) { c.fillStyle = `rgba(255,255,255,${0.06 + rnd() * 0.07})`; c.fillRect(rnd() * w, rnd() * h, 10 + rnd() * 40, 1); }
    const stitch = (y: number) => { c.fillStyle = 'rgba(90,70,50,0.35)'; for (let x = 0; x < w; x += 8) c.fillRect(x, y, 5, 1.5); };
    // the heading tape: a paler band, stitched along both edges, a shadow line under it
    c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(0, 0, w, 40);
    stitch(6); stitch(34);
    c.fillStyle = 'rgba(70,50,30,0.16)'; c.fillRect(0, 40, w, 3);
    // the hem: a doubled band, a little darker, its stitch line
    c.fillStyle = 'rgba(0,0,0,0.05)'; c.fillRect(0, h - 70, w, 70);
    c.fillStyle = 'rgba(70,50,30,0.2)'; c.fillRect(0, h - 72, w, 2);
    stitch(h - 60);
  }, [3, 1]);
}

/**
 * Sill-length linen curtains, drawn back to each side of the window: each panel hangs from rings on an oak rod with turned finials and
 * brass brackets, its heading pleated into the rings; it sweeps down to a fabric tie-back that cinches it toward the wall and flares out
 * below it in looser folds to a stitched hem. The folds wander as they fall (no two alike); the lining shows on the back.
 */
export function curtains(): Group {
  const g = new Group(), rodY = WINDOW.y - 1900, z = 1500;
  const left = WINDOW.x - 3400, right = WINDOW.x + WINDOW.w + 2300;
  const wood = mat(0xffffff, { map: oak('#a77c52', '#6d4d30'), roughness: 0.5 }), brass = mat(0xc9a25a, { metalness: 0.85, roughness: 0.3 });
  g.add(rod([left - 500, -rodY, z], [right + 500, -rodY, z], 150, wood, 14));
  // the finials: a collar, a neck, a ball with a little top
  const finial = [[0, 0], [230, 0], [240, 60], [180, 120], [170, 240], [300, 330], [330, 470], [280, 620], [160, 700], [90, 760], [60, 800], [0, 810]] as const;
  for (const [fx, s] of [[left - 500, -1], [right + 500, 1]] as const) {
    const f = place(new Mesh(new LatheGeometry(finial.map(([r, h]) => new Vector2(r, h)), 20), wood));
    f.rotation.z = -s * Math.PI / 2; f.position.set(fx, -rodY, z);
    g.add(f);
    // the rod's bracket: a rose on the wall, an arm out to a cradle under the rod
    const bx = fx - s * 900;
    g.add(drum(bx, rodY - 300, 0, 90, 300, brass, 20), rod([bx, -rodY + 300, 60], [bx, -rodY + 300, z - 120], 70, brass, 8), rod([bx, -rodY + 300, z - 120], [bx, -rodY - 170, z], 60, brass, 8));
    const cradle = new Mesh(new TorusGeometry(190, 45, 6, 16, Math.PI), brass);
    cradle.rotation.set(Math.PI, Math.PI / 2, 0); cradle.position.set(bx, -rodY, z);
    g.add(place(cradle));
  }
  const tex = curtainTex('#e4d8c3'), drapes = cloth(0xffffff, { map: tex, roughness: 0.95 }), lining = mat(0xf2ede4, { roughness: 0.95, side: BackSide });
  const band = mat(0xffffff, { map: weave('#b86a45', { repeat: [8, 1] }), roughness: 0.9, side: DoubleSide });
  const tieV = 0.6, ringR = 250, top = rodY + ringR + 230, h = WINDOW.y + WINDOW.h + 1300 - top;
  const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
  const panel = (x0: number, x1: number, gather: number, seed: number) => {
    const w = x1 - x0, cx = (x0 + x1) / 2, geo = new PlaneGeometry(w, h, 64, 44), p = geo.attributes.position!;
    // the wall side, where the cloth gathers; how much of its width the cloth spans at each height (all at the rod, least at the tie)
    // below the tie it flares out, but stops short of the sill's end
    const outer = (-gather * w) / 2, reach = (gather > 0 ? WINDOW.x - 700 - x0 : x1 - WINDOW.x - WINDOW.w - 700) - 250, low = Math.min(0.72, reach / w);
    const span = (v: number) => (v < tieV ? 1 - 0.58 * (v / tieV) ** 1.4 : 0.42 + (low - 0.42) * smooth((v - tieV) / (1 - tieV)) ** 0.8);
    const fold = (u: number, v: number) => Math.sin(u * 37 + seed + v * 1.6) * 0.6 + Math.sin(u * 61 + seed * 1.7 - v * 2.4) * 0.22 + Math.sin(u * 17 + seed * 2.3 + v * 0.7) * 0.32;
    const k = w / 3000;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / w + 0.5, v = 0.5 - p.getY(i) / h, s = span(v);
      // deeper folds where the cloth is drawn in and as it falls; squeezed flat in the band; the hem ripples a little
      const squeeze = 1 - 0.5 * Math.exp(-(((v - tieV) / 0.045) ** 2));
      p.setZ(i, (230 + 330 * v) * k * (1 + 1.1 * (1 - s)) * squeeze * fold(u, v));
      p.setX(i, outer + (p.getX(i) - outer) * s);
      p.setY(i, p.getY(i) + 60 * smooth((v - 0.93) / 0.07) * fold(u, 1));
    }
    geo.computeVertexNormals();
    for (const m of [drapes, lining]) { const o = place(new Mesh(geo, m)); o.position.set(cx, -(top + h / 2), z); g.add(o); }
    // the rings along the rod, each with its hook down into the heading
    for (let r = 0; r <= 9; r++) {
      const rx = x0 + 120 + (r / 9) * (w - 240), ring = new Mesh(new TorusGeometry(ringR, 34, 6, 18), wood);
      ring.rotation.y = Math.PI / 2; ring.position.set(rx, -rodY, z);
      g.add(place(ring), rod([rx, -rodY - ringR, z], [rx, -top + 60, z + 40], 22, brass, 5));
    }
    // the tie-back: a band of terracotta cloth round the bundle at the tie, its two ends hooked over a brass knob on the wall behind it
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(0.5 - p.getY(i) / h - tieV) > 0.012) continue;
      bx0 = Math.min(bx0, p.getX(i)); bx1 = Math.max(bx1, p.getX(i)); bz0 = Math.min(bz0, p.getZ(i)); bz1 = Math.max(bz1, p.getZ(i));
    }
    const ty = -(top + tieV * h), hx = cx + (bx0 + bx1) / 2 - gather * 200, mid = (bz0 + bz1) / 2 + z, m = 110;
    const loop: [number, number, number][] = [
      [hx - 160, ty + 40, 160], [cx + bx0 - m, ty + 10, z + bz0 - m], [cx + bx0 - m * 1.6, ty - 30, mid], [cx + bx0 - m, ty - 80, z + bz1 + m],
      [cx + (bx0 + bx1) / 2, ty - 140, z + bz1 + m * 1.7], [cx + bx1 + m, ty - 80, z + bz1 + m], [cx + bx1 + m * 1.6, ty - 30, mid], [cx + bx1 + m, ty + 10, z + bz0 - m], [hx + 160, ty + 40, 160],
    ];
    g.add(place(new Mesh(ribbon(loop, 520, { closed: true, segs: 64 }), band)));
    g.add(drum(hx, -ty, 0, 90, 260, brass, 18), drum(hx, -ty, 90, 360, 90, brass, 10));
    const knob = new Mesh(new SphereGeometry(170, 14, 10), brass);
    knob.position.set(hx, ty, 400);
    g.add(place(knob));
  };
  panel(left, WINDOW.x + 500, 1, 0.7);
  panel(WINDOW.x + WINDOW.w - 500, right, -1, 2.9);
  return g;
}

// ---------------------------------------------------------------- the door, the ceiling light, the print, the plant
/** A panel door's raised panel in its opening, from the stiles' face down: the ogee moulding stuck on the edge, a flat margin, the bevel, the field. */
const PANEL: readonly ProfilePt[] = [
  [0, 280], [40, 266], [95, 222], [130, 160], [175, 112], [240, 92], [290, 52], [300, 10], [300, 10], [520, 10], [520, 10], [1500, 160], [1500, 160], [1570, 196], [1570, 196],
];
/** The architrave's section from its outer edge to the opening: a rounded back band, a cove, a long ramp to a bead on the inner edge. */
const CASING: readonly ProfilePt[] = [
  [0, 0], [0, 150], [30, 205], [100, 236], [190, 228], [240, 196], [300, 186], [380, 200], [700, 262], [960, 318], [1060, 350], [1130, 362], [1190, 344], [1240, 290], [1250, 220], [1250, 0],
];

/**
 * A white four-panel door in the west wall near the front: a moulded architrave on plinth blocks, the leaf in its frame with a dark gap round
 * it, stiles, rails and a muntin framing four raised and fielded panels, three hinges with their knuckles, a lever on a stepped rose, a
 * keyhole escutcheon, an oak threshold, a rubber stop on the floor, and the light switch beside it.
 */
export function door(): Group {
  const g = new Group(), { z0, z1, top } = DOOR, fl = FLOOR_Y, white = mat(0xf2f0eb, { roughness: 0.38 }), xs = WEST_X;
  // (in the wall's plane: y down, z along the wall; x out of the wall into the room)
  const slab = (y0: number, y1: number, za: number, zb: number, x0: number, x1: number, m: Material, r = 40) => softBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, za, zb, m, r);
  // a loft built facing +z (its width along the wall) turned to face the room, centred on (zc, yc), its back at x
  const onWall = (geo: BufferGeometry, zc: number, yc: number, x: number, m: Material) => { geo.rotateY(Math.PI / 2); const o = place(new Mesh(geo, m)); o.position.set(x, -yc, zc); return o; };
  // the architrave: one mitred moulding round the opening (its foot runs on under the floor), on plinth blocks
  const cw = 1250, aTop = top - cw, aBot = fl + cw + 60;
  g.add(onWall(frameLoft(z1 - z0 + 2 * cw, aBot - aTop, CASING), (z0 + z1) / 2, (aTop + aBot) / 2, xs, white));
  for (const [a, b] of [[z0 - cw - 120, z0 + 40], [z1 - 40, z1 + cw + 120]] as const) g.add(slab(fl - 2300, fl, a, b, xs, xs + 440, white, 70));
  // the frame's dark gap round the leaf
  g.add(rectBox({ x: xs - 320, y: top, w: 100, h: fl - top }, z0, z1, mat(0x3a3530, { roughness: 0.9 })));
  // the leaf: a core slab, the stiles, rails and centre muntin over it, a raised panel in each opening
  const leaf = mat(0xefece6, { roughness: 0.36 }), lz0 = z0 + 70, lz1 = z1 - 70, ly0 = top + 70, ly1 = fl - 150, face = xs + 200, panelX = face - 280;
  g.add(slab(ly0, ly1, lz0, lz1, xs - 220, panelX - 10, leaf, 30));
  const S = 2300, M = 2000, lock = fl - 19000, rails = [[ly0, ly0 + S], [lock - 1800, lock + 1800], [ly1 - 4300, ly1]] as const;
  g.add(slab(ly0, ly1, lz0, lz0 + S, xs - 220, face, leaf, 30), slab(ly0, ly1, lz1 - S, lz1, xs - 220, face, leaf, 30));
  for (const [a, b] of rails) g.add(slab(a, b, lz0 + S - 20, lz1 - S + 20, xs - 220, face, leaf, 20));
  const mz = (z0 + z1) / 2;
  for (const [a, b] of [[rails[0][1], rails[1][0]], [rails[1][1], rails[2][0]]] as const) {
    g.add(slab(a - 20, b + 20, mz - M / 2, mz + M / 2, xs - 220, face, leaf, 20));
    for (const [za, zb] of [[lz0 + S, mz - M / 2], [mz + M / 2, lz1 - S]] as const) g.add(onWall(frameLoft(zb - za, b - a, PANEL, { cap: true }), (za + zb) / 2, (a + b) / 2, panelX, leaf));
  }
  // three hinges on the far edge: the knuckle proud of the gap, ball finials on its pin
  const steel = mat(0xb9bcc0, { metalness: 0.85, roughness: 0.32 }), dark = mat(0x26282b, { roughness: 0.6 });
  for (const hy of [top + 2900, (top + fl) / 2 - 800, fl - 3900]) {
    g.add(post(face - 60, hy + 1000, z1 - 20, 125, 2000, steel, 14));
    for (const [y, s] of [[hy + 1000, -1], [hy - 1000, 1]] as const) { const b = new Mesh(new SphereGeometry(105, 12, 8), steel); b.position.set(face - 60, -y + s * 30, z1 - 20); g.add(place(b)); }
  }
  // the lever: a stepped rose turned on a lathe, the lever out of its neck and along the door, its end swelling and turned in to the leaf
  const hy = lock, hz = lz0 + 1350;
  const rose = (y: number, prof: readonly (readonly [number, number])[]) => {
    const o = place(new Mesh(new LatheGeometry(prof.map(([r, h]) => new Vector2(r, h)), 32), steel));
    o.rotation.z = -Math.PI / 2; o.position.set(face, -y, hz);
    return o;
  };
  g.add(rose(hy, [[0, 0], [470, 0], [495, 30], [480, 110], [400, 160], [200, 190], [175, 240], [160, 420], [0, 430]]));
  const lever: [number, number, number][] = [[face + 330, -hy, hz], [face + 820, -hy, hz], [face + 930, -hy, hz + 260], [face + 960, -hy - 30, hz + 1200], [face + 900, -hy - 60, hz + 2150]];
  g.add(place(new Mesh(taperTube(lever, 140, 165, 14, 40), steel)));
  const tip = new Mesh(new SphereGeometry(165, 14, 10), steel);
  tip.scale.set(0.85, 1, 1.2); tip.position.set(...lever[4]!);
  g.add(place(tip));
  // the escutcheon under it: a small rose, the key's slot through it
  g.add(rose(hy + 1700, [[0, 0], [280, 0], [295, 25], [270, 80], [0, 95]]));
  const slot = place(new Mesh(new CylinderGeometry(60, 60, 30, 12), dark));
  slot.rotation.z = Math.PI / 2; slot.position.set(face + 95, -(hy + 1660), hz);
  g.add(slot, slab(hy + 1660, hy + 1840, hz - 30, hz + 30, face + 70, face + 100, dark, 8));
  // the threshold: an oak strip with its edges eased, across the opening on the floor
  g.add(softBox({ x: xs - 300, y: fl - 140, w: 900, h: 140 }, z0, z1, mat(0xffffff, { map: oak('#b58a5e', '#7a5737', [4, 1]), roughness: 0.5 }), 50));
  // a rubber stop on the floor where the door swings open
  const stop = post(xs + 12500, fl, z1 - 1200, 380, 900, mat(0x4a4744, { roughness: 0.9 }), 14, 300);
  g.add(stop, post(xs + 12500, fl, z1 - 1200, 460, 80, steel, 14));
  // the light switch beside the door: a bevelled plate, its rocker
  g.add(onWall(frameLoft(1400, 2000, [[0, 0], [0, 40], [120, 150], [120, 150]], { cap: true }), z1 + 2200, fl - 21600, xs, white));
  const rocker = slab(fl - 22100, fl - 21100, z1 + 1900, z1 + 2500, xs + 120, xs + 270, mat(0xe8e5de, { roughness: 0.45 }), 40);
  rocker.rotation.z = 0.06;
  g.add(rocker);
  return g;
}

/**
 * A semi-flush drum light under a plaster ceiling rose (y: the ceiling, 2D y down): the rose's rings and bead, a canopy and a short stem, a
 * linen drum held by brass rims and a three-arm spider, a domed diffuser closing its foot. The linen and the diffuser glow when lit.
 */
export function ceilingLight(x: number, y: number, z: number): { root: Group; glow: MeshStandardMaterial } {
  const g = new Group(), plaster = mat(0xf6f3ec, { roughness: 0.9 }), brass = mat(0xc9a25a, { metalness: 0.85, roughness: 0.3 });
  const lathe = (pts: readonly (readonly [number, number])[], m: Material, yTop: number, segs = 40) => {
    const o = place(new Mesh(new LatheGeometry(pts.map(([r, h]) => new Vector2(r, -h)), segs), m), false);
    o.position.set(x, -yTop, z);
    return o;
  };
  // the rose: a cove off the ceiling, a bead, a stepped field, a ring of leaves (a scalloped rim), a boss in the middle
  g.add(lathe([[3300, 0], [3300, 40], [3150, 110], [2950, 150], [2900, 210], [2820, 240], [2740, 210], [2700, 160], [2300, 180], [2000, 230], [1900, 300], [1500, 330], [1100, 330], [1000, 390], [800, 420], [0, 430]], plaster, y, 48));
  // the ring of leaves, each pointing out from the middle
  const leaf = new SphereGeometry(260, 8, 6), leaves = new InstancedMesh(leaf, plaster, 24), o = new Object3D();
  leaf.scale(1, 0.45, 1.6);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    o.position.set(x + Math.cos(a) * 1700, -(y + 290), z + Math.sin(a) * 1700); o.rotation.set(0, -a + Math.PI / 2, 0); o.updateMatrix();
    leaves.setMatrixAt(i, o.matrix);
  }
  g.add(place(leaves, false));
  // the canopy and the stem
  const drop = 1500, top = y + drop, sh = 2000, r = 4400;
  g.add(lathe([[700, 0], [700, 60], [640, 200], [380, 330], [140, 380], [0, 380]], brass, y + 430, 24));
  g.add(place(post(x, top, z, 75, drop - 700, brass, 10), false));
  // the shade: linen, brass rims top and foot, the spider from the top rim to a hub round the stem
  const glow = mat(0xffffff, { map: weave('#f4eee2', { repeat: [6, 1] }), roughness: 0.9, side: DoubleSide, emissive: new Color(0xffd9a0), emissiveIntensity: 0 });
  const shade = new Mesh(new CylinderGeometry(r, r, sh, 48, 1, true), glow);
  shade.position.set(x, -(top + sh / 2), z);
  g.add(place(shade, false));
  for (const ry of [top, top + sh]) {
    const rim = new Mesh(new TorusGeometry(r + 20, 45, 6, 64), brass);
    rim.rotation.x = Math.PI / 2; rim.position.set(x, -ry, z);
    g.add(place(rim, false));
  }
  const hub = new Mesh(new TorusGeometry(260, 60, 6, 16), brass);
  hub.rotation.x = Math.PI / 2; hub.position.set(x, -(top + 60), z);
  g.add(place(hub, false));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    g.add(place(rod([x + Math.cos(a) * 300, -(top + 60), z + Math.sin(a) * 300], [x + Math.cos(a) * r, -(top + 20), z + Math.sin(a) * r], 35, brass, 6), false));
  }
  // the diffuser: a shallow dome of opal glass across the foot
  const R = r * 4, cap = Math.asin(r / R), dome = new SphereGeometry(R, 48, 6, 0, Math.PI * 2, 0, cap);
  dome.translate(0, -R * Math.cos(cap), 0); dome.rotateX(Math.PI);
  const disc = new Mesh(dome, mat(0xf6f1e6, { roughness: 0.4, emissive: new Color(0xffe2b0), emissiveIntensity: 0, side: DoubleSide }));
  disc.position.set(x, -(top + sh - 60), z);
  g.add(place(disc, false));
  return { root: g, glow };
}

/** A framed print over the bed: an oak frame, a white mount, a warm abstract landscape (a sun over layered hills). */
export function print(r: { x: number; y: number; w: number; h: number }, z: number): Group {
  const g = new Group(), wood = mat(0xffffff, { map: oak('#b88c5d', '#7a5737'), roughness: 0.5 });
  g.add(softBox(r, z, z + 380, wood, 60));
  const art = paint(512, 384, (c, w, h) => {
    c.fillStyle = '#f6f2ea'; c.fillRect(0, 0, w, h);
    const m = 46, iw = w - 2 * m, ih = h - 2 * m;
    c.save(); c.beginPath(); c.rect(m, m, iw, ih); c.clip();
    const sky = c.createLinearGradient(0, m, 0, m + ih); sky.addColorStop(0, '#efd9b8'); sky.addColorStop(1, '#f3e6cf');
    c.fillStyle = sky; c.fillRect(m, m, iw, ih);
    c.fillStyle = '#d4693f'; c.beginPath(); c.arc(m + iw * 0.62, m + ih * 0.42, ih * 0.2, 0, Math.PI * 2); c.fill();
    for (const [tone, base, amp, f] of [['#c9a46a', 0.62, 0.08, 1.3], ['#8f9f78', 0.72, 0.07, 2.1], ['#5d7058', 0.84, 0.05, 1.7]] as const) {
      c.fillStyle = tone; c.beginPath(); c.moveTo(m, m + ih);
      for (let i = 0; i <= 40; i++) { const u = i / 40; c.lineTo(m + u * iw, m + ih * (base - amp * Math.sin(u * Math.PI * f + base * 9))); }
      c.lineTo(m + iw, m + ih); c.closePath(); c.fill();
    }
    c.restore();
  });
  const face = new Mesh(new PlaneGeometry(r.w - 700, r.h - 700), mat(0xffffff, { map: art, roughness: 0.85 }));
  face.position.set(r.x + r.w / 2, -(r.y + r.h / 2), z + 392);
  g.add(face);
  return g;
}

/**
 * The east wall's shelf past the bed's foot: a floating oak board with a stack of books, a candle in a jar, a trailing plant and a postcard
 * leant on the wall, and a framed poster above it. The east wall faces -x: this group builds on a back wall (z out of it) and turns to it.
 */
export function eastWall(): Group {
  const g = new Group(), wall = new Group(), wood = mat(0xffffff, { map: oak('#b88c5d', '#7a5737'), roughness: 0.5 });
  // (a layout x here runs along the east wall from its back corner: x = the room's z)
  const sx = 40000, sw = 15000, sy = -3000;
  wall.add(softBox({ x: sx, y: sy, w: sw, h: 600 }, 0, 3200, wood, 70));
  const books = [0x45464c, 0xa95c40, 0xe6dfcf] as const;
  let y = sy;
  books.forEach((c, k) => {
    const t = 420 + k * 60;
    wall.add(softBox({ x: sx + 900 + k * 120, y: y - t, w: 4200 - k * 380, h: t }, 300 + k * 80, 2700 - k * 120, mat(c, { roughness: 0.75 }), 40));
    y -= t;
  });
  // the candle: an amber jar (its wall, its rim), the cream wax in it, the wick
  const cx = sx + 7400, jarP = [[0, 0], [760, 0], [790, 60], [790, 1650], [740, 1700], [700, 1650], [690, 120], [0, 120]] as const;
  const jar = new Mesh(new LatheGeometry(jarP.map(([r, h]) => new Vector2(r, h)), 24), mat(0xb27a3e, { roughness: 0.3, metalness: 0.1 }));
  jar.position.set(cx, -sy, 1500);
  wall.add(place(jar), post(cx, sy - 120, 1500, 690, 1300, mat(0xf3ead8, { roughness: 0.7 }), 20), post(cx, sy - 1420, 1500, 30, 200, mat(0x222222, { roughness: 1 }), 5));
  // a pothos at the east end: built facing +x, turned so its vines trail over the shelf's front edge
  const vine = pothos(0, 0, 0, 1700, [{ dz: 300, len: 7000 }, { dz: -500, len: 4200 }]);
  vine.rotation.y = -Math.PI / 2;
  vine.position.set(sx + sw - 2400, -sy, 1500);
  wall.add(vine);
  // a postcard leant on the wall
  const card = paint(256, 180, (c, w, h) => {
    c.fillStyle = '#f2ebde'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#7fa2b8'; c.fillRect(12, 12, w - 24, h * 0.55);
    c.fillStyle = '#e7d3a6'; c.fillRect(12, 12 + h * 0.55, w - 24, h * 0.45 - 24);
    c.fillStyle = '#c8643c'; c.beginPath(); c.arc(w * 0.7, h * 0.32, 18, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2f4f5f'; c.beginPath(); c.moveTo(12, h * 0.67); c.lineTo(w * 0.35, h * 0.42); c.lineTo(w * 0.6, h * 0.67); c.fill();
  });
  const pc = new Mesh(new PlaneGeometry(2800, 2000), mat(0xffffff, { map: card, roughness: 0.8, side: DoubleSide }));
  pc.position.set(sx + 11000, -sy + 1050, 450); pc.rotation.x = -0.18;
  wall.add(place(pc));
  // a framed poster above: arches in warm tones
  const r = { x: sx + 1500, y: -18500, w: 11000, h: 13800 };
  wall.add(softBox(r, 0, 320, mat(0x2e2a26, { roughness: 0.5 }), 50));
  const art = paint(384, 480, (c, w, h) => {
    c.fillStyle = '#f4efe5'; c.fillRect(0, 0, w, h);
    const m = 40, iw = w - 2 * m, ih = h - 2 * m;
    c.fillStyle = '#efe2cc'; c.fillRect(m, m, iw, ih);
    const arch = (x: number, y: number, aw: number, ah: number, col: string) => { c.fillStyle = col; c.beginPath(); c.moveTo(x, y + ah); c.lineTo(x, y + aw / 2); c.arc(x + aw / 2, y + aw / 2, aw / 2, Math.PI, 0); c.lineTo(x + aw, y + ah); c.fill(); };
    arch(m + iw * 0.1, m + ih * 0.18, iw * 0.8, ih * 0.82, '#d9a76a');
    arch(m + iw * 0.22, m + ih * 0.32, iw * 0.56, ih * 0.68, '#c8643c');
    arch(m + iw * 0.34, m + ih * 0.46, iw * 0.32, ih * 0.54, '#7a8f72');
    c.fillStyle = '#f4efe5'; c.beginPath(); c.arc(m + iw * 0.5, m + ih * 0.12, iw * 0.07, 0, Math.PI * 2); c.fill();
  });
  const face = new Mesh(new PlaneGeometry(r.w - 600, r.h - 600), mat(0xffffff, { map: art, roughness: 0.85 }));
  face.position.set(r.x + r.w / 2, -(r.y + r.h / 2), 330);
  wall.add(face);
  wall.rotation.y = -Math.PI / 2;
  wall.position.x = EAST_X;
  g.add(wall);
  return g;
}
