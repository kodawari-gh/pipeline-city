// The drive cage in 3D (docs/PC_PARTS.md "Storage"), as a real one: a steel cage in the main compartment along the case's front, east of the
// cable gutter and over the fan hub, the front fans blowing through its open sides at the drives. It holds a tray for each bay (`BAY_CELLS`: slot
// sata<i> top down, 34 mm apart, as real cages), each a steel sled lying flat that slides out to the glass side: its floor with air windows and
// the 2.5 in. drive's four screw holes, a rail either side with two tool-less pins (in rubber rings) that go into the 3.5 in. drive's side holes,
// a pull handle with a finger hole and a latch at its front. A drive lies on its tray with its SATA receptacles at the back, toward the case's tray
// sheet (machine3d.ts plugs its cables there and runs them back through the sheet's opening, casetray3d.ts). The cage's back flanges are screwed
// to the tray sheet. An empty bay keeps its empty tray; a fitted drive's tray goes with the drive (it slides out with it, buildmotion.ts).
// The 2D keeps its column of cells (`BAY_CELLS`) at the cage's west end.
import { CylinderGeometry, Group, Mesh, Vector2 } from 'three';
import { instanced, rectBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { CASE_FRONT as FRONT } from '@/features/room/render/three/roomplan';
import type { CaseKind } from '@/features/room/render/shell/casedecor';
import { BAY_CELLS, CAGE_W, CELL_H, PSU } from '../layout/layout';
import { flatSlot, plateY, screws, shapeOf, slab, wallX, type Span, type Spot } from './casekit3d';
import { box, flat, HDD_MM, SSD_MM, xy, xz } from './drive3d';
import { MM } from './pcbkit3d';
import { TRAY_Z } from './wires3d';

/** The cage's steel. */
const SHEET = 18;
/** A tray, in units: across, long, its floor's sheet, a rail's thickness and height, the handle's height. */
export const TRAY = { w: 2430, l: 3447, floor: 18, rail: 41, railH: 300, handleH: 330 } as const;
/** How far a drive's connector end sits in from the tray's back. */
const DRIVE_Z = 20;
/** The hard disk rides on the rails' pins 1.8 mm over the floor; the SSD lies on the floor, screwed from under it. */
const HDD_LIFT = 60;
/** The pins' height over the floor's bottom: the hard disk's side holes are 6.35 mm up. */
const PIN_Y = HDD_LIFT + 6.35 * MM;
/** The pins' places along the tray: the hard disk's back and front side holes (130.1 and 28.5 mm from its front). */
const PIN_Z = [HDD_MM.l - 130.1, HDD_MM.l - 28.5].map((v) => DRIVE_Z + v * MM);

/** Each kind's cage (its case's paint, bare zinc in the Mini) and its trays (a shade lighter). */
const CAGE_TONE: Record<CaseKind, number> = { oem: 0xa9aca4, matte: 0x1b1c20, gamer: 0x232838, show: 0x2a2d33 };
const TRAY_TONE: Record<CaseKind, number> = { oem: 0xc3c5bd, matte: 0x2f3136, gamer: 0x3a4050, show: 0x3c3f46 };

/** A tray's place: its west edge, its floor's bottom (world y), its back (z); slot sata<slot>. */
export interface TraySpot { slot: number; x: number; y: number; z: number }

export interface CagePlan {
  /** The cage's box: layout x and y (y down), depth z. */
  x0: number; x1: number; top: number; bottom: number; z0: number; z1: number;
  trays: TraySpot[];
}

/** Where the cage and its trays go: over the bay cells, from the tray sheet to the glass, each tray's floor on its cell's bottom line. It stands on the
 *  shroud's shelf (`basement3d.ts`), as a Define 7's cage on its shroud: its bottom on the shroud's top. */
export function cagePlan(cells: readonly RectLike[] = BAY_CELLS): CagePlan {
  const x0 = cells[0]?.x ?? 0, x1 = x0 + CAGE_W, last = cells[cells.length - 1];
  const top = (cells[0]?.y ?? 0) - 70, bottom = Math.max(PSU.y, last ? last.y + last.h + 60 : top + 200);
  const tx = x0 + (CAGE_W - TRAY.w) / 2, tz = FRONT - 110 - TRAY.l;
  return { x0, x1, top, bottom, z0: TRAY_Z, z1: FRONT - 95, trays: cells.map((c, i) => ({ slot: i, x: tx, y: -(c.y + c.h), z: tz })) };
}

/** Where a drive lies in its tray (the tray's frame): centred across it, its connector end at the back, on the pins or on the floor. */
export const onTray = (hdd: boolean): { x: number; y: number; z: number } =>
  ({ x: (TRAY.w - (hdd ? HDD_MM.w : SSD_MM.w) * MM) / 2, y: hdd ? HDD_LIFT : TRAY.floor, z: DRIVE_Z });

/** A circle in a sheet's (x, z) plane. */
const hole = (x: number, z: number, r: number, n = 16): Vector2[] => Array.from({ length: n }, (_, k) => new Vector2(x + Math.cos((k / n) * Math.PI * 2) * r, z + Math.sin((k / n) * Math.PI * 2) * r));

/** Where the SSD's four screws go through the floor: under its bottom holes (4.07 mm in from its sides, 14 and 90.6 mm from its front). */
function ssdScrews(): { x: number; z: number }[] {
  const o = onTray(false), w = SSD_MM.w * MM;
  return [SSD_MM.l - 14, SSD_MM.l - 90.6].flatMap((z) => [4.07 * MM, w - 4.07 * MM].map((x) => ({ x: o.x + x, z: o.z + z * MM })));
}

/**
 * A tray in its own frame (x across, y up from its floor's bottom, z from its back to its handle), in its case's finish. `fitted` adds the
 * fixings its drive takes: the SSD's four screws under the floor.
 */
export function trayModel(kind: CaseKind, fitted: 'hdd' | 'ssd' | null = null): Group {
  const g = new Group(), steel = mat(TRAY_TONE[kind], { metalness: kind === 'oem' ? 0.6 : 0.3, roughness: 0.45 }), rubber = mat(0x101113, { roughness: 0.9 });
  const pinM = mat(0xb9bec4, { metalness: 0.88, roughness: 0.3 }), latch = mat(0x141518, { roughness: 0.55 });
  const { w: W, l: L, floor: F, rail: R, railH: H, handleH: HH } = TRAY;
  // the floor: two air windows clear of the SSD's screw holes, the holes themselves, a row of slots by each rail
  const holes = [xz(700, 420, W - 700, 1780, 90), xz(700, 2240, W - 700, 3180, 90), ...ssdScrews().map((s) => hole(s.x, s.z, 1.8 * MM))];
  for (let z = 520; z + 260 < L - 300; z += 420) holes.push(xz(150, z, 330, z + 260, 50), xz(W - 330, z, W - 150, z + 260, 50));
  g.add(flat(xz(0, 0, W, L - 26, 26), 0, F, steel, 3, holes));
  // the rails, folded up from the floor, a long window in each between its pins
  const win: Span = { y0: -(H - 70), y1: -(F + 80), z0: PIN_Z[0]! + 260, z1: PIN_Z[1]! - 260, r: 40 };
  for (const x of [0, W - R]) g.add(wallX(x, x + R, { y0: -H, y1: 0, z0: 40, z1: L - 26 }, [win], steel, 3));
  // the pins, through a rubber ring on each rail's inner face, pointing at the drive's side holes
  const pin = (dir: 1 | -1) => new CylinderGeometry(1.5 * MM, 1.5 * MM, 4 * MM, 14).rotateZ(Math.PI / 2).translate((dir * 4 * MM) / 2, 0, 0);
  const ring = (dir: 1 | -1) => new CylinderGeometry(4 * MM, 4 * MM, 1.2 * MM, 20).rotateZ(Math.PI / 2).translate((dir * 1.2 * MM) / 2, 0, 0);
  for (const [x, dir] of [[R, 1], [W - R, -1]] as const) {
    const at = PIN_Z.map((z) => ({ x, y: PIN_Y, z }));
    g.add(instanced(ring(dir), rubber, at), instanced(pin(dir), pinM, at.map((p) => ({ ...p, x: p.x + dir * 1.2 * MM }))));
  }
  // the handle across the front: a plate with a finger hole, the latch's grip at its east end with its ribs
  g.add(slab(shapeOf(xy(0, 0, W, HH, 30), [xy(W / 2 - 420, 120, W / 2 + 420, 245, 62)]), L - 26, L, steel, 4));
  g.add(box(W - 430, W - 90, 60, 270, L, L + 22, latch));
  g.add(instanced(new CylinderGeometry(9, 9, 160, 8), latch, [0, 1, 2, 3].map((i) => ({ x: W - 380 + i * 80, y: 165, z: L + 26 }))));
  if (fitted === 'ssd') g.add(screws(ssdScrews().map((s): Spot => ({ x: s.x, y: 0, z: s.z })), 'y-', 2.4 * MM, mat(0x2b2e33, { metalness: 0.7, roughness: 0.4 })));
  return g;
}

/** A tray placed at its spot in the cage. */
export function trayAt(kind: CaseKind, spot: TraySpot, fitted: 'hdd' | 'ssd' | null = null): Group {
  const t = trayModel(kind, fitted);
  t.position.set(spot.x, spot.y, spot.z);
  return t;
}

/**
 * The cage, in its case's finish: its side walls (open to the fans' air, one window a tray), the guides the trays' rails ride on, the top and
 * the bottom with their slots, the folds at the front, the flanges screwed to the tray sheet at the back; and an empty tray in each bay not in `filled`.
 */
export function driveCage(p: CagePlan, kind: CaseKind = 'gamer', filled: ReadonlySet<string> = new Set()): Group {
  const g = new Group(), steel = mat(CAGE_TONE[kind], { metalness: kind === 'oem' ? 0.6 : 0.3, roughness: 0.45 }), bolt = mat(kind === 'oem' ? 0xc9cbc3 : 0x62666e, { metalness: 0.8, roughness: 0.35 });
  const wins: Span[] = p.trays.map((t) => ({ y0: -t.y - CELL_H + 90, y1: -t.y - 100, z0: p.z0 + 300, z1: p.z1 - 240, r: 60 }));
  for (const x of [p.x0, p.x1 - SHEET]) g.add(wallX(x, x + SHEET, { y0: p.top, y1: p.bottom, z0: p.z0, z1: p.z1 }, wins, steel, 2));
  // the guides under each tray's rails
  for (const t of p.trays) for (const x of [p.x0 + SHEET, p.x1 - SHEET - 46]) g.add(rectBox({ x, y: -t.y, w: 46, h: 16 }, p.z0 + 140, p.z1 - 30, steel));
  // the top and the bottom, slotted
  const slots = (): Vector2[][] => { const s: Vector2[][] = []; for (let z = p.z0 + 300; z + 60 < p.z1 - 200; z += 170) for (let x = p.x0 + 220; x + 360 < p.x1 - 180; x += 470) s.push(flatSlot(x, z, 360, 60)); return s; };
  g.add(plateY(p.x0, p.x1, p.z0, p.z1, p.top, SHEET, slots(), steel, 3), plateY(p.x0, p.x1, p.z0, p.z1, p.bottom - SHEET, SHEET, slots(), steel, 3));
  // the folds down the front edges, the flanges at the back and their screws into the tray sheet
  for (const x of [p.x0, p.x1 - 30]) g.add(rectBox({ x, y: p.top, w: 30, h: p.bottom - p.top }, p.z1 - SHEET, p.z1, steel));
  const flange = (y: number) => rectBox({ x: p.x0 - 60, y, w: p.x1 - p.x0 + 120, h: 130 }, p.z0, p.z0 + SHEET, steel);
  g.add(flange(p.top), flange(p.bottom - 130));
  const heads: Spot[] = [p.top + 65, p.bottom - 65].flatMap((y) => [p.x0 + 120, (p.x0 + p.x1) / 2, p.x1 - 120].map((x) => ({ x, y: -y, z: p.z0 + SHEET })));
  g.add(screws(heads, 'z+', 2.8 * MM, bolt));
  for (const t of p.trays) if (!filled.has(`sata${t.slot}`)) g.add(trayAt(kind, t));
  return g;
}

/** The cage's box, for the cables to keep clear of. */
export const cageBox = (p: CagePlan) => ({ min: [p.x0, -p.bottom, p.z0] as [number, number, number], max: [p.x1, -p.top, p.z1] as [number, number, number] });

/** The unseen box an empty bay is picked by: its tray and the room over it. */
export function trayHit(t: TraySpot): Mesh {
  const o = rectBox({ x: t.x, y: -(t.y + CELL_H - 40), w: TRAY.w, h: CELL_H - 40 }, t.z, t.z + TRAY.l + 30, mat(0, { transparent: true, opacity: 0, depthWrite: false }));
  o.castShadow = o.receiveShadow = false;
  return o;
}

/** The rubber-lined slot in the tray sheet behind the cage the drives' cables go back through: by their plugs, clear of the sheet's beads and lacing slots. */
export const cageGrommet = (p: CagePlan): RectLike => ({ x: p.x0 + 900, y: p.top + 220, w: 240, h: Math.max(240, p.bottom - p.top - 440) });
