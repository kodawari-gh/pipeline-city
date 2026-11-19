// The power lens's net (docs/render/power.md): every run of power the lens draws, as lines in the machine's own space, and what the watts do to them. Two steps.
// `powerShape` is the machine as built (the real cables' strands from `Machine3D.cableRuns`, the board's own traces, the hidden runs behind the tray, a ring for
// each socket): it changes only when a cable, a part or the board does. `powerDraw` is one snapshot on that shape: each line's place on the power scale, its
// state, the parts' glow and the words. Pure: no Three, no DOM, so it is tested alone (`net.test.ts`).
import type { Snapshot } from '@/worker/protocol';
import type { Rect } from '@/core/render/camera';
import type { V3 } from '@/core/render/three/rope';
import { levelOf } from '@/core/render/three/powerscale';
import { GEO } from '../../layout/layout';
import { atx12vSlots, pcieFeed } from '../../layout/pins';
import { roundedPath, type Bus, type BusKind } from '../../wiring/routes';
import type { AirTag } from '../air/airtags';
import type { PsuBay } from '../air/plan';
import { wattsText, type FlowState, type Ledger } from './ledger';
import type { CableRun } from './runs';

type Pt = [number, number];

/** Half-widths of a line, in units (23000 a metre): a cable's glow reaches past its sleeve; the board's copper is finer; a run the machine does not show is a thread. */
const W_CABLE = 17, W_TRACE = 22, W_BRANCH = 14, W_GHOST = 11;
/** How long the stub of a hidden run is, units (about 6 cm). */
const STUB = 1500;
/** How far over the board's face the traces' lines lie, and how far the shader lifts them toward the eye besides; a cable's light is lifted this much clear of its sleeve. */
const TRACE_LIFT = 10, LIFT_TRACE = 70, LIFT_CLEAR = 14;

/** One run of power. */
export interface PowerLine {
  id: string;
  /** The cable it is part of (a held cable's lines are hidden: the hand draws its own), '' for a trace on the board. */
  cable: string;
  /** `cable`: a strand of a real cable; `trace`: copper on the board; `ghost`: the run of a cable the machine does not model (behind the tray, from the supply): a short stub of it, drawn dim and through the parts. */
  kind: 'cable' | 'trace' | 'ghost';
  /** A stub fades in along this length (units, from its first point), toward the cable it ends in. 0: the line does not fade. */
  fade: number;
  /** In the order the power goes. */
  pts: V3[];
  /** Half the width, in units. */
  width: number;
  /** How far toward the eye the line is lifted (units): out of its cable's sleeve, off the board's face. */
  lift: number;
  /** A thin branch (the feed to one part). */
  branch: boolean;
  /** What it carries and in which state, by the ledger. */
  watts: (l: Ledger) => number;
  state: (l: Ledger) => FlowState;
}

/** A ring on a cable's socket: drawn while the cable is out. */
export interface PowerRing { id: string; cable: string; at: V3; r: number }

export interface PowerShape {
  lines: PowerLine[];
  rings: PowerRing[];
  /** Where each cable's plug seats, by cable id. */
  seats: ReadonlyMap<string, V3>;
  /** Where the PC's cord leaves the wall, where the monitor's cord ends, and where the fan hub's cord leaves the board (null: no such cable). */
  wall: V3 | null;
  monitor: V3 | null;
  hub: V3 | null;
  psu: PsuBay | null;
}

export interface ShapeIn {
  s: Snapshot;
  runs: readonly CableRun[];
  buses: readonly Bus[];
  slots: ReadonlyMap<string, Rect>;
  psu: PsuBay | null;
  /** The z of the board's face. */
  boardZ: number;
}

/** The cables that carry no power. */
const DATA = new Set(['video', 'lan']);

/** The size of a ring round a cable's socket, units. */
const ringSize = (id: string): number => (id === 'atx' ? 420 : id === 'pcmains' || id === 'monmains' ? 340 : id === 'cpu' ? 300 : id.startsWith('pcie') ? 260 : 170);

const offBoard = (r: Rect): boolean => r.x > GEO.bd.x + GEO.bd.w || r.x + r.w < GEO.bd.x || r.y > GEO.bd.y + GEO.bd.h || r.y + r.h < GEO.bd.y;

/** The board's copper that carries power, as lines in world space: the 8-pin to the CPU, the 24-pin to the memory and the slots, and a branch to each part. */
function traces(i: ShapeIn): PowerLine[] {
  const { s } = i, out: PowerLine[] = [], z = i.boardZ + TRACE_LIFT;
  const sata = new Set(s.storage.filter((d) => d.slot.startsWith('sata')).map((d) => d.slot));
  const bus = (id: BusKind): Bus | undefined => i.buses.find((b) => b.id === id);
  const push = (id: string, pts: readonly Pt[], watts: (l: Ledger) => number, branch = false): void => {
    if (pts.length < 2) return;
    out.push({ id, cable: '', kind: 'trace', fade: 0, pts: pts.map(([x, y]): V3 => [x, -y, z]), width: branch ? W_BRANCH : W_TRACE, lift: LIFT_TRACE, branch, watts, state: (l) => (watts(l) > 0.05 ? 'on' : 'idle') });
  };
  // a part with no trace of its own: the strip beside the 24-pin, then across to the part
  const strip = (r: Rect): Pt[] => { const a = atx12vSlots(GEO.atx), xv = GEO.atx.x - 40, cy = r.y + r.h / 2; return roundedPath([a, [xv, a[1]], [xv, cy], [r.x + r.w / 2, cy]], 60, 30) as Pt[]; };
  const kinds = new Set(s.devices.map((d) => d.kind));
  if (!s.devices.some((d) => d.kind === 'psu')) return out;
  if (kinds.has('cpu')) {
    // the 8-pin's pins onto the input rail, then each phase's output down into the package
    const cpu = (l: Ledger): number => l.cable.get('cpu') ?? 0;
    bus('pwrcpu')?.lanes.forEach((l, k) => push(`trace.pwrcpu.${k}`, l.pts as Pt[], k === 0 ? cpu : (q) => cpu(q) / 4, k > 0));
    const core = bus('vcore');
    core?.lanes.forEach((l, k) => push(`trace.vcore.${k}`, l.pts as Pt[], (q) => cpu(q) / core.lanes.length, true));
  }
  if (kinds.has('ram')) {
    // the 24-pin's 12 V to the memory regulator, its output along the DIMM sockets, and a drop into every stick
    const ram = (l: Ledger): number => l.kinds.get('ram')?.w ?? 0, feed = bus('pwr12'), line = bus('vdimm');
    feed?.lanes.forEach((l, k) => push(`trace.pwr12.${k}`, l.pts as Pt[], ram));
    line?.lanes.forEach((l, k) => push(`trace.vdimm.${k}`, l.pts as Pt[], (q) => (ram(q) / line.lanes.length) * 2));
    for (const d of s.devices) {
      const tap = d.kind === 'ram' ? line?.taps?.find((t) => t.key === d.slot) : undefined;
      if (tap) push(`trace.vdimm.${d.slot}`, tap.lanes[0]!.pts as Pt[], (l) => l.board.get(d.id) ?? 0, true);
    }
  }
  for (const d of s.devices) {
    const r = i.slots.get(d.slot);
    if (!r || offBoard(r) || sata.has(d.slot)) continue;
    const own = (l: Ledger): number => l.board.get(d.id) ?? 0;
    if (d.kind === 'gpu' || d.kind === 'npu' || d.kind === 'nic') {
      // a card in a PCIe slot: the slot rail's trace from the 24-pin to the x16 slot's tab (`pwrpcie`), and on along the slot; the other slots ride the strip beside the connector
      const k = Number(/^pcie(\d+)$/.exec(d.slot)?.[1] ?? -1), rail = GEO.pcie[k];
      if (!rail) continue;
      const f = pcieFeed(rail), trace = bus('pwrpcie')?.lanes[k];
      push(`feed.${d.slot}`, trace ? (k === 0 ? [...(trace.pts as Pt[]), [rail.x + rail.w / 2, f[1]] as Pt] : (trace.pts as Pt[])) : strip({ ...rail, y: f[1] - rail.h / 2 }), own, true);
    } else if (d.kind === 'storage' && /^m2\d+$/.test(d.slot)) {
      // an M.2 drive: the branch trace into its socket's power patch (`pwrpcie`, after the slots'), the lens's own run if the board has none
      const k = Number(/^m2(\d+)$/.exec(d.slot)![1]), lane = bus('pwrpcie')?.lanes[GEO.pcie.length + k];
      push(`feed.${d.slot}`, lane ? (lane.pts as Pt[]) : strip(r), own, true);
    } else if (d.kind === 'tpm') push(`feed.${d.slot}`, strip(r), own, true);
  }
  return out;
}

/** The machine as built: the lines the lens draws and the rings on the sockets. */
export function powerShape(i: ShapeIn): PowerShape {
  const lines: PowerLine[] = [], rings: PowerRing[] = [], seats = new Map<string, V3>();
  const runs = i.runs.filter((r) => !DATA.has(r.id));
  for (const r of runs) {
    seats.set(r.id, r.seat.at);
    rings.push({ id: `${r.id}.ring`, cable: r.id, at: r.seat.at, r: ringSize(r.id) });
    // (a cable carries what the ledger says of it: a drive's lead is `<id>:power`, the rest by the sim's id)
    const watts = (l: Ledger): number => l.cable.get(r.id) ?? 0, state = (l: Ledger): FlowState => l.state(r.id);
    // (the light is as wide as the sleeve it runs in, lifted clear of it)
    const width = Math.max(W_CABLE, r.r * 0.75), lift = r.r + LIFT_CLEAR;
    r.strands.forEach((pts, k) => { if (pts.length > 1) lines.push({ id: `${r.id}#${k}`, cable: r.id, kind: 'cable', fade: 0, pts, width, lift, branch: false, watts, state }); });
    // a cable from the supply comes in behind the tray, a run the machine does not show: each strand goes on past its first point for a short stub, the way it was heading,
    // fading away from the cable. (Drawn on to the supply it would cross the case in straight lines that are nobody's cable.)
    if (r.fed) {
      r.strands.forEach((pts, k) => {
        const p = pts[0], q = pts[1];
        if (!p || !q) return;
        const d: V3 = [p[0] - q[0], p[1] - q[1], p[2] - q[2]], len = Math.hypot(d[0], d[1], d[2]);
        if (!(len > 1e-3)) return;
        const back: V3 = [p[0] + (d[0] / len) * STUB, p[1] + (d[1] / len) * STUB, p[2] + (d[2] / len) * STUB];
        lines.push({ id: `${r.id}~${k}`, cable: r.id, kind: 'ghost', fade: STUB, pts: [back, p], width: Math.max(W_GHOST, r.r * 0.5), lift: 0, branch: false, watts, state });
      });
    }
  }
  lines.push(...traces(i));
  const run = (id: string): CableRun | undefined => runs.find((r) => r.id === id);
  const first = (id: string): V3 | null => run(id)?.strands[0]?.[0] ?? null, last = (id: string): V3 | null => { const p = run(id)?.strands.at(-1); return p?.[p.length - 1] ?? null; };
  return { lines, rings, seats, wall: first('pcmains'), monitor: last('monmains'), hub: first('sysfan'), psu: i.psu };
}

/** The words of a cable that is out. */
const WARNING = (id: string): string => (id === 'pcmains' ? 'PLUG THE PC IN' : id === 'monmains' ? 'PLUG THE MONITOR IN' : id === 'atx' ? 'NO MAIN POWER' : id === 'cpu' ? 'NO CPU POWER' : id.startsWith('pcie') ? 'NO CARD POWER' : 'NO FAN POWER');

/** The names of the kinds of part the lens puts a draw beside. */
const NAMES: Readonly<Record<string, string>> = { cpu: 'CPU', ram: 'RAM', nic: 'NIC', gpu: 'GPU', npu: 'NPU', tpm: 'TPM', storage: 'DRIVE' };

/** A part's box in the machine's space, or null. */
export type BoxOf = (id: string) => { min: V3; max: V3 } | null;

/** What a snapshot does to the shape. */
export interface PowerDraw {
  /** Per line (the shape's order): its place on the power scale, 0 to 1. */
  level: Float32Array;
  /** Per line: 0 idle, 1 on, 2 missing. */
  state: Uint8Array;
  /** Per ring: is its cable out? */
  open: Uint8Array;
  /** The words. */
  tags: AirTag[];
  /** Each part's place on the scale, by device id, and the parts that glow red (the supply, over its budget). */
  parts: Map<string, number>;
  warn: Set<string>;
  /** The draw at the top of the scale, W. */
  refW: number;
}

const CODE: Record<FlowState, number> = { idle: 0, on: 1, missing: 2 };

/** One snapshot, as a ledger, on the shape. `box`: a part's box, where its draw is written. */
export function powerDraw(shape: PowerShape, s: Snapshot, l: Ledger, box: BoxOf): PowerDraw {
  const n = shape.lines.length, level = new Float32Array(n), state = new Uint8Array(n), open = new Uint8Array(shape.rings.length);
  shape.lines.forEach((line, k) => {
    const st = line.state(l);
    state[k] = CODE[st];
    level[k] = st === 'on' ? levelOf(line.watts(l), l.refW) : 0;
  });
  shape.rings.forEach((r, k) => { open[k] = l.missing(r.cable) ? 1 : 0; });

  const tags: AirTag[] = [];
  const over = (p: V3, dx = 0, dy = 0, dz = 0): V3 => [p[0] + dx, p[1] + dy, p[2] + dz];
  if (shape.wall) tags.push({ id: 'p.wall', at: over(shape.wall, 0, 260, 120), text: `WALL ${wattsText(l.wallW)}`, tone: 'watts', anchor: 'l' });
  const psu = shape.psu;
  if (psu) tags.push({ id: 'p.psu', at: [(psu.min[0] + psu.max[0]) / 2, psu.max[1] + 80, psu.max[2]], text: `LOAD ${wattsText(l.loadW)} / ${Math.round(l.budgetW)} W`, tone: l.tripped ? 'warn' : 'watts', anchor: 'c' });
  if (shape.monitor && l.hasMonitor) tags.push({ id: 'p.monitor', at: over(shape.monitor, 0, 200, 100), text: `MONITOR ${wattsText(l.monW)}`, tone: 'watts', anchor: 'r' });
  // what each kind of part takes, over its box (a drive on its own: the drives stand far apart)
  for (const [kind, k] of l.kinds) {
    const name = NAMES[kind];
    if (!name || k.w < 0.05) continue;
    const groups = kind === 'storage' ? k.ids.map((id) => [id]) : [k.ids];
    for (const ids of groups) {
      const boxes = ids.map(box).filter((b): b is { min: V3; max: V3 } => !!b);
      if (!boxes.length) continue;
      const lo = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.min[a]!))), hi = [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.max[a]!)));
      const w = ids.reduce((t, id) => t + (l.part.get(id) ?? 0), 0);
      tags.push({ id: `p.${ids[0]}`, at: [(lo[0]! + hi[0]!) / 2, hi[1]! + 40, hi[2]!], text: `${name} ${wattsText(w)}`, tone: 'watts', anchor: 'c', minor: true });
    }
  }
  if (shape.hub && (l.cable.get('sysfan') ?? 0) >= 0.05) tags.push({ id: 'p.fans', at: over(shape.hub, 0, 160, 60), text: `FANS ${wattsText(l.cable.get('sysfan') ?? 0)}`, tone: 'watts', anchor: 'c', minor: true });
  // a cable that is out: its words at the open socket
  for (const r of shape.rings) if (l.missing(r.cable)) { const at = shape.seats.get(r.cable)!; tags.push({ id: `p.${r.cable}.warn`, at: over(at, 0, r.r + 120, 80), text: WARNING(r.cable), tone: 'warn', anchor: 'c' }); }
  if (!l.hasPsu && shape.seats.has('atx')) tags.push({ id: 'p.nopsu', at: over(shape.seats.get('atx')!, 0, 520, 80), text: 'NO POWER SUPPLY', tone: 'warn', anchor: 'c' });
  // the scale: under the first words
  const lead = tags.find((t) => t.tone !== 'warn');
  if (lead) tags.push({ id: 'p.scale', at: lead.at, text: '', tone: 'dim', anchor: lead.anchor, scale: [0, Math.round(l.refW)], unit: 'W', under: lead.id });

  const parts = new Map<string, number>(), warn = new Set<string>();
  for (const [id, w] of l.part) parts.set(id, levelOf(w, l.refW));
  if (l.tripped) for (const d of s.devices) if (d.kind === 'psu') warn.add(d.id);
  return { level, state, open, tags, parts, warn, refW: l.refW };
}
