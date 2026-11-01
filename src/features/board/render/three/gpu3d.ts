// A graphics card's cooler in 3D, after the 2D card (`cardArt`, `gpuCover`, docs/ACCEL.md). The 2D draws the card edge-on from the glass, so the
// cooler is a frame round an open fin stack (the cover's fin lines), two heat pipes along its top, the fans in its north face (the 2D bezels along
// the top edge, seen edge-on from the glass, face-on from above) and the accent bar along its south edge. The board's view fades the cooler away
// to the die (`shroud`); the bracket with its display outputs and the power sockets on the north edge stay (`card`).
import { BoxGeometry, ExtrudeGeometry, Group, Mesh, Path, Shape, type MeshStandardMaterial } from 'three';
import { cardOrigin, cardPlugs, cardRect, PLUG_BLOCK } from '@/core/render/accelart';
import { instanced, place, rectBox, rounded, tube, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { gpuPlan, moveRect } from '@/features/gpu/render/gpulayout';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { NIC_BRACKET_X, nicY } from '../layout/layout';
import { glowMat, partFan, type Spin } from './fans3d';

/** The cooler's depth off the board: from the card's face to the edge toward the glass. */
const Z0 = BOARD_Z + 260, Z1 = BOARD_Z + 1100, WALL = 30;

export interface GpuCooler { shroud: Group; card: Group; spins: Spin[]; skin: MeshStandardMaterial[] }

export function gpuCooler(visual: string, slot: number): GpuCooler {
  const shroud = new Group(), card = new Group(), spins: Spin[] = [];
  const p = gpuPlan(visual), o = cardOrigin(slot, visual), sr = moveRect(p.shroud, o), fans = p.fans.map((f) => moveRect(f, o));
  // the 2D colours: the cover's dark plate and its fin tone, the accent (`T.alu`)
  const frameM = mat(0x161c2c, { metalness: 0.5, roughness: 0.38 }), finM = mat(0x7d89a4, { metalness: 0.75, roughness: 0.32 }), accent = glowMat(0x3be3ff, 0x1d6f80);
  const zc = (Z0 + Z1) / 2, r = Math.min(...fans.map((f) => f.w / 2), (Z1 - Z0) * 0.45) * 0.94;
  // the north wall, open round each fan
  const wall = new Shape(), cx = (f: RectLike) => f.x + f.w / 2;
  wall.moveTo(sr.x, Z0).lineTo(sr.x + sr.w, Z0).lineTo(sr.x + sr.w, Z1).lineTo(sr.x, Z1).closePath();
  for (const f of fans) { const h = new Path(); h.absarc(cx(f), zc, r * 1.05, 0, Math.PI * 2, true); wall.holes.push(h); }
  const north = place(new Mesh(new ExtrudeGeometry(wall, { depth: WALL, bevelEnabled: true, bevelSize: 6, bevelThickness: 6, bevelSegments: 2, curveSegments: 48 }).rotateX(Math.PI / 2), frameM));
  north.position.y = -sr.y;
  shroud.add(north);
  // the other walls: south (the accent bar along its edge toward the glass), and the two ends
  for (const w of [{ x: sr.x, y: sr.y + sr.h - WALL, w: sr.w, h: WALL }, { x: sr.x, y: sr.y, w: WALL, h: sr.h }, { x: sr.x + sr.w - WALL, y: sr.y, w: WALL, h: sr.h }]) shroud.add(rectBox(w, Z0, Z1, frameM));
  shroud.add(rectBox({ x: sr.x + 14, y: sr.y + sr.h - WALL + 6, w: sr.w - 28, h: 18 }, Z1, Z1 + 12, accent));
  spins.push({ rotor: new Group(), ring: accent, needs: null, fixed: 0x3be3ff });
  // the fans in the north wall, blowing south into the fins
  for (const f of fans) {
    const holder = new Group(), fan = partFan(0, 0, 0, r);
    holder.position.set(cx(f), -sr.y, zc);
    holder.rotation.x = -Math.PI / 2;
    holder.add(fan.root);
    shroud.add(holder);
    spins.push(fan.spin);
  }
  // the fin stack behind them, the cover's fin lines (one every 22 units along the card), and two heat pipes arching over it
  const y0 = sr.y + 170, y1 = sr.y + sr.h - WALL, plates = [];
  for (let x = sr.x + 40; x < sr.x + sr.w - 40; x += 22) plates.push({ x, y: -(y0 + y1) / 2, z: (Z0 + 30 + Z1 - 24) / 2, sx: 6, sy: y1 - y0, sz: Z1 - 24 - Z0 - 30 });
  shroud.add(instanced(new BoxGeometry(1, 1, 1), finM, plates));
  const nickel = mat(0xa9b6c6, { metalness: 0.9, roughness: 0.26 });
  for (const k of [0.3, 0.7]) {
    const y = -(y0 + (y1 - y0) * k), xa = sr.x + 70, xb = sr.x + sr.w - 70;
    shroud.add(tube(rounded([[xa, y, Z0 + 40], [xa, y, Z1 - 10], [xb, y, Z1 - 10], [xb, y, Z0 + 40]], 90, 6), 15, nickel, 12));
  }
  // the bracket at the west end with its display outputs, and the power sockets on the north edge
  const steel = mat(0x5d636d, { metalness: 0.7, roughness: 0.45 }), black = mat(0x05070c, { roughness: 0.5 }), cr = cardRect(slot, visual), y = nicY(slot);
  card.add(rectBox({ x: NIC_BRACKET_X, y: cr.y - 10, w: 30, h: cr.h + 20 }, BOARD_Z + 120, Z1 + 80, steel));
  for (let k = 0; k < 3; k++) card.add(rectBox({ x: NIC_BRACKET_X - 54, y: y - 70 + k * 52, w: 54, h: 34 }, Z0 + 120 + k * 200, Z0 + 260 + k * 200, black));
  for (const px of cardPlugs(visual)) {
    const b = { x: o.x + px - PLUG_BLOCK.w / 2, y: cr.y - PLUG_BLOCK.up, w: PLUG_BLOCK.w, h: PLUG_BLOCK.h };
    card.add(rectBox(b, Z1 - 320, Z1 - 60, black));
  }
  return { shroud, card, spins, skin: [frameM, accent] };
}
