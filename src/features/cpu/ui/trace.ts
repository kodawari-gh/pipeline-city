// The event trace (the "Trace" panel): what the engine logged, one line per event, decoded for people. Pure: events in (the flat [cycle, kind, a, b, c, d]
// groups of a snapshot's stored state), lines out, so the panel only keeps and shows them.

import { Ev, Which } from '../sim/engines/common';
import type { GpuStep } from '../../gpu/sim/ref';
import { RowOutcome } from '../../memory/sim/dram';
import { FAULT_CAUSE_LINE, IRQ, VmFault } from '@/core/sim/memmap';

export type TraceGroup = 'os' | 'tlb' | 'mem' | 'dram' | 'cache' | 'reg' | 'pred';

export interface TraceLine { cycle: number; group: TraceGroup; text: string }

const REG = ['zero', 'ra', 'sp', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 's0', 's1', 's2', 's3'];
const hex = (n: number, w = 4) => '0x' + (n >>> 0).toString(16).padStart(w, '0');
const CACHE = ['D$', 'I$', 'L2'];
const IRQ_NAME: Record<number, string> = { [IRQ.TIMER]: 'timer', [IRQ.NIC]: 'nic', [IRQ.DISK]: 'disk', [IRQ.USB]: 'usb', [FAULT_CAUSE_LINE]: 'page fault' };
const FAULT_NAME: Record<number, string> = { [VmFault.NotPresent]: 'no page', [VmFault.Write]: 'write to read-only', [VmFault.Exec]: 'no execute', [VmFault.Range]: 'out of range' };
const ROW = { [RowOutcome.Hit]: 'row hit', [RowOutcome.Empty]: 'row opened', [RowOutcome.Conflict]: 'row conflict', [RowOutcome.Refresh]: 'refresh' } as Record<number, string>;

/** One event as a line, or null for a kind this panel does not know. */
export function decodeEvent(cycle: number, kind: number, a: number, b: number, c: number, d: number): TraceLine | null {
  switch (kind) {
    case Ev.Irq: return { cycle, group: 'os', text: `interrupt ${IRQ_NAME[a] ?? 'line ' + a}: return address ${hex(b)}, handler ${hex(c)}` };
    case Ev.Iret: return { cycle, group: 'os', text: `iret: back to ${hex(a)}` };
    case Ev.Space: return { cycle, group: 'os', text: `new address space: page table at ${hex(a)} (TLB emptied)` };
    case Ev.Tlb:
      if (a === 2) return { cycle, group: 'tlb', text: `page fault at ${hex(c * 256)}: ${FAULT_NAME[d] ?? 'cause ' + d}` };
      return { cycle, group: 'tlb', text: a === 0 ? `TLB hit: page ${hex(c * 256)} -> frame ${hex(d * 256)} (entry ${b})` : `TLB miss: walked the table, entry ${b} now maps ${hex(c * 256)} -> ${hex(d * 256)}` };
    case Ev.Mem: return { cycle, group: 'mem', text: a === 0 ? `load ${hex(b)} = ${hex(c)}` : `store ${hex(b)} <- ${hex(c)}` };
    case Ev.Row: return { cycle, group: 'dram', text: `DRAM bank ${a}, row ${b}: ${ROW[d] ?? 'access'}${d === RowOutcome.Conflict ? ` (row ${c} was open)` : ''}` };
    case Ev.Hit: return { cycle, group: 'cache', text: `${CACHE[a] ?? '?'} hit: slot ${b}, line ${hex(c * 16, 4)}` };
    case Ev.Fill: return { cycle, group: 'cache', text: `${CACHE[a] ?? '?'} fill: slot ${b} takes line ${hex(c * 16, 4)}${d >= 0 ? ` (evicts ${hex(d * 16, 4)})` : ''}` };
    case Ev.Reg: return { cycle, group: 'reg', text: `${REG[a] ?? 'x' + a} <- ${hex(b, 1)}` };
    case Ev.Pred: return { cycle, group: 'pred', text: `predictor ${a}: counter ${c} -> ${b}` };
  }
  return null;
}

/** Decode a snapshot's flat event list. */
export function decodeEvents(flat: readonly number[]): TraceLine[] {
  const out: TraceLine[] = [];
  for (let k = 0; k + 5 < flat.length; k += 6) {
    const l = decodeEvent(flat[k]!, flat[k + 1]!, flat[k + 2]!, flat[k + 3]!, flat[k + 4]!, flat[k + 5]!);
    if (l) out.push(l);
  }
  return out;
}

/**
 * A rolling trace: `add` takes a snapshot's events (windows overlap, so ones already seen are skipped) and keeps the newest `cap` lines.
 * A restart (the cycle counter going back) clears it.
 */
export class TraceBuffer {
  lines: TraceLine[] = [];
  private seen = new Set<string>();
  private keys: string[] = [];
  private last = -1;
  constructor(private readonly cap = 400) {}

  add(flat: readonly number[]): boolean {
    let added = false;
    const first = flat.length >= 6 ? flat[0]! : -1;
    if (first >= 0 && this.last >= 0 && first + 1000 < this.last) this.clear();
    for (let k = 0; k + 5 < flat.length; k += 6) {
      const key = flat.slice(k, k + 6).join(',') + '#' + (k % 6);
      if (this.seen.has(key)) continue;
      const l = decodeEvent(flat[k]!, flat[k + 1]!, flat[k + 2]!, flat[k + 3]!, flat[k + 4]!, flat[k + 5]!);
      if (!l) continue;
      this.seen.add(key);
      this.keys.push(key);
      this.lines.push(l);
      this.last = Math.max(this.last, l.cycle);
      added = true;
    }
    if (this.lines.length > this.cap) {
      const n = this.lines.length - this.cap;
      this.lines.splice(0, n);
      for (const k of this.keys.splice(0, n)) this.seen.delete(k);
    }
    return added;
  }

  clear(): void { this.lines = []; this.keys = []; this.seen.clear(); this.last = -1; }
}

// A graphics card's side of the panel: its last instructions (the snapshot's `trace`, at most 64) as lines, in the groups the card has.

export type GpuGroup = 'launch' | 'mask' | 'mem' | 'reg' | 'sched';

/** `cycle` counts from the first instruction of the window: the cycle the card view's scrubber takes. */
export interface GpuLine { cycle: number; group: GpuGroup; text: string }

const GROUP_OF: Record<GpuStep['kind'], GpuGroup> = { sys: 'launch', mask: 'mask', br: 'mask', ld: 'mem', st: 'mem', alu: 'reg' };
const STALL_TEXT = { bank: 'bank conflict', mem: 'waiting for memory', barrier: 'waiting at the barrier' } as const;
const lanesOn = (m: number) => { let n = 0; for (let v = m >>> 0; v; v &= v - 1) n++; return n; };

/** The window's instructions as lines: one per instruction, plus a scheduling line when the warp or SM changes or the instruction stalls. */
export function gpuLines(trace: readonly GpuStep[], launches = 0): GpuLine[] {
  const out: GpuLine[] = [];
  if (trace.length === 0) return out;
  const timed = trace.every((s) => s.startCycle !== undefined), base = timed ? trace[0]!.startCycle! : 0;
  let at = 0, prev: GpuStep | null = null;
  out.push({ cycle: 0, group: 'launch', text: `launch ${launches}: kernel at ${hex(trace[0]!.pc)}` });
  for (const s of trace) {
    const cycle = timed ? Math.max(0, s.startCycle! - base) : at;
    const where = s.sm !== undefined || s.warp !== undefined ? `SM ${s.sm ?? 0} warp ${s.warp ?? 0}: ` : '';
    const mask = s.maskAfter !== undefined && s.maskAfter !== s.mask ? `, mask ${hex(s.mask, 2)} -> ${hex(s.maskAfter, 2)}` : `, ${lanesOn(s.mask)} lanes`;
    if (prev && (prev.sm !== s.sm || prev.warp !== s.warp)) out.push({ cycle, group: 'sched', text: `scheduler issues ${where.slice(0, -2)}` });
    const addr = s.banks ? ` (${s.banks.filter((b) => b > 0).length} banks, busiest ${Math.max(...s.banks)})` : '';
    out.push({ cycle, group: GROUP_OF[s.kind], text: `${where}${hex(s.pc)} ${s.name}${s.dest !== null ? ` -> v${s.dest}` : ''}${mask}${addr}${s.cost > 1 ? `, ${s.cost} cycles` : ''}` });
    if (s.stall) out.push({ cycle, group: 'sched', text: `${where}stalled: ${STALL_TEXT[s.stall]} (${s.cost} cycles)` });
    at += Math.max(1, s.cost);
    prev = s;
  }
  return out;
}
