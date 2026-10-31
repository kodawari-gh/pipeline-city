import { Container, Graphics, Text } from 'pixi.js';
import type { Snapshot } from '@/worker/protocol';
import { currentTextResolution } from '@/core/render/camera';
import type { Rect } from '@/features/board/render/layout/layout';
import { MONO } from '@/core/render/ink';
import { mkLane, pointAt, roundedPath, type Lane } from '@/features/board/render/wiring/routes';
import type { Theme } from '@/core/render/theme';

// The airflow lens: one switch that dims the room and shows how the case breathes. Air comes in at the front fans, crosses the board, picks up
// the heat of every part it passes and leaves at the rear and top fans. Particles run along the lanes: faster with more fans, warmer where the
// parts are hot. A dead fan, or a case that only takes in or only blows out, shows in red. The model is pure (`airflowModel`, tested);
// `AirflowLens` only draws it. The sim has no airflow model (thermal.ts is lumped): the lanes are drawn from the fans' cables and the temperatures.

export type Pt = [number, number];
export type AirState = 'on' | 'idle' | 'dead';

/** The case fans as the renderer knows them (`fanMounts` in props/case.ts). */
export interface AirMount { id: string; side: 'front' | 'top' | 'rear'; rect: Rect }

/** One stream of air through a fan mount. `intake` air starts outside and goes in; the rest starts in the case and leaves. */
export interface AirLane {
  id: string; pts: Pt[]; intake: boolean; state: AirState;
  /** 0..1: how hard it blows (fan count on a radiator, a passive grille is weak). */
  strength: number;
  /** Heat the air takes up along the lane: at `u` (0..1 of its length) it gains `heat` (0..1). */
  picks: { u: number; heat: number }[];
}
/** A part that warms the air: a haze over its rect. `heat` 0 (cool) to 1 (at the limit). */
export interface AirZone { id: string; rect: Rect; heat: number; tempC: number }
export interface AirTag { id: string; at: Pt; text: string; tone: 'heat' | 'warn' | 'dim'; anchor: 'c' | 'l' | 'r' }
export interface AirModel { lanes: AirLane[]; zones: AirZone[]; tags: AirTag[]; mounts: { id: string; rect: Rect; state: AirState }[] }

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
  psu: Rect;
}

const mid = (r: Rect): Pt => [r.x + r.w / 2, r.y + r.h / 2];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const deg = (t: number) => `${Math.round(t)}°C`;
/** Case heat per watt of the cards, as the sim (`CASE_HEAT_C_PER_W`). */
export const CASE_HEAT_C_PER_W = 0.05;
const REACH = 900;
const HOT_KINDS: Record<string, string> = { cpu: 'CPU', ram: 'RAM', gpu: 'GPU', npu: 'NPU', tpm: 'TPM', storage: 'DRIVE', nic: 'NIC' };

/** How hot a part is, 0 (cool) to 1 (at the point where it throttles). */
export const heatOf = (tempC: number) => clamp01((tempC - 30) / 55);

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

  // the heat zones: the parts of one kind together, hot at the hottest
  const groups = new Map<string, { rects: Rect[]; t: number; w: number }>();
  for (const d of s.devices) {
    if (!HOT_KINDS[d.kind]) continue;
    const r = i.slots.get(d.slot);
    if (!r) continue;
    const g = groups.get(d.kind) ?? { rects: [], t: 0, w: 0 };
    g.rects.push(r); g.t = Math.max(g.t, d.tempC); g.w += d.powerW;
    groups.set(d.kind, g);
  }
  const zones: AirZone[] = [];
  for (const [kind, g] of groups) {
    const x0 = Math.min(...g.rects.map((r) => r.x)), y0 = Math.min(...g.rects.map((r) => r.y));
    const x1 = Math.max(...g.rects.map((r) => r.x + r.w)), y1 = Math.max(...g.rects.map((r) => r.y + r.h));
    zones.push({ id: kind, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, heat: running ? heatOf(g.t) : 0, tempC: g.t });
  }
  if (s.devices.some((d) => d.kind === 'psu')) {
    const load = running ? clamp01(s.power.totalW / Math.max(1, s.power.budgetW)) : 0;
    zones.push({ id: 'psu', rect: i.psu, heat: load * 0.6, tempC: 30 + load * 33 });
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
    return { id, pts, intake, state: !on ? 'dead' : running ? 'on' : 'idle', strength: on ? strength : 0, picks: [] };
  };
  for (const m of i.mounts) {
    if (radIds.has(m.id)) continue;
    const on = hub && cable(`fan:${m.id}`);
    lanes.push(make(m.id, m.side, m.rect, on, 1));
    mounts.push({ id: m.id, rect: m.rect, state: !on ? 'dead' : running ? 'on' : 'idle' });
  }
  if (!i.rearFitted) { // a grille only: air leaves it by pressure, weakly
    lanes.push(make('rear', 'rear', i.rear, true, 0.3));
  }
  if (i.radiator && i.radiator.ids.length) {
    const r = i.radiator, share = hub ? r.ids.filter((id) => cable(`fan:${id}`)).length / r.ids.length : 0;
    lanes.push(make(`rad-${r.side}`, r.side, r.rect, share > 0, 0.4 + 0.6 * share));
    mounts.push({ id: `rad-${r.side}`, rect: r.rect, state: share <= 0 ? 'dead' : running ? 'on' : 'idle' });
  }

  // the heat each lane takes up: every zone it passes within reach, at the place it passes closest
  for (const l of lanes) {
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
  const on = lanes.filter((l) => l.state === 'on');
  const inN = on.filter((l) => l.intake).length, outN = on.filter((l) => !l.intake).length;
  const gl = i.glass, cx = gl.x + gl.w / 2;
  if (!running) tags.push({ id: 'off', at: [cx, gl.y + gl.h * 0.08], text: 'MACHINE OFF: NO AIR MOVES', tone: 'dim', anchor: 'c' });
  else if (inN + outN === 0) tags.push({ id: 'none', at: [cx, gl.y + gl.h * 0.08], text: 'NO FAN TURNS', tone: 'warn', anchor: 'c' });
  else if (outN === 0) tags.push({ id: 'noexit', at: [cx, gl.y + gl.h * 0.08], text: 'NO EXHAUST: HOT AIR STAYS IN', tone: 'warn', anchor: 'c' });
  else if (inN === 0) tags.push({ id: 'noin', at: [cx, gl.y + gl.h * 0.08], text: 'NO INTAKE: THE CASE STARVES', tone: 'warn', anchor: 'c' });
  for (const m of mounts) if (m.state === 'dead' && running) tags.push({ id: `dead.${m.id}`, at: [mid(m.rect)[0], m.rect.y + m.rect.h + 260], text: 'FAN OFF', tone: 'warn', anchor: 'c' });
  for (const z of zones) {
    if (z.id === 'psu') continue;
    tags.push({ id: `z.${z.id}`, at: [z.rect.x + z.rect.w / 2, z.rect.y - 150], text: `${HOT_KINDS[z.id]} ${deg(z.tempC)}`, tone: z.heat > 0.8 ? 'warn' : 'heat', anchor: 'c' });
  }
  const cardW = s.devices.filter((d) => d.kind === 'gpu' || d.kind === 'npu').reduce((a, d) => a + (running ? d.powerW : 0), 0);
  if (cardW > 0) tags.push({ id: 'case', at: [cx, gl.y + gl.h * 0.97], text: `CASE +${(cardW * CASE_HEAT_C_PER_W).toFixed(1)}°C FROM CARDS`, tone: 'heat', anchor: 'c' });
  return { lanes, zones, tags, mounts };
}

// ---------------------------------------------------------------- drawing

interface View { x: number; y: number; z: number; cx: number; cy: number; w: number; h: number }

/** Particles a lane carries, by its length, and the cap over the whole view. */
const SPACING = 170, MAX_PARTS = 340, MAX_EMBERS = 90;
/** A stable pseudo-random number in 0..1 for a seed (so a particle keeps its own speed, offset and size). */
const rnd = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
/** World units per second the air travels. */
export const airSpeed = (strength: number) => 700 + 1500 * strength;

export class AirflowLens {
  readonly root = new Container();
  private dim = new Graphics();
  private g = new Graphics();
  private pills = new Graphics();
  private labels = new Container();
  private pool: Text[] = [];
  private lanes = new Map<string, Lane>();
  private t = 0;
  model: AirModel | null = null;
  private T!: Theme;

  constructor() { this.root.addChild(this.dim, this.g, this.pills, this.labels); this.root.visible = false; }

  setTheme(T: Theme) { this.T = T; }

  setModel(m: AirModel | null) {
    this.model = m;
    this.lanes.clear();
    if (m) for (const l of m.lanes) this.lanes.set(l.id, mkLane(l.pts));
  }

  get visible() { return this.root.visible; }

  /** `dt` in seconds of game time, so the air stops with the pause. */
  frame(on: boolean, v: View, dt: number, now: number) {
    this.root.visible = on && !!this.model;
    if (!this.root.visible) return;
    const m = this.model!, T = this.T, z = v.z, px = (n: number) => n / z;
    this.t += dt;
    const left = v.x - v.cx / z, top = v.y - v.cy / z, w = v.w / z, h = v.h / z, g = this.g;
    this.dim.clear().rect(left, top, w, h).fill({ color: T.dark ? '#02040a' : '#10182b', alpha: T.dark ? 0.78 : 0.62 });
    g.clear();

    // the haze over every warm part: three soft rings, redder as it nears its limit
    for (const zn of m.zones) {
      if (zn.heat < 0.02) continue;
      const [x, y] = mid(zn.rect), col = airColor(zn.heat), pulse = 1 + 0.06 * Math.sin(now / 420 + x);
      const rx = Math.min(zn.rect.w * 0.5 + 250, 1800), ry = Math.min(zn.rect.h * 0.5 + 250, 1800);
      for (let k = 3; k >= 1; k--) g.ellipse(x, y, rx * (0.5 + k * 0.35) * pulse, ry * (0.5 + k * 0.35) * pulse).fill({ color: col, alpha: 0.07 + 0.05 * zn.heat });
    }
    // the fans: a ring in the colour of their state
    for (const mt of m.mounts) {
      const dead = mt.state === 'dead', pulse = dead ? 0.5 + 0.4 * Math.sin(now / 160) : 1;
      g.roundRect(mt.rect.x, mt.rect.y, mt.rect.w, mt.rect.h, 40).stroke({ width: px(3), color: dead ? T.bad : airColor(0), alpha: (mt.state === 'idle' ? 0.35 : 0.9) * pulse });
      if (mt.state !== 'on') continue;
      // pressure waves: rings that leave a turning fan, three at a time
      const [fx, fy] = mid(mt.rect), reach = Math.max(mt.rect.w, mt.rect.h) * 0.7;
      for (let k = 0; k < 3; k++) {
        const ph = (this.t * 0.9 + k / 3) % 1;
        g.circle(fx, fy, 80 + reach * ph).stroke({ width: px(2), color: airColor(0), alpha: 0.5 * (1 - ph) * (1 - ph) });
      }
    }
    // the air: streaks along each lane, cool where it comes in and warmer after every part it passes
    let budget = MAX_PARTS;
    for (const l of m.lanes) {
      const ln = this.lanes.get(l.id)!;
      const faint = l.state !== 'on';
      this.path(g, l.pts);
      g.stroke({ width: px(2), color: l.state === 'dead' ? T.bad : airColor(0), alpha: l.state === 'dead' ? 0.3 : faint ? 0.1 : 0.08, cap: 'round', join: 'round' });
      if (faint || ln.len < 10) continue;
      const n = Math.min(budget, Math.max(2, Math.round((ln.len / SPACING) * (0.4 + 0.6 * l.strength))));
      budget -= n;
      const run = airSpeed(l.strength) * this.t, li = m.lanes.indexOf(l);
      for (let k = 0; k < n; k++) {
        // every particle has its own speed, lane offset and size, so the stream is a living bundle, not a row of dots
        const r1 = rnd(k + li * 131), r2 = rnd(k + li * 131 + 7), r3 = rnd(k + li * 131 + 13);
        const sp = 0.7 + 0.6 * r1;
        const d = (k * ln.len) / n + run * sp;
        const u = (((d % ln.len) + ln.len) % ln.len) / ln.len;
        const heat = laneHeat(l, u);
        const [x, y] = pointAt(ln, d), [x2, y2] = pointAt(ln, d - 60);
        const tx = x - x2, ty = y - y2, tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl;
        // spread across the lane (wider where the air is hot), plus a wandering weave
        const spread = (r2 - 0.5) * 2 * (150 + 150 * heat) * (0.4 + Math.min(u * 4, 1) * 0.6);
        const wob = (0.25 + heat) * 70 * Math.sin(d / 190 + k * 2.3) + spread;
        let ox = nx * wob, oy = ny * wob;
        // eddies: air near a hot part is pulled round it
        for (const zn of m.zones) {
          if (zn.heat < 0.1) continue;
          const [zx, zy] = mid(zn.rect), R = Math.min(Math.max(zn.rect.w, zn.rect.h) * 0.5 + 800, 1900), dx = x - zx, dy = y - zy, dist = Math.hypot(dx, dy) || 1;
          if (dist >= R) continue;
          const s = (1 - dist / R) ** 2 * zn.heat;
          ox += (-dy / dist) * s * 320 + (dx / dist) * s * 160; oy += (dx / dist) * s * 320 + (dy / dist) * s * 160;
        }
        const fade = Math.min(1, u * 8, (1 - u) * 8), col = airColor(heat), lw = px(1.6 + 1.6 * r3) + heat * px(1.2), len = 90 + 120 * sp;
        // a trail that fades behind the head
        let px0 = x + ox, py0 = y + oy;
        for (let s = 1; s <= 3; s++) {
          const [tx2, ty2] = pointAt(ln, d - (len * s) / 3);
          const qx = tx2 + ox * (1 - s * 0.12), qy = ty2 + oy * (1 - s * 0.12);
          g.moveTo(px0, py0).lineTo(qx, qy).stroke({ width: lw * (1 - (s - 1) * 0.25), color: col, alpha: 0.95 * fade * (1.15 - s * 0.28), cap: 'round' });
          px0 = qx; py0 = qy;
        }
        // a bright head; some twinkle
        const tw = r3 > 0.8 ? 0.6 + 0.4 * Math.sin(now / 90 + k * 5) : 1;
        g.circle(x + ox, y + oy, lw * (0.55 + r3 * 0.4)).fill({ color: '#ffffff', alpha: 0.8 * fade * tw });
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
    this.tags(m.tags, z);
  }

  private path(g: Graphics, pts: Pt[]) {
    g.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
  }

  /** The words, a constant 13 px on screen whatever the zoom; Texts are pooled. */
  private tags(tags: AirTag[], z: number) {
    const T = this.T, pad = 5 / z;
    this.pills.clear();
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
      t.position.set(tag.at[0], tag.at[1]);
      t.visible = true;
      const w = t.width, h = t.height, x0 = tag.at[0] - (tag.anchor === 'l' ? 0 : tag.anchor === 'r' ? w : w / 2);
      this.pills.roundRect(x0 - pad, tag.at[1] - h / 2 - pad * 0.4, w + 2 * pad, h + pad * 0.8, 5 / z).fill({ color: '#04060f', alpha: 0.78 });
    });
    for (let i = tags.length; i < this.pool.length; i++) this.pool[i]!.visible = false;
  }
}
