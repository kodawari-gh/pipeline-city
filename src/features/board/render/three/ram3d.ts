// The memory sticks in 3D as real DIMMs (docs/GRAPHICS_3D_OVERHAUL.md "Inside the case"). The 2D draws a stick flat, its face seen from above;
// here it stands in its socket: the gold fingers down in the groove, the chips on both faces, a latch clipped into the notch at each end. The
// look follows the generation (`stickLook`): a bare green stick (SDR and the server ECC sticks), a low clip-on spreader (DDR2), a finned spreader
// (DDR3), a spreader under a frosted RGB bar (DDR4, DDR5). Up close the spreaders fade to the chips (`DEVICE_LOD.ram`) and the camera leans to
// see the faces in a row (`RAM_LEAN`, board3d.ts). The chips sit where the 2D chips are along the stick, so the live memory map can land on them.
import { BoxGeometry, ExtrudeGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Shape, type BufferGeometry, type MeshStandardMaterial, type Texture } from 'three';
import { instanced, paint, place, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough } from '@/core/render/three/pick';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { DIMM_H } from '../layout/layout';
import { ramChips, ramNotch } from '../devices';
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
/** The camera's lean (radians of yaw) to read the stick faces in a row, and the zoom band it comes in over (board3d.ts). */
export const RAM_LEAN = 0.72;

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
  const key = `${color}|${notchU}|${pins}`;
  if (pcbTex.has(key)) return pcbTex.get(key)!;
  const W = 1536, H = Math.round((W * PCB_H) / L), py = (v: number) => H - (v / PCB_H) * H, px = (u: number) => (u / L) * W;
  // (the fingers fill the edge but for a 3 mm margin at each end and the key's gap)
  const m = 3 * STICK_MM, pitch = (L - 2 * m - 24) / pins;
  const t = paint(W, H, (c) => {
    c.fillStyle = color; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 2;
    for (let u = m; u < L - m; u += pitch) { if (Math.abs(u - notchU) < 12) continue; c.beginPath(); c.moveTo(px(u + pitch / 2), py(SINK + 8)); c.lineTo(px(u + pitch / 2), py(SINK + 22 + ((Math.round(u) * 7) % 23))); c.stroke(); }
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, py(SINK + 12), W, 3);
    c.fillStyle = '#d4af5f';
    for (let k = 0, u = m; k < pins; k++, u += pitch) { if (Math.abs(u + pitch / 2 - notchU) < 12) u += 24; c.fillRect(px(u + pitch * 0.18), py(SINK + 3), px(pitch * 0.64), py(4) - py(SINK + 3)); }
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
export function dimmSlot(r: RectLike, empty: boolean, tone = 0x1a1d24, latchTone = 0x2c3242): { housing: Group; latches: Group } {
  const cx = r.x + r.w / 2, housing = new Group(), latches = new Group();
  const body = mat(tone, { roughness: 0.55 }), dark = mat(0x07080b, { roughness: 0.8 }), gold = mat(0xd9b25e, { metalness: 1, roughness: 0.25 });
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
  /** The data chips' faces toward the leaning camera (east), in the 2D chips' order: the live memory map is painted on them (`RamMap3D`). */
  mapFaces: Mesh[];
  spins: Spin[];
  /** The materials that follow the part's state (`PartSkin`). */
  skin: MeshStandardMaterial[];
}

/** One stick standing in the socket over `r`, `label` (its model) printed on its spreader or on a sticker over its chips. */
export function ramStick(visual: string, ecc: boolean, r: RectLike, label = ''): Stick {
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
  const top = mat(0xffffff, { map: chipFace(), roughness: 0.55 }), side = mat(0x101115, { roughness: 0.6 });
  const items = chips.flatMap((c) => [-1, 1].map((s) => ({ x: cx + s * (PCB_T + CHIP_T) / 2, y: (wy(c.y) + wy(c.y + c.h)) / 2, z: (c.z0 + c.z1) / 2, sx: CHIP_T, sy: c.h, sz: c.z1 - c.z0 })));
  root.add(instanced(new BoxGeometry(1, 1, 1), [top, top, side, side, side, side] as unknown as MeshStandardMaterial, items));
  // the map faces: a plane just off each data chip's east face, hidden until the map is painted and the camera is close
  const mapFaces = chips.slice(0, d.length).map((c) => {
    const f = new Mesh(new PlaneGeometry(c.z1 - c.z0 - 8, c.h - 8).rotateY(Math.PI / 2), new MeshBasicMaterial({ transparent: true, toneMapped: false }));
    f.position.set(cx + PCB_T / 2 + CHIP_T + 0.6, (wy(c.y) + wy(c.y + c.h)) / 2, (c.z0 + c.z1) / 2);
    f.visible = false;
    root.add(f);
    return f;
  });
  // a row of passives between the fingers and the chips, on both faces
  const caps = [];
  for (let u = 30; u < L - 30; u += 27) for (const s of [-1, 1]) caps.push({ x: cx + s * (PCB_T / 2 + 5), y: ys + u, z: TOP + 14, sx: 10, sy: 16, sz: 8 });
  root.add(instanced(new BoxGeometry(1, 1, 1), mat(0x8c6c4c, { roughness: 0.55 }), caps));
  if (look === 'bare') {
    // the maker's sticker across the first group of chips on the west face (the live map lands on the east)
    if (label) root.add(faceLabel(label, true, cx - PCB_T / 2 - CHIP_T - 2.5, wy((d[0]!.y + d[3]!.y + d[3]!.h) / 2), Z0 + (CHIP_Z0 + CHIP_Z1) / 2, -1, Math.min(760, d[3]!.y + d[3]!.h - d[0]!.y - 40), CHIP_Z1 - CHIP_Z0 - 30));
    return { root, spreader, hit: hitBox(r, look), spins, skin: [edge], mapFaces };
  }
  // the spreader: a plate over each face, on a thermal pad over the chips. No tier colours: the tiers read by how premium the metal looks,
  // stamped steel (DDR2), dark anodised fins (DDR3), matte black under a light bar (DDR4), brushed dark titanium with a diamond-cut edge (DDR5)
  const t = look === 'low' ? 14 : look === 'fins' ? 30 : 32, x0 = PCB_T / 2 + CHIP_T + PAD, u0 = 18, u1 = L - 18, best = visual === 'dimm-ddr5';
  const plateM = look === 'low' ? mat(0x8d939c, { metalness: 0.55, roughness: 0.5 })
    : look === 'fins' ? mat(0x2b2f37, { metalness: 0.6, roughness: 0.45 })
    : best ? mat(0x3a404b, { metalness: 0.85, roughness: 0.3 }) : mat(0x22262e, { metalness: 0.5, roughness: 0.55 });
  for (const s of [-1, 1]) spreader.add(place(new Mesh(standing(plateShape(look, u0, u1), t, s < 0 ? cx - x0 - t : cx + x0, ys, 1.5), plateM)));
  // polished trim: a thin bright line, the one sign of a better stick
  const trim = mat(0xc4c9d1, { metalness: 0.95, roughness: best ? 0.12 : 0.22 });
  if (look === 'low') {
    // the spring clips over the top edge that hold the two plates
    for (const f of [0.3, 0.7]) spreader.add(rectBox({ x: cx - x0 - t, y: -(ys + L * f) - 10, w: 2 * (x0 + t), h: 20 }, Z0 + PCB_H - 8, Z0 + PCB_H + 4, plateM));
  } else if (look === 'fins') {
    // a polished line along each plate, under the crown
    for (const s of [-1, 1]) spreader.add(rectBox({ x: s < 0 ? cx - x0 - t - 2 : cx + x0 + t, y: -(ys + u1 - 30), w: 2, h: u1 - u0 - 60 }, Z0 + PCB_H - 30, Z0 + PCB_H - 22, trim));
  } else {
    // the light bar: a dark cap across the plates, a frosted diffuser on it that glows with the fans; an accent line down each plate
    const cap = Z0 + PCB_H + RGB_PLATE - 8;
    spreader.add(softBox({ x: cx - x0 - t, y: -(ys + u1 - 20), w: 2 * (x0 + t), h: u1 - u0 - 40 }, cap, cap + 16, mat(0x15171d, { roughness: 0.5 }), 4));
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
  return { root, spreader, hit: hitBox(r, look), spins, skin: [plateM], mapFaces };
}

/**
 * A label flat on a face of the stick (`side`: the face toward +x or -x), centred at (x, y, z), `w` along the stick and `h` up it, the text
 * reading along the stick from that side: a white sticker with a bar code (a bare stick's), or the model printed in pale ink on a spreader.
 */
function faceLabel(text: string, sticker: boolean, x: number, y: number, z: number, side: 1 | -1, w: number, h: number): Mesh {
  const W = 512, H = Math.max(32, Math.round((W * h) / w));
  const t = tex(`ram-label-${sticker}-${text}-${H}`, W, H, (c) => {
    if (sticker) {
      c.fillStyle = '#e9ecef'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#1b1e26'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = `700 ${Math.round(H * 0.34)}px system-ui, sans-serif`;
      c.fillText(text.toUpperCase(), W * 0.05, H * 0.3);
      for (let k = 0, x = W * 0.05; x < W * 0.7; k++) { const b = 2 + ((k * 7) % 5); c.fillRect(x, H * 0.55, b, H * 0.32); x += b + 3 + ((k * 3) % 4); }
    } else {
      c.clearRect(0, 0, W, H);
      c.fillStyle = 'rgba(214,220,234,0.78)'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `600 ${Math.round(H * 0.62)}px system-ui, sans-serif`;
      c.fillText(text.toUpperCase(), W / 2, H / 2 + 1);
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
  const o = rectBox(r, BOARD_Z, stickTop(look), mat(0, { transparent: true, opacity: 0, depthWrite: false }));
  o.castShadow = o.receiveShadow = false;
  return o;
}
