// The case's basement in 3D (docs/GRAPHICS_3D_OVERHAUL.md "Basement"). Under the shroud: the power supply at the back corner, beside its mains
// inlet in the case's rear wall, at a real size; and the drives in a stepped cage beside it, filed two rows deep, each drive standing face to the
// glass, the back row raised on a step so it shows over the front one. The 2D keeps its column of bays east of the board (it has no depth to
// file them in); a drive here is the 2D drive (its body and its drawing) moved to its bay.
import { BoxGeometry, Group, Mesh, PlaneGeometry, type MeshStandardMaterial } from 'three';
import { instanced, paint, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { decalX, perfMat, type Span } from './casekit3d';
import { mat } from '@/core/render/three/materials';
import { tag } from '@/core/render/three/pick';
import { CASE_D, CASE_Z } from '@/features/room/render/three/roomplan';
import { driveBody, type DriveKind } from '@/features/storage/render/drives';
import { BAY_CELLS, CASE, CASE_IN, PC_POWER, PSU } from '../layout/layout';

const FRONT = CASE_Z + CASE_D;
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

/** Where everything in the basement goes for `n` drive bays (the board's SATA count, `BAY_CELLS`). */
export function basementPlan(n = BAY_CELLS.length): BasementPlan {
  const floor = CASE.y + CASE.h - 150, top = PSU.y, east = PSU.x + PSU.w;
  const psu = { x: CASE_IN.x + 20, y: floor - 960, w: 1600, h: 950, z0: CASE_Z + 260, z1: CASE_Z + 1960 };
  const hdd = driveBody('hdd', 'sata0'), gap = 90, x0 = psu.x + psu.w + 240, W = east - 140 - x0;
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
 * The shroud over the basement: its top, its glass-side panel over the power supply (the case's name printed on it; it answers a click as the
 * PSU), the panel's narrow east end and the shroud's east wall. Over the cage the front is open, the drives show through the glass.
 */
export function shroud(p: BasementPlan, look: { body: number; ink: string } = { body: 0x26282d, ink: '#c9ced6' }): Group {
  const g = new Group(), m = mat(look.body, { roughness: 0.45, metalness: 0.3 }), zb = CASE_Z + 70, zf = FRONT - 70;
  const bg = `#${look.body.toString(16).padStart(6, '0')}`;
  g.add(rectBox({ x: CASE_IN.x, y: p.top, w: p.east - CASE_IN.x, h: 60 }, zb, zf, m));
  const west = { x: CASE_IN.x, y: p.top, w: p.cage.x - 110 - CASE_IN.x, h: p.floor - p.top };
  const panel = tag(new Group(), 'psu');
  panel.add(rectBox(west, zf - 40, zf, m));
  const W = 1024, H = Math.max(64, Math.round((W * west.h) / west.w));
  const print = paint(W, H, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(0, 0, W, 6);
    c.fillStyle = look.ink; c.textBaseline = 'middle'; c.textAlign = 'center';
    c.font = `600 ${Math.round(Math.min(H * 0.34, W * 0.1))}px system-ui, sans-serif`; c.fillText('PIPELINE CITY', W / 2, H / 2);
  });
  const face = new Mesh(new PlaneGeometry(west.w, west.h), mat(0xffffff, { map: print, roughness: 0.45, metalness: 0.2 }));
  face.position.set(west.x + west.w / 2, -(west.y + west.h / 2), zf + 2);
  panel.add(face);
  g.add(panel);
  const eastLip = p.cage.x + p.cage.w + 110;
  if (eastLip < p.east) g.add(rectBox({ x: eastLip, y: p.top, w: p.east - eastLip, h: p.floor - p.top }, zf - 40, zf, m));
  g.add(rectBox({ x: p.east - 40, y: p.top, w: 40, h: p.floor - p.top }, zb, zf, m));
  return g;
}

/** The cage: a holder under each bay (a steel channel with a lip at each end), the step the back row stands on, the cage's back plate. */
export function cage(p: BasementPlan): Group {
  const g = new Group(), steel = mat(0x3a4152, { metalness: 0.6, roughness: 0.4 }), dark = mat(0x101217, { roughness: 0.8 });
  if (p.step) g.add(softBox(p.step, p.step.z0, p.step.z1, steel, 14));
  const d = driveDepth('hdd');
  for (const b of p.bays) {
    const z0 = b.face - d * b.k - 30, z1 = b.face + 20;
    g.add(rectBox({ x: b.x - 20, y: b.y + b.h, w: b.w + 40, h: 20 }, z0, z1, steel));
    for (const x of [b.x - 20, b.x + b.w]) g.add(rectBox({ x, y: b.y + b.h * 0.8, w: 20, h: b.h * 0.2 }, z0, z0 + 40, steel));
  }
  const back = cageBack(p);
  g.add(rectBox({ x: p.cage.x - 80, y: p.top + 60, w: p.cage.w + 160, h: p.floor - p.top - 60 }, back - 30, back, dark));
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
 * The power supply at its place: the body, the honeycomb grille of its fan on the top (it breathes up through the shroud), the modular sockets on
 * its east face. Its rear shows through the case's back wall with the mains inlet and the switch (`PC_POWER`, where the cord plugs in).
 */
export function psuUnit(p: BasementPlan): { root: Group; body: MeshStandardMaterial } {
  const g = new Group(), u = p.psu, body = mat(0x22242a, { metalness: 0.4, roughness: 0.45 }), black = mat(0x07080b, { roughness: 0.6 });
  g.add(softBox(u, u.z0, u.z1, body, 30));
  const holes = [];
  for (let x = u.x + 140; x < u.x + u.w - 120; x += 70) for (let z = u.z0 + 140; z < u.z1 - 120; z += 70) holes.push({ x, y: -u.y, z, sx: 40, sy: 6, sz: 40 });
  g.add(instanced(new BoxGeometry(1, 1, 1), black, holes));
  const ex = u.x + u.w;
  for (let k = 0; k < 6; k++) g.add(rectBox({ x: ex, y: u.y + 140 + (k % 3) * 220, w: 14, h: 140 }, u.z0 + 300 + Math.floor(k / 3) * 600, u.z0 + 520 + Math.floor(k / 3) * 600, black));
  // the rear, in the case's back wall: the grille, the inlet and the switch
  const zc = (u.z0 + u.z1) / 2, rear = CASE.x;
  g.add(rectBox({ x: rear - 8, y: u.y + 60, w: 8, h: u.h - 120 }, u.z0 + 80, u.z1 - 80, mat(0x07080a, { roughness: 0.8 })));
  // its exhaust: a honeycomb grille over the plate, beside the inlet
  const gs: Span = { y0: u.y + 100, y1: u.y + u.h - 100, z0: u.z0 + 120, z1: zc + 60 };
  g.add(decalX(rear - 10, gs, -1, perfMat('hex', gs.z1 - gs.z0, gs.y1 - gs.y0, 70, 0x5a5f69, { metal: 0.6, rough: 0.4 })));
  g.add(rectBox({ x: rear - 26, y: PC_POWER.y - 70, w: 20, h: 140 }, zc + 150, zc + 400, black));
  g.add(rectBox({ x: rear - 22, y: PC_POWER.y - 60, w: 16, h: 100 }, zc - 260, zc - 120, mat(0x8a1c22, { roughness: 0.5 })));
  return { root: g, body };
}

/** Where the mains cord plugs in: the inlet on the case's rear wall (world point), the cord leaving west. */
export const mainsInlet = (p: BasementPlan): [number, number, number] => [CASE.x - 26, -PC_POWER.y, (p.psu.z0 + p.psu.z1) / 2 + 275];
