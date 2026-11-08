// The monitor's body in 3D (props3d.ts `Monitor` adds the picture, its glass and the power light), at the machine's scale (23 units a mm, as every
// PC part, so it reads true beside the case; the room's furniture keeps its 18.7): an 18.5 in. office monitor (a 409 x 230 mm picture, the panel
// 430 x 260 mm) of a Dell E1916H's class. A 7.8 mm panel with a 5.2 mm frame on three sides and the maker's name on the chin; the back a rounded
// housing in three steps (the skirt off the panel's edge, the hump with its vents, rating label and lock slot, the boss the VESA 100 bracket
// screws to); the video socket and the power cord's strain relief at the bottom edge, where the cables leave (`monitorSeats`); five buttons under
// the chin's east end; a height-adjustable column with a cable hole through it; a rounded foot on four rubber pads.
import { BoxGeometry, CylinderGeometry, Group, LatheGeometry, Mesh, Path, PlaneGeometry, Quaternion, Shape, Vector2, Vector3, type BufferGeometry, type Material } from 'three';
import { extrude, instanced, paint, place, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';

/** The machine's scale: units a mm (the case and its parts are built at it too). */
const MM = 23;
type V3 = [number, number, number];

/** A box of the monitor for the cables to go round: a layout rect and a depth range. */
export interface MonitorBox { r: RectLike; z0: number; z1: number }

/** Where the monitor's parts go (layout x and y, depth z; from the panel `m`, the desk top `deskY` and the panel's back `z0`). */
export interface MonitorPlan {
  panel: MonitorBox;
  /** The housing's hump, and the boss with the bracket and its screws on it. */
  hump: MonitorBox; boss: MonitorBox;
  /** The VESA bracket's middle (layout). */
  vesa: { x: number; y: number };
  /** The stand: the column with the hinge block on its front, and the foot with its pads. */
  column: MonitorBox; foot: MonitorBox;
}

/** The foot is 15 mm thick, on 1.6 mm pads. */
const PAD = 1.6 * MM, FOOT_T = 15 * MM;
/** The VESA 100 square's half: the bracket's screws. */
const VESA = 50 * MM;

export function monitorPlan(m: RectLike, deskY: number, z0: number): MonitorPlan {
  const cx = m.x + m.w / 2, vesa = { x: cx, y: m.y + m.h * 0.42 };
  const hump: MonitorBox = { r: { x: m.x + m.w * 0.12, y: m.y + m.h * 0.07, w: m.w * 0.76, h: m.h * 0.8 }, z0: z0 - 25.7 * MM, z1: z0 };
  const boss: MonitorBox = { r: { x: vesa.x - 77.5 * MM, y: vesa.y - 77.5 * MM, w: 155 * MM, h: 155 * MM }, z0: z0 - 37 * MM, z1: hump.z0 };
  // the column: 70 x 30 mm, behind the bracket and its hinge block, from over the bracket down into the foot
  const top = vesa.y - 75 * MM, column: MonitorBox = { r: { x: cx - 35 * MM, y: top, w: 70 * MM, h: deskY - PAD - FOOT_T + 3.2 * MM - top }, z0: z0 - 70.6 * MM, z1: z0 - 35 * MM };
  // the foot: 200 x 165 mm, the column at its back, its front 74 mm out in front of the panel
  const foot: MonitorBox = { r: { x: cx - 100 * MM, y: deskY - PAD - FOOT_T, w: 200 * MM, h: FOOT_T + PAD }, z0: z0 - 90.9 * MM, z1: z0 + 74.1 * MM };
  return { panel: { r: m, z0, z1: z0 + 180 }, hump, boss, vesa, column, foot };
}

/** A seat at the panel's bottom edge: where a cable leaves the monitor, and its way out (down and back). */
export interface MonitorSeat { at: V3; axis: V3 }

/**
 * The video socket and the power cord's exit, under the panel's east end (layout `VIDEO_SOCKET` and `MONITOR_POWER`, 388 and 900 design units in
 * from its east edge): 8.6 mm up inside the housing, 1 mm behind the panel, the cable leaving down and back toward the wall.
 */
export function monitorSeats(m: RectLike, z0: number): { video: MonitorSeat; power: MonitorSeat } {
  const k = m.w / 3300, y = -(m.y + m.h - 8.6 * MM), axis: V3 = [0, -0.6, -0.8];
  return { video: { at: [m.x + m.w - 388 * k, y, z0 - 1.1 * MM], axis }, power: { at: [m.x + m.w - 900 * k, y, z0 - 1.1 * MM], axis } };
}

/** The video cable's plug at the monitor: a real HDMI plug's moulded boot, 21 x 10.5 mm, 32 mm of it out of the socket (plugs3d.ts `hdmiPlug`). */
export const MONITOR_PLUG = { w: 21 * MM, h: 10.5 * MM, l: 32 * MM };

/**
 * A rounded slab: a `w` x `h` outline with corners of radius `rad`, full size over its straight depth `d`, its edges rolling in by `s` over `t`
 * at each end. Built along +z: the first roll over [-t, 0], the full size over [0, d], the second roll over [d, d + t].
 */
function slab(w: number, h: number, d: number, t: number, s: number, rad: number): BufferGeometry {
  const iw = w - 2 * s, ih = h - 2 * s, sh = new Shape();
  roundRect(sh, -iw / 2, -ih / 2, iw / 2, ih / 2, rad - s);
  return extrude(sh, { depth: Math.max(1, d), bevelEnabled: true, bevelThickness: t, bevelSize: s, bevelSegments: 10, curveSegments: 12 });
}

/** A rounded rectangle drawn into a path, its corners `k` (capped by the sides). */
function roundRect(p: Path, x0: number, y0: number, x1: number, y1: number, k: number): void {
  k = Math.max(1, Math.min(k, (x1 - x0) / 2 - 1, (y1 - y0) / 2 - 1));
  p.moveTo(x0 + k, y0); p.lineTo(x1 - k, y0); p.quadraticCurveTo(x1, y0, x1, y0 + k); p.lineTo(x1, y1 - k); p.quadraticCurveTo(x1, y1, x1 - k, y1);
  p.lineTo(x0 + k, y1); p.quadraticCurveTo(x0, y1, x0, y1 - k); p.lineTo(x0, y0 + k); p.quadraticCurveTo(x0, y0, x0 + k, y0);
}

/** A step of the back housing: `r` full size from `zf` back to `zf - d`, its front roll hidden in what it stands on, its back roll its rounded edge. */
function step(r: RectLike, zf: number, d: number, t: number, s: number, rad: number, m: Material): Mesh {
  const g = slab(r.w, r.h, d, t, s, rad);
  g.rotateX(Math.PI);
  const o = new Mesh(g, m);
  o.position.set(r.x + r.w / 2, -(r.y + r.h / 2), zf);
  return place(o);
}

/** A part along a seat's axis: its local z turned onto the axis, its middle `t` out along the axis from the seat. */
function along(o: Mesh, s: MonitorSeat, t: number): Mesh {
  const ax = new Vector3(...s.axis).normalize();
  o.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), ax));
  o.position.set(s.at[0] + ax.x * t, s.at[1] + ax.y * t, s.at[2] + ax.z * t);
  return place(o);
}

/** The rating label on the back: the maker, the model, the input, a serial's barcode and the approval marks. */
function ratingLabel(): Material {
  const W = 600, H = 340;
  const t = paint(W, H, (c) => {
    c.fillStyle = '#cfd3d7'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#1b1d21'; c.textBaseline = 'top';
    c.font = '700 34px system-ui, sans-serif'; c.fillText('PIPELINE', 24, 18);
    c.font = '19px system-ui, sans-serif';
    ['Model: PM19-F    18.5" LED monitor', 'Input: 100-240 V ~ 50/60 Hz 0.8 A', 'Panel: 1366 x 768  60 Hz', 'Made for Pipeline City'].forEach((l, i) => c.fillText(l, 24, 66 + i * 26));
    let x = 24;
    for (let k = 0; x < 360; k++) { const bw = 2 + ((k * 7919) % 5); if (k % 2 === 0) c.fillRect(x, 182, bw, 90); x += bw; }
    c.font = '15px monospace'; c.fillText('S/N PM19F2611083', 24, 280);
    c.lineWidth = 3; c.strokeStyle = '#1b1d21'; c.font = '700 21px system-ui, sans-serif';
    ['CE', 'FC', 'UL'].forEach((s, k) => { c.strokeRect(404 + k * 64, 190, 52, 52); c.fillText(s, 413 + k * 64, 205); });
    c.beginPath(); c.arc(436, 290, 20, 0, Math.PI * 2); c.stroke();
  });
  return mat(0xffffff, { map: t, roughness: 0.6 });
}

/** The power cord's strain relief: a ribbed rubber boot, 13.4 mm across at the housing, tapering to 8 mm round the cord, 22.5 mm long. */
function strainRelief(): BufferGeometry {
  const y0 = -2.1 * MM, L = 22.5 * MM, pts: Vector2[] = [new Vector2(0, y0)];
  for (let i = 0; i <= 24; i++) {
    const y = y0 + (i / 24) * L, r = (6.7 - 2.7 * Math.min(1, (y - y0) / L) + (i > 4 && i % 2 === 0 ? 0.5 : 0)) * MM;
    pts.push(new Vector2(r, y));
  }
  pts.push(new Vector2(0, y0 + L));
  const g = new LatheGeometry(pts, 16);
  g.rotateX(Math.PI / 2);
  return g;
}

/** The body: everything but the picture, its glass and the power light. `screen` is the picture's rect. */
export function monitorBody(m: RectLike, screen: RectLike, deskY: number, z0: number): Group {
  const R = new Group(), p = monitorPlan(m, deskY, z0), cx = m.x + m.w / 2, by = m.y + m.h;
  const shell = mat(0x2d3137, { roughness: 0.45, metalness: 0.2 }), back = mat(0x24272c, { roughness: 0.6 }), dark = mat(0x111215, { roughness: 0.75 });
  const black = mat(0x08090b, { roughness: 0.25 }), rubber = mat(0x0c0c0e, { roughness: 0.92 }), steel = mat(0x8d939a, { metalness: 0.8, roughness: 0.35 });

  // the panel: a 7.8 mm slab, the glass's black border inside its 5.2 mm frame, round the picture down to the chin
  R.add(softBox(m, z0, z0 + 180, shell, 50));
  const F = 120, glassBot = screen.y + screen.h + 30;
  R.add(rectBox({ x: m.x + F, y: m.y + F, w: m.w - 2 * F, h: glassBot - (m.y + F) }, z0 + 176, z0 + 181, black));
  // the maker's name on the chin
  const name = paint(512, 64, (c, w, h) => { c.fillStyle = '#9aa1a9'; c.font = '600 40px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('P I P E L I N E', w / 2, h / 2 + 2); });
  const logo = new Mesh(new PlaneGeometry(1400, 175), mat(0xffffff, { map: name, transparent: true, roughness: 0.4, metalness: 0.3 }));
  logo.position.set(cx, -(glassBot + by) / 2, z0 + 181);
  R.add(logo);
  // five buttons under the chin's east end (the power button the last, by the light)
  for (let k = 0; k < 5; k++) R.add(softBox({ x: m.x + m.w - 2050 + k * 330, y: by - 4, w: k === 4 ? 230 : 190, h: 34 }, z0 + 50, z0 + 140, dark, 12));

  // the back: the skirt rolling off the panel's edge, the hump, the boss under the bracket
  const e = 1.6 * MM;
  R.add(step({ x: m.x + e, y: m.y + e, w: m.w - 2 * e, h: m.h - 2 * e }, z0, 0.5 * MM, 6.4 * MM, 12.8 * MM, 16 * MM, back));
  R.add(step(p.hump.r, z0 - 5.3 * MM, 11.8 * MM, 8.6 * MM, 27.8 * MM, 48.1 * MM, back));
  R.add(step(p.boss.r, z0 - 22.5 * MM, 3.2 * MM, 6.4 * MM, 13.9 * MM, 26.7 * MM, back));
  const capZ = p.hump.z0, h = p.hump.r, b = p.boss.r;
  // the vents across the hump's top, two rows of slots either side of the boss
  const vents: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  const vw = 13.9 * MM, vm = 40.6 * MM, gap = 3.2 * MM;
  for (const y of [h.y + 34.2 * MM, h.y + 41.2 * MM]) for (let x = h.x + vm; x + vw < h.x + h.w - vm; x += 17.6 * MM) if (x + vw < b.x - gap || x > b.x + b.w + gap) vents.push({ x: x + vw / 2, y: -y, z: capZ, sx: vw, sy: 3.4 * MM, sz: 0.4 * MM });
  R.add(instanced(new BoxGeometry(1, 1, 1), dark, vents));
  // the rating label (it faces the wall), the lock slot
  const label = new Mesh(new PlaneGeometry(80 * MM, 45.5 * MM), ratingLabel());
  label.rotation.y = Math.PI;
  label.position.set(h.x + 75 * MM, -(h.y + h.h - 69.5 * MM), capZ - 2);
  R.add(label);
  R.add(rectBox({ x: h.x + h.w - 51.3 * MM, y: h.y + h.h - 53.5 * MM, w: 7 * MM, h: 3 * MM }, capZ - 3, capZ + 2, dark));

  // the VESA 100 bracket: a 120 mm plate on the boss, four screws on the 100 mm square, the hinge block to the column's slider
  const v = p.vesa, plateZ = z0 - 32.1 * MM;
  R.add(softBox({ x: v.x - 60 * MM, y: v.y - 60 * MM, w: 120 * MM, h: 120 * MM }, plateZ - 3.2 * MM, plateZ + 4, shell, 1.6 * MM));
  const head = new CylinderGeometry(5.1 * MM, 5.1 * MM, 1.4 * MM, 16);
  head.rotateX(Math.PI / 2);
  for (const dx of [-VESA, VESA]) for (const dy of [-VESA, VESA]) { const s = new Mesh(head, steel); s.position.set(v.x + dx, -(v.y + dy), plateZ - 3.7 * MM); R.add(place(s)); }
  const c = p.column;
  R.add(softBox({ x: v.x - 27.8 * MM, y: v.y - 30 * MM, w: 55.6 * MM, h: 60 * MM }, c.z1 - 7 * MM, plateZ - 2.7 * MM, shell, 3.2 * MM));

  // the column in one piece, its edges rounded, the cable hole through it (32 x 51 mm), the slider's track down its front
  const foot = deskY - PAD - FOOT_T, hy0 = foot - 112.3 * MM, hy1 = foot - 61.5 * MM, cz1 = c.z1 - 5.9 * MM, S = 7 * MM, hw = 16 * MM;
  const col = new Shape();
  roundRect(col, c.r.x + S, -(c.r.y + c.r.h) + S, c.r.x + c.r.w - S, -c.r.y - S, 22.5 * MM);
  const hole = new Path();
  roundRect(hole, cx - hw - S, -hy1 - S, cx + hw + S, -hy0 + S, hw + S);
  col.holes.push(hole);
  const cg = extrude(col, { depth: cz1 - c.z0 - 2 * S, bevelEnabled: true, bevelThickness: S, bevelSize: S, bevelSegments: 6, curveSegments: 12 });
  const column = new Mesh(cg, shell);
  column.position.z = c.z0 + S;
  R.add(place(column));
  const ty = v.y + 30 * MM;
  R.add(rectBox({ x: cx - 3.2 * MM, y: ty, w: 6.4 * MM, h: hy0 - 16 * MM - ty }, cz1 - 4, cz1 + 3, dark));

  // the foot: a rounded plate (its edge rolled 10.7 mm in over 5.9 mm, top and bottom) on four rubber pads
  const f = p.foot, ft = 5.9 * MM, fg = slab(f.r.w, f.z1 - f.z0, FOOT_T - 2 * ft, ft, 10.7 * MM, 26.7 * MM);
  fg.rotateX(Math.PI / 2);
  const plate = new Mesh(fg, shell);
  plate.position.set(cx, -foot - ft, (f.z0 + f.z1) / 2);
  R.add(place(plate));
  const ph = 8.6 * MM, pin = 17.6 * MM;
  for (const dx of [-80 * MM, 80 * MM]) for (const z of [f.z0 + pin, f.z1 - pin]) R.add(softBox({ x: cx + dx - ph, y: deskY - PAD, w: 2 * ph, h: PAD }, z - ph, z + ph, rubber, 0.5 * MM));

  // the ports at the bottom edge: the video socket's dark surround the plug leaves through, the power cord's ribbed boot
  const seat = monitorSeats(m, z0);
  R.add(along(new Mesh(new BoxGeometry(MONITOR_PLUG.w + 6.4 * MM, MONITOR_PLUG.h + 4.8 * MM, 6.7 * MM), dark), seat.video, 1.2 * MM));
  R.add(along(new Mesh(strainRelief(), rubber), seat.power, 0));
  return R;
}
