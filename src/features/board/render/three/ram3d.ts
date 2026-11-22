// The memory sticks in 3D as real DIMMs (docs/render/three.md). The 2D draws a stick flat, its face seen from above;
// here it stands in its socket: the gold fingers down in the groove, the chips on both faces, a latch clipped into the notch at each end. The
// look follows the tier, one linear ladder (`RUNGS`): a bare green stick, then one straight plate that grows, gains a light bar, a groove line and a better metal at each rung. Up close the spreaders fade to the chips (the shared lid band, `dieShow`); the camera never turns by itself, so the
// faces are read by turning the view, or from the angled view a double click flies to (`RAM_FACE_YAW`). The chips sit where the 2D chips are along the stick, so the live memory map can land on them.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BoxGeometry, ExtrudeGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Shape, Vector3, type BufferGeometry, type Material, type MeshStandardMaterial, type Texture } from 'three';
import { BRAND_FONT, drawLockup, lockupWidth } from '@/core/render/brands';
import { instanced, paint, place, rectBox, SEG, shareTex, softBox, type RectLike } from '@/core/render/three/geometry';
import { dieShow, dieZoom } from '@/core/render/lod/lod';
import { FINISH, fadeTree } from '@/core/render/three/artlod';
import { CERAMIC, mat } from '@/core/render/three/materials';
import { seeThrough, unseen } from '@/core/render/three/pick';
import type { Theme } from '@/core/render/theme';
import { RAM_DIE, ramDieArt, ramDiePlan, type RamDiePlan, type RamDieSpec } from '@/features/memory/render/ramdie';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { DIMM_H } from '../layout/layout';
import { ramChips, ramNotch } from '../devices';
import { LV_DIE, type ArtSet } from './artset3d';
import { tex } from './casekit3d';
import { glowMat, light, type Spin } from './fans3d';
import { plateFace, ramFace, type Foot } from './ramface3d';

/** The socket: a housing along the stick, `SLOT_W` wide (a real one is about 6 mm) and `SLOT_H` high; the stick's fingers sink `SINK` into its `GROOVE`. */
export const SLOT_W = 140, SLOT_H = 110;
const GROOVE = 36, TOP = BOARD_Z + SLOT_H, SINK = 70, Z0 = TOP - SINK;
/**
 * The stick. Along its face it keeps the board's length for it (`DIMM_H`: 2400 for a real 133.35 mm, `STICK_MM` units a mm) and a real stick's
 * height to it: 31.25 mm to the top edge. Across it the case's 23 units a mm, as the slot pitch: a 1.27 mm PCB, 1 mm chips, a 0.5 mm thermal pad
 * under a spreader. `END`: the gap at each end of the socket (the latches' hooks). The data chips (10 mm tall) sit in the PCB's upper band,
 * `CHIP_Z0` to `CHIP_Z1` over its bottom edge.
 */
export const STICK_MM = DIMM_H / 133.35;
const PCB_T = 29, PCB_H = Math.round(31.25 * STICK_MM), CHIP_T = 23, PAD = 12, END = 8, CHIP_Z1 = PCB_H - 60, CHIP_Z0 = CHIP_Z1 - 180;
/** The latch: the notch its hook takes in the stick's end (height over the PCB's bottom edge, radius), and how high the latch stands. */
const NOTCH_V = Math.round(PCB_H * 0.44), NOTCH_R = 16, LATCH_Z = Z0 + NOTCH_V + 14;
/**
 * The ladder. One straight-edged plate on every spreader; each tier up adds a step you can count: the plate grows (a low plate over the chips, then the PCB's full height), a light bar
 * rises on it (4, 7, 10, 13 mm over the PCB's top edge), a groove line is cut in the plate (one more a tier, three at most), and the metal gets better (stamped steel, dark anodised, matte black,
 * brushed gunmetal, dark titanium with a polished chamfer, titanium with gold trim). Tier 0 is the bare green stick. The ECC sticks (tiers 4 and 6) are the DDR4 and DDR5 sticks one step up.
 */
interface Rung { over: number; plate: number; t: number; metal: number; rough: number; color: number; grooves: number; trim: boolean; gold: boolean }
const RUNGS: Record<number, Rung> = {
  1: { over: 0, plate: -6, t: 14, metal: 0.6, rough: 0.5, color: 0x4e5360, grooves: 0, trim: false, gold: false },
  2: { over: 0, plate: 0, t: 18, metal: 0.6, rough: 0.45, color: 0x2a2d32, grooves: 1, trim: false, gold: false },
  3: { over: 4, plate: 40, t: 22, metal: 0.2, rough: 0.7, color: 0x131518, grooves: 2, trim: false, gold: false },
  4: { over: 7, plate: 56, t: 26, metal: 0.8, rough: 0.3, color: 0x4e5360, grooves: 3, trim: false, gold: false },
  5: { over: 10, plate: 70, t: 30, metal: 0.85, rough: 0.25, color: 0x959aa3, grooves: 3, trim: true, gold: false },
  6: { over: 13, plate: 84, t: 32, metal: 0.9, rough: 0.22, color: 0xb9babf, grooves: 3, trim: true, gold: true },
};
/** The ladder's rung of a stick (0 is the bare stick). */
export const stickTier = (visual: string): number =>
  ({ 'dimm-basic': 0, 'dimm-fast': 1, 'dimm-ddr3': 2, 'dimm-lowlat': 3, 'dimm-ecc': 4, 'dimm-ddr5': 5, 'dimm-ddr5ecc': 6 } as Record<string, number>)[visual] ?? 0;
/** The yaw and the pitch (radians) of the view a double click on the sticks flies to, to read their faces in a row (the faces look east; from above, the eye clears the drive cages). */
export const RAM_FACE_YAW = 0.5, RAM_FACE_PITCH = 0.35;
/** The depth over the board (layout units) the view of the sticks' faces is aimed at: about the middle of their chips (a stick's chips stand 320 to 500 over its socket). */
export const RAM_FACE_AT = 450;

/** bare (tier 0), a low plate (1), a full plate (2), a plate under a light bar (3 to 6). */
export type StickLook = 'bare' | 'low' | 'flat' | 'rgb';
export const stickLook = (visual: string): StickLook => { const t = stickTier(visual); return t === 0 ? 'bare' : t === 1 ? 'low' : t === 2 ? 'flat' : 'rgb'; };

/** How high a stick reaches over the board (its spreader or light bar included). */
export const stickTop = (visual: string): number => Z0 + PCB_H + Math.round((RUNGS[stickTier(visual)]?.over ?? 0) * STICK_MM);

/** The PCB's bottom edge over the board, and its height: a stick's real proportions are checked against them. */
export const STICK = { z0: Z0, h: PCB_H, t: PCB_T + 2 * CHIP_T } as const;


/** Boxes of one material as one mesh, each placed where it stands (their geometry is local to their position). */
function fuse(parts: Mesh[], m: Material): Mesh {
  return place(new Mesh(mergeGeometries(parts.map((p) => p.geometry.clone().translate(p.position.x, p.position.y, p.position.z)), false)!, m));
}

/** A shape drawn in the stick's plane (u along it, v up from the PCB's bottom edge), extruded `t` thick, turned to stand at `x` (its near face) from its south end `y`. */
function standing(s: Shape, t: number, x: number, y: number, bevel = 0): BufferGeometry {
  const g = new ExtrudeGeometry(s, { depth: t, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: SEG.ramCurve });
  // (u, v, depth) to world (x + depth, y + u, Z0 + v): a turn, so the normals hold
  return g.applyMatrix4(new Matrix4().set(0, 0, 1, x, 1, 0, 0, y, 0, 1, 0, Z0, 0, 0, 0, 1));
}

/** The PCB: the key notch in the finger edge, a round notch at each end for the latch's hook. */
function pcbShape(L: number, notchU: number): Shape {
  const s = new Shape(), k = 8;
  s.moveTo(0, 0).lineTo(notchU - k, 0).lineTo(notchU - k, 22).absarc(notchU, 22, k, Math.PI, 0, true).lineTo(notchU + k, 0).lineTo(L, 0);
  s.lineTo(L, NOTCH_V - NOTCH_R).absarc(L, NOTCH_V, NOTCH_R, -Math.PI / 2, Math.PI / 2, true).lineTo(L, PCB_H).lineTo(0, PCB_H);
  s.lineTo(0, NOTCH_V + NOTCH_R).absarc(0, NOTCH_V, NOTCH_R, Math.PI / 2, -Math.PI / 2, true).closePath();
  return s;
}

/** A spreader plate's outline over u0..u1: a plain rectangle up to `v1` with its top corners cut at 45 degrees (`c`; the lowest rung rounds them). */
function plateShape(v1: number, u0: number, u1: number, c: number): Shape {
  // (from just over the socket's top)
  const s = new Shape(), v0 = SINK + 14;
  s.moveTo(u0, v0).lineTo(u1, v0).lineTo(u1, v1 - c).lineTo(u1 - c, v1).lineTo(u0 + c, v1).lineTo(u0, v1 - c).closePath();
  return s;
}

// ------------------------------------------------------------------ painted faces
let chipTex: Texture | null | undefined;

/** The gold fingers on each face by generation: an SDR stick has 168 pins, a DDR2 or DDR3 240, a DDR4 or DDR5 288 (half on each face). */
export const stickPins = (visual: string): number => (visual === 'dimm-basic' ? 84 : visual === 'dimm-fast' || visual === 'dimm-ddr3' ? 120 : 144);

/** A DRAM chip's face (as wide as the chip is long, 230 by 180): black epoxy with a sheen, the pin-1 dot, the maker's lockup, a part number, a date code and a data-matrix square, laser-etched. */
function chipFace(): Texture | null {
  if (chipTex !== undefined) return chipTex;
  return chipTex = shareTex(paint(256, 200, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#1d1f25'); g.addColorStop(1, '#101115');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); c.arc(w * 0.12, h * 0.14, 6, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 2; c.strokeRect(5, 5, w - 10, h - 10);
    const ink = 'rgba(208,216,230,0.62)';
    drawLockup(c, 'kaiju', w * 0.2, h * 0.14, h * 0.13, ink);
    c.fillStyle = ink; c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = `600 ${Math.round(h * 0.11)}px ${BRAND_FONT}`;
    c.fillText('KJ8G08BJ-DC', w * 0.2, h * 0.46);
    c.fillStyle = 'rgba(208,216,230,0.42)'; c.font = `500 ${Math.round(h * 0.085)}px ${BRAND_FONT}`;
    c.fillText('2441  K9H3Q7', w * 0.2, h * 0.62);
    c.fillText('FBGA96  1.2V', w * 0.2, h * 0.76);
    // the data-matrix: a small square of cells
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i * 5 + j * 3 + i * j) % 3) c.fillRect(w * 0.76 + i * 5, h * 0.58 + j * 5, 4, 4);
  }));
}

// ------------------------------------------------------------------ the socket
/** A memory socket over its 2D rect: the housing with its groove, the gold contacts down in it, the key, and a latch at each end (open when empty). */
export function dimmSlot(r: RectLike, empty: boolean, tone = 0x1a1d24, latchTone = 0x2c3242): { housing: Group; latches: Group } {
  const cx = r.x + r.w / 2, housing = new Group(), latches = new Group();
  const body = mat(tone, { roughness: 0.55 }), dark = mat(0x050608, { roughness: 0.8 }), gold = mat(0xd4af5f, { metalness: 1, roughness: 0.25 });
  housing.add(softBox({ x: cx - SLOT_W / 2, y: r.y, w: SLOT_W, h: r.h }, BOARD_Z, TOP, body, 10));
  housing.add(rectBox({ x: cx - GROOVE / 2, y: r.y + 18, w: GROOVE, h: r.h - 36 }, Z0 - 4, TOP + 1, dark));
  for (const s of [-1, 1]) housing.add(rectBox({ x: cx + s * (GROOVE / 2 - 3) - 2, y: r.y + 24, w: 4, h: r.h - 48 }, Z0 + 6, TOP - 6, gold));
  housing.add(rectBox({ x: cx - GROOVE / 2, y: r.y + r.h * 0.42, w: GROOVE, h: 12 }, Z0 - 4, Z0 + 26, body));
  // the latches: a lever on a pivot at each end of the housing, its hook over the stick's end notch when closed
  const latchM = mat(latchTone, { roughness: 0.5 }), open = empty ? 0.5 : 0;
  for (const end of [-1, 1] as const) {
    const pivot = new Group(), hy = end < 0 ? r.y : r.y + r.h;
    pivot.position.set(cx, -hy, BOARD_Z);
    pivot.rotation.x = end * open;
    pivot.userData.latchEnd = end; // (Build my PC swings it open for a stick on its way out: `buildmode3d.ts`)
    const arm = softBox({ x: -SLOT_W / 2 + 4, y: end < 0 ? -34 : 0, w: SLOT_W - 8, h: 34 }, 0, LATCH_Z - BOARD_Z, latchM, 8);
    const hook = rectBox({ x: -11, y: end < 0 ? 0 : -(END + NOTCH_R + 2), w: 22, h: END + NOTCH_R + 2 }, LATCH_Z - BOARD_Z - 30, LATCH_Z - BOARD_Z - 8, latchM);
    const tab = softBox({ x: -SLOT_W / 2 + 4, y: end < 0 ? -48 : 14, w: SLOT_W - 8, h: 34 }, LATCH_Z - BOARD_Z - 20, LATCH_Z - BOARD_Z, latchM, 8);
    pivot.add(arm, hook, tab);
    latches.add(pivot);
  }
  return { housing, latches };
}

// ------------------------------------------------------------------ the stick
export interface Stick {
  root: Group;
  /** The spreader (and its light bar): it fades in the RAM band to show the chips. */
  spreader: Group;
  /** An unseen box over the 2D rect: the thin stick is easy to click from the glass. */
  hit: Mesh;
  /** The data chips' faces toward the leaning camera (east), in the 2D chips' order, each over its die: the live memory map is painted on them (`RamMap3D`), in the die's banks. */
  mapFaces: Mesh[];
  /** The dies on the data chips' two faces (`ramDieArt`): they fade in as the spreader goes (`fadeTree`). Empty without a plan (`dies`). */
  dies: Group[];
  /** The plan of the dies: where the banks lie on a chip's face. Null without a plan. */
  plan: RamDiePlan | null;
  spins: Spin[];
  /** The materials that follow the part's state (`PartSkin`). */
  skin: MeshStandardMaterial[];
}

/** What a stick needs to show its chips' dies: the set that bakes the art, the palette, and the banks of the stick's generation. */
export interface RamDies { art: ArtSet; T: Theme; spec: RamDieSpec }

/** A stick's cover goes and its dies come in, `f` from 0 to 1 (`dieShown`). */
export function stickFade(st: Stick, f: number): void {
  fadeTree(st.spreader, 1 - f);
  for (const die of st.dies) fadeTree(die, f);
}

/** How far a stick has shown its dies at `zoom` (screen pixels per unit): 0 to 1 over the band every chip's lid uses (`dieShow`, lod.ts), read on a chip's die. */
export const dieShown = (zoom: number): number => dieShow(zoom, RAM_DIE.w);

/** The zoom a flight to the sticks ends at: where a chip's die is wholly shown. */
export const RAM_DIE_ZOOM = dieZoom(RAM_DIE.w);

/** The gap between a chip's face and the art on it, and the live map over the art. */
const DIE_OFF = 0.3, MAP_OFF = 2;

/**
 * A frame on a chip's face (`side`: east 1, west -1) in which a plan drawn from its top left corner reads upright from outside the face, centred at (x, y, z). Its z is out of the face.
 * `inner` is the plan's own frame; `k` scales it (a smaller chip carries the same die smaller).
 */
function faceFrame(plan: RamDiePlan, side: 1 | -1, x: number, y: number, z: number, k = 1): { frame: Group; inner: Group } {
  const frame = new Group(), inner = new Group();
  frame.position.set(x, y, z);
  frame.scale.setScalar(k);
  frame.setRotationFromMatrix(new Matrix4().makeBasis(new Vector3(0, side, 0), new Vector3(0, 0, 1), new Vector3(side, 0, 0)));
  inner.position.set(-plan.w / 2, plan.h / 2, 0);
  frame.add(inner);
  return { frame, inner };
}

/** One stick standing in the socket over `r`, `label` (its model) printed on its spreader or on a sticker over its chips. `dies`: each data chip then shows its die as the spreader goes. */
export function ramStick(visual: string, ecc: boolean, r: RectLike, label = '', dies?: RamDies): Stick {
  const look = stickLook(visual), cx = r.x + r.w / 2;
  const L = r.h - 2 * END, ys = -(r.y + r.h - END), root = new Group(), spreader = new Group(), spins: Spin[] = [];
  /** A 2D stick y (0 at its north end, DIMM_H long) as a world y. */
  const wy = (y: number) => -(r.y + y);
  // the key notch where the 2D stick's finger row has its gap (`ramArt`), measured from the south end
  const notchU = L - (70 + (ramNotch(visual) / 24) * (DIMM_H - 140) - END);
  // the PCB: green on the bare sticks (the server sticks too), the 2D stick's navy under a spreader
  const green = look === 'bare', pcbColor = green ? '#1d5a3c' : '#171b23';
  const edge = mat(green ? 0x174a32 : 0x12151b, { roughness: 0.5 });
  // the chips on both faces, where the 2D chips are along the stick (`ramChips`); in the gap between the two groups an ECC stick has its parity
  // chip, a DDR5 its PMIC, every stick its SPD (off to a side, clear of the runs to the others)
  const Zc0 = Z0 + CHIP_Z0, Zc1 = Z0 + CHIP_Z1, d = ramChips(), gy = (d[3]!.y + d[3]!.h + d[4]!.y) / 2;
  const chips: { y: number; h: number; z0: number; z1: number; kind: Foot['kind'] }[] = d.map((c) => ({ y: c.y, h: c.h, z0: Zc0, z1: Zc1, kind: 'dram' as const }));
  if (ecc) chips.push({ y: gy - 70, h: 140, z0: Zc0, z1: Zc1, kind: 'reg' });
  if (visual === 'dimm-ddr5' || visual === 'dimm-ddr5ecc') chips.push({ y: gy + (ecc ? 72 : -23), h: 46, z0: Zc0 - 120, z1: Zc0 - 70, kind: 'pmic' });
  chips.push({ y: gy + (ecc ? -97 : 59), h: 22, z0: Zc0 - 170, z1: Zc0 - 140, kind: 'spd' });
  // the PCB's face: the copper from each finger to the chip it feeds (`ramFace`); a chip's place along the PCB (u from its south end) and over its bottom edge (v)
  const foot: Foot[] = chips.map((c) => ({ u0: L + END - c.y - c.h, u1: L + END - c.y, v0: c.z0 - Z0, v1: c.z1 - Z0, kind: c.kind }));
  const rank = ['DDR3', 'DDR4', 'DDR5'].find((g) => label.includes(g)) ?? 'SDR';
  const marks = [`${rank} ${ecc ? 'ECC REG' : 'UNB'} DIMM`, `${ecc ? '9' : '8'}x 1R  ${stickPins(visual) * 2}P`];
  const face = mat(0xffffff, { map: ramFace(pcbColor, { L, H: PCB_H, notchU, pins: stickPins(visual), sink: SINK, foot }, marks), roughness: 0.45, metalness: 0.1 });
  root.add(place(new Mesh(standing(pcbShape(L, notchU), PCB_T, cx - PCB_T / 2, ys), [face, edge])));
  // each chip is a package: a mould with its marks and a dark rim (two draws, not six: the mould box's two x faces are one group
  // for the printed top, its four other faces one group for the sides)
  const top = mat(0xffffff, { map: chipFace(), roughness: 0.5 }), side = mat(0x131518, { roughness: 0.6 });
  const face0 = PCB_T / 2;
  const sides = [-1, 1] as const, cyOf = (c: { y: number; h: number }) => (wy(c.y) + wy(c.y + c.h)) / 2;
  const items = chips.flatMap((c) => sides.map((s) => ({ x: cx + s * (face0 + CHIP_T / 2), y: cyOf(c), z: (c.z0 + c.z1) / 2, sx: CHIP_T, sy: c.h - 4, sz: c.z1 - c.z0 - 4 })));
  const chipBox = new BoxGeometry(1, 1, 1);
  chipBox.clearGroups(); chipBox.addGroup(0, 12, 0); chipBox.addGroup(12, 24, 1);
  root.add(instanced(chipBox, [top, side] as unknown as MeshStandardMaterial, items));
  // the dies: each DRAM chip's two faces wear the die's plan (one bake for the stick, `ramDieArt`; the parity chip of an ECC stick is the same die, smaller); the data
  // chips' east face also carries the live map, a plane over the plan that stays hidden until the map is painted and the camera is close
  const mapFaces: Mesh[] = [], dieFrames: Group[] = [], plan = dies ? ramDiePlan(dies.spec) : null;
  if (dies && plan) {
    const bake = dies.art.baker(() => ramDieArt(dies.T, plan)), out = PCB_T / 2 + CHIP_T;
    for (const [i, c] of chips.slice(0, d.length + (ecc ? 1 : 0)).entries()) for (const sd of [1, -1] as const) {
      const x = cx + sd * out, y = (wy(c.y) + wy(c.y + c.h)) / 2, z = (c.z0 + c.z1) / 2, k = Math.min(1, (c.h - 6) / plan.w, (c.z1 - c.z0 - 6) / plan.h);
      const art = faceFrame(plan, sd, x + sd * DIE_OFF, y, z, k);
      dies.art.surface(art.inner, bake.bake, { x: 0, y: 0, w: plan.w, h: plan.h }, 0, LV_DIE, FINISH.die);
      dieFrames.push(art.frame);
      root.add(art.frame);
      if (sd < 0 || i >= d.length) continue;
      const live = faceFrame(plan, sd, x + sd * MAP_OFF, y, z), f = new Mesh(new PlaneGeometry(plan.w, plan.h), new MeshBasicMaterial({ transparent: true, toneMapped: false }));
      f.position.set(plan.w / 2, -plan.h / 2, 0);
      f.visible = false;
      live.inner.add(f);
      root.add(live.frame);
      mapFaces.push(f);
    }
  }
  // decoupling capacitors under each DRAM chip, on both faces
  const caps: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  for (const c of chips) if (c.kind === 'dram' || c.kind === 'reg') for (const s of sides) for (const o of [-0.3, 0.3]) {
    const x = cx + s * (face0 + 4), y = cyOf(c) + o * c.h, z = Z0 + CHIP_Z0 - 22;
    caps.push({ x, y, z, sx: 8, sy: 18, sz: 10 });
  }
  root.add(instanced(new BoxGeometry(1, 1, 1), mat(CERAMIC, { roughness: 0.55 }), caps));
  if (look === 'bare') {
    // the maker's sticker across the first group of chips on the west face: it goes with the spreaders, over the chips' dies (the live map lands on the east)
    if (label) spreader.add(faceLabel(label, true, cx - PCB_T / 2 - CHIP_T - 2.5, wy((d[0]!.y + d[3]!.y + d[3]!.h) / 2), Z0 + (CHIP_Z0 + CHIP_Z1) / 2, -1, Math.min(760, d[3]!.y + d[3]!.h - d[0]!.y - 40), CHIP_Z1 - CHIP_Z0 - 30));
    root.add(spreader);
    return { root, spreader, hit: hitBox(r, visual), spins, skin: [edge], mapFaces, dies: dieFrames, plan };
  }
  // the spreader: one straight plate over each face, on a thermal pad over the chips; `RUNGS` says what this tier adds to it
  const rung = RUNGS[stickTier(visual)]!, t = rung.t, x0 = PCB_T / 2 + CHIP_T + PAD, u0 = 18, u1 = L - 18, top0 = PCB_H + rung.plate, over = Math.round(rung.over * STICK_MM);
  // each plate wears one picture (`plateFace`): brushed metal, the groove lines (one more a tier; the first is polished on the better rungs, gold on the best), a dark band under the light bar, the model.
  // Its edge takes the same picture
  const sideM = mat(rung.color, { metalness: rung.metal, roughness: rung.rough }), hex = `#${rung.color.toString(16).padStart(6, '0')}`;
  const ink = (k: number) => (rung.gold ? '#d4af5f' : k === 0 && rung.trim ? '#b9babf' : '#050608');
  const lines = [...Array.from({ length: rung.grooves }, (_, k) => ({ v: top0 - 30 - 34 * k, ink: ink(k) })), ...(rung.trim ? [{ v: SINK + 22, ink: ink(0) }] : [])];
  const skin: MeshStandardMaterial[] = [];
  for (const s of [-1, 1] as const) {
    const map = plateFace({ color: hex, L, top: top0, lines, band: over > 0 ? 8 : 0, text: label, textInk: rung.trim ? '#1b1e26' : '#c7ccd6', flip: s < 0 }), capM = mat(0xffffff, { map, metalness: rung.metal, roughness: rung.rough });
    skin.push(capM);
    spreader.add(place(new Mesh(standing(plateShape(top0, u0, u1, look === 'low' ? 14 : 30), t, s < 0 ? cx - x0 - t : cx + x0, ys, 1.5), capM)));
  }
  if (look === 'low') {
    // the spring clips over the top edge that hold the two plates
    spreader.add(fuse([0.3, 0.7].map((f) => rectBox({ x: cx - x0 - t, y: -(ys + L * f) - 10, w: 2 * (x0 + t), h: 20 }, Z0 + PCB_H - 8, Z0 + PCB_H + 4, sideM)), sideM));
  }
  if (over > 0) {
    // the light bar on the plates: one frosted diffuser that glows with the fans. It rises with the tier (`over`)
    // (smoked: unlit, the bar reads as dark acrylic, not a pale block)
    const bar = glowMat(0xffffff, 0x2c303b);
    bar.roughness = 0.85;
    spreader.add(seeThrough(softBox({ x: cx - x0 - t + 6, y: -(ys + u1 - 26), w: 2 * (x0 + t) - 12, h: u1 - u0 - 52 }, Z0 + top0 - 2, Z0 + PCB_H + over, bar, 10)));
    spins.push(light(bar, undefined, 0.8));
  }
  root.add(spreader);
  return { root, spreader, hit: hitBox(r, visual), spins, skin, mapFaces, dies: dieFrames, plan };
}

/**
 * A label flat on a face of the stick (`side`: the face toward +x or -x), centred at (x, y, z), `w` along the stick and `h` up it, the text
 * reading along the stick from that side: a white sticker with a bar code (a bare stick's), or the model printed in pale ink on a spreader.
 */
function faceLabel(text: string, sticker: boolean, x: number, y: number, z: number, side: 1 | -1, w: number, h: number): Mesh {
  const W = 512, H = Math.max(32, Math.round((W * h) / w));
  const t = tex(`ram-label-${sticker}-${text}-${H}`, W, H, (c) => {
    // the maker's lockup (`brands/kaiju.ts`) at the left, the model after it in the maker's face
    const model = (ink: string, mh: number, y: number, x0: number) => {
      const px = Math.round(mh * 0.5), lw = lockupWidth('kaiju', mh), room = W * 0.95 - x0 - lw - mh * 0.5;
      drawLockup(c, 'kaiju', x0, y, mh, ink);
      c.fillStyle = ink; c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = `500 ${px}px ${BRAND_FONT}`;
      c.fillText(text.toUpperCase(), x0 + lw + mh * 0.5, y + 1, Math.max(room, 1));
    };
    if (sticker) {
      c.fillStyle = '#e9ecef'; c.fillRect(0, 0, W, H);
      model('#1b1e26', H * 0.3, H * 0.28, W * 0.05);
      c.fillStyle = '#1b1e26';
      for (let k = 0, x = W * 0.05; x < W * 0.7; k++) { const b = 2 + ((k * 7) % 5); c.fillRect(x, H * 0.55, b, H * 0.32); x += b + 3 + ((k * 3) % 4); }
    } else {
      c.clearRect(0, 0, W, H);
      model('#b6bcc8', H * 0.64, H / 2, W * 0.06);
    }
  });
  const m = new Mesh(new PlaneGeometry(w, h), mat(0xffffff, { map: t, transparent: !sticker, roughness: sticker ? 0.7 : 0.5 }));
  // the plane's right along the stick (+y seen from the east, -y from the west), its up away from the board, its face toward `side`
  m.geometry.applyMatrix4(side > 0 ? new Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1) : new Matrix4().set(0, 0, -1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  m.position.set(x, y, z);
  return place(m);
}

/** The unseen box a click hits: the whole 2D rect, up to the stick's top. */
function hitBox(r: RectLike, visual: string): Mesh {
  return unseen(rectBox(r, BOARD_Z, stickTop(visual), mat(0, { transparent: true, opacity: 0, depthWrite: false })));
}
