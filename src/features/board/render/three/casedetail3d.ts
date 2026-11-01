// The working details of the 3D cases (case3d.ts): what a real case has round its box, by kind. The rear wall with its openings (the expansion
// slot row behind its retention bar and thumbscrews, the exhaust fan behind a honeycomb grille, or the Mini's punched grille), the board's I/O
// shield with its ports where the plugs go in, the front's intake (mesh or hex over the front fans, the Micro's side gaps, the Mini's grille),
// the top controls (the power button and the status lights of each kind, the front ports), and the tray's cable management (cut-outs, grommets
// and tie points). Airflow reads from outside: in at the front and under the PSU, out at the rear fan and the top.
import { BoxGeometry, CircleGeometry, CylinderGeometry, Group, Mesh, TorusGeometry, Vector2, type Material, type MeshStandardMaterial } from 'three';
import { instanced, place, post, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import type { BoardFeatures } from '@/features/board/sim/specs';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { frontFanRects } from '@/features/room/render/desk/props/case';
import type { CaseKind } from '@/features/room/render/shell/casedecor';
import { geoOf, IO_PORTS } from '../layout/boardlayout';
import { BR, CASE, CASE_BD, LAYOUT_CASE, NIC_BRACKET_X, PSU, REAR_FAN, REAR_FAN_FITTED, WALL_T } from '../layout/layout';
import { HINGE_Z, STAND } from './card3d';
import { FAN_MAX, FAN_ZC } from './cooler3d';
import { brushed, decalX, FRONT, NONE, outlinePts, perforated, perfMat, ring, shapeOf, slab, tiled, wallX, type Span } from './casekit3d';
import { TRAY_Z } from './wires3d';
import { glowMat, light, type Spin } from './fans3d';

/** What the details need of the case: its kind, its body's material, its accent, and the cavity's height (layout y) and depth. */
export interface Frame { kind: CaseKind; body: Material; acc: number; yTop: number; yBot: number; z0: number; z1: number }

const black = () => mat(0x050608, { roughness: 0.85 });
const steel = () => mat(0x8e949c, { metalness: 0.75, roughness: 0.38 });
/** A cylinder whose axis is world x (a thumbscrew in the rear wall, a jack): centred on the world point, `len` long. */
export function drumX(x: number, y: number, z: number, r: number, len: number, m: Material, sides = 16): Mesh {
  const o = new Mesh(new CylinderGeometry(r, r, len, sides).rotateZ(Math.PI / 2), m);
  o.position.set(x, y, z);
  return place(o);
}
/** A box from world corner values (x0..x1, y0..y1 world y up, z0..z1). */
function boxW(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: Material): Mesh {
  const o = new Mesh(new BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
  o.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return place(o);
}

/** The y of the case's slot `i` (the biggest board it holds sets the row; every tier's rails sit at the same heights). */
const slotY = (i: number) => geoOf(LAYOUT_CASE).pcie[i]!.y + 30;
const SLOT_Z = [BOARD_Z + 130, HINGE_Z + STAND.gpu - 40] as const;

/** The rear fan's opening: a round hole in the rear wall round the fan (layout y and depth). */
function rearFanHole(): Span & { d: number; cy: number } {
  const d = Math.min(REAR_FAN.h, FAN_MAX) * 0.92, cy = REAR_FAN.y + REAR_FAN.h / 2;
  return { y0: cy - d / 2, y1: cy + d / 2, z0: FAN_ZC - d / 2, z1: FAN_ZC + d / 2, r: d / 2, d, cy };
}

/**
 * The rear wall (west): a sheet with the slot row cut out (each opening shows a card's bracket or a vented cover), the exhaust fan's round
 * opening behind a honeycomb grille (the Mini: a punched grille, no fan), the retention bar with a thumbscrew per slot. `boardSlots`: the slots
 * the fitted board has (the case's other openings get a blank cover).
 */
export function rearWall(f: Frame, boardSlots: number): Group {
  const g = new Group(), x0 = CASE.x, x1 = CASE.x + WALL_T, slots = geoOf(LAYOUT_CASE).pcie.length;
  const holes: Span[] = Array.from({ length: slots }, (_, i) => ({ y0: slotY(i) - 30, y1: slotY(i) + 520, z0: SLOT_Z[0], z1: SLOT_Z[1], r: 10 }));
  const fan = REAR_FAN_FITTED ? rearFanHole() : null;
  if (fan) holes.push(fan);
  g.add(wallX(x0, x1, { y0: f.yTop, y1: f.yBot, z0: f.z0, z1: f.z1 }, holes, f.body));
  // the slots the board lacks: blank covers behind their openings
  const cover = mat(0xa0a6ae, { metalness: 0.55, roughness: 0.4 });
  for (let i = boardSlots; i < slots; i++) g.add(rectBox({ x: NIC_BRACKET_X, y: slotY(i) - 60, w: 24, h: 600 }, SLOT_Z[0] - 50, SLOT_Z[1] + 40, cover));
  // the retention bar along the slot row, a thumbscrew per slot
  if (slots) {
    const ya = slotY(0) - 90, yb = slotY(slots - 1) + 560;
    g.add(boxW(x0 - 14, x0, -yb, -ya, BOARD_Z + 30, SLOT_Z[0] - 4, f.body));
    const knurl = steel();
    for (let i = 0; i < slots; i++) g.add(drumX(x0 - 30, -(slotY(i) + 30), (BOARD_Z + 30 + SLOT_Z[0]) / 2, 30, 34, knurl, 18));
  }
  if (fan) {
    // a honeycomb grille over the fan, four screws round it
    const grille = new Mesh(new CircleGeometry(fan.d / 2 + 6, 48), perfMat('hex', fan.d, fan.d, 64, kindTone(f.kind), { metal: 0.5, rough: 0.45 }));
    grille.rotation.y = -Math.PI / 2;
    grille.position.set(x0 - 2, -fan.cy, FAN_ZC);
    g.add(grille);
    const sc = steel(), o = fan.d * 0.43;
    for (const [dy, dz] of [[-o, -o], [-o, o], [o, -o], [o, o]] as const) g.add(drumX(x0 - 6, -(fan.cy + dy), FAN_ZC + dz, 22, 12, sc, 12));
  } else {
    // the Mini: a punched exhaust grille where a bigger case has its fan
    const s: Span = { y0: REAR_FAN.y + 20, y1: REAR_FAN.y + REAR_FAN.h - 20, z0: FAN_ZC - 900, z1: FAN_ZC + 900 };
    g.add(decalX(x0 - 1, s, -1, black()), decalX(x0 - 3, s, -1, perfMat('round', s.z1 - s.z0, s.y1 - s.y0, 50, kindTone(f.kind), { metal: 0.05, rough: 0.6 })));
  }
  return g;
}

/** The sheet's tone of each kind, for its grilles and meshes. */
const kindTone = (k: CaseKind) => ({ oem: 0xcfc6a3, matte: 0x1c1d22, gamer: 0x262c3c, show: 0x5a5f69 })[k];

/** The span of the front fans (layout y), and the depth their opening needs. */
function frontSpan(): Span {
  const rs = frontFanRects(), y0 = Math.min(...rs.map((r) => r.y)), y1 = Math.max(...rs.map((r) => r.y + r.h)), d = Math.min(...rs.map((r) => Math.min(r.h, FAN_MAX))) * 0.92;
  return { y0: y0 - 20, y1: y1 + 20, z0: FAN_ZC - d / 2 - 50, z1: FAN_ZC + d / 2 + 50, r: 40 };
}

/**
 * The front wall (east) and its intake: the gaming case is mesh from top to bottom over an opening in front of its fans, between two light bars;
 * the showcase has a hex mesh in a silver frame; the Micro's solid front stands off the body with a perforated gap down each side; the Mini's
 * plastic front (case3d.ts) carries its own grille.
 */
export function frontWall(f: Frame, spins: Spin[], ex: number): Group {
  const g = new Group(), x0 = ex - 160, s: Span = { y0: f.yTop, y1: f.yBot, z0: f.z0, z1: f.z1 }, mesh = f.kind === 'gamer' || f.kind === 'show';
  const hole = frontSpan();
  g.add(wallX(x0, ex, s, mesh ? [hole] : [], f.body));
  if (f.kind === 'gamer') {
    const face: Span = { y0: f.yTop - 200, y1: f.yBot + 60, z0: f.z0 + 140, z1: f.z1 - 140 };
    g.add(decalX(ex + 3, face, 1, perfMat('mesh', face.z1 - face.z0, face.y1 - face.y0, 34, 0x2a3042, { metal: 0.5, rough: 0.45 })));
    for (const z of [f.z0 + 70, f.z1 - 70]) {
      const m = glowMat(0x7a5cff, 0x15171d);
      g.add(seeThrough(boxW(ex - 4, ex + 14, -(f.yBot - 100), -(f.yTop + 60), z - 26, z + 26, m)));
      spins.push(light(m));
    }
  } else if (f.kind === 'show') {
    const silver = mat(0xa7adb6, { map: tiled(brushed(), 4, 1), metalness: 0.6, roughness: 0.32 }), face: Span = { y0: f.yTop - 120, y1: f.yBot, z0: f.z0 + 160, z1: f.z1 - 160 };
    const frame = wallX(ex, ex + 30, { ...face, y0: face.y0 - 60, y1: face.y1 + 60, z0: face.z0 - 80, z1: face.z1 + 80 }, [{ ...face, r: 30 }], silver, 6);
    g.add(frame, decalX(ex + 8, face, 1, perfMat('hex', face.z1 - face.z0, face.y1 - face.y0, 52, 0x4a4f58, { metal: 0.6, rough: 0.4 })));
  } else if (f.kind === 'matte') {
    // the front plate stands off the body; the air comes in through a perforated gap down each side
    g.add(softBox({ x: ex + 30, y: f.yTop - 300, w: 40, h: f.yBot + 110 - (f.yTop - 300) }, f.z0 + 190, f.z1 - 190, f.body, 14));
    for (const z of [f.z0 + 190, f.z1 - 190]) g.add(boxW(ex, ex + 30, -(f.yBot + 60), -(f.yTop - 240), z - 12, z + 12, black())); // the stand-off brackets' shadow line
    for (const [za, zb] of [[f.z0 + 30, f.z0 + 180], [f.z1 - 180, f.z1 - 30]] as const) {
      const sp: Span = { y0: f.yTop - 200, y1: f.yBot, z0: za, z1: zb };
      g.add(decalX(ex + 1, sp, 1, black()), decalX(ex + 3, sp, 1, perfMat('slot', zb - za, sp.y1 - sp.y0, 44, 0x3a3d45, { metal: 0.2, rough: 0.7 })));
    }
  }
  return g;
}

/** The PSU's intake under the case: a slide-out dust filter whose tab shows at the front edge of the floor (the plain cases breathe through the side). */
export function psuFilter(f: Frame, ex: number, bottom: number): Group {
  const g = new Group();
  if (f.kind !== 'gamer' && f.kind !== 'show') return g;
  g.add(rectBox({ x: ex - 260, y: bottom - 6, w: 300, h: 30 }, f.z0 + 400, f.z1 - 400, mat(0x101216, { roughness: 0.6 })));
  g.add(rectBox({ x: ex + 30, y: bottom - 2, w: 24, h: 22 }, f.z0 + 1200, f.z1 - 1200, mat(0x2a2e38, { roughness: 0.5 })));
  return g;
}

// ---------------------------------------------------------------- the rear I/O shield

const JACK: Record<string, number> = { 'line-out': 0x8fd14f, 'line-in': 0x5aa9e6, mic: 0xf08cb0 };

/**
 * The board's I/O shield on the outside of the rear wall, with the ports the board has where their plugs go in (`room3d.ts` and `machine3d.ts`
 * aim the LAN lead, the video cable and a key at these): three audio jacks, the network jack with its lights, HDMI and DisplayPort, the USB ports.
 */
export function ioShield(feat: BoardFeatures, kind: CaseKind): Group {
  const g = tag(new Group(), 'io'), io = BR.io, x = CASE.x, dark = kind === 'gamer' || kind === 'show';
  g.add(rectBox({ x: x - 8, y: io.y - 40, w: 8, h: io.h + 80 }, BOARD_Z + 60, BOARD_Z + 1240, mat(dark ? 0x17191f : 0xa3a9b1, { metalness: 0.7, roughness: 0.4, ...(dark ? {} : { map: tiled(brushed(), 1, 3) }) })));
  const hole = black(), shell = steel(), blue = mat(0x2a6fdc, { roughness: 0.5 });
  for (const p of IO_PORTS) {
    const cy = -(p.y + p.h / 2);
    if (p.kind === 'jack') {
      g.add(drumX(x - 12, cy, BOARD_Z + 300, 30, 8, mat(JACK[p.id] ?? 0x999999, { roughness: 0.5 })), drumX(x - 14, cy, BOARD_Z + 300, 17, 8, hole));
    } else if (p.kind === 'rj45') {
      if (feat.ethernetMbps <= 0) continue;
      g.add(boxW(x - 20, x - 8, cy - 62, cy + 62, BOARD_Z + 220, BOARD_Z + 380, shell), boxW(x - 24, x - 18, cy - 50, cy + 46, BOARD_Z + 232, BOARD_Z + 368, hole));
      for (const [dz, c] of [[-60, 0x58e08a], [60, 0xffb547]] as const) g.add(boxW(x - 22, x - 18, cy + 44, cy + 58, BOARD_Z + 300 + dz - 10, BOARD_Z + 300 + dz + 10, mat(0x111111, { emissive: c, emissiveIntensity: 0.8 })));
    } else if (p.kind === 'hdmi' || p.kind === 'dp') {
      if (p.kind === 'dp' && feat.displayPorts < 2) continue;
      g.add(boxW(x - 16, x - 8, cy - 58, cy + 58, BOARD_Z + 488, BOARD_Z + 552, shell), boxW(x - 20, x - 14, cy - 50, cy + 50, BOARD_Z + 496, BOARD_Z + 544, hole));
    } else if (p.kind === 'usb') {
      if (Number(p.id.slice(3)) >= feat.usbPorts) continue;
      g.add(boxW(x - 16, x - 8, cy - 56, cy + 56, BOARD_Z + 572, BOARD_Z + 628, shell), boxW(x - 20, x - 14, cy - 48, cy + 48, BOARD_Z + 578, BOARD_Z + 622, hole), boxW(x - 22, x - 18, cy - 40, cy + 40, BOARD_Z + 600, BOARD_Z + 612, blue));
    }
  }
  return g;
}

// ---------------------------------------------------------------- the controls on the top

export interface Controls { root: Group; power: Group; leds: { on: MeshStandardMaterial; err: MeshStandardMaterial; disk: MeshStandardMaterial }; spins: Spin[] }
type Port = 'usbA' | 'usbC' | 'audio' | 'button';
const PORTS: Record<CaseKind, Port[]> = { oem: ['usbA', 'usbA', 'audio', 'audio'], matte: ['usbA', 'usbA', 'audio'], gamer: ['usbC', 'usbA', 'usbA', 'audio', 'button'], show: ['usbC', 'usbC', 'usbA', 'usbA', 'audio', 'audio'] };
const pip = (c: number) => mat(0x0c0c0e, { emissive: c, emissiveIntensity: 0, roughness: 0.3 });

/**
 * The power button, the status lights and the front ports of each kind. The Mini: a square beige button and two lamps on top of its plastic
 * front, the ports and a reset button on its face. The others carry a top I/O panel by the front edge: the Micro a flush round button in a white
 * light ring, the Mid a hexagonal button in an RGB ring and a light-mode button, the Full tower a machined aluminium knob in a pink ring.
 * The `on` light is the ring (or the Mini's green lamp), `err` a red pip, `disk` the drive light.
 */
export function controls(f: Frame, ex: number, cap: number): Controls {
  const root = new Group(), power = tag(new Group(), 'power'), spins: Spin[] = [], k = f.kind, zb = FRONT - 650, top = CASE.y;
  const on = pip(k === 'oem' ? 0x5cff9a : k === 'matte' ? 0xe8f0ff : f.acc), err = pip(0xff4a5a), disk = pip(k === 'oem' ? 0xffb547 : 0xe8f0ff);
  if (k === 'oem') {
    const bx = ex - 60, ty = top - 8, beige = mat(0xd9d0b0, { roughness: 0.55 });
    power.add(softBox({ x: bx - 95, y: ty - 34, w: 190, h: 34 }, zb - 95, zb + 95, beige, 14), rectBox({ x: bx - 60, y: ty - 36, w: 120, h: 3 }, zb - 6, zb + 6, mat(0x8a8468, { roughness: 0.8 })));
    root.add(power, seeThrough(rectBox({ x: bx - 30, y: ty - 10, w: 60, h: 10 }, zb - 300, zb - 220, on)), seeThrough(rectBox({ x: bx - 30, y: ty - 10, w: 60, h: 10 }, zb - 420, zb - 340, disk)));
    root.add(seeThrough(rectBox({ x: bx - 20, y: ty - 8, w: 40, h: 8 }, zb - 520, zb - 470, err)));
    // the face: a reset button, two USB ports and the audio jacks under the bay covers
    const face = ex + 50, y0 = top + 1650, zc = (f.z0 + f.z1) / 2;
    root.add(boxW(face, face + 14, -(y0 + 40), -(y0 - 40), zc + 500, zc + 580, mat(0xb9b092, { roughness: 0.6 })));
    [-330, -170].forEach((dz) => root.add(boxW(face, face + 8, -(y0 + 56), -(y0 - 56), zc + dz - 28, zc + dz + 28, steel()), boxW(face + 6, face + 10, -(y0 + 46), -(y0 - 46), zc + dz - 20, zc + dz + 20, black())));
    [40, 160].forEach((dz, i) => root.add(drumX(face + 6, -y0, zc + dz, 30, 10, mat(i ? 0xf08cb0 : 0x8fd14f, { roughness: 0.5 })), drumX(face + 10, -y0, zc + dz, 17, 6, black())));
    return { root, power, leds: { on, err, disk }, spins };
  }
  // the top I/O panel by the front edge (the gaming case's sits behind its mesh cap)
  const ix = ex - (k === 'gamer' ? cap + 260 : 520), z0 = FRONT - 2050, z1 = FRONT - 360, py = top - 14;
  const plateM = k === 'show' ? mat(0xa7adb6, { map: tiled(brushed(), 1, 6), metalness: 0.6, roughness: 0.32 }) : mat(k === 'gamer' ? 0x101420 : 0x0c0d10, { roughness: 0.55, metalness: 0.2 });
  root.add(softBox({ x: ix - 140, y: py, w: 280, h: 16 }, z0, z1, plateM, 6));
  if (k === 'gamer') { const line = glowMat(f.acc, 0x15121f); root.add(seeThrough(rectBox({ x: ix + 118, y: py - 2, w: 8, h: 4 }, z0 + 40, z1 - 40, line))); spins.push(light(line, f.acc, 1.6)); }
  // the button and its light ring
  if (k === 'matte') {
    power.add(post(ix, py, zb, 100, 14, mat(0x1a1b20, { roughness: 0.7 }), 40));
  } else if (k === 'gamer') {
    power.add(post(ix, py, zb, 120, 34, mat(0x1d2232, { metalness: 0.6, roughness: 0.35 }), 6));
    power.add(post(ix, py - 34, zb, 70, 6, mat(0x2c3346, { metalness: 0.6, roughness: 0.3 }), 6));
  } else {
    const alu = mat(0xb9bec6, { map: tiled(brushed(), 2, 1), metalness: 0.8, roughness: 0.28 });
    power.add(post(ix, py, zb, 128, 22, mat(0x8a9099, { metalness: 0.8, roughness: 0.4 }), 64), post(ix, py - 22, zb, 118, 26, alu, 64));
  }
  const ringR = k === 'show' ? 142 : k === 'gamer' ? 136 : 112, ringM = new Mesh(new TorusGeometry(ringR, k === 'gamer' ? 9 : 7, 8, k === 'gamer' ? 6 : 48), on);
  ringM.rotation.x = Math.PI / 2;
  if (k === 'gamer') ringM.rotation.z = Math.PI / 6;
  ringM.position.set(ix, -py + 4, zb);
  root.add(power, seeThrough(ringM));
  root.add(seeThrough(post(ix, py, zb - 230, 16, 6, err, 12)), seeThrough(post(ix, py, zb - 300, 16, 6, disk, 12)));
  // the ports, front to back
  let z = zb - 430;
  for (const p of PORTS[k]) {
    if (p === 'usbA') {
      root.add(rectBox({ x: ix - 34, y: py - 4, w: 68, h: 4 }, z - 70, z + 70, steel()), rectBox({ x: ix - 26, y: py - 6, w: 52, h: 3 }, z - 62, z + 62, black()), rectBox({ x: ix - 9, y: py - 8, w: 18, h: 3 }, z - 52, z + 52, mat(0x2a6fdc, { roughness: 0.5 })));
      z -= 190;
    } else if (p === 'usbC') {
      root.add(softBox({ x: ix - 24, y: py - 4, w: 48, h: 4 }, z - 56, z + 56, steel(), 2), softBox({ x: ix - 16, y: py - 6, w: 32, h: 3 }, z - 48, z + 48, black(), 1));
      z -= 160;
    } else if (p === 'audio') {
      root.add(post(ix, py, z, 32, 3, steel(), 20), post(ix, py - 3, z, 18, 3, black(), 16));
      z -= 130;
    } else {
      root.add(post(ix, py, z, 40, 10, mat(0x2a2f3c, { roughness: 0.5 }), 20));
      z -= 130;
    }
  }
  return { root, power, leds: { on, err, disk }, spins };
}

// ---------------------------------------------------------------- the tray: cable management

/** How each kind finishes a cable hole in the tray: a rolled steel lip (the Mini), black rubber, or a brushed aluminium ring (the Full tower). */
export type GrommetStyle = { tone: number; metal: boolean };
export const GROMMETS: Record<CaseKind, GrommetStyle> = { oem: { tone: 0xbdb491, metal: false }, matte: { tone: 0x101114, metal: false }, gamer: { tone: 0x14171f, metal: false }, show: { tone: 0x9aa0a8, metal: true } };

/**
 * The tray's cable management between the board and the front fans: a column of tie points for the straps, and the routing cut-outs of the kind
 * (the Micro's one rubber-rimmed slot, the Mid's slanted cut-outs, the Full tower's rimmed slots on a hex-perforated tray; the Mini has bare tie
 * points only).
 */
export function trayDetail(f: Frame): Group {
  const g = new Group(), east = CASE_BD.x + CASE_BD.w, bd = CASE_BD, rim = mat(GROMMETS[f.kind].tone, GROMMETS[f.kind].metal ? { metalness: 0.75, roughness: 0.3 } : { roughness: 0.75 });
  const pts = [];
  for (let y = bd.y + 500; y < bd.y + bd.h - 300; y += 900) pts.push({ x: east + 480, y: -y, z: TRAY_Z + 12, rz: 0 });
  const loop = new TorusGeometry(34, 9, 6, 12, Math.PI);
  g.add(instanced(loop, mat(0x6d727b, { metalness: 0.7, roughness: 0.4 }), pts));
  const hole = black();
  const cut = (r: RectLike, rad: number) => { g.add(ring(r, rad, NONE, 26, TRAY_Z - 4, TRAY_Z + 18, rim)); g.add(seeThrough(slab(shapeOf(outlinePts(r, rad)), TRAY_Z - 6, TRAY_Z + 2, hole))); };
  const x = east + 820;
  if (f.kind === 'matte') cut({ x, y: bd.y + 500, w: 220, h: bd.h * 0.5 }, 100);
  if (f.kind === 'gamer') {
    for (let k = 0; k < 3; k++) {
      const y = bd.y + 400 + k * (bd.h * 0.27), h = bd.h * 0.2, lean = 120;
      const q = [[x + lean, y], [x + lean + 220, y], [x + 220, y + h], [x, y + h]].map(([a, b]) => new Vector2(a!, -b!));
      const qo = [[x + lean - 26, y - 26], [x + lean + 246, y - 26], [x + 246, y + h + 26], [x - 26, y + h + 26]].map(([a, b]) => new Vector2(a!, -b!));
      g.add(slab(shapeOf(qo, [q]), TRAY_Z - 4, TRAY_Z + 18, rim), seeThrough(slab(shapeOf(q), TRAY_Z - 6, TRAY_Z + 2, hole)));
    }
  }
  if (f.kind === 'show') {
    for (let k = 0; k < 3; k++) cut({ x, y: bd.y + 400 + k * (bd.h * 0.3), w: 240, h: bd.h * 0.22 }, 60);
    perforated(g, { x: CASE.x + WALL_T + 40, y: f.yTop + 40, w: x - 120 - (CASE.x + WALL_T + 40), h: PSU.y - 60 - (f.yTop + 40) }, TRAY_Z + 1, 'hex', 90, 0x22252c, { metal: 0.5, rough: 0.5 });
  }
  return g;
}

/** Two hinge barrels on the front edge of a glass door (the Mid and the Full tower). */
export function hinges(ex: number, yTop: number, yBot: number): Group {
  const g = new Group(), m = mat(0x2b2f38, { metalness: 0.7, roughness: 0.35 });
  for (const y of [yTop + 500, yBot - 900]) { const o = place(new Mesh(new CylinderGeometry(24, 24, 320, 16), m)); o.position.set(ex + 6, -y, FRONT - 6); g.add(o); }
  return g;
}

