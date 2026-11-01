// The memory sticks in 3D as real DIMMs (docs/GRAPHICS_3D_OVERHAUL.md "Inside the case"). The 2D draws a stick flat, its face seen from above;
// here it stands in its socket: the gold fingers down in the groove, the chips on both faces, a latch clipped into the notch at each end. The
// look follows the generation (`stickLook`): a bare green stick (SDR and the server ECC sticks), a low clip-on spreader (DDR2), a finned spreader
// (DDR3), a spreader under a frosted RGB bar (DDR4, DDR5). Up close the spreaders fade to the chips (`DEVICE_LOD.ram`) and the camera leans to
// see the faces in a row (`RAM_LEAN`, board3d.ts). The chips sit where the 2D chips are along the stick, so the live memory map can land on them.
import { BoxGeometry, Color, ExtrudeGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Shape, type BufferGeometry, type MeshStandardMaterial, type Texture } from 'three';
import { instanced, paint, place, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough } from '@/core/render/three/pick';
import type { Theme } from '@/core/render/theme';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { DIMM_H, DIMM_W } from '../layout/layout';
import { ramAccent, ramNotch } from '../devices';
import { glowMat, light, type Spin } from './fans3d';

/** The socket: a narrow housing along the stick, `SLOT_H` high; the stick's fingers sink `SINK` into its groove. */
export const SLOT_W = 76, SLOT_H = 110;
const TOP = BOARD_Z + SLOT_H, SINK = 40, Z0 = TOP - SINK;
/** The stick: the PCB's thickness and height (fingers to top edge), a chip's thickness, the gap at each end of the socket (the latches' hooks). */
const PCB_T = 10, PCB_H = 200, CHIP_T = 8, END = 8;
/** The latch: how high it stands over the board, the notch its hook takes in the stick's end (height over the PCB's bottom edge, radius). */
const LATCH_Z = TOP + 72, NOTCH_V = 98, NOTCH_R = 14;
/** The camera's lean (radians of yaw) to read the stick faces in a row, and the zoom band it comes in over (board3d.ts). */
export const RAM_LEAN = 0.72;

export type StickLook = 'bare' | 'low' | 'fins' | 'rgb';
export const stickLook = (visual: string): StickLook =>
  visual === 'dimm-fast' ? 'low' : visual === 'dimm-ddr3' ? 'fins' : visual === 'dimm-lowlat' || visual === 'dimm-ddr5' ? 'rgb' : 'bare';

/** How high a stick of this look reaches over the board (its spreader or light bar included). */
export const stickTop = (look: StickLook): number => Z0 + (look === 'rgb' ? 256 : look === 'fins' ? 232 : PCB_H);

/** A shape drawn in the stick's plane (u along it, v up from the PCB's bottom edge), extruded `t` thick, turned to stand at `x` (its near face) from its south end `y`. */
function standing(s: Shape, t: number, x: number, y: number, bevel = 0): BufferGeometry {
  const g = new ExtrudeGeometry(s, { depth: t, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 10 });
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
  const s = new Shape(), v0 = 54;
  if (look === 'low') {
    const v1 = PCB_H - 6, r = 14;
    s.moveTo(u0, v0).lineTo(u1, v0).lineTo(u1, v1 - r).quadraticCurveTo(u1, v1, u1 - r, v1).lineTo(u0 + r, v1).quadraticCurveTo(u0, v1, u0, v1 - r).closePath();
  } else if (look === 'fins') {
    // the crown: teeth along the top edge, the gaps between them reaching down past the PCB's edge
    const v1 = 232, gap = 200, n = Math.floor((u1 - u0) / 46), w = (u1 - u0) / n;
    s.moveTo(u0, v0).lineTo(u1, v0).lineTo(u1, v1);
    for (let k = n - 1; k >= 0; k--) { const a = u0 + k * w; s.lineTo(a + w * 0.62, v1).lineTo(a + w * 0.62, gap).lineTo(a + w * 0.22, gap).lineTo(a + w * 0.22, v1).lineTo(a, v1); }
    s.closePath();
  } else {
    // a chamfered plate, a step down at its middle third where the accent stripe runs
    const v1 = 212, c = 34;
    s.moveTo(u0, v0).lineTo(u1, v0).lineTo(u1, v1 - c).lineTo(u1 - c, v1).lineTo(u0 + c, v1).lineTo(u0, v1 - c).closePath();
  }
  return s;
}

// ------------------------------------------------------------------ painted faces
const pcbTex = new Map<string, Texture | null>();
let chipTex: Texture | null | undefined;

/** The PCB's face: the solder mask with faint traces up from the fingers, the gold fingers along the bottom edge with the key's gap. */
function pcbFace(color: string, L: number, notchU: number): Texture | null {
  const key = `${color}|${notchU}`;
  if (pcbTex.has(key)) return pcbTex.get(key)!;
  const W = 1024, H = Math.round((W * PCB_H) / L), py = (v: number) => H - (v / PCB_H) * H, px = (u: number) => (u / L) * W;
  const t = paint(W, H, (c) => {
    c.fillStyle = color; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 2;
    for (let u = 16; u < L - 16; u += 11) { if (Math.abs(u - notchU) < 12) continue; c.beginPath(); c.moveTo(px(u), py(48)); c.lineTo(px(u), py(62 + ((u * 7) % 23))); c.stroke(); }
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, py(52), W, 3);
    c.fillStyle = '#d4af5f';
    for (let u = 12; u < L - 12; u += 11) if (Math.abs(u - notchU) > 12) c.fillRect(px(u), py(SINK + 3), px(7), py(4) - py(SINK + 3));
  });
  if (t) t.repeat.set(1 / L, 1 / PCB_H);
  pcbTex.set(key, t);
  return t;
}

/** A DRAM chip's face: black epoxy, the pin-1 dot, a faint laser-etched mark. */
function chipFace(): Texture | null {
  if (chipTex !== undefined) return chipTex;
  return chipTex = paint(128, 128, (c, w, h) => {
    c.fillStyle = '#16171c'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.14)'; c.beginPath(); c.arc(w * 0.16, h * 0.16, 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(200,210,230,0.12)';
    for (const [y, f] of [[0.42, 0.62], [0.56, 0.48], [0.7, 0.36]] as const) c.fillRect(w * 0.2, h * y, w * f, h * 0.07);
  });
}

// ------------------------------------------------------------------ the socket
/** A memory socket over its 2D rect: the housing with its groove, the gold contacts down in it, the key, and a latch at each end (open when empty). */
export function dimmSlot(r: RectLike, empty: boolean): { housing: Group; latches: Group } {
  const cx = r.x + r.w / 2, housing = new Group(), latches = new Group();
  const body = mat(0x1a1d24, { roughness: 0.55 }), dark = mat(0x07080b, { roughness: 0.8 }), gold = mat(0xd9b25e, { metalness: 1, roughness: 0.25 });
  housing.add(softBox({ x: cx - SLOT_W / 2, y: r.y, w: SLOT_W, h: r.h }, BOARD_Z, TOP, body, 10));
  housing.add(rectBox({ x: cx - 9, y: r.y + 18, w: 18, h: r.h - 36 }, TOP - 30, TOP + 1, dark));
  for (const s of [-1, 1]) housing.add(rectBox({ x: cx + s * 7 - 2, y: r.y + 24, w: 4, h: r.h - 48 }, TOP - 24, TOP - 6, gold));
  housing.add(rectBox({ x: cx - 9, y: r.y + r.h * 0.42, w: 18, h: 12 }, TOP - 30, TOP - 2, body));
  // the latches: a lever on a pivot at each end of the housing, its hook over the stick's end notch when closed
  const latchM = mat(0x2c3242, { roughness: 0.5 }), open = empty ? 0.5 : 0;
  for (const end of [-1, 1] as const) {
    const pivot = new Group(), hy = end < 0 ? r.y : r.y + r.h;
    pivot.position.set(cx, -hy, BOARD_Z);
    pivot.rotation.x = end * open;
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
  /** The four data chips' faces toward the leaning camera (east), in the 2D chips' order: the live memory map is painted on them (`RamMap3D`). */
  mapFaces: Mesh[];
  spins: Spin[];
  /** The materials that follow the part's state (`PartSkin`). */
  skin: MeshStandardMaterial[];
}

/** One stick standing in the socket over `r` (row 1 sticks are `flip`ped, their data end north, as in 2D). */
export function ramStick(T: Theme, visual: string, ecc: boolean, r: RectLike, flip: boolean): Stick {
  const look = stickLook(visual), accent = new Color(ramAccent(T, visual)), cx = r.x + r.w / 2;
  const L = r.h - 2 * END, ys = -(r.y + r.h - END), root = new Group(), spreader = new Group(), spins: Spin[] = [];
  /** A 2D stick y (0 at its north end, DIMM_H long, before the flip) as a world y. */
  const wy = (y: number) => -(r.y + (flip ? DIMM_H - y : y));
  const notchU = (L * (22 + ramNotch(visual) * 5.4)) / DIMM_W;
  // the PCB: green on the bare sticks (the server sticks too), the 2D stick's navy under a spreader
  const green = look === 'bare', pcbColor = green ? '#1d5a3c' : '#1a2448';
  const edge = mat(green ? 0x174a32 : 0x141c38, { roughness: 0.5 });
  const face = mat(0xffffff, { map: pcbFace(pcbColor, L, flip ? L - notchU : notchU), roughness: 0.45, metalness: 0.1 });
  root.add(place(new Mesh(standing(pcbShape(L, flip ? L - notchU : notchU), PCB_T, cx - PCB_T / 2, ys), [face, edge])));
  // the chips on both faces, where the 2D chips are along the stick; an ECC stick has its narrow parity chip, every stick its SPD, a DDR5 its PMIC
  const chips: { y: number; h: number; z0: number; z1: number }[] = [];
  for (let j = 0; j < 4; j++) chips.push({ y: 84 + j * 128, h: 112, z0: TOP + 24, z1: TOP + 132 });
  if (ecc) chips.push({ y: 592, h: 40, z0: TOP + 24, z1: TOP + 132 });
  if (visual === 'dimm-ddr5' || visual === 'dimm-ddr5ecc') chips.push({ y: ecc ? 640 : 600, h: ecc ? 32 : 46, z0: TOP + 82, z1: TOP + 124 });
  chips.push({ y: ecc ? 640 : 652, h: 22, z0: TOP + 30, z1: TOP + 52 });
  const top = mat(0xffffff, { map: chipFace(), roughness: 0.55 }), side = mat(0x101115, { roughness: 0.6 });
  const items = chips.flatMap((c) => [-1, 1].map((s) => ({ x: cx + s * (PCB_T + CHIP_T) / 2, y: (wy(c.y) + wy(c.y + c.h)) / 2, z: (c.z0 + c.z1) / 2, sx: CHIP_T, sy: c.h, sz: c.z1 - c.z0 })));
  root.add(instanced(new BoxGeometry(1, 1, 1), [top, top, side, side, side, side] as unknown as MeshStandardMaterial, items));
  // the map faces: a plane just off each data chip's east face, hidden until the map is painted and the camera is close
  const mapFaces = chips.slice(0, 4).map((c) => {
    const f = new Mesh(new PlaneGeometry(c.z1 - c.z0 - 8, c.h - 8).rotateY(Math.PI / 2), new MeshBasicMaterial({ transparent: true, toneMapped: false }));
    f.position.set(cx + PCB_T / 2 + CHIP_T + 0.6, (wy(c.y) + wy(c.y + c.h)) / 2, (c.z0 + c.z1) / 2);
    f.visible = false;
    root.add(f);
    return f;
  });
  // a row of passives between the fingers and the chips, on both faces
  const caps = [];
  for (let u = 30; u < L - 30; u += 27) for (const s of [-1, 1]) caps.push({ x: cx + s * (PCB_T / 2 + 2), y: ys + u, z: TOP + 11, sx: 4, sy: 12, sz: 7 });
  root.add(instanced(new BoxGeometry(1, 1, 1), mat(0x8c6c4c, { roughness: 0.55 }), caps));
  if (look === 'bare') return { root, spreader, hit: hitBox(r, look), spins, skin: [edge], mapFaces };
  // the spreader: a plate over each face, held off the chips; its look by generation
  const t = look === 'low' ? 6 : look === 'fins' ? 10 : 12, x0 = PCB_T / 2 + CHIP_T + 1, u0 = 18, u1 = L - 18;
  const plateM = look === 'low' ? mat(new Color(0xaab2c0).lerp(accent, 0.35).getHex(), { metalness: 0.8, roughness: 0.32 })
    : mat(look === 'fins' ? 0x242a3c : 0x2a2f3b, { metalness: 0.75, roughness: 0.3 });
  for (const s of [-1, 1]) spreader.add(place(new Mesh(standing(plateShape(look, u0, u1), t, s < 0 ? cx - x0 - t : cx + x0, ys, 1.5), plateM)));
  const stripe = mat(accent.getHex(), { roughness: 0.35, metalness: 0.4 });
  if (look === 'low') {
    // the spring clips over the top edge that hold the two plates
    for (const f of [0.3, 0.7]) spreader.add(rectBox({ x: cx - x0 - t, y: -(ys + L * f) - 10, w: 2 * (x0 + t), h: 20 }, Z0 + PCB_H - 8, Z0 + PCB_H + 4, plateM));
  } else if (look === 'fins') {
    // an accent line along each plate, under the crown
    for (const s of [-1, 1]) spreader.add(rectBox({ x: s < 0 ? cx - x0 - t - 2 : cx + x0 + t, y: -(ys + u1 - 30), w: 2, h: u1 - u0 - 60 }, Z0 + 170, Z0 + 180, stripe));
  } else {
    // the light bar: a dark cap across the plates, a frosted diffuser on it that glows with the fans; an accent line down each plate
    spreader.add(softBox({ x: cx - x0 - t, y: -(ys + u1 - 20), w: 2 * (x0 + t), h: u1 - u0 - 40 }, Z0 + 204, Z0 + 218, mat(0x15171d, { roughness: 0.5 }), 4));
    const bar = glowMat(0xffffff, 0x4a4f5e);
    bar.roughness = 0.85;
    spreader.add(seeThrough(softBox({ x: cx - x0 - t + 3, y: -(ys + u1 - 26), w: 2 * (x0 + t) - 6, h: u1 - u0 - 52 }, Z0 + 216, Z0 + 256, bar, 10)));
    spins.push(light(bar, undefined, 0.8));
    for (const s of [-1, 1]) spreader.add(rectBox({ x: s < 0 ? cx - x0 - t - 2 : cx + x0 + t, y: -(ys + L * 0.66), w: 2, h: L * 0.32 }, Z0 + 120, Z0 + 186, stripe));
  }
  root.add(spreader);
  return { root, spreader, hit: hitBox(r, look), spins, skin: [plateM], mapFaces };
}

/** The unseen box a click hits: the whole 2D rect, up to the stick's top. */
function hitBox(r: RectLike, look: StickLook): Mesh {
  const o = rectBox(r, BOARD_Z, stickTop(look), mat(0, { transparent: true, opacity: 0, depthWrite: false }));
  o.castShadow = o.receiveShadow = false;
  return o;
}
