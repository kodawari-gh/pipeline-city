// The die's outer layer alive (docs/DIE.md "Uncore"): the parts around the cores (memory controller, shared L2 and its coherence, system bus, PCIe / NVMe / DMI,
// USB, display, power phases, thermal sensor, clock) show what they are doing, from the accesses the cores make and the machine's own readings. Pure state plus
// one painter per block; `dieview.ts` owns an `UncoreFx` and paints it over the art each frame.

import type { Graphics } from 'pixi.js';
import type { Snapshot } from '../../sim/protocol';
import { box, mix } from '../ink';
import type { Theme } from '../theme';
import { cellRects, type PlanBlock } from './dieart';

/** Where an access of a core goes once it leaves the cores: `l2` the shared cache, `mc` the DIMM bus, `pcie` a card, `nvme` a drive, `dmi` the chipset (and what hangs off it), `usb`, `display`. */
export type UncoreUnit = 'l2' | 'mc' | 'pcie' | 'nvme' | 'dmi' | 'usb' | 'display';

/** The machine's readings the painters need, from one snapshot. */
export interface UncoreInput {
  /** Power drawn and its budget, whether the machine is off, whether the breaker tripped. */
  loadW: number; budgetW: number; off: boolean; tripped: boolean;
  /** The CPU's temperature, whether it throttles. */
  tempC: number; throttle: boolean;
  /** The CPU's clock against its top clock (null: fixed). */
  clock: number; clockMax: number;
  /** The cores' cumulative counters: lines another core's store dropped, and cycles waited for the shared L2 port. */
  coherence: number; l2Wait: number;
}

export function uncoreInput(s: Snapshot | null): UncoreInput | null {
  if (!s) return null;
  const cpu = s.devices.find((d) => d.kind === 'cpu');
  const st = s.cores?.stats ?? [];
  return {
    loadW: s.power.totalW, budgetW: Math.max(1, s.power.budgetW), off: s.power.off, tripped: s.power.tripped,
    tempC: cpu?.tempC ?? 25, throttle: (cpu?.throttle ?? 0) > 0,
    clock: s.cpuClock?.value ?? 1, clockMax: s.cpuClock?.max ?? 1,
    coherence: st.reduce((n, c) => n + c.coherence, 0), l2Wait: st.reduce((n, c) => n + c.l2Wait, 0),
  };
}

interface Hit { t: number; write: boolean; seed: number }
/** How long a hit stays on the picture (ms). */
const LIFE: Record<UncoreUnit, number> = { l2: 900, mc: 700, pcie: 900, nvme: 1100, dmi: 900, usb: 1200, display: 1500 };
const MAX_HITS = 24;

/** The share of a hit left (1 at the instant, 0 when it is gone). */
export const fresh = (h: Hit, unit: UncoreUnit, now: number): number => Math.max(0, 1 - (now - h.t) / LIFE[unit]);

export class UncoreFx {
  private hits = new Map<UncoreUnit, Hit[]>();
  private input: UncoreInput | null = null;
  private coh = -1;
  private cohAt = -1e9;
  private wait = -1;
  private waitAt = -1e9;
  /** The die's own clock of this layer: the last time painted. */
  private lastNow = 0;

  clear(): void { this.hits.clear(); this.input = null; this.coh = -1; this.wait = -1; this.cohAt = this.waitAt = -1e9; }

  /** A core's access reached `unit` (game ms `now`); `addr` picks the line or lane it lands on. */
  touch(unit: UncoreUnit, write: boolean, now: number, addr = 0): void {
    const l = this.hits.get(unit) ?? [];
    l.push({ t: now, write, seed: addr >>> 0 });
    if (l.length > MAX_HITS) l.shift();
    this.hits.set(unit, l);
  }

  set(input: UncoreInput | null, now: number): void {
    this.input = input;
    if (!input) return;
    if (this.coh >= 0 && input.coherence > this.coh) this.cohAt = now;
    if (this.wait >= 0 && input.l2Wait > this.wait) this.waitAt = now;
    this.coh = input.coherence; this.wait = input.l2Wait;
  }

  /** How busy `unit` is, 0..1: the sum of what its recent hits have left. */
  activity(unit: UncoreUnit, now: number): number {
    let a = 0;
    for (const h of this.hits.get(unit) ?? []) a += fresh(h, unit, now);
    return Math.min(1, a / 3);
  }

  private live(unit: UncoreUnit, now: number): Hit[] {
    const l = this.hits.get(unit);
    if (!l) return [];
    while (l.length && fresh(l[0]!, unit, now) <= 0) l.shift();
    return l;
  }

  /** Paint every outer block of the plan that is in `blocks`. Returns whether anything is still moving (the caller may skip frames when not). */
  draw(g: Graphics, blocks: readonly PlanBlock[], T: Theme, now: number): void {
    this.lastNow = now;
    const inp = this.input, off = inp?.off ?? false;
    for (const b of blocks) {
      switch (b.kind) {
        case 'power': this.power(g, b, T, now, inp); break;
        case 'thermal': this.thermal(g, b, T, now, inp); break;
        case 'clock': this.clock(g, b, T, now, inp); break;
        case 'mc': this.mc(g, b, T, now); break;
        case 'l2': this.l2(g, b, T, now); break;
        case 'pcie': this.pcie(g, b, T, now); break;
        case 'usb': this.usb(g, b, T, now); break;
        case 'display': this.display(g, b, T, now, off); break;
        case 'fabric': this.fabric(g, b, T, now); break;
        case 'timer': this.timer(g, b, T, now, off); break;
        default: break;
      }
    }
  }

  /** The VRM phases: each stub lights with the load, the phases taking turns (a rotating shimmer), red on a trip, dark when the machine is off. */
  private power(g: Graphics, b: PlanBlock, T: Theme, now: number, inp: UncoreInput | null): void {
    if (!inp || inp.off) return;
    const cells = cellRects(b), n = cells.length, load = Math.min(1.2, inp.loadW / inp.budgetW);
    cells.forEach((c, i) => {
      const turn = 0.5 + 0.5 * Math.sin(now * 0.006 - (i * Math.PI * 2) / Math.max(1, n));
      if (inp.tripped) { box(g, c.x, c.y, c.w, c.h, 2, { fill: T.bad, fa: 0.35 + 0.35 * (Math.floor(now / 250) % 2) }); return; }
      box(g, c.x, c.y, c.w, c.h, 2, { fill: load > 1 ? T.bad : T.ld, fa: Math.min(0.85, load * (0.25 + 0.6 * turn)) });
    });
  }

  /** The thermal sensor: a bar that fills and shifts from cool to hot with the CPU's temperature, a red pulse on the frame while it throttles. */
  private thermal(g: Graphics, b: PlanBlock, T: Theme, now: number, inp: UncoreInput | null): void {
    if (!inp || inp.off) return;
    const r = b.rect, w = r.w - 20, h = Math.max(4, Math.min(8, r.h * 0.12)), x = r.x + 10, y = r.y + r.h - h - 8;
    const f = Math.max(0, Math.min(1, (inp.tempC - 25) / 70));
    box(g, x, y, w, h, h / 2, { fill: T.line, fa: 0.4 });
    const hot = f < 0.5 ? mix(T.alu, T.ld, f * 2) : mix(T.ld, T.bad, (f - 0.5) * 2);
    box(g, x, y, Math.max(h, w * f), h, h / 2, { fill: hot, fa: 0.95 });
    if (inp.throttle) box(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 4, { stroke: T.bad, lw: 2, sa: 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(now * 0.012)) });
  }

  /** The PLL: a ring with a dot that runs round at a pace that follows the clock. */
  private clock(g: Graphics, b: PlanBlock, T: Theme, now: number, inp: UncoreInput | null): void {
    if (!inp || inp.off) return;
    const r = b.rect, rad = Math.min(r.h * 0.22, r.w * 0.18), cx = r.x + r.w - rad - 14, cy = r.y + r.h - rad - 12;
    g.circle(cx, cy, rad).stroke({ width: 2, color: T.line, alpha: 0.7 });
    const turns = 0.0006 * (inp.clockMax > 0 ? inp.clock / inp.clockMax : 1), a = now * turns * Math.PI * 2;
    g.circle(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, Math.max(2.5, rad * 0.22)).fill({ color: T.alu, alpha: 0.95 });
    g.circle(cx, cy, 2).fill({ color: T.alu, alpha: 0.6 });
  }

  /** The memory controller: a lane (of the six) takes each access, a bright head runs along it out to the DIMM bus, cyan for a read, pink for a write. */
  private mc(g: Graphics, b: PlanBlock, T: Theme, now: number): void {
    const cells = cellRects(b);
    if (cells.length === 0) return;
    const busy = this.activity('mc', now);
    for (const h of this.live('mc', now)) {
      const c = cells[(h.seed >>> 4) % cells.length]!, f = fresh(h, 'mc', now), run = 1 - f;
      const col = h.write ? T.br : T.alu, len = c.w * 0.35, x = c.x + (c.w - len) * run;
      box(g, c.x, c.y, c.w, c.h, 2, { fill: col, fa: 0.12 * f });
      box(g, x, c.y, len, c.h, 2, { fill: col, fa: 0.9 * f });
    }
    if (busy > 0.05) box(g, b.rect.x + 2, b.rect.y + b.rect.h - 6, (b.rect.w - 4) * busy, 3, 1.5, { fill: T.ld, fa: 0.8 });
  }

  /** The shared L2: the line an access lands on flashes; a coherence miss (another core's store dropped a line) sweeps a red bar across the cells, a wait on the port tints the frame. */
  private l2(g: Graphics, b: PlanBlock, T: Theme, now: number): void {
    const cells = cellRects(b);
    if (cells.length > 0) {
      for (const h of this.live('l2', now)) {
        const c = cells[(h.seed >>> 5) % cells.length]!, f = fresh(h, 'l2', now);
        box(g, c.x, c.y, c.w, c.h, 1.5, { fill: h.write ? T.br : T.ld, fa: 0.85 * f });
      }
    }
    const co = Math.max(0, 1 - (now - this.cohAt) / 900);
    if (co > 0) {
      const r = b.rect, y = r.y + 30 + (r.h - 40) * (1 - co);
      box(g, r.x + 4, y, r.w - 8, Math.max(3, r.h * 0.015), 2, { fill: T.bad, fa: 0.85 * co });
      box(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 4, { stroke: T.bad, lw: 2, sa: 0.5 * co });
    }
    const wa = Math.max(0, 1 - (now - this.waitAt) / 500);
    if (wa > 0) box(g, b.rect.x + 1, b.rect.y + 1, b.rect.w - 2, b.rect.h - 2, 4, { stroke: T.ld, lw: 2, sa: 0.5 * wa });
  }

  /** PCIe / NVMe / DMI: 12 + 3 + 6 lanes; an access lights two or three lanes of its own group and a head runs along them. */
  private pcie(g: Graphics, b: PlanBlock, T: Theme, now: number): void {
    const cells = cellRects(b);
    if (cells.length === 0) return;
    const groups: Record<'pcie' | 'nvme' | 'dmi', [number, number]> = { pcie: [0, Math.min(12, cells.length)], nvme: [Math.min(12, cells.length), Math.min(15, cells.length)], dmi: [Math.min(15, cells.length), cells.length] };
    for (const unit of ['pcie', 'nvme', 'dmi'] as const) {
      const [lo, hi] = groups[unit], span = hi - lo;
      if (span <= 0) continue;
      for (const h of this.live(unit, now)) {
        const f = fresh(h, unit, now), n = Math.min(span, 2 + (h.seed % 2));
        for (let k = 0; k < n; k++) {
          const c = cells[lo + ((h.seed >>> 3) + k * 5) % span]!, run = 1 - f, hgt = c.h * 0.45;
          const col = h.write ? T.br : T.alu;
          box(g, c.x, c.y, c.w, c.h, 1.5, { fill: col, fa: 0.25 * f });
          box(g, c.x, c.y + (c.h - hgt) * (h.write ? run : 1 - run), c.w, hgt, 1.5, { fill: col, fa: 0.95 * f });
        }
      }
    }
  }

  /** USB: the lane an access picks blinks green. */
  private usb(g: Graphics, b: PlanBlock, T: Theme, now: number): void {
    const cells = cellRects(b);
    for (const h of this.live('usb', now)) {
      const c = cells[h.seed % Math.max(1, cells.length)];
      if (c) box(g, c.x, c.y, c.w, c.h, 2, { fill: T.st, fa: 0.8 * fresh(h, 'usb', now) });
    }
  }

  /** The display: while the CPU writes the screen the two video pairs light in turn and a scan line sweeps the block; off, nothing. */
  private display(g: Graphics, b: PlanBlock, T: Theme, now: number, off: boolean): void {
    if (off) return;
    const a = this.activity('display', now);
    if (a <= 0.02) return;
    const cells = cellRects(b), r = b.rect;
    cells.forEach((c, i) => { if (Math.floor(now / 140) % Math.max(1, cells.length) === i) box(g, c.x, c.y, c.w, c.h, 2, { fill: T.mul, fa: 0.55 * a }); });
    const y = r.y + 20 + ((now * 0.12) % Math.max(1, r.h - 26));
    box(g, r.x + 4, y, r.w - 8, 2, 1, { fill: T.ink, fa: 0.6 * a });
  }

  /** The system bus: a glow along it with the traffic to every unit, and marching ticks while it is busy. */
  private fabric(g: Graphics, b: PlanBlock, T: Theme, now: number): void {
    const a = Math.max(this.activity('mc', now), this.activity('pcie', now), this.activity('nvme', now), this.activity('dmi', now), this.activity('usb', now), this.activity('display', now));
    if (a <= 0.03) return;
    const r = b.rect, y = r.y + r.h - 8, step = 14;
    box(g, r.x + 4, y - 1, r.w - 8, 4, 2, { fill: T.ld, fa: 0.25 * a });
    for (let x = r.x + 6 + ((now * 0.08) % step); x < r.x + r.w - 6; x += step) g.rect(x, y, 5, 2).fill({ color: T.ld, alpha: 0.8 * a });
  }

  /** The timer: a sweep bar that fills and restarts, the counter running. */
  private timer(g: Graphics, b: PlanBlock, T: Theme, now: number, off: boolean): void {
    if (off) return;
    const r = b.rect, f = (now % 2400) / 2400;
    box(g, r.x + 8, r.y + r.h - 12, r.w - 16, 4, 2, { fill: T.line, fa: 0.4 });
    box(g, r.x + 8, r.y + r.h - 12, Math.max(4, (r.w - 16) * f), 4, 2, { fill: T.alu, fa: 0.85 });
  }
}
