// The case's basement in 3D (docs/GRAPHICS_3D_OVERHAUL.md "Basement"). Under the shroud: the power supply at the back corner, its rear in the case's
// rear wall with the mains inlet, about 0.65 of a real ATX unit's size (the case is smaller than life, and the basement sets the room); and the drives
// in a stepped cage beside it, filed two rows deep, each drive standing face to the glass, the back row raised on a step so it shows over the front one.
// The 2D keeps its column of bays east of the board (it has no depth to file them in); a drive here is the 2D drive (its body and its drawing) moved to its bay.
import { CircleGeometry, CylinderGeometry, Group, Mesh, PlaneGeometry, type Material, type MeshStandardMaterial } from 'three';
import { instanced, paint, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { decal, decalX, flatSlot, NONE, outlinePts, pads, perfMat, perforated, plateY, ring, rivets, screws, shapeOf, slab, tex, thumbscrews, wallX, type Span, type Spot } from './casekit3d';
import { mat } from '@/core/render/three/materials';
import { tag } from '@/core/render/three/pick';
import { CASE_FRONT as FRONT, CASE_Z } from '@/features/room/render/three/roomplan';
import type { CaseKind } from '@/features/room/render/shell/casedecor';
import { driveBody, type DriveKind } from '@/features/storage/render/drives';
import { BAY_CELLS, CASE, CASE_IN, PC_POWER, PSU } from '../layout/layout';

/** How deep a drive's body is behind its face (the hard disk's base and lid, the SSD's shell: `sataDrive`). */
export const driveDepth = (kind: DriveKind): number => (kind === 'hdd' ? 176 : 76);

/** A bay: where its drive's face goes (an HDD-sized rect, layout coordinates, y down), the depth of that face, its row, its scale. */
export interface Bay { slot: number; x: number; y: number; w: number; h: number; face: number; row: 0 | 1; k: number }

export interface BasementPlan {
  /** The basement's floor and the shroud's top (layout y), the shroud's east end (layout x). */
  floor: number; top: number; east: number;
  /** The power supply's box: a layout rect and a depth range. */
  psu: RectLike & { z0: number; z1: number };
  /** The cage's span along x, and the step the back row stands on (null with one row). */
  cage: { x: number; w: number };
  step: RectLike & { z0: number; z1: number } | null;
  bays: Bay[];
}

/** The room east of the power supply: it slides this far off the rear wall before it comes out through the shroud's side (`buildmotion.ts`, 240), past the cover's edge and the cage. */
const PSU_ROOM = 360;
/** The shroud's panel over the power supply comes off to reach it: its object's name (a click on it still answers as the PSU). */
export const PSU_COVER = 'psu-cover';
/** The power supply unit's object's name, in the device's group. */
export const PSU_BODY = 'psu-body';
/** The radius of the supply's fan, on its underside over the floor's opening, and where it sits along x: toward the cable end, clear of the case's rear feet. */
export const PSU_FAN_R = 560;
export const psuFanX = (u: RectLike): number => u.x + u.w - PSU_FAN_R - 130;
/** The supply's opening in the rear wall: its rear slides out of it. */
export const psuOpening = (u: BasementPlan['psu']): Span => ({ y0: u.y + 30, y1: u.y + u.h - 30, z0: u.z0 + 30, z1: u.z1 - 30 });

/** Where everything in the basement goes for `n` drive bays (the board's SATA count, `BAY_CELLS`). */
export function basementPlan(n = BAY_CELLS.length): BasementPlan {
  const floor = CASE.y + CASE.h - 150, top = PSU.y, east = PSU.x + PSU.w;
  const psu = { x: CASE_IN.x + 20, y: floor - 20 - 1230, w: 2150, h: 1230, z0: CASE_Z + 260, z1: CASE_Z + 2260 };
  const hdd = driveBody('hdd', 'sata0'), gap = 90, x0 = psu.x + psu.w + PSU_ROOM, W = east - 140 - x0;
  // one row while they fit across, else two (the back row raised); smaller drives where even two rows do not fit
  const across = Math.max(1, Math.floor((W + gap) / (hdd.w + gap))), rows: 1 | 2 = n > across ? 2 : 1, cols = Math.max(1, Math.ceil(n / rows));
  const room = floor - 20 - (top + 90), k = Math.min(1, (W + gap) / (cols * (hdd.w + gap)), rows === 2 ? room / (hdd.h * 1.75) : room / hdd.h);
  const w = hdd.w * k, h = hdd.h * k, rise = rows === 2 ? Math.min(h * 0.9, room - h) : 0, span = cols * (w + gap) - gap, left = x0 + (W - span) / 2;
  const face = [FRONT - 170, FRONT - 170 - Math.max(420, driveDepth('hdd') * k + 220)] as const;
  const bays: Bay[] = Array.from({ length: n }, (_, i) => {
    const row = (rows === 2 && i >= cols ? 1 : 0) as 0 | 1, col = row ? i - cols : i;
    return { slot: i, x: left + col * (w + gap), y: floor - 20 - h - (row ? rise : 0), w, h, face: face[row], row, k };
  });
  const step = rows === 2 ? { x: left - 60, y: floor - 20 - rise, w: span + 120, h: rise + 20, z0: face[1] - driveDepth('hdd') * k - 120, z1: face[1] + 60 } : null;
  return { floor, top, east, psu, cage: { x: left, w: span }, step, bays };
}

/**
 * The shroud over the basement: its top (a sheet with cable holes by the tray and vent slots over the cage, riveted to the tray along a flange), its
 * glass-side cover over the power supply (the case's name printed on it, a vented band, two thumbscrews and two screws; it comes off to reach the supply
 * and answers a click as the PSU), the fold and the sill of the cage's opening, the panel's narrow east end and the shroud's east wall, slotted so the
 * front fans' air reaches the drives. Over the cage the front is open, the drives show through the glass. On the floor, the strips the supply stands on.
 */
export function shroud(p: BasementPlan, look: { body: number; ink: string } = { body: 0x26282d, ink: '#c9ced6' }, rivet: Material = mat(0x2b3142, { metalness: 0.45, roughness: 0.42 }), screw: Material = mat(0x2a2c33, { metalness: 0.65, roughness: 0.38 })): Group {
  const g = new Group(), m = mat(look.body, { roughness: 0.45, metalness: 0.3 }), zb = CASE_Z + 70, zf = FRONT - 70;
  const bg = `#${look.body.toString(16).padStart(6, '0')}`;
  const holes = [flatSlot(CASE_IN.x + 520, zb + 130, 760, 170), flatSlot(p.psu.x + p.psu.w - 620, zb + 130, 760, 170)];
  for (let z = cageBack(p) + 40; z + 46 < zf - 110; z += 120) for (let x = p.cage.x + 40; x + 300 < p.cage.x + p.cage.w; x += 380) holes.push(flatSlot(x, z, 300, 46));
  g.add(plateY(CASE_IN.x, p.east, zb, zf, p.top, 30, holes, m, 4));
  // the flange down the tray, and its rivets
  g.add(softBox({ x: CASE_IN.x, y: p.top - 50, w: p.east - CASE_IN.x, h: 50 }, zb - 1, zb + 10, m, 3));
  const tray: Spot[] = [];
  for (let x = CASE_IN.x + 300; x < p.east - 150; x += 620) tray.push({ x, y: -(p.top - 25), z: zb + 10 });
  g.add(rivets(tray, 'z+', 40, rivet));

  const west = { x: CASE_IN.x, y: p.top, w: p.cage.x - 110 - CASE_IN.x, h: p.floor - p.top };
  const panel = tag(new Group(), 'psu');
  panel.name = PSU_COVER;
  panel.add(softBox(west, zf - 40, zf, m, 8));
  const knurl = mat(0x8e949c, { metalness: 0.75, roughness: 0.38 }), tx = west.x + west.w - 170;
  panel.add(thumbscrews([west.y + 170, west.y + west.h - 170].map((y) => ({ x: tx, y: -y, z: zf + 2 })), 'z+', 80, 48, knurl));
  panel.add(screws([west.y + 110, west.y + west.h - 110].map((y) => ({ x: west.x + 110, y: -y, z: zf + 2 })), 'z+', 48, screw));
  const W = 1024, H = Math.max(64, Math.round((W * west.h) / west.w));
  const print = paint(W, H, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(0, 0, W, 6);
    c.fillStyle = look.ink; c.textBaseline = 'middle'; c.textAlign = 'center';
    c.font = `600 ${Math.round(Math.min(H * 0.28, W * 0.056))}px system-ui, sans-serif`; c.fillText('PIPELINE CITY', W * 0.36, H / 2);
  });
  const face = new Mesh(new PlaneGeometry(west.w, west.h), mat(0xffffff, { map: print, roughness: 0.45, metalness: 0.2 }));
  face.position.set(west.x + west.w / 2, -(west.y + west.h / 2), zf + 2);
  panel.add(face);
  const vent: RectLike = { x: west.x + west.w - 1020, y: west.y + 170, w: 640, h: west.h - 340 };
  panel.add(ring(vent, 14, NONE, 14, zf, zf + 9, m));
  perforated(panel, vent, zf + 3, 'slot', 110, look.body, { metal: 0.35, rough: 0.5 });
  g.add(panel);

  // the opening over the cage: the sheet's fold along its top, a low sill along the floor
  const x0 = west.x + west.w, eastLip = Math.min(p.east, p.cage.x + p.cage.w + 110);
  g.add(softBox({ x: x0, y: p.top, w: eastLip - x0, h: 70 }, zf - 40, zf, m, 6), rectBox({ x: x0, y: p.floor - 40, w: eastLip - x0, h: 40 }, zf - 40, zf, m));
  if (eastLip < p.east) g.add(rectBox({ x: eastLip, y: p.top, w: p.east - eastLip, h: p.floor - p.top }, zf - 40, zf, m));
  const slots: Span[] = [];
  for (let y = p.top + 170; y + 60 < p.floor - 90; y += 130) slots.push({ y0: y, y1: y + 60, z0: zb + 320, z1: zf - 320, r: 30 });
  g.add(wallX(p.east - 40, p.east, { y0: p.top, y1: p.floor, z0: zb, z1: zf }, slots, m));

  // the rubber strips under the power supply, either side of its fan
  const u = p.psu, rubber = mat(0x0b0b0d, { roughness: 0.92 });
  for (const z of [u.z0 + 60, u.z1 - 200]) g.add(rectBox({ x: u.x + 90, y: u.y + u.h, w: u.w - 180, h: 20 }, z, z + 140, rubber));
  return g;
}

/** Each kind's cage: bare zinc in the Mini, its paint in the others. */
const CAGE_TONE: Record<CaseKind, number> = { oem: 0xa9aca4, matte: 0x1b1c20, gamer: 0x232838, show: 0x2a2d33 };

/**
 * The cage, in its case's finish: a caddy in each bay (a floor plate with a slot and rubber feet, a windowed rail either side with its screws and front
 * ears, a windowed back plate: a drive's cables leave through them), the vented shelf the back row stands on, the end walls, the perforated back.
 */
export function cage(p: BasementPlan, kind: CaseKind = 'gamer'): Group {
  const g = new Group(), tone = CAGE_TONE[kind], steel = mat(tone, { metalness: 0.6, roughness: 0.42 }), d = driveDepth('hdd');
  const bolt = mat(kind === 'oem' ? 0xc9cbc3 : 0x62666e, { metalness: 0.8, roughness: 0.35 }), rubber = mat(0x0b0b0d, { roughness: 0.92 }), back = cageBack(p), front = FRONT - 150;
  // the perforated back, and the end walls with a window the drives' cables pass
  const rear: RectLike = { x: p.cage.x - 80, y: p.top + 60, w: p.cage.w + 160, h: p.floor - p.top - 60 };
  g.add(rectBox(rear, back - 30, back, mat(0x08090b, { roughness: 0.85 })));
  perforated(g, rear, back + 1, 'round', 80, tone, { metal: 0.55, rough: 0.45 });
  for (const x of [p.cage.x - 70, p.cage.x + p.cage.w + 56]) g.add(wallX(x, x + 14, { y0: p.top + 30, y1: p.floor, z0: back, z1: front }, [{ y0: p.top + 150, y1: p.floor - 40, z0: back + 70, z1: front - 90, r: 40 }], steel, 2));

  // the shelf: a slotted top, a leg at each end and at each gap, its perforated front
  if (p.step) {
    const s = p.step, top = s.y + 18, slots = [];
    for (let z = s.z0 + 60; z + 40 < s.z1 - 50; z += 96) for (let x = s.x + 80; x + 280 < s.x + s.w - 60; x += 340) slots.push(flatSlot(x, z, 280, 40));
    g.add(plateY(s.x, s.x + s.w, s.z0, s.z1, top, 18, slots, steel, 3));
    const legs = [s.x, s.x + s.w - 18, ...p.bays.filter((b) => b.row === 1).slice(1).map((b) => b.x - 54)];
    for (const x of legs) g.add(rectBox({ x, y: top + 18, w: 18, h: s.y + s.h - top - 18 }, s.z0, s.z1, steel));
    perforated(g, { x: s.x + 18, y: top + 18, w: s.w - 36, h: s.y + s.h - top - 18 }, s.z1 - 12, 'round', 70, tone, { metal: 0.55, rough: 0.45 });
  }

  const feet: Spot[] = [], fronts: Spot[] = [], westHeads: Spot[] = [], eastHeads: Spot[] = [];
  for (const b of p.bays) {
    const z0 = b.face - d * b.k - 30, z1 = b.face + 20, y0 = b.y + b.h * 0.2, y1 = b.y + b.h, midZ = (z0 + z1) / 2;
    g.add(plateY(b.x - 26, b.x + b.w + 26, z0, z1, y1, 18, [flatSlot(b.x + b.w * 0.2, midZ - 16, b.w * 0.6, 32)], steel, 3));
    const window: Span = { y0: b.y + b.h * 0.3, y1: b.y + b.h * 0.78, z0: z0 + 36, z1: z1 - 36, r: 22 };
    for (const x of [b.x - 26, b.x + b.w + 6]) g.add(wallX(x, x + 20, { y0, y1, z0, z1 }, [window], steel, 2));
    const pane = { y: y0 + 70, h: y1 - y0 - 150 };
    g.add(slab(shapeOf(outlinePts({ x: b.x - 26, y: y0, w: b.w + 52, h: y1 - y0 }, 6), [outlinePts({ x: b.x + b.w * 0.1, ...pane, w: b.w * 0.36 }, 22), outlinePts({ x: b.x + b.w * 0.54, ...pane, w: b.w * 0.36 }, 22)]), z0 - 12, z0, steel, 2));
    // the ears at the front of the rails, and their screws
    for (const [x, sx] of [[b.x - 42, b.x - 24], [b.x + b.w + 6, b.x + b.w + 24]] as const) for (const y of [y0 + 44, y1 - 54]) {
      g.add(softBox({ x, y: y - 34, w: 36, h: 68 }, z1 - 12, z1, steel, 2));
      fronts.push({ x: sx, y: -y, z: z1 });
    }
    westHeads.push({ x: b.x - 26, y: -(y1 - b.h * 0.1), z: midZ });
    eastHeads.push({ x: b.x + b.w + 26, y: -(y1 - b.h * 0.1), z: midZ });
    for (const x of [b.x + 70, b.x + b.w - 70]) for (const z of [z0 + 46, z1 - 46]) feet.push({ x, y: -y1, z });
  }
  g.add(pads(feet, 'y+', 30, rubber), screws(fronts, 'z+', 24, bolt), screws(westHeads, 'x-', 26, bolt), screws(eastHeads, 'x+', 26, bolt));
  return g;
}

/** The depth of the cage's back plate (the drives' cables go back through it). */
export const cageBack = (p: BasementPlan): number => p.bays.reduce((z, b) => Math.min(z, b.face - driveDepth('hdd') * b.k - 160), FRONT);

/** The unseen box an empty bay is picked by. */
export function bayHit(b: Bay): Mesh {
  const o = rectBox(b, b.face - driveDepth('hdd') * b.k, b.face, mat(0, { transparent: true, opacity: 0, depthWrite: false }));
  o.castShadow = o.receiveShadow = false;
  return o;
}

/**
 * Move a drive built at its 2D body `body` (its face at depth `faceZ`) into bay `b`: scaled to the bay, centred across it, standing on its
 * holder, its face at the bay's depth.
 */
export function intoBay(drive: Group, body: RectLike, faceZ: number, b: Bay): Group {
  const g = new Group(), k = b.k, x = b.x + (b.w - body.w * k) / 2, y = b.y + b.h - body.h * k;
  g.position.set(x - k * body.x, -y + k * body.y, b.face - k * faceZ);
  g.scale.setScalar(k);
  g.add(drive);
  return g;
}

/**
 * The power supply at its place: the body, its maker's sticker on the side that faces the glass, the modular sockets on its east face. It breathes
 * through the case's floor: a fan under a honeycomb guard on its underside, or a passive unit's punched vent (`fan` false: the sim's two cheapest).
 * Its rear stands in the opening of the case's back wall, one plate with its four screws, the exhaust grille, the mains inlet and the switch
 * (`PC_POWER`, where the cord plugs in).
 */
export function psuUnit(p: BasementPlan, visual = 'psu-basic', fan = true): { root: Group; body: MeshStandardMaterial } {
  const g = new Group(), u = p.psu, body = mat(0x22242a, { metalness: 0.4, roughness: 0.45 }), black = mat(0x07080b, { roughness: 0.6 });
  g.name = PSU_BODY;
  g.add(softBox(u, u.z0, u.z1, body, 30));
  // its tier's look (the 2D drawings': a plain case, a banded one, the big modular unit with its lead sockets and a wide band)
  const band = visual === 'psu-big' ? 0xd9a441 : visual === 'psu-mid' ? 0x3b6ea8 : 0, bm = band ? mat(band, { roughness: 0.4, metalness: 0.5 }) : null;
  if (bm) {
    g.add(rectBox({ x: u.x, y: u.y + u.h * 0.22 - 22, w: u.w, h: 44 }, u.z0 - 3, u.z1 + 3, bm));
    if (visual === 'psu-big') g.add(rectBox({ x: u.x, y: u.y + u.h * 0.78 - 14, w: u.w, h: 28 }, u.z0 - 3, u.z1 + 3, bm));
  }
  const zc = (u.z0 + u.z1) / 2, yb = u.y + u.h;
  // the sticker on the glass side
  const sticker = tex('psu-sticker', 512, 256, (c, w, h) => {
    c.fillStyle = '#c9ced6'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#17181c'; c.textBaseline = 'middle'; c.font = '700 44px system-ui, sans-serif'; c.fillText('POWER SUPPLY', 28, 56);
    c.font = '500 22px system-ui, sans-serif'; c.fillText('ATX  100-240 V AC  50/60 Hz', 28, 114); c.fillText('+12 V  +5 V  +3.3 V  -12 V', 28, 150);
    for (let k = 0; k < 42; k++) c.fillRect(28 + k * 11, 186, k % 3 ? 3 : 7, 42);
  });
  g.add(decal({ x: u.x + 340, y: u.y + u.h * 0.3, w: 1000, h: u.h * 0.4 }, u.z1 + 1, mat(sticker ? 0xffffff : 0xc9ced6, { map: sticker, roughness: 0.6 })));
  // its underside, over the floor's opening: a fan behind a honeycomb guard, or a passive unit's punched vent
  if (fan) {
    const x = psuFanX(u), guard = new Mesh(new CircleGeometry(PSU_FAN_R, 48), perfMat('hex', 2 * PSU_FAN_R, 2 * PSU_FAN_R, 70, 0x5a5f69, { metal: 0.6, rough: 0.4 })), floor = new Mesh(new CircleGeometry(PSU_FAN_R, 48), black);
    floor.rotation.x = guard.rotation.x = Math.PI / 2;
    floor.position.set(x, -yb - 1, zc);
    guard.position.set(x, -yb - 3, zc);
    g.add(floor, guard);
  } else {
    const w = 2 * PSU_FAN_R, x = psuFanX(u), vent = new Mesh(new PlaneGeometry(w, w), perfMat('round', w, w, 60, 0x5a5f69, { metal: 0.6, rough: 0.4 })), floor = new Mesh(new PlaneGeometry(w, w), black);
    floor.rotation.x = vent.rotation.x = Math.PI / 2;
    floor.position.set(x, -yb - 1, zc);
    vent.position.set(x, -yb - 3, zc);
    g.add(floor, vent);
  }
  const ex = u.x + u.w;
  for (let k = 0; k < 6; k++) g.add(rectBox({ x: ex, y: u.y + 240 + (k % 3) * 280, w: 14, h: 180 }, u.z0 + 460 + Math.floor(k / 3) * 680, u.z0 + 740 + Math.floor(k / 3) * 680, black));
  // the rear: a snout from the body through the wall's opening, its end the plate, flush with the wall's outer face
  const o = psuOpening(u), rear = CASE.x;
  g.add(rectBox({ x: rear, y: o.y0 + 2, w: u.x - rear + 4, h: o.y1 - o.y0 - 4 }, o.z0 + 2, o.z1 - 2, body));
  g.add(rectBox({ x: rear - 8, y: o.y0 + 2, w: 8, h: o.y1 - o.y0 - 4 }, o.z0 + 2, o.z1 - 2, mat(0x07080a, { roughness: 0.8 })));
  const pts = [[o.y0 + 70, o.z0 + 70], [o.y0 + 70, o.z1 - 70], [o.y1 - 70, o.z0 + 70], [o.y1 - 70, o.z1 - 70]].map(([y, z]) => ({ x: rear - 14, y: -y!, z: z! }));
  g.add(instanced(new CylinderGeometry(30, 30, 12, 14).rotateZ(Math.PI / 2), mat(0x8e949c, { metalness: 0.75, roughness: 0.38 }), pts));
  // its exhaust: a honeycomb grille over the plate, beside the inlet
  const gs: Span = { y0: u.y + 150, y1: u.y + u.h - 150, z0: u.z0 + 170, z1: zc + 60 };
  g.add(decalX(rear - 10, gs, -1, perfMat('hex', gs.z1 - gs.z0, gs.y1 - gs.y0, 70, 0x5a5f69, { metal: 0.6, rough: 0.4 })));
  g.add(rectBox({ x: rear - 26, y: PC_POWER.y - 70, w: 20, h: 140 }, zc + 150, zc + 400, black));
  g.add(rectBox({ x: rear - 22, y: PC_POWER.y - 60, w: 16, h: 100 }, zc + 480, zc + 620, mat(0x8a1c22, { roughness: 0.5 })));
  return { root: g, body };
}

/** Where the mains cord plugs in: the inlet on the case's rear wall (world point), the cord leaving west. */
export const mainsInlet = (p: BasementPlan): [number, number, number] => [CASE.x - 26, -PC_POWER.y, (p.psu.z0 + p.psu.z1) / 2 + 275];
