// The city's buildings (`../plan.ts` places them, `building.ts` builds each) on one material (`facade.ts`), a mesh for each ring
// round the window (`../sweep.ts` cuts each to what the camera sees). A building is its tiers' walls, each wall's facade painted by the
// shader (`facadeMaterial`): its windows in bays and storeys on slim mullions, the glass over a room seen in depth (interior mapping) with its
// blind or curtains, mirroring the sky, the street's far side and the city's skyline beyond, with the sun's glare and a rare pane's short glint (under the bloom's threshold) on it; the
// walls in panels and tiles with their joints, slab edges and stains. At night its rooms are lit by each building's own habit (whole floors, zones,
// desks or stacks; a home room by room), gathered in patches, each in its lamp's colour, and some turn on or off as the night goes. Far away each
// pattern fades to its average where its scale is under a pixel, so it does not shimmer. The sky's light falls off down a wall toward the street.
// A flat block near the window has its balconies. On the roofs: a parapet, a membrane, gravel, sedum or pavers, a stair and lift bulkhead with its
// door, plant boxes, water tanks, solar panels, skylights, vents, air-conditioning units. The near roofs have the room's detail: the membrane's
// seams and its flashing up the parapet, the rain's ponds and grime, a framed steel door on a step with a lamp and a canopy over it, plant boxes
// on kerbs with their grilles, vent pipes in their boots and mushroom vents; the towers' masts, spires, lit lanterns and plant
// screens, their LED bands, the red beacons blinking at night. The tall landmarks wear their own light after dark (a floodlit head, lit edges, a
// lit crown; the tallest's a stepped spire), so the skyline is known by its shapes. A quiet few signs of abstract glyphs (no real words), neon or lit boxes, and shop fronts
// each in its own light. A thin lit thing keeps a pixel's width far off, or it would flash as the view moves.
import type { BufferGeometry, Sphere } from 'three';
import { LOW_NEAR_RINGS } from '../detail';
import { GRID } from '../plan';
import { ballOf, bearing } from '../sweep';
import { footOf } from './basics';
import { block, building } from './building';
import { Mass } from './mass';
import { CLUTTER } from './roof';
import type { Building, CityDetail, SignWash } from './types';

/** The rings round the window (m: each one's outer edge) whose buildings make one geometry each: a draw, cut to what the camera sees (`sweep.ts`). */
const RINGS = [150, 300, 600, CLUTTER, 1800, 3600, Infinity] as const;
/** At Low, a building within this distance of the window (m, a ring's edge) is whole, as High's; past it, a plain block (`block`). */
export const LOW_WHOLE = 600;

/** A ring's buildings: their geometry, each building's ball, and where each one's vertices start in it (then their end). */
export interface MassRing {
  geometry: BufferGeometry;
  balls: Sphere[];
  at: number[];
}

/** How far a building is from the window (m): its foot's middle from the avenue's, and out. */
function awayOf(b: Building): number {
  const t = footOf(b);
  return Math.hypot((t.x0 + t.x1) / 2 - GRID.av0, t.z1);
}

/** A building's bearing from the window: its foot's middle's. */
function midOf(b: Building): number {
  const t = footOf(b);
  return bearing((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2);
}

/** The buildings in their rings, nearest first. At Low the rings past the near ones are one (`far`, the last). */
function ringsOf(bs: readonly Building[], low: boolean): { made: Building[][]; far: Building[] } {
  const rings = RINGS.map(() => [] as Building[]);
  for (const b of bs) {
    const ring = rings[RINGS.findIndex((r) => awayOf(b) < r)];
    if (ring === undefined) {
      throw new Error('a building past every ring');
    }
    ring.push(b);
  }
  // At Low the rings past the near ones merge into one mesh. A building within `LOW_WHOLE` is whole (its parapet, its roof's plant and its
  // signs are High's: the window looks down on them); past it, a plain block
  const far = low ? rings.slice(LOW_NEAR_RINGS).flat() : [];
  return { made: (low ? [...rings.slice(0, LOW_NEAR_RINGS), far] : rings).filter((r) => r.length > 0), far };
}

/** The buildings, one geometry for each ring round the window, each ring's buildings in their bearing's order. `washes` takes the signs that light a wall (`signlight.ts`). */
export function massGeometries(
  bs: readonly Building[],
  washes: SignWash[] = [],
  detail: CityDetail = 'high',
): MassRing[] {
  const run = massSteps(bs, washes, { detail, budget: Infinity });
  let step = run.next();
  while (step.done !== true) {
    step = run.next();
  }
  return step.value;
}

/**
 * `massGeometries` a building at a time: it yields when `budget` ms have passed since its last yield (or its start), so a caller can give the page
 * a turn. The boot builds the rings while the baked textures load (`OutsideView.make`): a turn every 20 ms lets that load go on.
 */
export function* massSteps(
  bs: readonly Building[],
  washes: SignWash[] = [],
  { detail = 'high', budget = 20 }: { detail?: CityDetail; budget?: number } = {},
): Generator<void, MassRing[]> {
  const low = detail === 'low',
    { made, far } = ringsOf(bs, low),
    out: MassRing[] = [];
  let from = performance.now();
  for (const [k, ring] of made.entries()) {
    const m = new Mass(),
      balls: Sphere[] = [],
      at = [0],
      blocks = low && k === made.length - 1 && far.length > 0;
    m.washes = washes;
    for (const b of ring.toSorted((p, q) => midOf(p) - midOf(q))) {
      const away = awayOf(b);
      if (blocks && away >= LOW_WHOLE) {
        block(m, b, away);
      } else {
        building(m, b, away);
      }
      balls.push(ballOf(m.positions, at.at(-1) ?? 0, m.vertices));
      at.push(m.vertices);
      if (performance.now() - from >= budget) {
        yield;
        from = performance.now();
      }
    }
    out.push({ geometry: m.geometry(), balls, at });
  }
  return out;
}
