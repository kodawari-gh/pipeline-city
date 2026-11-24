// The copper of a graphics card and an AI card (docs/render/net.md "Inside the NIC and the router", the same peek): the runs on the PCB's top face between the gold fingers, the main die, the card memory's die and the
// power stage, in layout units (23 a mm, y down). Pure geometry: `accelparts3d.ts` paints it under the mask and lights it. It is routed as a real card's is, in the large: the slot's receive pairs
// come down from their fingers as a staircase bus (one level a line, each line jogging to its own ball column on the die's north edge, by 45-degree corners) and close to the die's pitch; the memory bus
// runs straight east across the gap from the main die to the memory die; each inductor feeds the die's west edge by a wide run. Nothing here crosses: the lines of one side jog at levels in order, so a
// line's horizontal never meets another's vertical (`accelcopper.test.ts` checks it).
import type { RectLike } from '@/core/render/three/geometry';
import { chamfer, clean, type Pt, type Trace } from './niccopper';
import { pinAt, txPin } from './pcie';
import { TRACE_BAND, type NicLanes } from './nicflow';
import { mkLane, type Pt as LanePt } from '../wiring/routes';

const MM = 23;
/** The ground pour's clearance off a run (layout units). */
export const POUR_CLEAR = 2.4;
/** A signal's width at most (0.17 mm), a power run's (0.6 mm), the clearance between runs (0.11 mm: the ground pour keeps `POUR_CLEAR` off each). */
const SIG = 4,
  WIDE = 14,
  CLEAR = 2.6;
/** The memory bus: this many lines, at this pitch (mm). */
const MEM_LINES = 16,
  MEM_PITCH = 0.42;

export interface AccelCopperIn {
  /** The finger tab (layout x of its bracket end, and its length) and the slot's line (layout y: the PCB's north edge). */
  tab: { x: number; w: number };
  y0: number;
  /** The packages (layout) of the main die and of the card memory's die, and the power stage's inductors. */
  core: RectLike;
  mem: RectLike;
  inductors: readonly RectLike[];
}

export interface AccelCopper {
  traces: Trace[];
  /** The lit runs: the slot's receive lines (finger to die) and the memory bus (main die to memory die), each as a polyline. */
  host: Pt[][];
  mem: Pt[][];
  /** How many receive pairs the tab carries (a tab cut short by the card's end or the slot carries fewer than 16). */
  lanes: number;
}

/** The receive lines a tab carries: a pair a lane, from side B's pins, as far as the tab reaches. */
export function hostFingers(tab: { x: number; w: number }): { net: string; x: number }[] {
  const out: { net: string; x: number }[] = [];
  for (let k = 0; k < 16; k++) {
    const p = txPin(k);
    if (pinAt(p + 1) > tab.w - 0.7 * MM) break;
    out.push({ net: `PET${k}+`, x: tab.x + pinAt(p) }, { net: `PET${k}-`, x: tab.x + pinAt(p + 1) });
  }
  return out;
}

/**
 * A staircase bus from lines starting at `xs` (sorted, at y `y0`) to the columns `ts` (same order, closer together than `xs`) ending at `yEnd`: each line goes down, jogs across at its own level
 * and goes on down. The level steps up from `low` by at most `step`, closer if the room above (to `top`) is short. A line that goes east jogs lower the further west it starts (its way is longer), one that goes
 * west the further east, so no line's horizontal meets another's vertical; the two sides never share a column span, so they share the levels. Returns the lines and the step used.
 */
function staircase(
  xs: number[],
  ts: number[],
  y0: number,
  yEnd: number,
  low: number,
  top: number,
  step: number,
): { lines: Pt[][]; step: number } {
  const n = xs.length,
    out: Pt[][] = new Array(n);
  const east: number[] = [],
    west: number[] = [];
  for (let i = 0; i < n; i++) (ts[i]! >= xs[i]! ? east : west).push(i);
  west.reverse();
  const st = Math.min(step, (low - top) / Math.max(1, east.length - 1, west.length - 1));
  for (const side of [east, west])
    side.forEach((i, j) => {
      const y = low - j * st;
      out[i] = [
        [xs[i]!, y0],
        [xs[i]!, y],
        [ts[i]!, y],
        [ts[i]!, yEnd],
      ];
    });
  return { lines: out.map((p) => chamfer(clean(p), 0.3 * MM)), step: st };
}

export function accelCopper(a: AccelCopperIn): AccelCopper {
  const traces: Trace[] = [],
    f = hostFingers(a.tab),
    { core, mem } = a;
  // ---- the slot's receive pairs: down from the fingers to the die's north edge, closing to a pitch the die takes (centred on it)
  const lo = core.x + 1.6 * MM,
    hi = core.x + core.w - 1.6 * MM,
    n = f.length,
    pitch = n > 1 ? Math.min((hi - lo) / (n - 1), 0.9 * MM) : 0,
    mid = core.x + core.w / 2;
  const ts = f.map((_, i) => mid + (i - (n - 1) / 2) * pitch),
    yEnd = core.y + 1.2 * MM;
  const { lines, step } = staircase(
    f.map((q) => q.x),
    ts,
    a.y0 + 0.2 * MM,
    yEnd,
    core.y - 3.8 * MM,
    a.y0 + 2.6 * MM,
    0.42 * MM,
  );
  // (the width follows the pitch the bus closes to and the levels' step: the lines' clearance holds on the tightest die)
  const w = Math.max(2.4, Math.min(SIG, pitch - CLEAR, step - CLEAR));
  const host: Pt[][] = [];
  lines.forEach((pts, i) => {
    traces.push({ net: f[i]!.net, layer: 'top', w, pts });
    host.push(pts);
  });
  // ---- the memory bus: straight east across the gap, at the memory die's pitch about the dies' common middle
  const cy = Math.min(Math.max(core.y + core.h / 2, mem.y + mem.h / 2 - 0.2 * MM), mem.y + mem.h / 2 + 0.2 * MM),
    memLines: Pt[][] = [];
  const span = (MEM_LINES - 1) * MEM_PITCH * MM,
    fit = Math.min(1, (mem.h - 1.6 * MM) / span);
  for (let k = 0; k < MEM_LINES; k++) {
    const y = cy + (k - (MEM_LINES - 1) / 2) * MEM_PITCH * MM * fit,
      pts: Pt[] = [
        [core.x + core.w - 1.2 * MM, y],
        [mem.x + 1.2 * MM, y],
      ];
    traces.push({ net: `MEM${k}`, layer: 'top', w: SIG - 0.6, pts });
    memLines.push(pts);
  }
  // ---- the power stage: each inductor's east end to the die's west edge, a wide run
  for (const r of a.inductors)
    traces.push({
      net: 'VCORE',
      layer: 'top',
      w: WIDE,
      pts: [
        [r.x + r.w - 0.2 * MM, r.y + r.h / 2],
        [core.x + 1.2 * MM, r.y + r.h / 2],
      ],
    });
  return { traces, host, mem: memLines, lanes: n / 2 };
}

/**
 * The lit lanes (`Chips3D.traces`): the receive lines (the slot's frames come down them toward the die) and the memory bus (from the die toward the memory), in the card's band of the shared drawing
 * (`TRACE_BAND`). `host` is the NIC's name for the same run; `media` carries the memory bus.
 */
export function accelLanes(c: AccelCopper, slot: number, x0: number): NicLanes {
  const off = slot * TRACE_BAND - x0,
    to = (p: Pt): LanePt => [p[0] + off, p[1]];
  const lanes = { media: c.mem.map((l) => mkLane(l.map(to))), host: c.host.map((l) => mkLane(l.map(to))) };
  const all = [...lanes.media, ...lanes.host].flatMap((l) => l.pts),
    M = 20;
  if (!all.length) return { ...lanes, rect: { x: slot * TRACE_BAND, y: 0, w: 0, h: 0 }, off };
  const xa = Math.min(...all.map((p) => p[0])) - M,
    ya = Math.min(...all.map((p) => p[1])) - M,
    xb = Math.max(...all.map((p) => p[0])) + M,
    yb = Math.max(...all.map((p) => p[1])) + M;
  return { ...lanes, rect: { x: xa, y: ya, w: xb - xa, h: yb - ya }, off };
}
