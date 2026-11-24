// The expansion cards in 3D as real cards (docs/render/three.md). A GPU, an NPU or a NIC stands up out of its PCIe
// slot: the PCB on edge, the gold fingers down in the slot, the bracket against the case's back with the ports through it. A GPU's fans face
// down toward the shroud over the power supply, its backplate up, its light bar and power sockets along the top edge toward the glass.
// The 2D draws the card lying flat over the board, face up. So the card is built in that pose (the 2D rect and its art, the cooler under the
// PCB, the backplate over it) and stood up by a hinge along the slot, and it stays standing: nothing turns the card or the camera by itself. Up close (`pose`, the card's 2D band) the cooler, the backplate and the
// bracket fade and the card's face shows its 2D art, on the PCB's top face, which looks north: the player turns the view to read it, or a double click flies to its angled view (`standIn`,
// the router board's `Lying`). A NIC has no 2D face: all its parts, its RJ45 jacks too, are on its PCB's top face,
// the one that looks north when it stands (toward the camera and the glass: a mirror of a real tower card, whose parts face down), so the PCB is below the ports, as the photos of real cards show
// it. The jacks stand 13.5 mm on that face at the bracket, so the slot's bay reaches that far north of its line (`SLOT_BAY`) and a cooler in the slot north of it starts east of them (`COOLER_FROM`).
// Its fingers are at its own slot and its bracket west, and its controller's lid fades as the die under it shows its floorplan (`nicchip3d.ts`). A GPU and an AI card are built the same way inside (`accelparts3d.ts`): the
// backplate stands off the PCB over the parts, and fades with the cooler; under it the main die and the card memory's die are two packages, each under its lid.
import { BoxGeometry, Group, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { Container, Graphics } from 'pixi.js';
import { CARD_LEN, cardArt, cardOrigin, cardRect } from '@/core/render/accelart';
import type { Theme } from '@/core/render/theme';
import { FINISH, fadeTree } from '@/core/render/three/artlod';
import { instanced, rectBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { DEVICE_LOD, smooth } from '@/core/render/lod/lod';
import { nicDie } from '@/features/network/render/nic/nicart';
import { nicFaceRect, nicGeo } from '@/features/network/render/nic/niclayout';
import { gpuFar, gpuNear } from '@/features/gpu/render/gpuart';
import { gpuPlan, moveRect } from '@/features/gpu/render/gpulayout';
import { npuFar, npuNear } from '@/features/npu/render/npuart';
import { npuGeo } from '@/features/npu/render/npulayout';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { BD, NIC_BRACKET_X, NIC_LEN, PCIE_RAILS, nicY } from '../layout/layout';
import { LV_DIE, LV_PART, type ArtSet } from './artset3d';
import type { Spin } from './fans3d';
import { wallX, type Span } from './casekit3d';
import { accelParts, type AccelPart } from './accelparts3d';
import {
  gpuBackplate,
  gpuCooler,
  gpuDie,
  gpuOutputs,
  gpuSockets,
  OUT_IN,
  OUT_TOP,
  outDepth,
  OUTPUTS,
  outputHoles,
} from './gpu3d';
import { JACK, JACK_X, jacksOf, mouthAt, NIC_TOP, nicBack, nicBracket, nicParts } from './nic3d';
import type { Lying } from './routerboard3d';
import type { DieFloor, NicChip } from './nicchip3d';
import type { JackLamps } from './rj45jack3d';
import { NIC_LANES, nicCopper } from './niccopper';
import { nicLanes, type NicLanes } from './nicflow';
import { npuBackplate, npuBracket, npuCooler, npuPlan as npuShroud } from './npu3d';
import { gold, passives, pcbSlab, type Passive } from './pcbkit3d';
import { FINGER, KEY, pinAt, TAB, tabOf, txPin } from './pcie';

export type CardKind = 'gpu' | 'npu' | 'nic';

/** One die of a GPU or an AI card on its card: see `Card3D.dies`. */
export interface CardDie {
  part: AccelPart;
  root: Object3D;
  z: number;
  rect: RectLike;
  stand: Lying;
  zTop: number;
  scale: number;
  lod: (zoom: number) => void;
}

/** The hinge: along the slot's centre line, over the slot and its latch (lying flat, the card clears them). The PCB's face (the 2D art) is on this plane, the PCB under it. */
export const HINGE_Z = BOARD_Z + 250;
const PCB_T = 24,
  BACK_T = 18,
  BRACKET_T = 24;
/** How far over the mask's face a NIC's lit copper stands (layout units: under 0.1 mm, below every part's body). */
const TRACE_LIFT = 2;
/** Real millimetres in layout units (the case's scale, docs/PC_PARTS.md). */
const MM = 23;
/** How far the backplate of a GPU or an AI card stands off the PCB's face, over the packages (4 mm: a lidded package stands 2.4). */
const LIFT = 4 * MM;
/**
 * How far a card stands out of its slot, from the hinge (11 mm over the board) to its top edge: an AI card is full height (111 mm over the board),
 * a GPU's cooler stands taller than its bracket (126 mm), as most do, and a NIC is low profile (69 mm) on a full-height bracket.
 */
export const STAND: Record<CardKind, number> = { gpu: 2650, npu: 2300, nic: 1320 };
/**
 * Where a part of the card's flat pose (its layout rect `r` and the depth `zTop` of its top, as the card is built) is once the card stands in slot `slot`: the hinge turns it a quarter,
 * so a point's height over the PCB is its height over the board's slot line, and its distance south of the line is its depth toward the glass. A `Lying`, as the router board's parts
 * (a face that looks up, its east-west span, its middle's depth, the depth it covers, the world height of its top).
 */
export const standIn = (slot: number, r: RectLike, zTop: number): Lying => {
  const y0 = nicY(slot);
  return { x: r.x, w: r.w, z: HINGE_Z + (r.y + r.h / 2 - y0), d: r.h, y: -y0 + (zTop - HINGE_Z) };
};
/** The top of every bracket (a full-height one, folded over just past a full-height card's edge); the case's slot openings match it. */
export const BRACKET_TOP = HINGE_Z + STAND.npu + 60;
/**
 * Each card's real build in mm: its length, and its cooler's thickness under the PCB. The PCB is the 2D card's; a GPU's cooler runs on past it
 * (its end fan blows through a window in the backplate, as on most cards), an AI card's PCB and blower shroud run its full length. The board's
 * slots are 30 mm apart (1.5 real slots) and a card may stand in the next slot, so a cooler stays inside its pitch: slim cards, where a real GPU is
 * often two or three slots thick. Every card ends west of the cable gutter of the smallest case that takes it (`fit.test.ts`).
 */
const BUILD: Record<string, { len: number; cooler: number }> = {
  'gpu-1': { len: 170, cooler: 20 },
  'gpu-2': { len: 200, cooler: 22 },
  'gpu-3': { len: 290, cooler: 24 },
  'npu-1': { len: 170, cooler: 19 },
  'npu-2': { len: 200, cooler: 19 },
};
/** How thick a card's parts stand under its PCB: a GPU's or an AI card's cooler; a NIC's solder side (the tails of its pins in solder, the sink's push pins' tips, 2.2 mm at most). */
const coolerT = (kind: CardKind, visual: string) => (kind === 'nic' ? 2.2 * MM : (BUILD[visual]?.cooler ?? 20) * MM);
/** A card's length in 3D from the board's west edge: the 2D card's, or its real build's where that is longer. */
const lenOf = (kind: CardKind, visual: string) =>
  kind === 'nic' ? (NIC_LEN[visual] ?? 1500) : Math.max(CARD_LEN[visual] ?? 1500, (BUILD[visual]?.len ?? 0) * MM);
/**
 * How far a card reaches, standing: its length, its depth south of its slot's line (the PCB and the cooler) and north of it (a backplate, or a NIC's parts east of its jacks, the sink's top: `NIC_TOP`;
 * the jacks stand higher, but no cooler starts over them: `COOLER_FROM`).
 */
export const cardReach = (kind: CardKind, visual: string) => ({
  len: lenOf(kind, visual),
  south: PCB_T + coolerT(kind, visual),
  north: kind === 'nic' ? Math.ceil(NIC_TOP) : BACK_T,
});
/** The GPU's HDMI mouth (gpu3d's `OUTPUTS`), standing: its face (layout x), its middle (layout y) and depth, where the monitor's cable plugs in. */
export const gpuVideoAt = (_visual: string, slot: number) => ({
  x: NIC_BRACKET_X + OUT_IN + 2,
  y: nicY(slot) + PCB_T + outDepth(OUTPUTS[0]!),
  z: HINGE_Z + OUTPUTS[0]!.c,
});
/** A NIC's first port's opening (nic3d's `mouthAt`: an RJ45 jack's, or the 40G card's QSFP+ cage's), standing: its face (layout x), its middle (layout y: north of the slot's line, the jack stands on the PCB's top face) and depth, where the LAN plug goes in. */
export const nicJackAt = (visual: string, slot: number) => {
  const y0 = nicY(slot),
    m = mouthAt(jacksOf(visual, y0)[0]!, HINGE_Z, visual);
  return { x: JACK_X, y: y0 - (m.z - HINGE_Z), z: HINGE_Z + (m.y - y0) };
};

export interface Card3D {
  root: Group;
  spins: Spin[];
  /** A network card's jack lights (the jack the cable goes into), out: the network's (`network/render/jackleds.ts`). Null on any other card. */
  lan: JackLamps | null;
  /** The materials that follow the part's state (`PartSkin`). */
  skin: MeshStandardMaterial[];
  /** The card's face as it stands (`standIn`: a NIC's strip, a GPU's or an AI card's 2D rect from the slot's line down): the zoom is read over it (its point nearest the view's centre), and what the zoom seen there does (`pose`: the cooler fades, the art shows). */
  face: Lying;
  pose: (zoom: number) => void;
  /** What `pose` fades: the cooler and the backplate (`fadeTree`). */
  fades: Group;
  /** A NIC's insides, once its detail shows: the parts the player can point at (their ids, and where each stands on the standing card: `standIn`), its controller's die (the
   * live layer's frame and depth, its plan's rectangle in that frame, where it stands, the depth of its top in the card's own flat frame, the layout units to a plan unit) and what fades off the die
   * (the lid, a sink on it). Empty and null on the other cards. */
  bodies: { id: string; lie: Lying }[];
  die: { root: Object3D; z: number; rect: RectLike; stand: Lying; zTop: number; scale: number } | null;
  /** A NIC's lit copper (`Chips3D.traces`): the frame the lanes' drawing is in (the card's component side, a band of the drawing for its slot), the depth just over the mask's face in it, and the lanes
   * (`nicflow.ts`). Null on the other cards. */
  copper: {
    root: Object3D;
    z: number;
    lanes: NicLanes;
    /** The zoom band the lit copper fades in over (a GPU's and an AI card's: with their dies; a NIC's: `DEVICE_LOD.nic.parts`). */ band?: readonly [
      number,
      number,
    ];
  } | null;
  lids: Object3D[];
  /** A GPU's or an AI card's two dies (`accelparts3d.ts`): the main die's and the card memory's, each with the live layer's frame and depth, its plan's rectangle in that frame (board space), where it stands, the depth of its top in the card's flat frame, the layout units to a plan unit and its lid's fade. Empty on the other cards. */
  dies: CardDie[];
  /** A NIC's parts as one group: far away they draw as stand-ins (an anchor of the machine's level of detail), so three cards cost a few draws, not each part. Null on the other cards. */
  parts: Object3D | null;
  /** How far a NIC's detail shows (0 the cooler on, 1 the cooler gone and the parts bare): a part is pointed at only then. Always 0 on the other cards, which show no parts. */
  detail: () => number;
  /** The controller's lid fades for the zoom seen over its die (screen pixels per layout unit): the machine reads that zoom at `die.stand`. */
  lod: (zoom: number) => void;
  /** Fade this with the cooler too (a power lead plugged into the top edge). It returns what stops that (the lead is pulled or rebuilt). */
  alsoFade: (o: Object3D) => () => void;
  /** The power sockets' mouths, standing: layout x and y, and the depth of the top edge where a plug goes in. */
  sockets: { x: number; y: number; z: number }[];
}

/** The card's 2D geometry as it is built: its PCB's west end and length (the 2D card's), its cooler's east end, the slot line, its 2D rect's north and south edges (a NIC's: its flat strip). */
export function frame(kind: CardKind, visual: string, slot: number) {
  const y0 = nicY(slot),
    r = kind === 'nic' ? nicFaceRect(slot, visual) : cardRect(slot, visual);
  const L = kind === 'nic' ? (NIC_LEN[visual] ?? 1500) : (CARD_LEN[visual] ?? 1500);
  const base = {
    x0: BD.x,
    x1: BD.x + L,
    xe: BD.x + lenOf(kind, visual),
    y0,
    top: r.y,
    south: r.y + r.h,
    end: y0 + STAND[kind],
    r,
  };
  // (a GPU's or an AI card's PCB carries its dies, which stand where the cooler's base is: the face reaches past them)
  if (kind !== 'nic')
    base.south = Math.max(base.south, (kind === 'gpu' ? gpuDie(base).y : npuShroud(base).die.y) + 12 * MM);
  return base;
}

/**
 * One card in PCIe slot `slot`. `face` puts the 2D art on the plane z over the 2D rect, under `parent` (machine3d's `ArtSurface`); it is shown
 * only once the card swings down (standing, the backplate or the cooler hides it).
 */
export function card3d(
  kind: CardKind,
  visual: string,
  slot: number,
  face: (parent: Group, r: RectLike, z: number) => Object3D,
  nic: { id?: string; floor?: DieFloor; accel?: (part: AccelPart, plan: RectLike) => DieFloor } = {},
): Card3D {
  const root = new Group(),
    hinge = new Group(),
    lying = new Group(),
    fades = new Group(),
    flatOnly = new Group(),
    parts = new Group(),
    spins: Spin[] = [];
  const f = frame(kind, visual, slot),
    { x0, x1, xe, y0, top, south, end } = f,
    ct = coolerT(kind, visual),
    Z = HINGE_Z;
  // the hinge turns round the slot's line: the parts are placed in the 2D pose, relative to it
  const nicCard = kind === 'nic';
  hinge.position.set(0, -y0, Z);
  hinge.rotation.x = -Math.PI / 2; // (standing: the card never turns)
  lying.position.set(0, y0, -Z);
  hinge.add(lying);
  root.add(hinge);
  // (the rest of the 2D strip north of the slot's line lies in the board when the card stands: it is never shown)
  flatOnly.visible = false;
  lying.add(fades, flatOnly);
  const pcbHex = kind === 'gpu' ? 0x1b2236 : kind === 'npu' ? 0x1c1d24 : 0x103848,
    pcbM = mat(pcbHex, { roughness: 0.5 });
  const rect = (x: number, y: number, w: number, h: number): RectLike => ({ x, y, w, h });
  // (a GPU's and an AI card's PCB shows its laminate on its routed edges; a NIC's follows the part's state, `skin`)
  const pcb = (r: RectLike) =>
    kind === 'nic'
      ? rectBox(r, Z - PCB_T, Z, pcbM)
      : pcbSlab(
          [
            [r.x, r.y],
            [r.x + r.w, r.y],
            [r.x + r.w, r.y + r.h],
            [r.x, r.y + r.h],
          ],
          Z - PCB_T,
          Z,
          pcbHex,
        );
  // the PCB: from the slot's line to its 2D south edge it carries the art; north of the line only the gold finger tab stands, down into the
  // slot (the rest of the 2D strip is there only lying flat); past the 2D edge the PCB goes on to the card's real height (it fades with the cooler)
  const rail = PCIE_RAILS[slot]!;
  lying.add(pcb(rect(x0, y0, x1 - x0, south - y0)));
  const lanes = kind === 'nic' ? (NIC_LANES[visual] ?? 1) : 16,
    tab = tabOf(slot, x1, lanes),
    tl = tab.w;
  pcieTab(lying, tab.x, tl, y0, Z, pcbM);
  flatOnly.add(rectBox(rect(x0, top, x1 - x0, y0 - top), Z - PCB_T + 2, Z - 2, pcbM));
  fades.add(pcb(rect(x0, south, x1 - x0, end - south)));
  // (an AI card's PCB runs the shroud's length; a GPU's ends short of its cooler, which runs on past it)
  if (kind === 'npu' && xe > x1) fades.add(pcb(rect(x1, y0, xe - x1, end - y0)));
  // the AC-coupling capacitors of the card's transmit lanes, a pair per lane on the component side by the fingers (a NIC's routed copper puts
  // its own on the solder side, on side A's lines: niccopper.ts)
  if (kind !== 'nic') {
    const under = new Group(),
      caps: Passive[] = [];
    under.rotation.x = Math.PI;
    for (let k = 0; k < lanes; k++)
      for (const s of [0, 1]) {
        const at = pinAt(txPin(k) + s);
        if (at < tl) caps.push({ x: rail.x + 20 + at, y: -(y0 + 1.8 * MM), pkg: '0402', kind: 'cap', turn: true });
      }
    passives(under, caps, -(Z - PCB_T));
    fades.add(under);
  }
  const accel = kind === 'nic' ? undefined : nic.accel,
    art = kind === 'nic' || accel ? null : face(lying, f.r, Z);
  // the bracket at the west end, against the case's back: the slot's full plate whatever the card's size (`bracketSpan`, laid down with the card:
  // its depth along the lying y, its height along the lying z), folded over at its far end, where the case's thumbscrew holds it
  const steel = mat(0x4e5360, { metalness: 0.7, roughness: 0.42 }),
    Zp = Z - PCB_T,
    bx0 = NIC_BRACKET_X,
    bx1 = NIC_BRACKET_X + BRACKET_T;
  const S = bracketSpan(y0),
    ly0 = y0 + S.z0 - Z,
    ly1 = y0 + S.z1 - Z,
    zLo = Z - (S.y1 - y0),
    zHi = Z - (S.y0 - y0),
    plate = { y0: ly0, y1: ly1, z0: zLo, z1: zHi };
  fades.add(
    kind === 'gpu'
      ? gpuBracket(y0, ly0, ly1, zLo, zHi, Zp, steel)
      : kind === 'npu'
        ? npuBracket(f, Zp, ct, bx0, bx1, plate, steel)
        : nicBracket(visual, y0, Z, bx0, bx1, plate, steel),
  );
  fades.add(rectBox(rect(NIC_BRACKET_X - 90, ly1, 90 + BRACKET_T, 20), zLo, zHi, steel));
  const skin: MeshStandardMaterial[] = [],
    flow = kind === 'gpu' && xe - x1 > 600;
  let lan: JackLamps | null = null,
    chip: NicChip | null = null,
    copper: Card3D['copper'] = null;
  const lids: Object3D[] = [];
  const bodies: Card3D['bodies'] = [];
  lying.add(parts);
  // a GPU's cooler, its display outputs and its backplate, with a window past the PCB's end where the end fan blows through the fins (gpu3d.ts);
  // an AI card's blower shroud and backplate (npu3d.ts); a NIC's jacks, controller and the rest of its parts (nic3d.ts)
  if (kind === 'gpu') {
    skin.push(...gpuCooler(fades, spins, visual, f, Zp, Z, BACK_T, ct, flow));
    gpuOutputs(fades, f, Zp);
    gpuBackplate(fades, visual, f, accel ? Z + LIFT : Z, BACK_T, flow);
  } else if (kind === 'npu') {
    skin.push(npuCooler(fades, spins, visual, f, Zp, ct));
    npuBackplate(fades, visual, f, accel ? Z + LIFT : Z, BACK_T);
  } else {
    // (the parts do not fade: they are the card's insides, which show once the solder side's copper and the serial label have gone with the cooler)
    const cu = nicCopper(visual, f, tab),
      geo = nicGeo(visual, slot),
      built = nicParts(parts, visual, f, Z, bx1, cu, {
        slot: nic.id ?? `pcie${slot}`,
        plan: geo.die,
        ...(nic.floor ? { floor: nic.floor } : {}),
      });
    lan = built.lamps;
    chip = built.chip;
    // where each part stands on the standing card: its footprint as it is built, and how high its top stands off the PCB's top face
    for (const b of built.bodies) bodies.push({ id: b.id, lie: standIn(slot, b.rect, Z + b.h) });
    nicBack(fades, visual, f, Zp, cu);
    skin.push(pcbM);
    // the lit copper's frame: in the top face's group, shifted so the lanes' drawing (the card's band of the shared one) lands on the card; its plane stands just over the mask's face
    const lit = nicLanes(cu, slot),
      tr = new Group();
    tr.position.x = -lit.off;
    built.top.add(tr);
    copper = { root: tr, z: Z + TRACE_LIFT, lanes: lit };
  }
  // a GPU's or an AI card's two dies on the PCB's face, under the backplate
  const dies: CardDie[] = [];
  if (accel) {
    const o = cardOrigin(slot, visual),
      geo = kind === 'gpu' ? gpuPlan(visual) : npuGeo(visual);
    const plans = { core: moveRect(geo.core, o), mem: moveRect(geo.memory, o) };
    const at = kind === 'gpu' ? gpuDie(f) : npuShroud(f).die;
    const made = accelParts(
      parts,
      {
        visual,
        at,
        x0,
        x1,
        plans,
        floor: (part) => accel(part, plans[part]),
        slot,
        tab: { x: tab.x, w: tab.w },
        y0,
        board: rect(x0, y0, x1 - x0, south - y0),
        mask: kind === 'gpu' ? { mask: '#0e1320', trace: '#1a2237' } : { mask: '#101118', trace: '#1c1d28' },
      },
      Z,
    );
    // the lit copper's frame: in the packages' group, shifted so the lanes' drawing (the card's band of the shared one) lands on the card
    const tr = new Group();
    tr.position.x = -made.lanes.off;
    made.top.add(tr);
    copper = {
      root: tr,
      z: Z + TRACE_LIFT,
      lanes: made.lanes,
      band: [DEVICE_LOD[kind].fade[0] + 0.04, DEVICE_LOD[kind].fade[1]],
    };
    for (const d of made.dies) {
      if (!d.chip.die) continue;
      dies.push({
        part: d.part,
        root: d.chip.die.root,
        z: d.chip.die.z,
        rect: d.plan,
        stand: standIn(slot, d.rect, Z + d.chip.dieTop),
        zTop: Z + d.chip.dieTop,
        scale: d.chip.scale,
        lod: d.chip.lod,
      });
      lids.push(d.chip.lid);
    }
  }
  // a GPU's 8-pin power sockets on the top edge, on the cooler's side, the mouths toward the glass (standing)
  const sockets = kind === 'gpu' ? gpuSockets(fades, visual, f, Z - PCB_T, HINGE_Z, STAND.gpu, PCB_T) : [];
  const extra: Object3D[] = [];
  const band = DEVICE_LOD[kind].fade,
    fade = [band[0] - 0.06, band[0] + 0.06] as const,
    show = [band[0] + 0.04, band[1]] as const;
  // how far a NIC's detail shows (0 to 1): its parts can be pointed at only then
  let lay = 0;
  const die: Card3D['die'] = chip?.die
    ? {
        root: chip.die.root,
        z: chip.die.z,
        rect: nicGeo(visual, slot).die,
        stand: standIn(slot, chip.rect, Z + chip.dieTop),
        zTop: Z + chip.dieTop,
        scale: chip.scale,
      }
    : null;
  // (the card's face as it stands: the 2D rect from the slot's line to its south edge, the part north of the line lies in the board)
  const faceRect = nicCard ? nicFaceRect(slot, visual) : f.r,
    onLine = { x: faceRect.x, y: y0, w: faceRect.w, h: faceRect.y + faceRect.h - y0 };
  return {
    root,
    spins,
    skin,
    sockets,
    fades,
    lan,
    bodies,
    die,
    dies,
    copper,
    lids: chip ? [chip.lid, ...lids] : lids,
    parts: nicCard ? parts : null,
    face: standIn(slot, onLine, Z),
    detail: () => lay,
    alsoFade: (o) => {
      extra.push(o);
      return () => {
        const i = extra.indexOf(o);
        if (i >= 0) extra.splice(i, 1);
      };
    },
    pose: (zoom) => {
      const a = 1 - smooth(fade[0], fade[1], zoom),
        s = smooth(show[0], show[1], zoom);
      fadeTree(fades, a);
      for (const o of extra) fadeTree(o, a);
      if (art) art.visible = s > 0.02;
      if (nicCard) lay = s;
    },
    lod: (zoom) => chip?.lod(zoom),
  };
}

/**
 * The two dies' floorplans of a GPU or an AI card, drawn in board space (the live layer's space): the main die and the card memory's, side by side with the gap between them. The 3D card bakes each die's
 * rectangle onto its package (`accelparts3d.ts`); the live layer draws over them (`Chips3D`).
 */
function dieArt(T: Theme, kind: 'gpu' | 'npu', visual: string, slot: number): Container {
  const root = new Container(),
    die = new Container(),
    plate = new Graphics(),
    o = cardOrigin(slot, visual);
  if (kind === 'gpu') {
    const p = gpuPlan(visual),
      near = gpuNear(T, p.die);
    die.position.set(o.x + p.origin.x, o.y + p.origin.y);
    gpuFar(plate, T, p.die);
    die.addChild(plate, near.root);
  } else {
    const geo = npuGeo(visual);
    die.position.set(o.x + geo.origin.x, o.y + geo.origin.y);
    npuFar(plate, T, geo.plan);
    die.addChild(plate, npuNear(T, geo.plan).root);
  }
  root.addChild(die);
  return root;
}

/**
 * The card in its slot with its 2D face (`card3d`), one model for the case, Build my PC and the gallery: the GPU's face is the shop picture's art
 * (the die with its floorplan), the NPU's its die without the lid (`npuFace`). The NIC has no 2D face: it is built in 3D, part by part, and only its controller's die wears a
 * floorplan (`nicDie`), under the lid. `onFace`: the face, at depth `z` (the machine runs the dies on it). `id`: the NIC's slot id, which the ids of its parts start with.
 */
export function cardModel(art: ArtSet, T: Theme, kind: CardKind, visual: string, slot: number, id?: string): Card3D {
  if (kind === 'nic') {
    const geo = nicGeo(visual, slot),
      b = art.baker(() => nicDie(T, visual, slot));
    const floor: DieFloor = (frame, S) => ({
      root: art.surface(frame, b.bake, geo.die, 1 / S, LV_DIE, FINISH.die).root,
      z: 3 / S,
    });
    return card3d(
      kind,
      visual,
      slot,
      () => {
        throw new Error('a NIC has no 2D face');
      },
      { ...(id ? { id } : {}), floor },
    );
  }
  // (the card has no 2D face: its dies are 3D, each wearing its floorplan under a lid)
  const b = art.baker(() => dieArt(T, kind, visual, slot));
  const accel =
    (_part: AccelPart, plan: RectLike): DieFloor =>
    (frame, S) => ({ root: art.surface(frame, b.bake, plan, 1 / S, LV_DIE, FINISH.die).root, z: 3 / S });
  return card3d(
    kind,
    visual,
    slot,
    () => {
      throw new Error('a card with dies has no 2D face');
    },
    { accel },
  );
}

/**
 * A slot's bay, standing: how far its bracket plate (and the rear wall's opening behind it, `casedetail3d.ts`) reaches north of the slot's line, over a NIC's jacks that stand 13.5 mm on the PCB's
 * top face, and south of it, over a GPU's outputs under the PCB. The bays tile the slots' pitch with a rib of 20 between them.
 */
export const SLOT_BAY = { north: 355, south: 325 };
/**
 * A slot's bracket plate, standing (layout y and depth, its slot's line at `y0`): one size for every card and for a blank, a margin round the
 * slot's opening in the rear wall (`casedetail3d.ts`), as a real full-height bracket does not follow the card's size.
 */
export const bracketSpan = (y0: number): Span => ({
  y0: y0 - SLOT_BAY.north,
  y1: y0 + SLOT_BAY.south,
  z0: BOARD_Z + 80,
  z1: BRACKET_TOP,
});

/**
 * A GPU's bracket, lying (`ly0..ly1` its depth, `z0..z1` its height, the PCB's underside at `zP`): the plate with the outputs' openings, a hair
 * larger than their shells (`outputHoles`), and exhaust slots cut through it, across it past the outputs and beside them, away from the PCB.
 */
function gpuBracket(
  y0: number,
  ly0: number,
  ly1: number,
  z0: number,
  z1: number,
  zP: number,
  m: MeshStandardMaterial,
): Mesh {
  const ports = outputHoles(y0, zP),
    vents: Span[] = [...ports],
    past = y0 + OUT_TOP + 3 * MM,
    side = Math.min(...ports.map((p) => p.z0)) - 3 * MM;
  // (the slots stay on the cooler's side of the PCB: under its underside)
  for (let y = past; y < ly1 - 120; y += 64) vents.push({ y0: y - 16, y1: y + 16, z0: z0 + 70, z1: zP - 26, r: 14 });
  if (side - (z0 + 70) > 120)
    for (let y = y0 + 120; y < past - 80; y += 64) vents.push({ y0: y - 16, y1: y + 16, z0: z0 + 70, z1: side, r: 14 });
  return wallX(NIC_BRACKET_X, NIC_BRACKET_X + BRACKET_T, { y0: ly0, y1: ly1, z0, z1 }, vents, m);
}

/**
 * A card's PCIe edge, lying (north of the slot's line; standing, down in the slot): the tab from `x` for `w`, split by its key's notch, a gold
 * finger per pin on both faces at the real 1 mm pitch (`pcie.ts`). (The tab's face and its gold sit just under the art's plane: lying flat, the
 * 2D face covers them.)
 */
function pcieTab(g: Group, x: number, w: number, y0: number, Z: number, pcbM: MeshStandardMaterial): void {
  const runs =
    w > KEY.at + KEY.w + 4 * MM
      ? ([
          [x, KEY.at],
          [x + KEY.at + KEY.w, w - KEY.at - KEY.w],
        ] as const)
      : ([[x, w]] as const);
  const pins: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [],
    fl = FINGER.len,
    fy = y0 - TAB + FINGER.from + fl / 2;
  for (const [a, l] of runs) {
    g.add(rectBox({ x: a, y: y0 - TAB, w: l, h: TAB }, Z - PCB_T, Z - 1, pcbM));
    for (let p = a + 0.5 * MM; p < a + l - 0.3 * MM; p += MM)
      for (const z of [Z - 0.7, Z - PCB_T - 0.3]) pins.push({ x: p, y: -fy, z, sx: FINGER.w, sy: fl, sz: 0.6 });
  }
  g.add(instanced(new BoxGeometry(1, 1, 1), gold(), pins));
}

/**
 * The cover over the rear wall's opening of a slot no card fills (the board's empty slots, and the case's slots the board lacks): the bracket's
 * plate with a column of vent slots cut through it, folded over at its far end like a card's bracket. `tone`: the case's finish (`SLOT_BLANK`).
 */
export function slotBlank(y0: number, tone: number): Group {
  const g = new Group(),
    s = bracketSpan(y0),
    m = mat(tone, { metalness: 0.55, roughness: 0.45 }),
    vents: Span[] = [];
  for (let z = s.z0 + 160; z < s.z1 - 140; z += 72)
    vents.push({ y0: s.y0 + 140, y1: s.y1 - 140, z0: z - 13, z1: z + 13, r: 12 });
  g.add(wallX(NIC_BRACKET_X, NIC_BRACKET_X + BRACKET_T, s, vents, m));
  g.add(rectBox({ x: NIC_BRACKET_X - 90, y: s.y0, w: 90 + BRACKET_T, h: s.y1 - s.y0 }, s.z1, s.z1 + 20, m));
  return g;
}
