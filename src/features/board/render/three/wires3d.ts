// The cables in 3D as real cables (docs/GRAPHICS_3D_OVERHAUL.md "Cables"). The 2D draws each lead along a lane of right angles; here a lead comes
// out of a rubber grommet in the tray beside its socket (the run from the power supply is behind the tray) and hangs into its plug under its
// own weight (`hang`, rope.ts), round the parts in its way. A power lead is a comb of individually sleeved strands, one per pin column; a lead
// that is not plugged in hangs loose from its grommet with its plug at the end. The board's power and SATA sockets are modelled with their
// cavities, the plugs seat in them.
import { BoxGeometry, CatmullRomCurve3, Group, Mesh, Quaternion, TubeGeometry, Vector3, type Object3D } from 'three';
import { instanced, place, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { hang, type Plane, type RopeEnd, type Solid, type V3 } from '@/core/render/three/rope';
import { BOARD_Z, CASE_Z } from '@/features/room/render/three/roomplan';
import { braidedTube, plugBody } from './cables3d';

/** The tray's face: a grommet sits in it, a lead comes out of it. */
export const TRAY_Z = CASE_Z + 70;

/** What a cable keeps clear of: the planes it lies against and the boxes it goes round. */
export interface Env { planes: Plane[]; solids: Solid[] }

/** A cable's look: its radius, its sleeve, the accent woven into it (null: a plain jacket). */
export interface Look { r: number; base: string; accent: string | null }

const hex = (c: string): number => parseInt(c.slice(1), 16);

/** A cable along settled points. */
export function cableMesh(pts: readonly V3[], look: Look): Mesh {
  const v = pts.map((p) => new Vector3(p[0], p[1], p[2]));
  if (look.accent) return braidedTube(v, look.r, look.base, look.accent).mesh;
  const curve = new CatmullRomCurve3(v, false, 'centripetal');
  return place(new Mesh(new TubeGeometry(curve, Math.max(24, pts.length * 3), look.r, 10, false), mat(hex(look.base), { roughness: 0.55 })));
}

/** One cable hung between two ends, `slack` longer than the gap (a factor) plus `extra`. */
export function hung(a: RopeEnd, b: RopeEnd, look: Look, env: Env, o: { slack?: number; extra?: number; stiff?: number; n?: number; lead?: number } = {}): Mesh {
  const gap = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]);
  const pts = hang({ a, b, length: gap * (o.slack ?? 1.15) + (o.extra ?? 120), r: look.r, stiff: o.stiff ?? 0.5, n: o.n ?? 26, ...env, lead: o.lead ?? look.r * 2.5 });
  return cableMesh(pts, look);
}

/**
 * A lead that is not plugged in: it hangs from `a` (its grommet, its fan) and the plug lies at its free end, turned along it. `plug` builds the
 * plug round its own z axis, the cable leaving it at +z.
 */
export function dangling(a: RopeEnd, length: number, look: Look, env: Env, plug: () => Object3D): Group {
  const g = new Group(), pts = hang({ a, b: null, length, r: look.r, stiff: 0.5, n: 24, ...env, lead: look.r * 2.5 });
  g.add(cableMesh(pts, look));
  const end = pts[pts.length - 1]!, prev = pts[pts.length - 2]!, dir = new Vector3(prev[0] - end[0], prev[1] - end[1], prev[2] - end[2]).normalize();
  const p = plug();
  p.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir));
  p.position.set(end[0], end[1], end[2]);
  g.add(p);
  return g;
}

/** A plug body round its own z axis (`dangling`): `w` by `h` across, `l` long, the cable leaving at +z. */
export const loosePlug = (w: number, h: number, l: number, accent: string): Group => plugBody({ x: -w / 2, y: -h / 2, w, h }, -l, 0, accent);

/** A rubber grommet in the tray over a layout rect: the moulded ring and the slit flaps of its membrane. */
export function grommet(r: RectLike, style: { tone: number; metal: boolean } = { tone: 0x101114, metal: false }): Group {
  const g = new Group(), rubber = mat(style.tone, style.metal ? { metalness: 0.75, roughness: 0.3 } : { roughness: 0.75 }), e = 40;
  g.add(softBox({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e }, TRAY_Z - 10, TRAY_Z + 26, rubber, Math.min(40, (r.w + 2 * e) / 2.2, (r.h + 2 * e) / 2.2)));
  g.add(rectBox(r, TRAY_Z + 20, TRAY_Z + 28, mat(0x050506, { roughness: 0.9 })));
  const along = r.h >= r.w, slit = along ? { x: r.x + r.w / 2 - 2, y: r.y + 10, w: 4, h: r.h - 20 } : { x: r.x + 10, y: r.y + r.h / 2 - 2, w: r.w - 20, h: 4 };
  g.add(rectBox(slit, TRAY_Z + 28, TRAY_Z + 30, mat(0x1c1d22, { roughness: 0.6 })));
  return g;
}

// ------------------------------------------------------------------ sockets and plugs
const housingM = () => mat(0x1d2028, { roughness: 0.5 });

/** A grid of square cavities on a face: `cols` along a, `rows` along b, as small dark boxes standing in the face. */
function cavities(g: Group, cells: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[]) {
  g.add(instanced(new BoxGeometry(1, 1, 1), mat(0x050608, { roughness: 0.9 }), cells));
}

/**
 * The 24-pin socket on the board's east edge, a right-angle housing over its 2D rect: twelve cavities along it and two rows up its east face
 * (the mouth), the latch ridge over the mouth.
 */
export function atxSocket(r: RectLike, h = 170): Group {
  const g = new Group(), cells = [], pitch = (r.h - 60) / 12;
  g.add(softBox(r, BOARD_Z, BOARD_Z + h, housingM(), 10));
  for (let i = 0; i < 12; i++) for (let j = 0; j < 2; j++) cells.push({ x: r.x + r.w + 1, y: -(r.y + 30 + (i + 0.5) * pitch), z: BOARD_Z + h * (0.32 + j * 0.36), sx: 6, sy: pitch * 0.62, sz: h * 0.26 });
  cavities(g, cells);
  g.add(rectBox({ x: r.x + r.w - 60, y: r.y + r.h * 0.42, w: 60, h: r.h * 0.16 }, BOARD_Z + h, BOARD_Z + h + 14, housingM()));
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

/** The CPU's 8-pin socket over its 2D rect, standing up off the board: its two rows of four cavities face the glass, the latch on the north side. */
export function epsSocket(r: RectLike, h = 160): Group {
  const g = new Group(), cells = [];
  g.add(softBox(r, BOARD_Z, BOARD_Z + h, housingM(), 10));
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) cells.push({ x: r.x + (i + 0.5) * (r.w / 4), y: -(r.y + (j + 0.5) * (r.h / 2)), z: BOARD_Z + h + 1, sx: r.w / 4 * 0.6, sy: r.h / 2 * 0.55, sz: 6 });
  cavities(g, cells);
  g.add(rectBox({ x: r.x + r.w * 0.38, y: r.y - 24, w: r.w * 0.24, h: 24 }, BOARD_Z + h * 0.5, BOARD_Z + h, housingM()));
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

/** A right-angle SATA port on the board's east edge: the housing, its L-keyed mouth on the east face. */
export function sataPort(r: RectLike): Group {
  const g = new Group(), h = 100;
  g.add(softBox(r, BOARD_Z, BOARD_Z + h, housingM(), 8));
  g.add(rectBox({ x: r.x + r.w - 2, y: r.y + 18, w: 4, h: r.h - 36 }, BOARD_Z + 30, BOARD_Z + 62, mat(0x050608, { roughness: 0.9 })));
  g.add(rectBox({ x: r.x + r.w - 2, y: r.y + 18, w: 4, h: 22 }, BOARD_Z + 62, BOARD_Z + 76, mat(0x050608, { roughness: 0.9 })));
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
