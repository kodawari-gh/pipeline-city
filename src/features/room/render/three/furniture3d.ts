// The bedroom's furniture in 3D, round the desk (docs/LOWPOLY_STYLE.md "Look decision": soft edges, warm wood, soft cloth): the bed against the back
// wall east of the desk, the bedside table and its lamp, the bookcase on the west wall, the radiator under the window, the curtains, the door, the
// ceiling light, a print over the bed and a plant. Every builder takes the room plan (`roomplan.ts`, 2D y down; z out of the back wall) and
// returns world meshes. Pure scenery: nothing answers a click.
import {
  BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, LatheGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, SphereGeometry, Vector2, type Material, type Texture,
} from 'three';
import { instanced, paint, place, post, rectBox, rod, shadowBlob, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough } from '@/core/render/three/pick';
import { BED, BOOKCASE, DOOR, FLOOR_Y, NIGHTSTAND, WEST_X, WINDOW } from './roomplan';

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

/** A soft slab of cloth (a duvet, a throw) laid over a box: its edges fall over the sides, its top rumpled a little. */
function drape(w: number, h: number, d: number, rumple: number, radius: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d, 24, 3, 24), p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ex = Math.max(0, Math.abs(x) - (w / 2 - radius)), ez = Math.max(0, Math.abs(z) - (d / 2 - radius)), ey = Math.max(0, y - (h / 2 - radius));
    // round the top edges and corners
    const e = Math.hypot(ex, ez, ey);
    if (e > radius) { const k = radius / e; x -= Math.sign(x) * ex * (1 - k); z -= Math.sign(z) * ez * (1 - k); y -= ey * (1 - k); }
    if (y > -h / 2 + 1) y += rumple * (Math.sin(x / 2300 + z / 3100) * 0.6 + Math.sin(z / 1700 - x / 4100) * 0.4) * (y > 0 ? 1 : 0.4);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/** A soft dark patch on the floor (over the rug) under a thing: a baked contact shadow. */
function floorShadow(x: number, z: number, w: number, d: number, k = 1): Mesh {
  const m = new Mesh(new PlaneGeometry(w, d), new MeshBasicMaterial({ map: shadowBlob(), transparent: true, opacity: 0.9 * k, depthWrite: false, color: 0x000000 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, -FLOOR_Y + 140, z);
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
  // the mattress (its top 10000 over the floor) and the sheet over it
  const sheet = mat(0xffffff, { map: weave('#f2efe8'), roughness: 0.9 }), mTop = fl - 10000;
  g.add(softBox({ x: x + 400, y: mTop, w: w - 800, h: 4400 }, z0 + 2200, z1 - 500, sheet, 700));
  // the duvet: rumpled, over the sides, folded back below the pillows
  const linen = mat(0xffffff, { map: weave('#e9e2d4', { repeat: [5, 8] }), roughness: 0.92 });
  const dvZ0 = z0 + 12000, dv = place(new Mesh(drape(w - 200, 5200, z1 - dvZ0, 220, 1400), linen));
  dv.position.set(cx, -(mTop - 1200 + 2600), (dvZ0 + z1) / 2);
  g.add(dv);
  const fold = place(new Mesh(drape(w - 150, 1600, 3000, 90, 700), mat(0xffffff, { map: weave('#f3eee4', { repeat: [5, 2] }), roughness: 0.9 })));
  fold.position.set(cx, -(mTop - 800), dvZ0);
  g.add(fold);
  // two pillows against the headboard, a mustard cushion in front of them
  const pillowM = mat(0xffffff, { map: weave('#f6f3ec', { repeat: [3, 3] }), roughness: 0.9 });
  for (const px of [cx - w * 0.24, cx + w * 0.24]) {
    const p = place(new Mesh(cushion(w * 0.42, 2600, 6200), pillowM));
    p.position.set(px, -mTop + 1500, z0 + 6200);
    p.rotation.x = -0.32;
    g.add(p);
  }
  const cush = place(new Mesh(cushion(6200, 1800, 5600, 1.2), mat(0xffffff, { map: weave('#d4a24c', { knit: true, repeat: [3, 3] }), roughness: 0.95 })));
  cush.position.set(cx + 900, -mTop + 2600, z0 + 9200);
  cush.rotation.set(-0.95, 0.12, 0.08);
  g.add(cush);
  // the knitted throw across the foot, over the duvet and down its sides
  const throwM = mat(0xffffff, { map: weave('#b8653f', { knit: true, repeat: [10, 4] }), roughness: 0.97 });
  const th = place(new Mesh(drape(w + 160, 5800, 6400, 120, 1500), throwM));
  th.position.set(cx, -(mTop - 1500 + 2900), z1 - 6600);
  g.add(th);
  g.add(floorShadow(cx, (z0 + z1) / 2 + 600, w * 1.25, (z1 - z0) * 1.15));
  return g;
}

// ---------------------------------------------------------------- the bedside table
export interface Bedside { root: Group; shade: MeshStandardMaterial; bulb: [number, number, number] }

/** An oak bedside table on tapered legs (a drawer, an open shelf), a ceramic lamp with a linen shade, books and a small plant. */
export function nightstand(): Bedside {
  const g = new Group(), { x, w, z0, z1, top } = NIGHTSTAND, fl = FLOOR_Y, cx = x + w / 2, cz = (z0 + z1) / 2;
  const wood = mat(0xffffff, { map: oak(), roughness: 0.55 }), brass = mat(0xc9a25a, { metalness: 0.85, roughness: 0.3 });
  const body = { y: top, h: 7200 };
  g.add(softBox({ x, y: body.y, w, h: 400 }, z0, z1, wood, 90));
  g.add(softBox({ x, y: body.y + 400, w: 380, h: body.h - 400 }, z0, z1, wood, 40), softBox({ x: x + w - 380, y: body.y + 400, w: 380, h: body.h - 400 }, z0, z1, wood, 40));
  g.add(softBox({ x, y: body.y + body.h - 380, w, h: 380 }, z0, z1, wood, 40));
  g.add(rectBox({ x: x + 380, y: body.y + 400, w: w - 760, h: body.h - 780 }, z0, z0 + 200, wood));
  // the drawer, its knob, and the shelf under it with a book
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
  const drum = new Mesh(new CylinderGeometry(1900, 2300, 2700, 32, 1, true), shade);
  drum.position.set(lx, -(top - 4500 - 1350), lz);
  g.add(place(drum));
  // two books and a small plant
  g.add(softBox({ x: cx + 900, y: top - 520, w: 3000, h: 520 }, cz - 1500, cz + 2400, mat(0xc5b79a, { roughness: 0.8 }), 40));
  g.add(softBox({ x: cx + 1100, y: top - 920, w: 2600, h: 400 }, cz - 1200, cz + 2000, mat(0x7d3b32, { roughness: 0.8 }), 40));
  g.add(succulent(cx + 2700, top, cz - 2700, 650));
  g.add(floorShadow(cx, cz + 300, w * 1.4, (z1 - z0) * 1.4, 0.8));
  return { root: g, shade, bulb: [lx, -(top - 5300), lz] };
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
/** An oak bookcase on the west wall, facing the room: five shelves of books in muted colours, a plant, a box, a few books leaning. */
export function bookcase(): Group {
  const g = new Group(), { x, w, z0, z1, top } = BOOKCASE, fl = FLOOR_Y, xf = x + w;
  const wood = mat(0xffffff, { map: oak('#c9a273', '#8f6743'), roughness: 0.55 });
  const side = 450, shelf = 400;
  g.add(rectBox({ x, y: top, w, h: fl - top }, z0, z0 + side, wood), rectBox({ x, y: top, w, h: fl - top }, z1 - side, z1, wood));
  g.add(rectBox({ x, y: top, w: 300, h: fl - top }, z0, z1, mat(0xffffff, { map: oak('#b48a5c', '#7d5a3a'), roughness: 0.7 })));
  const n = 5, gap = (fl - top - 1400) / n;
  const tones = [0x2f4a63, 0xa4553a, 0xc99a43, 0xe4dccb, 0x6f8566, 0x6d2f34, 0x3a3b40, 0xb9a98a, 0x5b7c99];
  const books: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[][] = tones.map(() => []);
  for (let s = 0; s <= n; s++) {
    const y = top + s * gap;
    g.add(softBox({ x, y, w, h: shelf }, z0 + side - 10, z1 - side + 10, wood, 40));
    if (s === n) continue;
    // books along the shelf (spines to the room); some shelves leave room for a thing or two
    let z = z0 + side + 200;
    const end = z1 - side - (s % 2 ? 4200 : 300);
    while (z < end) {
      const bw = 450 + rnd() * 500, bh = gap * (0.62 + rnd() * 0.28), bd = 3000 + rnd() * 1200;
      if (z + bw > end) break;
      books[Math.floor(rnd() * tones.length)]!.push({ x: x + 400 + bd / 2, y: -(y + gap) + bh / 2, z: z + bw / 2, sx: bd, sy: bh, sz: bw });
      z += bw + 20;
    }
    if (s % 2) {
      const tz = z1 - side - 2200;
      if (s === 1) g.add(succulent(xf - 2600, y + gap, tz, 1000));
      else g.add(softBox({ x: x + 900, y: y + gap - 1800, w: 3800, h: 1800 }, tz - 1600, tz + 1600, mat(0xe7dfd0, { roughness: 0.8 }), 120));
    }
  }
  g.add(softBox({ x: x + 300, y: fl - 1000, w: w - 500, h: 1000 }, z0 + side, z1 - side, wood, 40));
  const geo = new BoxGeometry(1, 1, 1);
  tones.forEach((t, i) => { if (books[i]!.length) g.add(instanced(geo, mat(t, { roughness: 0.75 }), books[i]!)); });
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
  g.add(softBox({ x: x0 + 200, y: y0 - 60, w: x1 - x0 - 400, h: 260 }, 600, 1600, white, 80));
  const valve = post(x1 + 450, y1 + 300, 1200, 260, 900, white, 14);
  valve.position.y = -(y1 - 400);
  g.add(valve, post(x1 + 450, FLOOR_Y, 1200, 120, FLOOR_Y - y1 - 200, mat(0xdedbd4, { metalness: 0.4, roughness: 0.3 }), 10));
  g.add(post(x0 + 300, FLOOR_Y, 1200, 120, FLOOR_Y - y1, mat(0xdedbd4, { metalness: 0.4, roughness: 0.3 }), 10));
  return g;
}

/** Sill-length linen curtains drawn back to each side of the window, on an oak rod with round finials. */
export function curtains(): Group {
  const g = new Group(), rodY = WINDOW.y - 1900, z = 1500;
  const left = WINDOW.x - 3400, right = WINDOW.x + WINDOW.w + 2300;
  const wood = mat(0xffffff, { map: oak('#a77c52', '#6d4d30'), roughness: 0.5 });
  g.add(rod([left - 500, -rodY, z], [right + 500, -rodY, z], 150, wood, 14));
  for (const fx of [left - 700, right + 700]) { const f = new Mesh(new SphereGeometry(330, 16, 10), wood); f.position.set(fx, -rodY, z); g.add(place(f)); }
  const cloth = mat(0xffffff, { map: weave('#e4d8c3', { repeat: [3, 6] }), roughness: 0.95, side: DoubleSide });
  const panel = (x0: number, x1: number, gather: number) => {
    const w = x1 - x0, h = WINDOW.y + WINDOW.h + 1300 - rodY, geo = new PlaneGeometry(w, h, 40, 8), p = geo.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / w + 0.5, v = 0.5 - p.getY(i) / h;
      // deep folds, a little looser toward the hem, the hem swinging out toward the window
      p.setZ(i, Math.sin(u * Math.PI * 2 * 5.5) * (260 + 140 * v) + Math.sin(u * Math.PI * 2 * 11 + 1) * 60);
      p.setX(i, p.getX(i) + gather * v * v * 500);
    }
    geo.computeVertexNormals();
    const m = place(new Mesh(geo, cloth));
    m.position.set((x0 + x1) / 2, -(rodY + h / 2), z);
    g.add(m);
    for (let k = 0; k <= 8; k++) { const r = new Mesh(new CylinderGeometry(140, 140, 50, 12), wood); r.rotation.x = Math.PI / 2; r.position.set(x0 + (k / 8) * w, -rodY, z); g.add(place(r)); }
  };
  panel(left, WINDOW.x - 300, 1);
  panel(WINDOW.x + WINDOW.w + 300, right, -1);
  return g;
}

// ---------------------------------------------------------------- the door, the ceiling light, the print, the plant
/** A white panelled door in the west wall near the front, its frame, a brushed lever, and the light switch beside it. */
export function door(): Group {
  const g = new Group(), { z0, z1, top } = DOOR, fl = FLOOR_Y, white = mat(0xf2f0eb, { roughness: 0.4 }), xs = WEST_X;
  const box = (y0: number, y1: number, za: number, zb: number, x0: number, x1: number, m: Material) => {
    const o = place(new Mesh(new BoxGeometry(x1 - x0, y1 - y0, zb - za), m));
    o.position.set((x0 + x1) / 2, -(y0 + y1) / 2, (za + zb) / 2);
    return o;
  };
  // the casing round the opening, the leaf a little in, two raised panels
  g.add(box(top - 900, top, z0 - 900, z1 + 900, xs, xs + 300, white));
  g.add(box(top, fl, z0 - 900, z0, xs, xs + 300, white), box(top, fl, z1, z1 + 900, xs, xs + 300, white));
  g.add(box(top, fl - 50, z0, z1, xs - 200, xs + 120, mat(0xeeebe4, { roughness: 0.45 })));
  for (const [a, b] of [[top + 1800, top + 17000], [top + 19500, fl - 2200]] as const) g.add(box(a, b, z0 + 1700, z1 - 1700, xs + 120, xs + 220, white));
  const steel = mat(0xb9bcc0, { metalness: 0.85, roughness: 0.35 });
  const hy = fl - 19000, hz = z0 + 1500;
  g.add(rod([xs + 220, -hy, hz], [xs + 900, -hy, hz], 160, steel, 12), rod([xs + 900, -hy, hz], [xs + 900, -hy, hz + 2000], 150, steel, 12));
  g.add(box(fl - 22600, fl - 20600, z1 + 1500, z1 + 2900, xs, xs + 160, white), box(fl - 22000, fl - 21200, z1 + 1950, z1 + 2450, xs + 160, xs + 240, mat(0xe2dfd8, { roughness: 0.5 })));
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
  g.add(place(pot));
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

/** A woven basket for paper under the desk. */
export function basket(x: number, z: number): Mesh {
  const m = new Mesh(new CylinderGeometry(1700, 1350, 5200, 24, 1, true), mat(0xffffff, { map: weave('#b99568', { knit: true, repeat: [8, 4] }), roughness: 0.9, side: DoubleSide }));
  m.position.set(x, -FLOOR_Y + 2600, z);
  return place(m);
}
