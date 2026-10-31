import type { TpmLogEntry, TpmView } from '../sim/tpm';
import type { TpmShow } from './tpmglyph';

// What the module view shows each frame (`TpmShow`): the snapshot as it is while a command is in flight, and otherwise a slow-motion replay of the
// commands that finished since the last look (a command takes a few dozen module ticks, far less than a frame of the game, so without the replay a
// `seal` would come and go unseen). The replay knows the command, its arguments, its answer and how long the work took, nothing more: it never
// invents the words of a hash, so the running hash is left out of it (`replay: true`).

/** How long the command takes to cross the header, in a replay (ms), and how long the work lasts for a given work time. */
export const REPLAY_HOP_MS = 600;
export const replayWorkMs = (ticks: number): number => (ticks > 0 ? Math.min(2800, 700 + ticks * 5) : 0);
/** The most commands kept waiting for their replay. */
export const REPLAY_QUEUE = 3;

const unit = (v: number): number => Math.max(0, Math.min(1, v));

/** The module now, from its snapshot. */
export function liveShow(v: TpmView, ms: number): TpmShow {
  return {
    phase: v.phase, progress: v.busy ? unit(v.span > 0 ? 1 - v.wait / v.span : 1) : 1, cmd: v.cmd, arg0: v.arg0, arg1: v.arg1, result: v.result, fault: v.fault,
    busy: v.busy, error: v.error, done: v.done, hashed: v.hashed, partial: v.partial, range: v.range, ram: v.ramBytes, sealed: v.sealed,
    guardedAccesses: v.guardedAccesses, measuredWords: v.measuredWords, lastViolation: v.lastViolation, surcharge: v.surcharge, replay: false, ms,
  };
}

/** The length of a command's replay (ms). */
export const replayLength = (e: TpmLogEntry): number => 2 * REPLAY_HOP_MS + replayWorkMs(e.ticks);

/** A finished command `t` ms into its replay. */
export function replayShow(e: TpmLogEntry, v: TpmView, t: number, ms: number): TpmShow {
  const work = replayWorkMs(e.ticks);
  const phase = t < REPLAY_HOP_MS ? 'in' : t < REPLAY_HOP_MS + work ? 'work' : 'out';
  const progress = phase === 'in' ? t / REPLAY_HOP_MS : phase === 'work' ? (t - REPLAY_HOP_MS) / work : (t - REPLAY_HOP_MS - work) / REPLAY_HOP_MS;
  return {
    ...liveShow(v, ms), phase, progress: unit(progress), cmd: e.cmd, arg0: e.arg0, arg1: e.arg1, result: phase === 'out' ? e.result : 0, fault: phase === 'out' ? e.fault : 0,
    busy: true, error: phase === 'out' && e.fault !== 0, done: phase === 'out' && e.fault === 0, partial: 0,
    hashed: phase === 'in' ? 0 : phase === 'work' ? Math.floor(unit(progress) * e.arg1) : e.arg1, replay: true,
  };
}

export class TpmPlayer {
  private seen = -1;
  private queue: TpmLogEntry[] = [];
  private cur: TpmLogEntry | null = null;
  private t = 0;
  /** The newest snapshot. */
  private v: TpmView | undefined;

  /** Take the newest snapshot; the commands that finished since the last one wait for their replay (the first sight of a module replays nothing). */
  feed(v: TpmView | undefined): void {
    this.v = v;
    if (!v) { this.seen = -1; this.queue = []; this.cur = null; return; }
    const top = v.log.length ? v.log[v.log.length - 1]!.seq : 0;
    if (this.seen < 0) { this.seen = top; return; }
    for (const e of v.log) if (e.seq > this.seen) this.queue.push(e);
    this.seen = Math.max(this.seen, top);
    if (this.queue.length > REPLAY_QUEUE) this.queue = this.queue.slice(-REPLAY_QUEUE);
  }

  /** Move the replay on by `dtMs`; a command in flight in the module itself is shown live instead and the queue waits. */
  advance(dtMs: number): void {
    if (this.v?.busy) return;
    if (!this.cur && this.queue.length) { this.cur = this.queue.shift()!; this.t = 0; }
    if (!this.cur) return;
    this.t += dtMs;
    if (this.t >= replayLength(this.cur)) this.cur = null;
  }

  get replaying(): boolean { return !!this.cur && !this.v?.busy; }

  /** Names the command on show (a replayed one, or the module's own count of commands), so a view can tell a new command from the same one a frame later. */
  get token(): string { return this.replaying ? `r${this.cur!.seq}` : `l${this.v?.commands ?? 0}`; }

  /** The module as it should look now, or null without a module. */
  show(ms: number): TpmShow | null {
    const v = this.v;
    if (!v) return null;
    if (this.cur && !v.busy) return replayShow(this.cur, v, this.t, ms);
    return liveShow(v, ms);
  }
}
