// The memory sticks in 3D as real DIMMs (docs/render/three.md). The 2D draws a stick flat, its face seen from above;
// here it stands in its socket: the gold fingers down in the groove, the chips on both faces, a latch clipped into the notch at each end. The
// look follows the generation (`stickLook`): a bare green stick (SDR and the server ECC sticks), a low clip-on spreader (DDR2), a finned spreader
// (DDR3), a spreader under a frosted RGB bar (DDR4, DDR5). Up close the spreaders fade to the chips (`DEVICE_LOD.ram`); the camera never turns by itself, so the
// faces are read by turning the view, or from the angled view a double click flies to (`RAM_FACE_YAW`). The chips sit where the 2D chips are along the stick, so the live memory map can land on them.
import { BoxGeometry, ExtrudeGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Shape, Vector3, type BufferGeometry, type MeshStandardMaterial, type Texture } from 'three';
import { BRAND_FONT, drawLockup, lockupWidth } from '@/core/render/brands';
import { instanced, paint, paintLow, place, rectBox, SEG, shareTex, softBox, type RectLike } from '@/core/render/three/geometry';
import { DEVICE_LOD, smooth } from '@/core/render/lod/lod';
import { FINISH, fadeTree } from '@/core/render/three/artlod';
import { sheetCut } from '@/core/render/three/detail';
import { CERAMIC, mat } from '@/core/render/three/materials';
import { seeThrough, unseen } from '@/core/render/three/pick';
import type { Theme } from '@/core/render/theme';
import { ramDieArt, ramDiePlan, type RamDiePlan, type RamDieSpec } from '@/features/memory/render/ramdie';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { DIMM_H } from '../layout/layout';
import { ramChips, ramNotch } from '../devices';
import { LV_DIE, type ArtSet } from './artset3d';
import { tex } from './casekit3d';
import { glowMat, light, type Spin } from './fans3d';

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
/** How far a spreader reaches over the PCB's top edge (real sticks: a finned DDR3 37 mm, an RGB DDR4 or DDR5 44 mm, to the PCB's 31.25). */
const OVER = { bare: 0, low: 0, fins: Math.round(6 * STICK_MM), rgb: Math.round(12.75 * STICK_MM) } as const;
/** The yaw and the pitch (radians) of the view a double click on the sticks flies to, to read their faces in a row (the faces look east; from above, the eye clears the drive cages). */
export const RAM_FACE_YAW = 0.5, RAM_FACE_PITCH = 0.35;
/** The depth over the board (layout units) the view of the sticks' faces is aimed at: about the middle of their chips (a stick's chips stand 320 to 500 over its socket). */
export const RAM_FACE_AT = 450;
/** The zoom band (screen pixels per unit) the spreaders fade over and the chips' dies come in over: the part's own chips show once its cover is gone. */
export const RAM_FADE = [DEVICE_LOD.ram.show * 1.5, DEVICE_LOD.ram.show * 2.1] as const;

export type StickLook = 'bare' | 'low' | 'fins' | 'rgb';
export const stickLook = (visual: string): StickLook =>
  visual === 'dimm-fast' ? 'low' : visual === 'dimm-ddr3' ? 'fins' : visual === 'dimm-lowlat' || visual === 'dimm-ddr5' ? 'rgb' : 'bare';

/** How high a stick of this look reaches over the board (its spreader or light bar included). */
export const stickTop = (look: StickLook): number => Z0 + PCB_H + OVER[look];

/** The PCB's bottom edge over the board, and its height: a stick's real proportions are checked against them. */
export const STICK = { z0: Z0, h: PCB_H, t: PCB_T + 2 * CHIP_T } as const;

/** An RGB stick's plates reach this far over the PCB; its light bar's dark cap sits on them, the frosted bar on the cap to `OVER.rgb`. */
const RGB_PLATE = 70;

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

/** A spreader plate's outline over u0..u1: low and flat, crowned with fins, or cut with chamfers under a light bar. */
function plateShape(look: StickLook, u0: number, u1: number): Shape {
  // (from just over the socket's top)
  const s = new Shape(), v0 = SINK + 14;
  if (look === 'low') {
    const v1 = PCB_H - 6, r = 14;
    s.moveTo(u0, v0).lineTo(u1, v0).lineTo(u1, v1 - r).quadraticCurveTo(u1, v1, u1 - r, v1).lineTo(u0 + r, v1).quadraticCurveTo(u0, v1, u0, v1 - r).closePath();
  } else if (look === 'fins') {
    // the crown: teeth along the top edge, the gaps between them reaching down to the PCB's edge
    const v1 = PCB_H + OVER.fins, gap = PCB_H, n = Math.floor((u1 - u0) / 64), w = (u1 - u0) / n;
    s.moveTo(u0, v0).lineTo(u1, v0).lineTo(u1, v1);
    for (let k = n - 1; k >= 0; k--) { const a = u0 + k * w; s.lineTo(a + w * 0.62, v1).lineTo(a + w * 0.62, gap).lineTo(a + w * 0.22, gap).lineTo(a + w * 0.22, v1).lineTo(a, v1); }
    s.closePath();
  } else {
    // a chamfered plate up to the light bar's cap
    const v1 = PCB_H + RGB_PLATE, c = 34;
    s.moveTo(u0, v0).lineTo(u1, v0).lineTo(u1, v1 - c).lineTo(u1 - c, v1).lineTo(u0 + c, v1).lineTo(u0, v1 - c).closePath();
  }
  return s;
}

// ------------------------------------------------------------------ painted faces
const pcbTex = new Map<string, Texture | null>();
let chipTex: Texture | null | undefined;

/** The gold fingers on each face by generation: an SDR stick has 168 pins, a DDR2 or DDR3 240, a DDR4 or DDR5 288 (half on each face). */
export const stickPins = (visual: string): number => (visual === 'dimm-basic' ? 84 : visual === 'dimm-fast' || visual === 'dimm-ddr3' ? 120 : 144);

/** The PCB's face: the solder mask with faint traces up from the fingers, the gold fingers (`pins` of them) along the bottom edge with the key's gap. */
function pcbFace(color: string, L: number, notchU: number, pins: number): Texture | null {
  const W = 1536, H = Math.round((W * PCB_H) / L), py = (v: number) => H - (v / PCB_H) * H, px = (u: number) => (u / L) * W;
  const key = `${color}|${notchU}|${pins}|${sheetCut(W, H)}`; // (the sheet is half size at Low: its own entry)
  if (pcbTex.has(key)) return pcbTex.get(key)!;
  // (the fingers fill the edge but for a 3 mm margin at each end and the key's gap)
  const m = 3 * STICK_MM, pitch = (L - 2 * m - 24) / pins;
  const t = paintLow(W, H, (c) => {
    c.fillStyle = color; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 2;
    for (let u = m; u < L - m; u += pitch) { if (Math.abs(u - notchU) < 12) continue; c.beginPath(); c.moveTo(px(u + pitch / 2), py(SINK + 8)); c.lineTo(px(u + pitch / 2), py(SINK + 22 + ((Math.round(u) * 7) % 23))); c.stroke(); }
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, py(SINK + 12), W, 3);
    c.fillStyle = '#d4af5f';
    for (let k = 0, u = m; k < pins; k++, u += pitch) { if (Math.abs(u + pitch / 2 - notchU) < 12) u += 24; c.fillRect(px(u + pitch * 0.18), py(SINK + 3), px(pitch * 0.64), py(4) - py(SINK + 3)); }
  });
  if (t) t.repeat.set(1 / L, 1 / PCB_H);
  pcbTex.set(key, shareTex(t));
  return t;
}

/** A DRAM chip's face: black epoxy, the pin-1 dot, a faint laser-etched mark. */
function chipFace(): Texture | null {
  if (chipTex !== undefined) return chipTex;
  return chipTex = shareTex(paint(128, 128, (c, w, h) => {
    c.fillStyle = '#16171c'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.14)'; c.beginPath(); c.arc(w * 0.16, h * 0.16, 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(200,210,230,0.12)';
    for (const [y, f] of [[0.42, 0.62], [0.56, 0.48], [0.7, 0.36]] as const) c.fillRect(w * 0.2, h * y, w * f, h * 0.07);
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

/** How far a stick has shown its dies at `zoom` (screen pixels per unit): 0 to 1 over `RAM_FADE`. */
export const dieShown = (zoom: number): number => smooth(RAM_FADE[0], RAM_FADE[1], zoom);

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
  const face = mat(0xffffff, { map: pcbFace(pcbColor, L, notchU, stickPins(visual)), roughness: 0.45, metalness: 0.1 });
  root.add(place(new Mesh(standing(pcbShape(L, notchU), PCB_T, cx - PCB_T / 2, ys), [face, edge])));
  // the chips on both faces, where the 2D chips are along the stick (`ramChips`); in the gap between the two groups an ECC stick has its parity
  // chip, a DDR5 its PMIC, every stick its SPD
  const Zc0 = Z0 + CHIP_Z0, Zc1 = Z0 + CHIP_Z1;
  const chips: { y: number; h: number; z0: number; z1: number }[] = ramChips().map((c) => ({ y: c.y, h: c.h, z0: Zc0, z1: Zc1 }));
  const d = ramChips(), gy = (d[3]!.y + d[3]!.h + d[4]!.y) / 2;
  if (ecc) chips.push({ y: gy - 70, h: 140, z0: Zc0, z1: Zc1 });
  if (visual === 'dimm-ddr5' || visual === 'dimm-ddr5ecc') chips.push({ y: gy + (ecc ? 80 : -23), h: 46, z0: Zc0 - 120, z1: Zc0 - 70 });
  chips.push({ y: gy - 11, h: 22, z0: Zc0 - 170, z1: Zc0 - 140 });
  const top = mat(0xffffff, { map: chipFace(), roughness: 0.55 }), side = mat(0x131518, { roughness: 0.6 });
  const items = chips.flatMap((c) => [-1, 1].map((s) => ({ x: cx + s * (PCB_T + CHIP_T) / 2, y: (wy(c.y) + wy(c.y + c.h)) / 2, z: (c.z0 + c.z1) / 2, sx: CHIP_T, sy: c.h, sz: c.z1 - c.z0 })));
  // (two draws, not six: the box's two x faces are one group for the printed top, its four other faces one group for the sides)
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
  // a row of passives between the fingers and the chips, on both faces
  const caps = [];
  for (let u = 30; u < L - 30; u += 27) for (const s of [-1, 1]) caps.push({ x: cx + s * (PCB_T / 2 + 5), y: ys + u, z: TOP + 14, sx: 10, sy: 16, sz: 8 });
  root.add(instanced(new BoxGeometry(1, 1, 1), mat(CERAMIC, { roughness: 0.55 }), caps));
  if (look === 'bare') {
    // the maker's sticker across the first group of chips on the west face: it goes with the spreaders, over the chips' dies (the live map lands on the east)
    if (label) spreader.add(faceLabel(label, true, cx - PCB_T / 2 - CHIP_T - 2.5, wy((d[0]!.y + d[3]!.y + d[3]!.h) / 2), Z0 + (CHIP_Z0 + CHIP_Z1) / 2, -1, Math.min(760, d[3]!.y + d[3]!.h - d[0]!.y - 40), CHIP_Z1 - CHIP_Z0 - 30));
    root.add(spreader);
    return { root, spreader, hit: hitBox(r, look), spins, skin: [edge], mapFaces, dies: dieFrames, plan };
  }
  // the spreader: a plate over each face, on a thermal pad over the chips. No tier colours: the tiers read by how premium the metal looks,
  // stamped steel (DDR2), dark anodised fins (DDR3), matte black under a light bar (DDR4), brushed dark titanium with a diamond-cut edge (DDR5)
  const t = look === 'low' ? 14 : look === 'fins' ? 30 : 32, x0 = PCB_T / 2 + CHIP_T + PAD, u0 = 18, u1 = L - 18, best = visual === 'dimm-ddr5';
  const plateM = look === 'low' ? mat(0x4e5360, { metalness: 0.6, roughness: 0.45 }) // (a dark anodised clip-on, art-style §4)
    : look === 'fins' ? mat(0x2a2d32, { metalness: 0.6, roughness: 0.45 })
    : best ? mat(0x2a2d32, { metalness: 0.85, roughness: 0.3 }) : mat(0x2a2d32, { metalness: 0.5, roughness: 0.55 });
  for (const s of [-1, 1]) spreader.add(place(new Mesh(standing(plateShape(look, u0, u1), t, s < 0 ? cx - x0 - t : cx + x0, ys, 1.5), plateM)));
  // polished trim: a thin bright line, the one sign of a better stick
  const trim = mat(0xb9babf, { metalness: 0.95, roughness: best ? 0.12 : 0.22 });
  if (look === 'low') {
    // the spring clips over the top edge that hold the two plates
    for (const f of [0.3, 0.7]) spreader.add(rectBox({ x: cx - x0 - t, y: -(ys + L * f) - 10, w: 2 * (x0 + t), h: 20 }, Z0 + PCB_H - 8, Z0 + PCB_H + 4, plateM));
  } else if (look === 'fins') {
    // a polished line along each plate, under the crown
    for (const s of [-1, 1]) spreader.add(rectBox({ x: s < 0 ? cx - x0 - t - 2 : cx + x0 + t, y: -(ys + u1 - 30), w: 2, h: u1 - u0 - 60 }, Z0 + PCB_H - 30, Z0 + PCB_H - 22, trim));
  } else {
    // the light bar: a dark cap across the plates, a frosted diffuser on it that glows with the fans; an accent line down each plate
    const cap = Z0 + PCB_H + RGB_PLATE - 8;
    spreader.add(softBox({ x: cx - x0 - t, y: -(ys + u1 - 20), w: 2 * (x0 + t), h: u1 - u0 - 40 }, cap, cap + 16, mat(0x131518, { roughness: 0.5 }), 4));
    // (smoked: unlit, the bar reads as dark acrylic, not a pale block)
    const bar = glowMat(0xffffff, 0x2c303b);
    bar.roughness = 0.85;
    spreader.add(seeThrough(softBox({ x: cx - x0 - t + 6, y: -(ys + u1 - 26), w: 2 * (x0 + t) - 12, h: u1 - u0 - 52 }, cap + 14, Z0 + PCB_H + OVER.rgb, bar, 14)));
    spins.push(light(bar, undefined, 0.8));
    if (best) {
      // the diamond-cut edge: a bright chamfer along the top of each plate, under the cap
      for (const s of [-1, 1]) spreader.add(rectBox({ x: s < 0 ? cx - x0 - t - 2 : cx + x0 + t, y: -(ys + u1 - 22), w: 2, h: u1 - u0 - 44 }, cap - 30, cap - 4, trim));
    } else {
      // a thin silver pinstripe down each plate
      for (const s of [-1, 1]) spreader.add(rectBox({ x: s < 0 ? cx - x0 - t - 2 : cx + x0 + t, y: -(ys + L * 0.66), w: 2, h: L * 0.32 }, Z0 + PCB_H - 44, Z0 + PCB_H - 38, trim));
    }
  }
  // the model printed on each plate, toward the stick's south end (clear of the accent line; 3 proud, or the far gallery camera loses it in the plate)
  if (label) for (const s of [-1, 1] as const) spreader.add(faceLabel(label, false, cx + s * (x0 + t + 3), ys + L * 0.3, Z0 + (SINK + 14 + PCB_H) / 2, s, Math.min(760, L * 0.34), 110));
  root.add(spreader);
  return { root, spreader, hit: hitBox(r, look), spins, skin: [plateM], mapFaces, dies: dieFrames, plan };
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
function hitBox(r: RectLike, look: StickLook): Mesh {
  return unseen(rectBox(r, BOARD_Z, stickTop(look), mat(0, { transparent: true, opacity: 0, depthWrite: false })));
}
