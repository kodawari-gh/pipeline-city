// The working details of the 3D cases (case3d.ts): what a real case has round its box, by kind. The rear wall with its openings (the expansion
// slot row behind its retention bar and thumbscrews, the exhaust fan behind a honeycomb grille, or the Mini's punched grille), the board's I/O
// shield with its ports where the plugs go in, the front's intake (mesh or hex over the front fans, the Micro's side gaps, the Mini's grille),
// the top controls (the power button and the status lights of each kind, the front ports), and the tray's cable management (cut-outs, grommets
// and tie points). Airflow reads from outside: in at the front and under the PSU, out at the rear fan and the top.
import { BoxGeometry, CircleGeometry, CylinderGeometry, Group, Mesh, PlaneGeometry, TorusGeometry, Vector2, type Material, type MeshStandardMaterial } from 'three';
import { instanced, place, post, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import type { BoardFeatures } from '@/features/board/sim/specs';
import { BOARD_Z, FAN_MAX, FAN_ZC, REAR_ZC } from '@/features/room/render/three/roomplan';
import { frontFanRects, standoffs } from '@/features/room/render/desk/props/case';
import type { CaseKind } from '@/features/room/render/shell/casedecor';
import { geoOf, IO_PORTS } from '../layout/boardlayout';
import { BR, CASE, CASE_BD, GEO, LAYOUT_CASE, NIC_BRACKET_X, PSU, REAR_FAN, REAR_FAN_FITTED, WALL_T } from '../layout/layout';
import { basementPlan, psuFanX, PSU_FAN_R, psuOpening } from './basement3d';
import { HINGE_Z, slotBlank, STAND } from './card3d';
import { brushed, decalX, FRONT, NONE, outlinePts, perforated, perfMat, ring, shapeOf, slab, tex, tiled, wallCircle, wallPt, wallX, type Span } from './casekit3d';
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

/** The rear exhaust's round opening in the rear wall, on every case (layout y and depth). */
function rearFanHole(): { d: number; cy: number } {
  return { d: Math.min(REAR_FAN.h, FAN_MAX) * 0.92, cy: REAR_FAN.y + REAR_FAN.h / 2 };
}

/**
 * The rear wall (west): a sheet with its openings cut out. The slot row (each opening shows a card's bracket or a vented cover), the I/O plate's
 * opening, the power supply's (its rear stands in it, `psuUnit`), the exhaust's round opening behind a honeycomb grille (the Mini: a punched
 * grille, no fan), the retention bar with a thumbscrew per slot. `boardSlots`: the slots the fitted board has (the case's other openings get a blank cover).
 */
export function rearWall(f: Frame, boardSlots: number): Group {
  const g = new Group(), x0 = CASE.x, x1 = CASE.x + WALL_T, slots = geoOf(LAYOUT_CASE).pcie.length, p = plateSpan(), u = basementPlan().psu;
  const holes: (Span | Vector2[])[] = Array.from({ length: slots }, (_, i) => ({ y0: slotY(i) - 30, y1: slotY(i) + 520, z0: SLOT_Z[0], z1: SLOT_Z[1], r: 10 }));
  holes.push({ y0: p.y0 + 20, y1: p.y1 - 20, z0: p.z0 + 20, z1: p.z1 - 20 }, psuOpening(u));
  const fan = rearFanHole();
  holes.push(wallCircle(fan.cy, REAR_ZC, fan.d / 2));
  g.add(wallX(x0, x1, { y0: f.yTop, y1: f.yBot, z0: f.z0, z1: f.z1 }, holes, f.body));
  // the slots the board lacks: blank covers behind their openings (the board's own empty slots get theirs in machine3d.ts)
  for (let i = boardSlots; i < slots; i++) g.add(slotBlank(slotY(i), SLOT_BLANK[f.kind]));
  // the retention bar over the far ends of the openings, where the brackets' folds are (away from the board, as a card's top edge is), a
  // thumbscrew per slot through it
  if (slots) {
    const ya = slotY(0) - 90, yb = slotY(slots - 1) + 560, za = SLOT_Z[1] - 24, zb = SLOT_Z[1] + 110;
    g.add(boxW(x0 - 14, x0, -yb, -ya, za, zb, f.body));
    const knurl = steel();
    for (let i = 0; i < slots; i++) g.add(drumX(x0 - 30, -(slotY(i) + 30), (za + zb) / 2, 30, 34, knurl, 18));
  }
  // over the round opening: a honeycomb grille and four screws where the case carries a fan, the Mini's punched grille where it has none
  const grille = new Mesh(new CircleGeometry(fan.d / 2 + 6, 48), REAR_FAN_FITTED ? perfMat('hex', fan.d, fan.d, 64, kindTone(f.kind), { metal: 0.5, rough: 0.45 }) : perfMat('round', fan.d, fan.d, 50, kindTone(f.kind), { metal: 0.05, rough: 0.6 }));
  grille.rotation.y = -Math.PI / 2;
  grille.position.set(x0 - 2, -fan.cy, REAR_ZC);
  g.add(grille);
  if (REAR_FAN_FITTED) {
    const sc = steel(), o = fan.d * 0.43;
    for (const [dy, dz] of [[-o, -o], [-o, o], [o, -o], [o, o]] as const) g.add(drumX(x0 - 6, -(fan.cy + dy), REAR_ZC + dz, 22, 12, sc, 12));
  }
  return g;
}

/** The sheet's tone of each kind, for its grilles and meshes. */
const kindTone = (k: CaseKind) => ({ oem: 0xcfc6a3, matte: 0x1c1d22, gamer: 0x262c3c, show: 0x5a5f69 })[k];
/** The slot blanks' finish by kind: bare zinc in the Mini, painted to match the body in the others. */
export const SLOT_BLANK: Record<CaseKind, number> = { oem: 0xa3a69f, matte: 0x1c1d22, gamer: 0x232838, show: 0x17181d };

/** The span of the front fans (layout y), and the depth their opening needs. */
function frontSpan(): Span {
  const rs = frontFanRects(), y0 = Math.min(...rs.map((r) => r.y)), y1 = Math.max(...rs.map((r) => r.y + r.h)), d = Math.min(...rs.map((r) => Math.min(r.h, FAN_MAX))) * 0.92;
  return { y0: y0 - 20, y1: y1 + 20, z0: FAN_ZC - d / 2 - 50, z1: FAN_ZC + d / 2 + 50, r: 40 };
}

/**
 * The front wall (east) with an opening in front of the fans on every case, and its intake: the gaming case is mesh from top to bottom between
 * two light bars; the showcase has a hex mesh in a silver frame; the Micro's solid front stands off the body with a perforated gap down each side;
 * the Mini's plastic front (case3d.ts) carries its own grille.
 */
export function frontWall(f: Frame, spins: Spin[], ex: number): Group {
  const g = new Group(), x0 = ex - 160, s: Span = { y0: f.yTop, y1: f.yBot, z0: f.z0, z1: f.z1 };
  g.add(wallX(x0, ex, s, [frontSpan()], f.body));
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

/** The opening in the floor under the power supply's fan (layout x and depth). */
export function psuIntake(): { x0: number; x1: number; z0: number; z1: number } {
  const u = basementPlan().psu, x = psuFanX(u), zc = (u.z0 + u.z1) / 2;
  return { x0: x - PSU_FAN_R - 40, x1: x + PSU_FAN_R + 40, z0: zc - PSU_FAN_R - 40, z1: zc + PSU_FAN_R + 40 };
}

/**
 * Over the floor's opening under the power supply: the Mini's punched plate, the others' slide-out dust filter, a fine mesh in a frame that runs in
 * the floor's thickness back to the rear wall, where its tab shows under the mains inlet.
 */
export function psuFilter(f: Frame, bottom: number): Group {
  const g = new Group(), o = psuIntake(), y = bottom - 40, w = o.x1 - o.x0, d = o.z1 - o.z0;
  const sheet = new Mesh(new PlaneGeometry(w, d), f.kind === 'oem' ? perfMat('round', w, d, 56, kindTone(f.kind), { metal: 0.05, rough: 0.6 }) : perfMat('mesh', w, d, 34, 0x15171b, { metal: 0.02, rough: 0.95 }));
  sheet.rotation.x = Math.PI / 2;
  sheet.position.set((o.x0 + o.x1) / 2, -y, (o.z0 + o.z1) / 2);
  g.add(sheet);
  if (f.kind === 'oem') return g;
  // its frame round the sheet, and the tab at the rear wall
  const frame = mat(0x101216, { roughness: 0.6 }), e = 30;
  for (const [x0, x1, z0, z1] of [[o.x0, o.x1, o.z0, o.z0 + e], [o.x0, o.x1, o.z1 - e, o.z1], [o.x0, o.x0 + e, o.z0, o.z1], [o.x1 - e, o.x1, o.z0, o.z1]] as const) g.add(rectBox({ x: x0, y: y - 10, w: x1 - x0, h: 24 }, z0, z1, frame));
  g.add(rectBox({ x: CASE.x - 26, y: y - 42, w: 26 + 40, h: 42 }, (o.z0 + o.z1) / 2 - 260, (o.z0 + o.z1) / 2 + 260, mat(0x2a2e38, { roughness: 0.5 })));
  return g;
}

// ---------------------------------------------------------------- the rear I/O shield

const JACK: Record<string, number> = { 'line-out': 0x8fd14f, 'line-in': 0x5aa9e6, mic: 0xf08cb0 };

/** The rear I/O plate's extent: layout y (the board's I/O strip and a margin) and depth. */
const plateSpan = (): Span => ({ y0: BR.io.y - 40, y1: BR.io.y + BR.io.h + 40, z0: BOARD_Z + 60, z1: BOARD_Z + 1240 });

/** The USB-A tongue's colour by the board's generation: black USB 2 (Starter, Basic), blue USB 3 (Mainstream), red USB 3.2 (Enthusiast). */
const USB_TONGUE = [0x16171b, 0x16171b, 0x2a6fdc, 0xc8323c];

/**
 * The labels printed on a black shield, laid out as `decalX` lays a face across x (the canvas's x is depth, its y the layout y down): the port
 * names in white beside their mouths.
 */
function shieldPrint(tier: number, feat: BoardFeatures, s: Span) {
  return tex(`io-print-${tier}-${feat.ethernetMbps > 0 ? 1 : 0}-${feat.usbPorts}-${feat.displayPorts}`, 512, 1024, (c, w, h) => {
    const u = (z: number) => ((z - s.z0) / (s.z1 - s.z0)) * w, v = (y: number) => ((y - s.y0) / (s.y1 - s.y0)) * h;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(232,236,242,0.9)'; c.strokeStyle = 'rgba(232,236,242,0.55)'; c.lineWidth = 2;
    c.font = '700 20px system-ui, sans-serif'; c.textBaseline = 'middle';
    const at = (t: string, y: number, z: number) => c.fillText(t, u(z), v(y));
    for (const p of IO_PORTS) {
      const y = p.y;
      if (p.kind === 'jack') at({ 'line-out': 'OUT', 'line-in': 'IN', mic: 'MIC' }[p.id] ?? '', y, BOARD_Z + 350);
      else if (p.kind === 'rj45' && feat.ethernetMbps > 0) at(feat.ethernetMbps >= 2500 ? '2.5G LAN' : 'LAN', y, BOARD_Z + 400);
      else if (p.kind === 'hdmi') at('HDMI', y, BOARD_Z + 570);
      else if (p.kind === 'dp' && feat.displayPorts >= 2) at('DP', y, BOARD_Z + 570);
      else if (p.kind === 'usb' && Number(p.id.slice(3)) < feat.usbPorts) at(tier >= 3 ? 'USB 3.2' : 'USB 3', y, BOARD_Z + 650);
    }
    // a frame line round the port field, as the printed shields carry
    c.beginPath(); c.roundRect(u(BOARD_Z + 190), v(BR.io.y + 20), u(BOARD_Z + 860) - u(BOARD_Z + 190), v(BR.io.y + BR.io.h + 20) - v(BR.io.y + 20), 10); c.stroke();
    if (tier >= 2) { at('BIOS', -1290, BOARD_Z + 380); }
    if (tier >= 3) { at('CLR', -1220, BOARD_Z + 380); at('Wi-Fi', -540, BOARD_Z + 960); at('OPT', -430, BOARD_Z + 330); at('USB-C', -320, BOARD_Z + 640); }
  });
}

/**
 * The board's I/O shield on the outside of the rear wall (the plate that comes with the board), with the ports the board has where their plugs
 * go in (`room3d.ts` and `machine3d.ts` aim the LAN lead, the video cable and a key at these). By the board's tier (skins.ts): a loose stamped
 * steel shield on the Starter and Basic (bare steel, a folded rim, an embossed rim round each opening, EMI fingers over the USB and LAN mouths);
 * an integrated black shield on the better boards, its labels printed in white. The ports as real ones: the audio jacks in their colour rings,
 * the RJ45 with its latch notch, contacts and two lights, HDMI and DP in their keyed shells, USB-A with the tongue's colour by generation. The
 * Mainstream adds a BIOS flashback button; the Enthusiast a clear-CMOS button, a USB-C, an optical out and two Wi-Fi antenna jacks (look only).
 */
export function ioShield(feat: BoardFeatures, tier: number): Group {
  const g = tag(new Group(), 'io'), x = CASE.x, Z = BOARD_Z, s = plateSpan(), stamped = tier <= 1;
  // (stamped sheet is smooth satin steel, not brushed)
  const plateM = stamped ? mat(0xaeb4bc, { metalness: 0.65, roughness: 0.46 }) : mat(0x15171c, { metalness: 0.35, roughness: 0.5 });
  g.add(rectBox({ x: x - 8, y: s.y0, w: 8, h: s.y1 - s.y0 }, s.z0, s.z1, plateM));
  const hole = black(), shell = steel(), gold = mat(0xd9b25e, { metalness: 0.9, roughness: 0.34 });
  /** An embossed rim round an opening on the stamped plate (world y, depth). */
  const rim = (y0: number, y1: number, z0: number, z1: number) => { if (stamped) g.add(boxW(x - 11, x - 8, y0 - 14, y1 + 14, z0 - 14, z1 + 14, plateM)); };
  /** EMI fingers: springy tabs bent out over a mouth's long edges. */
  const fingers = (y0: number, y1: number, z0: number, z1: number) => {
    if (!stamped) return;
    for (const zz of [z0 - 6, z1 + 6]) for (let k = 0; k < 3; k++) { const y = y0 + ((k + 0.5) * (y1 - y0)) / 3; g.add(boxW(x - 15, x - 8, y - 9, y + 9, zz - 3, zz + 3, plateM)); }
  };
  for (const p of IO_PORTS) {
    const cy = -p.y, ly = p.y; // (a port's `y` is its centre, where the plugs aim)
    if (p.kind === 'jack') {
      rim(cy - 34, cy + 34, Z + 266, Z + 334);
      g.add(drumX(x - 12, cy, Z + 300, 30, 8, mat(JACK[p.id] ?? 0x999999, { roughness: 0.5 })), drumX(x - 14, cy, Z + 300, 17, 8, hole), drumX(x - 13, cy, Z + 300, 9, 6, shell));
    } else if (p.kind === 'rj45') {
      if (feat.ethernetMbps <= 0) continue;
      rim(cy - 62, cy + 62, Z + 220, Z + 380);
      g.add(boxW(x - 20, x - 8, cy - 62, cy + 62, Z + 220, Z + 380, shell), boxW(x - 24, x - 18, cy - 50, cy + 46, Z + 232, Z + 368, hole));
      // the latch notch under the mouth, the eight contacts along its top
      g.add(boxW(x - 24, x - 18, cy - 62, cy - 48, Z + 276, Z + 324, hole));
      for (let k = 0; k < 8; k++) g.add(boxW(x - 22, x - 19, cy + 30, cy + 42, Z + 248 + k * 15, Z + 254 + k * 15, gold));
      for (const [dz, c] of [[-60, 0x58e08a], [60, 0xffb547]] as const) g.add(boxW(x - 22, x - 18, cy + 44, cy + 58, Z + 300 + dz - 10, Z + 300 + dz + 10, mat(0x111111, { emissive: c, emissiveIntensity: 0.8 })));
      fingers(cy - 62, cy + 62, Z + 220, Z + 380);
    } else if (p.kind === 'hdmi' || p.kind === 'dp') {
      if (p.kind === 'dp' && feat.displayPorts < 2) continue;
      // the shell and its keyed mouth (HDMI's two corners cut on its inner side, DP's one), the dark inside and the tongue
      const k = 16, z0 = Z + 488, z1 = Z + 552, y0 = ly - 58, y1 = ly + 58, a = y0 + 8, b = y1 - 8, c0 = z0 + 8, c1 = z1 - 8;
      const mouth = p.kind === 'hdmi'
        ? [wallPt(a + k, c0), wallPt(a, c0 + k), wallPt(a, c1), wallPt(b, c1), wallPt(b, c0 + k), wallPt(b - k, c0)]
        : [wallPt(a + k, c0), wallPt(a, c0 + k), wallPt(a, c1), wallPt(b, c1), wallPt(b, c0)];
      rim(cy - 58, cy + 58, z0, z1);
      g.add(wallX(x - 16, x - 8, { y0, y1, z0, z1 }, [mouth], shell));
      g.add(boxW(x - 12, x - 8, cy - 50, cy + 50, c0, c1, hole));
      g.add(boxW(x - 15, x - 10, cy - 40, cy + 40, Z + 514, Z + 526, mat(0x16171b, { roughness: 0.5 })));
    } else if (p.kind === 'usb') {
      if (Number(p.id.slice(3)) >= feat.usbPorts) continue;
      rim(cy - 56, cy + 56, Z + 572, Z + 628);
      g.add(boxW(x - 16, x - 8, cy - 56, cy + 56, Z + 572, Z + 628, shell), boxW(x - 20, x - 14, cy - 48, cy + 48, Z + 578, Z + 622, hole));
      g.add(boxW(x - 22, x - 18, cy - 40, cy + 40, Z + 600, Z + 612, mat(USB_TONGUE[tier] ?? 0x2a6fdc, { roughness: 0.5 })));
      for (let k = 0; k < 4; k++) g.add(boxW(x - 23, x - 19, cy - 30 + k * 20 - 4, cy - 30 + k * 20 + 4, Z + 597, Z + 600, gold));
      fingers(cy - 56, cy + 56, Z + 572, Z + 628);
    }
  }
  if (stamped) legacyPorts(g, tier, plateM);
  if (stamped) {
    // the folded rim round the stamped plate
    for (const [y0, y1, z0, z1] of [[s.y0, s.y1, s.z0, s.z0 + 14], [s.y0, s.y1, s.z1 - 14, s.z1], [s.y0, s.y0 + 14, s.z0, s.z1], [s.y1 - 14, s.y1, s.z0, s.z1]] as const) g.add(boxW(x - 14, x - 8, -y1, -y0, z0, z1, plateM));
  } else {
    const print = shieldPrint(tier, feat, s);
    if (print) g.add(decalX(x - 9, s, -1, mat(0xffffff, { map: print, transparent: true, roughness: 0.6, depthWrite: false })));
  }
  // the buttons and the extra jacks of the better boards (look only)
  const button = (y: number, z: number, ring: number) => g.add(drumX(x - 12, -y, z, 26, 8, mat(ring, { roughness: 0.45 })), drumX(x - 16, -y, z, 18, 10, mat(0x1b1d22, { roughness: 0.5 })));
  if (tier >= 2) button(-1290, Z + 300, 0x9aa3ae);
  if (tier >= 3) {
    button(-1220, Z + 300, 0xc8323c);
    for (const z of [Z + 900, Z + 1160]) g.add(drumX(x - 30, 620, z, 22, 44, gold, 14), drumX(x - 50, 620, z, 13, 4, hole, 12));
    g.add(boxW(x - 18, x - 8, 410, 450, Z + 250, Z + 290, mat(0x1b1d22, { roughness: 0.5 })), boxW(x - 20, x - 16, 418, 442, Z + 258, Z + 282, hole));
    g.add(softBoxW(x - 16, x - 8, 300, 340, Z + 470, Z + 610, shell), softBoxW(x - 20, x - 14, 306, 334, Z + 480, Z + 600, hole));
  }
  return g;
}

/** The legacy ports' colours (PC 99): the PS/2 keyboard and mouse, serial, parallel, VGA, DVI. */
const LEGACY = { kb: 0x7a4fb0, mouse: 0x4caf50, serial: 0x13a3a3, parallel: 0xa0306e, vga: 0x2350b4, dvi: 0xe6e6e6 };

/**
 * The older boards' legacy ports, in the stamped shield's free column beside the live ones (look only: the game's video lead keeps to HDMI). The
 * Starter has an old board's full set: the PS/2 keyboard and mouse, a serial and a parallel port. The Basic has one PS/2 combo port, VGA and DVI.
 * Each D-sub is a steel shell with its D-shaped mouth, the coloured insert inside, and a hex jack screw at each end; the long side runs down the
 * plate, as a tower's board stands.
 */
function legacyPorts(g: Group, tier: number, plateM: MeshStandardMaterial) {
  const x = CASE.x, zc = BOARD_Z + 880, shell = steel(), hole = black(), screw = mat(0x9aa0a8, { metalness: 0.8, roughness: 0.35 });
  const din = (y: number, tone: number, half?: number) => {
    g.add(drumX(x - 12, -y, zc, 40, 8, mat(tone, { roughness: 0.5 })), drumX(x - 15, -y, zc, 27, 8, hole), boxW(x - 16, x - 12, -y - 4, -y + 4, zc + 14, zc + 27, mat(tone, { roughness: 0.5 })));
    // (a combo port's ring is half each colour: the half over the ring's face, the mouth in front of it)
    if (half !== undefined) {
      const o = new Mesh(new CylinderGeometry(40, 40, 0.8, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), mat(half, { roughness: 0.5 }));
      o.position.set(x - 16.6, -y, zc);
      g.add(place(o));
    }
  };
  const dsub = (y: number, len: number, tone: number) => {
    const a = y - len / 2, b = y + len / 2, z0 = zc - 44, z1 = zc + 44, k = 22;
    g.add(wallX(x - 16, x - 8, { y0: a - 16, y1: b + 16, z0: z0 - 16, z1: z1 + 16 }, [[wallPt(a, z0), wallPt(a + k, z1), wallPt(b - k, z1), wallPt(b, z0)]], shell));
    g.add(boxW(x - 13, x - 9, -b + 10, -a - 10, z0 + 8, z1 - 8, mat(tone, { roughness: 0.55 })));
    g.add(boxW(x - 14, x - 10, -b + 26, -a - 26, zc - 6, zc + 6, hole));
    for (const yy of [a - 60, b + 60]) g.add(drumX(x - 20, -yy, zc, 20, 14, screw, 6), drumX(x - 28, -yy, zc, 8, 2, hole, 8));
    g.add(boxW(x - 11, x - 8, -(b + 90), -(a - 90), z0 - 30, z1 + 30, plateM));
  };
  if (tier === 0) {
    din(-1890, LEGACY.kb);
    din(-1770, LEGACY.mouse);
    dsub(-1460, 190, LEGACY.serial);
    dsub(-930, 470, LEGACY.parallel);
  } else {
    din(-1830, LEGACY.kb, LEGACY.mouse);
    dsub(-1460, 190, LEGACY.vga);
    dsub(-980, 330, LEGACY.dvi);
  }
}

/** A box across x with its corners rounded in the wall's plane (a USB-C mouth): world y and depth, as `boxW`. */
function softBoxW(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: Material): Mesh {
  const r = Math.min(y1 - y0, z1 - z0) / 2;
  return wallX(x0, x1, { y0: -y1, y1: -y0, z0, z1, r }, [], m);
}

// ---------------------------------------------------------------- the controls on the top

export interface Controls { root: Group; power: Group; leds: { on: MeshStandardMaterial; err: MeshStandardMaterial; disk: MeshStandardMaterial }; spins: Spin[] }
type Port = 'usbA' | 'usbC' | 'audio' | 'button';
/** The front ports: the headers a board of the case's own tier has for them (USB_2, then USB_3 from the Mid; USB-C only on the Full, its `USB_3` header's own). */
const PORTS: Record<CaseKind, Port[]> = { oem: ['usbA', 'usbA', 'audio', 'audio'], matte: ['usbA', 'usbA', 'audio'], gamer: ['usbA', 'usbA', 'audio', 'button'], show: ['usbC', 'usbA', 'usbA', 'audio', 'audio'] };
const pip = (c: number) => mat(0x0c0c0e, { emissive: c, emissiveIntensity: 0, roughness: 0.3 });

/** An unseen plate over the power button, rising above the case's top: the button lies flat on top, so a click head on (the board view) finds it here. */
const hitPlate = (x: number, y: number, z: number): Mesh => {
  const o = rectBox({ x: x - 210, y: y - 260, w: 420, h: 260 }, z - 210, z + 210, mat(0, { transparent: true, opacity: 0, depthWrite: false }));
  o.castShadow = o.receiveShadow = false;
  return o;
};

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
    power.add(hitPlate(bx, ty, zb));
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
  power.add(hitPlate(ix, py, zb));
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
      root.add(rectBox({ x: ix - 34, y: py - 4, w: 68, h: 4 }, z - 70, z + 70, steel()), rectBox({ x: ix - 26, y: py - 6, w: 52, h: 3 }, z - 62, z + 62, black()), rectBox({ x: ix - 9, y: py - 8, w: 18, h: 3 }, z - 52, z + 52, mat(USB_TONGUE[LAYOUT_CASE] ?? 0x2a6fdc, { roughness: 0.5 })));
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

/** The tray under the board: a brass hex stud up to the board's underside at each of `used` (the fitted board's holes), a threaded hole at the case's other positions. */
export function mounts(used: readonly (readonly [number, number])[]): Group {
  const g = new Group(), h = BOARD_Z - 60 - TRAY_Z, at = (x: number, y: number) => used.some(([a, b]) => a === x && b === y);
  const up = (r: number, n: number, len: number) => new CylinderGeometry(r, r, len, n).rotateX(Math.PI / 2);
  g.add(instanced(up(58, 6, h), mat(0xc2a15a, { metalness: 0.8, roughness: 0.36 }), used.map(([x, y]) => ({ x, y: -y, z: TRAY_Z + h / 2 }))));
  const free = standoffs().filter(([x, y]) => !at(x, y));
  if (free.length) {
    // (above the Full tower's perforated sheet, at +6)
    g.add(instanced(up(46, 16, 3), mat(0x7c828b, { metalness: 0.75, roughness: 0.42 }), free.map(([x, y]) => ({ x, y: -y, z: TRAY_Z + 8 }))));
    g.add(instanced(up(26, 12, 3), black(), free.map(([x, y]) => ({ x, y: -y, z: TRAY_Z + 10 }))));
  }
  return g;
}

/**
 * The tray's cable management between the board and the front fans: a column of tie points for the straps, and the routing cut-outs of the kind
 * (the Micro's one rubber-rimmed slot, the Mid's slanted cut-outs, the Full tower's rimmed slots on a hex-perforated tray; the Mini has bare tie
 * points only). And the board's mounts: every position of every board the case takes is a threaded hole; the fitted board's stand a brass stud.
 */
export function trayDetail(f: Frame): Group {
  const g = new Group(), east = CASE_BD.x + CASE_BD.w, bd = CASE_BD, rim = mat(GROMMETS[f.kind].tone, GROMMETS[f.kind].metal ? { metalness: 0.75, roughness: 0.3 } : { roughness: 0.75 });
  g.add(mounts(GEO.holes));
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

