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

import { caseMounts } from "./specs";
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

export interface ZoneAir {
  /** Case-fan equivalents cooling the area, in the units of `CASE_FAN_K` (the old `caseFans`). */
  fans: number;
  /** 0 to 1: how well the area is ventilated against the case with every fan turning (1 = as designed). */
  flow: number;
  /** How much warmer than the room the air of the area is, from the cards, C (given `cardW`). */
  riseC: number;
}

const gauss = (x: number, c: number) => Math.exp(-(((x - c) / 0.3) ** 2));

/** Supply and draw of an area for a set of turning fans (ids as `caseMounts`), each 0 to its best case. */
function supplyDraw(tier: number, turning: ReadonlySet<string>): Record<AirZoneId, { supply: number; draw: number }> {
  const mounts = caseMounts(tier), nFront = mounts.filter((m) => m.startsWith("front")).length;
  const out = {} as Record<AirZoneId, { supply: number; draw: number }>;
  for (const z of AIR_ZONES) {
    let supply = 0, draw = PASSIVE * DRAW_REAR[z];
    for (const m of mounts) {
      if (!turning.has(m)) continue;
      if (m.startsWith("front")) supply += REACH[z] * gauss((Number(m.slice(5)) + 0.5) / nFront, LEVEL[z]);
      else if (m === "rear") draw += DRAW_REAR[z];
      else draw += DRAW_TOP[z];
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
 */
export function zoneAir(tier: number, turning: readonly string[] | undefined, caseFans: number, cardW: number, heatPerW: number): Record<AirZoneId, ZoneAir> {
  const out = {} as Record<AirZoneId, ZoneAir>;
  if (!turning) {
    for (const z of AIR_ZONES) out[z] = { fans: caseFans, flow: 1, riseC: heatPerW * cardW };
    return out;
  }
  const all = caseMounts(tier), n = all.length;
  const now = supplyDraw(tier, new Set(turning)), best = supplyDraw(tier, new Set(all));
  for (const z of AIR_ZONES) {
    const flow = Math.min(1, through(now[z].supply, now[z].draw) / Math.max(1e-6, through(best[z].supply, best[z].draw)));
    out[z] = { fans: n * flow * QUALITY[z], flow, riseC: heatPerW * cardW * COUPLE[z] * Math.min(MAX_TRAPPED, 1 / Math.max(1 / MAX_TRAPPED, flow)) };
  }
  return out;
}
