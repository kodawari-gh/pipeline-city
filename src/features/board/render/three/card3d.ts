// The expansion cards in 3D as real cards (docs/GRAPHICS_3D_OVERHAUL.md "Inside the case"). A GPU, an NPU or a NIC stands up out of its PCIe
// slot: the PCB on edge, the gold fingers down in the slot, the bracket against the case's back with the ports through it. A GPU's fans face
// down toward the shroud over the power supply, its backplate up, its light bar and power sockets along the top edge toward the glass.
// The 2D draws the card lying flat over the board, face up. So the card is built in that pose (the 2D rect and its art, the cooler under the
// PCB, the backplate over it) and stood up by a hinge along the slot. Up close (`pose`, the card's 2D band) the cooler, the backplate and the
// bracket fade, then the card swings down flat and shows its exact 2D face; it stands up again on the way out.
import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, Path, Shape, type MeshStandardMaterial, type Object3D } from 'three';
import { CARD_LEN, cardPlugs, cardRect, PLUG_BLOCK } from '@/core/render/accelart';
import { fadeTree } from '@/core/render/three/artlod';
import { instanced, place, rectBox, rounded, softBox, tube, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { DEVICE_LOD, smooth } from '@/core/render/lod/lod';
import { gpuFanCount } from '@/features/gpu/render/gpulayout';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { BD, NIC_BRACKET_X, NIC_LEN, PCIE_RAILS, nicRect, nicY } from '../layout/layout';
import { glowMat, partFan, type Spin } from './fans3d';

export type CardKind = 'gpu' | 'npu' | 'nic';

/** The hinge: along the slot's centre line, over the slot and its latch (lying flat, the card clears them). The PCB's face (the 2D art) is on this plane, the PCB under it. */
export const HINGE_Z = BOARD_Z + 250;
/** How far the finger tab reaches below the hinge, down into the slot. */
const TAB = 140;
const PCB_T = 24, BACK_T = 18, BRACKET_T = 24;
/** How far a card stands out of its slot, by kind: the 2D card is flat and short, a real one is about half as tall as it is long. */
export const STAND: Record<CardKind, number> = { gpu: 1350, npu: 1150, nic: 700 };
/** The cooler's thickness under the PCB (toward the shroud, standing): two, two and a half, three slots for the GPUs; a blower; a NIC's small sink. */
const COOLER_T: Record<string, number> = { 'gpu-1': 320, 'gpu-2': 420, 'gpu-3': 520 };
const coolerT = (kind: CardKind, visual: string) => (kind === 'gpu' ? COOLER_T[visual] ?? 420 : kind === 'npu' ? 300 : 120);

export interface Card3D {
  root: Group;
  spins: Spin[];
  /** The materials that follow the part's state (`PartSkin`). */
  skin: MeshStandardMaterial[];
  /** The 2D rect the zoom is read over (its point nearest the view's centre), and what the zoom seen there does (fade, then swing). */
  at: RectLike;
  pose: (zoom: number) => void;
  /** Fade this with the cooler too (a power lead plugged into the top edge). It returns what stops that (the lead is pulled or rebuilt). */
  alsoFade: (o: Object3D) => () => void;
  /** The power sockets' mouths, standing: layout x and y, and the depth of the top edge where a plug goes in. */
  sockets: { x: number; y: number; z: number }[];
}

/** The card's 2D geometry: its PCB's west end and length, the slot line, its 2D rect's north and south edges. */
function frame(kind: CardKind, visual: string, slot: number) {
  const y0 = nicY(slot), r = kind === 'nic' ? nicRect(slot, visual) : cardRect(slot, visual);
  const L = kind === 'nic' ? NIC_LEN[visual] ?? 1500 : CARD_LEN[visual] ?? 1500;
  return { x0: BD.x, x1: BD.x + L, y0, top: r.y, south: r.y + r.h, end: y0 + STAND[kind], r };
}

/**
 * One card in PCIe slot `slot`. `face` puts the 2D art on the plane z over the 2D rect, under `parent` (machine3d's `ArtSurface`); it is shown
 * only once the card swings down (standing, the backplate or the cooler hides it).
 */
export function card3d(kind: CardKind, visual: string, slot: number, face: (parent: Group, r: RectLike, z: number) => Object3D): Card3D {
  const root = new Group(), hinge = new Group(), lying = new Group(), fades = new Group(), flatOnly = new Group(), spins: Spin[] = [];
  const f = frame(kind, visual, slot), { x0, x1, y0, top, south, end } = f, ct = coolerT(kind, visual), Z = HINGE_Z;
  // the hinge turns round the slot's line: the parts are placed in the 2D pose, relative to it
  hinge.position.set(0, -y0, Z);
  lying.position.set(0, y0, -Z);
  hinge.add(lying);
  root.add(hinge);
  lying.add(fades, flatOnly);
  const pcbM = mat(kind === 'gpu' ? 0x1b2236 : kind === 'npu' ? 0x2a1d46 : 0x103848, { roughness: 0.5 });
  const rect = (x: number, y: number, w: number, h: number): RectLike => ({ x, y, w, h });
  // the PCB: from the slot's line to its 2D south edge it carries the art; north of the line only the gold finger tab stands, down into the
  // slot (the rest of the 2D strip is there only lying flat); past the 2D edge the PCB goes on to the card's real height (it fades with the cooler)
  const rail = PCIE_RAILS[slot]!, gold = mat(0xd9b25e, { metalness: 1, roughness: 0.25 });
  lying.add(rectBox(rect(x0, y0, x1 - x0, south - y0), Z - PCB_T, Z, pcbM));
  // (the tab's face and its gold sit just under the art's plane: lying flat, the 2D face covers them)
  const tw = Math.min(rail.w, x1 - rail.x);
  lying.add(rectBox(rect(rail.x + 20, y0 - TAB, tw - 40, TAB), Z - PCB_T, Z - 1, pcbM));
  for (const z of [Z - PCB_T - 1.5, Z - 1]) lying.add(rectBox(rect(rail.x + 30, y0 - TAB + 6, tw - 60, 60), z, z + 0.6, gold));
  flatOnly.add(rectBox(rect(x0, top, x1 - x0, y0 - top), Z - PCB_T + 2, Z - 2, pcbM));
  fades.add(rectBox(rect(x0, south, x1 - x0, end - south), Z - PCB_T, Z, pcbM));
  const art = face(lying, f.r, Z);
  // the bracket at the west end, against the case's back: a steel plate as tall as the card and as thick as it, folded over at the top
  const steel = mat(0x8c939e, { metalness: 0.75, roughness: 0.38 }), black = mat(0x07090d, { roughness: 0.55 });
  const zLo = Z - PCB_T - ct - 20, zHi = Z + (kind === 'nic' ? 30 : BACK_T + 20);
  fades.add(rectBox(rect(NIC_BRACKET_X, y0 - 40, BRACKET_T, end - y0 + 60), zLo, zHi, steel));
  fades.add(rectBox(rect(NIC_BRACKET_X - 90, end, 90 + BRACKET_T, 20), zLo, zHi, steel));
  const skin: MeshStandardMaterial[] = [];
  if (kind === 'gpu') skin.push(...gpu(fades, spins, visual, f, ct, black));
  else if (kind === 'npu') skin.push(npu(fades, spins, f, ct, black));
  else nic(fades, visual, f, black, steel);
  if (kind === 'nic') skin.push(pcbM);
  // the backplate over the PCB's face (the side that looks up, standing)
  if (kind !== 'nic') {
    const back = mat(0x1a1f2c, { metalness: 0.6, roughness: 0.42 });
    fades.add(softBox(rect(x0 + 40, y0 + 20, x1 - x0 - 50, end - y0 - 30), Z + 2, Z + BACK_T, back, 6));
    const vents = [];
    for (let y = y0 + 120; y < end - 120; y += 46) vents.push({ x: x1 - 220, y: -y, z: Z + BACK_T, sx: 220, sy: 18, sz: 3 });
    fades.add(instanced(new BoxGeometry(1, 1, 1), black, vents));
  }
  // the power sockets on the top edge, on the cooler's side, the mouth toward the glass (standing)
  const sockets = cardPlugs(visual).map((px) => {
    const x = x0 + px;
    fades.add(rectBox(rect(x - PLUG_BLOCK.w / 2, end - 90, PLUG_BLOCK.w, 96), Z - PCB_T - 120, Z - PCB_T, black));
    return { x, y: y0 + PCB_T + 60, z: Z + STAND[kind] + 6 };
  });
  const extra: Object3D[] = [];
  const band = DEVICE_LOD[kind === 'gpu' ? 'gpu' : 'npu'].fade, fade = [band[0] - 0.06, band[0] + 0.06] as const, swing = [band[0] + 0.04, band[1]] as const;
  return {
    root, spins, skin, sockets,
    at: f.r,
    alsoFade: (o) => { extra.push(o); return () => { const i = extra.indexOf(o); if (i >= 0) extra.splice(i, 1); }; },
    pose: (zoom) => {
      const a = 1 - smooth(fade[0], fade[1], zoom), s = smooth(swing[0], swing[1], zoom);
      fadeTree(fades, a);
      for (const o of extra) fadeTree(o, a);
      hinge.rotation.x = -(Math.PI / 2) * (1 - s);
      flatOnly.visible = s > 0.35;
      art.visible = s > 0.02;
    },
  };
}

/** The case's cover over the back-wall opening of a slot no card fills: a vented steel strip as tall as a card stands (a card's bracket takes its place). */
export function slotCover(slot: number): Group {
  const g = new Group(), y0 = nicY(slot), z0 = BOARD_Z + 80, z1 = HINGE_Z + STAND.gpu;
  g.add(rectBox({ x: NIC_BRACKET_X, y: y0 - 60, w: BRACKET_T, h: 600 }, z0, z1, mat(0x646b78, { metalness: 0.5, roughness: 0.5 })));
  const vents = [];
  for (let z = z0 + 140; z < z1 - 120; z += 72) vents.push({ x: NIC_BRACKET_X + BRACKET_T, y: -(y0 + 240), z, sx: 2, sy: 320, sz: 26 });
  g.add(instanced(new BoxGeometry(1, 1, 1), mat(0x07090d, { roughness: 0.6 }), vents));
  return g;
}

/** The GPU's cooler under the PCB: a shroud whose face carries the fans, the fin stack and heat pipes behind them, the light bar on the top edge. */
function gpu(g: Group, spins: Spin[], visual: string, f: ReturnType<typeof frame>, ct: number, black: MeshStandardMaterial): MeshStandardMaterial[] {
  const { x0, x1, y0, end } = f, Z = HINGE_Z - PCB_T, zB = Z - ct, xa = x0 + 60, xb = x1 + 30, ya = y0 + 30, yb = end - 8;
  const frameM = mat(0x161c2c, { metalness: 0.5, roughness: 0.38 }), finM = mat(0x7d89a4, { metalness: 0.75, roughness: 0.32 });
  // the fan face: a plate with a round hole per fan
  const n = gpuFanCount(visual), seg = (xb - xa) / n, r = Math.min(seg / 2 - 30, (yb - ya) / 2 - 40), cy = (ya + yb) / 2;
  const s = new Shape();
  s.moveTo(xa, -yb).lineTo(xb, -yb).lineTo(xb, -ya).lineTo(xa, -ya).closePath();
  for (let k = 0; k < n; k++) { const h = new Path(); h.absarc(xa + seg * (k + 0.5), -cy, r * 1.04, 0, Math.PI * 2, true); s.holes.push(h); }
  const plate = place(new Mesh(new ExtrudeGeometry(s, { depth: 28, bevelEnabled: true, bevelSize: 6, bevelThickness: 6, bevelSegments: 2, curveSegments: 48 }), frameM));
  plate.position.z = zB;
  g.add(plate);
  for (let k = 0; k < n; k++) {
    // a fan facing down (standing): built facing +z, turned over
    const holder = new Group(), fan = partFan(0, 0, 0, r);
    holder.position.set(xa + seg * (k + 0.5), -cy, zB + 2);
    holder.rotation.x = Math.PI;
    holder.add(fan.root);
    g.add(holder);
    spins.push(fan.spin);
  }
  // the walls: the two ends and the top edge (standing); the side over the slot stays open, the air leaves through the fins there
  g.add(rectBox({ x: xa, y: ya, w: 28, h: yb - ya }, zB, Z - 4, frameM), rectBox({ x: xb - 28, y: ya, w: 28, h: yb - ya }, zB, Z - 4, frameM));
  g.add(rectBox({ x: xa, y: yb - 28, w: xb - xa, h: 28 }, zB, Z - 4, frameM));
  // the fins: thin plates across the card behind the fans, and three heat pipes along it from the die
  const plates = [], fz0 = zB + Math.min(170, ct * 0.4), fz1 = Z - 10;
  for (let x = xa + 40; x < xb - 40; x += 24) plates.push({ x, y: -(ya + 20 + yb - 40) / 2, z: (fz0 + fz1) / 2, sx: 6, sy: yb - 40 - ya - 20, sz: fz1 - fz0 });
  g.add(instanced(new BoxGeometry(1, 1, 1), finM, plates));
  const nickel = mat(0xa9b6c6, { metalness: 0.9, roughness: 0.26 }), zm = (fz0 + fz1) / 2;
  for (const k of [0.3, 0.5, 0.7]) {
    const y = -(ya + (yb - ya) * k);
    g.add(tube(rounded([[xa + 90, y, Z - 6], [xa + 90, y, zm], [xb - 90, y, zm], [xb - 90, y, Z - 6]], 80, 6), 15, nickel, 12));
  }
  // the light bar along the top edge (it faces the glass standing), clear of the power sockets
  const plugs = cardPlugs(visual).map((p) => x0 + p), barEnd = plugs.length ? Math.min(...plugs) - 140 : xb - 80;
  const accent = glowMat(0x3be3ff, 0x1d6f80);
  g.add(rectBox({ x: xa + 80, y: yb, w: barEnd - xa - 80, h: 8 }, zB + ct * 0.5 - 16, zB + ct * 0.5 + 16, accent));
  spins.push({ rotor: new Group(), ring: accent, needs: null, fixed: 0x3be3ff });
  // the display outputs through the bracket
  for (let k = 0; k < 3; k++) g.add(rectBox({ x: NIC_BRACKET_X - 60, y: y0 + 140 + k * 200, w: 60 + 40, h: 120 }, zB + ct * 0.35, zB + ct * 0.35 + 70, black));
  return [frameM, accent];
}

/** The NPU's cooler: a closed blower shroud under the PCB, its round intake near the far end, an accent line along the top edge. */
function npu(g: Group, spins: Spin[], f: ReturnType<typeof frame>, ct: number, black: MeshStandardMaterial): MeshStandardMaterial {
  const { x0, x1, y0, end } = f, Z = HINGE_Z - PCB_T, zB = Z - ct, xa = x0 + 60, xb = x1 + 10, ya = y0 + 30, yb = end - 8;
  const shroud = mat(0x221a33, { metalness: 0.45, roughness: 0.4 });
  const r = Math.min(260, (yb - ya) / 2 - 60), fx = xb - r - 90, cy = (ya + yb) / 2;
  const s = new Shape();
  s.moveTo(xa, -yb).lineTo(xb, -yb).lineTo(xb, -ya).lineTo(xa, -ya).closePath();
  const hole = new Path();
  hole.absarc(fx, -cy, r * 1.04, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const plate = place(new Mesh(new ExtrudeGeometry(s, { depth: 24, bevelEnabled: true, bevelSize: 8, bevelThickness: 8, bevelSegments: 2, curveSegments: 40 }), shroud));
  plate.position.z = zB;
  g.add(plate);
  // the walls round it, and the fin block the blower pushes its air through toward the bracket
  for (const w of [{ x: xa, y: ya, w: 28, h: yb - ya }, { x: xb - 28, y: ya, w: 28, h: yb - ya }, { x: xa, y: yb - 28, w: xb - xa, h: 28 }, { x: xa, y: ya, w: xb - xa, h: 28 }]) g.add(rectBox(w, zB, Z - 4, shroud));
  const fins = [];
  for (let y = ya + 40; y < yb - 40; y += 22) fins.push({ x: (xa + 40 + fx - r - 60) / 2, y: -y, z: (zB + 30 + Z - 6) / 2, sx: fx - r - 60 - xa - 40, sy: 6, sz: Z - 6 - zB - 30 });
  g.add(instanced(new BoxGeometry(1, 1, 1), mat(0x7d89a4, { metalness: 0.75, roughness: 0.32 }), fins));
  const holder = new Group(), fan = partFan(0, 0, 0, r);
  holder.position.set(fx, -cy, zB + 2);
  holder.rotation.x = Math.PI;
  holder.add(fan.root);
  g.add(holder);
  spins.push(fan.spin);
  g.add(rectBox({ x: xa + 60, y: yb, w: xb - xa - 120, h: 8 }, zB + ct * 0.5 - 12, zB + ct * 0.5 + 12, mat(0xa68bff, { roughness: 0.4, metalness: 0.3 })));
  // the exhaust grille through the bracket
  for (let k = 0; k < 4; k++) g.add(rectBox({ x: NIC_BRACKET_X - 4, y: y0 + 120 + k * 120, w: 32, h: 60 }, zB + 40, Z - 40, black));
  return shroud;
}

/** A NIC: the controller's heat sink under the PCB (bigger on the faster cards), the RJ45 jacks through the bracket with their lights. */
function nic(g: Group, visual: string, f: ReturnType<typeof frame>, black: MeshStandardMaterial, steel: MeshStandardMaterial) {
  const { x0, y0, end } = f, Z = HINGE_Z - PCB_T, fin = mat(0x7d89a4, { metalness: 0.75, roughness: 0.32 });
  const big = visual === 'nic-40g', w = visual === 'nic-gbe' ? 220 : big ? 760 : 480, ya = y0 + 80, yb = Math.min(end - 60, ya + 360);
  g.add(rectBox({ x: x0 + 520, y: ya, w, h: yb - ya }, Z - 24, Z, fin));
  const plates = [];
  for (let x = x0 + 534; x < x0 + 520 + w - 10; x += 28) plates.push({ x, y: -(ya + yb) / 2, z: Z - 70, sx: 8, sy: yb - ya, sz: 92 });
  g.add(instanced(new BoxGeometry(1, 1, 1), fin, plates));
  // the PCB's face (the side that looks up, standing): the controller, a row of capacitors, resistors and a crystal, so the card is not a bare slab
  const chipM = mat(0x0b0e14, { roughness: 0.4, metalness: 0.2 }), capM = mat(0x1c2c4c, { metalness: 0.3, roughness: 0.45 });
  const cx = x0 + 300, cy = y0 + 200 + (big ? 80 : 0), cs = big ? 260 : 190;
  g.add(rectBox({ x: cx, y: cy, w: cs, h: cs }, Z, Z + 20, chipM), rectBox({ x: cx + 18, y: cy + 18, w: cs - 36, h: cs - 36 }, Z + 20, Z + 22, mat(0x2a3140, { roughness: 0.3, metalness: 0.5 })));
  const pins = [];
  for (let k = 0; k < 9; k++) { const t = cx + 16 + k * ((cs - 32) / 8); pins.push({ x: t, y: -(cy - 10), z: Z + 6, sx: 10, sy: 22, sz: 4 }, { x: t, y: -(cy + cs + 10), z: Z + 6, sx: 10, sy: 22, sz: 4 });
    pins.push({ x: cx - 10, y: -(cy + 16 + k * ((cs - 32) / 8)), z: Z + 6, sx: 22, sy: 10, sz: 4 }, { x: cx + cs + 10, y: -(cy + 16 + k * ((cs - 32) / 8)), z: Z + 6, sx: 22, sy: 10, sz: 4 }); }
  g.add(instanced(new BoxGeometry(1, 1, 1), steel, pins));
  const caps = [], smd = [];
  for (let k = 0; k < 6; k++) caps.push({ x: cx + cs + 150 + k * 90, y: -(cy + 40), z: Z + 40, sx: 56, sy: 56, sz: 80 });
  for (let k = 0; k < 14; k++) smd.push({ x: cx - 40 + (k % 7) * 60, y: -(cy + cs + 90 + Math.floor(k / 7) * 46), z: Z + 5, sx: 36, sy: 20, sz: 10 });
  g.add(instanced(new CylinderGeometry(0.5, 0.5, 1, 16).rotateX(Math.PI / 2), capM, caps), instanced(new BoxGeometry(1, 1, 1), mat(0x20242c, { roughness: 0.5 }), smd));
  g.add(rectBox({ x: cx + cs + 160, y: cy + 150, w: 120, h: 50 }, Z, Z + 26, steel));
  // the jacks: their bodies on the PCB, their mouths through the bracket; one per port, two lights each
  const ports = big ? 2 : 1;
  for (let k = 0; k < ports; k++) {
    const y = y0 + 120 + k * 230;
    g.add(rectBox({ x: NIC_BRACKET_X - 150, y, w: 150 + 260, h: 170 }, Z - 150, Z, steel));
    g.add(rectBox({ x: NIC_BRACKET_X - 152, y: y + 30, w: 10, h: 110 }, Z - 130, Z - 20, black));
    for (const [dy, c] of [[14, 0x5cff9a], [140, 0xffc247]] as const) g.add(rectBox({ x: NIC_BRACKET_X - 153, y: y + dy, w: 4, h: 18 }, Z - 40, Z - 22, mat(c, { emissive: c, emissiveIntensity: 0.6 })));
  }
}
