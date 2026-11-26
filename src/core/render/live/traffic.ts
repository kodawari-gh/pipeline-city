import type { Snapshot } from '../../../worker/protocol';
import type { Theme } from '../theme';
import {
  BR,
  BIOS_CHAIN,
  COOLER_CHAIN,
  VOLTAGE_CHAIN,
  boardNetChain,
  driveChain,
  resolve,
  slotChain,
  tpmChain,
  chipLegOf,
} from './features';
import { CHIPSET_BUSES, MIN_GAP } from './consts';
import type { LiveState } from './state';
import type { BusKind, Chain, Hop, Lane, Lit } from './types';

/** The buses whose packets are violet: storage, chipset, USB and network. */
const VIOLET_BUSES: ReadonlySet<BusKind> = new Set<BusKind>(['nvme', 'dmi', 'sata', 'usb', 'lan', 'phyl']);

/** The colour of a bus's packets: memory cyan, the storage / chipset / USB buses violet, video green, PCIe the branch colour, the control buses amber. */
export function busColor(T: Theme, id: BusKind): string {
  if (id === 'mem') {
    return T.alu;
  }
  if (VIOLET_BUSES.has(id)) {
    return T.mul;
  }
  if (id === 'video') {
    return T.st;
  }
  return id === 'pcie' ? T.br : T.ld;
}

/** The memory bus moves data for as long as the phase does: it sends a packet every `STREAM_GAP` ms (re-armed by every snapshot of the phase, so it stops with it). */
export function flowMem(s: LiveState, dir: number): void {
  for (const l of s.memLit.values()) {
    l.stream = true;
    l.dir = dir;
  }
}

/** A message that goes on for as long as the snapshots say so (a boot phase, a busy drive, a transfer): sent every `STREAM_GAP` ms by `frame`. */
export function arm(s: LiveState, key: string, c: Chain): void {
  s.streams.set(key, c);
}

/** The hops of a network message: through the NIC card's slot, or the board's jack, PHY and hub; none without a link port. `down` runs toward the CPU. */
export function netHops(snap: Snapshot, dir: 'down' | 'up'): Hop[] {
  const p = snap.net?.port;
  if (p === undefined) {
    return [];
  }
  if (p.kind === 'nic') {
    const d = snap.devices.find((x) => x.id === p.deviceId);
    return d ? slotChain(d.slot, dir === 'up') : [];
  }
  return p.kind === 'board' ? boardNetChain(dir === 'down') : [];
}

export function driveMsg(s: LiveState, slot: string, toDrive: boolean): Chain {
  const lane = s.drives.get(slot)?.lane;
  return {
    hops: driveChain(slot, toDrive),
    drive: lane ? { lane, before: !toDrive, dir: toDrive ? -1 : 1 } : undefined,
  };
}

/** A drive moves data: its slot's chain streams, with the drive's own cable lane (SATA, which runs drive -> board) before a read or after a write. */
export function armDrive(s: LiveState, slot: string, toDrive: boolean): void {
  s.lastDrive = slot;
  arm(s, `drive:${slot}`, driveMsg(s, slot, toDrive));
}

/**
 * What POST pings, one after the other: the BIOS, the CPU's voltage, the cooler, every stick of RAM, every drive, every card on a slot and the secure module
 * (each a message out and its reply back, so a part that is not there is never pinged and a failed POST shows what it found).
 */
export function postProbes(s: LiveState, snap: Snapshot): Chain[] {
  // (the first ping is the BIOS: flash, chipset, CPU, and on into the stick that holds address 0, where the ROM is shadowed to run from)
  const shadow = s.ram.stickOf(0),
    force = true,
    out: Chain[] = [
      { hops: BIOS_CHAIN, force, ...(shadow >= 0 ? { mem: shadow } : {}) },
      { hops: VOLTAGE_CHAIN, force, pong: true },
      { hops: COOLER_CHAIN, force, pong: true },
    ];
  for (const idx of s.memLit.keys()) {
    out.push({ hops: [], mem: idx, force, pong: true });
  }
  for (const st of snap.storage ?? []) {
    out.push({ ...driveMsg(s, st.slot, true), force, pong: true });
  }
  for (const d of snap.devices) {
    if (/^pcie\d+$/u.test(d.slot)) {
      out.push({ hops: slotChain(d.slot, true), force, pong: true });
    }
  }
  // the secure module on its header
  if (s.tpmFitted) {
    out.push({ hops: tpmChain(true), force, pong: true });
  }
  return out;
}

/** A packet runs `lanes` from game time `start` for `dur` ms: each lane that lands on a leg of the chipset flashes it as the packet arrives there or leaves from it. */
function hitLegs(
  s: LiveState,
  seg: { lanes: Lane[]; dir: number; color: string },
  run: { start: number; dur: number },
): void {
  const { lanes, dir, color } = seg,
    { start, dur } = run;
  for (const l of lanes) {
    let leg = s.legOf.get(l);
    if (leg === undefined) {
      leg = chipLegOf(BR.chip, l);
      s.legOf.set(l, leg);
    }
    if (leg) {
      s.pchHits.push({
        x: leg.x,
        y: leg.y,
        side: leg.side,
        color,
        at: leg.arrives === (dir < 0 ? -1 : 1) ? start + dur : start,
      });
    }
  }
  if (s.pchHits.length > 160) {
    s.pchHits.splice(0, s.pchHits.length - 160);
  }
}

/**
 * Send one message now (game time `s.gt`): its hops one after the other, each on its own lanes, then the video cable if it goes on to the monitor.
 * At most one per `at.gap` ms (default `MIN_GAP`) for an `at.key`. The legs of the chipset (PCH) that the message reaches or leaves flash, and its edge glows for as long as a
 * message is on a path that crosses it.
 */
export function fire(s: LiveState, at: { key: string; gap?: number }, c: Chain): void {
  const now = s.gt,
    { key, gap = MIN_GAP } = at;
  if (!s.liveOn || (s.quiet && c.force !== true) || now < (s.chainAt.get(key) ?? -1e9)) {
    return;
  }
  s.chainAt.set(key, now + gap);
  const legs = resolve(s.flowBuses, c.hops);
  const segs = legs.map((l) => ({ lanes: l.lanes, dir: l.dir, w: l.w, color: busColor(s.T, l.bus) }));
  if (c.drive) {
    const d = { lanes: [c.drive.lane], dir: c.drive.dir, w: 10, color: s.T.mul };
    if (c.drive.before) {
      segs.unshift(d);
    } else {
      segs.push(d);
    }
  }
  if (c.mem !== undefined) {
    const m = s.memLit.get(c.mem);
    if (m) {
      segs.push({ lanes: m.lanes, dir: 1, w: m.bus.w, color: m.color });
    }
  }
  let delay = 0;
  const go = (sg: { lanes: Lane[]; w: number; color: string }, dir: number) => {
    const dur = s.busFlow.send(sg.lanes, dir, sg.color, now, sg.w, delay);
    hitLegs(s, { lanes: sg.lanes, dir, color: sg.color }, { start: now + delay, dur });
    delay += dur;
  };
  for (const sg of segs) {
    go(sg, sg.dir);
  }
  if (c.pong === true) {
    for (const sg of segs.toReversed()) {
      go(sg, -sg.dir);
    }
  }
  if (c.cable === true && s.videoLane !== null && s.connected.has('video')) {
    s.extFlow.send([s.videoLane], 1, s.T.st, now, s.videoW, delay);
  }
  if (legs.some((l) => CHIPSET_BUSES.has(l.bus))) {
    s.pchUntil = Math.max(s.pchUntil, now + delay);
  }
}

/** Send one memory message now, at game time `s.gt` (at most one per `gap` ms on this stick's bundle). */
export function send(s: LiveState, l: Lit, gap: number): void {
  const now = s.gt;
  if (s.quiet || !s.liveOn || now < l.nextAt) {
    return;
  }
  l.nextAt = now + gap;
  s.busFlow.send(l.lanes, l.dir, l.color, now, l.bus.w);
}

/** One message between the CPU and one stick. */
export function triggerMem(s: LiveState, idx: number, dir: number): void {
  const l = s.memLit.get(idx);
  if (!l) {
    return;
  }
  l.dir = dir;
  send(s, l, MIN_GAP);
}
