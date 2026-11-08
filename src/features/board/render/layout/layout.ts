// World layout (arbitrary pixel units at zoom 1). The CPU socket sits at the origin on every board.
//
//   monitor | motherboard (IO on its west edge, power connectors on its east / top edges) | cable gutter
//           |            PSU shroud below, full width of the board plus the gutter           |
//
// Everything on the board is placed here on purpose (no random scatter); buses are routed in routes.ts.
//
// Boards are different form factors (`boardlayout.ts`): the geometry that depends on the board tier is a **live binding** (`export let`)
// that `setLayoutTier(tier)` reassigns. The renderer calls it first thing when it builds a scene, so every importer sees the current
// tier's rectangles; never copy one of these into a module-level constant.

import { BD_X, DRAM_BH, DRAM_BW, DIMM_H0, DIMM_W0, IO_X, geoOf, type TierGeo } from './boardlayout';
import { CASE_TIERS } from '../../sim/specs';
import { BASE_BAYS } from '../../sim/airflow';
import { setCaseDepth } from '@/features/room/render/three/roomplan';

export interface Rect { x: number; y: number; w: number; h: number }

/** Deterministic PRNG (mulberry32). The board art is the same on every load. */
export function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BOARD_SEED = 1337;

// ---- CPU: package, die, floorplan (centred on the origin) ----
/**
 * The die floorplan's own frame (docs/DIE.md): the die view draws its blocks, wires and text in these units. On the board the die is drawn
 * at `CPU_S` of it (a real package's proportion to the board), about the origin: `DIE` is where it lands.
 */
export const DIE_PLAN: Rect = { x: -710, y: -565, w: 1420, h: 1130 };
export const CPU_S = 0.7;
/** A rect of the die's frame where it lands on the board. */
export const onBoard = (r: Rect): Rect => ({ x: r.x * CPU_S, y: r.y * CPU_S, w: r.w * CPU_S, h: r.h * CPU_S });
/** A rect of the board in the die's frame. */
export const offBoard = (r: Rect): Rect => ({ x: r.x / CPU_S, y: r.y / CPU_S, w: r.w / CPU_S, h: r.h / CPU_S });
export const DIE: Rect = onBoard(DIE_PLAN);
/** The package (its pad rows on the 20 grid, `pkgPads`). */
export const PKG: Rect = { x: -630, y: -530, w: 1260, h: 1060 };
/** The cooler plate that sits on the package. */
export const COOLER: Rect = { x: -790, y: -690, w: 1580, h: 1380 };
/** Socket frame is PKG grown by this much; buses start at its edge. */
export const SOCKET_E = 46;
/** The printed keep-out round the socket frame (the art's corner brackets): no part stands in it. */
export const SOCKET_KEEP = 74;
/**
 * The cooler's four mounting holes round the socket (every tier: a cooler fits every board), their drill and plated ring radius. A cooler's
 * backplate threads its standoffs through them (`cooler3d.ts`); the board's lanes and parts keep `COOLER_HOLE.keep` clear of each.
 */
export const COOLER_HOLES: readonly (readonly [number, number])[] = [[-920, -860], [920, -860], [-920, 860], [920, 860]];
export const COOLER_HOLE = { r: 38, ring: 54, keep: 62 } as const;

// The floorplan of the die (blocks, links) is per architecture: cpuplans.ts, drawn by dieart.ts / dieview.ts (docs/DIE.md).

// ---- the board of the current tier (live bindings: reassigned by setLayoutTier) ----
const EMPTY: Rect = { x: 0, y: 0, w: 0, h: 0 };
const bound = (rs: Rect[]): Rect => {
  if (!rs.length) return EMPTY;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 };
};

export type RegionId = 'vrm' | 'dvrm' | 'pcie' | 'chip' | 'io' | 'atx' | 'cpw' | 'm2' | 'sata' | 'hex' | 'qr' | 'audio' | 'bat';

/** The tier's geometry (every rect of the board). */
export let GEO: TierGeo = geoOf(2);
export let BD: Rect = GEO.bd;
/** Named board regions, for hover and for the art. A region the tier lacks is an empty rect (see `REGIONS`, which skips it). */
export let BR: Record<RegionId, Rect> = regionsOf(GEO);
/** The board tier and the case tier the layout is set to. The case holds boards up to its tier: it is as big as the biggest board it holds. */
export let LAYOUT_TIER = 2;
export let LAYOUT_CASE = 2;
/** The board area of the case (the outline of the biggest board it holds): the motherboard tray, the cable gutter and the front fans follow it. */
export let CASE_BD: Rect = GEO.bd;

function regionsOf(g: TierGeo): Record<RegionId, Rect> {
  return {
    vrm: g.vrm, dvrm: g.dvrm, pcie: bound(g.pcie), chip: g.chip, io: g.io, atx: g.atx, cpw: g.cpw,
    m2: bound(g.m2), sata: bound(g.sata), hex: g.hex ?? EMPTY, qr: g.qr ?? EMPTY, audio: g.codec, bat: g.bat,
  };
}

// ---- DIMM, PCIe ----
/** One DIMM socket (up to 8, one bank east of the CPU; a tier fills as many as it has). */
export const DIMM_X = (i: number) => GEO.dimm[i]?.rect.x ?? 0;
export const DIMM_Y = (i: number) => GEO.dimm[i]?.rect.y ?? 0;
export const DIMM_W = DIMM_W0, DIMM_H = DIMM_H0;
/** M.2 connectors (slots m20, m21, ...), top to bottom. */
export let M2_SLOTS: Rect[] = GEO.m2;
/** PCIe slots (x16, x8, x4, x1 looks); a tier has the first ones. */
export let PCIE_RAILS: Rect[] = GEO.pcie;

// ---- VRM: one block north of the CPU with up to six phases, a PWM controller and the heatsink pad ----
export const VRM_MAX = 6;
/** One phase block (MOSFETs, choke, capacitors), left to right. */
export const vrmPhase = (i: number): Rect => GEO.vrmPhases[i] ?? EMPTY;
export let VRM_PWM: Rect = GEO.pwm;
/** Where a VRM heatsink bolts on: over the MOSFET strip of all phases (slot `vrm-sink0`). */
export let VRM_SINK: Rect = GEO.vrmSink;
/** One phase block of the memory (DRAM) VRM, left to right (up to five; a tier fills the first ones). */
export const DRAM_VRM_MAX = 5;
export const dramPhase = (i: number): Rect => GEO.dPhases[i] ?? EMPTY;
/** Where a memory VRM heatsink bolts on: over the MOSFET row of the DRAM phases (slot `ram-sink0`). */
export let RAM_SINK: Rect = GEO.dSink;
/** The square of the 40 mm fan a sink can carry (over the CPU regulator's sink, over the memory regulator's). */
export let VRM_FAN: Rect = GEO.vrmFan, RAM_FAN: Rect = GEO.dFan;
/** The power-good light of the VRM. */
export let VRM_LED = GEO.vrmLed;
export { DRAM_BH, DRAM_BW };

// ---- PSU (below the board, full width plus the cable gutter) ----
export let GUTTER_X = 3400;
/** The cable gutter is this much wider than it was with one PCIe socket: room for four PCIe leads next to the 24-pin and the 8-pin. */
const GUTTER_EXTRA = 330;
/** The lower compartment (PSU, drive bay, cables) moves with the board's height: this is the shift from the ATX board's. */
export let SHIFT_Y = 0;
export let PSU: Rect = { x: BD_X, y: 2750, w: 7400, h: 1100 };
/** Fan grill centre and radius on the PSU face. */
export let PSU_FAN = { x: -2450, y: 3300, r: 430 };
/** Label plate (model, capacity). */
export let PSU_LABEL: Rect = { x: -80, y: 2900, w: 1050, h: 800 };
/** Live readout panel: load gauge, temperature, fan. */
export let PSU_PANEL: Rect = { x: 1120, y: 2890, w: 2200, h: 820 };
/** The PSU unit itself (fan, label, output sockets) at the east end of the strip; the shroud with the readout fills the rest. */
export let PSU_UNIT: Rect = { x: 1500, y: 2750, w: 2500, h: 1100 };
export let VENTS: Rect = { x: -1750, y: 2880, w: 1500, h: 840 };
/** Output sockets along the PSU's top edge, by cable (x of the socket centre). Inner-to-outer order avoids cable crossings. */
export let PSU_PORTS: { pcie: number[]; atx: number; cpu: number } = { pcie: [3510, 3600, 3690, 3780], atx: 3920, cpu: 4070 };
/** The PSU's four PCIe sockets are this far apart; the PSU draws as many as its spec has leads (`PsuSpec.pcieLeads`). */
export const PCIE_PORT_PITCH = 90;
export let PORT_Y = PSU.y;
/** The heights (world y) of the ties round the PSU leads where they climb the gutter together: they line up across the leads, and the cable duct's clips sit under them. */
export const gutterTieYs = () => [PORT_Y - 760, PORT_Y - 1640, PORT_Y - 2520];
/**
 * The power supplies' real sizes (23 units a mm): `d` along the case (from the rear wall), `h` tall, `w` across the case. The two small supplies
 * are SFX units (125 x 63.5 x 100 mm), the big ones ATX (150 x 86 x 140 mm). The Mini's and the Micro's boards take only the small ones.
 */
export const PSU_FORM = { sfx: { d: 2300, h: 1460, w: 2875 }, atx: { d: 3220, h: 1978, w: 3450 } } as const;
export type PsuForm = (typeof PSU_FORM)['sfx' | 'atx'];
/** Each case's supply bay: SFX in the Mini and the Micro, ATX in the Mid and the Full (an SFX unit fits it on an adapter plate). */
export const caseForm = (caseTier: number): PsuForm => (caseTier >= 2 ? PSU_FORM.atx : PSU_FORM.sfx);
/** How much deeper each case's basement is than the old 59 mm one: room for its supply's height on the floor's rubber strips, under the shroud. */
export const BASE_GROW = [350, 350, 800, 800];

// ---- monitor (west of the board, big, 16:9 screen) ----
/** The monitor is drawn and laid out at its design size (3300 x 1995, screen 3120 x 1755) and scaled by this factor: an 18.5 inch monitor (9900 units, 430 mm at the machine's 23 units a mm, as every PC part; its 3D body is `monitor3d.ts`) next to the case. */
export const MONITOR_K = 3.0;
/** The monitor's east edge: the gap between it and the case holds the mug, then the cables' trunks by the case's rear wall. */
export const MONITOR_EAST = IO_X - 2300;
/** The screen's design size: the text and the OS screen are laid out in it, inside a container scaled by `MONITOR_K`. */
export const SCREEN_D = { w: 3120, h: 1755 };
/** Furniture that follows the case tier (the desk top is where the case's feet stand): the feet, the desk slab's thickness and the height of the space under it. */
export const FOOT = 110, DESK_SLAB = 340, DESK_UNDER = 2800;
/** The monitor's foot ends this far under its bezel (`monitorArt`: the foot ends 400 design units down): it stands on the desk. */
export const MON_STAND = 400 * MONITOR_K;
/** The desk top, and the y where the dark under the desk is complete (no floor is drawn): both follow the case. */
export let DESK_Y = 3610, FLOOR_Y = 3610 + DESK_SLAB + DESK_UNDER;
/** The monitor stands on its foot on the desk, so it follows the desk (the case tier). */
export let MONITOR: Rect = { x: MONITOR_EAST - 3300 * MONITOR_K, y: -6450, w: 3300 * MONITOR_K, h: 1995 * MONITOR_K };
export let SCREEN: Rect = { x: MONITOR.x + 90 * MONITOR_K, y: MONITOR.y + 80 * MONITOR_K, w: 3120 * MONITOR_K, h: 1755 * MONITOR_K };
/** Y of the HDMI port on the rear I/O (the video cable leaves it west, runs down the gap and enters the monitor from below). */
export const VIDEO_Y = -1150;
/** The monitor's video socket is in its underside, mouth facing down: `y` is the mouth (the plug's nose), `x` its centre. */
export let VIDEO_SOCKET = { x: 0, y: 0 };
/** The video cable's run under the monitor (y, above its foot) and its vertical run in the gap between the monitor and the case (x). */
export let VIDEO_RUN_Y = 0;
export const VIDEO_TRUNK_X = IO_X - 520;
/** The monitor's mains inlet, also in its underside, west of the video socket and over the foot's east end (the mouth). */
export let MONITOR_POWER = { x: 0, y: 0 };

// ---- assembly props: the USB key tray, the power button, the USB port ----
/**
 * The USB key rack: two rails of hooks on the wall above the monitor, five hooks a rail (10: the queue cap), a lanyard from each hook to its stick,
 * which hangs straight down (its connector pointing at the ground). The lower rail is staggered half a pitch, so its sticks hang between the upper
 * rail's. It is a wall thing with the monitor (the monitor moves with the desk, so does the rack), above the router's reach and clear of the
 * monitor's top. `TRAY` is the whole area (the rails and where the sticks hang).
 */
export const TRAY_W = 3700, TRAY_H = 2460;
export const TRAY_COLS = 5, TRAY_ROWS = 2;
/** The rack's geometry: the hooks' pitch along a rail, how far the lower rail is under the upper, the lanyard's length, and the hooks' height under the rack's top. */
export const HOOK_PITCH = 660, ROW_DROP = 700, LANYARD = 380, HOOK_Y = 260;
export let TRAY: Rect = { x: 0, y: 0, w: TRAY_W, h: TRAY_H };
/**
 * The letterbox on the wall between the router's shelf and the case: where a finished key's letter is posted (`mail.ts`). A wall thing like
 * the rack, so it follows the monitor (the case tier); clear of the router, the clock, the LAN cable's row below it and the case.
 */
export const OUTBOX_W = 1000, OUTBOX_H = 800;
export let OUTBOX: Rect = { x: 0, y: 0, w: OUTBOX_W, h: OUTBOX_H };

// ---- the PC case: chassis around the board and the PSU, with the front/top panel and the drive bay ----
/** Rear wall thickness (its outer face is the rear I/O plate's west edge: the connectors and the expansion brackets pass through it), and the top of the case. */
export const WALL_T = 170, CASE_TOP = -3400;
/** Drive bays each case has (the Mini has room for four drives, the Full tower eight): a bay beyond the board's SATA ports is locked. */
export const CASE_BAYS = [4, 6, 6, 8];
/** Of them, the bays of the basement's cage under the shroud (sata0 and sata1, `BASE_BAYS`, sim/airflow.ts): the rest are the main cage's, behind the front fans. */
export { BASE_BAYS };
/** Outer chassis. West wall at the rear I/O (keys and the HDMI cable pass through it), the front (panel, bay, power) is east. */
export let CASE: Rect = { x: IO_X, y: CASE_TOP, w: 9060, h: 7350 };
/** Inside of the chassis (glass area plus the PSU compartment). */
export let CASE_IN: Rect = { x: IO_X + WALL_T, y: CASE_TOP + 400, w: 8740, h: 6690 };
/** Top panel strip: brand, vents, disk LED, status lights, power button. */
export let CASE_PANEL: Rect = { x: IO_X, y: CASE_TOP, w: 9060, h: 400 };
/** The glass side window: motherboard area. */
export let CASE_GLASS: Rect = { x: IO_X + WALL_T, y: CASE_TOP + 400, w: 8740, h: 5250 };
/** Power button on the top panel and the status lights beside it. */
export let POWER_BTN = { x: 4660, y: CASE_TOP + 200, r: 130 };
export let CASE_LEDS = { y: CASE_TOP + 200, on: 4180, off: 4300, err: 4420, disk: 3900 };
/** The fans the case carries, seen edge-on (case.ts): the rear exhaust inside the rear wall, beside the I/O plate across the case's depth and level with the CPU, the top fans under the top panel. */
export let REAR_FAN: Rect = { x: IO_X + WALL_T, y: -1260, w: 440, h: 2120 };
/** Whether the case carries the rear fan: the sim gives the Mini no rear mount, so it has a punched exhaust grille over the same round opening. */
export let REAR_FAN_FITTED = true;
export let TOP_FANS: Rect[] = [];
/** The fan mounts the cases have on the top and the front (mini, micro, mid, full tower), from the sim's `CASE_TIERS`. */
export const TOP_FAN_COUNT = CASE_TIERS.map((c) => c.fans.top), FRONT_FAN_COUNT = CASE_TIERS.map((c) => c.fans.front);
/** A fan's frame side from its size in mm (23 units a mm: a 92 mm fan is 2120). */
export const fanLen = (mm: number): number => Math.round((mm * 23) / 20) * 20;
/**
 * Every fan mount of a case takes one size (the sim's `fanSize`): a frame this thick (a 25 mm fan, `fanDepth`) and this long on each side (front,
 * top and rear), so a fan reads the same wherever it sits. The first top fan stands clear of the rear fan by a radiator's end tank (`TOP_FAN_X0`).
 */
export const TOP_FAN_T = 575;
export let FAN_LEN = fanLen(92), TOP_FAN_PITCH = FAN_LEN + 80, TOP_FAN_X0 = -1625;
/**
 * A radiator's core by grade (slim, thick, big: 27, 36 and 45 mm thick, as the cooling it adds; 27 mm is an all-in-one loop's), `RAD_GAP` inboard
 * of the fans of its side. Each side with fan mounts keeps room for the thickest inboard of its fans (`RAD_ROOM`), and for an end tank past the fans
 * at each end (`RAD_TANK`: 17 mm).
 */
export const RAD_T = [621, 828, 1035] as const, RAD_GAP = 20, RAD_ROOM = RAD_GAP + RAD_T[2], RAD_TANK = 400;
/** Where the rear fan ends (layout y): above the first expansion slot and its retention bar, whatever its size. */
const REAR_FAN_END = 860;
/**
 * The drive bays: two cages along the case's front, east of the cable gutter, one over the other (cell i = slot sata<i>; the case's bays,
 * `CASE_BAYS`, those beyond the board's SATA ports are locked). The basement's cage under the shroud holds the first `BASE_BAYS`, out of the front
 * fans' air as a real one, so the first drives cost the case no air; the main cage on the shroud holds the rest, its bottom in line with the board's.
 * Each cage top down, as the board's ports (the 2D's cables cross only from one cage to the other). `BAY` is the main cage's outline.
 */
export let BAY: Rect = { x: 4180, y: 2700, w: 880, h: 1230 };
export let BAY_CELLS: Rect[] = [];
/** Cell size and pitch in the cage (the drive art is drawn at its design size, 700 x 500, and scaled to the cell). */
export const CELL_W = 1050, CELL_H = 725, CELL_PITCH = 785;
/** The 3D drive cage's length along the case (drivecage3d.ts): a 3.5 in. drive lies across it on its tray, 109 mm with the walls; the 2D cells sit at its west end. */
export const CAGE_W = 2500;
/** Width of a front fan module (seen edge-on) east of the cage: a fan's thickness (`TOP_FAN_T`). */
export const FAN_W = TOP_FAN_T;
/** How far under the Mini's top its front fans start: under the bay covers of its face. */
export const MINI_FAN_Y = 1880;
/** x of the SATA power lead that runs up the cage's west side (from the PSU), and the cage's west edge. */
export let POWER_LEAD_X = 4070;
/**
 * The fan hub in the basement (on the tray sheet west of the basement's drive cage, where the shroud's side is open): a small board that feeds every
 * case fan. It takes power on a SATA socket on its west edge (`HUB_POWER_Y` is the socket's y), its control from the board's SYS_FAN header over a
 * cable that runs under the board (see `fanTrunkArt` in case.ts), and sends a cable to each fan, which goes behind the tray through `FAN_SLOT` (under the shroud's top).
 */
export let FAN_HUB: Rect = { x: 4180, y: 3000, w: 1100, h: 520 };
/** The power supply's east face in the basement (basement3d.ts `psu`, at the case's back corner): the hub's power lead comes from it. */
export let PSU_FACE_X = 0;
export let FAN_SLOT: Rect = { x: 4240, y: 2800, w: 980, h: 70 };
export let HUB_POWER_Y = 3200;
/**
 * Where a drive's SATA data cable runs (`sataCablePath` in case.ts): out of the board port east, along the port's row to its own
 * column (`col`, west to east in port order, east to west for the basement's cage, so no two cables of a cage cross), up or down the column to the drive's data plug (cell y + `plug`) and
 * east into it. The columns sit between the PSU cables' gutter and the cage.
 */
export let SATA_LINK: { plug: number; col: number }[] = [];
/** Board port rect for SATA index i. */
export const sataPort = (i: number): Rect => GEO.sata[i] ?? EMPTY;

/** The USB-A port on the rear I/O panel that keys plug into (its mouth faces west). */
export const USB_PORT: Rect = { x: IO_X + 18, y: -54, w: 290, h: 108 };
/** The PC's mains inlet on the rear wall, at the PSU's end (mouth facing west; `y` follows the PSU, so the case tier). */
export let PC_POWER = { x: IO_X, y: 2550 };
/** The PSU's own exhaust fan in the rear wall, seen edge-on, at the PSU compartment: the Micro, Mid and Full carry one (the Mini does not), the mains inlet sits below it. */
export let PSU_REAR_FAN: Rect | null = null;
/** HDMI socket on the rear I/O panel (the video plug goes here). */
export const HDMI_PORT: Rect = { x: IO_X, y: VIDEO_Y - 60, w: 240, h: 120 };

// ---- network props (docs/render/net.md "Network"): the router stands on a shelf above the monitor, the ISP's wall plate is under the desk by the power socket ----
/** Scale of the network props (router, wall plate) against their design size. */
export const NET_K = 1.45;
/** The router is right-aligned to this x on its shelf (its footprint depends on the tier). */
export const ROUTER_EAST = MONITOR_EAST - 300;
/** The shelf line the router stands on (above the monitor, so it follows the desk), and the y where the cables turn after leaving their sockets. */
export let SHELF_Y = -2480;
export let CABLE_ROW_Y = SHELF_Y + 200;
export let ROUTER_SPOT: Rect = { x: ROUTER_EAST - 1600 * NET_K, y: SHELF_Y - 420 * NET_K, w: 1600 * NET_K, h: 420 * NET_K };
/** The power socket plate on the wall under the desk (two outlets: the monitor's, the PC's). */
/** Where the PC's mains cord drops: it leaves the plug's tail (the plug is 330 long, the cord turns down 150 beyond it) and falls straight to its outlet. */
export const PC_CORD_X = IO_X - 476;
export const POWER_PLATE_W = 1500, PC_OUTLET_AT = 0.72;
export let POWER_PLATE: Rect = { x: PC_CORD_X - POWER_PLATE_W * PC_OUTLET_AT, y: 0, w: POWER_PLATE_W, h: 800 };
/** The ISP's wall plate, under the desk next to the power socket, its jack position (bottom edge, `WALL_Y`) and the y of the ISP cable's turn under the desk (the cable then runs up behind the desk, the riser and the monitor to the router). */
const WALL_PLATE_X = IO_X - 2690;
export let WALL_PLATE: Rect = { x: WALL_PLATE_X, y: 0, w: 460 * NET_K, h: 420 * NET_K };
export let WALL_Y = 0;
export let WALL_JACK = { x: WALL_PLATE.x + WALL_PLATE.w / 2, y: 0 };
export let ISP_ROW_Y = 0;
/** Vertical run of the ethernet cable in the gap between the monitor and the case (west of the PC's power plug and cord; a plugged key is drawn over it). */
export const LAN_TRUNK_X = IO_X - 950;
/** Onboard ethernet jack on the rear I/O (mouth faces west) and the plug length of an ethernet plug. */
export const ETH0_MOUTH = { x: IO_X + 10, y: -1560 };
export const ETH0_RECT: Rect = { x: IO_X + 10, y: -1622, w: 170, h: 124 };
export const PLUG_L = 200, PLUG_W = 100;
/** NIC card geometry: the bracket sits at the board's west edge, the jack pokes out of it (mouth faces west); `i` is the PCIe slot index. */
export const nicY = (i: number) => PCIE_RAILS[i]!.y + 30;
export const NIC_BRACKET_X = BD_X - 30;
export const nicJack = (i: number): Rect => ({ x: BD_X - 200, y: nicY(i) - 62, w: 170, h: 124 });
/** A graphics card's display port on the rear plate, at the height of its slot (the video cable's plug goes in here instead of the board's HDMI port, `HDMI_PORT`). */
export const gpuPort = (i: number): Rect => ({ x: HDMI_PORT.x, y: nicY(i) - HDMI_PORT.h / 2, w: HDMI_PORT.w, h: HDMI_PORT.h });
/** A NIC's length from the board's west edge: real low-profile cards, 115, 135 and 145 mm (23 units a mm). */
export const NIC_LEN: Record<string, number> = { 'nic-gbe': 2645, 'nic-10g': 3105, 'nic-40g': 3335 };
export const nicRect = (i: number, visual: string): Rect => ({ x: nicJack(i).x, y: nicY(i) - 98, w: BD_X - nicJack(i).x + (NIC_LEN[visual] ?? 1500), h: 196 });

/**
 * Everything the camera should see at once (board, PSU, monitor, cables, tray): the content box, tightly. Its
 * extent is the monitor / tray column on the west (x -7500) and the case's east wall (x 5260), and the case top (y -3100) to
 * the feet (y 4360). Nothing else in the scene reaches outside it (the device bake uses it as its frame).
 */
export let WORLD: Rect = { x: MONITOR.x - 80, y: -3140, w: 5300 - (MONITOR.x - 80), h: 7540 };
/** Fit margin for the overview (`fit(WORLD, OVERVIEW_MARGIN)`): the content fills the free area, with a small border. */
export const OVERVIEW_MARGIN = 0.96;
/** A free area narrower than this (width over height) is a phone held upright: the overview frames the case alone (`overviewFrame`). */
export const PORTRAIT_ASPECT = 0.8;
/**
 * What the overview frames in a free area of this aspect (width over height). A wide or square area gets the whole scene (`WORLD`), down
 * to the foot of the wall plate under the desk (it shows the internet plan and is where the cable goes). A tall one (under
 * `PORTRAIT_ASPECT`) gets the case alone, from its top to the desk: the whole scene would be a thin strip there. The player pans west to
 * the monitor and the key tray (the camera's bounds are the room).
 */
export function overviewFrame(aspect: number): Rect {
  if (aspect < PORTRAIT_ASPECT) return { x: CASE.x - 200, y: CASE.y - 200, w: CASE.w + 400, h: DESK_Y - CASE.y + 400 };
  return { x: WORLD.x, y: WORLD.y, w: WORLD.w, h: Math.max(WORLD.h, WALL_PLATE.y + WALL_PLATE.h + 200 - WORLD.y) };
}

// ---- hover region list (ids are the contract with the UI); only the regions the tier has ----
const REGION_IDS: [string, RegionId][] = [
  ['vrm', 'vrm'], ['vrm2', 'dvrm'], ['pcie', 'pcie'], ['chipset', 'chip'], ['io', 'io'], ['atx', 'atx'], ['cpw', 'cpw'], ['m2', 'm2'],
  ['sata', 'sata'], ['bat', 'bat'], ['audio', 'audio'], ['hex', 'hex'], ['qr', 'qr'],
];
export let REGIONS: { id: string; rect: Rect }[] = [];

/** Point every tier-dependent binding at this tier's board (call before building anything). */
/**
 * What the far board texture covers: the board and its rear I/O plate (the plate stands in the case's west wall, outside the board's own
 * rectangle), `pad` around both. Without the plate the far view lost the back panel and the ports the plugs go into.
 */
export function boardBakeFrame(bd: Rect, io: Rect, pad = 40): Rect {
  const x0 = Math.min(bd.x, io.x) - pad, y0 = Math.min(bd.y, io.y) - pad, x1 = Math.max(bd.x + bd.w, io.x + io.w) + pad, y1 = Math.max(bd.y + bd.h, io.y + io.h) + pad;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function setLayoutTier(tier: number, caseTier = tier): void {
  const g = geoOf(tier), cg = geoOf(Math.max(tier, caseTier));
  GEO = g; LAYOUT_TIER = g.tier; LAYOUT_CASE = cg.tier; CASE_BD = cg.bd; BD = g.bd; BR = regionsOf(g); PCIE_RAILS = g.pcie;
  M2_SLOTS = g.m2; VRM_PWM = g.pwm; VRM_SINK = g.vrmSink; RAM_SINK = g.dSink; VRM_LED = g.vrmLed; VRM_FAN = g.vrmFan; RAM_FAN = g.dFan;
  // the lower compartment and the case follow the board: the PSU shroud runs under the board and the cable gutter, the drive bay
  // sits at its east end, the case closes round them
  const east = cg.bd.x + cg.bd.w, south = cg.bd.y + cg.bd.h, dy = south - 2500;
  SHIFT_Y = dy;
  GUTTER_X = east;
  // four PCIe sockets (90 apart, innermost first), then the 24-pin and the 8-pin; the gutter is wide enough for all six cables
  PSU_PORTS = { pcie: [0, 1, 2, 3].map((k) => east + 110 + k * PCIE_PORT_PITCH), atx: east + 540, cpu: east + 690 };
  const psuEast = east + 600 + GUTTER_EXTRA, psuW = psuEast - BD_X;
  PSU = { x: BD_X, y: south + 250, w: psuW, h: 1100 };
  PORT_Y = PSU.y;
  PSU_REAR_FAN = cg.tier >= 1 ? { x: IO_X + 14, y: PSU.y + 40, w: WALL_T - 28, h: 700 } : null;
  // (the inlet at the middle of the supply's rear: its bay stands on the 3 mm rubber strips, basement3d's `PSU_FEET`, on the basement's floor 150 over the case's bottom)
  PC_POWER = { x: IO_X, y: south + 1530 + (BASE_GROW[cg.tier] ?? 0) - caseForm(cg.tier).h / 2 };
  // the unit sits at the east end under the cable sockets; the shroud (readout panel at its west end, then the vents) fills the rest
  PSU_UNIT = { x: psuEast - 2500, y: PSU.y, w: 2500, h: PSU.h };
  PSU_FAN = { x: PSU_UNIT.x + 640, y: PSU.y + 550, r: 430 };
  PSU_LABEL = { x: PSU_UNIT.x + 1330, y: PSU.y + 190, w: 1000, h: 790 };
  PSU_PANEL = { x: PSU.x + 170, y: PSU.y + 140, w: 2200, h: 820 };
  VENTS = { x: PSU_PANEL.x + PSU_PANEL.w + 150, y: PSU.y + 130, w: Math.max(0, PSU_UNIT.x - 70 - 150 - (PSU_PANEL.x + PSU_PANEL.w + 150)), h: 840 };
  // the bays, each cage top down: the basement's on its floor (basement3d's floor, 150 over the case's bottom; its cage stands on it), then the main
  // cage's, bottom-aligned with the board
  const cells = CASE_BAYS[cg.tier] ?? cg.sata.length, main = cells - BASE_BAYS, cageX = east + 800 + GUTTER_EXTRA, floor = south + 1600 + (BASE_GROW[cg.tier] ?? 0);
  const cellY = (i: number) => (i < BASE_BAYS ? floor - 60 - CELL_H - (BASE_BAYS - 1 - i) * CELL_PITCH : south - 100 - CELL_H - (cells - 1 - i) * CELL_PITCH);
  BAY_CELLS = Array.from({ length: cells }, (_, i) => ({ x: cageX, y: cellY(i), w: CELL_W, h: CELL_H }));
  const y0 = cellY(BASE_BAYS);
  BAY = { x: cageX - 160, y: y0 - 110, w: CELL_W + 240, h: (main - 1) * CELL_PITCH + CELL_H + 190 };
  POWER_LEAD_X = cageX - 130;
  FAN_HUB = { x: cageX - 1300, y: south + 470, w: 1140, h: 780 };
  FAN_SLOT = { x: FAN_HUB.x + 60, y: FAN_HUB.y - 180, w: FAN_HUB.w - 120, h: 70 };
  HUB_POWER_Y = south + 760;
  // (a cable down to the basement's cage keeps east of the one under it: those columns run the other way)
  SATA_LINK = BAY_CELLS.map((_, i) => ({ plug: 202, col: east + 510 + GUTTER_EXTRA + (i < BASE_BAYS ? BASE_BAYS - 1 - i : i) * 22 }));
  // the case's fan size sets the mounts' length and the case's depth
  const mounts = CASE_TIERS[cg.tier]!;
  FAN_LEN = fanLen(mounts.fanSize); TOP_FAN_PITCH = FAN_LEN + 80;
  setCaseDepth(cg.tier, FAN_LEN);
  // the front fans stand in front of the cage (its 3D length, `CAGE_W`) with a radiator's room between (`RAD_ROOM`), the perforated front panel closes the glass
  const glassEast = cageX + CAGE_W + 70 + RAD_ROOM + FAN_W + 20 + 170;
  // the case's top: over the board's head room (the 8-pin cable's); over the front stack, from the top (a radiator's end tank over and under the
  // fans, room under it for the last fan's cable stub, over the case's inner floor: the Mini's fans start under the bay covers of its face,
  // `frontFanRects`); and with top fans over their stack (the fans and a radiator's room under them, clear of the tall parts at the board's top
  // edge, the VRM and memory sinks of every board the case holds and their fans: the radiator hangs in front of the board's top strip, above the low parts)
  const nf = mounts.fans.front, stack = (cg.tier === 0 ? MINI_FAN_Y : 440 + RAD_TANK) + nf * FAN_LEN + (nf - 1) * 20 + RAD_TANK + 100;
  const tall = Math.min(...Array.from({ length: cg.tier + 1 }, (_, t) => { const tg = geoOf(t); return Math.min(tg.vrmSink.y, tg.dSink.y, tg.vrmFan.y, tg.dFan.y); }));
  const headTop = mounts.fans.top > 0 ? tall - 60 - (40 + TOP_FAN_T + RAD_ROOM) - 400 : Infinity;
  const ce = glassEast + 160, caseW = ce - IO_X, top = Math.min(cg.bd.y - (cg.tier === 0 ? 350 : 500) - 400, south + 1490 - stack, headTop), grow = BASE_GROW[cg.tier] ?? 0, bottom = south + 1750 + grow;
  CASE = { x: IO_X, y: top, w: caseW, h: bottom - top };
  CASE_IN = { x: IO_X + WALL_T, y: top + 400, w: glassEast - (IO_X + WALL_T), h: south + 1490 + grow - (top + 400) };
  PSU_FACE_X = CASE_IN.x + 20 + caseForm(cg.tier).d;
  CASE_GLASS = { x: CASE_IN.x, y: top + 400, w: CASE_IN.w, h: south + 50 - (top + 400) };
  CASE_PANEL = { x: IO_X, y: top, w: caseW, h: 400 };
  POWER_BTN = { x: ce - 600, y: top + 200, r: 130 };
  CASE_LEDS = { y: top + 200, on: ce - 1080, off: ce - 960, err: ce - 840, disk: ce - 1360 };
  REAR_FAN = { x: CASE_IN.x, y: REAR_FAN_END - FAN_LEN, w: FAN_W, h: FAN_LEN };
  REAR_FAN_FITTED = cg.tier >= 1;
  TOP_FAN_X0 = REAR_FAN.x + REAR_FAN.w + 40 + RAD_TANK;
  TOP_FANS =Array.from({ length: TOP_FAN_COUNT[cg.tier] ?? 0 }, (_, k) => ({ x: TOP_FAN_X0 + k * TOP_FAN_PITCH, y: CASE_IN.y + 40, w: FAN_LEN, h: TOP_FAN_T }));  // the desk top is where the case's feet stand; the monitor, the key tray, the router and the plates all follow it
  DESK_Y = bottom + FOOT; FLOOR_Y = DESK_Y + DESK_SLAB + DESK_UNDER;
  const MW = 3300 * MONITOR_K, MH = 1995 * MONITOR_K;
  MONITOR = { x: MONITOR_EAST - MW, y: DESK_Y - MON_STAND - MH, w: MW, h: MH };
  SCREEN = { x: MONITOR.x + 90 * MONITOR_K, y: MONITOR.y + 80 * MONITOR_K, w: 3120 * MONITOR_K, h: 1755 * MONITOR_K };
  const by = MONITOR.y + MONITOR.h;
  VIDEO_SOCKET = { x: MONITOR.x + MW - 388 * MONITOR_K, y: by }; // where the cable comes out from behind the bezel (its end is built into the monitor)
  VIDEO_RUN_Y = by + 700;
  MONITOR_POWER = { x: MONITOR.x + MW - 900 * MONITOR_K, y: by }; // where its cord comes out from behind the monitor (built in as well)
  TRAY = { x: MONITOR.x + 1700, y: MONITOR.y - 2800, w: TRAY_W, h: TRAY_H };
  OUTBOX = { x: IO_X - 1900, y: MONITOR.y - 1900, w: OUTBOX_W, h: OUTBOX_H };
  SHELF_Y = MONITOR.y - 700; CABLE_ROW_Y = SHELF_Y + 200;
  ROUTER_SPOT = { x: ROUTER_EAST - 1600 * NET_K, y: SHELF_Y - 420 * NET_K, w: 1600 * NET_K, h: 420 * NET_K };
  POWER_PLATE = { x: PC_CORD_X - POWER_PLATE_W * PC_OUTLET_AT, y: FLOOR_Y - 1750, w: POWER_PLATE_W, h: 800 };
  WALL_PLATE = { x: WALL_PLATE_X, y: FLOOR_Y - 1750, w: 460 * NET_K, h: 420 * NET_K };
  WALL_Y = WALL_PLATE.y + WALL_PLATE.h;
  WALL_JACK = { x: WALL_PLATE.x + WALL_PLATE.w / 2, y: WALL_Y };
  ISP_ROW_Y = WALL_Y + 360;
  const wx = MONITOR.x - 120, wy = Math.min(top - 40, ROUTER_SPOT.y - 60, TRAY.y - 80);
  WORLD = { x: wx, y: wy, w: ce + 40 - wx, h: bottom + 150 - wy };
  REGIONS = REGION_IDS.filter(([, k]) => BR[k].w > 0).map(([id, k]) => ({ id, rect: BR[k] }));
}
setLayoutTier(2);
