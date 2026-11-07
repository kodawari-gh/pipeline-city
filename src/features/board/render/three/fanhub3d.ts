// The fan hub in 3D: the small fan and lighting controller in the case's lower front corner, as the 2D draws it (`fanHub`, room/render/desk/props/case.ts).
// A green board on four brass standoffs with its printed labels and traces, the controller and its passives, a side-entry fan header per mount along the
// top edge (the fan cords' plugs seat in these, `buildCables`: their seats do not move), the input header, the SATA power socket on the west edge, three
// addressable-light outputs and the USB header along the bottom edge.
import { BoxGeometry, CylinderGeometry, Group } from 'three';
import { drum, instanced, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { CASE_Z } from '@/features/room/render/three/roomplan';
import { hubHeaders } from '@/features/room/render/desk/props/case';
import { FAN_HUB, HUB_POWER_Y } from '../layout/layout';
import { decal, grow, outlinePts, screws, shapeOf, slab, tex, type Spot } from './casekit3d';
import { TRAY_Z } from './wires3d';

/** The depth of the hub's board: under the plugs' middle line (CASE_Z + 240), which the side-entry headers stand on. */
const PCB_Z0 = CASE_Z + 176, PCB_Z1 = CASE_Z + 196;

const box = new BoxGeometry(1, 1, 1);
interface Bit { x: number; y: number; z: number; sx: number; sy: number; sz: number }
/** A box as an instance: a layout rect and a depth range. */
const bit = (r: RectLike, z0: number, z1: number): Bit => ({ x: r.x + r.w / 2, y: -(r.y + r.h / 2), z: (z0 + z1) / 2, sx: r.w, sy: r.h, sz: z1 - z0 });

/** The hub board's printed side: its labels and the copper traces under the mask, drawn over the board's green. */
function silk(h: RectLike, headers: readonly { x: number }[]) {
  return tex(`hub-${headers.length}`, 1024, Math.round((1024 * h.h) / h.w), (c, w, ch) => {
    const u = w / h.w, X = (x: number) => (x - h.x) * u, Y = (y: number) => (y - h.y) * u;
    c.fillStyle = '#12281f'; c.fillRect(0, 0, w, ch);
    // the traces, a shade lighter than the mask: fanned out from the controller to each header
    c.strokeStyle = 'rgba(70,130,100,0.55)'; c.lineWidth = 3; c.lineCap = 'round';
    const mx = h.x + h.w / 2, my = h.y + 330;
    headers.forEach((p, i) => {
      const o = (i - (headers.length - 1) / 2) * 16;
      for (const d of [-5, 5]) { c.beginPath(); c.moveTo(X(mx + o + d), Y(my - 80)); c.lineTo(X(mx + o + d), Y(h.y + 170 + Math.abs(o))); c.lineTo(X(p.x + d), Y(h.y + 130)); c.stroke(); }
    });
    for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(X(mx - 90), Y(my + 30 + k * 26)); c.lineTo(X(h.x + 275 + k * 180), Y(h.y + h.h - 200)); c.lineTo(X(h.x + 275 + k * 180), Y(h.y + h.h - 130)); c.stroke(); }
    for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(X(mx + 90), Y(my + 20 + k * 26)); c.lineTo(X(h.x + h.w - 300 + k * 40), Y(h.y + h.h - 220)); c.lineTo(X(h.x + h.w - 300 + k * 40), Y(h.y + h.h - 150)); c.stroke(); }
    // the labels
    c.fillStyle = 'rgba(232,240,232,0.88)'; c.textBaseline = 'middle'; c.textAlign = 'left';
    c.font = `800 ${Math.round(44 * u)}px system-ui, sans-serif`; c.fillText('FAN HUB', X(h.x + 150), Y(h.y + 200));
    c.font = `600 ${Math.round(22 * u)}px system-ui, sans-serif`; c.fillText('FAN + LIGHTING', X(h.x + 150), Y(h.y + 250)); c.fillText('CONTROLLER', X(h.x + 150), Y(h.y + 280));
    c.textAlign = 'center';
    for (let k = 0; k < 3; k++) c.fillText(`ARGB${k + 1}`, X(h.x + 275 + k * 180), Y(h.y + h.h - 40));
    c.fillText('USB 2.0', X(h.x + h.w - 240), Y(h.y + h.h - 176));
    c.fillText('12 V', X(h.x + 130), Y(HUB_POWER_Y));
    c.textAlign = 'right'; c.font = `700 ${Math.round(26 * u)}px system-ui, sans-serif`; c.fillText(`${headers.length} CH`, X(h.x + h.w - 60), Y(h.y + h.h - 44));
    // the pads of the corner screws
    c.fillStyle = 'rgba(214,180,100,0.8)';
    for (const [x, y] of [[h.x + 46, h.y + 46], [h.x + h.w - 46, h.y + 46], [h.x + 46, h.y + h.h - 46], [h.x + h.w - 46, h.y + h.h - 46]] as const) { c.beginPath(); c.arc(X(x), Y(y), 44 * u, 0, Math.PI * 2); c.fill(); }
  });
}

/** The hub in its place: everything from the tray's face out to the top of its headers. */
export function fanHub(): Group {
  const g = new Group(), h = FAN_HUB, z = PCB_Z1, headers = hubHeaders();
  const shell: Bit[] = [], floors: Bit[] = [], pins: Bit[] = [];
  // the board on its four standoffs and screws
  g.add(slab(shapeOf(outlinePts(h, 26)), PCB_Z0, PCB_Z1, mat(0x12281f, { roughness: 0.55, metalness: 0.1 }), 3));
  g.add(decal(grow(h, -8), z + 0.5, mat(0xffffff, { map: silk(h, headers), roughness: 0.55, metalness: 0.1 })));
  const corners: Spot[] = [[h.x + 46, h.y + 46], [h.x + h.w - 46, h.y + 46], [h.x + 46, h.y + h.h - 46], [h.x + h.w - 46, h.y + h.h - 46]].map(([x, y]) => ({ x: x!, y: -y!, z: z + 1 }));
  g.add(screws(corners, 'z+', 34, mat(0xb8bcc2, { metalness: 0.85, roughness: 0.3 })));
  g.add(instanced(new CylinderGeometry(30, 30, PCB_Z0 - TRAY_Z, 6).rotateX(Math.PI / 2), mat(0xb99a58, { metalness: 0.65, roughness: 0.5 }), corners.map((c) => ({ ...c, z: (PCB_Z0 + TRAY_Z) / 2 }))));

  // a side-entry fan header per mount, and the input header: walls either side of the plug's mouth, four gold pins pointing north
  const sideEntry = (hx: number) => {
    const a = hx - 44, b = hx + 44, top = z + 88;
    shell.push(bit({ x: a, y: h.y + 24, w: 88, h: 72 }, z, top), bit({ x: a, y: h.y - 44, w: 9, h: 68 }, z, top), bit({ x: b - 9, y: h.y - 44, w: 9, h: 68 }, z, top));
    floors.push(bit({ x: a + 9, y: h.y - 44, w: 70, h: 68 }, z, z + 6));
    for (let k = 0; k < 4; k++) pins.push(bit({ x: hx - 26 + k * 16, y: h.y - 36, w: 6, h: 62 }, z + 41, z + 47));
  };
  for (const p of headers) sideEntry(p.x);
  sideEntry(h.x + 90);

  // the top-entry headers along the bottom edge: a shell with a dark floor and upright pins
  const topEntry = (r: RectLike, cols: number, rows: number) => {
    const t = 8, top = z + 62;
    shell.push(bit({ x: r.x, y: r.y, w: r.w, h: t }, z, top), bit({ x: r.x, y: r.y + r.h - t, w: r.w, h: t }, z, top), bit({ x: r.x, y: r.y + t, w: t, h: r.h - 2 * t }, z, top), bit({ x: r.x + r.w - t, y: r.y + t, w: t, h: r.h - 2 * t }, z, top));
    floors.push(bit(r, z, z + 8));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) pins.push(bit({ x: r.x + (r.w * (i + 0.5)) / cols - 5, y: r.y + (r.h * (j + 0.5)) / rows - 5, w: 10, h: 10 }, z + 8, z + 50));
  };
  for (let k = 0; k < 3; k++) topEntry({ x: h.x + 200 + k * 180, y: h.y + h.h - 130, w: 150, h: 56 }, 3, 1);
  topEntry({ x: h.x + h.w - 380, y: h.y + h.h - 150, w: 280, h: 84 }, 5, 2);

  // the SATA power socket on the west edge, its mouth to the west
  const py = HUB_POWER_Y, sock: RectLike = { x: h.x - 30, y: py - 170, w: 130, h: 340 };
  g.add(softBox(sock, z, z + 80, mat(0x1d2028, { roughness: 0.5 }), 8));
  g.add(rectBox({ x: h.x - 33, y: py - 150, w: 8, h: 300 }, z + 22, z + 58, mat(0x050608, { roughness: 0.85 })));
  for (let k = 0; k < 15; k++) pins.push(bit({ x: h.x - 35, y: py - 140 + k * 19.4, w: 4, h: 8 }, z + 34, z + 46));

  // the controller, its legs, a crystal, the passives and two capacitors
  const mx = h.x + h.w / 2 - 80, my = h.y + 250;
  g.add(softBox({ x: mx, y: my, w: 160, h: 160 }, z, z + 26, mat(0x0a0b0d, { roughness: 0.42 }), 4));
  g.add(rectBox({ x: mx + 16, y: my + 16, w: 16, h: 16 }, z + 26, z + 26.5, mat(0x2c2d30, { roughness: 0.7 })));
  const legs: Bit[] = [], chips: Bit[] = [], ends: Bit[] = [];
  for (let k = 0; k < 6; k++) {
    const o = 22 + k * 24;
    legs.push(bit({ x: mx + o - 4, y: my - 12, w: 8, h: 14 }, z, z + 8), bit({ x: mx + o - 4, y: my + 158, w: 8, h: 14 }, z, z + 8), bit({ x: mx - 12, y: my + o - 4, w: 14, h: 8 }, z, z + 8), bit({ x: mx + 158, y: my + o - 4, w: 14, h: 8 }, z, z + 8));
  }
  for (let k = 0; k < 5; k++) for (const [x, y] of [[mx - 260 + k * 50, my + 180], [mx + 240 + k * 50 - 80, my + 100]] as const) {
    chips.push(bit({ x, y, w: 30, h: 18 }, z, z + 12));
    ends.push(bit({ x, y, w: 7, h: 18 }, z, z + 13), bit({ x: x + 23, y, w: 7, h: 18 }, z, z + 13));
  }
  g.add(softBox({ x: mx + 200, y: my + 10, w: 90, h: 46 }, z, z + 26, mat(0xb8bcc2, { metalness: 0.85, roughness: 0.32 }), 12));
  g.add(instanced(box, mat(0xa9afb6, { metalness: 0.8, roughness: 0.4 }), legs), instanced(box, mat(0x14151a, { roughness: 0.5 }), chips), instanced(box, mat(0xb8bcc2, { metalness: 0.8, roughness: 0.4 }), ends));
  for (const x of [h.x + 180, h.x + 290]) {
    const y = my + 80;
    g.add(drum(x, y, z, z + 96, 44, mat(0x15161c, { roughness: 0.35, metalness: 0.2 }), 20), drum(x, y, z + 96, z + 97, 38, mat(0xb8bcc2, { metalness: 0.8, roughness: 0.4 }), 20));
    g.add(rectBox({ x: x - 34, y: y - 2, w: 68, h: 4 }, z + 97, z + 97.5, mat(0x3b3e44, { roughness: 0.6 })), rectBox({ x: x - 2, y: y - 34, w: 4, h: 68 }, z + 97, z + 97.5, mat(0x3b3e44, { roughness: 0.6 })));
  }

  g.add(instanced(box, mat(0x1d2028, { roughness: 0.5 }), shell), instanced(box, mat(0x06070a, { roughness: 0.85 }), floors), instanced(box, mat(0xd9b25e, { metalness: 0.95, roughness: 0.28 }), pins));
  return g;
}
