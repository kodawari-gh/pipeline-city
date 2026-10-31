// What happens inside a drive when it runs a command, as a script the view replays (pure, no Pixi). The sim logs each command the port ran (`StorageCmd`:
// read or write, the block, the seek and transfer ticks); `scriptFor` turns one into the steps the drive really takes, in order, each with the links the
// data crosses and the blocks and cells that work. `DiskPlayer` plays the scripts one after another on its own clock, like the CPU die replays its
// instructions (die/dieview.ts). A drive that runs nothing shows nothing moving. Tested in diskplayer.test.ts.
//
//   flash read    host -> controller (command) | controller looks the block up in the map (DRAM) | command and address go down the channel to the die |
//                 the die senses the page | the data comes up the channel and out to the host
//   flash write   host -> controller (command and data) | the map picks a page, the data waits in the DRAM cache | the channel carries it to the die |
//                 the die programs the page | the status goes back to the host
//   hard disk     host -> controller | the servo plans the move | the arm seeks to the track (as long as the sim's seek ticks say) | the platter turns the
//                 sector under the head | the head reads or writes it, through the preamp | the data (or the status) goes back to the host

import type { StorageCmd } from '../sim/storage';
import type { DiskPlan } from './diskfloor';
import { CELL_BLOCKS, headTrack, platterCell } from './diskplan';
import type { DriveKind } from './drives';

export type StepKind = 'cmd' | 'lookup' | 'send' | 'array' | 'return' | 'seek' | 'rotate' | 'media' | 'status';

/** One step: it starts at `at` ms into the script and lasts `dur` ms. */
export interface Step {
  kind: StepKind;
  at: number;
  dur: number;
  /** What the drive is doing, in words (the counter tier shows it). */
  label: string;
  /** Links the data crosses during the step (in the plan's own direction unless `rev`). */
  links: { id: string; rev: boolean }[];
  /** Blocks that work during the step. */
  blocks: string[];
  /** The step whose data is the payload (a data packet is bigger than a command's). */
  data: boolean;
}

export interface Script {
  cmd: StorageCmd;
  steps: Step[];
  total: number;
  /** The die and the cell in it (flash), or the cell on the platter (hard disk). */
  die: number;
  cell: number;
  /** The head track before and after (hard disk). */
  fromTrack: number;
  toTrack: number;
}

/** The die that holds capacity cell `cell`, and the cell's place in it. */
export function dieOf(plan: DiskPlan, cell: number): { die: number; k: number } {
  const i = plan.dies.findIndex((d) => cell >= d.slice.first && cell < d.slice.first + d.slice.count);
  const die = Math.max(0, i);
  return { die, k: Math.max(0, cell - (plan.dies[die]?.slice.first ?? 0)) };
}

/** The links from the controller to die `i`: one channel on the SATA SSD, a channel and, for the lower row, its stub on the NVMe. */
export function channelOf(kind: DriveKind, i: number): string[] {
  if (kind === 'ssd-nvme') return i >= 4 ? [`ch${i - 4}`, `ch${i - 4}b`] : [`ch${i}`];
  return [`ch${i}`];
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** The steps for one command, with times in ms. `weights` are shares of the total; a step with weight 0 is left out. */
export function scriptFor(kind: DriveKind, plan: DiskPlan, cmd: StorageCmd, fromTrack: number, totalBlocks: number): Script {
  const write = cmd.op === 'w', cell = Math.floor(cmd.lba / CELL_BLOCKS);
  const steps: Step[] = [];
  const w: [Omit<Step, 'at' | 'dur'>, number][] = [];
  const add = (kind: StepKind, label: string, weight: number, links: Step['links'] = [], blocks: string[] = [], data = false): void => { if (weight > 0) w.push([{ kind, label, links, blocks, data }, weight]); };
  const verb = write ? 'write' : 'read';
  let die = 0, toTrack = fromTrack, total: number;
  if (plan.platter) {
    toTrack = headTrack(cmd.lba, totalBlocks, plan.platter.tracks);
    const move = Math.abs(toTrack - fromTrack) > 0 || cmd.seek > 0;
    // the seek takes the share of the time the sim's seek ticks are of the command's ticks
    const ticks = Math.max(1, cmd.seek + cmd.xfer), seekShare = cmd.seek / ticks;
    total = clamp(ticks * 7, 600, 2600);
    const fixed = 0.34, rest = 1 - fixed;
    add('cmd', `${verb} block ${cmd.lba}: the command reaches the controller`, 0.1, [{ id: 'iface-ctrl', rev: false }], ['iface', 'ctrl'], write);
    add('lookup', 'the servo plans the move', 0.06, [], ['ctrl']);
    if (move) add('seek', `the arm seeks to track ${toTrack + 1}`, rest * seekShare + 0.04, [], []);
    add('rotate', 'the platter turns the sector under the head', move ? 0.1 : 0.14, [], []);
    add('media', write ? 'the head writes the sector' : 'the head reads the sector', rest * (1 - seekShare) * 0.7 + 0.06, [{ id: 'ctrl-pre', rev: !write }], ['pre'], true);
    add('return', write ? 'the controller reports it is done' : 'the data goes back to the host', 0.14, [{ id: 'iface-ctrl', rev: true }], ['ctrl', 'iface'], !write);
  } else {
    die = dieOf(plan, cell).die;
    const ch = channelOf(kind, die), nand = `nand${die}`, ticks = Math.max(1, cmd.xfer);
    total = clamp(ticks * 14, 700, 1800);
    const queued = kind === 'ssd-nvme' ? [{ id: 'queue-ctrl', rev: false }] : [];
    add('cmd', `${verb} block ${cmd.lba}: the command reaches the controller`, 0.13, [...queued, { id: 'iface-ctrl', rev: false }], kind === 'ssd-nvme' ? ['queue', 'iface', 'ctrl'] : ['iface', 'ctrl'], write);
    add('lookup', write ? 'the map picks a free page; the data waits in the cache' : 'the map finds where the block lives', 0.13, [{ id: 'ctrl-cache', rev: !write }], ['ctrl', 'cache'], write);
    add('send', write ? `the data goes down the channel to NAND ${die}` : `the address goes down the channel to NAND ${die}`, 0.12, ch.map((id) => ({ id, rev: false })), ['ctrl', nand], write);
    add('array', write ? `NAND ${die} programs the page` : `NAND ${die} senses the page`, 0.32, [], [nand]);
    add('return', write ? 'the status comes back' : 'the data comes up the channel', 0.15, ch.map((id) => ({ id, rev: true })), [nand, 'ctrl'], !write);
    add('status', write ? 'the host is told it is done' : 'the data goes out to the host', 0.15, [{ id: 'iface-ctrl', rev: true }], ['ctrl', 'iface'], !write);
  }
  const sum = w.reduce((n, [, x]) => n + x, 0);
  let at = 0;
  for (const [s, x] of w) { const dur = (x / sum) * total; steps.push({ ...s, at, dur }); at += dur; }
  return { cmd, steps, total, die, cell, fromTrack, toTrack };
}

/** The step running at `t` ms into a script (the last one once it is over), and how far through it (0..1). */
export function stepAt(s: Script, t: number): { step: Step; p: number } {
  let st = s.steps[0]!;
  for (const x of s.steps) { if (t >= x.at) st = x; }
  return { step: st, p: clamp((t - st.at) / Math.max(1, st.dur), 0, 1) };
}

const ease = (p: number): number => p * p * (3 - 2 * p);

/** The head track at `t` ms: it holds the old track until the seek, glides over it (a smooth start and stop), and holds the new one. */
export function trackAt(s: Script, t: number): number {
  const seek = s.steps.find((x) => x.kind === 'seek');
  if (!seek) return s.toTrack;
  return s.fromTrack + (s.toTrack - s.fromTrack) * ease(clamp((t - seek.at) / seek.dur, 0, 1));
}

/** Where the sector under the head is on its ring, as the share of a turn the platter still has to turn (1 = a whole turn ahead, 0 = it is there). */
export const turnLeft = (s: Script, t: number): number => {
  const r = s.steps.find((x) => x.kind === 'rotate');
  return r ? 1 - ease(clamp((t - r.at) / r.dur, 0, 1)) : 0;
};

/** The platter cell of the command (track and sector), for the highlight. */
export const platterTarget = (plan: DiskPlan, s: Script): { track: number; sector: number } | null => (plan.platter ? platterCell(s.cell, plan.platter.sectors) : null);

/** Most commands waiting to play; older ones are skipped, so the picture never lags the sim by long. */
const BACKLOG = 5;

/** A link to send a packet on, from the step that just began. */
export interface Spawn { id: string; rev: boolean; dur: number; data: boolean; write: boolean }

/** Plays the scripts of a drive's commands one after another. */
export class DiskPlayer {
  private lastSeq = -1;
  private queue: Script[] = [];
  private cur: Script | null = null;
  private t = 0;
  private started = -1;
  /** The track the arm rests on (the end of the last script). */
  private rest = 0;
  private prevTrack = 0;

  /** Takes the commands in a snapshot: the new ones are queued. The first look only notes where the drive stands. */
  ingest(kind: DriveKind, plan: DiskPlan, cmds: readonly StorageCmd[], totalBlocks: number, headLba: number): void {
    if (this.lastSeq < 0) {
      this.lastSeq = cmds.length ? cmds[cmds.length - 1]!.seq : 0;
      this.prevTrack = this.rest = plan.platter ? headTrack(headLba, totalBlocks, plan.platter.tracks) : 0;
      return;
    }
    for (const c of cmds) {
      if (c.seq <= this.lastSeq) continue;
      this.lastSeq = c.seq;
      const s = scriptFor(kind, plan, c, this.prevTrack, totalBlocks);
      this.prevTrack = s.toTrack;
      this.queue.push(s);
    }
    while (this.queue.length > BACKLOG) this.queue.shift();
  }

  /** Whether a script is playing. */
  get playing(): boolean {
    return this.cur !== null;
  }

  /** The script on show, and the time into it. */
  get now(): { script: Script; t: number } | null {
    return this.cur ? { script: this.cur, t: this.t } : null;
  }

  /** The track the arm is at now. */
  get track(): number {
    return this.cur ? trackAt(this.cur, this.t) : this.rest;
  }

  /** Advances `dtMs`. A backlog plays faster. Returns the packets to send as steps begin. */
  step(dtMs: number): Spawn[] {
    const out: Spawn[] = [];
    let left = dtMs;
    for (let guard = 0; left > 0 && guard < 8; guard++) {
      if (!this.cur) {
        const next = this.queue.shift();
        if (!next) break;
        this.cur = next;
        this.t = 0;
        this.started = -1;
      }
      const speed = 1 + this.queue.length * 0.6, s = this.cur, room = (s.total - this.t) / speed;
      const used = Math.min(left, room);
      this.t += used * speed;
      left -= used;
      for (let i = this.started + 1; i < s.steps.length; i++) {
        const st = s.steps[i]!;
        if (st.at > this.t + 1e-6) break;
        this.started = i;
        for (const l of st.links) out.push({ id: l.id, rev: l.rev, dur: st.dur / speed, data: st.data, write: s.cmd.op === 'w' });
      }
      if (this.t >= s.total - 1e-6) { this.rest = s.toTrack; this.cur = null; }
    }
    return out;
  }
}
