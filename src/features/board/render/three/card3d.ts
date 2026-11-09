// The expansion cards in 3D as real cards (docs/GRAPHICS_3D_OVERHAUL.md "Inside the case"). A GPU, an NPU or a NIC stands up out of its PCIe
// slot: the PCB on edge, the gold fingers down in the slot, the bracket against the case's back with the ports through it. A GPU's fans face
// down toward the shroud over the power supply, its backplate up, its light bar and power sockets along the top edge toward the glass.
// The 2D draws the card lying flat over the board, face up. So the card is built in that pose (the 2D rect and its art, the cooler under the
// PCB, the backplate over it) and stood up by a hinge along the slot. Up close (`pose`, the card's 2D band) the cooler, the backplate and the
// bracket fade, then the card swings down flat and shows its exact 2D face; it stands up again on the way out.
import { BoxGeometry, Group, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { Container, Graphics } from 'pixi.js';
import { CARD_LEN, cardArt, cardOrigin, cardRect } from '@/core/render/accelart';
import type { Theme } from '@/core/render/theme';
import { FINISH, fadeTree } from '@/core/render/three/artlod';
import { instanced, rectBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { DEVICE_LOD, smooth } from '@/core/render/lod/lod';
import { nicArt } from '@/features/network/render/net';
import { npuFar, npuNear } from '@/features/npu/render/npuart';
import { npuGeo } from '@/features/npu/render/npulayout';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { BD, NIC_BRACKET_X, NIC_LEN, PCIE_RAILS, nicRect, nicY } from '../layout/layout';
import { LV_PART, LV_RAISED, type ArtSet } from './artset3d';
import type { Spin } from './fans3d';
import { wallX, type Span } from './casekit3d';
import { gpuBackplate, gpuCooler, gpuOutputs, gpuSockets, OUT_IN, OUT_TOP, outDepth, OUTPUTS, outputHoles } from './gpu3d';
import { JACK, JACK_X, jacksOf, mouthAt, nicBracket, nicParts } from './nic3d';
import { npuBackplate, npuBracket, npuCooler } from './npu3d';
import { gold, passives, pcbSlab, type Passive } from './pcbkit3d';

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
/** How thick a card's parts stand under its PCB: a GPU's or an AI card's cooler, a NIC's jacks (nic3d's `JACK`, its tallest part) with their ground springs. */
const coolerT = (kind: CardKind, visual: string) => (kind === 'nic' ? JACK.h + 0.5 * MM : (BUILD[visual]?.cooler ?? 20) * MM);
/** A card's length in 3D from the board's west edge: the 2D card's, or its real build's where that is longer. */
const lenOf = (kind: CardKind, visual: string) => (kind === 'nic' ? NIC_LEN[visual] ?? 1500 : Math.max(CARD_LEN[visual] ?? 1500, (BUILD[visual]?.len ?? 0) * MM));
/** How far a card reaches, standing: its length, its depth south of its slot's line (the PCB and the cooler) and north of it (a backplate, or a bare face's parts). */
export const cardReach = (kind: CardKind, visual: string) => ({ len: lenOf(kind, visual), south: PCB_T + coolerT(kind, visual), north: kind === 'nic' ? 40 : BACK_T });
/** The GPU's HDMI mouth (gpu3d's `OUTPUTS`), standing: its face (layout x), its middle (layout y) and depth, where the monitor's cable plugs in. */
export const gpuVideoAt = (_visual: string, slot: number) => ({ x: NIC_BRACKET_X + OUT_IN + 2, y: nicY(slot) + PCB_T + outDepth(OUTPUTS[0]!), z: HINGE_Z + OUTPUTS[0]!.c });
/** A NIC's first RJ45 opening (nic3d's `mouthAt`), standing: its face (layout x), its middle (layout y) and depth, where the LAN plug goes in. */
export const nicJackAt = (visual: string, slot: number) => {
  const y0 = nicY(slot), m = mouthAt(jacksOf(visual, y0)[0]!, HINGE_Z - PCB_T);
  return { x: JACK_X, y: y0 + (HINGE_Z - m.z), z: HINGE_Z + (m.y - y0) };
};

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
  const pcbHex = kind === 'gpu' ? 0x1b2236 : kind === 'npu' ? 0x1c1d24 : 0x103848, pcbM = mat(pcbHex, { roughness: 0.5 });
  const rect = (x: number, y: number, w: number, h: number): RectLike => ({ x, y, w, h });
  // (a GPU's and an AI card's PCB shows its laminate on its routed edges; a NIC's follows the part's state, `skin`)
  const pcb = (r: RectLike) => (kind === 'nic' ? rectBox(r, Z - PCB_T, Z, pcbM) : pcbSlab([[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]], Z - PCB_T, Z, pcbHex));
  // the PCB: from the slot's line to its 2D south edge it carries the art; north of the line only the gold finger tab stands, down into the
  // slot (the rest of the 2D strip is there only lying flat); past the 2D edge the PCB goes on to the card's real height (it fades with the cooler)
  const rail = PCIE_RAILS[slot]!;
  lying.add(pcb(rect(x0, y0, x1 - x0, south - y0)));
  const tw = Math.min(rail.w, x1 - rail.x) - 40, lanes = kind === 'nic' ? NIC_LANES[visual] ?? 1 : 16, tl = Math.min(tw, tabLen(lanes));
  pcieTab(lying, rail.x + 20, tl, y0, Z, pcbM);
  flatOnly.add(rectBox(rect(x0, top, x1 - x0, y0 - top), Z - PCB_T + 2, Z - 2, pcbM));
  fades.add(pcb(rect(x0, south, x1 - x0, end - south)));
  // (an AI card's PCB runs the shroud's length; a GPU's ends short of its cooler, which runs on past it)
  if (kind === 'npu' && xe > x1) fades.add(pcb(rect(x1, y0, xe - x1, end - y0)));
  // the AC-coupling capacitors of the card's transmit lanes, a pair per lane on the component side by the fingers
  {
    const under = new Group(), caps: Passive[] = [];
    under.rotation.x = Math.PI;
    for (let k = 0; k < lanes; k++) for (const s of [0, 1]) {
      const at = pinAt(txPin(k) + s);
      if (at < tl) caps.push({ x: rail.x + 20 + at, y: -(y0 + 1.8 * MM), pkg: '0402', kind: 'cap', turn: true });
    }
    passives(under, caps, -(Z - PCB_T));
    fades.add(under);
  }
  const art = face(lying, f.r, Z);
  // the bracket at the west end, against the case's back: the slot's full plate whatever the card's size (`bracketSpan`, laid down with the card:
  // its depth along the lying y, its height along the lying z), folded over at its far end, where the case's thumbscrew holds it
  const steel = mat(0x6f7683, { metalness: 0.7, roughness: 0.42 }), Zp = Z - PCB_T, bx0 = NIC_BRACKET_X, bx1 = NIC_BRACKET_X + BRACKET_T;
  const S = bracketSpan(y0), ly0 = y0 + S.z0 - Z, ly1 = y0 + S.z1 - Z, zLo = Z - Math.max(S.y1 - y0, PCB_T + ct + 20), zHi = Z - (S.y0 - y0), plate = { y0: ly0, y1: ly1, z0: zLo, z1: zHi };
  fades.add(kind === 'gpu' ? gpuBracket(y0, ly0, ly1, zLo, zHi, Zp, steel) : kind === 'npu' ? npuBracket(f, Zp, ct, bx0, bx1, plate, steel) : nicBracket(visual, y0, Zp, bx0, bx1, plate, steel));
  fades.add(rectBox(rect(NIC_BRACKET_X - 90, ly1, 90 + BRACKET_T, 20), zLo, zHi, steel));
  const skin: MeshStandardMaterial[] = [], flow = kind === 'gpu' && xe - x1 > 600;
  // a GPU's cooler, its display outputs and its backplate, with a window past the PCB's end where the end fan blows through the fins (gpu3d.ts);
  // an AI card's blower shroud and backplate (npu3d.ts); a NIC's jacks, controller and the rest of its parts (nic3d.ts)
  if (kind === 'gpu') {
    skin.push(...gpuCooler(fades, spins, visual, f, Zp, Z, BACK_T, ct, flow));
    gpuOutputs(fades, f, Zp);
    gpuBackplate(fades, visual, f, Z, BACK_T, flow);
  } else if (kind === 'npu') {
    skin.push(npuCooler(fades, spins, visual, f, Zp, ct));
    npuBackplate(fades, visual, f, Z, BACK_T);
  } else {
    nicParts(fades, visual, f, Zp, bx1);
    skin.push(pcbM);
  }
  // a GPU's 8-pin power sockets on the top edge, on the cooler's side, the mouths toward the glass (standing)
  const sockets = kind === 'gpu' ? gpuSockets(fades, visual, f, Z - PCB_T, HINGE_Z, STAND.gpu, PCB_T) : [];
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
 * A GPU's bracket, lying (`ly0..ly1` its depth, `z0..z1` its height, the PCB's underside at `zP`): the plate with the outputs' openings, a hair
 * larger than their shells (`outputHoles`), and exhaust slots cut through it, across it past the outputs and beside them, away from the PCB.
 */
function gpuBracket(y0: number, ly0: number, ly1: number, z0: number, z1: number, zP: number, m: MeshStandardMaterial): Mesh {
  const ports = outputHoles(y0, zP), vents: Span[] = [...ports], past = y0 + OUT_TOP + 3 * MM, side = Math.min(...ports.map((p) => p.z0)) - 3 * MM;
  for (let y = past; y < ly1 - 120; y += 64) vents.push({ y0: y - 16, y1: y + 16, z0: z0 + 70, z1: z1 - 110, r: 14 });
  if (side - (z0 + 70) > 120) for (let y = y0 + 120; y < past - 80; y += 64) vents.push({ y0: y - 16, y1: y + 16, z0: z0 + 70, z1: side, r: 14 });
  return wallX(NIC_BRACKET_X, NIC_BRACKET_X + BRACKET_T, { y0: ly0, y1: ly1, z0, z1 }, vents, m);
}

/** The PCIe key's notch along the tab from its bracket end (the short run carries the power pins), and its width. */
const KEY = { at: 11.65 * MM, w: 1.9 * MM };
/** A NIC's link width: x1, x4 or x8 (a GPU's and an AI card's are x16). */
const NIC_LANES: Record<string, number> = { 'nic-gbe': 1, 'nic-10g': 4, 'nic-40g': 8 };
/** The pins on each face of an edge `lanes` wide (the CEM spec: 18, 32, 49, 82). */
export const edgePins = (lanes: number) => (lanes <= 1 ? 18 : lanes <= 4 ? 32 : lanes <= 8 ? 49 : 82);
/** The tab's length for `lanes`: the 11 pins to the key, the key, the rest, half a pitch past the last. */
const tabLen = (lanes: number) => KEY.at + KEY.w + (edgePins(lanes) - 10.5) * MM;
/** Pin `p`'s middle along the tab from its bracket end (1 mm apart, the key between 11 and 12). */
export const pinAt = (p: number) => (p <= 11 ? (p - 0.5) * MM : KEY.at + KEY.w + (p - 11.5) * MM);
/** Side B's PETp pin of transmit lane `k` (its PETn the next one), as the CEM pinout has them. */
export const txPin = (k: number) => (k === 0 ? 14 : k < 4 ? 19 + 4 * (k - 1) : k < 8 ? 33 + 4 * (k - 4) : 50 + 4 * (k - 8));

/**
 * A card's PCIe edge, lying (north of the slot's line; standing, down in the slot): the tab from `x` for `w`, split by its key's notch, a gold
 * finger per pin on both faces at the real 1 mm pitch. (The tab's face and its gold sit just under the art's plane: lying flat, the 2D face
 * covers them.)
 */
function pcieTab(g: Group, x: number, w: number, y0: number, Z: number, pcbM: MeshStandardMaterial): void {
  const runs = w > KEY.at + KEY.w + 4 * MM ? [[x, KEY.at], [x + KEY.at + KEY.w, w - KEY.at - KEY.w]] as const : [[x, w]] as const;
  const pins: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [], fl = 4.2 * MM, fy = y0 - TAB + 0.5 * MM + fl / 2;
  for (const [a, l] of runs) {
    g.add(rectBox({ x: a, y: y0 - TAB, w: l, h: TAB }, Z - PCB_T, Z - 1, pcbM));
    for (let p = a + 0.5 * MM; p < a + l - 0.3 * MM; p += MM) for (const z of [Z - 0.7, Z - PCB_T - 0.3]) pins.push({ x: p, y: -fy, z, sx: 0.7 * MM, sy: fl, sz: 0.6 });
  }
  g.add(instanced(new BoxGeometry(1, 1, 1), gold(), pins));
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
