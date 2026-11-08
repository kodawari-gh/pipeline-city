import type { Snapshot } from '@/worker/protocol';

// What a component tells the airflow view (room/render/desk/airflow.ts). The view knows no part: each feature that makes heat or moves air
// exports one `AirSource` from its own `render/air.ts`, and the list is `AIR_SOURCES` (room/render/desk/airsources.ts). A new part with thermals
// adds its source there; `airsources.test.ts` fails while a part kind with thermals has none.

export interface Box { x: number; y: number; w: number; h: number }

/**
 * A part that warms the air. The glow follows the part's own silhouette: `ids[k]` is the hover id of `rects[k]` (its device id), whose `Shape` (read from
 * the art, `scene.shapes`) the lens traces; with no id or no shape yet the rect is the fallback. `heat` is 0 (cool) to 1 (at its limit).
 */
export interface AirHeat { id: string; label: string; rects: Box[]; ids?: (string | null)[]; tempC: number; heat: number;
  /** A flat part (an M.2 drive, the processor, a regulator phase): it warms the air but stands too low to be in its way, so the air passes over it. */
  flat?: boolean }

/**
 * A fan that is not one of the case's. The lens draws it (`rotor`: a round fan seen face on; `edge`: strips seen edge-on, like the case fans) and a
 * stream from it, as strong as its real speed (`fanBank`, by `id`). The stream goes along `path` when the part knows where its air comes from and goes
 * (the PSU draws from below the case and blows out the rear), else a short one toward the nearest way out of the case.
 */
export interface AirFan {
  id: string;
  rect: Box;
  rotor?: { x: number; y: number; r: number; blades: number };
  edge?: Box[];
  path?: [number, number][];
  /** The part is drawn but moves no air (a loop's pump moves coolant): no stream from it. */
  noStream?: boolean;
  /** A fan that blows down onto a heatsink (the stock cooler's): its air leaves sideways all round, as a ring of this radius round the rotor. */
  ring?: number;
}

export interface AirCtx {
  s: Snapshot;
  /** Slot id to its world rect. */
  slots: Map<string, Box>;
  /** The machine runs (`machineLive`): nothing is hot or moving while it does not. */
  live: boolean;
}

export interface AirSource {
  id: string;
  /** The device kinds this source answers for (a kind with thermals that no source claims fails the coverage test). */
  kinds: string[];
  heat?(c: AirCtx): AirHeat[];
  fans?(c: AirCtx): AirFan[];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const clampHeat = clamp01;

/** How hot a part is, 0 (cool) to 1 (at the point where it throttles). */
export const heatOf = (tempC: number) => clamp01((tempC - 30) / 55);

/** The usual source of heat: the devices of some kinds (in the slots `only` takes), grouped as one zone (all the RAM sticks together), hot at the hottest. */
export function deviceHeat(kinds: string[], id: string, label: string, c: AirCtx, flat = false, only?: (slot: string) => boolean): AirHeat[] {
  const rects: Box[] = [], ids: string[] = [];
  let tempC = 0;
  for (const d of c.s.devices) {
    if (!kinds.includes(d.kind) || (only && !only(d.slot))) continue;
    const r = c.slots.get(d.slot);
    if (!r) continue;
    rects.push(r); ids.push(d.id);
    tempC = Math.max(tempC, d.tempC);
  }
  return rects.length ? [{ id, label, rects, ids, tempC, heat: c.live ? heatOf(tempC) : 0, ...(flat ? { flat } : {}) }] : [];
}
