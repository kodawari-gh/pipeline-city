// What the airflow view needs to know about a machine (docs/render/air.md), worked out from the layout, the 3D machine's part boxes (`Machine3D.airBodies`)
// and the sim's snapshot. Two parts: the STATIC plan (the case's air, its boxes, its openings and its fans: it changes only when a part is fitted or
// removed, so the flow is solved once for it) and the LIVE parts (what is hot, how hot, and the coefficient that moves the heat: they change with every
// snapshot). No Three here: a test builds a plan from the real layout.
import type { Snapshot } from '@/worker/protocol';
import { fanHost } from '../../../sim/board';
import { AMBIENT_C, getSpec, type FanSpec } from '../../../sim/specs';
import { LAYOUT_CASE, LAYOUT_TIER, CASE_IN, PCIE_RAILS, REAR_FAN, REAR_FAN_FITTED } from '../../layout/layout';
import { fanMounts } from '@/features/room/render/desk/props/case';
import { gpuFanCount } from '@/features/gpu/render/gpulayout';
import { BOARD_Z, CASE_FRONT, CASE_Z, FAN_MAX, FAN_ZC, REAR_ZC } from '@/features/room/render/three/roomplan';
import { basementPlan, psuFan, psuOpening } from '../basement3d';
import { COOLER_AIR, HOSE_COLD, HOSE_HOT } from '../cooler3d';
import { fanDepth } from '../fans3d';
import { gridShape, type AirBox, type Shape, type V3 } from './grid';

/** A body of the machine as the 3D model has it: a part's box (by device id and kind), or one of the case's fixed bodies (`board`, `basement`, `cage`, `ram`). */
export interface AirBody {
  id: string;
  kind: string;
  slot?: string;
  min: V3;
  max: V3;
}

/** Units to the metre: a millimetre is 23 units. */
export const UNITS_PER_M = 23000;
/** The speed of the air at a basic fan's face at full speed, metres per second. A fan's `airflow` rating scales it. */
const FAN_FACE_MS = 1.5;
/** The tray's face: the air's floor. The case's air is its inside, from the tray to the glass. */
const TRAY_Z = CASE_Z + 70;

/** A fan of the static plan: a wall fan (`wall` as `AirGrid.vent`) or an inner one (a plane across `axis`). `bank`: the id its speed is published under (`fanBank`). */
export type PlanFan =
  | { id: string; bank: string; kind: 'wall'; wall: number; centre: V3; r: number; into: boolean; q: number }
  | { id: string; bank: string; kind: 'inner'; at: V3; axis: 0 | 1 | 2; dir: 1 | -1; r: number; q: number };

/** An opening in the case's wall: air passes to the room. */
export interface PlanVent {
  id: string;
  wall: number;
  centre: V3;
  shape: Shape;
  open: number;
}

export interface AirPlan {
  /** What the plan was made from: a new key means a new solve. */
  key: string;
  min: V3;
  max: V3;
  boxes: AirBox[];
  vents: PlanVent[];
  fans: PlanFan[];
  /** The case's bodies as given (the view draws them in its debug picture). */
  bodies: AirBody[];
}

/** How well air passes each kind of body, along x, y and z. */
const BODY_K: Record<string, V3> = {
  board: [0, 0, 0],
  basement: [0, 0, 0],
  // the drives stand in the front fans' air with gaps between them
  cage: [0.45, 0.2, 0.15],
  // the sticks stand on edge: air runs along them, hardly across
  ram: [0.3, 0.8, 0.15],
  nic: [0.1, 0.1, 0.1],
  'vrm-sink': [0.6, 0.5, 0.05],
  'ram-sink': [0.6, 0.5, 0.05],
  // a card's fans blow up into its fins: the air leaves along its length and over its top edge
  gpu: [0.45, 0.3, 0.45],
  npu: [0.45, 0.3, 0.45],
};

const box = (id: string, min: V3, max: V3, k: V3, part?: string): AirBox => ({
  id,
  min,
  max,
  k,
  ...(part ? { part } : {}),
});
const sizeOf = (b: { min: V3; max: V3 }): V3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
const mid = (b: { min: V3; max: V3 }): V3 => [
  (b.min[0] + b.max[0]) / 2,
  (b.min[1] + b.max[1]) / 2,
  (b.min[2] + b.max[2]) / 2,
];
const rateOf = (spec: FanSpec | undefined): number => spec?.airflow ?? 1;
const flowOf = (r: number, airflow: number): number => FAN_FACE_MS * UNITS_PER_M * airflow * Math.PI * r * r;

/** The case's air as a box: its inside, tray to glass (world: y is up, so the layout's y runs the other way). */
export function airDomain(): { min: V3; max: V3 } {
  return { min: [CASE_IN.x, -(CASE_IN.y + CASE_IN.h), TRAY_Z], max: [CASE_IN.x + CASE_IN.w, -CASE_IN.y, CASE_FRONT] };
}

/** The case fans' discs on the walls, with the fans fitted on them: the radiator's side keeps its fans, which then work through the radiator's core. */
function caseFans(s: Snapshot): PlanFan[] {
  const out: PlanFan[] = [],
    rad = s.devices.find((d) => d.kind === 'radiator'),
    radSide = rad ? (rad.slot === 'rad-front' ? 'front' : 'top') : null;
  for (const m of fanMounts()) {
    const d = s.devices.find((x) => x.kind === 'fan' && x.slot === m.id);
    if (!d) continue;
    const spec = getSpec(d.spec) as FanSpec | undefined,
      dia = Math.min(m.side === 'top' ? m.rect.w : m.rect.h, FAN_MAX),
      r = (dia / 2) * 0.96,
      bank = m.side === radSide ? `radiator:${m.id}` : `case:${m.id}`,
      q = flowOf(r, rateOf(spec));
    const cy = -(m.rect.y + m.rect.h / 2),
      cx = m.rect.x + m.rect.w / 2;
    // the front fans blow in at the east wall, the top fans and the rear fan draw out through the top and the west wall
    if (m.side === 'front')
      out.push({ id: m.id, bank, kind: 'wall', wall: 1, centre: [0, cy, FAN_ZC], r, into: true, q });
    else if (m.side === 'top')
      out.push({ id: m.id, bank, kind: 'wall', wall: 3, centre: [cx, 0, FAN_ZC], r, into: false, q });
    else out.push({ id: m.id, bank, kind: 'wall', wall: 0, centre: [0, cy, REAR_ZC], r, into: false, q });
  }
  return out;
}

/** The fans of the parts, by the part's box: the cooler's, the two regulators' sinks, the cards'. */
function localFans(s: Snapshot, bodies: readonly AirBody[]): PlanFan[] {
  const out: PlanFan[] = [],
    fansOf = (host: string) => s.devices.filter((d) => d.kind === 'fan' && fanHost(d.slot) === host);
  for (const d of s.devices) {
    const spec = getSpec(d.spec) as { visual?: string } | undefined,
      visual = spec?.visual ?? '',
      b = bodies.find((x) => x.id === d.id);
    if (d.kind === 'cooler') {
      const fans = fansOf(d.slot);
      if (visual === 'cooler-tower') {
        const t = COOLER_AIR.tower,
          D = fanDepth(120),
          r = (t.fan / 2) * 0.96,
          cy = -(t.y + t.h / 2);
        for (const f of fans) {
          const spot = Number(f.slot.slice(f.slot.lastIndexOf('.fan') + 4)),
            at: V3 = [spot ? t.x - D / 2 : t.x + t.w + D / 2, cy, t.zc];
          out.push({
            id: f.id,
            bank: 'cooler',
            kind: 'inner',
            at,
            axis: 0,
            dir: -1,
            r,
            q: flowOf(r, rateOf(getSpec(f.spec) as FanSpec)),
          });
        }
      } else if (visual === 'cooler-stock' && fans[0]) {
        const r = (COOLER_AIR.stock.fan / 2) * 0.96;
        out.push({
          id: fans[0].id,
          bank: 'cooler',
          kind: 'inner',
          at: [0, 0, COOLER_AIR.stock.z1 + fanDepth(92) / 2],
          axis: 2,
          dir: -1,
          r,
          q: flowOf(r, rateOf(getSpec(fans[0].spec) as FanSpec)),
        });
      }
    } else if ((d.kind === 'vrm-sink' || d.kind === 'ram-sink') && b) {
      const f = fansOf(d.slot)[0];
      if (!f) continue;
      const sz = sizeOf(b),
        c = mid(b),
        r = Math.min(sz[0], sz[1]) * 0.45;
      out.push({
        id: f.id,
        bank: d.kind === 'vrm-sink' ? 'vrm' : 'ramvrm',
        kind: 'inner',
        at: [c[0], c[1], b.max[2] - 120],
        axis: 2,
        dir: -1,
        r,
        q: flowOf(r, rateOf(getSpec(f.spec) as FanSpec)),
      });
    } else if (d.kind === 'gpu' && b) {
      // the card stands with its fans on its underside, blowing up into its fins (a neural card has a passive sink: no fan of its own)
      const sz = sizeOf(b),
        c = mid(b),
        n = gpuFanCount(visual),
        len = sz[0] / n,
        r = Math.min(len, sz[2]) * 0.46;
      for (let k = 0; k < n; k++)
        out.push({
          id: `${d.id}.fan${k}`,
          bank: `gpu:${d.slot}`,
          kind: 'inner',
          at: [b.min[0] + (k + 0.5) * len, b.min[1] + 0.2 * sz[1], c[2]],
          axis: 1,
          dir: 1,
          r,
          q: flowOf(r, 1.5),
        });
    }
  }
  return out;
}

/** The air passes the supply's casing this well along x, y and z: it goes through the unit, round its parts. */
const PSU_K: V3 = [0.5, 0.4, 0.5];
/** The share of the rear opening's area that passes air (a grille). */
const PSU_GRILLE = 0.7;

/**
 * The power supply's bay in the machine's space (the basement's plan, world y up), with its fan and its rear opening, or null with no supply fitted. The fan is on
 * its underside, over the floor's opening: it draws the room's air up through the unit, and the air leaves by the opening in the rear wall.
 */
export interface PsuBay {
  id: string;
  min: V3;
  max: V3;
  fan: { x: number; z: number; r: number } | null;
  opening: { y: number; z: number; hw: number; hh: number };
}
export function psuBay(s: Snapshot): PsuBay | null {
  const d = s.devices.find((x) => x.kind === 'psu');
  if (!d) return null;
  const u = basementPlan().psu,
    f = psuFan(u),
    o = psuOpening(u),
    fan = !!(getSpec(d.spec) as { fan?: boolean } | undefined)?.fan;
  return {
    id: d.id,
    min: [u.x, -(u.y + u.h), u.z0],
    max: [u.x + u.w, -u.y, u.z1],
    fan: fan ? { x: f.x, z: f.z, r: f.r } : null,
    opening: { y: -(o.y0 + o.y1) / 2, z: (o.z0 + o.z1) / 2, hw: (o.y1 - o.y0) / 2, hh: (o.z1 - o.z0) / 2 },
  };
}

/**
 * The supply's casing: walls over its unit and on its east, south and north sides that the air does not pass. Its fan is under it and its rear is the grille,
 * so the air goes in at the foot, through the unit and out at the rear, and not up into the case as a box with open faces would let it.
 * Each wall is a layer of whole cells of the grid, the outermost ones of the unit: a wall of no air shuts the cell it touches along its normal, however thin
 * it is, so a thin wall inside a cell would shut the cell's whole width (and leave a dead pocket in the unit).
 */
function casing(bay: PsuBay): AirBox[] {
  const dom = airDomain(),
    { n, h } = gridShape(dom.min, dom.max),
    { id } = bay;
  // the cells whose centres are inside the unit, by axis
  const first = (a: number): number => Math.max(0, Math.ceil((bay.min[a]! - dom.min[a]!) / h[a]! - 0.5));
  const last = (a: number): number => Math.min(n[a]! - 1, Math.floor((bay.max[a]! - dom.min[a]!) / h[a]! - 0.5));
  const at = (a: number, i: number): number => dom.min[a]! + i * h[a]!;
  const [i0, j0, k0, i1, j1, k1] = [first(0), first(1), first(2), last(0), last(1), last(2)];
  if (i1 < i0 || j1 < j0 || k1 < k0) return [];
  const span = (a: number, lo: number, hi: number): [number, number] => [at(a, lo), at(a, hi + 1)];
  const cells = (xs: [number, number], ys: [number, number], zs: [number, number]): { min: V3; max: V3 } => ({
    min: [xs[0], ys[0], zs[0]],
    max: [xs[1], ys[1], zs[1]],
  });
  const X = span(0, i0, i1),
    Y = span(1, j0, j1),
    Z = span(2, k0, k1);
  const wall = (name: string, c: { min: V3; max: V3 }, k: V3): AirBox => box(`${id}.${name}`, c.min, c.max, k);
  return [
    wall('lid', cells(X, span(1, j1, j1), Z), [1, 0, 1]),
    wall('east', cells(span(0, i1, i1), Y, Z), [0, 1, 1]),
    wall('south', cells(X, Y, span(2, k0, k0)), [1, 1, 0]),
    wall('north', cells(X, Y, span(2, k1, k1)), [1, 1, 0]),
  ];
}

/** A slab of wall thinner than this is left out of a cut box: a cell of the grid it touched would be walled off whole by it (a wall of no air shuts its cell, however thin). */
const SLIVER = 100;

/** A box with a box taken out of it: the slabs that are left (the box as it is when they do not meet). */
function carve(id: string, out: { min: V3; max: V3 }, hole: { min: V3; max: V3 }, k: V3): AirBox[] {
  const lo = out.min.map((v, a) => Math.max(v, hole.min[a]!)) as V3,
    hi = out.max.map((v, a) => Math.min(v, hole.max[a]!)) as V3;
  if (lo.some((v, a) => v >= hi[a]!)) return [box(id, out.min, out.max, k)];
  const pieces: AirBox[] = [],
    min = [...out.min] as V3,
    max = [...out.max] as V3;
  for (let a = 0; a < 3; a++) {
    if (lo[a]! - min[a]! >= SLIVER) {
      const m = [...max] as V3;
      m[a] = lo[a]!;
      pieces.push(box(`${id}.${a}-`, [...min] as V3, m, k));
    }
    if (max[a]! - hi[a]! >= SLIVER) {
      const n = [...min] as V3;
      n[a] = hi[a]!;
      pieces.push(box(`${id}.${a}+`, n, [...max] as V3, k));
    }
    min[a] = lo[a]!;
    max[a] = hi[a]!;
  }
  return pieces;
}

/** The boxes in the air's way, by the kind of each body. The tower's stack, the stock heatsink and the pump head are the coolers' own boxes. */
function boxesOf(s: Snapshot, bodies: readonly AirBody[]): AirBox[] {
  const out: AirBox[] = [],
    radSide = s.devices.find((d) => d.kind === 'radiator')?.slot === 'rad-front' ? 'front' : 'top',
    bay = psuBay(s);
  for (const b of bodies) {
    const d = s.devices.find((x) => x.id === b.id),
      visual = (d && (getSpec(d.spec) as { visual?: string } | undefined)?.visual) || '';
    if (b.kind === 'basement' && bay) {
      // the supply stands in the basement: its unit is a part the air goes through, the rest of the basement stays a wall
      out.push(
        ...carve(b.id, b, bay, BODY_K['basement']!),
        box(bay.id, bay.min, bay.max, PSU_K, bay.id),
        ...casing(bay),
      );
    } else if (b.kind === 'cooler') {
      if (visual === 'cooler-tower') {
        const t = COOLER_AIR.tower;
        out.push(box(b.id, [t.x, -(t.y + t.h), t.z0], [t.x + t.w, -t.y, t.z1], [0.7, 0.7, 0.03], b.id));
      } else if (visual === 'cooler-stock') {
        const w = COOLER_AIR.stock.w / 2;
        out.push(box(b.id, [-w, -w, BOARD_Z], [w, w, COOLER_AIR.stock.z1], [0.4, 0.4, 0.05], b.id));
      } else
        out.push(
          box(
            b.id,
            [-COOLER_AIR.pump.r, -COOLER_AIR.pump.r, BOARD_Z],
            [COOLER_AIR.pump.r, COOLER_AIR.pump.r, COOLER_AIR.pump.top],
            [0, 0, 0],
          ),
        );
    } else if (b.kind === 'radiator') {
      out.push(box(b.id, b.min, b.max, radSide === 'front' ? [0.3, 0.02, 0.02] : [0.02, 0.3, 0.02], b.id));
    } else {
      const k = BODY_K[b.kind];
      if (k)
        out.push(
          box(
            b.id,
            b.min,
            b.max,
            k,
            d && (b.kind === 'gpu' || b.kind === 'npu' || b.kind === 'vrm-sink' || b.kind === 'ram-sink')
              ? b.id
              : undefined,
          ),
        );
    }
  }
  return out;
}

/** The openings in the case's skin: the rear grille where there is no rear fan, the expansion slots, the front's mesh and the top's. */
function ventsOf(s: Snapshot): PlanVent[] {
  const d = airDomain(),
    out: PlanVent[] = [],
    hasRear = s.devices.some((x) => x.kind === 'fan' && x.slot === 'rear');
  const cy = (d.min[1] + d.max[1]) / 2,
    cz = (d.min[2] + d.max[2]) / 2,
    ry = -(REAR_FAN.y + REAR_FAN.h / 2),
    rr = (Math.min(REAR_FAN.h, FAN_MAX) / 2) * 0.9;
  // the rear: a grille, open to the room, where there is no fan (a fitted fan stopped is shut by its own stiffness)
  if (!REAR_FAN_FITTED || !hasRear)
    out.push({ id: 'rear', wall: 0, centre: [0, ry, REAR_ZC], shape: { r: rr }, open: 0.5 });
  // the expansion slots at the rear, on the board's side: a leak
  const ys = PCIE_RAILS.map((r) => -(r.y + r.h / 2));
  if (ys.length) {
    const y0 = Math.min(...ys) - 300,
      y1 = Math.max(...ys) + 300;
    out.push({
      id: 'slots',
      wall: 0,
      centre: [0, (y0 + y1) / 2, BOARD_Z + 800],
      shape: { hw: Math.max(300, (y1 - y0) / 2), hh: 800 },
      open: 0.12,
    });
  }
  // the front panel and the top are meshes
  out.push({
    id: 'front',
    wall: 1,
    centre: [0, cy, cz],
    shape: { hw: (d.max[1] - d.min[1]) * 0.45, hh: (d.max[2] - d.min[2]) * 0.45 },
    open: 0.12,
  });
  out.push({
    id: 'top',
    wall: 3,
    centre: [(d.min[0] + d.max[0]) / 2, 0, cz],
    shape: { hw: (d.max[0] - d.min[0]) * 0.4, hh: (d.max[2] - d.min[2]) * 0.4 },
    open: 0.06,
  });
  // the supply's own: its fan's air leaves by the opening in the rear wall
  const bay = psuBay(s);
  if (bay?.fan)
    out.push({
      id: 'psu',
      wall: 0,
      centre: [0, bay.opening.y, bay.opening.z],
      shape: { hw: bay.opening.hw, hh: bay.opening.hh },
      open: PSU_GRILLE,
    });
  return out;
}

/** The id the supply's fan speed is published under (the lens turns it: the 3D machine has no fan of its own for it). */
export const PSU_BANK = 'psu';

/** The supply's fan: a wall fan on the floor under its unit, blowing the room's air up into it. */
function psuFans(s: Snapshot): PlanFan[] {
  const bay = psuBay(s);
  if (!bay?.fan) return [];
  const r = bay.fan.r * 0.96;
  return [
    {
      id: `${bay.id}.fan`,
      bank: PSU_BANK,
      kind: 'wall',
      wall: 2,
      centre: [bay.fan.x, 0, bay.fan.z],
      r,
      into: true,
      q: flowOf(r, 1),
    },
  ];
}

/** A key that says when the plan must be made again: the layout, the parts fitted and where their boxes are. */
export function planKey(s: Snapshot, bodies: readonly AirBody[]): string {
  const r = (v: number) => Math.round(v);
  return [
    LAYOUT_TIER,
    LAYOUT_CASE,
    s.devices.map((d) => `${d.id}:${d.spec}:${d.slot}`).join(','),
    bodies.map((b) => `${b.id}${b.min.map(r)}${b.max.map(r)}`).join(';'),
  ].join('|');
}

/** The static plan of a machine. */
export function airPlan(s: Snapshot, bodies: readonly AirBody[]): AirPlan {
  const { min, max } = airDomain();
  return {
    key: planKey(s, bodies),
    min,
    max,
    boxes: boxesOf(s, bodies),
    vents: ventsOf(s),
    fans: [...caseFans(s), ...localFans(s, bodies), ...psuFans(s)],
    bodies: [...bodies],
  };
}

// ------------------------------------------------------------------ the heat

/** A part that gives its heat to the air (or takes it from the coolant): where it is, how hot it is, and the coefficient that moves the heat. */
export interface AirPart {
  id: string;
  kind: string;
  min: V3;
  max: V3;
  /** The air passes through it (fins, a radiator's core): it heats the air inside its box. Else it heats the air within `reach` of its surface. */
  porous: boolean;
  reach: number;
  /** The temperature of its surface, C (the sim's, less what the cooler's fins lose to the die). */
  tempC: number;
  /** The heat it makes now, W. */
  powerW: number;
  /** The heat transfer coefficient to the air, W per K: the sim's heat over the surface's temperature above the air's (`AIR_REF`). */
  ua: number;
  label: string;
}

/** The surface of a heatsink's fins over the room, as a share of the die's rise over the room. */
const FIN_SHARE = 0.7;
const CARD_SHARE = 0.75;
/** The smallest rise over the air the coefficient is worked out against, K: below it the part is as cool as the air. */
const MIN_RISE = 1.5;
/** How far the air round a plain part's surface takes part in the exchange. */
const REACH = 280;

const coefficient = (powerW: number, surfaceC: number, airC: number): number =>
  Math.max(0, powerW) / Math.max(MIN_RISE, surfaceC - airC);

/** The share of the load the supply turns to heat. */
const PSU_LOSS = 0.1;

/** The supply's casing as the 2D lens has it (`board/render/air.ts`): 30 C at idle, up to 33 K more at full load. */
export function psuTempC(s: Snapshot): number {
  const load = s.powered && !s.power.off ? Math.max(0, Math.min(1, s.power.totalW / Math.max(1, s.power.budgetW))) : 0;
  return 30 + load * 33;
}

/**
 * The temperature each part shows in the thermal view, by device id: the sim's for the part, or what its surface is where the air meets another (a
 * heatsink's fins, a card's shroud, a radiator's core, the supply's casing: the temperature the air's heat exchange uses, so the glow and the air agree).
 * The loop's parts have none in the sim: a pump head runs at the water that leaves it, each hose at its own water, the radiator at the water's mean.
 */
export function surfaceTemps(s: Snapshot, parts: readonly AirPart[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of s.devices) if (Number.isFinite(d.tempC)) m.set(d.id, d.tempC);
  for (const p of parts) if (m.has(p.id)) m.set(p.id, p.tempC);
  const loop = s.board?.loop;
  if (loop) {
    for (const d of s.devices) if (d.kind === 'cooler' && isLiquid(d.spec)) m.set(d.id, loop.hotC);
    m.set(HOSE_HOT, loop.hotC);
    m.set(HOSE_COLD, loop.coldC);
  }
  return m;
}

/** Is this cooler spec a pump head (an all-in-one loop's) and not an air heatsink? */
const isLiquid = (spec: string): boolean =>
  ((getSpec(spec) as { visual?: string } | undefined)?.visual ?? '') === 'cooler-liquid';

/** The case's air temperature the coefficients are worked out against: the room's plus the mean rise of the areas. */
export function airReference(s: Snapshot): number {
  const rises = s.board?.air.map((a) => a.riseC) ?? [];
  return AMBIENT_C + (rises.length ? rises.reduce((a, b) => a + b, 0) / rises.length : 0);
}

/** The heat of each part now, from the snapshot: `plan`'s bodies say where each part is. */
export function airParts(s: Snapshot, plan: AirPlan): AirPart[] {
  const out: AirPart[] = [],
    air = airReference(s),
    cpu = s.devices.find((d) => d.kind === 'cpu'),
    loop = s.board?.loop,
    running = s.powered && !s.power.off;
  const add = (
    b: { id: string; kind: string; min: V3; max: V3 },
    o: { porous: boolean; tempC: number; powerW: number; label: string },
  ): void => {
    out.push({
      id: b.id,
      kind: b.kind,
      min: b.min,
      max: b.max,
      reach: o.porous ? 0 : REACH,
      ...o,
      ua: running ? coefficient(o.powerW, o.tempC, air) : 0,
    });
  };
  for (const b of plan.boxes) {
    const d = s.devices.find((x) => x.id === b.id);
    if (!d) continue;
    if (d.kind === 'cooler') {
      // an air heatsink takes the processor's heat: its fins sit between the die and the air. A pump head is not one: its heat goes into the coolant.
      if (!isLiquid(d.spec) && cpu)
        add(
          { ...b, kind: 'cooler' },
          { porous: true, tempC: air + FIN_SHARE * (cpu.tempC - air), powerW: cpu.powerW, label: 'CPU' },
        );
    } else if (d.kind === 'gpu' || d.kind === 'npu' || d.kind === 'nic')
      add(
        { ...b, kind: d.kind },
        { porous: true, tempC: air + CARD_SHARE * (d.tempC - air), powerW: d.powerW, label: d.kind.toUpperCase() },
      );
    else if (d.kind === 'vrm-sink' && s.board)
      add(
        { ...b, kind: d.kind },
        { porous: true, tempC: air + FIN_SHARE * (s.board.vrm.tempC - air), powerW: s.board.vrm.heatW, label: 'VRM' },
      );
    else if (d.kind === 'ram-sink' && s.board)
      add(
        { ...b, kind: d.kind },
        {
          porous: true,
          tempC: air + FIN_SHARE * (s.board.ramVrm.tempC - air),
          powerW: s.board.ramVrm.heatW,
          label: 'MEM VRM',
        },
      );
    else if (d.kind === 'radiator' && loop) {
      // the water gives its heat to the air that crosses the core: the coefficient is what the sim says the radiator rejects over the water's rise over the air
      add(
        { ...b, kind: 'radiator' },
        { porous: true, tempC: (loop.hotC + loop.coldC) / 2, powerW: loop.rejectW, label: 'RAD' },
      );
    } else if (d.kind === 'psu') {
      // the supply's losses heat the air its fan draws through the unit (the sim has no supply heat: the casing's temperature is the 2D lens's)
      add(
        { ...b, kind: 'psu' },
        { porous: true, tempC: psuTempC(s), powerW: running ? PSU_LOSS * s.power.totalW : 0, label: 'PSU' },
      );
    }
  }
  // a processor with no cooler on it: its bare package heats the air next to it
  if (cpu && !s.devices.some((d) => d.kind === 'cooler'))
    add(
      { id: cpu.id, kind: 'cpu', min: [-630, -530, BOARD_Z], max: [630, 530, BOARD_Z + 250] },
      { porous: false, tempC: cpu.tempC, powerW: cpu.powerW, label: 'CPU' },
    );
  const ram = s.devices.filter((d) => d.kind === 'ram'),
    ramBody = plan.bodies.find((b) => b.id === 'ram');
  if (ramBody && ram.length)
    add(ramBody, {
      porous: false,
      tempC: Math.max(...ram.map((d) => d.tempC)),
      powerW: ram.reduce((a, d) => a + d.powerW, 0),
      label: 'RAM',
    });
  const drives = s.devices.filter((d) => d.kind === 'storage'),
    cage = plan.bodies.find((b) => b.id === 'cage');
  if (cage && drives.length)
    add(cage, {
      porous: true,
      tempC: Math.max(...drives.map((d) => d.tempC)),
      powerW: drives.reduce((a, d) => a + d.powerW, 0),
      label: 'DRIVES',
    });
  return out;
}
