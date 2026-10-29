import { getSpec } from '../../sim/board/specs';
import type { GpuSnap } from '../../sim/game/types';
import type { Snapshot } from '../../sim/protocol';
import { memoryTable, sizeText } from '../board/ramlayout';

// What the graphics display's dashboard shows, as a pure function of the snapshot (the pixi side is screenview.ts).
// Only numbers the sim really has: there is no per-process CPU split (one program runs at a time per context and the
// counters are the engine's, not a program's), so the process table shows state, memory and time, and the CPU rows are the machine's.

export type Tone = 'ok' | 'warn' | 'bad' | 'dim';

export interface DashBar { label: string; text: string; frac: number; tone: Tone; mark?: number }
export interface DashProc { pid: string; name: string; state: string; mem: string; time: string; tone: 'run' | 'wait' | 'done' }
/** A stacked bar: the parts in order, each a fraction of the whole. */
export interface DashStack { label: string; text: string; parts: { frac: number; tone: 'sys' | 'proc' | 'free' }[] }

export interface DashModel {
  title: string;
  status: string;
  sub: string;
  bars: DashBar[];
  mem: DashStack | null;
  /** Retired instructions per cycle over the last samples, oldest first (the sparkline). */
  ipc: number[];
  ipcText: string;
  net: string;
  procs: DashProc[];
  more: number;
  prompt: string;
  promptTone: 'ok' | 'warn' | 'dim';
}

/** What the view remembers between snapshots. */
export interface DashCtx {
  upTick: number | null;
  ipc: number[];
  /** When each key's program was first seen running (base tick). */
  started: ReadonlyMap<number, number>;
  /** The GPU's frame is up under the process table: fewer rows fit. */
  compact?: boolean;
}

export const IPC_SAMPLES = 48;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Instructions per cycle between two counter readings (null when no cycles passed or the counters restarted). */
export function ipcBetween(prev: Record<string, number> | null, cur: Record<string, number>): number | null {
  if (!prev) return null;
  const dc = (cur.cycles ?? 0) - (prev.cycles ?? 0), dr = (cur.retired ?? 0) - (prev.retired ?? 0);
  return dc > 0 && dr >= 0 ? dr / dc : null;
}

/** `mm:ss` of a tick count (a base tick is a second). */
export const clock = (ticks: number): string => `${String(Math.floor(ticks / 60)).padStart(2, '0')}:${String(Math.floor(ticks % 60)).padStart(2, '0')}`;

const tempTone = (t: number, thr?: number, bad?: number): Tone => (bad !== undefined && t >= bad ? 'bad' : thr !== undefined && t >= thr ? 'warn' : 'ok');

export function dashModel(s: Snapshot, ctx: DashCtx): DashModel | null {
  const os = s.os;
  if (!os) return null;
  const ph = s.phase, q = os.queue ?? [];
  const status = ph === 'idle-os' ? 'READY' : ph === 'ingesting' ? 'INGEST' : ph === 'running-os' ? 'RUNNING' : ph === 'flashing' ? 'FLASHING' : 'BOOTING';
  const up = ctx.upTick === null ? null : Math.max(0, s.baseTick - ctx.upTick);
  const sub = `UP ${up === null ? '--:--' : clock(up)}   PROG ${os.programSlots ?? 1}   QUEUE ${q.length}/${os.queueSlots ?? '?'}`;

  const bars: DashBar[] = [];
  const cpu = s.devices.find((d) => d.kind === 'cpu');
  if (cpu && s.cpuClock) {
    const c = s.cpuClock, span = c.max - c.min || 1;
    bars.push({ label: 'CLOCK', text: cpu.burnt ? 'BURNT' : `${cpu.effectiveClock.toFixed(2)}x`, frac: clamp01((cpu.effectiveClock - c.min) / span), tone: cpu.burnt ? 'bad' : cpu.throttle < 1 ? 'warn' : 'ok' });
  }
  if (cpu) {
    const sp = getSpec(cpu.spec), th = sp?.thermal;
    bars.push({ label: 'TEMP', text: `${cpu.tempC.toFixed(0)} C`, frac: clamp01(cpu.tempC / (th?.damageC ?? 100)), tone: tempTone(cpu.tempC, th?.throttleC, th?.unstableC), mark: th ? th.throttleC / th.damageC : undefined });
  }
  bars.push({ label: 'POWER', text: `${s.power.totalW.toFixed(0)}/${s.power.budgetW.toFixed(0)} W`, frac: clamp01(s.power.totalW / Math.max(1, s.power.budgetW)), tone: s.power.tripped || s.power.totalW > s.power.budgetW ? 'bad' : s.power.totalW > 0.85 * s.power.budgetW ? 'warn' : 'ok' });
  const disk = s.storage?.find((x) => x.hasOs) ?? s.storage?.find((x) => x.slot === os.slot);
  if (disk && disk.capacityBytes > 0) {
    const f = clamp01(disk.usedBytes / disk.capacityBytes);
    bars.push({ label: `DISK ${disk.slot.toUpperCase()}`, text: `${Math.round(disk.usedBytes / 1024)}K/${Math.round(disk.capacityBytes / 1024)}K`, frac: f, tone: f > 0.95 ? 'bad' : f > 0.8 ? 'warn' : 'ok' });
  }

  const mt = s.ram ? memoryTable(s.ram.regions, s.ram.bytes) : null;
  const mem: DashStack | null = mt && mt.total > 0 ? {
    label: 'MEM',
    text: `${sizeText(mt.total)}  SYS ${sizeText(mt.sys)}  FREE ${sizeText(mt.free)}`,
    parts: [
      { frac: mt.sys / mt.total, tone: 'sys' },
      { frac: mt.procs.reduce((a, p) => a + p.bytes, 0) / mt.total, tone: 'proc' },
      { frac: mt.free / mt.total, tone: 'free' },
    ],
  } : null;

  const last = ctx.ipc.length ? ctx.ipc[ctx.ipc.length - 1]! : null;
  const vm = s.mmu && (os.tier ?? 1) >= 2 ? s.mmu : null;
  const all = vm ? vm.hits + vm.misses : 0;
  const ipcText = (last === null ? 'IPC --' : `IPC ${last.toFixed(2)}`) + (vm ? `   TLB HIT ${all ? Math.round((100 * vm.hits) / all) : 100}%   FAULTS ${vm.faults}` : '');

  const n = s.net;
  const net = n ? (n.state === 'link-up' || n.state === 'saturated'
    ? `NET ${n.state === 'saturated' ? 'SATURATED' : 'UP'}  ${n.bandwidth.downMbps.toFixed(0)}/${n.bandwidth.upMbps.toFixed(0)} Mbps  ${n.transfers.length} XFER`
    : `NET ${n.state.toUpperCase().replace('-', ' ')}`) : 'NET --';

  // the process table: running programs first, then the queue in order; the memory column is the image plus what the program claimed
  const order = [...q.filter((j) => j.state === 'running'), ...q.filter((j) => j.state === 'queued').sort((a, b) => a.ahead - b.ahead), ...q.filter((j) => j.state === 'result')];
  const alone = order.filter((j) => j.state === 'running').length === 1; // a single-program OS does not tag its regions with the key
  const rows: DashProc[] = order.map((j) => {
    const p = mt?.procs.find((x) => x.owner === j.keyId) ?? (alone && j.state === 'running' ? mt?.procs[0] : undefined);
    const t0 = ctx.started.get(j.keyId);
    return {
      pid: String(j.keyId),
      name: j.label,
      state: j.state === 'running' ? 'RUN' : j.state === 'result' ? 'DONE' : j.ahead <= 0 ? 'NEXT' : `+${j.ahead}`,
      mem: p ? `${sizeText(p.image)}+${sizeText(p.claimed)}` : '',
      time: j.state === 'running' && t0 !== undefined ? clock(Math.max(0, s.baseTick - t0)) : '',
      tone: j.state === 'running' ? 'run' : j.state === 'result' ? 'done' : 'wait',
    };
  });
  const SHOWN = ctx.compact ? 3 : 8;

  const ready = q.filter((j) => j.state === 'result');
  let prompt = '', promptTone: DashModel['promptTone'] = 'dim';
  if (ph === 'ingesting') prompt = `INGESTING KEY ${s.plugged?.label ?? ''}`;
  else if (ph === 'flashing') { prompt = `WRITING RESULT ${s.plugged?.label ?? ''}`; promptTone = 'warn'; }
  else if (s.keyActivity === 'done' && s.plugged) { prompt = `REMOVE KEY ${s.plugged.label}`; promptTone = 'ok'; }
  else if (ready.length) { prompt = `PLUG KEY ${ready[0]!.label} TO COLLECT${ready.length > 1 ? ` (+${ready.length - 1})` : ''}`; promptTone = 'warn'; }
  else if (!order.length) prompt = 'IDLE  insert a key';

  return { title: `${(os.name ?? 'OS').toUpperCase().slice(0, 28)} T${os.tier ?? 1}`, status, sub, bars, mem, ipc: ctx.ipc, ipcText, net, procs: rows.slice(0, SHOWN), more: Math.max(0, rows.length - SHOWN), prompt, promptTone };
}

/** A stable text of everything the view draws, so it repaints only when this changes. */
export const dashSig = (m: DashModel): string => JSON.stringify(m);

// ---------------------------------------------------------------- the GPU's frame (the graphics display with its cable on a card)

/** Width of the picture in cells: the mandelbrot kernel's row (`MANDEL.logW`); the other kernels' arrays read as bars of the same width. */
export const FRAME_COLS = 32;
/** How many base ticks the frame stays up after the card's last launch before the normal screen comes back. */
export const FRAME_HOLD = 8;

export interface FrameModel {
  cols: number;
  rows: number;
  /** One value per cell, 0..1 over the frame's own range (row by row). */
  cells: number[];
  /** The strip under the picture. */
  status: string;
  /** Launches so far: the frame number. */
  seq: number;
}

/**
 * The card's output region as a picture: the used part (up to the last non-zero word, rounded up to whole rows of `FRAME_COLS`), each word scaled to 0..1 between
 * the smallest and largest of them (signed, as the kernels' integers are). Null before the card's first launch.
 */
export function frameModel(g: GpuSnap | undefined): FrameModel | null {
  if (!g || !g.frame.length) return null;
  let last = -1;
  for (let i = g.frame.length - 1; i >= 0; i--) if (g.frame[i] !== 0) { last = i; break; }
  const rows = Math.max(1, Math.ceil((last + 1) / FRAME_COLS));
  const w = g.frame.slice(0, rows * FRAME_COLS).map((v) => v | 0);
  const lo = Math.min(...w), hi = Math.max(...w), span = hi - lo || 1;
  const slots = g.stats.instructions * g.lanes;
  const busy = slots > 0 ? Math.round((100 * (slots - g.stats.idleLaneSlots)) / slots) : 0;
  const state = g.error ? 'FAULT' : g.phase === 'idle' ? 'DONE' : 'DRAWING';
  return {
    cols: FRAME_COLS, rows, cells: w.map((v) => (v - lo) / span), seq: g.launches,
    status: `FRAME ${g.launches}  ${state}  ${g.stats.cycles} CYC  ${g.lanes} LANES ${busy}% BUSY  ${g.stats.conflictCycles} CONFLICTS`,
  };
}

const RAMP = [[6, 4, 24], [38, 12, 110], [120, 20, 160], [220, 40, 120], [255, 130, 40], [255, 225, 90], [255, 255, 235]] as const;
/** The picture's colour for a cell value 0..1: deep indigo up through violet and magenta to orange, yellow and white-hot (a heat-map, so low and high read apart). */
export function frameColor(t: number): string {
  const x = clamp01(t) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  const c = RAMP[i]!.map((a, k) => Math.round(a + (RAMP[i + 1]![k]! - a) * f));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** What the screen remembers of a card to decide how long its frame stays up: the launch count it last saw and the tick it last saw the card busy or launched. */
export interface FrameHold { seq: number; at: number }

/** Advance the hold with this snapshot's card: the frame is up while the card works and `FRAME_HOLD` ticks after its latest launch. */
export function holdFrame(h: FrameHold, g: GpuSnap | undefined, tick: number): { hold: FrameHold; show: boolean } {
  if (!g || g.launches === 0) return { hold: { seq: g?.launches ?? 0, at: -Infinity }, show: false };
  const hold = g.launches !== h.seq || g.phase !== 'idle' ? { seq: g.launches, at: tick } : h;
  return { hold, show: tick - hold.at <= FRAME_HOLD };
}
