// A roof being filled (`roof.ts` places its bulkhead and solar panels, `plant.ts` the rest): what each piece reads.
import type { Mass } from './mass';
import type { Building, Place, Rect } from './types';

/** A roof being filled: its rect r at height y, its sizes, its building and stream, `fine` (near enough for the small things), and its places. */
export interface Roof {
  m: Mass;
  r: Rect;
  y: number;
  w: number;
  d: number;
  /** A roof's share of things grows with its size. */
  large: number;
  b: Building;
  rand: () => number;
  fine: boolean;
  place: Place;
}
