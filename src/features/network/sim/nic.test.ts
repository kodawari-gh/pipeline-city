import { describe, expect, it } from 'vitest';
import {
  IRQ,
  JobState,
  KDATA_BASE,
  KSLOT,
  KSLOT_BYTES,
  NET_KEY,
  NIC_ACK_NEXT_MASK,
  NIC_REG,
  NIC_RX_HEAD_WORDS,
  NIC_RX_SLOT_BYTES,
  NIC_STAMP_SHIFT,
  NIC_TX_HEAD_WORDS,
  NICA,
  NICK,
  NicCtrl,
  NicRx,
  NicStatus,
  NicTx,
  NicTxSlot,
} from '@/core/sim/memmap';
import { ECONOMY } from '../../economy/sim/economy';
import type * as economyTypes from '../../economy/sim/economy';
import { Game } from '@/worker/game/game';
import { econ, netRig, rig } from '@/worker/game/testkit';
import type * as testkitTypes from '@/worker/game/testkit';
import { Nic, NIC_FIFO_SEGS } from './nic';
import type * as nicTypes from './nic';
import { fifoSegsOf } from './specs';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

// The NIC as a device, alone: registers, the receive ring and the transmit ring by DMA, the FIFO, the link.

const RING_RX = 0x20_00,
  RING_TX = 0x30_00;

function bare(): {
  nic: Nic;
  ram: Uint8Array;
  dv: DataView;
  lines: number[];
  sent: nicTypes.NicPacket[];
  wr: (reg: number, v: number) => void;
  rd: (reg: number) => number;
} {
  const ram = new Uint8Array(0x1_00_00);
  const dv = new DataView(ram.buffer);
  const lines: number[] = [];
  const nic = new Nic(ram, (l) => {
    lines.push(l);
  });
  const sent: nicTypes.NicPacket[] = [];
  nic.onTransmit = (p) => {
    sent.push(p);
  };
  // the registers are written a byte at a time, low byte first, as the bus does for a word store
  const wr = (reg: number, v: number): void => {
    for (let k = 0; k < 4; k++) {
      nic.write(reg + k, (v >>> (8 * k)) & 0xff);
    }
  };
  const rd = (reg: number): number =>
    (nic.read(reg) | (nic.read(reg + 1) << 8) | (nic.read(reg + 2) << 16) | (nic.read(reg + 3) << 24)) >>> 0;
  return { nic, ram, dv, lines, sent, wr, rd };
}

const seg = (seq: number, count: number, n = 3): nicTypes.NicSegment => ({
  key: 41,
  seq,
  count,
  total: 100,
  words: Uint32Array.from({ length: n }, (_, i) => 1000 * seq + i + 1),
  flags: 0,
});

/** A `pull` that hands over `waiting` one at a time, then nothing. */
const pullFrom =
  (waiting: nicTypes.NicSegment[]): (() => nicTypes.NicSegment | null) =>
  () =>
    waiting.shift() ?? null;

/** The NIC set up the way the kernel does it: both rings, interrupts on, enabled, the link up. */
function ready() {
  const r = bare();
  r.wr(NIC_REG.RX_BASE, RING_RX);
  r.wr(NIC_REG.RX_SLOTS, 4);
  r.wr(NIC_REG.TX_BASE, RING_TX);
  r.wr(NIC_REG.TX_SLOTS, 4);
  r.wr(NIC_REG.CTRL, NicCtrl.Enable | NicCtrl.RxIrq | NicCtrl.TxIrq);
  r.nic.linkUp = true;
  return r;
}

describe('the NIC device', () => {
  it('is off until the kernel gives it a ring and enables it: nothing is taken from the wire', () => {
    const r = bare();
    r.nic.linkUp = true;
    expect(r.nic.accept(seg(0, 1))).toBe(false);
    r.wr(NIC_REG.CTRL, NicCtrl.Enable);
    expect(r.nic.accept(seg(0, 1))).toBe(false); // enabled, but there is no ring
    r.wr(NIC_REG.RX_BASE, RING_RX);
    r.wr(NIC_REG.RX_SLOTS, 4);
    expect(r.nic.accept(seg(0, 1))).toBe(true);
    expect(r.rd(NIC_REG.STATUS) & NicStatus.Enabled).toBe(NicStatus.Enabled);
  });

  it('a received segment is written into the next ring slot by DMA, the head moves and the line goes up', () => {
    const r = ready();
    expect(r.nic.accept(seg(2, 5, 4))).toBe(true);
    expect(r.rd(NIC_REG.RX_HEAD)).toBe(0); // still in the FIFO: nothing in RAM yet
    r.nic.tick();
    expect(r.rd(NIC_REG.RX_HEAD)).toBe(1);
    expect(r.rd(NIC_REG.STAT_RX)).toBe(1);
    expect(r.lines).toStrictEqual([IRQ.NIC]);
    const w = (i: number): number => r.dv.getUint32(RING_RX + 4 * i, true);
    expect([w(NicRx.KEY), w(NicRx.SEQ), w(NicRx.COUNT), w(NicRx.NWORDS), w(NicRx.TOTAL), w(NicRx.FLAGS)]).toStrictEqual(
      [41, 2, 5, 4, 100, 0],
    );
    expect([w(NIC_RX_HEAD_WORDS), w(NIC_RX_HEAD_WORDS + 3), w(NIC_RX_HEAD_WORDS + 4)]).toStrictEqual([2001, 2004, 0]); // the payload, then zero padding
    expect(r.rd(NIC_REG.STATUS) & NicStatus.RxPending).toBe(NicStatus.RxPending);
    r.wr(NIC_REG.RX_TAIL, 1); // the kernel has read it
    expect(r.rd(NIC_REG.STATUS) & NicStatus.RxPending).toBe(0);
  });

  it('the slots fill in order and wrap: slot = index mod slots', () => {
    const r = ready();
    for (let i = 0; i < 6; i++) {
      expect(r.nic.accept(seg(i, 6))).toBe(true);
      r.nic.tick();
      r.wr(NIC_REG.RX_TAIL, i + 1);
    }
    expect(r.rd(NIC_REG.RX_HEAD)).toBe(6);
    // segment 5 went into slot 1, over segment 1
    expect(r.dv.getUint32(RING_RX + NIC_RX_SLOT_BYTES + 4 * NicRx.SEQ, true)).toBe(5);
    expect(r.dv.getUint32(RING_RX + 4 * NicRx.SEQ, true)).toBe(4); // and segment 4 into slot 0
  });

  it('a full ring keeps the segment in the FIFO; a full FIFO turns the wire away', () => {
    const r = ready();
    for (let i = 0; i < 4; i++) {
      r.nic.accept(seg(i, 9));
      r.nic.tick();
    }
    expect(r.nic.rxPending).toBe(4); // the kernel has read nothing
    for (let i = 4; i < 4 + NIC_FIFO_SEGS; i++) {
      expect(r.nic.accept(seg(i, 9))).toBe(true);
    }
    expect(r.nic.accept(seg(9, 9))).toBe(false); // the FIFO is full: the wire is turned away (`tick` counts that as a drop)
    r.nic.tick();
    expect(r.rd(NIC_REG.RX_HEAD)).toBe(4); // the ring is full: nothing moved
    expect(r.nic.view().fifo).toBe(NIC_FIFO_SEGS);
    r.wr(NIC_REG.RX_TAIL, 1); // the kernel frees one slot
    r.nic.tick();
    expect(r.rd(NIC_REG.RX_HEAD)).toBe(5);
    expect(r.nic.view().fifo).toBe(NIC_FIFO_SEGS - 1);
  });

  it('pulls the segments that have reached the end of the wire, one a step', () => {
    const r = ready();
    const waiting = [seg(0, 3), seg(1, 3), seg(2, 3)];
    r.nic.pull = pullFrom(waiting);
    for (let i = 0; i < 6; i++) {
      r.nic.tick();
      r.wr(NIC_REG.RX_TAIL, r.rd(NIC_REG.RX_HEAD));
    }
    expect(waiting).toHaveLength(0);
    expect(r.rd(NIC_REG.STAT_RX)).toBe(3);
    expect(r.rd(NIC_REG.STAT_DROP)).toBe(0);
  });

  it('the wire cannot wait: with the ring full and the FIFO full, the next segment is lost, counted, and the sticky bit is set', () => {
    const r = ready();
    let n = 0;
    r.nic.pull = () => seg(n++, 20);
    // the kernel reads nothing: four segments fill the ring, two wait in the FIFO, the rest are lost
    for (let i = 0; i < 4 + NIC_FIFO_SEGS + 3; i++) {
      r.nic.tick();
    }
    expect(r.rd(NIC_REG.RX_HEAD)).toBe(4);
    expect(r.nic.view().fifo).toBe(NIC_FIFO_SEGS);
    expect(r.rd(NIC_REG.STAT_DROP)).toBe(3);
    expect(r.rd(NIC_REG.STATUS) & NicStatus.Dropped).toBe(NicStatus.Dropped);
    r.wr(NIC_REG.STATUS, NicStatus.Dropped); // write 1 to clear it
    expect(r.rd(NIC_REG.STATUS) & NicStatus.Dropped).toBe(0);
    // the kernel frees the ring: what the FIFO held goes in, in order, and the lost ones stay lost
    r.wr(NIC_REG.RX_TAIL, 4);
    r.nic.pull = () => null;
    r.nic.tick();
    r.nic.tick();
    expect(r.rd(NIC_REG.RX_HEAD)).toBe(6);
    expect(r.dv.getUint32(RING_RX + (4 % 4) * NIC_RX_SLOT_BYTES + 4 * NicRx.SEQ, true)).toBe(4);
    expect(r.dv.getUint32(RING_RX + (5 % 4) * NIC_RX_SLOT_BYTES + 4 * NicRx.SEQ, true)).toBe(5);
  });

  it('a packet the kernel put in the transmit ring is read by DMA, sent, and the slot is marked done by DMA', () => {
    const r = ready();
    const at = RING_TX;
    r.dv.setUint32(at + 4 * NicTxSlot.KEY, 77, true);
    r.dv.setUint32(at + 4 * NicTxSlot.NWORDS, 3, true);
    r.dv.setUint32(at + 4 * NicTxSlot.ARG, 0x12_34, true);
    for (let i = 0; i < 3; i++) {
      r.dv.setUint32(at + 4 * (NIC_TX_HEAD_WORDS + i), 0xa0 + i, true);
    }
    r.dv.setUint32(at + 4 * NicTxSlot.STATUS, NicTx.Ready, true);
    r.nic.tick();
    expect(r.sent).toHaveLength(0); // the doorbell has not rung
    r.wr(NIC_REG.TX_TAIL, 1);
    expect(r.rd(NIC_REG.STATUS) & NicStatus.TxBusy).toBe(NicStatus.TxBusy);
    r.nic.tick();
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]?.key).toBe(77);
    expect([...must(r.sent[0]).words]).toStrictEqual([0xa0, 0xa1, 0xa2]);
    expect(r.sent[0]?.arg).toBe(0x12_34);
    expect(r.dv.getUint32(at + 4 * NicTxSlot.STATUS, true)).toBe(NicTx.Done);
    expect(r.rd(NIC_REG.TX_HEAD)).toBe(1);
    expect(r.rd(NIC_REG.STAT_TX)).toBe(1);
    expect(r.lines).toStrictEqual([IRQ.NIC]);
    expect(r.rd(NIC_REG.STATUS) & NicStatus.TxBusy).toBe(0);
  });

  it('a slot that is not marked ready is not sent: the NIC waits for the kernel to finish writing it', () => {
    const r = ready();
    r.wr(NIC_REG.TX_TAIL, 1); // the doorbell, but the slot is blank
    r.nic.tick();
    expect(r.sent).toHaveLength(0);
    expect(r.rd(NIC_REG.TX_HEAD)).toBe(0);
    r.dv.setUint32(RING_TX + 4 * NicTxSlot.NWORDS, 1, true);
    r.dv.setUint32(RING_TX + 4 * NicTxSlot.STATUS, NicTx.Ready, true);
    r.nic.tick();
    expect(r.sent).toHaveLength(1);
  });

  it('without a link it takes nothing in and sends nothing; the FIFO is lost, the ring and the packet wait', () => {
    const r = ready();
    expect(r.nic.accept(seg(0, 2))).toBe(true);
    r.nic.linkUp = false;
    r.nic.flush();
    expect(r.nic.view().fifo).toBe(0);
    expect(r.nic.accept(seg(1, 2))).toBe(false);
    r.dv.setUint32(RING_TX + 4 * NicTxSlot.NWORDS, 1, true);
    r.dv.setUint32(RING_TX + 4 * NicTxSlot.STATUS, NicTx.Ready, true);
    r.wr(NIC_REG.TX_TAIL, 1);
    r.nic.tick();
    expect(r.sent).toHaveLength(0);
    r.nic.linkUp = true;
    r.nic.tick();
    expect(r.sent).toHaveLength(1);
    expect(r.rd(NIC_REG.STATUS) & NicStatus.Link).toBe(NicStatus.Link);
  });

  it('a change of the link raises the line when the kernel asked for it (`LinkIrq`): once for each change, none for the same state', () => {
    const r = ready();
    r.wr(NIC_REG.CTRL, NicCtrl.Enable | NicCtrl.LinkIrq);
    r.nic.linkUp = true; // already up
    expect(r.lines).toStrictEqual([]);
    r.nic.linkUp = false;
    r.nic.linkUp = false;
    expect(r.lines).toStrictEqual([IRQ.NIC]);
    r.nic.linkUp = true;
    expect(r.lines).toStrictEqual([IRQ.NIC, IRQ.NIC]);
    expect(r.nic.view().irqs).toBe(2);
  });

  it('a change of the link raises nothing without `LinkIrq`, or while the NIC is off', () => {
    const r = ready(); // (rx and tx interrupts only)
    r.nic.linkUp = false;
    r.nic.linkUp = true;
    expect(r.lines).toStrictEqual([]);
    const off = bare();
    off.wr(NIC_REG.CTRL, NicCtrl.LinkIrq); // asked for, but not enabled
    off.nic.linkUp = true;
    expect(off.lines).toStrictEqual([]);
  });

  it("the indexes and the counters are the NIC's own: the kernel cannot write them", () => {
    const r = ready();
    r.wr(NIC_REG.RX_HEAD, 9);
    r.wr(NIC_REG.TX_HEAD, 9);
    r.wr(NIC_REG.STAT_RX, 9);
    expect([r.rd(NIC_REG.RX_HEAD), r.rd(NIC_REG.TX_HEAD), r.rd(NIC_REG.STAT_RX)]).toStrictEqual([0, 0, 0]);
  });

  it('a power-on reset empties the registers, the indexes and the FIFO', () => {
    const r = ready();
    r.nic.accept(seg(0, 1));
    r.nic.tick();
    r.nic.reset();
    expect(r.rd(NIC_REG.CTRL)).toBe(0);
    expect(r.rd(NIC_REG.RX_HEAD)).toBe(0);
    expect(r.rd(NIC_REG.STAT_RX)).toBe(0);
    expect(r.nic.view()).toMatchObject({ enabled: false, fifo: 0 });
  });
});

// ---- the NIC with the kernel: a job comes in over the rings, is written to the spool by the driver, runs, and its result goes out by the transmit ring

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;
ECONOMY.lossTable = false; // no segment is lost unless a test asks for it (`wireLoss`) or switches the table on (`lossTable: true`)

const offer = (g: Game, template = 'cli.log', scale = 1): void => {
  g.enqueue({ template, scale, net: true });
};
const kword = (g: Game, k: keyof typeof NICK): number => g.machine.bus.load32(NICA + NICK[k]) >>> 0;
const delivered = (g: Game): number => g.snapshot().net.counters.delivered;
const anyNetJob = (g: Game): boolean => g.kernelJobs().some((j) => j.net);
const netJobIn = (g: Game, state: number): boolean => g.kernelJobs().some((j) => j.net && j.state === state);
const localJobIn = (g: Game, state: number): boolean => g.kernelJobs().some((j) => !j.net && j.state === state);

/** How long to run, and what to do after each tick. */
interface Run {
  max: number;
  after?: () => void;
}

/** Runs `g` a tick at a time while `going()` holds, for at most `max` ticks. */
function advanceWhile(g: Game, going: () => boolean, { max, after }: Run): void {
  for (let i = 0; i < max && going(); i++) {
    g.advanceBaseTick();
    after?.();
  }
}

/** Adds the state of each network job in the kernel's table to `states`. */
function noteNetStates(g: Game, states: Set<number>): void {
  for (const j of g.kernelJobs()) {
    if (j.net) {
      states.add(j.state);
    }
  }
}

/** Runs `g` until it has delivered one more job, for at most `max` ticks, and lists the states its network jobs were seen in. */
function deliverNotingStates(g: Game, max: number): Set<number> {
  const states = new Set<number>();
  const before = delivered(g);
  advanceWhile(g, () => delivered(g) === before, {
    max,
    after: () => {
      noteNetStates(g, states);
    },
  });
  return states;
}

/** Runs `g` until a network job is in the kernel's table, for at most `max` ticks: its key and its flag, or null. */
function firstNetJob(g: Game, max: number): { key: number; net: boolean } | null {
  for (let i = 0; i < max; i++) {
    g.advanceBaseTick();
    const j = g.kernelJobs().find((x) => x.net);
    if (j) {
      return { key: j.key, net: j.net };
    }
  }
  return null;
}

/** Runs `g` until it has delivered one more job, for at most `max` ticks: the NIC's interrupts in the ticks a local program was running, and the most segments it held in its ring then. */
function deliverWatchingLocalRuns(g: Game, max: number): { irqs: number; pending: number } {
  const during = { irqs: 0, pending: 0 };
  const before = delivered(g);
  for (let i = 0; i < max && delivered(g) === before; i++) {
    const running = localJobIn(g, JobState.Running);
    const { irqs } = g.nic.view();
    g.advanceBaseTick();
    if (running) {
      during.irqs += g.nic.view().irqs - irqs;
      during.pending = Math.max(during.pending, g.nic.rxPending);
    }
  }
  return during;
}

describe('the NIC with the kernel', { timeout: 60_000 }, () => {
  it('a network job crosses the rings: segments in by DMA, the driver writes the spool, the result goes out by DMA', () => {
    const g = netRig('ssd1', { economy: { baseDemandPerTick: 0 } });
    expect(g.nic.view()).toMatchObject({ enabled: true, link: true, rxSlots: 4, txSlots: 4 }); // the kernel set the NIC up
    offer(g, 'web.dns', 4);
    const before = delivered(g);
    const states = deliverNotingStates(g, 4000);
    expect(g.snapshot().net.counters.delivered).toBe(before + 1);
    const v = g.nic.view();
    expect(v.rx).toBe(3); // 152 words: three segments of up to 64
    expect(v.tx).toBe(1 + 3); // the result packet, and the kernel's acknowledgement of each of the three segments
    expect(v.dmaWords).toBeGreaterThan(v.rx * NIC_RX_HEAD_WORDS);
    // the kernel's own counters agree with the NIC's
    expect(kword(g, 'GOT')).toBe(v.rx);
    expect(kword(g, 'SENT')).toBe(1);
    expect(kword(g, 'DROPS')).toBe(0);
    // the job went through every state of a network job; its slot is free again and the driver counts none left
    // (Queued is left out: the kernel takes a queued job within a few hundred cycles, which can fall between two ticks)
    for (const s of [JobState.Receiving, JobState.Running, JobState.Result, JobState.Sending]) {
      expect(states.has(s), `state ${s}`).toBe(true);
    }
    advanceWhile(g, () => anyNetJob(g), { max: 30 }); // the next pass of the kernel reclaims the transmit slot and frees the job slot
    expect(g.kernelJobs().filter((j) => j.net)).toHaveLength(0);
    expect(kword(g, 'JOBS')).toBe(0);
  });

  it('the table holds a network job under its key with the top bit set, and the host sees the key without it', () => {
    const g = netRig('ssd1', { economy: { baseDemandPerTick: 0 } });
    offer(g, 'web.dns', 4);
    const seen = firstNetJob(g, 400);
    expect(seen).not.toBeNull();
    expect(NET_KEY & must(seen).key).toBe(0);
    const raw = g.machine.bus.load32(must(g.kernelJobs().find((x) => x.net)).slot * 64 + 0xe0_00 + 4) >>> 0;
    expect((raw & NET_KEY) >>> 0).toBe(NET_KEY);
  });
});

// ---- every kernel tier drives the same NIC: one network job each, in by the ring and out by the ring

type TierOs = 'os1' | 'os2' | 'os3' | 'os4';

/** The machine `tierMachine` builds. */
interface TierSpec {
  os: TierOs;
  cpu: string;
  /** Built on the bigger boards (for two cores or threads) rather than on the starter rig. */
  enthusiast: boolean;
  economy?: Partial<economyTypes.EconomyConfig>;
  keys?: testkitTypes.Keys;
}

/** Buys `id` and fits it, or fails the test. */
function fit(g: Game, id: string): void {
  const b = g.purchase(id);
  if (!b.ok) {
    throw new Error(`purchase ${id}: ${b.reason}`);
  }
  const r = g.install(b.invId);
  if (!r.ok) {
    throw new Error(`install ${id}: ${r.reason}`);
  }
}

/** Takes out every stick of RAM. */
function pullRam(g: Game): void {
  for (const d of g.board.devices.filter((x) => x.spec.startsWith('ram'))) {
    g.uninstall(d.id);
  }
}

/** An enthusiast machine on `os` and `cpu`, with 256K of RAM and an NVMe drive. */
function enthusiastMachine({ os, cpu, economy = {}, keys = [] }: TierSpec): Game {
  const g = new Game({
    seed: 7,
    preassembled: true,
    economy: { ...econ(keys), levelGating: false, caseGating: false, ...economy },
  });
  g.money = 1_000_000;
  g.powerButton();
  for (const id of ['board1', 'board2', 'board3', 'psu2', cpu, 'cooler2', 'rad2']) {
    fit(g, id);
  }
  pullRam(g);
  for (const id of ['ram4', 'nvme2', os]) {
    fit(g, id);
  }
  return g;
}

/** A starter machine on `os` and `cpu`, with 256K of RAM. */
function starterMachine({ os, cpu, economy = {}, keys = [] }: TierSpec): Game {
  const g = rig('ssd1', { cpu, os: false, keys, economy });
  pullRam(g);
  for (const id of ['ram4', os]) {
    fit(g, id);
  }
  return g;
}

/** A machine on `os` and `cpu` with 256K of RAM and the network (a router, a plan, the cable), powered on and run until the link is up. */
function tierMachine(spec: TierSpec): Game {
  const g = spec.enthusiast ? enthusiastMachine(spec) : starterMachine(spec);
  const router = g.purchase('router1');
  if (!router.ok) {
    throw new Error(`purchase router1: ${router.reason}`);
  }
  if (!g.install(router.invId).ok) {
    throw new Error('place router1');
  }
  const isp = g.purchase('isp1');
  if (!isp.ok) {
    throw new Error(`purchase isp1: ${isp.reason}`);
  }
  const c = g.connectCable('lan');
  if (!c.ok) {
    throw new Error(`lan: ${c.reason}`);
  }
  if (!g.powered) {
    g.powerButton();
  }
  advanceWhile(g, () => g.snapshot().net.state !== 'link-up', { max: 6000 });
  return g;
}

/** One kernel tier on one machine, and the NIC interrupts it takes for one network job (OS 1 and OS 2 poll: none). */
interface Tier {
  name: string;
  os: TierOs;
  cpu: string;
  big: boolean;
  irqs: { min: number; max: number };
}

const POLLED = { min: 0, max: 0 },
  // a segment in, a packet sent: at least one line each way
  INTERRUPTED = { min: 3 + 4, max: Number.POSITIVE_INFINITY };

const TIERS: Tier[] = [
  { name: 'OS 1, one core', os: 'os1', cpu: 'cpu2', big: false, irqs: POLLED },
  { name: 'OS 2, one core', os: 'os2', cpu: 'cpu2', big: false, irqs: POLLED },
  { name: 'OS 2, two cores', os: 'os2', cpu: 'cpu2d', big: true, irqs: POLLED },
  { name: 'OS 3, one core', os: 'os3', cpu: 'cpu2', big: false, irqs: INTERRUPTED },
  { name: 'OS 3, two cores', os: 'os3', cpu: 'cpu2d', big: true, irqs: INTERRUPTED },
  { name: 'OS 4, threads', os: 'os4', cpu: 'cpu3t', big: true, irqs: INTERRUPTED },
];

/** Runs `g` until it has delivered one more job, for at most `max` ticks, and checks that it did. */
function deliver(g: Game, max = 8000): void {
  const before = delivered(g);
  advanceWhile(g, () => delivered(g) === before, { max });
  expect(g.snapshot().net.counters.delivered).toBe(before + 1);
}

describe('every kernel tier drives the NIC', { timeout: 300_000 }, () => {
  it.each(TIERS)('$name: a network job is received, run and sent', ({ os, cpu, big, irqs: expected }) => {
    const g = tierMachine({ os, cpu, enthusiast: big });
    expect(g.snapshot().net.state).toBe('link-up');
    expect(g.nic.view()).toMatchObject({ enabled: true, link: true });
    offer(g, 'web.dns', 4);
    const before = delivered(g);
    advanceWhile(g, () => delivered(g) === before, { max: 6000 });
    expect(g.snapshot().net.counters.delivered).toBe(before + 1);
    expect(g.nic.view()).toMatchObject({ rx: 3, tx: 4 });
    expect(kword(g, 'GOT')).toBe(3);
    expect(kword(g, 'SENT')).toBe(1);
    // OS 1 and OS 2 run a job with interrupts off and poll, so the NIC's line never rises; OS 3 and up take it
    const { irqs } = g.nic.view();
    expect(irqs).toBeGreaterThanOrEqual(expected.min);
    expect(irqs).toBeLessThanOrEqual(expected.max);
    // the driver ran for every one of them: no event is left waiting
    advanceWhile(g, () => kword(g, 'EV') !== 0, { max: 40 });
    expect(kword(g, 'EV')).toBe(0);
  });

  it.each(['os2', 'os3'] as const)(
    '%s: while the network is quiet no line is raised and the flag stays clear',
    (os) => {
      const g = tierMachine({ os, cpu: 'cpu2', enthusiast: false });
      for (let i = 0; i < 60; i++) {
        g.advanceBaseTick();
      } // (the first pass of the loop looks at the rings and the link once)
      const { irqs } = g.nic.view(),
        { taken } = g.machine.intc;
      expect(kword(g, 'EV')).toBe(0);
      for (let i = 0; i < 100; i++) {
        g.advanceBaseTick();
      }
      expect(g.nic.view().irqs).toBe(irqs);
      expect(kword(g, 'EV')).toBe(0);
      expect(g.machine.intc.taken).toBe(taken); // nothing runs, so not even the timer fires
    },
  );
});

// ---- the tiers that run the driver, when things go wrong: the same cut cable, power loss and lossy wire. OS 2 runs it by polling; OS 3 and up run it by the flag the handler sets

/** Offers a job to a machine on `tier` and runs it until the job is being received, then cuts the cable. */
function cutWhileReceiving({ os, cpu, big }: Tier): Game {
  const g = tierMachine({ os, cpu, enthusiast: big });
  offer(g, 'web.dns', 4);
  advanceWhile(g, () => !netJobIn(g, JobState.Receiving), { max: 60 });
  expect(netJobIn(g, JobState.Receiving)).toBe(true);
  expect(g.disconnectCable('lan').ok).toBe(true);
  return g;
}

describe('the tiers that run the NIC driver, when things go wrong', { timeout: 300_000 }, () => {
  const tiers = TIERS.filter((t) => t.os !== 'os1');

  it.each(tiers.filter((t) => t.os === 'os2'))(
    '$name: a cut cable drops the link: the driver notices it, and the job comes in whole and is sent on the next link',
    (tier) => {
      const g = cutWhileReceiving(tier);
      // polling: the pass of the loop sees the link go down (LINK word clears); the receive had finished (all segments in), so no receive is left half done
      advanceWhile(g, () => kword(g, 'LINK') !== 0, { max: 200 });
      expect(kword(g, 'LINK')).toBe(0);
      expect(kword(g, 'GOT')).toBe(3);
      expect(netJobIn(g, JobState.Receiving)).toBe(false);
      expect(g.nic.view().irqs).toBe(0); // polling: the NIC's line is never enabled
      expect(g.connectCable('lan').ok).toBe(true);
      deliver(g);
    },
  );

  it.each(tiers.filter((t) => t.os !== 'os2'))(
    '$name: a cut cable drops the link: the driver notices it, and the job comes in whole and is sent on the next link',
    (tier) => {
      const g = cutWhileReceiving(tier);
      advanceWhile(g, () => anyNetJob(g), { max: 60 });
      expect(g.kernelJobs().some((j) => j.net)).toBe(false);
      expect(kword(g, 'JOBS')).toBe(0);
      expect(g.snapshot().net.offers).toHaveLength(1);
      expect(g.connectCable('lan').ok).toBe(true);
      deliver(g);
    },
  );

  it.each(tiers)(
    '$name: a power loss wipes the table; the spooled job is replayed through the ring, runs again and is delivered',
    ({ os, cpu, big }) => {
      const g = tierMachine({ os, cpu, enthusiast: big });
      offer(g, 'web.dns', 4);
      advanceWhile(g, () => !netJobIn(g, JobState.Running), { max: 200 });
      expect(netJobIn(g, JobState.Running)).toBe(true);
      g.powerButton();
      g.powerButton(); // a cold boot: the NIC, the interrupt controller and the table are blank
      deliver(g);
      expect(g.spool).toHaveLength(0);
    },
  );

  it.each(tiers)(
    '$name: jobs one after another, with a quiet spell between: every one is received, run and sent (the driver runs for each one)',
    ({ os, cpu, big }) => {
      const g = tierMachine({ os, cpu, enthusiast: big });
      for (let n = 0; n < 3; n++) {
        offer(g, 'web.dns', 4);
        deliver(g);
        for (let i = 0; i < 120; i++) {
          g.advanceBaseTick();
        } // quiet: the driver is not run
        expect(kword(g, 'EV')).toBe(0);
      }
      expect(kword(g, 'GOT')).toBe(9);
      expect(kword(g, 'SENT')).toBe(3);
      expect(kword(g, 'JOBS')).toBe(0);
    },
  );

  it.each(tiers)(
    '$name: a lossy wire loses segments, the transport sends them again, and the job still comes in whole',
    ({ os, cpu, big }) => {
      const g = tierMachine({ os, cpu, enthusiast: big, economy: { wireLoss: 0.4 } });
      offer(g, 'web.dns', 4);
      deliver(g);
      expect(g.netWire.lost).toBeGreaterThan(0);
      expect(kword(g, 'GOT')).toBe(3);
    },
  );
});

// ---- OS 2 polls: a segment that comes in while a program runs waits in the NIC's ring (the NIC DMAs it, no line is raised) until the program ends and the driver polls

describe('OS 2 polls the NIC while a program runs', { timeout: 120_000 }, () => {
  it("one core: a segment that arrives during a local program's run raises no line and waits in the ring, and the network job still comes in whole once the program ends", () => {
    const g = tierMachine({
      os: 'os2',
      cpu: 'cpu2',
      enthusiast: false,
      economy: { baseDemandPerTick: 0 },
      keys: [{ template: 'cli.log' }],
    });
    const key = must(g.trayKeyIds()[0]);
    expect(g.plugKey(key).ok).toBe(true);
    advanceWhile(g, () => !localJobIn(g, JobState.Running), { max: 40 });
    expect(localJobIn(g, JobState.Running)).toBe(true);
    offer(g, 'web.dns', 4);
    const before = delivered(g);
    const duringRun = deliverWatchingLocalRuns(g, 6000);
    expect(duringRun.irqs).toBe(0);
    expect(duringRun.pending).toBeGreaterThan(0);
    expect(g.snapshot().net.counters.delivered).toBe(before + 1);
    expect(kword(g, 'GOT')).toBe(3);
    expect(kword(g, 'SENT')).toBe(1);
  });
});

// ---- what goes wrong: a full table, a cut cable, a power loss

/** Every slot of the queue holds somebody else's finished job (a USB key's result that waits to be flashed). */
function fillTable(g: Game, state: number): void {
  const slots = must(g.snapshot().os).queueSlots;
  for (let k = 0; k < slots; k++) {
    if (state !== JobState.Free) {
      g.machine.bus.store32(KDATA_BASE + k * KSLOT_BYTES + KSLOT.KEY, 900 + k);
    }
    g.machine.bus.store32(KDATA_BASE + k * KSLOT_BYTES + KSLOT.STATE, state);
  }
}

/** The tick, the wire's counters and the NIC of a lossy network job, run until it is delivered. */
function lossyRun(): { tick: number; wire: Game['netWire']; nic: ReturnType<Game['nic']['view']> } {
  const g = netRig('ssd1', { economy: { baseDemandPerTick: 0, wireLoss: 0.4 } });
  offer(g, 'web.dns', 4);
  const before = delivered(g);
  advanceWhile(g, () => delivered(g) === before, { max: 4000 });
  return { tick: g.baseTick, wire: { ...g.netWire }, nic: g.nic.view() };
}

describe('the NIC and the kernel when things go wrong', { timeout: 120_000 }, () => {
  it('a kernel with no free slot throws the segments away: the sender times out and sends them again, and the job comes in when a slot frees', () => {
    const g = netRig('ssd1', { economy: { baseDemandPerTick: 0 } });
    fillTable(g, JobState.Result);
    offer(g, 'web.dns', 4);
    for (let i = 0; i < 40; i++) {
      g.advanceBaseTick();
    }
    expect(kword(g, 'GOT')).toBe(0);
    expect(kword(g, 'DROPS')).toBeGreaterThanOrEqual(2); // the first send and a resend, thrown away by the driver
    expect(g.kernelJobs().some((j) => j.net)).toBe(false);
    expect(g.snapshot().net.counters.delivered).toBe(0);
    expect(g.netWire.timeouts).toBeGreaterThanOrEqual(1);
    expect(g.netWire.resent).toBeGreaterThanOrEqual(1);
    expect(g.downloads).toHaveLength(1); // still trying
    fillTable(g, JobState.Free); // the slots free up
    const before = delivered(g);
    advanceWhile(g, () => delivered(g) === before, { max: 4000 });
    expect(g.snapshot().net.counters.delivered).toBe(before + 1);
    expect(kword(g, 'GOT')).toBe(3);
  });

  it('a sender that is never answered gives up after its retries: the offer goes back with one more attempt, and the job comes in when the kernel can take it', () => {
    const g = netRig('ssd1', { economy: { baseDemandPerTick: 0 } });
    fillTable(g, JobState.Result);
    offer(g, 'web.dns', 4);
    advanceWhile(g, () => g.netCount.lost === 0, { max: 1500 });
    expect(g.netCount.lost).toBe(1);
    expect(g.downloads.length + g.rx.length).toBe(0);
    expect(g.offersQ.waiting()[0]?.attempts).toBe(2); // a key starts at attempt 1
    expect(g.netWire.resent).toBeGreaterThanOrEqual(8); // the first segment was sent again eight times before the transport gave up
    fillTable(g, JobState.Free);
    const before = delivered(g);
    advanceWhile(g, () => delivered(g) === before, { max: 4000 });
    expect(g.snapshot().net.counters.delivered).toBe(before + 1); // the offer was taken again and came in whole
  });

  it('a lossy wire loses segments, the transport sends them again, and the job still comes in whole', () => {
    const g = netRig('ssd1', { economy: { baseDemandPerTick: 0, wireLoss: 0.4 } });
    offer(g, 'web.dns', 4);
    const before = delivered(g);
    advanceWhile(g, () => delivered(g) === before, { max: 4000 });
    expect(g.snapshot().net.counters.delivered).toBe(before + 1);
    expect(g.netWire.lost).toBeGreaterThan(0);
    expect(g.netWire.resent).toBeGreaterThan(0);
    expect(kword(g, 'GOT')).toBe(3); // the kernel took each segment once, in order
  });

  it('the same game with the same loss runs the same: the same sends, the same resends, the same tick', () => {
    expect(lossyRun()).toStrictEqual(lossyRun());
  });

  it("an old copy of segment 0 does not undo the job's progress: the kernel does not take it, says what it wants, and takes each segment once", () => {
    const g = netRig('ssd1', { economy: { baseDemandPerTick: 0 } });
    offer(g, 'web.dns', 4);
    const key = must(g.offersQ.waiting()[0]);
    g.offersQ.take(key.id); // the host does not download it: this test is the sender
    const words = g.jobWords(key);
    const segOf = (seq: number): nicTypes.NicSegment => ({
      key: key.id,
      seq,
      count: 3,
      total: words.length,
      words: words.subarray(seq * 64, (seq + 1) * 64),
      flags: 0,
    });
    // what a sender's timeouts leave behind: a copy of segment 0 in the ring between segments 1 and 2
    for (const s of [0, 1, 0, 2]) {
      g.wireQ.push({ at: g.baseTick + 1, seg: segOf(s) });
    }
    const states = new Set<number>();
    for (let i = 0; i < 80; i++) {
      g.advanceBaseTick();
      noteNetStates(g, states);
    }
    expect(g.nic.view().rx).toBe(4); // the NIC took all four
    expect(kword(g, 'GOT')).toBe(3); // the kernel took segments 0, 1 and 2 once each
    expect(kword(g, 'DROPS')).toBe(1); // and threw the copy away
    expect(states.has(JobState.Running)).toBe(true); // the job came in whole and ran
  });

  it('with no loss and a roomy ring nothing is resent and nothing is dropped, anywhere', () => {
    const g = netRig('ssd1', { economy: { baseDemandPerTick: 0 } });
    offer(g, 'web.dns', 4);
    const before = delivered(g);
    advanceWhile(g, () => delivered(g) === before, { max: 4000 });
    expect(g.netWire).toStrictEqual({ sent: 3, resent: 0, lost: 0, timeouts: 0 });
    expect(g.nic.view().drops).toBe(0);
    expect(kword(g, 'DROPS')).toBe(0);
  });

  it('a cut cable ends a receive in progress: the driver frees the slot, the job goes back to the offers and comes in whole on the next link', () => {
    const g = netRig('ssd1', { economy: { baseDemandPerTick: 0 } });
    offer(g, 'web.dns', 4);
    advanceWhile(g, () => !netJobIn(g, JobState.Receiving), { max: 40 });
    expect(netJobIn(g, JobState.Receiving)).toBe(true); // some of it is in
    expect(g.disconnectCable('lan').ok).toBe(true);
    for (let i = 0; i < 20; i++) {
      g.advanceBaseTick();
    }
    expect(g.kernelJobs().some((j) => j.net)).toBe(false); // the driver noticed the dead link and gave the slot back
    expect(kword(g, 'JOBS')).toBe(0);
    expect(g.snapshot().net.offers).toHaveLength(1); // the key is back in the offers
    expect(g.connectCable('lan').ok).toBe(true);
    const before = delivered(g);
    advanceWhile(g, () => delivered(g) === before, { max: 4000 });
    expect(g.snapshot().net.counters.delivered).toBe(before + 1);
  });

  it("a power loss wipes the kernel's table: the spooled job is replayed through the NIC, runs again and is delivered", () => {
    const g = netRig('ssd1', { economy: { baseDemandPerTick: 0 } });
    offer(g, 'web.dns', 4);
    advanceWhile(g, () => !netJobIn(g, JobState.Running), { max: 80 });
    expect(netJobIn(g, JobState.Running)).toBe(true);
    expect(g.spool).toHaveLength(1);
    g.powerButton(); // off
    expect(g.spool).toHaveLength(1); // the program is on the drive
    g.powerButton(); // on: a cold boot, the NIC and the table are blank
    expect(g.nic.view()).toMatchObject({ rx: 0, tx: 0 });
    const before = g.snapshot().net.counters.delivered;
    const restoring: boolean[] = [];
    advanceWhile(g, () => delivered(g) === before, {
      max: 6000,
      after: () => {
        restoring.push(g.restores.length > 0);
      },
    });
    expect(restoring).toContain(true); // the spool was replayed
    expect(g.snapshot().net.counters.delivered).toBe(before + 1);
    expect(g.nic.view().rx).toBe(3); // the same three segments, from the spool this time
    expect(g.spool).toHaveLength(0);
  });
});

// ---- the round trip, the loss table and the packet buffer of each chip

/** The kernel's acknowledgement in `p` (a packet with no words), as the segment it wants next and the stamp it answers: none for a result packet. */
function ackOf(p: nicTypes.NicPacket): { next: number; stamp: number }[] {
  return p.words.length === 0 ? [{ next: p.arg & NIC_ACK_NEXT_MASK, stamp: p.arg >>> NIC_STAMP_SHIFT }] : [];
}

/** The segments lost over six jobs on each of three seeds, with the loss table on, on the plan `isp` and the router `router`. */
function lostOver(isp: string, router: string): number {
  let total = 0;
  for (const seed of [1, 2, 3]) {
    const g = netRig('ssd1', { isp, router, seed, economy: { baseDemandPerTick: 0, lossTable: true } });
    for (let k = 0; k < 6; k++) {
      offer(g, 'web.dns', 4);
    }
    for (let i = 0; i < 6000; i++) {
      g.advanceBaseTick();
    }
    total += g.netWire.lost;
  }
  return total;
}

type Flow = NonNullable<ReturnType<Game['snapshot']>['net']['transfers'][number]['flow']>;

/** The window of the download in progress, if there is one. */
function downFlow(g: Game): Flow[] {
  const f = g.snapshot().net.transfers.find((t) => t.dir === 'down')?.flow;
  return f ? [f] : [];
}

describe('the stamp, the round trip, the loss table and the input FIFO', { timeout: 120_000 }, () => {
  it("the kernel's acknowledgement carries the stamp of the segment it answers, with the segment it wants in the low byte", () => {
    const g = netRig('ssd1', { economy: { baseDemandPerTick: 0 } });
    offer(g, 'web.dns', 4);
    const key = must(g.offersQ.waiting()[0]);
    g.offersQ.take(key.id); // the host does not download it: this test is the sender
    const words = g.jobWords(key);
    const segOf = (seq: number, stamp: number): nicTypes.NicSegment => ({
      key: key.id,
      seq,
      count: 3,
      total: words.length,
      words: words.subarray(seq * 64, (seq + 1) * 64),
      flags: (stamp << NIC_STAMP_SHIFT) >>> 0,
    });
    const acks: { next: number; stamp: number }[] = [];
    const wireSend = g.wireSend.bind(g);
    g.wireSend = (p) => {
      acks.push(...ackOf(p));
      wireSend(p);
    };
    for (const [i, s] of [0, 1, 0, 2].entries()) {
      g.wireQ.push({ at: g.baseTick + 1, seg: segOf(s, 0x1_11 * (i + 1)) });
    } // the third is an old copy of segment 0
    for (let i = 0; i < 80; i++) {
      g.advanceBaseTick();
    }
    expect(acks).toStrictEqual([
      { next: 1, stamp: 0x1_11 },
      { next: 2, stamp: 0x2_22 },
      { next: 2, stamp: 0x3_33 },
      { next: 3, stamp: 0x4_44 },
    ]);
  });

  it('the downloads of a link time the round trip together, and the estimate is gone with the link', () => {
    const g = netRig('ssd1', { economy: { baseDemandPerTick: 0 } });
    expect(g.netRtt).toBeNull();
    offer(g, 'web.dns', 4);
    const before = delivered(g);
    advanceWhile(g, () => delivered(g) === before, { max: 4000 });
    expect(g.netRtt?.sampled).toBe(true);
    expect(g.netRtt?.srtt).toBeGreaterThanOrEqual(1);
    expect(g.disconnectCable('lan').ok).toBe(true);
    g.advanceBaseTick();
    expect(g.netRtt).toBeNull();
  });

  it('a download of one segment times its round trip too: the last acknowledgement comes in the tick the host adopts the job', () => {
    const g = netRig('ssd1', { economy: { baseDemandPerTick: 0 } });
    offer(g, 'cli.log', 1); // a program of one segment
    const before = delivered(g);
    advanceWhile(g, () => delivered(g) === before, { max: 4000 });
    expect(g.nic.view().rx).toBe(1);
    expect(g.netRtt?.sampled).toBe(true);
  });

  it('the loss the parts of the link make: the ISP plan, the router and a hot card, combined; the table can be switched off', () => {
    const cheap = netRig('ssd1', { economy: { baseDemandPerTick: 0, lossTable: true } }); // isp1 and router1: 2% each
    expect(cheap.wireLoss()).toBeCloseTo(1 - 0.98 * 0.98, 9);
    const card = netRig('ssd1', {
      port: 'nic1',
      isp: 'isp2',
      router: 'router2',
      economy: { baseDemandPerTick: 0, lossTable: true },
    }); // 0.5% each
    expect(card.wireLoss()).toBeCloseTo(1 - 0.995 * 0.995, 9);
    const st = must(card.thermal.state(must(card.link.port.deviceId)));
    st.errProb = 0.3;
    st.unstable = false;
    expect(card.wireLoss()).toBeCloseTo(1 - 0.995 * 0.995, 9); // a card that is not unstable loses nothing, whatever its error odds
    st.unstable = true;
    expect(card.wireLoss()).toBeCloseTo(1 - 0.995 * 0.995 * 0.7, 9); // an unstable one corrupts segments
    const off = netRig('ssd1', { economy: { baseDemandPerTick: 0, lossTable: false } });
    expect(off.wireLoss()).toBe(0);
    const extra = netRig('ssd1', { economy: { baseDemandPerTick: 0, lossTable: false, wireLoss: 0.1 } });
    expect(extra.wireLoss()).toBeCloseTo(0.1, 9);
    const both = netRig('ssd1', { economy: { baseDemandPerTick: 0, lossTable: true, wireLoss: 0.1 } });
    expect(both.wireLoss()).toBeCloseTo(1 - 0.9 * 0.98 * 0.98, 9);
  });

  it('a better plan and router lose fewer segments over the same jobs', () => {
    expect(lostOver('isp1', 'router1')).toBeGreaterThan(lostOver('isp2', 'router2'));
  });

  it("the snapshot carries the transport and the NIC: the counters, the loss now, the round trip, the buffer and rings, and each download's window", () => {
    const g = netRig('ssd1', { economy: { baseDemandPerTick: 0 } });
    expect(g.snapshot().net.stack).toMatchObject({
      sent: 0,
      resent: 0,
      lost: 0,
      timeouts: 0,
      loss: 0,
      rtt: null,
      nic: {
        enabled: true,
        fifo: 0,
        fifoSegs: 2,
        rxUsed: 0,
        rxSlots: 4,
        txUsed: 0,
        txSlots: 4,
        rx: 0,
        drops: 0,
        irqs: 0,
      },
    });
    // a download that has segments left to send is listed (400 MB of a db job at 50 Mbit: sixty-odd ticks for three segments)
    g.enqueue({ template: 'web.dns', scale: 4, cls: 'db', net: true });
    const flows: Flow[] = [];
    advanceWhile(g, () => delivered(g) === 0, {
      max: 4000,
      after: () => {
        flows.push(...downFlow(g));
      },
    });
    expect(flows.length).toBeGreaterThan(10);
    expect(flows[0]).toMatchObject({ segs: 3, acked: 0, resent: 0, timeouts: 0 });
    expect(flows[0]?.window).toBeGreaterThanOrEqual(2);
    expect(flows.some((f) => f.acked >= 1)).toBe(true); // the kernel's answers come back while the rest is still on the line
    const k = g.snapshot().net.stack;
    expect(k).toMatchObject({ sent: 3, resent: 0, lost: 0, timeouts: 0, nic: { rx: 3, tx: 4, drops: 0 } });
    expect(k.rtt?.srtt).toBeGreaterThanOrEqual(1);
    expect(k.rtt?.rto).toBeGreaterThanOrEqual(3);
    expect(k.nic.dmaWords).toBeGreaterThan(0);
    const lossy = netRig('ssd1', { economy: { baseDemandPerTick: 0, lossTable: true } });
    expect(lossy.snapshot().net.stack.loss).toBeCloseTo(1 - 0.98 * 0.98, 9);
  });

  it("the input FIFO is as deep as the chip the cable is in: the board's jack 2 segments, nic1 4, nic2 8, nic3 16", () => {
    expect([null, 'board', 'nic1', 'nic2', 'nic3'].map((port) => fifoSegsOf(port))).toStrictEqual([2, 2, 4, 8, 16]);
    for (const [port, depth] of [
      [undefined, 2],
      ['nic1', 4],
      ['nic2', 8],
    ] as const) {
      const g = netRig('ssd1', { port, economy: { baseDemandPerTick: 0 } });
      expect(g.nic.view().fifoSegs, `for ${String(port)}`).toBe(depth);
    }
  });
});
