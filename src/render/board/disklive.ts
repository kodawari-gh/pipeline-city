import type { Graphics } from 'pixi.js';
import type { StorageSnap } from '../../sim/game/types';
import { cellRects } from '../die/dieart';
import { drawPackets, drawTrails, packetOn, type Packet, type Trail } from '../die/diepulse';
import type { Theme } from '../theme';
import { accentOf } from './diskart';
import type { DiskPlan } from './diskfloor';
import { queueLanes } from './diskplan';
import type { DriveKind } from './drives';

// The motion of a drive's cutaway, drawn every frame over the cells (diskart.ts draws what changes only with the data). The drive is never still: a hard disk
// spins, with light gliding over the platter and a read window under the head; a flash drive breathes (a refresh sweep crosses each die, the controller and
// its cache tick over). When bytes move, it works: the dies on the command program or read one cell after another, packets run host to die (a write) or die
// to host (a read) over the channels, the controller and the queue pulse in step. The numbers are placeholders; all of it is look, none of it is simulation.

const TAU = Math.PI * 2;
/** Seconds the activity takes to rise to a command and to settle after it. */
const RISE = 0.08, FALL = 0.8;
/** Packets: gap between two (ms) at rest-in-work and at full load, and the time one takes along a link. */
const GAP_SLOW = 360, GAP_FAST = 110, TRAVEL = 340;
const hash = (n: number): number => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export class DiskMotion {
  /** 0..1: how hard the drive works now (rises on a command or bytes moved, falls slowly). */
  act = 0;
  /** +1 the last bytes were a write (host to media), -1 a read. */
  dir: 1 | -1 = 1;
  private target = 0;
  private spin = 0;
  private cursor = 0;
  private lastR = -1;
  private lastW = -1;
  private t = 0;
  private next = 0;
  private packets: Packet[] = [];
  private trails = new Map<string, Trail>();
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Reads a new snapshot: a drive is working when a command runs or its byte counters moved since the last one. */
  note(s: StorageSnap): void {
    const first = this.lastR < 0, dr = s.bytesRead - this.lastR, dw = s.bytesWritten - this.lastW;
    this.lastR = s.bytesRead;
    this.lastW = s.bytesWritten;
    const moved = !first && (dr > 0 || dw > 0);
    if (moved) this.dir = dw >= dr ? 1 : -1;
    this.target = s.busy || moved ? 1 : 0;
  }

  /** Advances the clocks by `dt` seconds. */
  step(dt: number): void {
    this.t += dt;
    this.act += (this.target - this.act) * Math.min(1, dt / (this.target > this.act ? RISE : FALL));
    if (this.act < 0.002) this.act = 0;
    this.cursor += dt * (9 + 34 * this.act);
    this.spin += dt * (1.1 + 5.5 * this.act);
  }

  /** Draws the motion into `g` (cleared first) and the packets into `pg`/`tg`. `track` is the eased head track. */
  draw(g: Graphics, tg: Graphics, pg: Graphics, T: Theme, kind: DriveKind, plan: DiskPlan, s: StorageSnap, track: number): void {
    g.clear();
    tg.clear();
    pg.clear();
    if (s.burnt) { this.packets = []; this.trails.clear(); return; }
    if (plan.platter && plan.arm) this.hdd(g, T, kind, plan, track);
    else this.flash(g, T, kind, plan, s);
    this.flow(T, kind, plan, s);
    drawTrails(tg, this.trails, this.t * 1000, 1);
    this.packets = drawPackets(pg, this.packets, this.t * 1000, 1, T.ink);
  }

  /** The platter: it turns, light glides over it, the rim ticks go round, and a read window glows under the head and smears with the spin. */
  private hdd(g: Graphics, T: Theme, kind: DriveKind, plan: DiskPlan, track: number): void {
    const p = plan.platter!, a = plan.arm!, act = this.act, accent = accentOf(T, kind);
    const spin = this.spin;
    // light glides over the surface: three wide wedges
    for (let k = 0; k < 3; k++) {
      const a0 = spin * 0.9 + (k * TAU) / 3, w = 0.55, pts: number[] = [p.cx, p.cy];
      for (let j = 0; j <= 8; j++) pts.push(p.cx + Math.cos(a0 + (w * j) / 8) * p.R, p.cy + Math.sin(a0 + (w * j) / 8) * p.R);
      g.poly(pts).fill({ color: '#ffffff', alpha: 0.05 });
    }
    // the rim: ticks go round with the platter
    for (let k = 0; k < 36; k++) {
      const an = spin + (k * TAU) / 36, major = k % 6 === 0, r0 = p.R * 1.01, r1 = p.R * (major ? 1.075 : 1.045);
      g.moveTo(p.cx + Math.cos(an) * r0, p.cy + Math.sin(an) * r0).lineTo(p.cx + Math.cos(an) * r1, p.cy + Math.sin(an) * r1);
    }
    g.stroke({ width: Math.max(1, plan.h * 0.005), color: accent, alpha: 0.55 });
    // the hub's mark
    g.moveTo(p.cx, p.cy).lineTo(p.cx + Math.cos(spin * 1.0) * p.hub * 0.9, p.cy + Math.sin(spin * 1.0) * p.hub * 0.9).stroke({ width: Math.max(1.5, plan.h * 0.01), color: T.ink, alpha: 0.9, cap: 'round' });
    // the read window under the head
    const ring = (p.R * 0.86) / p.tracks, ang = Math.atan2(a.py - p.cy, a.px - p.cx), r = p.R * 0.97 - track * ring - ring * 0.45;
    const color = this.dir > 0 ? T.ld : T.st, half = 0.1 + 0.05 * act;
    for (let k = 0; k < 7; k++) {
      // sectors pass under the head against the spin: seven short arcs, the nearest the brightest
      const behind = k * 0.11 + ((spin * 0.5) % 0.11), al = (1 - k / 7) * (0.12 + 0.75 * act);
      const a0 = ang - TAU * 0 + behind - half, a1 = a0 + 0.07;
      g.moveTo(p.cx + Math.cos(a0) * r, p.cy + Math.sin(a0) * r);
      for (let j = 1; j <= 3; j++) g.lineTo(p.cx + Math.cos(a0 + ((a1 - a0) * j) / 3) * r, p.cy + Math.sin(a0 + ((a1 - a0) * j) / 3) * r);
      g.stroke({ width: ring * 0.8, color, alpha: al, cap: 'round' });
    }
    const ex = p.cx + Math.cos(ang) * r, ey = p.cy + Math.sin(ang) * r;
    g.circle(ex, ey, plan.h * (0.025 + 0.02 * act)).fill({ color, alpha: 0.18 + 0.4 * act });
  }

  /** The flash drive: a refresh sweep on every die, the active dies programming or reading cell after cell, the controller and the queue pulsing. */
  private flash(g: Graphics, T: Theme, kind: DriveKind, plan: DiskPlan, s: StorageSnap): void {
    const act = this.act, t = this.t, color = this.dir > 0 ? T.ld : T.st, dies = plan.dies;
    const head = Math.floor(s.headLba / 8);
    const first = Math.max(0, dies.findIndex((d) => head >= d.slice.first && head < d.slice.first + d.slice.count));
    const working = new Set<number>();
    if (act > 0.05) for (let k = 0; k <= Math.min(dies.length - 1, s.queued + (kind === 'ssd-nvme' ? 1 : 0)); k++) working.add((first + k) % dies.length);
    dies.forEach((d, i) => {
      const b = plan.blocks.find((x) => x.id === d.block)!, rects = cellRects(b), n = d.slice.count, cols = d.slice.cols;
      // the refresh sweep: a soft column of light crossing the die, each die on its own phase
      const sweep = ((t * 0.32 + i * 0.29 + this.seed * 0.13) % 1.5) - 0.25;
      for (let k = 0; k < n; k++) {
        const r = rects[k];
        if (!r) continue;
        const dc = Math.abs((k % cols) / Math.max(1, cols - 1) - sweep);
        if (dc < 0.2) g.roundRect(r.x, r.y, r.w, r.h, 1.5).fill({ color: T.ink, alpha: ((0.2 - dc) / 0.2) * 0.2 });
      }
      if (working.has(i)) {
        // a cursor walks the die's cells; the cells behind it glow and cool
        const cur = Math.floor(this.cursor * (1 + (working.size > 1 ? i % 2 * 0.25 : 0))) % Math.max(1, n);
        for (let j = 0; j < 7; j++) {
          const r = rects[(cur - j + n * 8) % n];
          if (r) g.roundRect(r.x, r.y, r.w, r.h, 1.5).fill({ color, alpha: (1 - j / 7) * (0.35 + 0.6 * act) });
        }
        const pulse = 0.5 + 0.5 * Math.sin(t * 9 + i);
        g.roundRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3).stroke({ width: Math.max(1.5, plan.h * 0.007), color, alpha: (0.25 + 0.5 * pulse) * act });
      }
    });
    // the controller: a glow and its table lookups (little bars that jump with the work)
    const ctrl = plan.blocks.find((b) => b.kind === 'ctrl');
    if (ctrl) {
      const r = ctrl.rect, pulse = 0.5 + 0.5 * Math.sin(t * 7);
      g.roundRect(r.x, r.y, r.w, r.h, 3).fill({ color: T.br, alpha: 0.04 + (0.06 + 0.2 * pulse) * act });
      const bars = 8, bw = (r.w * 0.8) / bars, by = r.y + r.h * 0.9;
      for (let k = 0; k < bars; k++) {
        const v = act > 0.02 ? hash(Math.floor(t * 14) + k * 3 + this.seed) * act : 0.12 + 0.1 * Math.sin(t * 1.6 + k);
        g.rect(r.x + r.w * 0.1 + k * bw, by - r.h * 0.3 * v, bw * 0.7, r.h * 0.3 * v).fill({ color: T.br, alpha: 0.6 });
      }
    }
    // the DRAM cache: its cells refresh in a running line and flicker with lookups
    const cache = plan.blocks.find((b) => b.kind === 'cache');
    if (cache) {
      const r = cache.rect, n = 10, cw = (r.w * 0.9) / n;
      for (let k = 0; k < n; k++) {
        const run = Math.max(0, 1 - Math.abs(((t * 3 + this.seed) % (n + 3)) - k) / 2) * 0.4, fl = act > 0.02 ? hash(Math.floor(t * 18) + k * 7) * 0.7 * act : 0;
        g.rect(r.x + r.w * 0.05 + k * cw, r.y + r.h * 0.62, cw * 0.78, r.h * 0.26).fill({ color: T.ld, alpha: 0.1 + run + fl });
      }
    }
    // the queue: waiting requests breathe, and a fresh one slides in
    const q = plan.blocks.find((b) => b.kind === 'queue');
    if (q) {
      const { lit } = queueLanes(s.queued, s.queueDepth), rects = cellRects(q);
      for (let k = 0; k < rects.length; k++) {
        const r = rects[k]!;
        if (k < lit) g.roundRect(r.x, r.y, r.w, r.h, 1.5).fill({ color: T.ink, alpha: 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(t * 6 + k)) });
        else if (act > 0.05) { const x = r.x + ((t * 3 + k * 0.37) % 1) * r.w; g.rect(x, r.y, Math.max(2, r.w * 0.08), r.h).fill({ color: T.st, alpha: 0.5 * act }); }
      }
    }
    // the host interface: its light blinks with the traffic
    const iface = plan.blocks.find((b) => b.kind === 'iface');
    if (iface) g.circle(iface.rect.x + iface.rect.w * 0.82, iface.rect.y + iface.rect.h * 0.2, Math.max(2, plan.h * 0.012)).fill({ color: act > 0.02 && Math.sin(t * 25) > 0 ? T.st : T.mute, alpha: 0.9 });
  }

  /** Packets while the drive works: a write goes host, controller, channel, die; a read the other way, one train per active die. */
  private flow(T: Theme, kind: DriveKind, plan: DiskPlan, s: StorageSnap): void {
    if (this.act < 0.05) return;
    const now = this.t * 1000;
    if (now < this.next) return;
    this.next = now + GAP_SLOW + (GAP_FAST - GAP_SLOW) * this.act;
    const rev = this.dir < 0, accent = accentOf(T, kind), color = this.dir > 0 ? T.alu : accent;
    const find = (id: string) => plan.links.find((l) => l.id === id);
    const go = (id: string, delay: number, c: string): void => {
      const l = find(id);
      if (!l) return;
      const { packet, trail } = packetOn({ id: l.id, lanes: l.lanes, pts: l.pts }, rev, now + delay, TRAVEL, c);
      this.packets.push(packet);
      this.trails.set(l.id + (rev ? '<' : '>'), trail);
    };
    let route: string[];
    if (plan.platter) route = ['iface-ctrl', 'ctrl-pre'];
    else {
      const dies = plan.dies, head = Math.floor(s.headLba / 8), a = Math.max(0, dies.findIndex((d) => head >= d.slice.first && head < d.slice.first + d.slice.count));
      const n = 1 + Math.min(dies.length - 1, s.queued), ids = new Set<string>(['iface-ctrl']);
      if (hash(Math.floor(now / 40) + this.seed) < 0.2 && find('ctrl-cache')) ids.add('ctrl-cache');
      for (let k = 0; k < n; k++) {
        const i = (a + k) % dies.length;
        if (kind === 'ssd-nvme') { ids.add(`ch${i % 4}`); if (i >= 4) ids.add(`ch${i % 4}b`); } else ids.add(`ch${i}`);
      }
      route = [...ids];
    }
    // a write leaves the host first, a read leaves the media first: stagger by the hop
    const order = rev ? route.slice().reverse() : route;
    order.forEach((id, i) => go(id, i * TRAVEL * 0.55, i === 0 ? T.alu : color));
  }
}
