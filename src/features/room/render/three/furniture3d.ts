// The bedroom's furniture in 3D, round the desk (docs/LOWPOLY_STYLE.md "Look decision": soft edges, warm wood, soft cloth): the bed against the back
// wall east of the desk, the bedside table and its lamp, the bookcase on the west wall, the radiator under the window, the curtains, the door, the
// ceiling light, a print over the bed, the shelf on the east wall, plants, a basket and slippers. Every builder takes the room plan (`roomplan.ts`,
// 2D y down; z out of the back wall) and returns world meshes, built as a maker would (rails, fronts, mouldings, seams), each part its own mesh:
// the room merges the still ones by material (`mergeStatic`). Pure scenery: nothing answers a click.
import {
  BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, InstancedMesh, LatheGeometry, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, PlaneGeometry, SphereGeometry, TorusGeometry, Vector2, type Material, type Texture,
} from 'three';
import { drum, instanced, paint, place, post, rectBox, rod, shadowBlob, softBox, tube } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough } from '@/core/render/three/pick';
import { BED, BOOKCASE, DOOR, EAST_X, FLOOR_Y, NIGHTSTAND, WEST_X, WINDOW } from './roomplan';

type V3 = [number, number, number];

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
 * A soft slab of cloth (a duvet, a throw) laid over a box: its edges fall over the sides, its top rumpled a little. `hem` waves the hanging
 * edge (the cloth falls in loose folds, longer here, shorter there) and puffs the sides out a little.
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
      y += hem * fold * down * down;
      const out = hem * 0.35 * (0.6 + 0.4 * fold) * Math.sin(Math.PI * down);
      if (Math.abs(x) > w / 2 - radius) x += Math.sign(x) * out;
      if (Math.abs(z) > d / 2 - radius) z += Math.sign(z) * out;
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/** A soft dark patch on the floor under a thing, `lift` over it (more to lie over the rug): a baked contact shadow. */
function floorShadow(x: number, z: number, w: number, d: number, k = 1, lift = 140): Mesh {
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
  for (const [lx, lz] of [[x + 450, z1 - 450], [x + w - 450, z1 - 450], [x + 450, z0 + 2300], [x + w - 450, z0 + 2300]] as const) g.add(post(lx, fl, lz, 220, fl - rail.y - rail.h, wood, 10, 300));
  // the headboard: an oak base and five upholstered channels, down behind the mattress
  const fabric = mat(0xffffff, { map: weave('#a8ae98', { repeat: [2, 4] }), roughness: 0.95 });
  g.add(softBox({ x: x - 300, y: fl - 21000, w: w + 600, h: 21000 - 2200 }, z0, z0 + 900, wood, 150));
  const n = 5, cw = (w + 200) / n;
  for (let k = 0; k < n; k++) g.add(softBox({ x: x - 100 + k * cw + 40, y: fl - 20400, w: cw - 80, h: 11400 }, z0 + 900, z0 + 2100, fabric, 560));
  // the slats' rail inside the frame, seen in the gap under the mattress
  g.add(softBox({ x: x + 900, y: rail.y + 900, w: w - 1800, h: 500 }, z0 + 2100, z1 - 900, mat(0x8f6a46, { roughness: 0.7 }), 40));
  // the mattress (its top 10000 over the floor) in its fitted sheet, a piped seam round its top
  const sheet = mat(0xffffff, { map: weave('#f2efe8'), roughness: 0.9 }), mTop = fl - 10000;
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
  const linen = mat(0xffffff, { map: quiltTex, bumpMap: quiltTex, bumpScale: 1.6, roughness: 0.92 });
  const dvZ0 = z0 + 12500, dv = place(new Mesh(drape(w - 120, 5600, z1 - dvZ0 + 200, 240, 1500, 420), linen));
  dv.position.set(cx, -(mTop - 1200 + 2800), (dvZ0 + z1) / 2 + 100);
  g.add(dv);
  const turnTex = weave('#f3eee4', { repeat: [5, 2] });
  const fold = place(new Mesh(drape(w - 60, 1700, 3200, 110, 800, 160), mat(0xffffff, { map: turnTex, roughness: 0.9 })));
  fold.position.set(cx, -(mTop - 850), dvZ0);
  g.add(fold);
  // two oat shams standing against the headboard, two sleeping pillows leaning on them, a mustard cushion in front
  const shamM = mat(0xffffff, { map: weave('#d8d2bf', { repeat: [3, 3] }), roughness: 0.92 });
  for (const px of [cx - w * 0.245, cx + w * 0.245]) {
    const p = place(new Mesh(cushion(w * 0.46, 1900, 6600, 0.8), shamM));
    p.rotation.x = -Math.PI / 2 - 0.2;
    p.position.set(px, -mTop + 3150, z0 + 3800);
    g.add(p);
  }
  const pillowM = mat(0xffffff, { map: weave('#f6f3ec', { repeat: [3, 3] }), roughness: 0.9 });
  for (const [px, rz] of [[cx - w * 0.235, 0.03], [cx + w * 0.235, -0.04]] as const) {
    const p = place(new Mesh(cushion(w * 0.43, 2600, 6200), pillowM));
    p.position.set(px, -mTop + 1700, z0 + 7300);
    p.rotation.set(-0.42, 0, rz);
    g.add(p);
  }
  const cush = place(new Mesh(cushion(6200, 1800, 5600, 1.2), mat(0xffffff, { map: weave('#d4a24c', { knit: true, repeat: [3, 3] }), roughness: 0.95 })));
  cush.position.set(cx + 900, -mTop + 2700, z0 + 10200);
  cush.rotation.set(-0.95, 0.12, 0.08);
  g.add(cush);
  // the chunky knitted throw across the foot, down both sides to a tasselled edge
  const knit = chunky('#b8653f', [1.9, 0.45]);
  const throwM = mat(0xffffff, { map: knit, bumpMap: knit, bumpScale: 2.2, roughness: 0.97 });
  const thW = w + 380, thD = 6400, thZ = z1 - 6600, thH = 6200;
  const th = place(new Mesh(drape(thW, thH, thD, 140, 1500, 260), throwM));
  th.position.set(cx, -(mTop - 1500 + thH / 2), thZ);
  g.add(th);
  const tassels: { x: number; y: number; z: number; sy: number }[] = [];
  for (const side of [-1, 1]) for (let k = 0; k < 26; k++) {
    const tz = thZ - thD / 2 + 300 + (k / 25) * (thD - 600), len = 700 + rnd() * 260;
    tassels.push({ x: cx + side * (thW / 2 + 60), y: -(mTop - 1500 + thH) - len / 2 + 120 + Math.sin(tz / 1100 + 0.7) * 150, z: tz, sy: len });
  }
  g.add(instanced(new CylinderGeometry(55, 35, 1, 5), mat(0xa5552f, { roughness: 0.95 }), tassels));
  g.add(floorShadow(cx, (z0 + z1) / 2 + 600, w * 1.25, (z1 - z0) * 1.15, 1, 330));
  return g;
}

/** A pair of felt slippers on the rug beside the bed, a little askew. */
export function slippers(x: number, z: number): Group {
  const g = new Group(), felt = mat(0xffffff, { map: weave('#8d9096', { knit: true, repeat: [2, 4] }), roughness: 0.98 }), sole = mat(0x4b3b30, { roughness: 0.9 });
  for (const [dx, dz, a] of [[0, 0, 0.18], [1900, 500, -0.08]] as const) {
    const s = new Group();
    s.add(place(new Mesh(cushion(1500, 260, 4300, 0.5), sole)));
    // a mule: the upper over the toe (toward the room), the heel open
    const top = place(new Mesh(cushion(1450, 900, 3000, 1.4), felt));
    top.position.set(0, 420, 600);
    s.add(top);
    s.position.set(x + dx, -FLOOR_Y + 430, z + dz);
    s.rotation.y = a;
    g.add(s);
  }
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
  const vase = new Mesh(new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 28), ceramic);
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

/** A small potted succulent standing on the layout point (x, y). */
function succulent(x: number, y: number, z: number, r: number): Group {
  const g = new Group();
  g.add(post(x, y, z, r, r * 1.2, mat(0xe9e4da, { roughness: 0.4 }), 16, r * 1.15));
  const leaf = mat(0x7fa36b, { roughness: 0.6, flatShading: true });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, l = place(new Mesh(new ConeGeometry(r * 0.28, r * 1.1, 5), leaf));
    l.position.set(x + Math.sin(a) * r * 0.35, -y + r * 1.2 + r * 0.4, z + Math.cos(a) * r * 0.35);
    l.rotation.set(Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6);
    g.add(l);
  }
  return g;
}

// ---------------------------------------------------------------- the bookcase
/**
 * A book's spine: a pale cloth ground (each book's own colour tints it) with bands near its ends and a title running up it. Three designs:
 * gilt rules and a dark label, broad dark ends and a light label, plain with fine rules.
 */
function spineTex(kind: number): Texture | null {
  return paint(64, 512, (c, w, h) => {
    c.fillStyle = '#d2d2d2'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)'; c.fillRect(rnd() * w, rnd() * h, 1, 2 + rnd() * 6); }
    const band = (y: number, t: number, col: string) => { c.fillStyle = col; c.fillRect(0, y, w, t); };
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
  const board = mat(0xd2d2d2, { roughness: 0.75 }), hidden = new MeshBasicMaterial({ visible: false });
  const pages = paint(128, 128, (c, w, h) => { c.fillStyle = '#efe7d4'; c.fillRect(0, 0, w, h); for (let i = 0; i < h; i += 2) { c.fillStyle = `rgba(120,100,70,${0.05 + rnd() * 0.08})`; c.fillRect(0, i, w, 1); } });
  const put = (m: InstancedMesh, i: number, b: Book, sx: number, sy: number, sz: number, dx: number) => {
    d.position.set(b.x + dx, b.y, b.z); d.rotation.set(b.lean, 0, 0); d.scale.set(sx, sy, sz); d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
  };
  for (let kind = 0; kind < 3; kind++) {
    const set = books.filter((b) => b.kind === kind);
    if (!set.length) continue;
    // BoxGeometry's groups: +x (the spine, to the room), -x, +y, -y, +z, -z
    const m = new InstancedMesh(box, [mat(0xffffff, { map: spineTex(kind), roughness: 0.7 }), board, hidden, hidden, board, board], set.length);
    set.forEach((b, i) => { put(m, i, b, b.sx, b.sy, b.sz, 0); m.setColorAt(i, col.setHex(b.tone)); });
    g.add(place(m));
  }
  const p = new InstancedMesh(box, mat(0xffffff, { map: pages, roughness: 0.9 }), books.length);
  books.forEach((b, i) => put(p, i, b, b.sx - 90, b.sy - 70, b.sz - 70, -45));
  g.add(place(p));
  return g;
}

/** A pothos in a small pot standing at (x, y, z) (y its base, 2D down), its vines trailing over an edge at x `edge` and down toward the room. */
function pothos(x: number, y: number, z: number, edge: number, vines: readonly { dz: number; len: number }[]): Group {
  const g = new Group();
  g.add(post(x, y, z, 900, 1700, mat(0xe3ddd2, { roughness: 0.4 }), 20, 1050));
  g.add(post(x, y - 1640, z, 980, 60, mat(0x3b2a1e, { roughness: 1 }), 20));
  const leafG = new IcosahedronGeometry(1, 0), leaves = [mat(0x4f8a3f, { roughness: 0.55, flatShading: true }), mat(0x6aa14d, { roughness: 0.55, flatShading: true }), mat(0x3f7236, { roughness: 0.55, flatShading: true })];
  const stem = mat(0x557a3a, { roughness: 0.7 });
  const leaf = (p: V3, a: number, s: number, k: number) => {
    const l = place(new Mesh(leafG, leaves[k % 3]!));
    l.scale.set(s, s * 0.14, s * 0.78); l.position.set(...p); l.rotation.set(0.5 * Math.sin(a), a, 0.9 + 0.3 * Math.cos(a * 1.7));
    g.add(l);
  };
  // a tuft in the pot
  for (let k = 0; k < 9; k++) { const a = k * 2.4; leaf([x + Math.cos(a) * 600, -y + 1900 + (k % 3) * 250, z + Math.sin(a) * 600], a, 560, k); }
  vines.forEach((v, i) => {
    const sway = (rnd() - 0.5) * 1600, pts: V3[] = [[x + 500, -y + 1800, z + v.dz * 0.3], [edge + 120, -y + 400, z + v.dz * 0.8], [edge + 260, -y - v.len * 0.45, z + v.dz + sway * 0.5], [edge + 320, -y - v.len, z + v.dz + sway]];
    g.add(tube(pts, 32, stem, 5));
    for (let t = 0.12; t < 1; t += 0.085) {
      const k = Math.min(2, Math.floor(t * 3)), u = t * 3 - k, a = pts[k]!, b = pts[k + 1]!;
      const p: V3 = [a[0] + (b[0] - a[0]) * u + 180, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u + (Math.round(t * 23) % 2 ? 260 : -260)];
      leaf(p, t * 9 + i, 430 - t * 140, Math.round(t * 23) + i);
    }
  });
  return g;
}

/** An oak bookcase on the west wall, facing the room: five shelves of books (upright, leaning, stacked), a plant, a box, bookends, a pothos on top. */
export function bookcase(): Group {
  const g = new Group(), { x, w, z0, z1, top } = BOOKCASE, fl = FLOOR_Y, xf = x + w;
  const wood = mat(0xffffff, { map: oak('#c9a273', '#8f6743'), roughness: 0.55 });
  const side = 450, shelf = 400;
  g.add(softBox({ x, y: top, w, h: fl - top }, z0, z0 + side, wood, 50), softBox({ x, y: top, w, h: fl - top }, z1 - side, z1, wood, 50));
  g.add(rectBox({ x, y: top, w: 300, h: fl - top }, z0, z1, mat(0xffffff, { map: oak('#b48a5c', '#7d5a3a'), roughness: 0.7 })));
  // a crown over the top, a little proud of the sides
  g.add(softBox({ x, y: top - 380, w: w + 160, h: 380 }, z0 - 120, z1 + 120, wood, 60));
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
      books.push({ x: x + 360 + bd / 2, y: -base + bh / 2, z: z + bw / 2, sx: bd, sy: bh, sz: bw, lean: 0, tone: tones[Math.floor(rnd() * tones.length)]!, kind: Math.floor(rnd() * 3) });
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
  g.add(softBox({ x: x + 300, y: fl - 1000, w: w - 500, h: 1000 }, z0 + side, z1 - side, wood, 40));
  // a pothos on the top, trailing over the front edge
  g.add(pothos(x + w / 2 + 300, top - 380, z1 - 2200, xf + 80, [{ dz: 600, len: 9000 }, { dz: -900, len: 5200 }, { dz: 1500, len: 13000 }]));
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

/** Sill-length linen curtains drawn back to each side of the window and caught in tie-backs, on an oak rod with round finials. */
export function curtains(): Group {
  const g = new Group(), rodY = WINDOW.y - 1900, z = 1500;
  const left = WINDOW.x - 3400, right = WINDOW.x + WINDOW.w + 2300;
  const wood = mat(0xffffff, { map: oak('#a77c52', '#6d4d30'), roughness: 0.5 }), brass = mat(0xc9a25a, { metalness: 0.85, roughness: 0.3 });
  const band = mat(0xffffff, { map: weave('#b86a45', { repeat: [4, 1] }), roughness: 0.9 });
  g.add(rod([left - 500, -rodY, z], [right + 500, -rodY, z], 150, wood, 14));
  for (const fx of [left - 700, right + 700]) {
    const f = new Mesh(new SphereGeometry(330, 16, 10), wood); f.position.set(fx, -rodY, z); g.add(place(f));
    // the rod's bracket: a rose on the wall, an arm out to the rod
    const bx = fx - Math.sign(fx - WINDOW.x - WINDOW.w / 2) * 420;
    g.add(drum(bx, rodY, 0, 80, 300, brass, 16), rod([bx, -rodY, 0], [bx, -rodY, z], 70, brass, 8));
  }
  const cloth = mat(0xffffff, { map: weave('#e4d8c3', { repeat: [3, 6] }), roughness: 0.95, side: DoubleSide });
  const tieV = 0.6, pinch = 0.42;
  const panel = (x0: number, x1: number, gather: number) => {
    const w = x1 - x0, h = WINDOW.y + WINDOW.h + 1300 - rodY, geo = new PlaneGeometry(w, h, 40, 28), p = geo.attributes.position!;
    const outer = (-gather * w) / 2;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / w + 0.5, v = 0.5 - p.getY(i) / h;
      // the tie-back gathers the cloth toward the wall side; the folds bunch deeper there and flare loose below it
      const tie = Math.exp(-(((v - tieV) / (v < tieV ? 0.3 : 0.14)) ** 2)), s = 1 - pinch * tie;
      const phase = u * Math.PI * 2 * 5.5 + 0.7 * Math.sin(u * 7.3 + 1.1);
      p.setZ(i, Math.sin(phase) * (260 + 160 * v) * (1 + 0.9 * tie) + Math.sin(u * Math.PI * 2 * 11 + 1) * 60);
      p.setX(i, outer + (p.getX(i) - outer) * s + gather * Math.max(0, v - tieV) ** 2 * 900);
    }
    geo.computeVertexNormals();
    const m = place(new Mesh(geo, cloth));
    const cx = (x0 + x1) / 2;
    m.position.set(cx, -(rodY + h / 2), z);
    g.add(m);
    for (let k = 0; k <= 8; k++) { const r = new Mesh(new CylinderGeometry(140, 140, 50, 12), wood); r.rotation.x = Math.PI / 2; r.position.set(x0 + (k / 8) * w, -rodY, z); g.add(place(r)); }
    // the tie-back: a terracotta band round the gathered cloth, hooked to a brass knob on the wall beside the window
    const ty = rodY + tieV * h, hw = (w / 2) * (1 - pinch), bx = cx + outer * pinch, depth = 260 + 160 * tieV;
    const ring = new TorusGeometry(hw + 120, 120, 6, 28);
    ring.rotateX(Math.PI / 2); ring.scale(1, 2.2, ((depth * 1.9) / 2 + 200) / (hw + 120));
    const tieM = place(new Mesh(ring, band));
    tieM.position.set(bx, -ty, z);
    g.add(tieM);
    const hx = cx + outer + -gather * 500;
    g.add(drum(hx, ty, 0, 60, 240, brass, 16), drum(hx, ty, 60, z - 300, 70, brass, 8));
  };
  panel(left, WINDOW.x - 300, 1);
  panel(WINDOW.x + WINDOW.w + 300, right, -1);
  return g;
}

// ---------------------------------------------------------------- the door, the ceiling light, the print, the plant
/**
 * A white panelled door in the west wall near the front: a stepped architrave on plinth blocks, the leaf in its frame with a dark gap round it,
 * two raised and moulded panels, three hinges, a brushed lever on its rose, a keyhole, a rubber stop on the floor, and the light switch beside it.
 */
export function door(): Group {
  const g = new Group(), { z0, z1, top } = DOOR, fl = FLOOR_Y, white = mat(0xf2f0eb, { roughness: 0.4 }), xs = WEST_X;
  // (in the wall's plane: y down, z along the wall; x out of the wall into the room)
  const slab = (y0: number, y1: number, za: number, zb: number, x0: number, x1: number, m: Material, r = 40) => softBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, za, zb, m, r);
  // the architrave: a flat casing, a bead stepped proud on its inner edge, plinth blocks at the foot
  g.add(slab(top - 900, top, z0 - 900, z1 + 900, xs, xs + 300, white, 60));
  g.add(slab(top, fl, z0 - 900, z0, xs, xs + 300, white, 60), slab(top, fl, z1, z1 + 900, xs, xs + 300, white, 60));
  g.add(slab(top - 260, top, z0 - 260, z1 + 260, xs, xs + 440, white, 70));
  g.add(slab(top, fl - 1700, z0 - 260, z0, xs, xs + 440, white, 70), slab(top, fl - 1700, z1, z1 + 260, xs, xs + 440, white, 70));
  for (const [a, b] of [[z0 - 980, z0], [z1, z1 + 980]] as const) g.add(slab(fl - 1700, fl, a, b, xs, xs + 520, white, 60));
  // the frame's dark gap round the leaf, the leaf a little in
  g.add(rectBox({ x: xs - 320, y: top, w: 100, h: fl - top }, z0, z1, mat(0x3a3530, { roughness: 0.9 })));
  const leaf = mat(0xeeebe4, { roughness: 0.45 });
  g.add(slab(top + 70, fl - 140, z0 + 70, z1 - 70, xs - 220, xs + 120, leaf, 30));
  // two raised panels: a moulding round each, a raised field in it
  for (const [a, b] of [[top + 1800, top + 17000], [top + 19500, fl - 2200]] as const) {
    g.add(slab(a, b, z0 + 1700, z1 - 1700, xs + 120, xs + 190, white, 30));
    g.add(slab(a + 260, b - 260, z0 + 1960, z1 - 1960, xs + 120, xs + 160, mat(0xe3e0d9, { roughness: 0.5 }), 20));
    g.add(slab(a + 700, b - 700, z0 + 2400, z1 - 2400, xs + 120, xs + 250, white, 90));
  }
  // three hinges on the far edge: a leaf on the frame, the knuckle with its pin
  const steel = mat(0xb9bcc0, { metalness: 0.85, roughness: 0.35 }), dark = mat(0x26282b, { roughness: 0.6 });
  for (const hy of [top + 2600, (top + fl) / 2 - 800, fl - 3600]) {
    g.add(post(xs + 140, hy + 1100, z1 - 30, 110, 2200, steel, 10));
    g.add(post(xs + 140, hy - 1100, z1 - 30, 70, 120, steel, 8));
  }
  // the lever: a round rose, the lever out of it and along the door, its end turned in; the keyhole's rose under it
  const hy = fl - 19000, hz = z0 + 1500;
  const rose = (y: number, r: number) => { const o = place(new Mesh(new CylinderGeometry(r, r * 1.05, 140, 24), steel)); o.rotation.z = Math.PI / 2; o.position.set(xs + 190, -y, hz); return o; };
  g.add(rose(hy, 420), rod([xs + 220, -hy, hz], [xs + 900, -hy, hz], 150, steel, 12), rod([xs + 900, -hy, hz], [xs + 980, -hy, hz + 2100], 130, steel, 12));
  const tip = new Mesh(new SphereGeometry(150, 12, 8), steel);
  tip.position.set(xs + 980, -hy, hz + 2100);
  g.add(place(tip), rose(hy + 1700, 260), slab(hy + 1580, hy + 1840, hz - 40, hz + 40, xs + 250, xs + 265, dark, 10));
  // a rubber stop on the floor where the door swings open
  const stop = post(xs + 12500, fl, z1 - 1200, 380, 900, mat(0x4a4744, { roughness: 0.9 }), 14, 300);
  g.add(stop, post(xs + 12500, fl, z1 - 1200, 460, 80, steel, 14));
  // the light switch beside the door: a plate, its rocker
  g.add(slab(fl - 22600, fl - 20600, z1 + 1500, z1 + 2900, xs, xs + 160, white, 50));
  const rocker = slab(fl - 22000, fl - 21200, z1 + 1950, z1 + 2450, xs + 120, xs + 260, mat(0xe2dfd8, { roughness: 0.5 }), 30);
  rocker.rotation.z = 0.08;
  g.add(rocker);
  return g;
}

/** A flush drum light on the ceiling (y: the ceiling, 2D y down). Its diffuser glows when lit. */
export function ceilingLight(x: number, y: number, z: number): { root: Group; glow: MeshStandardMaterial } {
  const g = new Group();
  const glow = mat(0xffffff, { map: weave('#f4eee2', { repeat: [4, 1] }), roughness: 0.9, side: DoubleSide, emissive: new Color(0xffd9a0), emissiveIntensity: 0 });
  const drumM = new Mesh(new CylinderGeometry(4600, 4600, 2000, 40, 1, true), glow);
  drumM.position.set(x, -(y + 1400), z);
  const disc = new Mesh(new CylinderGeometry(4500, 4500, 60, 40), mat(0xf6f1e6, { roughness: 0.6, emissive: new Color(0xffe2b0), emissiveIntensity: 0 }));
  disc.position.set(x, -(y + 2350), z);
  g.add(place(drumM, false), place(disc, false), place(post(x, y + 400, z, 1400, 400, mat(0xf3f0ea, { roughness: 0.5 }), 24), false));
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

/** A fiddle-leaf fig in a ribbed pot, standing on the floor at (x, z). */
export function floorPlant(x: number, z: number): Group {
  const g = new Group(), fl = FLOOR_Y;
  const pot = new Mesh(new LatheGeometry([new Vector2(1500, 0), new Vector2(2100, 300), new Vector2(2300, 3600), new Vector2(2450, 4300), new Vector2(2200, 4400), new Vector2(0, 4100)], 28), mat(0xe8e1d4, { roughness: 0.55 }));
  pot.position.set(x, -fl, z);
  // a saucer under it, the soil in it
  g.add(place(pot), post(x, fl, z, 1900, 240, mat(0xd8cfbf, { roughness: 0.5 }), 28, 2050), post(x, fl - 4320, z, 2180, 60, mat(0x3b2a1e, { roughness: 1 }), 24));
  const trunk = mat(0x6b5240, { roughness: 0.8 });
  g.add(rod([x, -fl + 4000, z], [x + 300, -fl + 15000, z + 200], 170, trunk, 8), rod([x + 200, -fl + 11000, z + 100], [x - 1600, -fl + 17000, z + 900], 110, trunk, 8));
  const leafG = new IcosahedronGeometry(1, 1);
  const tones = [mat(0x4f7d3c, { roughness: 0.5, flatShading: true }), mat(0x5f8f47, { roughness: 0.5, flatShading: true }), mat(0x41693a, { roughness: 0.5, flatShading: true })];
  for (let k = 0; k < 34; k++) {
    const t = k / 34, a = k * 2.4, h = -fl + 8000 + t * 11500, r = 1500 + Math.sin(t * Math.PI) * 2600;
    const leaf = place(new Mesh(leafG, tones[k % 3]!));
    leaf.scale.set(1500, 160, 1000);
    leaf.position.set(x + Math.cos(a) * r, h, z + Math.sin(a) * r);
    leaf.rotation.set(0.4 * Math.sin(a), -a, -0.5 - 0.3 * Math.cos(a * 1.3));
    g.add(leaf);
  }
  g.add(floorShadow(x, z, 7000, 7000, 0.8));
  return g;
}

/** A crumpled ball of paper: a sphere pushed in and out at random, flat-shaded so its creases catch the light. */
function crumple(r: number): BufferGeometry {
  const g = new IcosahedronGeometry(r, 1), p = g.attributes.position!;
  const bump = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    // the same corner of the sphere moves the same way on every face that shares it, so the ball stays closed
    const key = `${Math.round(p.getX(i))},${Math.round(p.getY(i))},${Math.round(p.getZ(i))}`;
    let k = bump.get(key);
    if (k === undefined) bump.set(key, (k = 0.72 + rnd() * 0.5));
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A woven basket for paper under the desk: a seagrass weave, a bound rim, a base, crumpled paper in it. */
export function basket(x: number, z: number): Group {
  const g = new Group(), h = 5200, fl = FLOOR_Y;
  const weaveM = mat(0xffffff, { map: weave('#b99568', { knit: true, repeat: [8, 4] }), roughness: 0.9, side: DoubleSide });
  const m = new Mesh(new CylinderGeometry(1700, 1350, h, 24, 1, true), weaveM);
  m.position.set(x, -fl + h / 2, z);
  const rim = new Mesh(new TorusGeometry(1700, 150, 8, 32), mat(0xffffff, { map: weave('#8f6a44', { knit: true, repeat: [12, 1] }), roughness: 0.9 }));
  rim.rotation.x = Math.PI / 2; rim.position.set(x, -fl + h, z);
  g.add(place(m), place(rim), post(x, fl, z, 1350, 120, mat(0x7d5c3c, { roughness: 0.95 }), 24));
  const paperM = mat(0xf1eee7, { roughness: 0.85, flatShading: true });
  for (const [dx, dy, dz, r] of [[-500, h - 900, 300, 760], [500, h - 1100, -200, 680], [100, h - 500, -600, 600]] as const) {
    const b = place(new Mesh(crumple(r), paperM));
    b.position.set(x + dx, -fl + dy, z + dz); b.rotation.set(dx, dy, dz);
    g.add(b);
  }
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
