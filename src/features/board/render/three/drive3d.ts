// A SATA drive as real hardware (docs/PC_PARTS.md "Storage"), the same in the case, in Build my PC and in the gallery. The hard disk is a 3.5 in.
// drive, 147 x 101.6 x 26.1 mm: a cast aluminium base, a brushed stainless cover on its top with its Torx screws (the spindle's and the
// actuator's among them), the maker's white label over the cover (the spindle's screw shows through its hole, the breather hole is left bare),
// three threaded holes along each side, its board on the underside (the motor's boss beside it), the SATA power and data receptacles and the
// jumper pins in a pocket at its back. The SSD is a 2.5 in. drive, 100 x 69.85 x 7 mm: a sandblasted aluminium top shell over a dark base,
// its label, two holes along each side and four under it, the receptacles at its back. Each is built lying flat in its own frame: x across,
// y up, z along it from the connector end (0) to its front; a tray of the cage (drivecage3d.ts) carries it in the case.
import { BoxGeometry, CircleGeometry, CylinderGeometry, Group, Mesh, Vector2, type Material, type MeshStandardMaterial, type Texture } from 'three';
import { extrude, instanced, place, rectBox, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import type { RopeEnd, V3 } from '@/core/render/three/rope';
import { brushed, decalTop, outlinePts, screws, shapeOf, slab, tex, tiled, turned, type Facing, type Spot } from './casekit3d';
import { barcode, FONT, hash, matrix, MONO, roundRect, seeded } from './nvme3d';
import { decalMat, gold, MM } from './pcbkit3d';

const m = (v: number) => v * MM;

/** The two sizes, in mm: across, tall, long. */
export const HDD_MM = { w: 101.6, t: 26.1, l: 147 } as const;
export const SSD_MM = { w: 69.85, t: 7, l: 100 } as const;

/** What a drive prints on its label. */
export interface DriveLook { name: string; capacityBytes: number }

export interface DriveModel {
  root: Group;
  /** The material the machine lights with the drive's state (the hard disk's cast base, the SSD's top shell). */
  body: MeshStandardMaterial;
  /** Its size in units: across, tall, long. */
  w: number; t: number; l: number;
  /** The mouths of its receptacles (its own frame, at its back end): a cable's plug goes in along +z. */
  data: V3; power: V3;
}

// ------------------------------------------------------------------ shapes in the drive's frame (y up)
/** A box over x0..x1, y0..y1 and z0..z1. */
export const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mt: Material) => rectBox({ x: x0, y: -y1, w: x1 - x0, h: y1 - y0 }, z0, z1, mt);
/** An outline across the drive (x, z), its corners rounded by r. */
export const xz = (x0: number, z0: number, x1: number, z1: number, r: number): Vector2[] => outlinePts({ x: x0, y: -z1, w: x1 - x0, h: z1 - z0 }, r);
/** An outline on an end (x, y up). */
export const xy = (x0: number, y0: number, x1: number, y1: number, r: number): Vector2[] => outlinePts({ x: x0, y: -y1, w: x1 - x0, h: y1 - y0 }, r);

/** A flat piece with the (x, z) outline `pts` from y0 up to y1, its edges rounded by `bevel`. */
export function flat(pts: Vector2[], y0: number, y1: number, mt: Material, bevel = 0, holes: Vector2[][] = []): Mesh {
  const b = Math.max(0, Math.min(bevel, (y1 - y0) / 2.2));
  const g = extrude(shapeOf(pts, holes), { depth: y1 - y0 - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 8 });
  // (the shape's (u, v) is (x, z); the extrusion runs down from the top)
  g.translate(0, 0, b).rotateX(Math.PI / 2).translate(0, y1, 0);
  return place(new Mesh(g, mt));
}

/** A rounded (x, z) rectangle w by l with a pocket cut into its z = 0 end from x0 to x1, d deep (where the receptacles sit). */
export function pocketed(w: number, l: number, r: number, p: { x0: number; x1: number; d: number }): Vector2[] {
  const out: Vector2[] = [];
  const arc = (cx: number, cz: number, a0: number, a1: number) => { for (let i = 0; i <= 6; i++) { const a = a0 + ((a1 - a0) * i) / 6; out.push(new Vector2(cx + Math.cos(a) * r, cz + Math.sin(a) * r)); } };
  arc(r, r, Math.PI, Math.PI * 1.5);
  out.push(new Vector2(p.x0, 0), new Vector2(p.x0, p.d), new Vector2(p.x1, p.d), new Vector2(p.x1, 0));
  arc(w - r, r, Math.PI * 1.5, Math.PI * 2);
  arc(w - r, l - r, 0, Math.PI / 2);
  arc(r, l - r, Math.PI / 2, Math.PI);
  return out;
}

/** Threaded holes in a face (looking along `f`): a dark bore in a lighter chamfer. */
export function bores(spots: readonly Spot[], f: Facing, r: number): Group {
  const g = new Group();
  if (!spots.length) return g;
  g.add(instanced(turned(new CircleGeometry(r * 1.3, 18).translate(0, 0, 0.4), f), mat(0x5a6067, { metalness: 0.6, roughness: 0.5 }), spots));
  g.add(instanced(turned(new CircleGeometry(r, 18).translate(0, 0, 0.8), f), mat(0x060708, { roughness: 0.9 }), spots));
  return g;
}

/** The receptacle's parts: the black body, the dark of its mouth, the gold contacts. */
interface SocketMats { body: Material; dark: Material; gold: Material }
const socketMats = (): SocketMats => ({ body: mat(0x16171a, { roughness: 0.5 }), dark: mat(0x050506, { roughness: 0.9 }), gold: gold() });

/** A receptacle's width: 7 (data) or 15 (power) contacts at 1.27 mm, and its walls. */
const socketW = (pins: 7 | 15) => m(pins * 1.27 + (pins === 7 ? 1.5 : 3.55));

/**
 * A SATA receptacle, its mouth at z = 0.3 mm looking -z: a black shroud 5 mm tall round its L-shaped mouth (the key's foot at its west end),
 * the blade inside with its contacts on its underside. `x0` its west end, `y0` its foot. Returns the mouth's centre.
 */
function receptacle(g: Group, pins: 7 | 15, x0: number, y0: number, s: SocketMats): V3 {
  const w = socketW(pins), h = m(5), z0 = m(0.3), d = m(6.4);
  const mouth = [[0.9, 0.9], [-0.9, 0.9], [-0.9, 3.4], [2.6, 3.4], [2.6, 4.2], [0.9, 4.2]].map(([u, v]) => new Vector2(u! < 0 ? x0 + w + m(u!) : x0 + m(u!), y0 + m(v!)));
  g.add(slab(shapeOf(xy(x0, y0, x0 + w, y0 + h, m(0.4)), [mouth]), z0, d, s.body, m(0.12)));
  g.add(box(x0 + m(0.9), x0 + w - m(0.9), y0 + m(0.9), y0 + m(4.2), d - m(1.2), d - m(0.4), s.dark));
  g.add(box(x0 + m(1.3), x0 + w - m(1.3), y0 + m(2.0), y0 + m(2.7), z0 + m(0.8), d - m(1.2), s.body));
  const pitch = m(1.27), first = x0 + (w - (pins - 1) * pitch) / 2, len = d - m(2.4);
  g.add(instanced(new BoxGeometry(m(0.55), m(0.12), len), s.gold, Array.from({ length: pins }, (_, i) => ({ x: first + i * pitch, y: y0 + m(1.94), z: z0 + m(0.8) + len / 2 }))));
  return [x0 + w / 2, y0 + h / 2, 0];
}

// ------------------------------------------------------------------ the hard disk
/** The 3.5 in. hard disk (see the header). */
export function hddModel(look: DriveLook): DriveModel {
  const g = new Group(), W = m(HDD_MM.w), T = m(HDD_MM.t), L = m(HDD_MM.l), top = T - m(0.8), r = m(2.2);
  const cast = mat(0x8e949b, { metalness: 0.72, roughness: 0.52 });
  const cover = mat(0xd5d9dd, { metalness: 0.92, roughness: 0.27, map: tiled(brushed(), 2, 3) });
  const screwM = mat(0x2b2e33, { metalness: 0.7, roughness: 0.4 }), s = socketMats();
  // the casting: its lower part round the receptacles' pocket, its upper part whole, its sides down to the rails it stands on
  const pocket = { x0: m(6), x1: m(52), d: m(6.8) }, pocketTop = m(8.2), foot = m(1.8);
  g.add(flat(pocketed(W, L, r, pocket), foot, pocketTop, cast, m(0.15)), flat(xz(0, 0, W, L, r), pocketTop, top, cast, m(0.45)));
  for (const [x0, x1] of [[0, m(4.5)], [W - m(4.5), W]] as const) g.add(box(x0, x1, 0, foot + 2, r, L - r, cast));
  g.add(box(m(4.5), W - m(4.5), 0, foot + 2, L - m(3.4), L - r, cast));
  // the cover: a brushed sheet inset in the casting's rim
  g.add(flat(xz(m(1.4), m(1.6), W - m(1.4), L - m(1.4), m(3.2)), top - 2, T, cover, m(0.25)));
  // the label (its hole round the spindle's screw), the screws, the breather hole
  const lab = { x0: m(7.2), x1: W - m(7.2), z0: m(22), z1: L - m(7.5) }, spin = { x: W / 2, z: L - m(51.5) }, pivot = { x: W - m(16), z: m(12.5) };
  const lw = (lab.x1 - lab.x0) / MM, lh = (lab.z1 - lab.z0) / MM;
  g.add(decalTop(-(T + 0.8), lab.x0, lab.x1, lab.z0, lab.z1, decalMat(hddLabel(look, lw, lh, { u: (spin.x - lab.x0) / MM, v: (spin.z - lab.z0) / MM, r: 4.4 }), { rough: 0.62, cut: true })));
  const rim: Spot[] = [[m(4.0), m(4.6)], [W - m(4.0), m(4.6)], [m(4.0), L - m(4.2)], [W - m(4.0), L - m(4.2)], [m(4.0), L * 0.47], [W - m(4.0), L * 0.53], [W / 2, L - m(4.2)]].map(([x, z]) => ({ x: x!, y: T, z: z! }));
  g.add(screws(rim, 'y+', m(1.8), screwM), screws([{ x: spin.x, y: T + 3, z: spin.z }], 'y+', m(2.7), screwM), screws([{ x: pivot.x, y: T, z: pivot.z }], 'y+', m(2.3), screwM));
  g.add(place(new Mesh(new CylinderGeometry(m(3.3), m(3.3), 3, 24).translate(spin.x, T + 1.5, spin.z), mat(0xbfc4c9, { metalness: 0.9, roughness: 0.3 }))));
  g.add(bores([{ x: m(12), y: T, z: m(9) }], 'y+', m(0.8)));
  // the threaded holes along each side, 6.35 mm up
  const sides = [28.5, 70.1, 130.1].map((f) => L - m(f));
  g.add(bores(sides.map((z) => ({ x: -0.4, y: m(6.35), z })), 'x-', m(1.75)), bores(sides.map((z) => ({ x: W + 0.4, y: m(6.35), z })), 'x+', m(1.75)));
  // its board on the underside, screwed into the casting, the spindle motor's boss beside it
  g.add(flat(xz(m(5.2), m(1.0), W - m(5.2), m(81), m(1.6)), m(0.5), foot, mat(0x12301f, { roughness: 0.55, metalness: 0.1 }), m(0.2)));
  g.add(screws([[m(8), m(6)], [W - m(8), m(6)], [m(8), m(77)], [W - m(8), m(77)], [W / 2, m(44)]].map(([x, z]) => ({ x: x!, y: m(0.5), z: z! })), 'y-', m(1.6), screwM));
  g.add(place(new Mesh(new CylinderGeometry(m(13), m(13.6), m(1.3), 40).translate(spin.x, foot - m(0.65), spin.z), mat(0xaeb3b8, { metalness: 0.85, roughness: 0.35 }))));
  // the receptacles in the pocket: power, then data, then the jumper pins
  const y0 = m(2.4), power = receptacle(g, 15, m(8.2), y0, s), dx = m(8.2) + socketW(15) + m(1.9), data = receptacle(g, 7, dx, y0, s);
  const jx = dx + socketW(7) + m(1.6);
  g.add(box(jx, jx + m(5.1), y0 + m(0.6), y0 + m(4.4), m(5.0), m(6.6), s.body));
  g.add(instanced(new BoxGeometry(m(0.64), m(0.64), m(4)), s.gold, [0, 1].flatMap((i) => [0, 1].map((j) => ({ x: jx + m(1.27 + i * 2.54), y: y0 + m(1.3 + j * 2.0), z: m(3.2) })))));
  g.add(box(pocket.x0, pocket.x1, foot, pocketTop, pocket.d - 1, pocket.d, s.dark));
  return { root: g, body: cast, w: W, t: T, l: L, data, power };
}

// ------------------------------------------------------------------ the SSD
/** The 2.5 in. SSD (see the header). */
export function ssdModel(look: DriveLook): DriveModel {
  const g = new Group(), W = m(SSD_MM.w), T = m(SSD_MM.t), L = m(SSD_MM.l), r = m(1.8), s = socketMats();
  const base = mat(0x1c1e22, { roughness: 0.62, metalness: 0.25 }), shell = mat(0x464b53, { metalness: 0.8, roughness: 0.46 });
  // the base and the shell over it meet at a seam 3 mm up; both are cut round the receptacles' pocket, the shell closes over it
  const pocket = { x0: m(5), x1: m(43), d: m(5.6) }, seam = m(3), roof = m(6.2);
  const e = m(0.4), seamPts = pocketed(W - 2 * e, L - 2 * e, r, { x0: pocket.x0 - e, x1: pocket.x1 - e, d: pocket.d - e }).map((v) => new Vector2(v.x + e, v.y + e));
  g.add(flat(pocketed(W, L, r, pocket), 0, seam, base, m(0.2)), flat(seamPts, seam, seam + 2, mat(0x0a0b0d, { roughness: 0.8 })));
  g.add(flat(pocketed(W, L, r, pocket), seam + 2, roof, shell, m(0.2)), flat(xz(0, 0, W, L, r), roof, T, shell, m(0.55)));
  // the label on top, the holes along its sides (3 mm up) and under it
  g.add(decalTop(-(T + 0.6), m(3.2), W - m(3.2), m(5), L - m(5), decalMat(ssdLabel(look, SSD_MM.w - 6.4, SSD_MM.l - 10), { rough: 0.5, cut: true })));
  const along = [14, 90.6].map((f) => L - m(f));
  g.add(bores(along.map((z) => ({ x: -0.4, y: m(3), z })), 'x-', m(1.5)), bores(along.map((z) => ({ x: W + 0.4, y: m(3), z })), 'x+', m(1.5)));
  g.add(bores(along.flatMap((z) => [m(4.07), W - m(4.07)].map((x) => ({ x, y: -0.4, z }))), 'y-', m(1.5)));
  // the receptacles: data, then power
  const y0 = m(0.9), data = receptacle(g, 7, m(6.4), y0, s), power = receptacle(g, 15, m(6.4) + socketW(7) + m(1.9), y0, s);
  g.add(box(pocket.x0, pocket.x1, 0, roof, pocket.d - 1, pocket.d, s.dark));
  return { root: g, body: shell, w: W, t: T, l: L, data, power };
}

export const sataDriveModel = (hdd: boolean, look: DriveLook): DriveModel => (hdd ? hddModel(look) : ssdModel(look));

// ------------------------------------------------------------------ the cable's plugs
/** A SATA cable's plug pushed into a receptacle whose mouth is at `at`: its body behind the drive, grip ribs on top, a latch on the data plug; its cord leaves the back. */
export function drivePlug(power: boolean, at: V3, tone: number): { root: Group; end: RopeEnd } {
  const g = new Group(), [x, y, z] = at, w = m(power ? 23.4 : 11.2), h = m(5.6), L = m(power ? 13 : 12), body = mat(tone, { roughness: 0.5 });
  g.add(softBox({ x: x - w / 2, y: -(y + h / 2), w, h }, z - L, z - m(0.1), body, m(0.7)));
  g.add(instanced(new BoxGeometry(w - m(3), m(0.45), m(0.6)), body, [0, 1, 2].map((i) => ({ x, y: y + h / 2 + m(0.15), z: z - L + m(2.2) + i * m(1.6) }))));
  if (!power) g.add(box(x - m(2.4), x + m(2.4), y + h / 2, y + h / 2 + m(0.8), z - m(8.5), z - m(1.5), mat(0x9a9fa6, { metalness: 0.85, roughness: 0.32 })));
  return { root: g, end: { at: [x, y, z - L], dir: [0, 0, -1] } };
}

// ------------------------------------------------------------------ the print
const PX = 12;
const capOf = (look: DriveLook) => `${Math.round(look.capacityBytes / 1024)}K`;
type Ctx = CanvasRenderingContext2D & { letterSpacing: string };

/** A name squeezed to fit `max` px. */
function fitText(c: CanvasRenderingContext2D, t: string, x: number, y: number, max: number) {
  const k = Math.min(1, max / Math.max(1, c.measureText(t).width));
  c.save(); c.translate(x, y); c.scale(k, 1); c.fillText(t, 0, 0); c.restore();
}

/** The marks along a label's foot: a crossed-out bin, a ring, two boxed codes. */
function marks(c: CanvasRenderingContext2D, x: number, y: number, s: number, ink: string) {
  c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = s * 0.08;
  c.strokeRect(x + s * 0.2, y + s * 0.25, s * 0.6, s * 0.7); c.fillRect(x + s * 0.1, y + s * 0.15, s * 0.8, s * 0.08);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + s, y + s * 1.1); c.moveTo(x + s, y); c.lineTo(x, y + s * 1.1); c.stroke();
  c.beginPath(); c.arc(x + s * 1.9, y + s * 0.55, s * 0.5, 0, Math.PI * 2); c.stroke();
  c.font = `700 ${s * 0.42}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('e4', x + s * 1.9, y + s * 0.57);
  for (const [i, t] of ['RoHS', 'ICES-003'].entries()) {
    const bx = x + s * (2.8 + i * 2.2), bw = s * (i ? 2.0 : 1.7);
    c.strokeRect(bx, y + s * 0.1, bw, s * 0.9); c.font = `700 ${s * 0.36}px ${FONT}`; c.fillText(t, bx + bw / 2, y + s * 0.57);
  }
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
}

/** An ESD warning: a triangle with a hand, and its line. */
function esd(c: CanvasRenderingContext2D, x: number, y: number, s: number, ink: string, text: string) {
  c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = s * 0.09;
  c.beginPath(); c.moveTo(x + s / 2, y); c.lineTo(x + s, y + s * 0.9); c.lineTo(x, y + s * 0.9); c.closePath(); c.stroke();
  c.fillRect(x + s * 0.44, y + s * 0.3, s * 0.12, s * 0.4); c.beginPath(); c.moveTo(x + s * 0.3, y + s * 0.62); c.lineTo(x + s * 0.7, y + s * 0.42); c.stroke();
  c.font = `600 ${s * 0.36}px ${FONT}`; c.fillText(text, x + s * 1.25, y + s * 0.7);
}

/**
 * The hard disk's label, `wm` by `hm` mm, its top toward the drive's connector end: the maker's band, the model and the name, the capacity large
 * with its specs, the ratings and the codes either side of the spindle's hole (`hole`, cut), the barcodes, the ESD line and the marks.
 */
function hddLabel(look: DriveLook, wm: number, hm: number, hole: { u: number; v: number; r: number }): Texture | null {
  const cap = capOf(look);
  return tex(`hdd-label:${look.name}:${cap}:${wm.toFixed(1)}`, Math.round(wm * PX), Math.round(hm * PX), (cx, w, h) => {
    const c = cx as Ctx, u = (mm: number) => mm * PX, seed = hash(look.name + cap), rnd = seeded(seed + 2), ink = '#17191d', grey = '#5d636c';
    c.clearRect(0, 0, w, h);
    roundRect(c, 0, 0, w, h, u(1.4)); c.fillStyle = '#f0f0ec'; c.fill();
    c.save(); c.clip();
    for (let i = 0; i < 6000; i++) { c.fillStyle = `rgba(0,0,0,${0.012 + rnd() * 0.02})`; c.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
    // the maker's band, a silver line under it
    c.fillStyle = '#1b1e23'; c.fillRect(0, 0, w, u(14));
    c.fillStyle = '#c9ced5'; c.fillRect(0, u(14), w, u(0.6));
    c.textBaseline = 'alphabetic'; c.fillStyle = '#f2f4f7'; c.font = `800 ${u(5)}px ${FONT}`; c.letterSpacing = `${u(0.5)}px`;
    c.fillText('PIPELINE', u(4), u(9.6)); c.letterSpacing = '0px';
    c.fillStyle = '#a3aab4'; c.font = `600 ${u(2)}px ${FONT}`; c.textAlign = 'right'; c.fillText('HARD DISK DRIVE', w - u(4), u(9.2)); c.textAlign = 'left';
    // the model, the name, the capacity and its specs
    c.fillStyle = ink; c.font = `800 ${u(4.4)}px ${FONT}`; c.fillText(`PC-H3${String(seed % 900 + 100)}-${cap}`, u(4), u(22));
    c.fillStyle = grey; c.font = `600 ${u(2.8)}px ${FONT}`; fitText(c, look.name, u(4), u(26.8), w - u(8));
    c.fillStyle = ink; c.font = `800 ${u(11)}px ${FONT}`; c.fillText(cap, u(3.6), u(41));
    const cw = c.measureText(cap).width;
    c.fillStyle = grey; c.font = `600 ${u(2.1)}px ${FONT}`;
    ['3.5" SATA 6 Gb/s', '7200 RPM · 256 MB CACHE', 'CMR · 512e SECTORS'].forEach((t, i) => fitText(c, t, u(6.5) + cw, u(33.6 + i * 3.1), w - cw - u(10)));
    c.fillStyle = '#c8ccd1'; c.fillRect(u(4), u(45), w - u(8), u(0.3));
    c.fillStyle = grey; c.font = `500 ${u(1.55)}px ${FONT}`;
    ['THIS DRIVE IS A PRECISION DEVICE: DO NOT DROP, BEND OR PRESS ON ITS COVER.', 'WARRANTY VOID IF THIS LABEL OR THE COVER SEAL IS BROKEN OR REMOVED.', 'MOUNT ON ITS SIDE OR BASE HOLES WITH 6-32 UNC SCREWS ONLY.', 'OPERATING 5–60 °C · NON-OPERATING SHOCK 300 G / 2 MS'].forEach((t, i) => fitText(c, t, u(4), u(50 + i * 2.6), w - u(8)));
    // either side of the spindle's hole: the ratings and the codes, a printed ring round the hole
    c.fillStyle = ink; c.font = `600 ${u(1.75)}px ${MONO}`;
    const left = ['+5V ⎓ 0.55A', '+12V ⎓ 0.45A', `DATE  ${2023 + (seed % 3)}-${String(1 + (seed % 12)).padStart(2, '0')}`, `SITE  ${['KR', 'TH', 'MY'][seed % 3]}`, `DCM  HB${String(seed % 1e5).padStart(5, '0')}BB`];
    left.forEach((t, i) => fitText(c, t, u(4), u(hole.v - 6.4 + i * 3.2), u(hole.u - hole.r - 7)));
    const right = [`FW  80.00A${seed % 90 + 10}`, `PN  ${String(seed % 9000 + 1000)}-0A`, `LBA  ${(look.capacityBytes * 2).toLocaleString('en-US')}`, 'PRODUCT OF', 'PIPELINE CITY'];
    right.forEach((t, i) => fitText(c, t, u(hole.u + hole.r + 3), u(hole.v - 6.4 + i * 3.2), w - u(hole.u + hole.r + 7)));
    c.strokeStyle = '#9097a0'; c.lineWidth = u(0.3); c.beginPath(); c.arc(u(hole.u), u(hole.v), u(hole.r + 1.2), 0, Math.PI * 2); c.stroke();
    // the codes: the serial's barcode and the model's, the matrix code, the serial
    c.fillStyle = '#c8ccd1'; c.fillRect(u(4), u(hole.v + hole.r + 4.2), w - u(8), u(0.3));
    const by = u(hole.v + hole.r + 6.3), bh = u(5.4);
    barcode(c, u(3), by, u(48), bh, seed, ink, `S/N ZP${String(seed % 1e6).padStart(6, '0')}`);
    barcode(c, u(3), by + bh + u(3.4), u(48), bh * 0.8, seed + 7, ink, `PC-H3-${cap}`);
    matrix(c, w - u(17), by, u(12.5), seed + 11, ink); c.textBaseline = 'alphabetic';
    c.fillStyle = ink; c.font = `700 ${u(1.6)}px ${MONO}`; c.fillText(`ZP${String(seed % 1e6).padStart(6, '0')}`, w - u(17), by + u(15));
    // the warning and the marks along the foot
    esd(c, u(4), h - u(12.6), u(3), ink, 'ESD SENSITIVE · HANDLE BY THE SIDES · DO NOT COVER THE BREATHER HOLE');
    marks(c, u(4), h - u(6.8), u(3.2), ink);
    c.restore();
    // the hole round the spindle's screw
    c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(u(hole.u), u(hole.v), u(hole.r), 0, Math.PI * 2); c.fill(); c.globalCompositeOperation = 'source-over';
  });
}

/** The SSD's label, `wm` by `hm` mm, its top toward the connector end: dark, the maker's mark, the drive's name and capacity, its interface, the codes. */
function ssdLabel(look: DriveLook, wm: number, hm: number): Texture | null {
  const cap = capOf(look);
  return tex(`ssd-label:${look.name}:${cap}`, Math.round(wm * PX), Math.round(hm * PX), (cx, w, h) => {
    const c = cx as Ctx, u = (mm: number) => mm * PX, seed = hash(look.name + cap), rnd = seeded(seed + 3);
    c.clearRect(0, 0, w, h);
    roundRect(c, 0, 0, w, h, u(1.2)); c.fillStyle = '#17191d'; c.fill();
    c.save(); c.clip();
    for (let i = 0; i < 7000; i++) { c.fillStyle = `rgba(255,255,255,${0.01 + rnd() * 0.022})`; c.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
    c.strokeStyle = 'rgba(170,178,190,0.35)'; c.lineWidth = u(0.15); roundRect(c, u(1.2), u(1.2), w - u(2.4), h - u(2.4), u(0.8)); c.stroke();
    // a silver bar across, the maker's mark over it
    const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(214,219,226,0.85)'); gr.addColorStop(1, 'rgba(214,219,226,0.15)');
    c.fillStyle = gr; c.fillRect(u(4), u(19), w - u(8), u(0.5));
    c.textBaseline = 'alphabetic'; c.fillStyle = '#f2f4f7'; c.font = `800 ${u(5.6)}px ${FONT}`; c.letterSpacing = `${u(0.5)}px`;
    c.fillText('PIPELINE', u(4), u(14)); c.letterSpacing = '0px';
    c.fillStyle = '#9aa1ab'; c.font = `600 ${u(2.1)}px ${FONT}`; c.fillText('SOLID STATE DRIVE', u(4.2), u(17.4));
    // the name, the capacity large, the interface
    c.fillStyle = '#e8ebef'; c.font = `700 ${u(3.4)}px ${FONT}`; fitText(c, look.name, u(4), u(29), w - u(8));
    c.font = `800 ${u(12)}px ${FONT}`; c.fillText(cap, u(3.6), u(45));
    c.fillStyle = '#a7aeb8'; c.font = `600 ${u(2.1)}px ${FONT}`;
    ['2.5" SATA 6 Gb/s', '3D TLC NAND · DRAM CACHE', '7 mm · 5V ⎓ 1.4A'].forEach((t, i) => fitText(c, t, u(4), u(52 + i * 3.2), w - u(8)));
    // the codes on a white patch, the serial beside it
    c.fillStyle = '#e9ebee'; roundRect(c, u(4), h - u(24), u(36), u(11), u(0.5)); c.fill();
    barcode(c, u(4.6), h - u(23.2), u(34.8), u(6.6), seed, '#111317', `S/N PC2S${String(seed % 1e6).padStart(6, '0')}`);
    c.fillStyle = '#e9ebee'; c.fillRect(w - u(15.4), h - u(24), u(11), u(11));
    matrix(c, w - u(14.6), h - u(23.2), u(9.4), seed + 9, '#111317'); c.textBaseline = 'alphabetic';
    c.fillStyle = '#c9ced6'; c.font = `600 ${u(1.6)}px ${MONO}`;
    [`MODEL  PC-S2-${cap}`, `FW  SBFM${seed % 90 + 10}`].forEach((t, i) => fitText(c, t, u(4), h - u(9.4) + i * u(2.6), w - u(8)));
    marks(c, w - u(30), h - u(9.6), u(2.6), '#c9ced6');
    c.restore();
  });
}
