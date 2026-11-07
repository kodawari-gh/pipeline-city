import { Container, Graphics, Text } from 'pixi.js';
import type { Snapshot } from '@/worker/protocol';
import { currentTextResolution } from '@/core/render/camera';
import { COOLER, type Rect } from '@/features/board/render/layout/layout';
import { MONO } from '@/core/render/ink';
import { mkLane, pointAt, roundedPath, type Lane } from '@/features/board/render/wiring/routes';
import { EdgeFan, radiatorSpan } from './props/case';
import { CoolantFlow, radiatorFit, tubeRoutes } from '@/features/board/render/cooler';
import { fanBank } from '@/core/render/fanmotor';
import { blades } from '@/features/board/render/devices';
import { zoneOf, type AirZoneId } from '@/features/board/sim/airflow';
import { AMBIENT_C, type DeviceKind } from '@/features/board/sim/specs';
import { AirField, type FieldPort } from './airfield';
import type { Shape } from '@/core/render/shape';
import type { AirCtx, AirFan, AirSource } from '@/core/render/airsource';
import type { Theme } from '@/core/render/theme';

// (The case's air itself is `AirField` in airfield.ts: a flow field the particles ride; the lanes here say which fan is a source or a sink.)
// The airflow lens: one switch that dims the room and shows how the case breathes. Air comes in at the front fans, crosses the board, picks up
// the heat of every part it passes and leaves at the rear and top fans. Particles run along the lanes: faster with more fans, warmer where the
// parts are hot. A dead fan, or a case that only takes in or only blows out, shows in red. The model is pure (`airflowModel`, tested);
// `AirflowLens` only draws it. The lanes are drawn from the fans' cables and the temperatures; the field reads the sim's air of each area (`s.board.air`, board/sim/airflow.ts) for the zone each part sits in.

export type Pt = [number, number];
export type AirState = 'on' | 'idle' | 'dead';

/** The case fans as the renderer knows them (`fanMounts` in props/case.ts). */
export interface AirMount { id: string; side: 'front' | 'top' | 'rear'; rect: Rect }

/** One stream of air through a fan mount. `intake` air starts outside and goes in; the rest starts in the case and leaves. */
export interface AirLane {
  id: string; pts: Pt[]; intake: boolean; state: AirState;
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
  /** How the fan acts in the case's air (`AirField`): `in` blows air in at `span`, `out` draws it out, `local` stirs it where it stands. */
  kind: 'in' | 'out' | 'local';
  /** Where its flow enters or leaves, and the fan's box (where particles are released or absorbed). */
  port: Pt; span: Rect;
  /** A stream of its own, apart from the case's air (the PSU's: in from below, through its shroud, out the rear): particles follow `pts`. */
  channel?: boolean;
  /** Channels only: the heat the air takes up along the lane: at `u` (0..1 of its length) it gains `heat` (0..1). */
  picks: { u: number; heat: number }[];
}
/** A part that warms the air: a haze over its rect. `heat` 0 (cool) to 1 (at the limit). */
export interface AirZone {
  id: string; label: string;
  /** The box round the whole zone (where the air picks its heat up, where the tag sits). */
  rect: Rect;
  /** The shapes the glow follows: one rect per part (every stick of RAM, every phase of a VRM). */
  rects: Rect[];
  /** The hover id of each rect (a device id), whose silhouette the glow traces; empty where the rects are all there is. */
  ids: (string | null)[];
  heat: number; tempC: number;
  /** A flat part: the air passes over it (`AirHeat.flat`). */
  flat?: boolean;
  /** The sim's air of the area the zone sits in (`s.board.air`): 0 to 1 ventilation, and how much warmer than the room the cards make it, C. Unset while the machine is off. */
  flow?: number; riseC?: number;
}
/** A word on the lens. `tempC`: the temperature the tag shows, if it shows one: the view follows it and adds a small arrow when it climbs or falls (`TREND_C_PER_S`). */
export interface AirTag { id: string; at: Pt; text: string; tone: 'heat' | 'warn' | 'dim'; anchor: 'c' | 'l' | 'r'; tempC?: number }
export interface AirModel {
  lanes: AirLane[]; zones: AirZone[]; tags: AirTag[]; mounts: { id: string; rect: Rect; state: AirState; fanIds: string[] }[];
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
/** The sim's airflow area of a heat zone: the zone ids are the device kinds, and the two regulators sit in the north area with the processor. */
const areaOf = (zoneId: string): AirZoneId | null => (zoneId === 'vrm' || zoneId === 'rvrm' ? 'north' : zoneOf(zoneId as DeviceKind));
/** How far a component's own fan blows (world units) before its air joins the case's. */
const LOCAL_REACH = 1900;
/** How far the halo of a glow reaches at most (the silhouettes keep a margin of `SHAPE_PAD`, 280). */
const HALO_MAX = 250;

/** The first `max` world units of a path. */
export function clipPath(pts: Pt[], max: number): Pt[] {
  const out: Pt[] = [pts[0]!];
  let run = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]!, b = pts[k]!, d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (run + d >= max) { const f = d ? (max - run) / d : 0; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); return out; }
    out.push(b); run += d;
  }
  return out;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
const COOL: [number, number, number] = [0x6f, 0xd6, 0xff], WARM: [number, number, number] = [0xff, 0xb8, 0x4a], HOT: [number, number, number] = [0xff, 0x45, 0x38];
/** Air colour by heat: blue, amber, red. */
export function airColor(h: number): string {
  const t = clamp01(h), [a, b, f] = t < 0.5 ? [COOL, WARM, t * 2] as const : [WARM, HOT, (t - 0.5) * 2] as const;
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
  const { s } = i, lanes: AirLane[] = [], tags: AirTag[] = [], mounts: AirModel['mounts'] = [];
  const running = s.powered && !s.power.off;
  const cable = (id: string) => s.cables.find((c) => c.id === id)?.connected ?? true;
  const hub = cable('sysfan');

  // the heat zones and the local fans come from the components themselves (`AIR_SOURCES`): this model knows no part
  const ctx: AirCtx = { s, slots: i.slots, live: running && !s.power.tripped };
  const zones: AirZone[] = [];
  const localFans: AirFan[] = [];
  for (const src of i.sources) {
    for (const h of src.heat?.(ctx) ?? []) {
      if (!h.rects.length) continue;
      const x0 = Math.min(...h.rects.map((r) => r.x)), y0 = Math.min(...h.rects.map((r) => r.y));
      const x1 = Math.max(...h.rects.map((r) => r.x + r.w)), y1 = Math.max(...h.rects.map((r) => r.y + r.h));
      const area = areaOf(h.id), air = area && running ? s.board?.air?.find((a) => a.id === area) : undefined;
      zones.push({ id: h.id, label: h.label, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, rects: h.rects, ids: h.ids ?? [], heat: h.heat, tempC: h.tempC, flat: h.flat, flow: air?.flow, riseC: air?.riseC });
    }
    localFans.push(...(src.fans?.(ctx) ?? []));
  }

  // one lane per fan that turns (or should): a dead fan keeps its lane, in red
  const radIds = new Set(i.radiator?.ids ?? []);
  const rearY = mid(i.rear)[1], rearX = i.rear.x + i.rear.w;
  const exitW: Pt = [i.rear.x - 700, rearY];
  const make = (id: string, side: AirMount['side'], rect: Rect, on: boolean, strength: number): AirLane => {
    const [cx, cy] = mid(rect), gl = i.glass, inX = gl.x + gl.w * 0.12, boardY = gl.y + gl.h * 0.5;
    let pts: Pt[], intake = false;
    if (side === 'front') {
      intake = true;
      pts = roundedPath([[rect.x + rect.w + 800, cy], [rect.x - 100, cy], [gl.x + gl.w * 0.45, cy], [gl.x + gl.w * 0.2, cy * 0.5 + rearY * 0.5], [inX + 500, rearY], [rearX + 80, rearY], exitW], 450, 60);
    } else if (side === 'top') {
      pts = roundedPath([[Math.max(gl.x + 400, Math.min(cx, gl.x + gl.w - 400)), boardY + gl.h * 0.18], [cx, boardY - gl.h * 0.1], [cx, rect.y + rect.h + 100], [cx, rect.y - 800]], 500, 60);
    } else {
      pts = roundedPath([[inX + 1400, rearY], [rearX + 80, rearY], exitW], 400, 60);
    }
    // an intake's air enters just inside its fan; an exhaust draws from the fan's middle
    return { id, pts, intake, kind: intake ? 'in' : 'out', port: intake ? [rect.x, cy] : [cx, cy], span: rect, state: !on ? 'dead' : running ? 'on' : 'idle', strength: on ? strength : 0, fanIds: [], picks: [] };
  };
  for (const m of i.mounts) {
    if (radIds.has(m.id)) continue;
    const on = hub && cable(`fan:${m.id}`);
    lanes.push({ ...make(m.id, m.side, m.rect, on, 1), fanIds: [`case:${m.id}`] });
    mounts.push({ id: m.id, rect: m.rect, state: !on ? 'dead' : running ? 'on' : 'idle', fanIds: [`case:${m.id}`] });
  }
  if (!i.rearFitted) { // a grille only: air leaves it by pressure, weakly
    lanes.push(make('rear', 'rear', i.rear, true, 0.3));
  }
  if (i.radiator && i.radiator.ids.length) {
    const r = i.radiator, share = hub ? r.ids.filter((id) => cable(`fan:${id}`)).length / r.ids.length : 0, fanIds = r.ids.map((id) => `radiator:${id}`);
    lanes.push({ ...make(`rad-${r.side}`, r.side, r.rect, share > 0, 0.4 + 0.6 * share), fanIds });
    mounts.push({ id: `rad-${r.side}`, rect: r.rect, state: share <= 0 ? 'dead' : running ? 'on' : 'idle', fanIds });
  }
  // the fans of the components (cooler, graphics cards, sinks, PSU): a short stream from each toward the nearest way out of the case
  const outlets: Pt[] = [[rearX + 80, rearY], ...i.mounts.filter((m) => m.side === 'top').map((m): Pt => [mid(m.rect)[0], m.rect.y + m.rect.h])];
  for (const f of localFans) {
    if (f.noStream) continue;
    const from = f.rotor ? [f.rotor.x, f.rotor.y] as Pt : mid(f.rect), to = outlets.reduce((a, b) => (Math.hypot(b[0] - from[0], b[1] - from[1]) < Math.hypot(a[0] - from[0], a[1] - from[1]) ? b : a));
    // a part that knows its own way (the PSU: in from below, out the rear) says so; the rest blow a short stream toward the nearest way out
    const pts = f.path ? roundedPath(f.path as Pt[], 300, 60) : clipPath(roundedPath([from, [(from[0] + to[0]) / 2, from[1]], to], 300, 60), LOCAL_REACH);
    const span = f.rotor ? { x: f.rotor.x - f.rotor.r, y: f.rotor.y - f.rotor.r, w: 2 * f.rotor.r, h: 2 * f.rotor.r } : f.rect;
    if (pts.length > 1) lanes.push({ id: `fan.${f.id}`, pts, intake: false, kind: 'local', port: from, span, channel: !!f.path, state: running ? 'on' : 'idle', strength: 1, fanIds: [f.id], local: true, picks: [], ...(f.ring ? { ring: f.ring } : {}) });
  }

  // the heat a channel's air takes up: every zone it passes within reach, at the place it passes closest (the case's air is carried by the field, which does this per particle)
  for (const l of lanes) {
    if (!l.channel) continue;
    const ln = mkLane(l.pts);
    for (const z of zones) {
      const [zx, zy] = mid(z.rect), reach = Math.max(z.rect.w, z.rect.h) / 2 + REACH;
      let best = Infinity, bu = 0;
      for (let k = 0; k <= 40; k++) {
        const [x, y] = pointAt(ln, (k / 40) * ln.len), d = Math.hypot(x - zx, y - zy);
        if (d < best) { best = d; bu = k / 40; }
      }
      if (best < reach && z.heat > 0.02) l.picks.push({ u: bu, heat: z.heat * (1 - best / reach) * 0.8 });
    }
  }

  // the words
  const on = lanes.filter((l) => l.state === 'on' && !l.local);
  const inN = on.filter((l) => l.intake).length, outN = on.filter((l) => !l.intake).length;
  const gl = i.glass, cx = gl.x + gl.w / 2;
  if (!running) tags.push({ id: 'off', at: [cx, gl.y + gl.h * 0.08], text: 'MACHINE OFF: NO AIR MOVES', tone: 'dim', anchor: 'c' });
  else if (inN + outN === 0) tags.push({ id: 'none', at: [cx, gl.y + gl.h * 0.08], text: 'NO FAN TURNS', tone: 'warn', anchor: 'c' });
  else if (outN === 0) tags.push({ id: 'noexit', at: [cx, gl.y + gl.h * 0.08], text: 'NO EXHAUST: HOT AIR STAYS IN', tone: 'warn', anchor: 'c' });
  else if (inN === 0) tags.push({ id: 'noin', at: [cx, gl.y + gl.h * 0.08], text: 'NO INTAKE: THE CASE STARVES', tone: 'warn', anchor: 'c' });
  for (const m of mounts) if (m.state === 'dead' && running) tags.push({ id: `dead.${m.id}`, at: [mid(m.rect)[0], m.rect.y + m.rect.h + 260], text: 'FAN OFF', tone: 'warn', anchor: 'c' });
  // the liquid loop: what the radiator gives to the air and how warm the coolant is (a front radiator warms the case with it, a top one blows it out)
  const loop = s.board?.loop, radMount = loop ? mounts.find((m) => m.id === `rad-${loop.side}`) : undefined;
  // a front radiator breathes room air and gives its heat to it: the air that comes in through it is warm, as warm as the water that heats it
  const radLane = loop?.side === 'front' ? lanes.find((l) => l.id === 'rad-front') : undefined;
  if (radLane && loop && running && loop.flow > 0.05) radLane.intakeHeat = Math.min(0.85, Math.max(0, (loop.coolantC - AMBIENT_C) / 40));
  if (loop && radMount && running) {
    tags.push({ id: 'loop', at: [mid(radMount.rect)[0], radMount.rect.y + radMount.rect.h + 260], text: `RAD ${loop.rejectW.toFixed(0)} W · COOLANT ${deg(loop.coolantC)}${loop.flow < 0.05 ? ' · PUMP OFF' : ` · IN ${deg(loop.hotC)} OUT ${deg(loop.coldC)}`}${loop.side === 'front' ? ' · WARMS THE CASE' : ''}`, tone: loop.coolantC > 55 ? 'warn' : 'heat', anchor: 'c', tempC: loop.coolantC });
  }
  // the temperatures at a glance: the room (the sim's constant), the air of the case (the room plus how much the areas' air is warmed) and the PSU's own case
  const rises = s.board?.air.map((a) => a.riseC) ?? [], caseC = AMBIENT_C + (rises.length ? rises.reduce((a, b) => a + b, 0) / rises.length : 0), psuZone = zones.find((z) => z.id === 'psu');
  const gy = gl.y - 190; // above the glass, clear of the top fans and radiator
  tags.push({ id: 'g.room', at: [gl.x + gl.w * 0.16, gy], text: `ROOM ${deg(AMBIENT_C)}`, tone: 'dim', anchor: 'c' });
  tags.push({ id: 'g.case', at: [gl.x + gl.w * 0.5, gy], text: `CASE AIR ${deg(caseC)}`, tone: caseC > AMBIENT_C + 12 ? 'warn' : 'heat', anchor: 'c', tempC: caseC });
  if (psuZone) tags.push({ id: 'g.psu', at: [gl.x + gl.w * 0.84, gy], text: `PSU CASE ${deg(psuZone.tempC)}`, tone: psuZone.heat > 0.8 ? 'warn' : 'heat', anchor: 'c', tempC: psuZone.tempC });
  for (const z of zones) {
    if (z.id === 'psu') continue;
    // the area's air as the sim works it out (board/sim/airflow.ts): how well it is ventilated, named when it is poor
    const flow = z.flow;
    const poor = flow !== undefined && flow < POOR_AIR;
    tags.push({ id: `z.${z.id}`, at: [z.rect.x + z.rect.w / 2, z.rect.y - 150], text: `${z.label} ${deg(z.tempC)}${poor ? ` · AIR ${Math.round(flow * 100)}%` : ''}`, tone: z.heat > 0.8 || poor ? 'warn' : 'heat', anchor: 'c', tempC: z.tempC });
  }
  const cardW = s.devices.filter((d) => d.kind === 'gpu' || d.kind === 'npu').reduce((a, d) => a + (running ? d.powerW : 0), 0);
  if (cardW > 0) tags.push({ id: 'case', at: [cx, gl.y + gl.h * 0.97], text: `CASE +${(cardW * CASE_HEAT_C_PER_W).toFixed(1)}°C FROM CARDS`, tone: 'heat', anchor: 'c' });
  // the loop's tubes, as the board lays them (pump ports on top of the cooler's head to the radiator's barbs)
  const span = loop ? radiatorSpan(loop.side) : null, px = COOLER.x + COOLER.w / 2;
  const loopTubes = span ? tubeRoutes(radiatorFit(span, px), [px - 120, -520], [px + 120, -520]) : null;
  return { lanes, zones, tags, mounts, fanArt: localFans, loopTubes, box: i.glass };
}

// ---------------------------------------------------------------- drawing

/** `fit`: how far (world x) a tag over [x0, x1] at this y must slide to be whole on the screen (the 3D lens sees its plane at an angle, so only the camera knows). */
interface View { x: number; y: number; z: number; cx: number; cy: number; w: number; h: number; fit?: (x0: number, x1: number, y: number) => number }

/** Particles a lane carries, by its length, and the cap over the whole view. */
/** Segments of a stream particle's trail. */
const TRAIL = 4;
/** A temperature that moves faster than this (C per game second, smoothed) gets an arrow on its tag. */
export const TREND_C_PER_S = 0.03;
const SPACING = 330, MAX_PARTS = 40, MAX_EMBERS = 24, LIFE = 22;
/** A stable pseudo-random number in 0..1 for a seed (so a particle keeps its own speed, offset and size). */
const rnd = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
/** World units per second the air travels. */
export const airSpeed = (strength: number) => 700 + 1500 * strength;

export class AirflowLens {
  readonly root = new Container();
  private dim = new Graphics();
  /** The case fans seen edge-on (the same art as the live case, `EdgeFan`), redrawn above the dimming so they stay readable. */
  private fanBox = new Container();
  private fans: { id: string; f: EdgeFan; state: AirState; fanIds: string[] }[] = [];
  private rotors: { fanId: string; g: Graphics }[] = [];
  /** The water in the loop's tubes (only the lens shows it), driven by the pump's speed. */
  private flow: CoolantFlow | null = null;
  /** What each temperature tag did last: its value, when it changed (game seconds) and its smoothed slope, C per second. */
  private trends = new Map<string, { v: number; t: number; slope: number }>();
  /** How far each lane's air has travelled (world units): it advances by the lane's fan speed each frame, so it never jumps when a fan changes speed. */
  private runs = new Map<string, number>();
  /** The air of the case: a flow field and the particles it carries. */
  private field = new AirField();
  private g = new Graphics();
  private pills = new Graphics();
  private labels = new Container();
  private pool: Text[] = [];
  private lanes = new Map<string, Lane>();
  private t = 0;
  model: AirModel | null = null;
  private T!: Theme;

  constructor() { this.root.addChild(this.dim, this.fanBox, this.g, this.pills, this.labels); this.root.visible = false; }

  setTheme(T: Theme) { this.T = T; }

  setModel(m: AirModel | null) {
    this.model = m;
    this.lanes.clear();
    if (m) for (const l of m.lanes) this.lanes.set(l.id, mkLane(l.pts));
    // the model is rebuilt with every snapshot: the fans' blades, the rotors and the water keep their motion across it, or they would jump back each time
    const nth = new Map<string, number>(), key = (id: string) => { const n = nth.get(id) ?? 0; nth.set(id, n + 1); return `${id}#${n}`; };
    const blade = new Map(this.fans.map((o) => [key(o.id), o.f.offset])), spun = new Map(this.rotors.map((o) => [o.fanId, o.g.rotation])), drops = this.flow?.phase ?? 0;
    nth.clear();
    for (const c of this.fanBox.removeChildren()) c.destroy({ children: true });
    this.fans = []; this.rotors = []; this.flow = null;
    if (!m) return;
    const edge = (id: string, r: Rect) => { const f = new EdgeFan(r, this.T); f.offset = blade.get(key(id)) ?? 0; this.fanBox.addChild(f); return f; };
    for (const mt of m.mounts) this.fans.push({ id: mt.id, f: edge(mt.id, mt.rect), state: mt.state, fanIds: mt.fanIds });
    // the fans of the components: strips seen edge-on (a graphics card's), and round ones seen face on (a cooler's, a sink's, the PSU's)
    for (const fa of m.fanArt) {
      for (const r of fa.edge ?? []) this.fans.push({ id: fa.id, f: edge(fa.id, r), state: 'on', fanIds: [fa.id] });
      if (fa.rotor) {
        const { x, y, r, blades: n } = fa.rotor, T = this.T, rg = new Graphics();
        rg.circle(0, 0, r * 1.14).fill({ color: T.sub, alpha: 0.9 }).stroke({ width: Math.max(4, r * 0.03), color: airColor(0), alpha: 0.7 });
        blades(rg, n, Math.max(12, r * 0.16), r, T.tile, T.alu, Math.max(3, r * 0.02));
        rg.circle(0, 0, Math.max(10, r * 0.12)).fill({ color: T.tile }).stroke({ width: Math.max(3, r * 0.02), color: T.alu });
        rg.position.set(x, y);
        rg.rotation = spun.get(fa.id) ?? 0;
        this.fanBox.addChild(rg);
        this.rotors.push({ fanId: fa.id, g: rg });
      }
    }
    if (m.loopTubes) { this.flow = new CoolantFlow(m.loopTubes); this.flow.phase = drops; this.fanBox.addChild(this.flow); }
  }

  /** Where a part's silhouette comes from: its hover id to the `Shape` read from its art (`scene.shapes`); the glow falls back to the rect without one. */
  shapeOf: ((id: string) => Shape | undefined) | null = null;
  private rings = new WeakMap<Shape, Map<number, number[][] | null>>();

  /** The polygons (flat x, y lists) `e` outside the silhouette (cached: a silhouette never changes), or null for a plain rect. */
  private outlineOf(shape: Shape | undefined, e: number): number[][] | null {
    if (!shape) return null;
    let by = this.rings.get(shape);
    if (!by) this.rings.set(shape, (by = new Map()));
    if (!by.has(e)) by.set(e, shape.outline(Math.max(0.5, e))?.map((p) => p.flat()) ?? null);
    return by.get(e) ?? null;
  }

  private fillAt(g: Graphics, shape: Shape | undefined, r: Rect, e: number, fill: { color: string; alpha: number }) {
    const polys = this.outlineOf(shape, e);
    if (polys) for (const p of polys) g.poly(p).fill(fill);
    else g.roundRect(r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, Math.min(e + Math.min(r.w, r.h) * 0.12, (Math.min(r.w, r.h) + 2 * e) / 2)).fill(fill);
  }

  private trace(g: Graphics, shape: Shape | undefined, r: Rect, e: number, stroke: { width: number; color: string; alpha: number }) {
    const polys = this.outlineOf(shape, e);
    if (polys) for (const p of polys) g.poly(p).stroke({ ...stroke, join: 'round' });
    else g.roundRect(r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, Math.min(r.w, r.h) * 0.12).stroke(stroke);
  }

  get visible() { return this.root.visible; }

  /** 0 (still) to 1 (full speed): how hard a lane blows now, by the real speed of the fans that drive it. */
  private level(l: AirLane): number {
    if (l.state === 'dead') return 0;
    if (!l.fanIds.length) return l.state === 'on' ? l.strength : 0;
    return l.fanIds.reduce((a, id) => a + fanBank.level(id), 0) / l.fanIds.length;
  }

  /** `dt` in seconds of game time, so the air stops with the pause. */
  frame(on: boolean, v: View, dt: number, now: number) {
    this.root.visible = on && !!this.model;
    if (!this.root.visible) return;
    const m = this.model!, T = this.T, z = v.z, px = (n: number) => n / z;
    this.t += dt;
    const left = v.x - v.cx / z, top = v.y - v.cy / z, w = v.w / z, h = v.h / z, g = this.g;
    this.dim.clear().rect(left, top, w, h).fill({ color: T.dark ? '#02040a' : '#10182b', alpha: T.dark ? 0.78 : 0.62 });
    g.clear();

    // the glow of every warm part follows its own outline: soft rounded halos grow out of the part's rect (a stick of RAM glows long and thin,
    // a VRM phase small and square), redder as it nears its limit, with a hot rim on the part itself
    for (const zn of m.zones) {
      const col = airColor(zn.heat), pulse = 1 + 0.08 * Math.sin(now / 420 + zn.rect.x * 0.01);
      zn.rects.forEach((r, k) => {
        const shape = this.shapeOf?.(zn.ids[k] ?? '');
        if (zn.heat < 0.05) { // a cool part: just its outline, so every part that can heat up is on the map
          this.trace(g, shape, r, 0, { width: px(1.2), color: col, alpha: 0.4 });
          return;
        }
        // soft halos grown from the part's own outline, the outermost first, then the part's tint and a hot rim
        const base = Math.min(r.w, r.h), pad = Math.max(45, Math.min(base * 0.45, 170)) * pulse;
        for (let i = 5; i >= 1; i--) this.fillAt(g, shape, r, Math.min(HALO_MAX, pad * i * 0.7), { color: col, alpha: (0.035 + 0.05 * zn.heat) * (1 - (i - 1) * 0.12) });
        this.fillAt(g, shape, r, 0, { color: col, alpha: 0.12 + 0.28 * zn.heat });
        this.trace(g, shape, r, 0, { width: px(1.6), color: col, alpha: 0.35 + 0.5 * zn.heat });
      });
    }
    // the fans: the edge-on view, blades sliding when it turns; a dead fan gets a pulsing red frame. The face-on rotors turn the same way.
    for (const o of this.fans) {
      const speed = o.state === 'dead' ? 0 : o.fanIds.reduce((a, id) => a + fanBank.get(id), 0) / Math.max(1, o.fanIds.length); // the real fan's speed, so it coasts like the real one
      o.f.spin(speed * dt * 0.8, Math.min(1, speed / 5));
    }
    for (const o of this.rotors) o.g.rotation += fanBank.get(o.fanId) * dt;
    this.flow?.spin(fanBank.get('cooler') * dt * 0.8);
    for (const mt of m.mounts) {
      const dead = mt.state === 'dead';
      g.roundRect(mt.rect.x, mt.rect.y, mt.rect.w, mt.rect.h, 40).stroke({ width: px(dead ? 3 : 1.5), color: dead ? T.bad : airColor(0), alpha: dead ? 0.5 + 0.4 * Math.sin(now / 160) : mt.state === 'on' ? 0.45 : 0.2 });
    }
    // the case's air: a flow field from the intakes to the exhausts, carrying particles round the parts (airfield.ts); a dead fan keeps a red line
    const ports = m.lanes.filter((l) => !l.channel).map((l): FieldPort => ({ id: l.id, kind: l.kind, pt: l.port, span: l.span, level: this.level(l), ...(l.intakeHeat ? { warm: l.intakeHeat } : {}), ...(l.ring ? { ring: l.ring } : {}) }));
    this.field.step(dt, { box: m.box, ports, zones: m.zones.filter((zn) => zn.id !== 'psu').map((zn) => ({ rects: zn.rects, heat: zn.heat, flat: zn.flat, flow: zn.flow, riseC: zn.riseC })) });
    for (const l of m.lanes) if (l.state === 'dead') { this.path(g, l.pts); g.stroke({ width: px(2), color: T.bad, alpha: 0.3, cap: 'round', join: 'round' }); }
    for (const p of this.field.parts) {
      const fade = Math.min(1, p.age * 2, (LIFE - p.age) * 0.5), col = airColor(p.heat), lw = px(1.5 + 0.8 * (p.k - 0.75) * 2) + p.heat * px(0.8);
      // the trail is the path the particle really took (it bends round the parts and with the flow), as long as its speed makes it, fading toward the tail
      const pts = [...(p.trail ?? []), [p.x, p.y] as Pt], n = pts.length - 1;
      for (let k = 0; k < n; k++) {
        const a = pts[k]!, b = pts[k + 1]!;
        g.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke({ width: lw * (0.5 + 0.5 * (k + 1) / n), color: col, alpha: 0.5 * fade * ((k + 1) / n), cap: 'round', join: 'round' });
      }
      g.circle(p.x, p.y, lw * 0.7).fill({ color: '#ffffff', alpha: 0.55 * fade });
    }
    // a stream of its own (the PSU's: in from below, through its shroud, out the rear): particles follow the lane, warmer after every part it passes
    let budget = MAX_PARTS;
    for (const l of m.lanes) {
      if (!l.channel) continue;
      const ln = this.lanes.get(l.id)!;
      const lvl = this.level(l), faint = lvl < 0.03;
      if (!faint) { this.path(g, l.pts); g.stroke({ width: px(2), color: airColor(0), alpha: 0.08, cap: 'round', join: 'round' }); }
      if (faint || ln.len < 10) continue;
      const n = Math.min(budget, Math.max(2, Math.round((ln.len / SPACING) * (0.15 + 0.85 * lvl) * 0.6)));
      budget -= n;
      // the air covers distance by the lane's fan speed: it ramps up and dies away with the fans (a coasting fan still blows a little)
      this.runs.set(l.id, (this.runs.get(l.id) ?? 0) + airSpeed(lvl) * dt);
      const run = this.runs.get(l.id)!, li = m.lanes.indexOf(l);
      for (let k = 0; k < n; k++) {
        // every particle has its own speed, a lane of its own across the stream and a size; its trail is the path it really took (the look of the case's air)
        const r1 = rnd(k + li * 131), r2 = rnd(k + li * 131 + 7), r3 = rnd(k + li * 131 + 13);
        const sp = 0.7 + 0.6 * r1;
        const d = (k * ln.len) / n + run * sp;
        const u = (((d % ln.len) + ln.len) % ln.len) / ln.len;
        const heat = laneHeat(l, u);
        const fade = Math.min(1, u * 8, (1 - u) * 8), col = airColor(heat), lw = px(1.5 + 0.8 * r3 * 2) + heat * px(0.8);
        const off = (r2 - 0.5) * 2 * (60 + 70 * heat) + Math.sin(d / 500 + k * 2.3) * 14, step = (60 + 50 * sp) / TRAIL;
        const pts: Pt[] = [];
        for (let j = 0; j <= TRAIL; j++) pts.push(pointAt(ln, d - j * step));
        const at = pts.map((p, j): Pt => {
          const a = pts[Math.max(0, j - 1)]!, b = pts[Math.min(TRAIL, j + 1)]!, tx = a[0] - b[0], ty = a[1] - b[1], tl = Math.hypot(tx, ty) || 1;
          return [p[0] - (ty / tl) * off, p[1] + (tx / tl) * off];
        });
        for (let j = 0; j < TRAIL; j++) {
          const q = 1 - j / TRAIL; // the head is the first point: full, fading toward the tail
          g.moveTo(at[j]![0], at[j]![1]).lineTo(at[j + 1]![0], at[j + 1]![1]).stroke({ width: lw * (0.5 + 0.5 * q), color: col, alpha: 0.5 * fade * q, cap: 'round', join: 'round' });
        }
        g.circle(at[0]![0], at[0]![1], lw * 0.7).fill({ color: '#ffffff', alpha: 0.55 * fade });
      }
    }
    // embers: hot parts shed warm motes that rise, drift and fade
    let eb = MAX_EMBERS;
    for (const zn of m.zones) {
      if (zn.heat < 0.12 || zn.id === 'psu') continue;
      const n = Math.min(eb, Math.ceil(zn.heat * 14)); eb -= n;
      const [zx, zy] = mid(zn.rect);
      for (let k = 0; k < n; k++) {
        const r1 = rnd(k * 3 + zx), r2 = rnd(k * 5 + zy), life = 2.2 + 2 * r1, ph = ((this.t / life + k / n + r2) % 1 + 1) % 1;
        const x = zx + (r2 - 0.5) * zn.rect.w * 0.9 + Math.sin(this.t * 1.6 + k) * 90 * ph, y = zy - ph * (500 + 900 * zn.heat) + (r1 - 0.5) * zn.rect.h * 0.4;
        g.circle(x, y, px(1.4 + 1.8 * r1) * (1 - ph * 0.5)).fill({ color: airColor(Math.min(1, zn.heat + 0.2)), alpha: 0.7 * Math.sin(Math.PI * ph) });
      }
    }
    this.tags(m.tags, z, { left, top, w, h }, v.fit);
  }

  private path(g: Graphics, pts: Pt[]) {
    g.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
  }

  /** The words, a constant 13 px on screen whatever the zoom; Texts are pooled. */
  /** 1 while a temperature climbs, -1 while it falls, 0 when it holds (the sim ticks once a second, so the slope is smoothed over the last few ticks). */
  private trendOf(id: string, v: number): number {
    const st = this.trends.get(id);
    if (!st) { this.trends.set(id, { v, t: this.t, slope: 0 }); return 0; }
    if (v !== st.v && this.t > st.t) {
      st.slope = st.slope * 0.8 + ((v - st.v) / (this.t - st.t)) * 0.2;
      st.v = v; st.t = this.t;
    }
    return st.slope > TREND_C_PER_S ? 1 : st.slope < -TREND_C_PER_S ? -1 : 0;
  }

  private tags(tags: AirTag[], z: number, view: { left: number; top: number; w: number; h: number }, fit?: View['fit']) {
    const T = this.T, pad = 5 / z;
    this.pills.clear();
    // the tags keep their size on the screen, so how near they sit depends on the zoom: each one that would cover an earlier one moves up until it is clear
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    tags.forEach((tag, i) => {
      let t = this.pool[i];
      if (!t) {
        t = new Text({ text: '', style: { fontFamily: MONO, fontSize: 13, fontWeight: '700', fill: '#ffffff' }, resolution: currentTextResolution() });
        this.pool[i] = t; this.labels.addChild(t);
      }
      if (t.text !== tag.text) t.text = tag.text;
      t.style.fill = tag.tone === 'warn' ? T.bad : tag.tone === 'dim' ? T.mute : '#ffd9a0';
      t.anchor.set(tag.anchor === 'l' ? 0 : tag.anchor === 'r' ? 1 : 0.5, 0.5);
      t.scale.set(1 / z);
      t.visible = true;
      const w = t.width, h = t.height, trend = tag.tempC === undefined ? 0 : this.trendOf(tag.id, tag.tempC), ax = trend ? 15 / z : 0;
      // a tag stays whole on the screen: slid in from the edge it would run off
      const full = w + 2 * pad + ax, from = tag.at[0] - (tag.anchor === 'l' ? 0 : tag.anchor === 'r' ? w : w / 2) - pad;
      const dx = fit ? fit(from, from + full, tag.at[1]) : Math.max(view.left - from, Math.min(0, view.left + view.w - (from + full)));
      const x0 = from + pad + dx;
      const box = (y: number) => ({ x0: x0 - pad, x1: x0 + w + pad + ax, y0: y - h / 2 - pad, y1: y + h / 2 + pad });
      let y = tag.at[1];
      for (let k = 0; k < 12 && placed.some((p) => p.x0 < box(y).x1 && p.x1 > box(y).x0 && p.y0 < box(y).y1 && p.y1 > box(y).y0); k++) y -= h + pad;
      placed.push(box(y));
      t.position.set(tag.at[0] + dx, y);
      this.pills.roundRect(x0 - pad, y - h / 2 - pad * 0.4, w + 2 * pad + ax, h + pad * 0.8, 5 / z).fill({ color: '#04060f', alpha: 0.78 });
      if (trend) {
        // a small triangle at the end of the pill: up and warm while it climbs, down and cool while it falls
        const cx = x0 + w + pad + 3 / z, cy = y, r = 5 / z, up = trend > 0;
        this.pills.poly(up ? [cx, cy - r, cx - r, cy + r * 0.8, cx + r, cy + r * 0.8] : [cx, cy + r, cx - r, cy - r * 0.8, cx + r, cy - r * 0.8]).fill({ color: up ? '#ff7a4a' : '#6fd8ff' });
      }
    });
    for (let i = tags.length; i < this.pool.length; i++) this.pool[i]!.visible = false;
  }
}
