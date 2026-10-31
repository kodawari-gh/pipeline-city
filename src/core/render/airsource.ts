import type { Snapshot } from '@/worker/protocol';

// What a component tells the airflow view (room/render/desk/airflow.ts). The view knows no part: each feature that makes heat or moves air
// exports one `AirSource` from its own `render/air.ts`, and the list is `AIR_SOURCES` (room/render/desk/airsources.ts). A new part with thermals
// adds its source there; `airsources.test.ts` fails while a part kind with thermals has none.

export interface Box { x: number; y: number; w: number; h: number }

/** A part that warms the air. The glow follows `rects` (one per part, e.g. every stick of RAM); `heat` is 0 (cool) to 1 (at its limit). */
export interface AirHeat { id: string; label: string; rects: Box[]; tempC: number; heat: number }

/** A fan that is not one of the case's: the lens draws a stream from it, as strong as its real speed (`fanBank`, by `id`). */
export interface AirFan { id: string; rect: Box }

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

/** The usual source of heat: the devices of some kinds, grouped as one zone (all the RAM sticks together), hot at the hottest. */
export function deviceHeat(kinds: string[], id: string, label: string, c: AirCtx): AirHeat[] {
  const rects: Box[] = [];
  let tempC = 0;
  for (const d of c.s.devices) {
    if (!kinds.includes(d.kind)) continue;
    const r = c.slots.get(d.slot);
    if (!r) continue;
    rects.push(r);
    tempC = Math.max(tempC, d.tempC);
  }
  return rects.length ? [{ id, label, rects, tempC, heat: c.live ? heatOf(tempC) : 0 }] : [];
}
