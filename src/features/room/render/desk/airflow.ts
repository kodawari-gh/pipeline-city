import type { Snapshot } from '@/worker/protocol';
import { COOLER, type Rect } from '@/features/board/render/layout/layout';
import { mkLane, pointAt, roundedPath } from '@/features/board/render/wiring/routes';
import { radiatorSpan } from './props/case';
import { radiatorFit, radiatorGrade, tubeRoutes } from '@/features/board/render/cooler';
import { zoneOf, type AirZoneId } from '@/features/board/sim/airflow';
import { AMBIENT_C, getSpec, type DeviceKind } from '@/features/board/sim/specs';
import type { AirCtx, AirFan, AirSource } from '@/core/render/airsource';

// The airflow lens model: pure data, no drawing (the 3D air takes its words from it, `board/render/three/air/view.ts`). Air comes in at the front fans, crosses the
// board, picks up the heat of every part it passes and leaves at the rear and top fans. One lane per fan; a dead fan, or a case that only takes in
// or only blows out, is flagged. The lanes come from the fans' cables and the temperatures; the zones read the sim's air of each area (`s.board.air`,
// board/sim/airflow.ts) for the zone each part sits in.

export type Pt = [number, number];
export type AirState = 'on' | 'idle' | 'dead';

/** The case fans as the renderer knows them (`fanMounts` in props/case.ts). */
export interface AirMount {
  id: string;
  side: 'front' | 'top' | 'rear';
  rect: Rect;
}

/** One stream of air through a fan mount. `intake` air starts outside and goes in; the rest starts in the case and leaves. */
export interface AirLane {
  id: string;
  pts: Pt[];
  intake: boolean;
  state: AirState;
  /** 0..1: how hard it blows (fan count on a radiator, a passive grille is weak). Used where no fan speed is known (`fanIds` empty). */
  strength: number;
  /** An intake whose air is already warm as it comes in (0..1): a front radiator warms the air it takes through itself. */
  intakeHeat?: number;
  /** A fan that blows down onto a heatsink: its air leaves all round it, from a ring of this radius (`AirFan.ring`). */
  ring?: number;
  /** The fans that drive it, by `fanBank` id: the lens blows as hard as their real speed (a fan that coasts down still blows). */
  fanIds: string[];
  /** A component's own fan (cooler, card, sink, PSU), not one of the case's. */
  local?: boolean;
  /** How the fan acts in the case's air: `in` blows air in at `span`, `out` draws it out, `local` stirs it where it stands. */
  kind: 'in' | 'out' | 'local';
  /** Where its flow enters or leaves, and the fan's box (where particles are released or absorbed). */
  port: Pt;
  span: Rect;
  /** A stream of its own, apart from the case's air (the PSU's: in from below, through its shroud, out the rear): particles follow `pts`. */
  channel?: boolean;
  /** Channels only: the heat the air takes up along the lane: at `u` (0..1 of its length) it gains `heat` (0..1). */
  picks: { u: number; heat: number }[];
}
/** A part that warms the air: a haze over its rect. `heat` 0 (cool) to 1 (at the limit). */
export interface AirZone {
  id: string;
  label: string;
  /** The box round the whole zone (where the air picks its heat up, where the tag sits). */
  rect: Rect;
  /** The shapes the glow follows: one rect per part (every stick of RAM, every phase of a VRM). */
  rects: Rect[];
  /** The hover id of each rect (a device id), whose silhouette the glow traces; empty where the rects are all there is. */
  ids: (string | null)[];
  heat: number;
  tempC: number;
  /** A flat part: the air passes over it (`AirHeat.flat`). */
  flat?: boolean;
  /** The sim's air of the area the zone sits in (`s.board.air`): 0 to 1 ventilation, and how much warmer than the room the cards make it, C. Unset while the machine is off. */
  flow?: number;
  riseC?: number;
}
/** A word on the lens. `tempC`: the temperature the tag shows, if it shows one: the view follows it and adds a small arrow when it climbs or falls. */
export interface AirTag {
  id: string;
  at: Pt;
  text: string;
  tone: 'heat' | 'warn' | 'dim';
  anchor: 'c' | 'l' | 'r';
  tempC?: number;
}
export interface AirModel {
  lanes: AirLane[];
  zones: AirZone[];
  tags: AirTag[];
  mounts: { id: string; rect: Rect; state: AirState; fanIds: string[] }[];
  /** The components' own fans, to draw (rotors and edge-on strips). */
  fanArt: AirFan[];
  /** The loop's two tubes (the hot one first), in world points: the lens shows the water in them. Null with no loop or no radiator. */
  loopTubes: [Pt[], Pt[]] | null;
  /** The inside of the case: the walls the air's field mirrors on. */
  box: Rect;
}

export interface AirIn {
  s: Snapshot;
  mounts: AirMount[];
  /** A radiator on a side of the case takes over the fans of that side (`radiatorSpan`). */
  radiator: { side: 'front' | 'top'; ids: string[]; rect: Rect } | null;
  /** Whether the rear wall has a fan (the Mini has a grille only). */
  rearFitted: boolean;
  /** The rear wall's fan rect (the grille's, when there is no fan). */
  rear: Rect;
  /** The glass area: the board's side of the case. */
  glass: Rect;
  /** Slot id to its world rect. */
  slots: Map<string, Rect>;
  /** What each component adds: its heat and its fans (`AIR_SOURCES`). */
  sources: AirSource[];
}

const mid = (r: Rect): Pt => [r.x + r.w / 2, r.y + r.h / 2];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const deg = (t: number) => `${Math.round(t)}°C`;
/** Case heat per watt of the cards, as the sim (`CASE_HEAT_C_PER_W`). */
export const CASE_HEAT_C_PER_W = 0.05;
const REACH = 900;
/** An area with less than this share of its designed airflow is named on the lens. */
const POOR_AIR = 0.7;
/** The sim's airflow area of a heat zone: the zone ids are the device kinds (a part after a dot names a group of them), and the two regulators sit in the north area with the processor. */
const areaOf = (zoneId: string): AirZoneId | null =>
  zoneId === 'vrm' || zoneId === 'rvrm' ? 'north' : zoneOf(zoneId.split('.')[0] as DeviceKind);
/** How far a component's own fan blows (world units) before its air joins the case's. */
const LOCAL_REACH = 1900;

/** The first `max` world units of a path. */
export function clipPath(pts: Pt[], max: number): Pt[] {
  const out: Pt[] = [pts[0]!];
  let run = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]!,
      b = pts[k]!,
      d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (run + d >= max) {
      const f = d ? (max - run) / d : 0;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      return out;
    }
    out.push(b);
    run += d;
  }
  return out;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
const COOL: [number, number, number] = [0x6f, 0xd6, 0xff],
  WARM: [number, number, number] = [0xff, 0xb8, 0x4a],
  HOT: [number, number, number] = [0xff, 0x45, 0x38];
/** Air colour by heat: blue, amber, red. */
export function airColor(h: number): string {
  const t = clamp01(h),
    [a, b, f] = t < 0.5 ? ([COOL, WARM, t * 2] as const) : ([WARM, HOT, (t - 0.5) * 2] as const);
  return `#${hex(lerp(a[0], b[0], f))}${hex(lerp(a[1], b[1], f))}${hex(lerp(a[2], b[2], f))}`;
}

/** The heat the air carries at `u` along a lane (the parts it passed so far, eased in over a short stretch). */
export function laneHeat(l: Pick<AirLane, 'picks'>, u: number): number {
  let h = 0;
  for (const p of l.picks) h += p.heat * clamp01((u - p.u) / 0.12 + 0.5) * (u >= p.u - 0.06 ? 1 : 0);
  return clamp01(h);
}

/** What breathes where right now. */
export function airflowModel(i: AirIn): AirModel {
  const { s } = i,
    lanes: AirLane[] = [],
    tags: AirTag[] = [],
    mounts: AirModel['mounts'] = [];
  const running = s.powered && !s.power.off;
  const cable = (id: string) => s.cables.find((c) => c.id === id)?.connected ?? true;
  const hub = cable('sysfan');
  /** Is a fan fitted on this mount? A case only offers the mounts. */
  const fitted = (id: string) => s.devices.some((d) => d.kind === 'fan' && d.slot === id);

  // the heat zones and the local fans come from the components themselves (`AIR_SOURCES`): this model knows no part
  const ctx: AirCtx = { s, slots: i.slots, live: running && !s.power.tripped };
  const zones: AirZone[] = [];
  const localFans: AirFan[] = [];
  for (const src of i.sources) {
    for (const h of src.heat?.(ctx) ?? []) {
      if (!h.rects.length) continue;
      const x0 = Math.min(...h.rects.map((r) => r.x)),
        y0 = Math.min(...h.rects.map((r) => r.y));
      const x1 = Math.max(...h.rects.map((r) => r.x + r.w)),
        y1 = Math.max(...h.rects.map((r) => r.y + r.h));
      const area = areaOf(h.id),
        air = area && running ? s.board?.air?.find((a) => a.id === area) : undefined;
      zones.push({
        id: h.id,
        label: h.label,
        rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
        rects: h.rects,
        ids: h.ids ?? [],
        heat: h.heat,
        tempC: h.tempC,
        flat: h.flat,
        flow: air?.flow,
        riseC: air?.riseC,
      });
    }
    localFans.push(...(src.fans?.(ctx) ?? []));
  }

  // one lane per fan that turns (or should): a dead fan keeps its lane, in red
  const radIds = new Set(i.radiator?.ids ?? []);
  const rearY = mid(i.rear)[1],
    rearX = i.rear.x + i.rear.w;
  const exitW: Pt = [i.rear.x - 700, rearY];
  const make = (id: string, side: AirMount['side'], rect: Rect, on: boolean, strength: number): AirLane => {
    const [cx, cy] = mid(rect),
      gl = i.glass,
      inX = gl.x + gl.w * 0.12,
      boardY = gl.y + gl.h * 0.5;
    let pts: Pt[],
      intake = false;
    if (side === 'front') {
      intake = true;
      pts = roundedPath(
        [
          [rect.x + rect.w + 800, cy],
          [rect.x - 100, cy],
          [gl.x + gl.w * 0.45, cy],
          [gl.x + gl.w * 0.2, cy * 0.5 + rearY * 0.5],
          [inX + 500, rearY],
          [rearX + 80, rearY],
          exitW,
        ],
        450,
        60,
      );
    } else if (side === 'top') {
      pts = roundedPath(
        [
          [Math.max(gl.x + 400, Math.min(cx, gl.x + gl.w - 400)), boardY + gl.h * 0.18],
          [cx, boardY - gl.h * 0.1],
          [cx, rect.y + rect.h + 100],
          [cx, rect.y - 800],
        ],
        500,
        60,
      );
    } else {
      pts = roundedPath([[inX + 1400, rearY], [rearX + 80, rearY], exitW], 400, 60);
    }
    // an intake's air enters just inside its fan; an exhaust draws from the fan's middle
    return {
      id,
      pts,
      intake,
      kind: intake ? 'in' : 'out',
      port: intake ? [rect.x, cy] : [cx, cy],
      span: rect,
      state: !on ? 'dead' : running ? 'on' : 'idle',
      strength: on ? strength : 0,
      fanIds: [],
      picks: [],
    };
  };
  for (const m of i.mounts) {
    if (radIds.has(m.id) || !fitted(m.id)) continue;
    const on = hub && cable(`fan:${m.id}`);
    lanes.push({ ...make(m.id, m.side, m.rect, on, 1), fanIds: [`case:${m.id}`] });
    mounts.push({ id: m.id, rect: m.rect, state: !on ? 'dead' : running ? 'on' : 'idle', fanIds: [`case:${m.id}`] });
  }
  if (!i.rearFitted || !fitted('rear')) {
    // a grille only: air leaves it by pressure, weakly
    lanes.push(make('rear', 'rear', i.rear, true, 0.3));
  }
  if (i.radiator && i.radiator.ids.length) {
    const r = i.radiator,
      share = hub ? r.ids.filter((id) => fitted(id) && cable(`fan:${id}`)).length / r.ids.length : 0,
      fanIds = r.ids.map((id) => `radiator:${id}`);
    lanes.push({ ...make(`rad-${r.side}`, r.side, r.rect, share > 0, 0.4 + 0.6 * share), fanIds });
    mounts.push({ id: `rad-${r.side}`, rect: r.rect, state: share <= 0 ? 'dead' : running ? 'on' : 'idle', fanIds });
  }
  // the fans of the components (cooler, graphics cards, sinks, PSU): a short stream from each toward the nearest way out of the case
  const outlets: Pt[] = [
    [rearX + 80, rearY],
    ...i.mounts.filter((m) => m.side === 'top' && fitted(m.id)).map((m): Pt => [mid(m.rect)[0], m.rect.y + m.rect.h]),
  ];
  for (const f of localFans) {
    if (f.noStream) continue;
    const from = f.rotor ? ([f.rotor.x, f.rotor.y] as Pt) : mid(f.rect),
      to = outlets.reduce((a, b) =>
        Math.hypot(b[0] - from[0], b[1] - from[1]) < Math.hypot(a[0] - from[0], a[1] - from[1]) ? b : a,
      );
    // a part that knows its own way (the PSU: in from below, out the rear) says so; the rest blow a short stream toward the nearest way out
    const pts = f.path
      ? roundedPath(f.path as Pt[], 300, 60)
      : clipPath(roundedPath([from, [(from[0] + to[0]) / 2, from[1]], to], 300, 60), LOCAL_REACH);
    const span = f.rotor
      ? { x: f.rotor.x - f.rotor.r, y: f.rotor.y - f.rotor.r, w: 2 * f.rotor.r, h: 2 * f.rotor.r }
      : f.rect;
    if (pts.length > 1)
      lanes.push({
        id: `fan.${f.id}`,
        pts,
        intake: false,
        kind: 'local',
        port: from,
        span,
        channel: !!f.path,
        state: running ? 'on' : 'idle',
        strength: 1,
        fanIds: [f.id],
        local: true,
        picks: [],
        ...(f.ring ? { ring: f.ring } : {}),
      });
  }

  // the heat a channel's air takes up: every zone it passes within reach, at the place it passes closest (the case's air is carried by the field, which does this per particle)
  for (const l of lanes) {
    if (!l.channel) continue;
    const ln = mkLane(l.pts);
    for (const z of zones) {
      const [zx, zy] = mid(z.rect),
        reach = Math.max(z.rect.w, z.rect.h) / 2 + REACH;
      let best = Infinity,
        bu = 0;
      for (let k = 0; k <= 40; k++) {
        const [x, y] = pointAt(ln, (k / 40) * ln.len),
          d = Math.hypot(x - zx, y - zy);
        if (d < best) {
          best = d;
          bu = k / 40;
        }
      }
      if (best < reach && z.heat > 0.02) l.picks.push({ u: bu, heat: z.heat * (1 - best / reach) * 0.8 });
    }
  }

  // the words
  const on = lanes.filter((l) => l.state === 'on' && !l.local);
  const inN = on.filter((l) => l.intake).length,
    outN = on.filter((l) => !l.intake).length;
  const gl = i.glass,
    cx = gl.x + gl.w / 2;
  if (!running)
    tags.push({ id: 'off', at: [cx, gl.y + gl.h * 0.08], text: 'MACHINE OFF: NO AIR MOVES', tone: 'dim', anchor: 'c' });
  else if (inN + outN === 0)
    tags.push({ id: 'none', at: [cx, gl.y + gl.h * 0.08], text: 'NO FAN TURNS', tone: 'warn', anchor: 'c' });
  else if (outN === 0)
    tags.push({
      id: 'noexit',
      at: [cx, gl.y + gl.h * 0.08],
      text: 'NO EXHAUST: HOT AIR STAYS IN',
      tone: 'warn',
      anchor: 'c',
    });
  else if (inN === 0)
    tags.push({
      id: 'noin',
      at: [cx, gl.y + gl.h * 0.08],
      text: 'NO INTAKE: THE CASE STARVES',
      tone: 'warn',
      anchor: 'c',
    });
  for (const m of mounts)
    if (m.state === 'dead' && running)
      tags.push({
        id: `dead.${m.id}`,
        at: [mid(m.rect)[0], m.rect.y + m.rect.h + 260],
        text: 'FAN OFF',
        tone: 'warn',
        anchor: 'c',
      });
  // the liquid loop: what the radiator gives to the air and how warm the coolant is (a front radiator warms the case with it, a top one blows it out)
  const loop = s.board?.loop,
    radMount = loop ? mounts.find((m) => m.id === `rad-${loop.side}`) : undefined;
  // a front radiator breathes room air and gives its heat to it: the air that comes in through it is warm, as warm as the water that heats it
  const radLane = loop?.side === 'front' ? lanes.find((l) => l.id === 'rad-front') : undefined;
  if (radLane && loop && running && loop.flow > 0.05)
    radLane.intakeHeat = Math.min(0.85, Math.max(0, (loop.coolantC - AMBIENT_C) / 40));
  if (loop && radMount && running) {
    tags.push({
      id: 'loop',
      at: [mid(radMount.rect)[0], radMount.rect.y + radMount.rect.h + 260],
      text: `RAD ${loop.rejectW.toFixed(0)} W · COOLANT ${deg(loop.coolantC)}${loop.flow < 0.05 ? ' · PUMP OFF' : ` · IN ${deg(loop.hotC)} OUT ${deg(loop.coldC)}`}${loop.side === 'front' ? ' · WARMS THE CASE' : ''}`,
      tone: loop.coolantC > 55 ? 'warn' : 'heat',
      anchor: 'c',
      tempC: loop.coolantC,
    });
  }
  // the temperatures at a glance: the room (the sim's constant), the air of the case (the room plus how much the areas' air is warmed) and the PSU's own case
  const rises = s.board?.air.map((a) => a.riseC) ?? [],
    caseC = AMBIENT_C + (rises.length ? rises.reduce((a, b) => a + b, 0) / rises.length : 0),
    psuZone = zones.find((z) => z.id === 'psu');
  const gy = gl.y - 190; // above the glass, clear of the top fans and radiator
  tags.push({ id: 'g.room', at: [gl.x + gl.w * 0.16, gy], text: `ROOM ${deg(AMBIENT_C)}`, tone: 'dim', anchor: 'c' });
  tags.push({
    id: 'g.case',
    at: [gl.x + gl.w * 0.5, gy],
    text: `CASE AIR ${deg(caseC)}`,
    tone: caseC > AMBIENT_C + 12 ? 'warn' : 'heat',
    anchor: 'c',
    tempC: caseC,
  });
  if (psuZone)
    tags.push({
      id: 'g.psu',
      at: [gl.x + gl.w * 0.84, gy],
      text: `PSU CASE ${deg(psuZone.tempC)}`,
      tone: psuZone.heat > 0.8 ? 'warn' : 'heat',
      anchor: 'c',
      tempC: psuZone.tempC,
    });
  for (const z of zones) {
    if (z.id === 'psu') continue;
    // the area's air as the sim works it out (board/sim/airflow.ts): how well it is ventilated, named when it is poor
    const flow = z.flow;
    const poor = flow !== undefined && flow < POOR_AIR;
    tags.push({
      id: `z.${z.id}`,
      at: [z.rect.x + z.rect.w / 2, z.rect.y - 150],
      text: `${z.label} ${deg(z.tempC)}${poor ? ` · AIR ${Math.round(flow * 100)}%` : ''}`,
      tone: z.heat > 0.8 || poor ? 'warn' : 'heat',
      anchor: 'c',
      tempC: z.tempC,
    });
  }
  const cardW = s.devices
    .filter((d) => d.kind === 'gpu' || d.kind === 'npu')
    .reduce((a, d) => a + (running ? d.powerW : 0), 0);
  if (cardW > 0)
    tags.push({
      id: 'case',
      at: [cx, gl.y + gl.h * 0.97],
      text: `CASE +${(cardW * CASE_HEAT_C_PER_W).toFixed(1)}°C FROM CARDS`,
      tone: 'heat',
      anchor: 'c',
    });
  // the loop's tubes, as the board lays them (pump ports on top of the cooler's head to the radiator's barbs)
  const span = loop ? radiatorSpan(loop.side) : null,
    px = COOLER.x + COOLER.w / 2;
  const grade = radiatorGrade(getSpec(s.devices.find((d) => d.kind === 'radiator')?.spec ?? '')?.visual ?? '');
  const loopTubes = span ? tubeRoutes(radiatorFit(span, px, grade), [px - 120, -520], [px + 120, -520]) : null;
  return { lanes, zones, tags, mounts, fanArt: localFans, loopTubes, box: i.glass };
}
