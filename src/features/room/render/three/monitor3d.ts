// The monitor's body in 3D (props3d.ts `Monitor` adds the picture, its glass and the power light), at the room's scale (18.7 units a mm): a 24 in.
// office monitor of a Dell P2422H's class. A 9.6 mm panel with a 6.4 mm frame on three sides and the maker's name on the chin; the back a rounded
// housing in three steps (the skirt off the panel's edge, the hump with its vents, rating label and lock slot, the boss the VESA 100 bracket
// screws to); the video socket and the power cord's strain relief at the bottom edge, where the cables leave (`monitorSeats`); five buttons under
// the chin's east end; a height-adjustable column with a cable hole through it; a rounded foot on four rubber pads.
import { BoxGeometry, CylinderGeometry, Group, LatheGeometry, Mesh, Path, PlaneGeometry, Quaternion, Shape, Vector2, Vector3, type BufferGeometry, type Material } from 'three';
import { extrude, instanced, paint, place, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';

/** The room's scale: units a mm. */
const MM = 18.7;
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
const PAD = 30, FOOT_T = 280;
/** The VESA 100 square's half: the bracket's screws. */
const VESA = 50 * MM;

export function monitorPlan(m: RectLike, deskY: number, z0: number): MonitorPlan {
  const cx = m.x + m.w / 2, vesa = { x: cx, y: m.y + m.h * 0.42 };
  const hump: MonitorBox = { r: { x: m.x + m.w * 0.12, y: m.y + m.h * 0.07, w: m.w * 0.76, h: m.h * 0.8 }, z0: z0 - 480, z1: z0 };
  const boss: MonitorBox = { r: { x: vesa.x - 1450, y: vesa.y - 1450, w: 2900, h: 2900 }, z0: z0 - 690, z1: hump.z0 };
  // the column: 70 x 30 mm, behind the bracket and its hinge block, from over the bracket down into the foot
  const top = vesa.y - 1400, column: MonitorBox = { r: { x: cx - 650, y: top, w: 1300, h: deskY - PAD - FOOT_T + 60 - top }, z0: z0 - 1320, z1: z0 - 650 };
  // the foot: 200 x 165 mm, the column at its back, its front 64 mm out in front of the panel
  const foot: MonitorBox = { r: { x: cx - 1870, y: deskY - PAD - FOOT_T, w: 3740, h: FOOT_T + PAD }, z0: z0 - 1700, z1: z0 + 1385 };
  return { panel: { r: m, z0, z1: z0 + 180 }, hump, boss, vesa, column, foot };
}

/** A seat at the panel's bottom edge: where a cable leaves the monitor, and its way out (down and back). */
export interface MonitorSeat { at: V3; axis: V3 }

/**
 * The video socket and the power cord's exit, under the panel's east end (layout `VIDEO_SOCKET` and `MONITOR_POWER`, 388 and 900 design units in
 * from its east edge): 8.6 mm up inside the housing, 1 mm behind the panel, the cable leaving down and back toward the wall.
 */
export function monitorSeats(m: RectLike, z0: number): { video: MonitorSeat; power: MonitorSeat } {
  const k = m.w / 3300, y = -(m.y + m.h - 160), axis: V3 = [0, -0.6, -0.8];
  return { video: { at: [m.x + m.w - 388 * k, y, z0 - 20], axis }, power: { at: [m.x + m.w - 900 * k, y, z0 - 20], axis } };
}

/** The video cable's plug at the monitor: an HDMI plug's moulded boot, 21 x 10.5 mm, 32 mm of it out of the socket (cablerig3d.ts `straightPlug`). */
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
    ['Model: PM24-F    24" LED monitor', 'Input: 100-240 V ~ 50/60 Hz 1.5 A', 'Panel: 1920 x 1080 IPS  60 Hz', 'Made for Pipeline City'].forEach((l, i) => c.fillText(l, 24, 66 + i * 26));
    let x = 24;
    for (let k = 0; x < 360; k++) { const bw = 2 + ((k * 7919) % 5); if (k % 2 === 0) c.fillRect(x, 182, bw, 90); x += bw; }
    c.font = '15px monospace'; c.fillText('S/N PM24F2611083', 24, 280);
    c.lineWidth = 3; c.strokeStyle = '#1b1d21'; c.font = '700 21px system-ui, sans-serif';
    ['CE', 'FC', 'UL'].forEach((s, k) => { c.strokeRect(404 + k * 64, 190, 52, 52); c.fillText(s, 413 + k * 64, 205); });
    c.beginPath(); c.arc(436, 290, 20, 0, Math.PI * 2); c.stroke();
  });
  return mat(0xffffff, { map: t, roughness: 0.6 });
}

/** The power cord's strain relief: a ribbed rubber boot, 6.7 mm across at the housing, tapering to 4 mm round the cord. */
function strainRelief(): BufferGeometry {
  const pts: Vector2[] = [new Vector2(0, -40)];
  for (let i = 0; i <= 24; i++) {
    const y = -40 + (i / 24) * 420, r = 125 - 50 * Math.min(1, (y + 40) / 420) + (i > 4 && i % 2 === 0 ? 10 : 0);
    pts.push(new Vector2(r, y));
  }
  pts.push(new Vector2(0, 380));
  const g = new LatheGeometry(pts, 16);
  g.rotateX(Math.PI / 2);
  return g;
}

/** The body: everything but the picture, its glass and the power light. `screen` is the picture's rect. */
export function monitorBody(m: RectLike, screen: RectLike, deskY: number, z0: number): Group {
  const R = new Group(), p = monitorPlan(m, deskY, z0), cx = m.x + m.w / 2, by = m.y + m.h;
  const shell = mat(0x2d3137, { roughness: 0.45, metalness: 0.2 }), back = mat(0x24272c, { roughness: 0.6 }), dark = mat(0x111215, { roughness: 0.75 });
  const black = mat(0x08090b, { roughness: 0.25 }), rubber = mat(0x0c0c0e, { roughness: 0.92 }), steel = mat(0x8d939a, { metalness: 0.8, roughness: 0.35 });

  // the panel: a 9.6 mm slab, the glass's black border inside its 6.4 mm frame, round the picture down to the chin
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
  R.add(step({ x: m.x + 30, y: m.y + 30, w: m.w - 60, h: m.h - 60 }, z0, 10, 120, 240, 300, back));
  R.add(step(p.hump.r, z0 - 100, 220, 160, 520, 900, back));
  R.add(step(p.boss.r, z0 - 420, 60, 120, 260, 500, back));
  const capZ = p.hump.z0, h = p.hump.r, b = p.boss.r;
  // the vents across the hump's top, two rows of slots either side of the boss
  const vents: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  for (const y of [h.y + 640, h.y + 770]) for (let x = h.x + 760; x + 260 < h.x + h.w - 760; x += 330) if (x + 260 < b.x - 60 || x > b.x + b.w + 60) vents.push({ x: x + 130, y: -y, z: capZ, sx: 260, sy: 64, sz: 8 });
  R.add(instanced(new BoxGeometry(1, 1, 1), dark, vents));
  // the rating label (it faces the wall), the lock slot
  const label = new Mesh(new PlaneGeometry(1500, 850), ratingLabel());
  label.rotation.y = Math.PI;
  label.position.set(h.x + 1400, -(h.y + h.h - 1300), capZ - 2);
  R.add(label);
  R.add(rectBox({ x: h.x + h.w - 960, y: h.y + h.h - 1000, w: 150, h: 70 }, capZ - 3, capZ + 2, dark));

  // the VESA 100 bracket: a 120 mm plate on the boss, four screws on the 100 mm square, the hinge block to the column's slider
  const v = p.vesa, plateZ = z0 - 600;
  R.add(softBox({ x: v.x - 1125, y: v.y - 1125, w: 2250, h: 2250 }, plateZ - 60, plateZ + 4, shell, 30));
  const head = new CylinderGeometry(95, 95, 26, 16);
  head.rotateX(Math.PI / 2);
  for (const dx of [-VESA, VESA]) for (const dy of [-VESA, VESA]) { const s = new Mesh(head, steel); s.position.set(v.x + dx, -(v.y + dy), plateZ - 70); R.add(place(s)); }
  const c = p.column;
  R.add(softBox({ x: v.x - 520, y: v.y - 560, w: 1040, h: 1120 }, c.z1 - 130, plateZ - 50, shell, 60));

  // the column in one piece, its edges rounded, the cable hole through it (32 x 51 mm), the slider's track down its front
  const foot = deskY - PAD - FOOT_T, hy0 = foot - 2100, hy1 = foot - 1150, cz1 = c.z1 - 110, S = 130;
  const col = new Shape();
  roundRect(col, c.r.x + S, -(c.r.y + c.r.h) + S, c.r.x + c.r.w - S, -c.r.y - S, 420);
  const hole = new Path();
  roundRect(hole, cx - 300 - S, -hy1 - S, cx + 300 + S, -hy0 + S, 300 + S);
  col.holes.push(hole);
  const cg = extrude(col, { depth: cz1 - c.z0 - 2 * S, bevelEnabled: true, bevelThickness: S, bevelSize: S, bevelSegments: 6, curveSegments: 12 });
  const column = new Mesh(cg, shell);
  column.position.z = c.z0 + S;
  R.add(place(column));
  R.add(rectBox({ x: cx - 60, y: v.y + 560, w: 120, h: hy0 - 300 - (v.y + 560) }, cz1 - 4, cz1 + 3, dark));

  // the foot: a rounded plate (its edge rolled 10.7 mm in over 5.9 mm, top and bottom) on four rubber pads
  const f = p.foot, fg = slab(f.r.w, f.z1 - f.z0, FOOT_T - 220, 110, 200, 500);
  fg.rotateX(Math.PI / 2);
  const plate = new Mesh(fg, shell);
  plate.position.set(cx, -foot - 110, (f.z0 + f.z1) / 2);
  R.add(place(plate));
  for (const dx of [-1500, 1500]) for (const z of [f.z0 + 330, f.z1 - 330]) R.add(softBox({ x: cx + dx - 160, y: deskY - PAD, w: 320, h: PAD }, z - 160, z + 160, rubber, 10));

  // the ports at the bottom edge: the video socket's dark surround the plug leaves through, the power cord's ribbed boot
  const seat = monitorSeats(m, z0);
  R.add(along(new Mesh(new BoxGeometry(MONITOR_PLUG.w + 120, MONITOR_PLUG.h + 90, 125), dark), seat.video, 22));
  R.add(along(new Mesh(strainRelief(), rubber), seat.power, 0));
  return R;
}
