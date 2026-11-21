import { describe, expect, it } from "vitest";
import { IRQ, JobState, KDATA_BASE, KSLOT, KSLOT_BYTES, NET_KEY, NIC_REG, NIC_RX_HEAD_WORDS, NIC_RX_SLOT_BYTES, NIC_TX_HEAD_WORDS, NICA, NICK, NicCtrl, NicRx, NicStatus, NicTx, NicTxSlot } from "@/core/sim/memmap";
import { ECONOMY } from "../../economy/sim/economy";
import { Game } from "@/worker/game/game";
import { econ, netRig, rig } from "@/worker/game/testkit";
import { Nic, NIC_FIFO_SEGS, type NicPacket, type NicSegment } from "./nic";

// The NIC as a device, alone: registers, the receive ring and the transmit ring by DMA, the FIFO, the link.

const RING_RX = 0x2000, RING_TX = 0x3000;

function bare(): { nic: Nic; ram: Uint8Array; dv: DataView; lines: number[]; sent: NicPacket[]; wr: (reg: number, v: number) => void; rd: (reg: number) => number } {
  const ram = new Uint8Array(0x10000);
  const dv = new DataView(ram.buffer);
  const lines: number[] = [];
  const nic = new Nic(ram, (l) => lines.push(l));
  const sent: NicPacket[] = [];
  nic.onTransmit = (p) => sent.push(p);
  // the registers are written a byte at a time, low byte first, as the bus does for a word store
  const wr = (reg: number, v: number): void => { for (let k = 0; k < 4; k++) nic.write(reg + k, (v >>> (8 * k)) & 0xff); };
  const rd = (reg: number): number => (nic.read(reg) | (nic.read(reg + 1) << 8) | (nic.read(reg + 2) << 16) | (nic.read(reg + 3) << 24)) >>> 0;
  return { nic, ram, dv, lines, sent, wr, rd };
}

const seg = (seq: number, count: number, n = 3): NicSegment => ({ key: 41, seq, count, total: 100, words: Uint32Array.from({ length: n }, (_, i) => 1000 * seq + i + 1), flags: 0 });

/** The NIC set up the way the kernel does it: both rings, interrupts on, enabled, the link up. */
function ready() {
  const r = bare();
  r.wr(NIC_REG.RX_BASE, RING_RX); r.wr(NIC_REG.RX_SLOTS, 4); r.wr(NIC_REG.TX_BASE, RING_TX); r.wr(NIC_REG.TX_SLOTS, 4);
  r.wr(NIC_REG.CTRL, NicCtrl.Enable | NicCtrl.RxIrq | NicCtrl.TxIrq);
  r.nic.linkUp = true;
  return r;
}

describe("the NIC device", () => {
  it("is off until the kernel gives it a ring and enables it: nothing is taken from the wire", () => {
    const r = bare();
    r.nic.linkUp = true;
    expect(r.nic.accept(seg(0, 1))).toBe(false);
    r.wr(NIC_REG.CTRL, NicCtrl.Enable);
    expect(r.nic.accept(seg(0, 1))).toBe(false); // enabled, but there is no ring
    r.wr(NIC_REG.RX_BASE, RING_RX); r.wr(NIC_REG.RX_SLOTS, 4);
    expect(r.nic.accept(seg(0, 1))).toBe(true);
    expect(r.rd(NIC_REG.STATUS) & NicStatus.Enabled).toBeTruthy();
  });

  it("a received segment is written into the next ring slot by DMA, the head moves and the line goes up", () => {
    const r = ready();
    expect(r.nic.accept(seg(2, 5, 4))).toBe(true);
    expect(r.rd(NIC_REG.RX_HEAD)).toBe(0); // still in the FIFO: nothing in RAM yet
    r.nic.tick();
    expect(r.rd(NIC_REG.RX_HEAD)).toBe(1);
    expect(r.rd(NIC_REG.STAT_RX)).toBe(1);
    expect(r.lines).toEqual([IRQ.NIC]);
    const w = (i: number): number => r.dv.getUint32(RING_RX + 4 * i, true);
    expect([w(NicRx.KEY), w(NicRx.SEQ), w(NicRx.COUNT), w(NicRx.NWORDS), w(NicRx.TOTAL), w(NicRx.FLAGS)]).toEqual([41, 2, 5, 4, 100, 0]);
    expect([w(NIC_RX_HEAD_WORDS), w(NIC_RX_HEAD_WORDS + 3), w(NIC_RX_HEAD_WORDS + 4)]).toEqual([2001, 2004, 0]); // the payload, then zero padding
    expect(r.rd(NIC_REG.STATUS) & NicStatus.RxPending).toBeTruthy();
    r.wr(NIC_REG.RX_TAIL, 1); // the kernel has read it
    expect(r.rd(NIC_REG.STATUS) & NicStatus.RxPending).toBe(0);
  });

  it("the slots fill in order and wrap: slot = index mod slots", () => {
    const r = ready();
    for (let i = 0; i < 6; i++) {
      expect(r.nic.accept(seg(i, 6))).toBe(true);
      r.nic.tick();
      r.wr(NIC_REG.RX_TAIL, i + 1);
    }
    expect(r.rd(NIC_REG.RX_HEAD)).toBe(6);
    // segment 5 went into slot 1, over segment 1
    expect(r.dv.getUint32(RING_RX + 1 * NIC_RX_SLOT_BYTES + 4 * NicRx.SEQ, true)).toBe(5);
    expect(r.dv.getUint32(RING_RX + 0 * NIC_RX_SLOT_BYTES + 4 * NicRx.SEQ, true)).toBe(4);
  });

  it("a full ring keeps the segment in the FIFO; a full FIFO turns the wire away", () => {
    const r = ready();
    for (let i = 0; i < 4; i++) { r.nic.accept(seg(i, 9)); r.nic.tick(); }
    expect(r.nic.rxPending).toBe(4); // the kernel has read nothing
    for (let i = 4; i < 4 + NIC_FIFO_SEGS; i++) expect(r.nic.accept(seg(i, 9))).toBe(true);
    expect(r.nic.accept(seg(9, 9))).toBe(false); // the FIFO is full: the wire waits
    r.nic.tick();
    expect(r.rd(NIC_REG.RX_HEAD)).toBe(4); // the ring is full: nothing moved
    expect(r.nic.view().fifo).toBe(NIC_FIFO_SEGS);
    r.wr(NIC_REG.RX_TAIL, 1); // the kernel frees one slot
    r.nic.tick();
    expect(r.rd(NIC_REG.RX_HEAD)).toBe(5);
    expect(r.nic.view().fifo).toBe(NIC_FIFO_SEGS - 1);
  });

  it("pulls its segments from the wire by itself while the FIFO has room", () => {
    const r = ready();
    let n = 0;
    r.nic.pull = () => (n < 3 ? seg(n++, 3) : null);
    for (let i = 0; i < 6; i++) { r.nic.tick(); r.wr(NIC_REG.RX_TAIL, r.rd(NIC_REG.RX_HEAD)); }
    expect(n).toBe(3);
    expect(r.rd(NIC_REG.STAT_RX)).toBe(3);
  });

  it("a packet the kernel put in the transmit ring is read by DMA, sent, and the slot is marked done by DMA", () => {
    const r = ready();
    const at = RING_TX;
    r.dv.setUint32(at + 4 * NicTxSlot.KEY, 77, true);
    r.dv.setUint32(at + 4 * NicTxSlot.NWORDS, 3, true);
    r.dv.setUint32(at + 4 * NicTxSlot.ARG, 0x1234, true);
    for (let i = 0; i < 3; i++) r.dv.setUint32(at + 4 * (NIC_TX_HEAD_WORDS + i), 0xa0 + i, true);
    r.dv.setUint32(at + 4 * NicTxSlot.STATUS, NicTx.Ready, true);
    r.nic.tick();
    expect(r.sent).toHaveLength(0); // the doorbell has not rung
    r.wr(NIC_REG.TX_TAIL, 1);
    expect(r.rd(NIC_REG.STATUS) & NicStatus.TxBusy).toBeTruthy();
    r.nic.tick();
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.key).toBe(77);
    expect(Array.from(r.sent[0]!.words)).toEqual([0xa0, 0xa1, 0xa2]);
    expect(r.sent[0]!.arg).toBe(0x1234);
    expect(r.dv.getUint32(at + 4 * NicTxSlot.STATUS, true)).toBe(NicTx.Done);
    expect(r.rd(NIC_REG.TX_HEAD)).toBe(1);
    expect(r.rd(NIC_REG.STAT_TX)).toBe(1);
    expect(r.lines).toEqual([IRQ.NIC]);
    expect(r.rd(NIC_REG.STATUS) & NicStatus.TxBusy).toBe(0);
  });

  it("a slot that is not marked ready is not sent: the NIC waits for the kernel to finish writing it", () => {
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

  it("without a link it takes nothing in and sends nothing; the FIFO is lost, the ring and the packet wait", () => {
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
    expect(r.rd(NIC_REG.STATUS) & NicStatus.Link).toBeTruthy();
  });

  it("the indexes and the counters are the NIC's own: the kernel cannot write them", () => {
    const r = ready();
    r.wr(NIC_REG.RX_HEAD, 9); r.wr(NIC_REG.TX_HEAD, 9); r.wr(NIC_REG.STAT_RX, 9);
    expect([r.rd(NIC_REG.RX_HEAD), r.rd(NIC_REG.TX_HEAD), r.rd(NIC_REG.STAT_RX)]).toEqual([0, 0, 0]);
  });

  it("a power-on reset empties the registers, the indexes and the FIFO", () => {
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

const offer = (g: Game, template = "cli.log", scale = 1): void => {
  (g as unknown as { enqueue(t: string, s: number, c: string | undefined, n: boolean): boolean }).enqueue(template, scale, undefined, true);
};
const kword = (g: Game, k: keyof typeof NICK): number => g.machine.bus.load32(NICA + NICK[k]) >>> 0;

describe("the NIC with the kernel", { timeout: 60000 }, () => {
  it("a network job crosses the rings: segments in by DMA, the driver writes the spool, the result goes out by DMA", () => {
    const g = netRig("ssd1", { economy: { baseDemandPerTick: 0 } });
    expect(g.nic.view()).toMatchObject({ enabled: true, link: true, rxSlots: 4, txSlots: 4 }); // the kernel set the NIC up
    offer(g, "web.dns", 4);
    const states = new Set<number>();
    const before = g.snapshot().net.counters.delivered;
    for (let i = 0; i < 4000 && g.snapshot().net.counters.delivered === before; i++) {
      g.advanceBaseTick();
      for (const j of g.kernelJobs()) if (j.net) states.add(j.state);
    }
    expect(g.snapshot().net.counters.delivered).toBe(before + 1);
    const v = g.nic.view();
    expect(v.rx).toBe(3); // 152 words: three segments of up to 64
    expect(v.tx).toBe(1); // one result packet
    expect(v.dmaWords).toBeGreaterThan(v.rx * NIC_RX_HEAD_WORDS);
    // the kernel's own counters agree with the NIC's
    expect(kword(g, "GOT")).toBe(v.rx);
    expect(kword(g, "SENT")).toBe(1);
    expect(kword(g, "DROPS")).toBe(0);
    // the job went through every state of a network job; its slot is free again and the driver counts none left
    for (const s of [JobState.Receiving, JobState.Queued, JobState.Running, JobState.Result, JobState.Sending]) expect(states.has(s), `state ${s}`).toBe(true);
    for (let i = 0; i < 30 && g.kernelJobs().some((j) => j.net); i++) g.advanceBaseTick(); // the next pass of the kernel reclaims the transmit slot and frees the job slot
    expect(g.kernelJobs().filter((j) => j.net)).toHaveLength(0);
    expect(kword(g, "JOBS")).toBe(0);
  });

  it("the table holds a network job under its key with the top bit set, and the host sees the key without it", () => {
    const g = netRig("ssd1", { economy: { baseDemandPerTick: 0 } });
    offer(g, "web.dns", 4);
    let seen: { key: number; net: boolean } | null = null;
    for (let i = 0; i < 400 && !seen; i++) {
      g.advanceBaseTick();
      const j = g.kernelJobs().find((x) => x.net);
      if (j) seen = { key: j.key, net: j.net };
    }
    expect(seen).not.toBeNull();
    expect(NET_KEY & seen!.key).toBe(0);
    const raw = g.machine.bus.load32(g.kernelJobs().find((x) => x.net)!.slot * 64 + 0xe000 + 4) >>> 0;
    expect((raw & NET_KEY) >>> 0).toBe(NET_KEY);
  });
});


// ---- every kernel tier drives the same NIC: one network job each, in by the ring and out by the ring


/** A machine on `os` and `cpu` with 256K of RAM and the network (a router, a plan, the cable), powered on and run until the link is up. */
function tierMachine(os: "os2" | "os3" | "os4", cpu: string, enthusiast: boolean): Game {
  let g: Game;
  if (enthusiast) {
    g = new Game({ seed: 7, preassembled: true, economy: { ...econ([]), levelGating: false, caseGating: false } });
    g.money = 1_000_000;
    g.powerButton();
    for (const id of ["board1", "board2", "board3", "psu2", cpu, "cooler2", "rad2"]) {
      const b = g.purchase(id);
      if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
      const r = g.install(b.invId);
      if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
    }
    for (const d of g.board.devices.filter((x) => x.spec.startsWith("ram"))) g.uninstall(d.id);
    for (const id of ["ram4", "nvme2", os]) {
      const b = g.purchase(id);
      if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
      const r = g.install(b.invId);
      if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
    }
  } else {
    g = rig("ssd1", { cpu, os: false, keys: [] });
    for (const d of g.board.devices.filter((x) => x.spec.startsWith("ram"))) g.uninstall(d.id);
    for (const id of ["ram4", os]) {
      const b = g.purchase(id);
      if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
      const r = g.install(b.invId);
      if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
    }
  }
  for (const id of ["router1", "isp1"]) {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
    if (id !== "isp1" && !g.install((b as { invId: string }).invId).ok) throw new Error(`place ${id}`);
  }
  const c = g.connectCable("lan");
  if (!c.ok) throw new Error(`lan: ${c.reason}`);
  if (!g.powered) g.powerButton();
  for (let i = 0; i < 6000 && g.snapshot().net.state !== "link-up"; i++) g.advanceBaseTick();
  return g;
}

describe("every kernel tier drives the NIC", { timeout: 300000 }, () => {
  const cases: [string, "os2" | "os3" | "os4", string, boolean][] = [
    ["OS 2, one core", "os2", "cpu2", false],
    ["OS 2, two cores", "os2", "cpu2d", true],
    ["OS 3, one core", "os3", "cpu2", false],
    ["OS 3, two cores", "os3", "cpu2d", true],
    ["OS 4, threads", "os4", "cpu3t", true],
  ];
  for (const [name, os, cpu, big] of cases) {
    it(`${name}: a network job is received, run and sent`, () => {
      const g = tierMachine(os, cpu, big);
      expect(g.snapshot().net.state).toBe("link-up");
      expect(g.nic.view()).toMatchObject({ enabled: true, link: true });
      offer(g, "web.dns", 4);
      const before = g.snapshot().net.counters.delivered;
      for (let i = 0; i < 6000 && g.snapshot().net.counters.delivered === before; i++) g.advanceBaseTick();
      expect(g.snapshot().net.counters.delivered).toBe(before + 1);
      expect(g.nic.view()).toMatchObject({ rx: 3, tx: 1 });
      expect(kword(g, "GOT")).toBe(3);
      expect(kword(g, "SENT")).toBe(1);
    });
  }
});

// ---- what goes wrong: a full table, a cut cable, a power loss

describe("the NIC and the kernel when things go wrong", { timeout: 120000 }, () => {
  it("a kernel with no free slot leaves the segment in the ring: nothing is lost, the wire waits, and the job comes in when a slot frees", () => {
    const g = netRig("ssd1", { economy: { baseDemandPerTick: 0 } });
    const bus = g.machine.bus;
    const slots = g.snapshot().os!.queueSlots;
    // every slot of the queue holds somebody else's finished job (a USB key's result that waits to be flashed)
    for (let k = 0; k < slots; k++) {
      bus.store32(KDATA_BASE + k * KSLOT_BYTES + KSLOT.KEY, 900 + k);
      bus.store32(KDATA_BASE + k * KSLOT_BYTES + KSLOT.STATE, JobState.Result);
    }
    offer(g, "web.dns", 4);
    for (let i = 0; i < 40; i++) g.advanceBaseTick();
    expect(g.nic.rxPending).toBeGreaterThanOrEqual(1); // the first segment waits at the head of the ring
    expect(kword(g, "GOT")).toBe(0);
    expect(kword(g, "DROPS")).toBe(0);
    expect(g.kernelJobs().some((j) => j.net)).toBe(false);
    expect(g.snapshot().net.counters.delivered).toBe(0);
    for (let k = 0; k < slots; k++) bus.store32(KDATA_BASE + k * KSLOT_BYTES + KSLOT.STATE, JobState.Free); // the slots free up
    const before = g.snapshot().net.counters.delivered;
    for (let i = 0; i < 4000 && g.snapshot().net.counters.delivered === before; i++) g.advanceBaseTick();
    expect(g.snapshot().net.counters.delivered).toBe(before + 1);
    expect(kword(g, "GOT")).toBe(3);
  });

  it("a cut cable ends a receive in progress: the driver frees the slot, the job goes back to the offers and comes in whole on the next link", () => {
    const g = netRig("ssd1", { economy: { baseDemandPerTick: 0 } });
    offer(g, "web.dns", 4);
    for (let i = 0; i < 40 && !g.kernelJobs().some((j) => j.net && j.state === JobState.Receiving); i++) g.advanceBaseTick();
    expect(g.kernelJobs().some((j) => j.net && j.state === JobState.Receiving)).toBe(true); // some of it is in
    expect(g.disconnectCable("lan").ok).toBe(true);
    for (let i = 0; i < 20; i++) g.advanceBaseTick();
    expect(g.kernelJobs().some((j) => j.net)).toBe(false); // the driver noticed the dead link and gave the slot back
    expect(kword(g, "JOBS")).toBe(0);
    expect(g.snapshot().net.offers).toHaveLength(1); // the key is back in the offers
    expect(g.connectCable("lan").ok).toBe(true);
    const before = g.snapshot().net.counters.delivered;
    for (let i = 0; i < 4000 && g.snapshot().net.counters.delivered === before; i++) g.advanceBaseTick();
    expect(g.snapshot().net.counters.delivered).toBe(before + 1);
  });

  it("a power loss wipes the kernel's table: the spooled job is replayed through the NIC, runs again and is delivered", () => {
    const g = netRig("ssd1", { economy: { baseDemandPerTick: 0 } });
    offer(g, "web.dns", 4);
    for (let i = 0; i < 80 && !g.kernelJobs().some((j) => j.net && j.state === JobState.Running); i++) g.advanceBaseTick();
    expect(g.kernelJobs().some((j) => j.net && j.state === JobState.Running)).toBe(true);
    expect(g.spool).toHaveLength(1);
    g.powerButton(); // off
    expect(g.spool).toHaveLength(1); // the program is on the drive
    g.powerButton(); // on: a cold boot, the NIC and the table are blank
    expect(g.nic.view()).toMatchObject({ rx: 0, tx: 0 });
    const before = g.snapshot().net.counters.delivered;
    let replayed = false;
    for (let i = 0; i < 6000 && g.snapshot().net.counters.delivered === before; i++) {
      g.advanceBaseTick();
      if (g.restores.length > 0) replayed = true;
    }
    expect(replayed).toBe(true);
    expect(g.snapshot().net.counters.delivered).toBe(before + 1);
    expect(g.nic.view().rx).toBe(3); // the same three segments, from the spool this time
    expect(g.spool).toHaveLength(0);
  });
});
