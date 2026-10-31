import type { Graphics } from 'pixi.js';
import type { StorageCmd } from '../sim/storage';
import { mix } from '@/core/render/ink';
import { cellRects } from '../../cpu/render/die/dieart';
import { drawPackets, drawTrails, packetOn, type Packet, type Trail } from '../../cpu/render/die/diepulse';
import type { Theme } from '@/core/render/theme';
import { accentOf } from './diskart';
import type { DiskPlan } from './diskfloor';
import { queueLanes } from './diskplan';
import { DiskPlayer, dieOf, platterTarget, stepAt, turnLeft, type Script } from './diskplayer';
import type { DriveKind } from './drives';

// The drive's cutaway at work: what `diskplayer.ts` says the drive is doing right now, drawn the way the CPU die shows its instructions. Packets run along the
// links of the step (a command is small, data is big), the blocks that work glow, the die cell being sensed or programmed fills as the step goes on, the arm of
// a hard disk seeks, a marker sweeps the ring until the sector comes round, and the head's line runs to the cell it reads or writes. A drive that runs no
// command shows nothing moving: the capacity map and the architecture stand still.

const TAU = Math.PI * 2;

export class DiskPlay {
  readonly player = new DiskPlayer();
  private clock = 0;
  private packets: Packet[] = [];
  private trails = new Map<string, Trail>();

  /** The drive's newest commands (a snapshot). */
  ingest(kind: DriveKind, plan: DiskPlan, cmds: readonly StorageCmd[], totalBlocks: number, headLba: number): void {
    this.player.ingest(kind, plan, cmds, totalBlocks, headLba);
  }

  /** What the drive is doing now, in words (empty when idle). */
  label(): string {
    const n = this.player.now;
    if (!n) return '';
    const { step } = stepAt(n.script, n.t), c = n.script.cmd;
    return `${c.op === 'w' ? 'WRITE' : 'READ'} #${c.lba}: ${step.label}`;
  }

  /** The head's track now (the arm's place). */
  get track(): number {
    return this.player.track;
  }

  /** Whether anything is moving: a script plays or packets are in flight. */
  get busy(): boolean {
    return this.player.playing || this.packets.length > 0 || this.trails.size > 0;
  }

  /** Advances by `dtMs` and draws into `g` (the glows and cells), `tg` (trails) and `pg` (packets); all three are cleared first. */
  frame(dtMs: number, T: Theme, kind: DriveKind, plan: DiskPlan, g: Graphics, tg: Graphics, pg: Graphics): void {
    this.clock += dtMs;
    const spawns = this.player.step(dtMs), accent = accentOf(T, kind);
    for (const s of spawns) {
      const l = plan.links.find((x) => x.id === s.id);
      if (!l) continue;
      const color = s.data ? (s.write ? T.ld : T.st) : T.alu;
      const { packet, trail } = packetOn({ id: l.id, lanes: s.data ? l.lanes : 1, pts: l.pts }, s.rev, this.clock, Math.max(120, s.dur * 0.9), color);
      this.packets.push(packet);
      this.trails.set(`${l.id}${s.rev ? '<' : '>'}`, trail);
    }
    g.clear();
    tg.clear();
    pg.clear();
    const n = this.player.now;
    if (n) this.glow(g, T, kind, plan, accent, n.script, n.t);
    drawTrails(tg, this.trails, this.clock, 1);
    this.packets = drawPackets(pg, this.packets, this.clock, 1, T.ink);
    for (const [k, t] of this.trails) if (this.clock - t.t0 > 1600) this.trails.delete(k);
  }

  private glow(g: Graphics, T: Theme, kind: DriveKind, plan: DiskPlan, accent: string, s: Script, t: number): void {
    const { step, p } = stepAt(s, t), write = s.cmd.op === 'w', color = write ? T.ld : T.st, pulse = 0.5 + 0.5 * Math.sin(this.clock / 90);
    // the blocks that work
    for (const id of step.blocks) {
      const b = plan.blocks.find((x) => x.id === id);
      if (!b) continue;
      g.roundRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3).fill({ color: accent, alpha: 0.1 + 0.14 * pulse }).stroke({ width: Math.max(1.5, plan.h * 0.006), color: accent, alpha: 0.5 + 0.4 * pulse });
    }
    if (plan.platter && plan.arm) this.platter(g, T, plan, s, t, step.kind, p, color);
    else this.flash(g, T, plan, s, step.kind, p, color);
  }

  /** The die cell of the command: it fills while the die senses or programs it, and stays lit while the data is on its way. */
  private flash(g: Graphics, T: Theme, plan: DiskPlan, s: Script, step: string, p: number, color: string): void {
    const { die, k } = dieOf(plan, s.cell), b = plan.blocks.find((x) => x.id === `nand${die}`);
    if (b) {
      const r = cellRects(b)[k];
      if (r) {
        const during = step === 'array', before = step === 'cmd' || step === 'lookup' || step === 'send';
        if (!before) {
          const fill = during ? p : 1;
          g.roundRect(r.x, r.y, r.w, r.h, 1.5).fill({ color: mix(T.die, color, 0.25), alpha: 0.9 });
          g.roundRect(r.x, r.y, Math.max(1, r.w * fill), r.h, 1.5).fill({ color, alpha: during ? 0.95 : 0.55 });
          g.roundRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, 2).stroke({ width: Math.max(1, plan.h * 0.004), color: T.ink, alpha: during ? 0.9 : 0.4 });
        } else g.roundRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, 2).stroke({ width: Math.max(1, plan.h * 0.004), color, alpha: 0.35 });
      }
    }
    // the NVMe's queue: the lane the command sits in lights while it is taken
    const q = plan.blocks.find((x) => x.kind === 'queue');
    if (q && step === 'cmd') {
      const rects = cellRects(q), { lanes } = queueLanes(s.cmd.queued + 1, 8), r = rects[s.cmd.seq % Math.max(1, Math.min(lanes, rects.length))];
      if (r) g.roundRect(r.x, r.y, r.w, r.h, 1.5).fill({ color: T.st, alpha: 0.95 });
    }
  }

  /** The hard disk: the sector marker sweeps the ring until it is under the head, then the head's line runs to the cell and it fills as it is read or written. */
  private platter(g: Graphics, T: Theme, plan: DiskPlan, s: Script, t: number, step: string, p: number, color: string): void {
    const pl = plan.platter!, a = plan.arm!, tg = platterTarget(plan, s);
    if (!tg) return;
    const ring = (pl.R * 0.86) / pl.tracks, r1 = pl.R * 0.97 - tg.track * ring, r0 = r1 - ring * 0.9;
    const a0 = (tg.sector / pl.sectors) * TAU - Math.PI / 2, a1 = ((tg.sector + 1) / pl.sectors) * TAU - Math.PI / 2 - 0.02, headAng = Math.atan2(a.py - pl.cy, a.px - pl.cx);
    const cellPoly = (fillA: number): number[] => {
      const pts: number[] = [], to = a0 + (a1 - a0) * fillA;
      for (let k = 0; k <= 4; k++) { const an = a0 + ((to - a0) * k) / 4; pts.push(pl.cx + Math.cos(an) * r1, pl.cy + Math.sin(an) * r1); }
      for (let k = 4; k >= 0; k--) { const an = a0 + ((to - a0) * k) / 4; pts.push(pl.cx + Math.cos(an) * r0, pl.cy + Math.sin(an) * r0); }
      return pts;
    };
    if (step === 'rotate') {
      // the marker starts under the head and runs round to the sector, a part of the turn the sector still has to make
      const delta = ((((a0 + a1) / 2 - headAng) % TAU) + TAU) % TAU, left = turnLeft(s, t), cur = headAng + delta * (1 - left);
      const rm = (r0 + r1) / 2;
      for (let j = 0; j < 8; j++) {
        const an = cur - j * 0.05;
        g.moveTo(pl.cx + Math.cos(an) * (rm - ring * 0.5), pl.cy + Math.sin(an) * (rm - ring * 0.5)).lineTo(pl.cx + Math.cos(an) * (rm + ring * 0.5), pl.cy + Math.sin(an) * (rm + ring * 0.5)).stroke({ width: Math.max(1.5, ring * 0.35), color: T.ink, alpha: 0.9 - j * 0.11 });
      }
      g.poly(cellPoly(1)).stroke({ width: Math.max(1, plan.h * 0.004), color, alpha: 0.5 });
    } else if (step === 'media') {
      g.poly(cellPoly(1)).fill({ color: mix(T.die, color, 0.25), alpha: 0.9 });
      g.poly(cellPoly(Math.max(0.05, p))).fill({ color, alpha: 0.95 });
      const mid = (a0 + a1) / 2, rm = (r0 + r1) / 2, ex = pl.cx + Math.cos(mid) * rm, ey = pl.cy + Math.sin(mid) * rm;
      const hr = pl.R * 0.97 - tg.track * ring - ring * 0.45, hx = pl.cx + Math.cos(headAng) * hr, hy = pl.cy + Math.sin(headAng) * hr;
      g.moveTo(hx, hy).lineTo(ex, ey).stroke({ width: Math.max(1, plan.h * 0.005), color, alpha: 0.85 });
    } else if (step === 'return' || step === 'cmd' || step === 'lookup') {
      g.poly(cellPoly(1)).stroke({ width: Math.max(1, plan.h * 0.004), color, alpha: step === 'return' ? 0.55 : 0.3 });
    }
  }
}
