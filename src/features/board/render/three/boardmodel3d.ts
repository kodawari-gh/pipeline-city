// A motherboard as a 3D model on its own (the gallery's), built from the tier's layout (`GEO`) and skin. It wears the 2D renderer's own drawing as
// the live board does (machine3d.ts): the PCB's face is `buildBoard` baked in tiles as the camera comes in (traces, pours, vias, silkscreen), and
// each socket, chip and regulator part stands up off it with its own drawing on top. The pieces the drawing cannot show are modelled: the PCIe
// slots' grooves and contacts, the memory sockets, the power sockets' cavities, the chipset's sink, the slot hardware, the rear I/O with its shield, the solids
// (capacitors, passives, legs, pins, screws), and the lights a running board shows (power good, the debug code, the RGB strip).
// Built in board space (x east, y north, z up off the board).
import { BoxGeometry, Group, type Material } from 'three';
import { headerRect } from '@/core/render/accelart';
import { drum, instanced, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { lerpHex, mat } from '@/core/render/three/materials';
import type { Theme } from '@/core/render/theme';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { BOARD_TIERS } from '../../sim/specs';
import { buildBoard } from '../boardArt';
import type { Solid } from '../boardParts';
import { BD, GEO, M2_SLOTS, PCIE_RAILS, PKG, SOCKET_E } from '../layout/layout';
import { hexNum, skinOf } from '../skins';
import { ArtSet, LV_BOARD } from './artset3d';
import { ioCover, slotHardware } from './boardhw3d';
import { ioShield } from './casedetail3d';
import { outlinePts, shapeOf, slab } from './casekit3d';
import { chipset, coinCell, m2Standoff, type Raise } from './parts3d';
import { dimmSlot } from './ram3d';
import { CHIP_H, buildSolids } from './solids3d';
import { atxSocket, epsSocket, sataPort } from './wires3d';

const grow = (r: RectLike, e: number): RectLike => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });
const gold = () => mat(0xd9b25e, { metalness: 1, roughness: 0.25 });
const lamp = (color: number, k = 2.2) => mat(0x101010, { emissive: color, emissiveIntensity: k, roughness: 0.35 });

/**
 * A PCIe slot built whole (the 2D draws it from above: `pcieSlot`): the moulded housing with its card groove, split by the key, a dark floor in
 * the groove and a gold contact down each wall at every pin (20 apart, as the drawing's pins).
 */
export function pcieSlot(r: RectLike, body: Material): Group {
  const g = new Group(), z1 = BOARD_Z + 140, floor = BOARD_Z + 40, sy = r.y + 16, sh = 26, x0 = r.x + 40, x1 = r.x + r.w - 50, key = r.x + Math.min(r.w * 0.2, 700);
  const holes = [{ x: x0, y: sy, w: key - x0, h: sh }, { x: key + 18, y: sy, w: x1 - key - 18, h: sh }];
  g.add(slab(shapeOf(outlinePts(r, 10), holes.map((h) => outlinePts(h, 3))), BOARD_Z, z1, body, 4));
  g.add(rectBox({ x: x0, y: sy, w: x1 - x0, h: sh }, BOARD_Z, floor, mat(0x050608, { roughness: 0.85 })));
  const pins: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  for (let x = r.x + 52; x < x1 - 6; x += 20) if (x < key - 6 || x > key + 24) for (const y of [sy + 1.5, sy + sh - 1.5]) pins.push({ x, y: -y, z: floor + 44, sx: 8, sy: 3, sz: 80 });
  g.add(instanced(new BoxGeometry(1, 1, 1), gold(), pins));
  return g;
}

/** The top board's POST code display (`GEO.dbg`): a black housing, a smoked window, two seven-segment digits reading A0 (boot done) in the theme's amber. */
function debugDisplay(d: RectLike, T: Theme): Group {
  const g = new Group(), top = BOARD_Z + 90, on = lamp(hexNum(T.ld), 1.1), off = mat(0x1a0f08, { roughness: 0.5 });
  g.add(softBox(d, BOARD_Z, top, mat(0x05070b, { roughness: 0.45 }), 8));
  // the segments as the 2D lays them (`[x, y, w, h]` in a digit's cell): top, middle, bottom, upper left, upper right, lower left, lower right
  const seg = [[10, 10, 70, 10], [10, 70, 70, 10], [10, 130, 70, 10], [4, 18, 10, 50], [74, 18, 10, 50], [4, 78, 10, 50], [74, 78, 10, 50]] as const;
  const lit = [[1, 1, 0, 1, 1, 1, 1], [1, 0, 1, 1, 1, 1, 1]]; // A, 0
  for (let k = 0; k < 2; k++) seg.forEach(([a, b, w, h], i) => g.add(rectBox({ x: d.x + 24 + k * 134 + a, y: d.y + 14 + b * 0.82, w, h }, top, top + 3, lit[k]![i] ? on : off)));
  g.add(rectBox(grow(d, -8), top + 4, top + 6, mat(0x202020, { transparent: true, opacity: 0.18, roughness: 0.1, metalness: 0.2 })));
  return g;
}

/** The top board's RGB strip along its south edge (`GEO.rgb`): 44 LEDs fading from the theme's teal to its pink under a frosted light pipe. */
function rgbStrip(r: RectLike, T: Theme): Group {
  const g = new Group(), n = 44, a = hexNum(T.alu), b = hexNum(T.br), y = r.y + r.h / 2;
  g.add(softBox(r, BOARD_Z, BOARD_Z + 18, mat(0x0b0d12, { roughness: 0.6 }), 6));
  for (let k = 0; k < n; k++) {
    const x = r.x + (k * r.w) / (n - 1);
    g.add(rectBox({ x: x - 12, y: y - 12, w: 24, h: 24 }, BOARD_Z + 18, BOARD_Z + 26, lamp(lerpHex(a, b, k / (n - 1)), 1.4)));
  }
  // (a dark smoked pipe: a pale one turns every LED white)
  g.add(softBox(grow(r, -4), BOARD_Z + 26, BOARD_Z + 44, mat(0x30343c, { transparent: true, opacity: 0.22, roughness: 0.3 }), 8));
  return g;
}

/** The board of this tier, empty (no CPU, no memory, no cards), as a running board shows it: its power-good light, debug code and RGB strip lit. */
export function boardModel(T: Theme, tier = GEO.tier): Group {
  const g = new Group(), sk = skinOf(tier), art = new ArtSet(), solids: Solid[] = [];
  const slot = mat(hexNum(sk.slot), { roughness: 0.5 }), socket = mat(0x1a1d24, { roughness: 0.5 }), chip = mat(0x14161b, { roughness: 0.5 });
  // the drawing, and its far picture for the coarsest level (each lane a wider band: a thin trace would be lost); the drawers report the solids
  const draw = art.baker(() => buildBoard(T, tier, (x) => solids.push(x)).root), far = art.baker(() => buildBoard(T, tier, undefined, true).root);
  const up: Raise = (parent, r, z0, z1, side, bevel = 0) => art.raised(parent, draw, r, z0, z1, side, undefined, bevel);
  // the PCB: the solder mask over the laminate, its corners rounded as the drawing's, and the drawing on its face
  const outline = outlinePts(BD, 120, undefined, 8);
  g.add(slab(shapeOf(outline), BOARD_Z - 60, BOARD_Z, mat(lerpHex(hexNum(sk.mask[T.dark ? 0 : 1]), 0x000000, 0.35), { roughness: 0.6 }), 4));
  g.add(slab(shapeOf(outline), BOARD_Z - 64, BOARD_Z - 58, mat(0xc8b98a, { roughness: 0.7 })));
  art.surface(g, (f, px) => (px < LV_BOARD[1]! ? far : draw).bake(f, px), BD, BOARD_Z, LV_BOARD);
  // the rear I/O: the connectors and their cover, and the shield fitted over their mouths as the case holds it (the wall's thickness between)
  const feat = BOARD_TIERS[tier]?.features ?? { ethernetMbps: 0, usbPorts: 1, displayPorts: 1 };
  g.add(ioCover(feat).root, ioShield(feat, tier));
  // the CPU socket (its pins are solids), the memory sockets, the slots, the M.2 connectors with their standoffs
  up(g, grow(PKG, SOCKET_E), BOARD_Z, BOARD_Z + 70, socket);
  for (const d of GEO.dimm) { const s = dimmSlot(d.rect, true, hexNum(sk.slot), hexNum(sk.latch)); g.add(s.housing, s.latches); }
  for (const r of PCIE_RAILS) g.add(pcieSlot(r, slot));
  for (const m of M2_SLOTS) { up(g, { x: m.x + 8, y: m.y + 70, w: 120, h: m.h - 140 }, BOARD_Z, BOARD_Z + 70, chip, 6); g.add(m2Standoff(m)); }
  const pch = chipset(GEO.chip, tier, up);
  g.add(pch.root, atxSocket(GEO.atx), epsSocket(GEO.cpw), coinCell(GEO.bat));
  for (const r of GEO.sata) g.add(sataPort(r));
  // the regulators: each phase's choke and power stage; then the controllers, the crystals (metal cans) and the header bodies
  const choke = mat(0x2b2f38, { metalness: 0.35, roughness: 0.45 }), can = mat(0xa9b0b8, { metalness: 0.8, roughness: 0.3 });
  for (const p of solids) if (p.kind === 'choke' || p.kind === 'stage') {
    const ch = p.kind === 'choke';
    up(g, { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h }, BOARD_Z, BOARD_Z + (ch ? 150 : 40), ch ? choke : chip, ch ? 14 : 6);
  }
  for (const r of [GEO.pwm, GEO.dpwm, GEO.bios, GEO.sio, GEO.codec, GEO.hub, GEO.phy]) if (r) up(g, r, BOARD_Z, BOARD_Z + CHIP_H, chip, 8);
  for (const r of [GEO.xtalCpu, GEO.xtalPch]) up(g, r, BOARD_Z, BOARD_Z + 60, can, 12);
  for (const h of GEO.hdrs) up(g, headerRect(h), BOARD_Z, BOARD_Z + 140, slot);
  g.add(buildSolids(solids, true, sk.capSleeve), slotHardware());
  // the lights: power good beside the CPU's controller, and the top board's debug code and RGB strip
  g.add(drum(GEO.vrmLed.x, GEO.vrmLed.y, BOARD_Z, BOARD_Z + 22, 14, lamp(hexNum(T.st)), 12));
  if (GEO.dbg) g.add(debugDisplay(GEO.dbg, T));
  if (GEO.rgb) g.add(rgbStrip(GEO.rgb, T));
  art.attach(g);
  return g;
}
