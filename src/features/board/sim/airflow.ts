// Airflow zones: the case is not one lump of air. Cooling by the case fans is worked out per AREA of the case, from where the fans that turn are.
// Pure and deterministic, no state: `zoneAir` is called by the thermal model each tick. Numbers are placeholders, like the rest of thermal.ts.
//
// The areas (what the board's layout puts where; the renderer draws the same ones, room.md "The airflow lens"):
//   north  the processor, the memory, both voltage regulators: the top of the board, next to the rear exhaust and under the top fans
//   cards  the cards in the PCIe slots (graphics, neural, network, TPM): the lower left, far from the front fans
//   bay    the drives: the cage right behind the front fans
// Each area gets air from the intake fans that stand level with it (the front fans, top to bottom) and loses it to the exhaust fans that draw from it
// (the rear fan takes what crosses the case, the top fans the hot air over the processor, plus the passive vents of the shell). Air only goes THROUGH an area when both exist, so an area is ventilated by the
// harmonic mean of the two: no exhaust or no intake leaves only a little stirring. With every fan of the case turning, each area's cooling is its
// `QUALITY` times what `caseFans` gave every part before zones (CASE_FAN_K per fan), so the average case is unchanged and the corners differ.
//
// The cards warm the air (CASE_HEAT_C_PER_W per watt, thermal.ts): how much each area feels is `COUPLE` (the air leaves the cards for the rear, over the
// processor), and the less air moves through an area the more of it stays (up to `MAX_TRAPPED` times).
//
// The drives of the main cage stand in the front fans' air: each blocks a share of the fans level with it (`BAY_SHADE`, from the 3D models), and that share of
// their air does not reach the board (the processor's and the cards' areas; the bay itself is cooled by it). A full cage of hard disks costs about one front
// fan; the basement's cage under the shroud costs nothing.

import { basicFan, CASE_TIERS, caseMounts } from "./specs";
import type { DeviceKind } from "./specs";

export type AirZoneId = "north" | "cards" | "bay";
export const AIR_ZONES: readonly AirZoneId[] = ["north", "cards", "bay"];

/** The area a kind of part sits in; null for parts that do not breathe the case air (a cooler, a sink, the PSU, the monitor, a radiator). */
export function zoneOf(kind: DeviceKind): AirZoneId | null {
  switch (kind) {
    case "cpu": case "ram": return "north";
    case "gpu": case "npu": case "nic": case "tpm": return "cards";
    case "storage": return "bay";
    default: return null;
  }
}

/** How high up the case each area sits (0 top, 1 bottom): which front fans are level with it. */
const LEVEL: Record<AirZoneId, number> = { north: 0.22, cards: 0.68, bay: 0.72 };
/** How well the intake reaches an area from the east wall (the bay is right behind the fans; the cards are the far side of the board). */
const REACH: Record<AirZoneId, number> = { north: 0.75, cards: 0.55, bay: 1 };
/**
 * How strongly each exhaust draws from an area. The air that crosses the case from the front (the bay, the cards) leaves by the rear fan; the hot air
 * that rises off the processor and the regulators is the top fans' (the rear helps there too). The shell's passive vents pull like the rear, a little.
 */
const DRAW_REAR: Record<AirZoneId, number> = { north: 0.8, cards: 1, bay: 0.9 };
const DRAW_TOP: Record<AirZoneId, number> = { north: 0.9, cards: 0.25, bay: 0.1 };
const PASSIVE = 0.3;
/** A bit of stirring that even a case with no through-flow has (share of the average of the area's supply and draw). */
const STIR = 0.1;
/** How far the fans of the case cool each area when they all turn, against the old uniform value (the average of the three is about 1). */
export const QUALITY: Record<AirZoneId, number> = { north: 1.1, cards: 0.85, bay: 1 };
/** How much of the cards' heat each area feels when the air moves as it should (a graphics or neural card does not warm itself, but the network card and the TPM beside it feel the rest; the processor's side and the bay average 1). */
const COUPLE: Record<AirZoneId, number> = { north: 1.25, cards: 0.6, bay: 0.75 };
/** The most the heat of the cards can pile up in an area with almost no air, as a multiple. */
export const MAX_TRAPPED = 3;

/** Of the drive bays, the basement's cage under the shroud holds the first (sata0, sata1): out of the front fans' air, its drives cost no airflow. */
export const BASE_BAYS = 2;
type Shade = readonly (readonly number[])[];
/**
 * The share of each front fan's face (top to bottom) that a drive in a bay of the main cage blocks, per case tier: [main bay, top down][front fan]. A hard
 * disk lies flat across the air; a 2.5-inch SSD is thin and short. Measured from the 3D models (render/three/fit.test.ts checks it against the layout).
 */
export const BAY_SHADE: readonly { hdd: Shade; ssd: Shade }[] = [
  { hdd: [[0.186, 0.087], [0, 0.283]], ssd: [[0, 0.069], [0, 0.069]] },
  { hdd: [[0, 0.283, 0], [0, 0.255, 0.019], [0, 0, 0.283], [0, 0, 0.283]], ssd: [[0, 0.069, 0], [0, 0.025, 0.035], [0, 0, 0.069], [0, 0, 0.069]] },
  { hdd: [[0, 0.21, 0], [0, 0.189, 0.014], [0, 0, 0.21], [0, 0, 0.21]], ssd: [[0, 0.049, 0], [0, 0.018, 0.025], [0, 0, 0.049], [0, 0, 0.049]] },
  { hdd: [[0, 0.156, 0], [0, 0.156, 0], [0, 0.156, 0], [0, 0.021, 0.13], [0, 0, 0.156], [0, 0, 0.156]], ssd: [[0, 0.036, 0], [0, 0.036, 0], [0, 0.036, 0], [0, 0, 0.036], [0, 0, 0.036], [0, 0, 0.036]] },
];

/** A drive in a bay: its SATA port's index (`sata<bay>`) and whether it is a hard disk. */
export interface BayDrive { bay: number; hdd: boolean }

/** The share of each front fan (top to bottom) that the drives of the main cage block, 0 to 1. */
export function cageShade(tier: number, drives: readonly BayDrive[]): number[] {
  const table = BAY_SHADE[tier], out = new Array<number>(CASE_TIERS[tier]?.fans.front ?? 0).fill(0);
  for (const d of drives) {
    const row = table && (d.hdd ? table.hdd : table.ssd)[d.bay - BASE_BAYS];
    row?.forEach((s, i) => { if (i < out.length) out[i]! += s; });
  }
  return out.map((s) => Math.min(1, s));
}

export interface ZoneAir {
  /** Case-fan equivalents cooling the area, in the units of `CASE_FAN_K` (the old `caseFans`). */
  fans: number;
  /** 0 to 1: how well the area is ventilated against the case with every fan turning (1 = as designed). */
  flow: number;
  /** How much warmer than the room the air of the area is, from the cards, C (given `cardW`). */
  riseC: number;
}

const gauss = (x: number, c: number) => Math.exp(-(((x - c) / 0.3) ** 2));

/** Supply and draw of an area for the turning fans (ids as `caseMounts`, each with its airflow); `shade` is what the main cage blocks of each front fan. */
function supplyDraw(tier: number, turning: ReadonlyMap<string, number>, shade?: readonly number[]): Record<AirZoneId, { supply: number; draw: number }> {
  const mounts = caseMounts(tier), nFront = mounts.filter((m) => m.startsWith("front")).length;
  const out = {} as Record<AirZoneId, { supply: number; draw: number }>;
  for (const z of AIR_ZONES) {
    let supply = 0, draw = PASSIVE * DRAW_REAR[z];
    for (const m of mounts) {
      const w = turning.get(m);
      if (w === undefined) continue;
      if (m.startsWith("front")) {
        const i = Number(m.slice(5)), kept = z === "bay" ? 1 : 1 - (shade?.[i] ?? 0);
        supply += w * REACH[z] * gauss((i + 0.5) / nFront, LEVEL[z]) * Math.max(0, kept);
      }
      else if (m === "rear") draw += w * DRAW_REAR[z];
      else draw += w * DRAW_TOP[z];
    }
    out[z] = { supply, draw };
  }
  return out;
}

/** The harmonic mean: 0 unless both are there. */
const through = (s: number, d: number) => (s > 0 && d > 0 ? (2 * s * d) / (s + d) : 0) + STIR * (s + d) / 2;

/**
 * The air of each area. `turning` is the ids of the case fans that turn (their own cable and the hub's); undefined means no layout is known (a model run
 * on its own with `FanPower.caseFans` only) and every area gets that count, as before zones. `cardW` is what the working cards draw, W; `heatPerW` the case heat per watt.
 * `flowOf` is the airflow of the fan on each turning mount (absent: a basic fan of the case's size). The case as designed is every mount with a basic fan:
 * `flow` is capped at 1 there, while `fans` keeps growing with high-airflow fans. `shade` is the share of each front fan the main cage's drives block (`cageShade`):
 * the case as designed has an empty cage.
 */
export function zoneAir(tier: number, turning: readonly string[] | undefined, caseFans: number, cardW: number, heatPerW: number, flowOf?: Readonly<Record<string, number>>, shade?: readonly number[]): Record<AirZoneId, ZoneAir> {
  const out = {} as Record<AirZoneId, ZoneAir>;
  if (!turning) {
    for (const z of AIR_ZONES) out[z] = { fans: caseFans, flow: 1, riseC: heatPerW * cardW };
    return out;
  }
  const size = CASE_TIERS[tier]?.fanSize, base = size ? basicFan(size).airflow : 1;
  const all = caseMounts(tier), n = all.length * base;
  const now = supplyDraw(tier, new Map(turning.map((m) => [m, flowOf?.[m] ?? base])), shade), best = supplyDraw(tier, new Map(all.map((m) => [m, base])));
  for (const z of AIR_ZONES) {
    const ratio = through(now[z].supply, now[z].draw) / Math.max(1e-6, through(best[z].supply, best[z].draw)), flow = Math.min(1, ratio);
    out[z] = { fans: n * ratio * QUALITY[z], flow, riseC: heatPerW * cardW * COUPLE[z] * Math.min(MAX_TRAPPED, 1 / Math.max(1 / MAX_TRAPPED, flow)) };
  }
  return out;
}
