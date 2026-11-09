// The working details of the 3D cases (case3d.ts): what a real case has round its box, by kind. The rear wall with its openings (the expansion
// slot row behind its retention bar and thumbscrews, the exhaust fan behind a honeycomb grille, or the Mini's punched grille), the board's I/O
// shield with its ports where the plugs go in, the front's intake (mesh or hex over the front fans, the Micro's side gaps, the Mini's grille),
// the top controls (the power button and the status lights of each kind, the front ports). The inside of the case is casetray3d.ts. Airflow reads
// from outside: in at the front and under the PSU, out at the rear fan and the top.
import { BoxGeometry, CircleGeometry, CylinderGeometry, Group, Mesh, PlaneGeometry, TorusGeometry, type Vector2, type Material, type MeshStandardMaterial } from 'three';
import { FAN_SCREW, fanFlange, place, post, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import type { BoardFeatures } from '@/features/board/sim/specs';
import { BOARD_Z, CASE_D, CASE_Z, FAN_MAX, FAN_ZC, REAR_ZC } from '@/features/room/render/three/roomplan';
import { fanMounts, frontFanRects } from '@/features/room/render/desk/props/case';
import type { CaseKind } from '@/features/room/render/shell/casedecor';
import { geoOf, IO_PORTS } from '../layout/boardlayout';
import { BR, CASE, CASE_IN, LAYOUT_CASE, REAR_FAN, REAR_FAN_FITTED, WALL_T } from '../layout/layout';
import { basementPlan, psuFan, psuOpening } from './basement3d';
import { fitted, IO_EXTRA, IO_HALF, IO_Z, legacyIo } from './boardhw3d';
import { BRACKET_TOP, slotBlank } from './card3d';
import { brushed, decalX, flatSlot, FRONT, outlinePts, perfMat, plateY, screws, shapeOf, slab, tex, thumbscrews, tiled, wallCircle, wallPt, wallX, type Span } from './casekit3d';
import type { GrommetStyle } from './wires3d';
import { glowMat, light, type Spin } from './fans3d';
import { jackFace, jackLook } from './rj45jack3d';

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
const SLOT_Z = [BOARD_Z + 130, BRACKET_TOP - 40] as const;

/** The rear exhaust's round opening in the rear wall, on every case (layout y and depth). */
function rearFanHole(): { d: number; cy: number } {
  return { d: Math.min(REAR_FAN.h, FAN_MAX) * 0.96, cy: REAR_FAN.y + REAR_FAN.h / 2 };
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
  // (the mount's four screw holes: slots, so the fan can sit a little higher or lower)
  if (REAR_FAN_FITTED) for (const [dy, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    const y = fan.cy + dy * fan.d * FAN_SCREW, z = REAR_ZC + dz * fan.d * FAN_SCREW;
    holes.push({ y0: y - 90, y1: y + 90, z0: z - 26, z1: z + 26, r: 26 });
  }
  // a vented column beside the slot row, past the retention bar
  const vz0 = SLOT_Z[1] + 260, vz1 = Math.min(vz0 + 900, f.z1 - 220);
  if (slots && vz1 - vz0 > 300) for (let i = 0; i < slots; i++) for (let z = vz0; z + 50 <= vz1; z += 110) holes.push({ y0: slotY(i) + 40, y1: slotY(i) + 430, z0: z, z1: z + 50, r: 25 });
  g.add(wallX(x0, x1, { y0: f.yTop, y1: f.yBot, z0: f.z0, z1: f.z1 }, holes, f.body));
  // the I/O opening's lip, folded in off the wall's inner face
  g.add(wallX(x1, x1 + 60, { y0: p.y0 + 10, y1: p.y1 - 10, z0: p.z0 + 10, z1: p.z1 - 10, r: 8 }, [{ y0: p.y0 + 20, y1: p.y1 - 20, z0: p.z0 + 20, z1: p.z1 - 20, r: 4 }], f.body, 2));
  // the slots the board lacks: blank covers behind their openings (the board's own empty slots get theirs in machine3d.ts)
  for (let i = boardSlots; i < slots; i++) g.add(slotBlank(slotY(i), SLOT_BLANK[f.kind]));
  // the retention bar over the far ends of the openings, where the brackets' folds are (away from the board, as a card's top edge is), a
  // thumbscrew per slot through it
  if (slots) {
    const ya = slotY(0) - 90, yb = slotY(slots - 1) + 560, za = SLOT_Z[1] - 24, zb = SLOT_Z[1] + 110;
    g.add(boxW(x0 - 14, x0, -yb, -ya, za, zb, f.body));
    g.add(thumbscrews(Array.from({ length: slots }, (_, i) => ({ x: x0 - 14, y: -(slotY(i) + 30), z: (za + zb) / 2 })), 'x-', 56, 64, steel()));
  }
  // over the round opening: a honeycomb grille where the case has a mount (its four screw holes go with it), the Mini's punched grille where it has none
  const grille = new Mesh(new CircleGeometry(fan.d / 2 + 6, 48), REAR_FAN_FITTED ? perfMat('hex', fan.d, fan.d, 64, kindTone(f.kind), { metal: 0.5, rough: 0.45 }) : perfMat('round', fan.d, fan.d, 50, kindTone(f.kind), { metal: 0.05, rough: 0.6 }));
  grille.rotation.y = -Math.PI / 2;
  grille.position.set(x0 - 2, -fan.cy, REAR_ZC);
  g.add(grille);
  return g;
}

/** The rear fan's four screws, seen in the rear wall's holes: they come and go with the fan. */
export function rearFanScrews(): Group {
  const { cy } = rearFanHole(), o = Math.min(REAR_FAN.h, FAN_MAX) * FAN_SCREW;
  return screws(([[-o, -o], [-o, o], [o, -o], [o, o]] as const).map(([dy, dz]) => ({ x: CASE.x, y: -(cy + dy), z: REAR_ZC + dz })), 'x-', 58, steel());
}

/**
 * The Mini's 5.25-inch bays behind its two covers: a zinc frame (two side plates with their screw slots, a top and a bottom plate, the rails between
 * the bays) and a tool-less latch per bay on the glass side.
 */
export function bayFrame(): Group {
  const g = new Group(), m = mat(0xa9aca4, { metalness: 0.7, roughness: 0.4 }), zc = CASE_Z + CASE_D / 2, x0 = CASE_IN.x + CASE_IN.w - 1830, x1 = CASE_IN.x + CASE_IN.w;
  const ya = CASE.y + 480, yb = CASE.y + 1440, za = zc - 760, zb = zc + 760, t = 14, side: RectLike = { x: x0, y: ya, w: x1 - x0, h: yb - ya };
  const holes = [0, 1].flatMap((k) => [200, 560, 920].map((dx) => outlinePts({ x: x0 + dx, y: CASE.y + 708 + k * 470, w: 160, h: 44 }, 22)));
  holes.push(outlinePts({ x: x0 + 1240, y: ya + 160, w: 420, h: yb - ya - 320 }, 60));
  for (const [z0, z1] of [[za, za + t], [zb - t, zb]] as const) g.add(slab(shapeOf(outlinePts(side, 8), holes), z0, z1, m, 2));
  for (const [y, k] of [[ya, 0], [yb - t, 1]] as const) g.add(plateY(x0, x1, za + t, zb - t, y, t, [flatSlot(x0 + 300 + k * 200, zc - 40, 900, 80)], m, 2));
  // the rails between the bays, and their stamped tabs
  for (const z of [za + t, zb - t - 26]) g.add(rectBox({ x: x0 + 80, y: CASE.y + 952, w: x1 - x0 - 160, h: 26 }, z, z + 26, m));
  // a plastic latch on the glass side over each bay: a slide over the first two slots with a grip at its end (the third slot takes a screw)
  const latch = mat(0x2c2e33, { roughness: 0.55 });
  for (let k = 0; k < 2; k++) {
    const y = CASE.y + 640 + k * 470;
    g.add(softBox({ x: x0 + 170, y, w: 700, h: 180 }, zb, zb + 34, latch, 10));
    for (let j = 0; j < 4; j++) g.add(rectBox({ x: x0 + 700 + j * 40, y: y + 30, w: 14, h: 120 }, zb + 34, zb + 44, latch));
  }
  return g;
}

/**
 * The case's fan mounts where a fan's flange meets it: a thin plate behind the front wall and under the top, with the fan's throat and its four
 * screw holes, in the case's inner finish. The rear mount is the rear wall's own (`rearWall`).
 */
export function fanMountPlates(m: Material): Group {
  const g = new Group(), T = 12;
  for (const fan of fanMounts()) {
    if (fan.side === 'rear') continue;
    const r = fan.rect, top = fan.side === 'top', d = Math.min(top ? r.w : r.h, FAN_MAX);
    const o = place(new Mesh(fanFlange(d, T, d * 1.02), m));
    if (top) { o.rotation.x = Math.PI / 2; o.position.set(r.x + r.w / 2, -(r.y - T / 2 - 2), FAN_ZC); }
    else { o.rotation.y = Math.PI / 2; o.position.set(r.x + r.w + T / 2 + 2, -(r.y + r.h / 2), FAN_ZC); }
    g.add(o);
  }
  return g;
}

/** The sheet's tone of each kind, for its grilles and meshes. */
export const kindTone = (k: CaseKind) => ({ oem: 0xcfc6a3, matte: 0x1c1d22, gamer: 0x262c3c, show: 0x5a5f69 })[k];
/** The slot blanks' finish by kind: bare zinc in the Mini, painted to match the body in the others. */
export const SLOT_BLANK: Record<CaseKind, number> = { oem: 0xa3a69f, matte: 0x1c1d22, gamer: 0x232838, show: 0x17181d };

/** The span of the front fans (layout y), and the depth their opening needs. */
function frontSpan(): Span {
  const rs = frontFanRects(), y0 = Math.min(...rs.map((r) => r.y)), y1 = Math.max(...rs.map((r) => r.y + r.h)), d = Math.min(...rs.map((r) => Math.min(r.h, FAN_MAX)));
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
  const { x, z: zc, r } = psuFan(basementPlan().psu);
  return { x0: x - r - 40, x1: x + r + 40, z0: zc - r - 40, z1: zc + r + 40 };
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
    // (the Enthusiast's runs out over its antenna jacks)
    const z1 = BOARD_Z + (tier >= 3 ? 1210 : 860);
    c.beginPath(); c.roundRect(u(BOARD_Z + 190), v(BR.io.y + 20), u(z1) - u(BOARD_Z + 190), v(BR.io.y + BR.io.h + 20) - v(BR.io.y + 20), 10); c.stroke();
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
  // (the plate is open behind the RJ45's mouth, which runs on through the wall into the jack)
  const rj45 = IO_PORTS.filter((p) => p.kind === 'rj45' && fitted(p, feat)).map((p): Span => ({ y0: p.y - IO_HALF.rj45 + 4, y1: p.y + IO_HALF.rj45 - 4, z0: Z + IO_Z.rj45[0] + 4, z1: Z + IO_Z.rj45[1] - 4 }));
  g.add(wallX(x - 8, x, s, rj45, plateM));
  const hole = black(), shell = steel(), gold = mat(0xd9b25e, { metalness: 0.9, roughness: 0.34 });
  /** An embossed rim round an opening on the stamped plate (world y, depth); `open`: a frame round it, for a mouth that runs on through the plate. */
  const rim = (y0: number, y1: number, z0: number, z1: number, open = false) => {
    if (!stamped) return;
    if (open) g.add(wallX(x - 11, x - 8, { y0: -y1 - 14, y1: -y0 + 14, z0: z0 - 14, z1: z1 + 14 }, [{ y0: -y1 + 4, y1: -y0 - 4, z0: z0 + 4, z1: z1 - 4 }], plateM));
    else g.add(boxW(x - 11, x - 8, y0 - 14, y1 + 14, z0 - 14, z1 + 14, plateM));
  };
  /** EMI fingers: springy tongues cut from the opening's long edges, bent in against the connector's shell (they lie along its sides). */
  const fingers = (y0: number, y1: number, z0: number, z1: number) => {
    if (!stamped) return;
    for (const [za, zb] of [[z0 - 4, z0], [z1, z1 + 4]] as const) for (let k = 0; k < 3; k++) { const y = y0 + ((k + 0.5) * (y1 - y0)) / 3; g.add(boxW(x - 16, x - 10, y - 8, y + 8, za, zb, plateM)); }
  };
  // (the numbers are boardhw3d.ts's `IO_Z` and `IO_HALF`: the connectors' shells behind the plate take the same)
  for (const p of IO_PORTS) {
    if (!fitted(p, feat)) continue;
    const cy = -p.y, ly = p.y; // (a port's `y` is its centre, where the plugs aim)
    if (p.kind === 'jack') {
      const zj = Z + IO_Z.jack;
      rim(cy - 34, cy + 34, zj - 34, zj + 34);
      g.add(drumX(x - 12, cy, zj, 30, 8, mat(JACK[p.id] ?? 0x999999, { roughness: 0.5 })), drumX(x - 14, cy, zj, 17, 8, hole), drumX(x - 13, cy, zj, 9, 6, shell));
    } else if (p.kind === 'rj45') {
      const h = IO_HALF.rj45, z0 = Z + IO_Z.rj45[0], z1 = Z + IO_Z.rj45[1];
      rim(cy - h, cy + h, z0, z1, true);
      // the jack's face (rj45jack3d's `jackFace`, as the router's ports): the mouth keyed by the latch notch on its south side, sunk through the
      // shell into the insert behind the wall (boardhw3d's shell is a hollow sleeve round it), the lights in their windows on the north corners
      jackFace(g, x - 20, { y0: ly - h, y1: ly + h, z0, z1 }, 170, jackLook(shell));
      fingers(cy - h, cy + h, z0, z1);
    } else if (p.kind === 'hdmi' || p.kind === 'dp') {
      // the shell and its keyed mouth (HDMI's two corners cut on its inner side, DP's one), the dark inside and the tongue
      const k = 16, z0 = Z + IO_Z.video[0], z1 = Z + IO_Z.video[1], y0 = ly - IO_HALF.video, y1 = ly + IO_HALF.video, a = y0 + 8, b = y1 - 8, c0 = z0 + 8, c1 = z1 - 8;
      const mouth = p.kind === 'hdmi'
        ? [wallPt(a + k, c0), wallPt(a, c0 + k), wallPt(a, c1), wallPt(b, c1), wallPt(b, c0 + k), wallPt(b - k, c0)]
        : [wallPt(a + k, c0), wallPt(a, c0 + k), wallPt(a, c1), wallPt(b, c1), wallPt(b, c0)];
      rim(cy - IO_HALF.video, cy + IO_HALF.video, z0, z1);
      g.add(wallX(x - 16, x - 8, { y0, y1, z0, z1 }, [mouth], shell));
      g.add(boxW(x - 12, x - 8, cy - 50, cy + 50, c0, c1, hole));
      g.add(boxW(x - 15, x - 10, cy - 40, cy + 40, (z0 + z1) / 2 - 6, (z0 + z1) / 2 + 6, mat(0x16171b, { roughness: 0.5 })));
    } else if (p.kind === 'usb') {
      const h = IO_HALF.usb, z0 = Z + IO_Z.usb[0], z1 = Z + IO_Z.usb[1], tz = z0 + 28;
      rim(cy - h, cy + h, z0, z1);
      // the mouth sunk into the shell, the tongue in it with its four contacts on the open side
      g.add(wallX(x - 18, x - 8, { y0: ly - h, y1: ly + h, z0, z1 }, [{ y0: ly - h + 8, y1: ly + h - 8, z0: z0 + 6, z1: z1 - 6 }], shell), boxW(x - 10, x - 8, cy - h + 4, cy + h - 4, z0 + 3, z1 - 3, hole));
      g.add(boxW(x - 17, x - 10, cy - 40, cy + 40, tz, tz + 12, mat(USB_TONGUE[tier] ?? 0x2a6fdc, { roughness: 0.5 })));
      for (let k = 0; k < 4; k++) g.add(boxW(x - 16, x - 11, cy - 30 + k * 20 - 4, cy - 30 + k * 20 + 4, tz - 2, tz, gold));
      fingers(cy - h, cy + h, z0, z1);
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
  if (tier >= 2) button(IO_EXTRA.bios, Z + IO_Z.jack, 0x9aa3ae);
  if (tier >= 3) {
    const e = IO_EXTRA, oy = -e.optical.y, oz = Z + e.optical.z, uy = -e.usbc.y, [u0, u1] = e.usbc.z;
    button(e.clr, Z + IO_Z.jack, 0xc8323c);
    // each antenna jack an SMA: the hex nut on the plate, the threaded barrel, the white insulator and the centre socket at its mouth
    const nickel = mat(0xb8bcc2, { metalness: 0.85, roughness: 0.3 }), ptfe = mat(0xe8e6df, { roughness: 0.6 });
    for (const z of e.wifi.z) {
      const wy = -e.wifi.y, wz = Z + z;
      g.add(drumX(x - 15, wy, wz, 30, 14, nickel, 6), drumX(x - 42, wy, wz, 18, 44, gold, 20), drumX(x - 64.6, wy, wz, 11, 1.4, ptfe, 16), drumX(x - 65.6, wy, wz, 3.5, 1, gold, 8));
      for (let k = 0; k < 5; k++) g.add(drumX(x - 27 - k * 8, wy, wz, 20.5, 3, gold, 20));
    }
    g.add(boxW(x - 18, x - 8, oy - 20, oy + 20, oz - 20, oz + 20, mat(0x1b1d22, { roughness: 0.5 })), boxW(x - 20, x - 16, oy - 12, oy + 12, oz - 12, oz + 12, hole));
    // the USB-C: its rounded mouth sunk into the shell, the thin tongue down its middle
    const ul = e.usbc.y;
    g.add(wallX(x - 16, x - 8, { y0: ul - 20, y1: ul + 20, z0: Z + u0, z1: Z + u1, r: 20 }, [{ y0: ul - 13, y1: ul + 13, z0: Z + u0 + 8, z1: Z + u1 - 8, r: 13 }], shell));
    g.add(boxW(x - 10, x - 8, uy - 16, uy + 16, Z + u0 + 4, Z + u1 - 4, hole), boxW(x - 14, x - 10, uy - 3.5, uy + 3.5, Z + u0 + 26, Z + u1 - 26, mat(0x16171b, { roughness: 0.5 })));
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
  const x = CASE.x, zc = BOARD_Z + IO_Z.legacy, shell = steel(), hole = black(), screw = mat(0x9aa0a8, { metalness: 0.8, roughness: 0.35 });
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
  const tone = (t: string) => LEGACY[t as keyof typeof LEGACY] ?? 0x999999;
  for (const l of legacyIo(tier)) {
    if (l.kind === 'din') din(l.y, tone(l.tone), l.half ? tone(l.half) : undefined);
    else dsub(l.y, l.len, tone(l.tone));
  }
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

/** How each kind finishes a cable hole in the tray: a rolled steel lip (the Mini), black rubber, or a brushed aluminium ring over rubber flaps (the Full tower). */
export const GROMMETS: Record<CaseKind, GrommetStyle> = { oem: { tone: 0xbdb491, metal: false, flap: null }, matte: { tone: 0x101114, metal: false, flap: 0x1c1d22 }, gamer: { tone: 0x14171f, metal: false, flap: 0x20242f }, show: { tone: 0x9aa0a8, metal: true, flap: 0x17181c } };

/** Two hinge barrels on the front edge of a glass door (the Mid and the Full tower). */
export function hinges(ex: number, yTop: number, yBot: number): Group {
  const g = new Group(), m = mat(0x2b2f38, { metalness: 0.7, roughness: 0.35 });
  for (const y of [yTop + 500, yBot - 900]) { const o = place(new Mesh(new CylinderGeometry(24, 24, 320, 16), m)); o.position.set(ex + 6, -y, FRONT - 6); g.add(o); }
  return g;
}

