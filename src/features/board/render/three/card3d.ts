// The expansion cards in 3D as real cards (docs/GRAPHICS_3D_OVERHAUL.md "Inside the case"). A GPU, an NPU or a NIC stands up out of its PCIe
// slot: the PCB on edge, the gold fingers down in the slot, the bracket against the case's back with the ports through it. A GPU's fans face
// down toward the shroud over the power supply, its backplate up, its light bar and power sockets along the top edge toward the glass.
// The 2D draws the card lying flat over the board, face up. So the card is built in that pose (the 2D rect and its art, the cooler under the
// PCB, the backplate over it) and stood up by a hinge along the slot. Up close (`pose`, the card's 2D band) the cooler, the backplate and the
// bracket fade, then the card swings down flat and shows its exact 2D face; it stands up again on the way out.
import { BoxGeometry, CylinderGeometry, Group, Mesh, Path, Shape, type MeshStandardMaterial, type Object3D } from 'three';
import { Container, Graphics } from 'pixi.js';
import { CARD_LEN, cardArt, cardOrigin, cardPlugs, cardRect, PLUG_BLOCK } from '@/core/render/accelart';
import type { Theme } from '@/core/render/theme';
import { FINISH, fadeTree } from '@/core/render/three/artlod';
import { extrude, instanced, place, rectBox, rounded, softBox, tube, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { DEVICE_LOD, smooth } from '@/core/render/lod/lod';
import { gpuFanCount } from '@/features/gpu/render/gpulayout';
import { nicArt } from '@/features/network/render/net';
import { npuFar, npuNear } from '@/features/npu/render/npuart';
import { npuGeo } from '@/features/npu/render/npulayout';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { BD, NIC_BRACKET_X, NIC_LEN, PCIE_RAILS, nicRect, nicY } from '../layout/layout';
import { LV_PART, LV_RAISED, type ArtSet } from './artset3d';
import { glowMat, partFan, type Spin } from './fans3d';
import { tex, wallX, type Span } from './casekit3d';

export type CardKind = 'gpu' | 'npu' | 'nic';

/** The hinge: along the slot's centre line, over the slot and its latch (lying flat, the card clears them). The PCB's face (the 2D art) is on this plane, the PCB under it. */
export const HINGE_Z = BOARD_Z + 250;
/** How far the finger tab reaches below the hinge, down into the slot. */
const TAB = 140;
const PCB_T = 24, BACK_T = 18, BRACKET_T = 24;
/** Real millimetres in layout units (the case's scale, docs/PC_PARTS.md). */
const MM = 23;
/**
 * How far a card stands out of its slot, from the hinge (11 mm over the board) to its top edge: an AI card is full height (111 mm over the board),
 * a GPU's cooler stands taller than its bracket (126 mm), as most do, and a NIC is low profile (69 mm) on a full-height bracket.
 */
export const STAND: Record<CardKind, number> = { gpu: 2650, npu: 2300, nic: 1320 };
/** The top of every bracket (a full-height one, folded over just past a full-height card's edge); the case's slot openings match it. */
export const BRACKET_TOP = HINGE_Z + STAND.npu + 60;
/**
 * Each card's real build in mm: its length, and its cooler's thickness under the PCB. The PCB is the 2D card's; a GPU's cooler runs on past it
 * (its end fan blows through a window in the backplate, as on most cards), an AI card's PCB and blower shroud run its full length. The board's
 * slots are 30 mm apart (1.5 real slots) and a card may stand in the next slot, so a cooler stays inside its pitch: slim cards, where a real GPU is
 * often two or three slots thick. Every card ends west of the cable gutter of the smallest case that takes it (`fit.test.ts`).
 */
const BUILD: Record<string, { len: number; cooler: number }> = {
  'gpu-1': { len: 170, cooler: 20 }, 'gpu-2': { len: 200, cooler: 22 }, 'gpu-3': { len: 290, cooler: 24 },
  'npu-1': { len: 170, cooler: 19 }, 'npu-2': { len: 200, cooler: 19 },
};
/** A NIC's controller sink under its PCB. */
/** A NIC's RJ45 jack with its magnetics (mm, as layout units): across the bracket, off the PCB, and deep; the tallest part on the card. */
const JACK = { w: 16 * MM, h: 13.5 * MM, d: 22 * MM };
/** A NIC's controller (its package's side, mm) and the finned sink on it (0: none, as on a real gigabit card). */
const NIC_CHIP: Record<string, { chip: number; sink: number }> = { 'nic-gbe': { chip: 9, sink: 0 }, 'nic-10g': { chip: 25, sink: 40 }, 'nic-40g': { chip: 25, sink: 45 } };
const NIC_SINK = 12 * MM;
const coolerT = (kind: CardKind, visual: string) => (kind === 'nic' ? JACK.h : (BUILD[visual]?.cooler ?? 20) * MM);
/** A card's length in 3D from the board's west edge: the 2D card's, or its real build's where that is longer. */
const lenOf = (kind: CardKind, visual: string) => (kind === 'nic' ? NIC_LEN[visual] ?? 1500 : Math.max(CARD_LEN[visual] ?? 1500, (BUILD[visual]?.len ?? 0) * MM));
/** How far a card reaches, standing: its length, its depth south of its slot's line (the PCB and the cooler) and north of it (a backplate, or a bare face's parts). */
export const cardReach = (kind: CardKind, visual: string) => ({ len: lenOf(kind, visual), south: PCB_T + coolerT(kind, visual), north: kind === 'nic' ? 40 : BACK_T });
/**
 * A GPU's display outputs through its bracket (an HDMI, then three DisplayPorts), on the PCB beside it as real ones are: their offsets from the
 * slot line, lying (standing, their depth over the hinge), their mouths' width, and how far the row stands off the PCB.
 */
const OUTS = [140, 340, 540, 740], OUT_W = 120, OUT_Y = 40;
/** The GPU's HDMI mouth, standing: its face (layout x), its middle (layout y) and depth, where the monitor's cable plugs in. */
export const gpuVideoAt = (_visual: string, slot: number) => ({ x: NIC_BRACKET_X - 54, y: nicY(slot) + PCB_T + OUT_Y + 43, z: HINGE_Z + OUTS[0]! + OUT_W / 2 });

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

/** The card's 2D geometry: its PCB's west end and length (the 2D card's), its cooler's east end, the slot line, its 2D rect's north and south edges. */
function frame(kind: CardKind, visual: string, slot: number) {
  const y0 = nicY(slot), r = kind === 'nic' ? nicRect(slot, visual) : cardRect(slot, visual);
  const L = kind === 'nic' ? NIC_LEN[visual] ?? 1500 : CARD_LEN[visual] ?? 1500;
  return { x0: BD.x, x1: BD.x + L, xe: BD.x + lenOf(kind, visual), y0, top: r.y, south: r.y + r.h, end: y0 + STAND[kind], r };
}

/**
 * One card in PCIe slot `slot`. `face` puts the 2D art on the plane z over the 2D rect, under `parent` (machine3d's `ArtSurface`); it is shown
 * only once the card swings down (standing, the backplate or the cooler hides it).
 */
export function card3d(kind: CardKind, visual: string, slot: number, face: (parent: Group, r: RectLike, z: number) => Object3D): Card3D {
  const root = new Group(), hinge = new Group(), lying = new Group(), fades = new Group(), flatOnly = new Group(), spins: Spin[] = [];
  const f = frame(kind, visual, slot), { x0, x1, xe, y0, top, south, end } = f, ct = coolerT(kind, visual), Z = HINGE_Z;
  // the hinge turns round the slot's line: the parts are placed in the 2D pose, relative to it
  hinge.position.set(0, -y0, Z);
  lying.position.set(0, y0, -Z);
  hinge.add(lying);
  root.add(hinge);
  lying.add(fades, flatOnly);
  const pcbM = mat(kind === 'gpu' ? 0x1b2236 : kind === 'npu' ? 0x1c1d24 : 0x103848, { roughness: 0.5 });
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
  // (an AI card's PCB runs the shroud's length; a GPU's ends short of its cooler, which runs on past it)
  if (kind === 'npu' && xe > x1) fades.add(rectBox(rect(x1, y0, xe - x1, end - y0), Z - PCB_T, Z, pcbM));
  const art = face(lying, f.r, Z);
  // the bracket at the west end, against the case's back: the slot's full plate whatever the card's size (`bracketSpan`, laid down with the card:
  // its depth along the lying y, its height along the lying z), folded over at its far end, where the case's thumbscrew holds it
  const steel = mat(0x6f7683, { metalness: 0.7, roughness: 0.42 }), black = mat(0x07090d, { roughness: 0.55 });
  const S = bracketSpan(y0), ly0 = y0 + S.z0 - Z, ly1 = y0 + S.z1 - Z, zLo = Z - Math.max(S.y1 - y0, PCB_T + ct + 20), zHi = Z - (S.y0 - y0);
  fades.add(kind === 'gpu' ? gpuBracket(y0, ly0, ly1, zLo, zHi, Z - PCB_T, steel) : rectBox(rect(NIC_BRACKET_X, ly0, BRACKET_T, ly1 - ly0), zLo, zHi, steel));
  fades.add(rectBox(rect(NIC_BRACKET_X - 90, ly1, 90 + BRACKET_T, 20), zLo, zHi, steel));
  const skin: MeshStandardMaterial[] = [];
  if (kind === 'gpu') skin.push(...gpu(fades, spins, visual, f, ct, black));
  else if (kind === 'npu') skin.push(npu(fades, spins, f, ct, black));
  else nic(fades, visual, f, black, steel);
  if (kind === 'nic') skin.push(pcbM);
  // the backplate over the PCB's face (the side that looks up, standing), the card's full length: a GPU's has a window past the PCB's end, where
  // the end fan blows through the fins; an AI card's has a vent row at its far end
  if (kind !== 'nic') {
    const back = mat(0x1a1f2c, { metalness: 0.6, roughness: 0.42 }), flow = kind === 'gpu' && xe - x1 > 600;
    if (flow) {
      const s = new Shape(), wx0 = x1 + 80, wx1 = xe - 130, wy0 = y0 + 240, wy1 = end - 240, cr = 60;
      s.moveTo(x0 + 40, -(end - 10)).lineTo(xe - 10, -(end - 10)).lineTo(xe - 10, -(y0 + 20)).lineTo(x0 + 40, -(y0 + 20)).closePath();
      const w = new Path();
      w.moveTo(wx0 + cr, -wy0).lineTo(wx1 - cr, -wy0).absarc(wx1 - cr, -wy0 - cr, cr, Math.PI / 2, 0, true).lineTo(wx1, -wy1 + cr)
        .absarc(wx1 - cr, -wy1 + cr, cr, 0, -Math.PI / 2, true).lineTo(wx0 + cr, -wy1).absarc(wx0 + cr, -wy1 + cr, cr, -Math.PI / 2, -Math.PI, true)
        .lineTo(wx0, -wy0 - cr).absarc(wx0 + cr, -wy0 - cr, cr, Math.PI, Math.PI / 2, true);
      s.holes.push(w);
      const plate = place(new Mesh(extrude(s, { depth: BACK_T - 10, bevelEnabled: true, bevelSize: 4, bevelThickness: 4, bevelSegments: 2, curveSegments: 12 }), back));
      plate.position.z = Z + 6;
      fades.add(plate);
    } else {
      fades.add(softBox(rect(x0 + 40, y0 + 20, xe - x0 - 50, end - y0 - 30), Z + 2, Z + BACK_T, back, 6));
      const vents = [];
      for (let y = y0 + 120; y < end - 120; y += 46) vents.push({ x: xe - 220, y: -y, z: Z + BACK_T, sx: 220, sy: 18, sz: 3 });
      fades.add(instanced(new BoxGeometry(1, 1, 1), black, vents));
    }
    // screws along the plate's rim over the PCB and the maker's name, so the back reads as a finished part and not as a slab
    const screw = mat(0x9aa3b2, { metalness: 0.85, roughness: 0.35 }), screws = [], bx0 = x0 + 90, bx1 = (flow ? x1 : xe) - 60, by0 = y0 + 70, by1 = end - 70;
    for (const sx of [bx0, (bx0 + bx1) / 2, bx1]) for (const sy of [by0, by1]) screws.push({ x: sx, y: -sy, z: Z + BACK_T + 2, sx: 34, sy: 34, sz: 6 });
    fades.add(instanced(new CylinderGeometry(0.5, 0.5, 1, 14).rotateX(Math.PI / 2), screw, screws));
    const name = tex('card-name-' + kind, 512, 128, (c, w, h) => {
      c.fillStyle = '#cfd6e4'; c.font = '700 74px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(kind === 'gpu' ? 'PIPELINE' : 'NEURAL', w / 2, h / 2);
    });
    if (name) fades.add(rectBox(rect((bx0 + bx1) / 2 - 260, (y0 + end) / 2 - 65, 520, 130), Z + BACK_T, Z + BACK_T + 1.5, mat(0xffffff, { map: name, alphaTest: 0.4, metalness: 0.2, roughness: 0.5 })));
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

/**
 * An AI card's face: the board's card with its die and every name and no lid (standing, the blower is the lid), as the 2D shows the card once its
 * lid has faded; the die runs over it (`Chips3D`).
 */
function npuFace(T: Theme, visual: string, i: number): Container {
  const root = cardArt(T, visual, i, true), geo = npuGeo(visual), o = cardOrigin(i, visual), die = new Container(), plate = new Graphics();
  die.position.set(o.x + geo.origin.x, o.y + geo.origin.y);
  npuFar(plate, T, geo.plan);
  die.addChild(plate, npuNear(T, geo.plan).root);
  root.addChild(die);
  return root;
}

/**
 * The card in its slot with its 2D face (`card3d`), one model for the case, Build my PC and the gallery: the GPU's face is the shop picture's art
 * (the die with its floorplan), the NPU's its die without the lid (`npuFace`), the NIC's its board art. `onFace`: the face, at depth `z` (the
 * machine runs the dies on it).
 */
export function cardModel(art: ArtSet, T: Theme, kind: CardKind, visual: string, slot: number, onFace?: (face: Object3D, z: number) => void): Card3D {
  const b = art.baker(() => (kind === 'nic' ? nicArt(T, visual, slot) : kind === 'npu' ? npuFace(T, visual, slot) : cardArt(T, visual, slot, false)));
  return card3d(kind, visual, slot, (parent, r, z) => {
    const face = art.surface(parent, b.bake, r, z, kind === 'nic' ? LV_RAISED : LV_PART, kind === 'nic' ? FINISH.board : FINISH.card).root;
    onFace?.(face, z);
    return face;
  });
}

/**
 * A slot's bracket plate, standing (layout y and depth, its slot's line at `y0`): one size for every card and for a blank, a margin round the
 * slot's opening in the rear wall (`casedetail3d.ts`), as a real full-height bracket does not follow the card's size.
 */
export const bracketSpan = (y0: number): Span => ({ y0: y0 - 60, y1: y0 + 540, z0: BOARD_Z + 80, z1: BRACKET_TOP });

/**
 * A GPU's bracket, lying (`ly0..ly1` its depth, `z0..z1` its height, the PCB's underside at `zP`): the plate with exhaust slots cut through it,
 * across it past the outputs and beside them, away from the PCB.
 */
function gpuBracket(y0: number, ly0: number, ly1: number, z0: number, z1: number, zP: number, m: MeshStandardMaterial): Mesh {
  const vents: Span[] = [], past = y0 + OUTS[OUTS.length - 1]! + OUT_W + 120, side = zP - OUT_Y - 86 - 60;
  for (let y = past; y < ly1 - 120; y += 64) vents.push({ y0: y - 16, y1: y + 16, z0: z0 + 70, z1: z1 - 110, r: 14 });
  if (side - (z0 + 70) > 120) for (let y = y0 + 120; y < past - 80; y += 64) vents.push({ y0: y - 16, y1: y + 16, z0: z0 + 70, z1: side, r: 14 });
  return wallX(NIC_BRACKET_X, NIC_BRACKET_X + BRACKET_T, { y0: ly0, y1: ly1, z0, z1 }, vents, m);
}

/**
 * The cover over the rear wall's opening of a slot no card fills (the board's empty slots, and the case's slots the board lacks): the bracket's
 * plate with a column of vent slots cut through it, folded over at its far end like a card's bracket. `tone`: the case's finish (`SLOT_BLANK`).
 */
export function slotBlank(y0: number, tone: number): Group {
  const g = new Group(), s = bracketSpan(y0), m = mat(tone, { metalness: 0.55, roughness: 0.45 }), vents: Span[] = [];
  for (let z = s.z0 + 160; z < s.z1 - 140; z += 72) vents.push({ y0: y0 + 80, y1: y0 + 400, z0: z - 13, z1: z + 13, r: 12 });
  g.add(wallX(NIC_BRACKET_X, NIC_BRACKET_X + BRACKET_T, s, vents, m));
  g.add(rectBox({ x: NIC_BRACKET_X - 90, y: s.y0, w: 90 + BRACKET_T, h: s.y1 - s.y0 }, s.z1, s.z1 + 20, m));
  return g;
}

/** The GPU's cooler under the PCB: a shroud whose face carries the fans, the fin stack and heat pipes behind them, the light bar on the top edge. */
function gpu(g: Group, spins: Spin[], visual: string, f: ReturnType<typeof frame>, ct: number, black: MeshStandardMaterial): MeshStandardMaterial[] {
  // (the cooler starts 5 mm over the PCB's lower edge: it clears the low parts under it, the chipset's sink and the TPM module)
  const { x0, x1, xe, y0, end } = f, Z = HINGE_Z - PCB_T, zB = Z - ct, xa = x0 + 60, xb = xe, ya = y0 + 110, yb = end - 8;
  const frameM = mat(0x161c2c, { metalness: 0.5, roughness: 0.38 }), finM = mat(0x7d89a4, { metalness: 0.75, roughness: 0.32 });
  // the fan face: a plate with a round hole per fan, 95 mm fans (a little less where three share the length)
  const n = gpuFanCount(visual), seg = (xb - xa) / n, r = Math.min(seg / 2 - 30, (yb - ya) / 2 - 40, 47.5 * MM), cy = (ya + yb) / 2;
  const s = new Shape();
  s.moveTo(xa, -yb).lineTo(xb, -yb).lineTo(xb, -ya).lineTo(xa, -ya).closePath();
  for (let k = 0; k < n; k++) { const h = new Path(); h.absarc(xa + seg * (k + 0.5), -cy, r * 1.04, 0, Math.PI * 2, true); s.holes.push(h); }
  const plate = place(new Mesh(extrude(s, { depth: 28, bevelEnabled: true, bevelSize: 6, bevelThickness: 6, bevelSegments: 2, curveSegments: 48 }), frameM));
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
  // (past the PCB's end the fins run up to the backplate's window: the air goes straight through)
  const plates = [], fz0 = zB + Math.min(170, ct * 0.4), fz1 = Z - 10, fzOut = HINGE_Z + BACK_T - 6;
  for (let x = xa + 40; x < xb - 40; x += 24) {
    const z1 = x > x1 + 30 ? fzOut : fz1;
    plates.push({ x, y: -(ya + 20 + yb - 40) / 2, z: (fz0 + z1) / 2, sx: 6, sy: yb - 40 - ya - 20, sz: z1 - fz0 });
  }
  g.add(instanced(new BoxGeometry(1, 1, 1), finM, plates));
  const nickel = mat(0xa9b6c6, { metalness: 0.9, roughness: 0.26 }), zm = (fz0 + fz1) / 2;
  for (const k of [0.3, 0.5, 0.7]) {
    const y = -(ya + (yb - ya) * k);
    g.add(tube(rounded([[xa + 90, y, Z - 6], [xa + 90, y, zm], [xb - 90, y, zm], [xb - 90, y, Z - 6]], 80, 6), 15, nickel, 12));
  }
  // the light bar along the top edge (it faces the glass standing), on either side of the power sockets
  const plugs = cardPlugs(visual).map((p) => x0 + p), accent = glowMat(0x3be3ff, 0x1d6f80);
  const bars = plugs.length ? [[xa + 80, Math.min(...plugs) - 140], [Math.max(...plugs) + 140, xb - 80]] : [[xa + 80, xb - 80]];
  for (const [b0, b1] of bars) if (b1! - b0! > 200) g.add(rectBox({ x: b0!, y: yb, w: b1! - b0!, h: 8 }, zB + ct * 0.5 - 16, zB + ct * 0.5 + 16, accent));
  spins.push({ rotor: new Group(), ring: accent, needs: null, fixed: 0x3be3ff });
  // the display outputs through the bracket: an HDMI and three DisplayPorts on the PCB's edge, each a steel shell round a dark mouth
  // (`gpuVideoAt` finds the HDMI's mouth from the same numbers)
  const shell = mat(0x9aa1ac, { metalness: 0.8, roughness: 0.35 }), pz = Z - OUT_Y - 78;
  for (const o of OUTS) {
    const y = y0 + o;
    g.add(rectBox({ x: NIC_BRACKET_X - 50, y, w: 50 + 40, h: OUT_W }, pz - 8, pz + 78, shell), rectBox({ x: NIC_BRACKET_X - 54, y: y + 12, w: 8, h: OUT_W - 24 }, pz + 4, pz + 66, black));
  }
  return [frameM, accent];
}

/** The NPU's cooler: a closed blower shroud under the PCB, its round intake near the far end, an accent line along the top edge. */
function npu(g: Group, spins: Spin[], f: ReturnType<typeof frame>, ct: number, black: MeshStandardMaterial): MeshStandardMaterial {
  const { x0, xe, y0, end } = f, Z = HINGE_Z - PCB_T, zB = Z - ct, xa = x0 + 60, xb = xe, ya = y0 + 110, yb = end - 8;
  const shroud = mat(0x23252b, { metalness: 0.45, roughness: 0.4 });
  // a 65 mm blower near the far end
  const r = Math.min(32.5 * MM, (yb - ya) / 2 - 60), fx = xb - r - 90, cy = (ya + yb) / 2;
  const s = new Shape();
  s.moveTo(xa, -yb).lineTo(xb, -yb).lineTo(xb, -ya).lineTo(xa, -ya).closePath();
  const hole = new Path();
  hole.absarc(fx, -cy, r * 1.04, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const plate = place(new Mesh(extrude(s, { depth: 24, bevelEnabled: true, bevelSize: 8, bevelThickness: 8, bevelSegments: 2, curveSegments: 40 }), shroud));
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
  // the exhaust grille through the bracket, the shroud's height
  for (let y = ya + 60; y < yb - 120; y += 120) g.add(rectBox({ x: NIC_BRACKET_X - 4, y, w: 32, h: 60 }, zB + 40, Z - 40, black));
  return shroud;
}

/**
 * A NIC, built as a real low-profile card: every part on its component side (under the PCB standing, as a GPU's cooler; the top face carries the
 * 2D art). The RJ45 jacks through the bracket, their mouths flush with the case's outer wall, two lights each; the controller east of them, under a
 * finned sink on the faster cards (the fins run along the card, in the case's front-to-back air); its crystal, flash, capacitors and resistors.
 */
function nic(g: Group, visual: string, f: ReturnType<typeof frame>, black: MeshStandardMaterial, steel: MeshStandardMaterial) {
  const { y0 } = f, Z = HINGE_Z - PCB_T, fin = mat(0x7d89a4, { metalness: 0.75, roughness: 0.32 });
  const chipM = mat(0x0b0e14, { roughness: 0.4, metalness: 0.2 }), capM = mat(0x1c2c4c, { metalness: 0.3, roughness: 0.45 });
  const spec = NIC_CHIP[visual] ?? NIC_CHIP['nic-gbe']!, ports = visual === 'nic-40g' ? 2 : 1, jx0 = NIC_BRACKET_X - 150, jx1 = jx0 + JACK.d;
  for (let k = 0; k < ports; k++) {
    const y = y0 + 120 + k * (JACK.w + 30), mz = Z - JACK.h + 40;
    g.add(rectBox({ x: jx0, y, w: JACK.d, h: JACK.w }, Z - JACK.h, Z, steel));
    g.add(rectBox({ x: jx0 - 2, y: y + (JACK.w - 270) / 2, w: 12, h: 270 }, mz, mz + 207, black), rectBox({ x: jx0 - 3, y: y + JACK.w / 2 - 60, w: 12, h: 120 }, mz + 207, mz + 250, black));
    for (const [dy, c] of [[22, 0x5cff9a], [JACK.w - 62, 0xffc247]] as const) g.add(rectBox({ x: jx0 - 4, y: y + dy, w: 4, h: 40 }, Z - 70, Z - 30, mat(c, { emissive: c, emissiveIntensity: 0.6 })));
  }
  // the controller: a QFN on the gigabit card, a lidded BGA under the sink's base on the others; the sink's spring pins at two corners
  const cs = spec.chip * MM, ss = Math.max(spec.sink * MM, cs), sx = jx1 + 260, sy = y0 + 160, cx = sx + (ss - cs) / 2, cy = sy + (ss - cs) / 2;
  const chipH = spec.sink ? 58 : 21;
  g.add(rectBox({ x: cx, y: cy, w: cs, h: cs }, Z - chipH, Z, chipM));
  if (spec.sink) {
    const base = Z - chipH, plates = [];
    g.add(rectBox({ x: sx, y: sy, w: ss, h: ss }, base - 69, base, fin));
    for (let y = sy + 23; y < sy + ss - 10; y += 46) plates.push({ x: sx + ss / 2, y: -y, z: (base - 69 + Z - NIC_SINK) / 2, sx: ss, sy: 12, sz: base - 69 - (Z - NIC_SINK) });
    g.add(instanced(new BoxGeometry(1, 1, 1), fin, plates));
    g.add(instanced(new CylinderGeometry(0.5, 0.5, 1, 14).rotateX(Math.PI / 2), mat(0xe8e8e2, { roughness: 0.6 }), [
      { x: sx - 60, y: -(sy - 60), z: Z - 60, sx: 70, sy: 70, sz: 120 }, { x: sx + ss + 60, y: -(sy + ss + 60), z: Z - 60, sx: 70, sy: 70, sz: 120 }]));
  }
  // its crystal (a 3.2 x 2.5 mm can) and SPI flash beside it; the polymer capacitors of its rails and a band of resistors past the sink
  const ex = sx + ss + 220;
  g.add(rectBox({ x: ex, y: sy + 40, w: 74, h: 58 }, Z - 23, Z, steel), rectBox({ x: ex, y: sy + 200, w: 115, h: 138 }, Z - 18, Z, chipM));
  const caps = [], smd = [];
  for (let k = 0; k < 4; k++) caps.push({ x: ex + 260 + k * 160, y: -(y0 + 260), z: Z - 64, sx: 115, sy: 115, sz: 127 });
  for (let k = 0; k < 16; k++) smd.push({ x: ex + 260 + (k % 8) * 70, y: -(y0 + 500 + Math.floor(k / 8) * 60), z: Z - 5, sx: 46, sy: 23, sz: 10 });
  g.add(instanced(new CylinderGeometry(0.5, 0.5, 1, 16).rotateX(Math.PI / 2), capM, caps), instanced(new BoxGeometry(1, 1, 1), mat(0x20242c, { roughness: 0.5 }), smd));
}
