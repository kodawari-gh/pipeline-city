// The cables in 3D as real cables (docs/GRAPHICS_3D_OVERHAUL.md "Cables"). The 2D draws each lead along a lane of right angles; here a lead comes
// out of a rubber grommet in the tray beside its socket (the run from the power supply is behind the tray) and hangs into its plug under its
// own weight (`hang`, rope.ts), round the parts in its way. A power lead is a comb of individually sleeved strands, one per pin column, and a
// loose lead is the same comb with its plug at the end (cablerig3d.ts; plughand3d.ts holds it in the player's hand). The board's power and SATA
// sockets are modelled with their cavities, the plugs seat in them.
import { BoxGeometry, Group, Mesh, Vector2 } from 'three';
import { instanced, place, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { hang, naturalLength, type Plane, type RopeEnd, type Solid, type V3 } from '@/core/render/three/rope';
import { Sleeve } from '@/core/render/three/sleeve';
import { BOARD_Z, CASE_Z } from '@/features/room/render/three/roomplan';
import { plugBody, samplesFor, sleeveMat } from './cables3d';
import { outlinePts, shapeOf, slab, wallPt, wallX, type Span } from './casekit3d';

/** The tray's face: a grommet sits in it, a lead comes out of it. */
export const TRAY_Z = CASE_Z + 70;

/** What a cable keeps clear of: the planes it lies against and the boxes it goes round. */
export interface Env { planes: Plane[]; solids: Solid[] }

/** A cable's look: its radius, its sleeve, the accent woven into it (null: a plain jacket). */
export interface Look { r: number; base: string; accent: string | null }

const hex = (c: string): number => parseInt(c.slice(1), 16);

/** A cable along settled points (several: one strand each, one mesh). */
export function cableMesh(pts: readonly V3[] | readonly V3[][], look: Look): Mesh {
  const paths = (Array.isArray(pts[0]![0]) ? pts : [pts]) as readonly V3[][];
  const sl = new Sleeve(paths.length, look.r, samplesFor(Math.max(...paths.map((p) => p.length))), look.accent ? 14 : 10);
  sl.update(paths);
  return place(new Mesh(sl.geometry, sleeveMat(look.base, look.accent)));
}

/**
 * How a cable hangs between two ends: `natural` routes it (the smooth curve's length times `slack`, default 1.03: a lead combed into place),
 * otherwise it is `slack` longer than the gap (a factor) plus `extra` (a cord that drapes).
 */
export interface HangOpts { natural?: boolean; handle?: number; slack?: number; extra?: number; stiff?: number; n?: number; lead?: number }

/** The settled points of one cable between two ends (`HangOpts`). */
export function hangPts(a: RopeEnd, b: RopeEnd, look: Look, env: Env, o: HangOpts = {}): V3[] {
  const gap = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]), handle = o.handle ?? 1, lead = o.lead ?? look.r * 2.5;
  const length = o.natural ? naturalLength(a, b, handle, lead) * (o.slack ?? 1.03) + (o.extra ?? 0) : gap * (o.slack ?? 1.15) + (o.extra ?? 120);
  return hang({ a, b, length, r: look.r, stiff: o.stiff ?? 0.5, n: o.n ?? 26, ...env, lead, ...(o.natural ? { sag: 0.25, handle } : {}) });
}

/** One cable hung between two ends (`HangOpts`). */
export const hung = (a: RopeEnd, b: RopeEnd, look: Look, env: Env, o: HangOpts = {}): Mesh => cableMesh(hangPts(a, b, look, env, o), look);

/** A plug body round its own z axis (`straightPlug`, cablerig3d.ts): `w` by `h` across, `l` long, the cable leaving at +z. */
export const loosePlug = (w: number, h: number, l: number, accent: string): Group => plugBody({ x: -w / 2, y: -h / 2, w, h }, -l, 0, accent);

/** How a case finishes a cable hole in its tray: the ring's tone (`metal`: a machined ring), the rubber flaps' tone (null: a bare hole in a rolled lip). */
export interface GrommetStyle { tone: number; metal: boolean; flap: number | null }

/**
 * A cable hole in the tray over a layout rect: the moulded ring standing round it, the dark hole, and the membrane's slit flaps sunk inside the ring,
 * a row from each long edge up to a slit down the middle. `lean`: how far the slot's top runs east of its foot (a slanted cut-out).
 */
export function grommet(r: RectLike, style: GrommetStyle = { tone: 0x101114, metal: false, flap: 0x1a1b20 }, lean = 0): Group {
  const g = new Group(), e = 34, rad = Math.min(r.w, r.h) / 2, along = r.h >= r.w, rubber = mat(style.tone, style.metal ? { metalness: 0.75, roughness: 0.3 } : { roughness: 0.75 });
  // (a slanted slot's points slide along x with their height)
  const sheared = (pts: Vector2[]) => (lean ? pts.map((p) => new Vector2(p.x + (lean * (r.y + r.h + p.y)) / r.h, p.y)) : pts);
  const inner = sheared(outlinePts(r, rad));
  g.add(slab(shapeOf(sheared(outlinePts({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e }, rad + e)), [inner]), TRAY_Z - 6, TRAY_Z + 24, rubber, 6));
  g.add(slab(shapeOf(inner), TRAY_Z - 2, TRAY_Z + 2, mat(0x050506, { roughness: 0.9 })));
  if (style.flap === null) return g;
  const len = along ? r.h : r.w, wide = along ? r.w : r.h, n = Math.max(1, Math.round(len / 34)), pitch = len / n, slit = 8, fw = (wide - slit) / 2;
  const flaps = Array.from({ length: n }, (_, i) => i).flatMap((i) => [-1, 1].map((s) => {
    const a = (along ? r.y : r.x) + (i + 0.5) * pitch, o = (s * (slit + fw)) / 2;
    if (!along) return { x: a, y: -(r.y + r.h / 2 + o), z: TRAY_Z + 10, sx: pitch - 6, sy: fw, sz: 6 };
    return { x: r.x + r.w / 2 + o + (lean * (r.y + r.h - a)) / r.h, y: -a, z: TRAY_Z + 10, sx: fw, sy: pitch - 6, sz: 6 };
  }));
  g.add(instanced(new BoxGeometry(1, 1, 1), mat(style.flap, { roughness: 0.8 }), flaps));
  return g;
}

// ------------------------------------------------------------------ sockets and plugs
const housingM = () => mat(0x1d2028, { roughness: 0.5 });
const darkM = () => mat(0x050608, { roughness: 0.9 });
const tinM = () => mat(0x7a818b, { metalness: 0.7, roughness: 0.5 });
/** How deep a socket's mouth plate is: its cavities are holes through it, a contact sleeve stands in each, on a dark floor. */
const MOUTH = 26;

/**
 * A power socket keys its cavities as a real one does: square and rounded ones in turn (a plug fits one way), each a hole through the mouth
 * plate with its tinned contact sleeve inside. The rounding of cavity `k`, as a share of its size.
 */
const keyed = (k: number): number => (k % 2 ? 0.34 : 0.06);

/**
 * The 24-pin socket on the board's east edge, a right-angle housing over its 2D rect: its mouth on the east face, two rows of twelve keyed
 * cavities with a contact in each, the latch ridge over the mouth.
 */
export function atxSocket(r: RectLike, h = 170): Group {
  const g = new Group(), pitch = (r.h - 60) / 12, x1 = r.x + r.w, x0 = x1 - MOUTH, Z = BOARD_Z;
  g.add(softBox({ ...r, w: r.w - MOUTH }, Z, Z + h, housingM(), 10));
  const holes: Span[] = [], sleeves: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  for (let i = 0; i < 12; i++) for (let j = 0; j < 2; j++) {
    const cy = r.y + 30 + (i + 0.5) * pitch, cz = Z + h * (0.32 + j * 0.36), hy = pitch * 0.31, hz = h * 0.13, s = Math.min(hy, hz) * 2;
    holes.push({ y0: cy - hy, y1: cy + hy, z0: cz - hz, z1: cz + hz, r: s * keyed(i + j) });
    sleeves.push({ x: x0 + 6, y: -cy, z: cz, sx: 12, sy: hy * 0.7, sz: hz * 0.7 });
  }
  g.add(wallX(x0, x1, { y0: r.y, y1: r.y + r.h, z0: Z, z1: Z + h, r: 10 }, holes, housingM(), 2));
  g.add(rectBox({ x: x0 - 2, y: r.y + 20, w: 3, h: r.h - 40 }, Z + 16, Z + h - 16, darkM()), instanced(new BoxGeometry(1, 1, 1), tinM(), sleeves));
  g.add(rectBox({ x: r.x + r.w - 60, y: r.y + r.h * 0.42, w: 60, h: r.h * 0.16 }, Z + h, Z + h + 14, housingM()));
  return g;
}

/** The 24-pin plug seated in the socket's mouth: its body east of the board, the latch hooked over the ridge. Returns where its strands leave (east face). */
export function atxPlug(r: RectLike, accent: string, h = 170): { root: Group; strands: RopeEnd[] } {
  const g = new Group(), x0 = r.x + r.w - 16, L = 230, body = { x: x0, y: r.y + 24, w: L, h: r.h - 48 };
  g.add(softBox(body, BOARD_Z + 10, BOARD_Z + h - 10, mat(0x1b2230, { roughness: 0.5 }), 12));
  g.add(rectBox({ x: x0 - 40, y: r.y + r.h * 0.42, w: 120, h: r.h * 0.16 }, BOARD_Z + h - 10, BOARD_Z + h + 30, mat(0x1b2230, { roughness: 0.5 })));
  g.add(softBox({ x: x0 + L - 30, y: body.y - 4, w: 34, h: body.h + 8 }, BOARD_Z + 6, BOARD_Z + h - 6, mat(hex(accent), { roughness: 0.45 }), 8));
  const pitch = body.h / 12;
  const strands = Array.from({ length: 12 }, (_, i): RopeEnd => ({ at: [x0 + L + 4, -(body.y + (i + 0.5) * pitch), BOARD_Z + h / 2], dir: [1, 0, 0] }));
  return { root: g, strands };
}

/** The CPU's 8-pin socket over its 2D rect, standing up off the board: two rows of four keyed cavities face the glass, the latch on the north side. */
export function epsSocket(r: RectLike, h = 160): Group {
  const g = new Group(), Z = BOARD_Z, top = Z + h, holes: Vector2[][] = [], sleeves: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  g.add(softBox(r, Z, top - MOUTH, housingM(), 10));
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
    const cx = r.x + (i + 0.5) * (r.w / 4), cy = r.y + (j + 0.5) * (r.h / 2), w = (r.w / 4) * 0.6, d = (r.h / 2) * 0.58;
    // (the rounded cavities have their two corners on the latch's side cut)
    const k = keyed(i + j) > 0.1 ? Math.min(w, d) * 0.3 : 0;
    holes.push(outlinePts({ x: cx - w / 2, y: cy - d / 2, w, h: d }, 3, k ? [k, k, 0, 0] : [0, 0, 0, 0]));
    sleeves.push({ x: cx, y: -cy, z: top - MOUTH + 6, sx: w * 0.4, sy: d * 0.4, sz: 12 });
  }
  g.add(slab(shapeOf(outlinePts(r, 10), holes), top - MOUTH, top, housingM(), 3));
  g.add(rectBox({ x: r.x + 10, y: r.y + 10, w: r.w - 20, h: r.h - 20 }, top - MOUTH - 1, top - MOUTH + 1, darkM()), instanced(new BoxGeometry(1, 1, 1), tinM(), sleeves));
  g.add(rectBox({ x: r.x + r.w * 0.38, y: r.y - 24, w: r.w * 0.24, h: 24 }, Z + h * 0.5, top, housingM()));
  return g;
}

/** The CPU plug seated in its socket from the glass side: its strands leave its top, one per column. */
export function epsPlug(r: RectLike, accent: string, h = 160): { root: Group; strands: RopeEnd[]; top: number } {
  const g = new Group(), z0 = BOARD_Z + h - 30, top = BOARD_Z + h + 170, b = { x: r.x + 8, y: r.y + 8, w: r.w - 16, h: r.h - 16 };
  g.add(plugBody(b, z0, top, accent));
  g.add(rectBox({ x: r.x + r.w * 0.36, y: r.y - 34, w: r.w * 0.28, h: 30 }, BOARD_Z + h * 0.4, z0 + 60, mat(0x1b2230, { roughness: 0.5 })));
  const strands = Array.from({ length: 4 }, (_, i): RopeEnd => ({ at: [b.x + (i + 0.5) * (b.w / 4), -(b.y + b.h / 2), top + 4], dir: [0, 0, 1] }));
  return { root: g, strands, top };
}

/**
 * A right-angle SATA port on the board's east edge: the housing, its L-keyed mouth through the east face (the slot and the key's arm at its
 * north end), the plastic tongue inside with its seven contacts.
 */
export function sataPort(r: RectLike): Group {
  const g = new Group(), h = 100, Z = BOARD_Z, x1 = r.x + r.w, x0 = x1 - MOUTH, ya = r.y + 16, yb = r.y + r.h - 16, arm = r.y + 38;
  g.add(softBox({ ...r, w: r.w - MOUTH }, Z, Z + h, housingM(), 8));
  const mouth = [wallPt(ya, Z + 34), wallPt(yb, Z + 34), wallPt(yb, Z + 62), wallPt(arm, Z + 62), wallPt(arm, Z + 80), wallPt(ya, Z + 80)].reverse();
  g.add(wallX(x0, x1, { y0: r.y, y1: r.y + r.h, z0: Z, z1: Z + h, r: 8 }, [mouth], housingM(), 2));
  g.add(rectBox({ x: x0 - 2, y: ya - 4, w: 3, h: yb - ya + 8 }, Z + 30, Z + 84, darkM()));
  g.add(rectBox({ x: x0 - 2, y: r.y + 28, w: MOUTH - 4, h: r.h - 56 }, Z + 40, Z + 52, mat(0x2c3038, { roughness: 0.5 })));
  const pins = Array.from({ length: 7 }, (_, k) => ({ x: x1 - 15, y: -(r.y + 32 + (k * (r.h - 64)) / 6), z: Z + 53, sx: 16, sy: 4, sz: 2 }));
  g.add(instanced(new BoxGeometry(1, 1, 1), mat(0xd9b25e, { metalness: 1, roughness: 0.25 }), pins));
  return g;
}

/** A SATA data plug seated in a port (red, the L of its latch on top). Returns where its cable leaves (east). */
export function sataPlug(r: RectLike): { root: Group; end: RopeEnd } {
  const g = new Group(), red = mat(0xb3262f, { roughness: 0.45 }), x0 = r.x + r.w - 6, L = 120;
  g.add(softBox({ x: x0, y: r.y + 10, w: L, h: r.h - 20 }, BOARD_Z + 16, BOARD_Z + 84, red, 8));
  g.add(rectBox({ x: x0 + 20, y: r.y + 20, w: 60, h: r.h - 40 }, BOARD_Z + 84, BOARD_Z + 96, mat(0xd8dde4, { metalness: 0.8, roughness: 0.3 })));
  return { root: g, end: { at: [x0 + L + 2, -(r.y + r.h / 2), BOARD_Z + 50], dir: [1, 0, 0] } };
}

/** A fan plug seated on a header (layout rect of its pins), standing over the pins; its cord leaves the top. */
export function fanPlug(r: RectLike, accent: string, z0 = BOARD_Z + 150, h = 140): { root: Group; end: RopeEnd } {
  const g = new Group(), b = { x: r.x + 6, y: r.y + 6, w: r.w - 12, h: r.h - 12 };
  g.add(softBox(b, z0, z0 + h, mat(0x1b2230, { roughness: 0.5 }), 8));
  g.add(rectBox({ x: b.x, y: b.y + b.h - 10, w: b.w, h: 12 }, z0 + h - 26, z0 + h + 2, mat(hex(accent), { roughness: 0.45 })));
  return { root: g, end: { at: [b.x + b.w / 2, -(b.y + b.h / 2), z0 + h + 2], dir: [0, 0, 1] } };
}

/** Spread `n` points along a layout segment from `a` to `b` (both included when n > 1). */
export const spread = (a: [number, number], b: [number, number], n: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => { const t = n > 1 ? i / (n - 1) : 0.5; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; });

/** The ends of `n` strands coming out of a grommet slot (layout rect) toward the glass. */
export function fromSlot(r: RectLike, n: number): RopeEnd[] {
  const along = r.h >= r.w, pts = along ? spread([r.x + r.w / 2, r.y + 20], [r.x + r.w / 2, r.y + r.h - 20], n) : spread([r.x + 20, r.y + r.h / 2], [r.x + r.w - 20, r.y + r.h / 2], n);
  return pts.map(([x, y]) => ({ at: [x, -y, TRAY_Z + 24], dir: [0, 0, 1] }));
}

/** World point from layout x, y and a depth. */
export const at = (x: number, y: number, z: number): V3 => [x, -y, z];
