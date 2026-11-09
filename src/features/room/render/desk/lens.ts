import { Container, Graphics, Text } from 'pixi.js';
import type { Snapshot } from '@/worker/protocol';
import { currentTextResolution } from '@/core/render/camera';
import { assignLeads } from '@/features/board/sim/cables';
import { getSpec } from '@/features/board/sim/specs';
import { atx12vSlots, pcieFeed } from '@/features/board/render/layout/pins';
import { BAY_CELLS, FAN_HUB, GEO, HUB_POWER_Y, PC_POWER, POWER_LEAD_X, PSU, PSU_FACE_X, type Rect } from '@/features/board/render/layout/layout';
import { MONO } from '@/core/render/ink';
import { mkLane, pointAt, roundedPath, type Bus, type BusKind, type Cable, type Lane } from '@/features/board/render/wiring/routes';
import type { Theme } from '@/core/render/theme';

// The power lens: one switch that dims the room and lights the electrical map on top of it. Where power has to be linked (the two cords at the
// wall, the PSU's cables to the board) and where it flows (animated: more watts, a thicker line and faster dots), what each part takes, and
// what is missing (red, pulsing). The model is pure (`lensModel`, tested); `PowerLens` only draws it.

export type Pt = [number, number];
export type FlowState = 'on' | 'idle' | 'missing';

/** One run of power, from the source to the sink: a cord, a PSU cable, or the board's feed to a part. */
export interface LensFlow { id: string; pts: Pt[]; watts: number; state: FlowState; /** a thin branch (the feed to one part) */ branch?: boolean }
/** A word on the map (watts, a warning), anchored at a world point. */
export interface LensTag { id: string; at: Pt; text: string; tone: 'watts' | 'warn' | 'dim'; anchor: 'c' | 'l' | 'r' }
/** A ring that says "link this": at a plug or an outlet. */
export interface LensMark { id: string; at: Pt; r: number; tone: 'ok' | 'warn' }
export interface LensModel { flows: LensFlow[]; tags: LensTag[]; marks: LensMark[] }

export interface LensCord { kind: 'pcmains' | 'monmains'; connected: boolean; /** the plug's centre */ plugAt: Pt; /** the cord from the machine to the plug (`cordRoute`) */ route: Pt[]; outlet: Pt }

export interface LensIn {
  s: Snapshot;
  cords: LensCord[];
  /** The PSU's cables to the board (`buildCables`): `atx`, `cpu` and one `pcie`.. lead for each card socket that takes one. */
  cables: Cable[];
  /** The board's traces (`buildBuses`, the art's own): the power runs of the lens follow them. */
  buses: Bus[];
  /** Slot id to its world rect (`scene.slots`). */
  slots: Map<string, Rect>;
  monitor: Rect;
}

const rev = (p: Pt[]): Pt[] => [...p].reverse();
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const watts = (w: number) => (w >= 10 ? `${Math.round(w)} W` : `${(Math.round(w * 10) / 10).toFixed(1)} W`);

/** What runs where right now. Directions are source to sink: wall to machine, PSU to board, board to part. */
export function lensModel(i: LensIn): LensModel {
  const { s } = i, flows: LensFlow[] = [], tags: LensTag[] = [], marks: LensMark[] = [];
  const on = s.powered && !s.power.off;
  const dev = (kinds: string[]) => s.devices.filter((d) => kinds.includes(d.kind)).map((d) => (on ? d.powerW : 0));
  const monW = sum(dev(['display'])), cpuW = sum(dev(['cpu'])), sataSlots = new Set(s.storage.filter((d) => d.slot.startsWith('sata')).map((d) => d.slot));
  const sataW = sum(s.devices.filter((d) => sataSlots.has(d.slot)).map((d) => (on ? d.powerW : 0)));
  const pcW = on ? Math.max(0, s.power.totalW - monW) : 0;
  // the PCIe leads: a card takes its draw in equal shares from the slot and each of its leads, the rest of the board's draw comes over the 24-pin
  const cards = s.devices.filter((d) => (d.kind === 'gpu' || d.kind === 'npu') && !d.burnt).map((d) => ({ slot: d.slot, loadW: getSpec(d.spec)?.loadW ?? 0, w: on ? d.powerW : 0 }));
  const leadW = new Map(assignLeads(cards).map((l) => { const c = cards.find((q) => q.slot === l.slot)!; return [l.lead as string, c.w / (assignLeads([c]).length + 1)] as const; }));
  const atxW = Math.max(0, pcW - cpuW - sataW - sum([...leadW.values()]));
  const hasPsu = s.devices.some((d) => d.kind === 'psu');
  const conn = (id: string) => !!s.cables.find((c) => c.id === id)?.connected;
  const state = (connected: boolean, w: number): FlowState => (!connected ? 'missing' : w > 0.05 ? 'on' : 'idle');

  // the cords from the wall: the PC's runs on into the PSU bay, the monitor's ends at the monitor
  for (const c of i.cords) {
    const pc = c.kind === 'pcmains', w = pc ? pcW : monW, line = rev(c.route);
    if (pc) line.push([PC_POWER.x, PC_POWER.y], [PSU.x + 40, PC_POWER.y]);
    flows.push({ id: c.kind, pts: line, watts: c.connected ? w : 0, state: state(c.connected, w) });
    marks.push({ id: c.kind, at: c.connected ? c.outlet : c.plugAt, r: 330, tone: c.connected ? 'ok' : 'warn' });
    if (!c.connected) tags.push({ id: `${c.kind}.warn`, at: [c.plugAt[0], c.plugAt[1] + 460], text: pc ? 'PLUG THE PC IN' : 'PLUG THE MONITOR IN', tone: 'warn', anchor: 'c' });
  }
  const wall = i.cords.find((c) => c.kind === 'pcmains');
  if (wall) tags.push({ id: 'wall', at: [wall.outlet[0] + 1000, wall.outlet[1]], text: `WALL ${watts(s.energy.wallW)}`, tone: 'watts', anchor: 'l' });
  if (monW > 0 || s.devices.some((d) => d.kind === 'display')) tags.push({ id: 'monitor', at: [i.monitor.x + i.monitor.w - 200, i.monitor.y + i.monitor.h - 220], text: `MONITOR ${watts(monW)}`, tone: 'watts', anchor: 'r' });

  // the PSU's cables to the board
  const board = new Map<string, Pt>();
  for (const cb of i.cables) {
    const lead = cb.kind.startsWith('pcie');
    if (cb.kind !== 'atx' && cb.kind !== 'cpu' && !lead) continue;
    const w = cb.kind === 'atx' ? atxW : cb.kind === 'cpu' ? cpuW : leadW.get(cb.kind) ?? 0, connected = conn(cb.kind), end = cb.path.pts[cb.path.pts.length - 1]!;
    if (!lead) board.set(cb.kind, end);
    if (!hasPsu) continue;
    flows.push({ id: cb.kind, pts: cb.path.pts, watts: connected ? w : 0, state: state(connected, w) });
    if (!connected) {
      marks.push({ id: `${cb.kind}.mark`, at: end, r: 260, tone: 'warn' });
      tags.push({ id: `${cb.kind}.warn`, at: [end[0], end[1] + (lead ? -260 : 360)], text: cb.kind === 'atx' ? 'NO MAIN POWER' : lead ? 'NO CARD POWER' : 'NO CPU POWER', tone: 'warn', anchor: 'c' });
    }
  }
  if (hasPsu) tags.push({ id: 'psu', at: [PSU.x + PSU.w - 120, PSU.y + 130], text: `LOAD ${watts(on ? s.power.totalW : 0)} / ${Math.round(s.power.budgetW)} W`, tone: s.power.tripped ? 'warn' : 'watts', anchor: 'r' });

  // the SATA power lead, one trunk and a branch to every drive
  const cells = s.storage.map((d) => ({ d, n: Number(/^sata(\d+)$/.exec(d.slot)?.[1] ?? -1) })).filter((c) => c.n >= 0 && BAY_CELLS[c.n]);
  if (hasPsu && cells.length) {
    const x0 = PSU.x + PSU.w, ys = PSU.y + PSU.h / 2, X = POWER_LEAD_X, py = (n: number) => BAY_CELLS[n]!.y + BAY_CELLS[n]!.h * 0.3;
    const top = Math.min(...cells.map((c) => py(c.n))), low = Math.max(...cells.map((c) => py(c.n)));
    flows.push({ id: 'sata', pts: roundedPath(top < ys ? [[x0, ys], [X, ys], [X, top]] : [[x0, ys], [X, ys]], 60, 30) as Pt[], watts: sataW, state: state(true, sataW) });
    // (down to the basement's cage)
    if (low > ys) flows.push({ id: 'sata.low', pts: [[X, ys], [X, low]], watts: sataW, state: state(true, sataW), branch: true });
    for (const c of cells) {
      const w = on ? s.devices.find((d) => d.slot === c.d.slot)?.powerW ?? 0 : 0;
      flows.push({ id: `sata.${c.n}`, pts: [[X, py(c.n)], [BAY_CELLS[c.n]!.x - 40, py(c.n)]], watts: w, state: state(true, w), branch: true });
    }
  }
  // the fan hub's lead (a few watts of fans), along the basement from the supply's face
  if (hasPsu) flows.push({ id: 'hub', pts: [[PSU_FACE_X + 6, HUB_POWER_Y], [FAN_HUB.x - 20, HUB_POWER_Y]], watts: on ? 3 : 0, state: state(true, on ? 3 : 0), branch: true });

  // the board's feed to the parts: one run per kind (all the RAM sticks together, ...), from the main connector (the CPU's from its own),
  // with what the kind takes beside it
  const names: Record<string, string> = { cpu: 'CPU', ram: 'RAM', storage: 'DRIVE', nic: 'NIC', cooler: 'FAN' };
  const groups = new Map<string, { w: number; rects: Rect[] }>();
  for (const d of s.devices) {
    if (d.kind === 'psu' || d.kind === 'display' || sataSlots.has(d.slot)) continue;
    const r = i.slots.get(d.slot);
    if (!r || r.x > GEO.bd.x + GEO.bd.w || r.x + r.w < GEO.bd.x || r.y > GEO.bd.y + GEO.bd.h || r.y + r.h < GEO.bd.y) continue; // (a part off the board, like the router, has no feed)
    const g = groups.get(d.kind) ?? { w: 0, rects: [] };
    g.w += on ? d.powerW : 0; g.rects.push(r);
    groups.set(d.kind, g);
  }
  for (const [kind, g] of groups) {
    const x0 = Math.min(...g.rects.map((r) => r.x)), y0 = Math.min(...g.rects.map((r) => r.y)), x1 = Math.max(...g.rects.map((r) => r.x + r.w)), y1 = Math.max(...g.rects.map((r) => r.y + r.h));
    const strip = (r: Rect): Pt[] => { const a = atx12vSlots(GEO.atx), xv = GEO.atx.x - 40, cy = r.y + r.h / 2; return roundedPath([a, [xv, a[1]], [xv, cy], [r.x + r.w / 2, cy]], 60, 30) as Pt[]; };
    const bus = (id: BusKind) => i.buses.find((b) => b.id === id);
    const push = (id: string, pts: Pt[], w: number, branch = false) => flows.push({ id, pts, watts: w, state: state(true, w), ...(branch ? { branch } : {}) });
    if (!hasPsu) {
      // no PSU: nothing flows
    } else if (kind === 'cpu') {
      // the 8-pin's pins onto the input rail, then each phase's output down into the package
      const rail = bus('pwrcpu'), core = bus('vcore');
      rail?.lanes.forEach((l, k) => push(`trace.pwrcpu.${k}`, l.pts as Pt[], k === 0 ? g.w : g.w / 4, k > 0));
      core?.lanes.forEach((l, k) => push(`trace.vcore.${k}`, l.pts as Pt[], g.w / core.lanes.length, true));
    } else if (kind === 'ram') {
      // the 24-pin's 12 V to the memory regulator, its output along the DIMM sockets, and a drop into every stick
      const feed = bus('pwr12'), out = bus('vdimm');
      feed?.lanes.forEach((l, k) => push(`trace.pwr12.${k}`, l.pts as Pt[], g.w));
      out?.lanes.forEach((l, k) => push(`trace.vdimm.${k}`, l.pts as Pt[], g.w / out.lanes.length * 2));
      for (const d of s.devices) {
        const tap = d.kind === 'ram' ? out?.taps?.find((t) => t.key === d.slot) : undefined;
        if (tap) push(`trace.vdimm.${d.slot}`, tap.lanes[0]!.pts as Pt[], on ? d.powerW : 0, true);
      }
    } else if (kind === 'gpu' || kind === 'nic' || kind === 'npu') {
      // a card in a PCIe slot: the slot rail's trace from the 24-pin to the x16 slot's tab (`pwrpcie`), and on along the slot; the other slots ride the strip beside the connector
      for (const d of s.devices) {
        const k = d.kind === kind ? Number(/^pcie(\d+)$/.exec(d.slot)?.[1] ?? -1) : -1, rail = GEO.pcie[k];
        if (!rail) continue;
        const own = cards.find((c) => c.slot === d.slot), w = own ? own.w / (assignLeads([own]).length + 1) : on ? d.powerW : 0, f = pcieFeed(rail);
        const trace = bus('pwrpcie')?.lanes[k];
        const pts = trace ? (k === 0 ? [...(trace.pts as Pt[]), [rail.x + rail.w / 2, f[1]] as Pt] : (trace.pts as Pt[])) : strip({ ...rail, y: f[1] - rail.h / 2 });
        push(`feed.${d.slot}`, pts, w, true);
      }
    } else if (kind === 'storage' && s.devices.some((d) => d.kind === 'storage' && /^m2\d+$/.test(d.slot))) {
      // an M.2 drive: the branch trace into its socket's power patch (`pwrpcie`, after the slots'), the lens's own run if the board has none
      for (const d of s.devices) {
        if (d.kind !== 'storage' || sataSlots.has(d.slot)) continue;
        const k = Number(/^m2(\d+)$/.exec(d.slot)?.[1] ?? -1), lane = k >= 0 ? bus('pwrpcie')?.lanes[GEO.pcie.length + k] : undefined, r = i.slots.get(d.slot);
        if (lane) push(`feed.${d.slot}`, lane.pts as Pt[], on ? d.powerW : 0, true);
        else if (r) push(`feed.${d.slot}`, strip(r), on ? d.powerW : 0, true);
      }
    } else if (kind !== 'cooler') {
      // a part with no trace of its own (a drive, a heatsink's fan): over the strip beside the 24-pin to the part
      const x0 = Math.min(...g.rects.map((q) => q.x)), y0 = Math.min(...g.rects.map((q) => q.y)), x1 = Math.max(...g.rects.map((q) => q.x + q.w)), y1 = Math.max(...g.rects.map((q) => q.y + q.h));
      push(`feed.${kind}`, strip({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }), g.w, true);
    }
    if (g.w >= 0.05) tags.push({ id: `dev.${kind}`, at: [(x0 + x1) / 2, kind === 'cooler' ? y1 + 120 : y0 - 120], text: `${names[kind] ?? kind.toUpperCase()} ${watts(g.w)}`, tone: 'watts', anchor: 'c' });
  }
  return { flows, tags, marks };
}

// ---------------------------------------------------------------- drawing

interface View { x: number; y: number; z: number; cx: number; cy: number; w: number; h: number }

const lane = (f: LensFlow): Lane => mkLane(f.pts);

/** Pixels per second the dots travel, and the line width in pixels, by watts (a handful of watts is a thread, a hundred a pipe). */
export const flowSpeed = (w: number) => 30 + 14 * Math.sqrt(Math.max(0, w));
export const flowWidth = (w: number, branch = false) => (branch ? 2 : 3) + Math.min(9, 0.9 * Math.sqrt(Math.max(0, w)));

export class PowerLens {
  readonly root = new Container();
  private dim = new Graphics();
  private g = new Graphics();
  private pills = new Graphics();
  private labels = new Container();
  private pool: Text[] = [];
  private lanes = new Map<string, Lane>();
  private t = 0;
  model: LensModel | null = null;
  private T!: Theme;

  constructor() { this.root.addChild(this.dim, this.g, this.pills, this.labels); this.root.visible = false; }

  setTheme(T: Theme) { this.T = T; }

  /** A new model (the snapshot or a plug moved): the lanes the dots run along are rebuilt. */
  setModel(m: LensModel | null) {
    this.model = m;
    this.lanes.clear();
    if (m) for (const f of m.flows) this.lanes.set(f.id, lane(f));
  }

  get visible() { return this.root.visible; }

  /** Draw the lens over the view (world units; `dt` in seconds of game time, so the dots stop with the pause). */
  frame(on: boolean, v: View, dt: number, now: number) {
    this.root.visible = on && !!this.model;
    if (!this.root.visible) return;
    const m = this.model!, T = this.T, z = v.z, px = (n: number) => n / z;
    this.t += dt;
    const dark = T.dark;
    const left = v.x - v.cx / z, top = v.y - v.cy / z, w = v.w / z, h = v.h / z;
    const g = this.g;
    this.dim.clear().rect(left, top, w, h).fill({ color: dark ? '#02040a' : '#10182b', alpha: dark ? 0.76 : 0.6 });
    g.clear();
    const hot = T.ld, bad = T.bad;
    for (const f of m.flows) {
      const col = f.state === 'missing' ? bad : hot, lw = px(flowWidth(f.watts, f.branch));
      const pulse = f.state === 'missing' ? 0.45 + 0.4 * Math.sin(now / 160) : 1;
      this.path(g, f.pts);
      g.stroke({ width: lw + px(6), color: col, alpha: (f.state === 'idle' ? 0.12 : 0.2) * pulse, cap: 'round', join: 'round' });
      this.path(g, f.pts);
      g.stroke({ width: lw, color: col, alpha: (f.state === 'idle' ? 0.35 : f.branch ? 0.55 : 0.85) * pulse, cap: 'round', join: 'round' });
      if (f.state !== 'on') continue;
      // the dots: evenly spaced, running source to sink, faster and bigger with the watts
      const l = this.lanes.get(f.id)!, sp = px(26), run = px(flowSpeed(f.watts)) * this.t;
      for (let d = run % sp; d < l.len; d += sp) {
        const [x, y] = pointAt(l, d);
        g.circle(x, y, lw * 0.55).fill({ color: '#ffffff', alpha: 0.9 });
      }
    }
    for (const k of m.marks) {
      const col = k.tone === 'ok' ? hot : bad, pulse = k.tone === 'ok' ? 1 : 0.5 + 0.5 * Math.sin(now / 160);
      g.circle(k.at[0], k.at[1], k.r).stroke({ width: px(3), color: col, alpha: 0.9 * pulse });
      if (k.tone === 'warn') g.circle(k.at[0], k.at[1], k.r * (1.1 + 0.25 * pulse)).stroke({ width: px(2), color: col, alpha: 0.5 * (1 - pulse) });
    }
    this.tags(m.tags, z);
  }

  private path(g: Graphics, pts: Pt[]) {
    g.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
  }

  /** The words, a constant 13 px on screen whatever the zoom; Texts are pooled. */
  private tags(tags: LensTag[], z: number) {
    const T = this.T, pad = 5 / z;
    this.pills.clear();
    tags.forEach((tag, i) => {
      let t = this.pool[i];
      if (!t) {
        t = new Text({ text: '', style: { fontFamily: MONO, fontSize: 13, fontWeight: '700', fill: '#ffffff' }, resolution: currentTextResolution() });
        this.pool[i] = t; this.labels.addChild(t);
      }
      if (t.text !== tag.text) t.text = tag.text;
      t.style.fill = tag.tone === 'warn' ? T.bad : tag.tone === 'dim' ? T.mute : T.ld;
      t.anchor.set(tag.anchor === 'l' ? 0 : tag.anchor === 'r' ? 1 : 0.5, 0.5);
      t.scale.set(1 / z);
      t.position.set(tag.at[0], tag.at[1]);
      t.visible = true;
      // a dark plate behind the words, so they read on any room
      const w = t.width, h = t.height, x0 = tag.at[0] - (tag.anchor === 'l' ? 0 : tag.anchor === 'r' ? w : w / 2);
      this.pills.roundRect(x0 - pad, tag.at[1] - h / 2 - pad * 0.4, w + 2 * pad, h + pad * 0.8, 5 / z).fill({ color: '#04060f', alpha: 0.78 });
    });
    for (let i = tags.length; i < this.pool.length; i++) this.pool[i]!.visible = false;
  }
}
