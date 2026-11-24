// The NIC as a memory-mapped device (docs/NETSTACK.md section 3.1). The game's wire (`network.ts`) hands it segments of a downloaded job and takes the packets it sends; the kernel talks to it
// through the registers and two rings in RAM. Everything between the wire and the kernel happens here, in the NIC's own clock domain, by DMA: the device reads and writes `ram` itself, with no
// CPU instruction and no memory protection (`Bus.guardOn` is off outside a CPU step).
//
//   receive   wire -> input FIFO (a few segments, as a chip has) -> DMA into the next free slot of the RX ring -> head + 1 -> line IRQ.NIC (when `RxIrq` is set)
//             The wire cannot wait: a segment that arrives with the FIFO full (the ring is full and the kernel is slow to empty it) is lost, counted in `STAT_DROP`, and the sender finds out by its timeout.
//   transmit  the kernel fills a TX slot (status Ready) and writes TX_TAIL (the doorbell) -> the NIC reads the slot by DMA, hands the packet to the wire (`onTransmit`), writes status Done back
//             by DMA -> head + 1 -> line IRQ.NIC (when `TxIrq` is set)
//
//   link      the cable, the router or the power makes or breaks the link -> line IRQ.NIC (when `LinkIrq` is set)
//
// The kernel's driver (`os/sim/nicdriver.ts`) takes the line on the tiers that run with interrupts on (OS 3 and up: the handler only notes that the NIC wants service, the kernel's loop runs the
// driver) and polls on the others (OS 1 and 2 run a job to the end with interrupts off). It sets the enables it needs.
// A segment that finds the ring full waits in the FIFO until the kernel frees a slot; the FIFO full, the next one is dropped. (`accept`, the push entry the unit tests use, says no instead.)

import {
  IRQ,
  NIC_BASE,
  NIC_REG,
  NIC_RX_HEAD_WORDS,
  NIC_RX_SLOT_BYTES,
  NIC_SEG_WORDS,
  NIC_SIZE,
  NIC_TX_HEAD_WORDS,
  NIC_TX_SLOT_BYTES,
  NicCtrl,
  NicRx,
  NicStatus,
  NicTx,
  NicTxSlot,
  PCH_RESULT_WORDS,
} from '@/core/sim/memmap';
import type { Rate } from '@/core/sim/hw/clock';
import type { Device } from '@/core/sim/hw/device';

/** A segment of a job's program, as the wire delivers it: which job, which piece of how many, the words, and whether the host replays it from the spool (nothing crossed the wire). */
export interface NicSegment {
  key: number;
  seq: number;
  count: number;
  total: number;
  words: Uint32Array;
  flags: number;
}

/** A packet the NIC sends: the job it answers, the result words the kernel put in the transmit ring (none: an acknowledgement) and the argument (an acknowledgement: the next segment the kernel wants). */
export interface NicPacket {
  key: number;
  words: Uint32Array;
  arg: number;
}

/** Segments the input FIFO holds on the smallest chip (the port on the board): the chip's own packet buffer, small, so the wire feels a slow kernel soon. A card's is deeper (`NIC_FIFO` in `specs.ts`). */
export const NIC_FIFO_SEGS = 2;

/** What the NIC shows from the outside (the views and the tests). */
export interface NicView {
  enabled: boolean;
  link: boolean;
  fifo: number;
  fifoSegs: number;
  rxHead: number;
  rxTail: number;
  rxSlots: number;
  txHead: number;
  txTail: number;
  txSlots: number;
  rx: number;
  drops: number;
  tx: number;
  irqs: number;
  dmaWords: number;
}

export class Nic implements Device {
  readonly name = 'nic';
  readonly base = NIC_BASE;
  readonly size = NIC_SIZE;
  /** Starts stopped; the game sets the rate (`applyRates`). */
  readonly clock: Rate = { mul: 0, div: 1 };

  /** The cable, the router and the power make the link: the game sets it each tick. A NIC without a link sends nothing and takes nothing from the wire. A change raises the line (when `LinkIrq` is set). */
  get linkUp(): boolean {
    return this.link;
  }
  set linkUp(up: boolean) {
    if (up === this.link) return;
    this.link = up;
    if (this.enabled && this.ctrl & NicCtrl.LinkIrq) this.interrupt();
  }
  private link = false;
  /** Where the packets the NIC sends go (the wire). */
  onTransmit: ((p: NicPacket) => void) | null = null;
  /** Where the segments come from: the wire. Each NIC step the input FIFO asks for one while it has room (null: the wire has none for the NIC now). */
  pull: (() => NicSegment | null) | null = null;
  /** The depth of the input FIFO, in segments: a property of the chip the cable is in (the game sets it from the port, `NIC_FIFO`). */
  fifoSegs = NIC_FIFO_SEGS;

  private ctrl = 0;
  private rxBase = 0;
  private rxSlots = 0;
  private rxHead = 0;
  private rxTail = 0;
  private txBase = 0;
  private txSlots = 0;
  private txHead = 0;
  private txTail = 0;
  private statRx = 0;
  private statDrop = 0;
  private statTx = 0;
  private statIrq = 0;
  private dropped = false;
  private dmaWords = 0;
  private fifo: NicSegment[] = [];
  /** The word registers are written a byte at a time (the bus composes a word store from four, low byte first); a register takes effect when its top byte lands. */
  private readonly partial = new Map<number, number>();
  private readonly view32: DataView;

  /** `ram`: the machine's memory, which the DMA engine reads and writes. `raise`: a line to the interrupt controller (`Machine.raise`). */
  constructor(
    private readonly ram: Uint8Array,
    private readonly raise: (line: number) => void,
  ) {
    this.view32 = new DataView(ram.buffer, ram.byteOffset, ram.byteLength);
  }

  /** Power-on reset (and a pulled plug): registers, rings' indexes and the FIFO are gone. The rings' memory is RAM, which is blank at power-on anyway. */
  reset(): void {
    this.ctrl = 0;
    this.rxBase = this.rxSlots = this.rxHead = this.rxTail = this.txBase = this.txSlots = this.txHead = this.txTail = 0;
    this.statRx = this.statDrop = this.statTx = this.statIrq = this.dmaWords = 0;
    this.dropped = false;
    this.fifo = [];
    this.partial.clear();
  }

  get enabled(): boolean {
    return (this.ctrl & NicCtrl.Enable) !== 0 && this.rxSlots > 0;
  }

  /** The wire offers a segment: taken into the FIFO if the NIC runs, the link is up and there is room; false: not now, the wire keeps it and asks again. */
  accept(seg: NicSegment): boolean {
    if (!this.enabled || !this.linkUp || this.fifo.length >= this.fifoSegs) return false;
    this.fifo.push(seg);
    return true;
  }

  /** The wire is cut (the cable is out, the link is gone): what the FIFO held is lost. The rings and the registers stay: the kernel is still there. */
  flush(): void {
    this.fifo = [];
  }

  view(): NicView {
    return {
      enabled: this.enabled,
      link: this.linkUp,
      fifo: this.fifo.length,
      fifoSegs: this.fifoSegs,
      rxHead: this.rxHead,
      rxTail: this.rxTail,
      rxSlots: this.rxSlots,
      txHead: this.txHead,
      txTail: this.txTail,
      txSlots: this.txSlots,
      rx: this.statRx,
      drops: this.statDrop,
      tx: this.statTx,
      irqs: this.statIrq,
      dmaWords: this.dmaWords,
    };
  }

  /** Segments the ring holds that the kernel has not read. */
  get rxPending(): number {
    return (this.rxHead - this.rxTail) >>> 0;
  }

  /** Packets the kernel has queued that the NIC has not sent. */
  get txPending(): number {
    return (this.txTail - this.txHead) >>> 0;
  }

  // ---- the device's clock: one receive and one transmit step a tick

  tick(): void {
    if (!this.enabled) return;
    // a segment arrives from the wire; the FIFO full, it is lost (the wire cannot wait: nothing tells it to)
    if (this.linkUp && this.pull) {
      const seg = this.pull();
      if (seg) {
        if (this.fifo.length < this.fifoSegs) this.fifo.push(seg);
        else this.drop();
      }
    }
    if (this.fifo.length > 0 && this.rxPending < this.rxSlots) this.receive(this.fifo.shift()!);
    if (this.linkUp && this.txSlots > 0 && this.txPending > 0) this.transmit();
  }

  /** A segment found no room: counted, and the sticky `Dropped` bit set. */
  private drop(): void {
    this.statDrop++;
    this.dropped = true;
  }

  /** DMA a segment into the next slot of the receive ring and tell the kernel. */
  private receive(seg: NicSegment): void {
    const at = this.rxBase + (this.rxHead % this.rxSlots) * NIC_RX_SLOT_BYTES;
    const w = (i: number, v: number): void => this.view32.setUint32(at + 4 * i, v >>> 0, true);
    const n = Math.min(seg.words.length, NIC_SEG_WORDS);
    w(NicRx.KEY, seg.key);
    w(NicRx.SEQ, seg.seq);
    w(NicRx.COUNT, seg.count);
    w(NicRx.NWORDS, n);
    w(NicRx.TOTAL, seg.total);
    w(NicRx.FLAGS, seg.flags);
    for (let i = 0; i < NIC_SEG_WORDS; i++) w(NIC_RX_HEAD_WORDS + i, i < n ? seg.words[i]! : 0);
    this.dmaWords += NIC_RX_HEAD_WORDS + NIC_SEG_WORDS;
    this.rxHead = (this.rxHead + 1) >>> 0;
    this.statRx++;
    if (this.ctrl & NicCtrl.RxIrq) this.interrupt();
  }

  /** DMA the next ready packet out of the transmit ring, hand it to the wire and write the slot's status back. */
  private transmit(): void {
    const at = this.txBase + (this.txHead % this.txSlots) * NIC_TX_SLOT_BYTES;
    const r = (i: number): number => this.view32.getUint32(at + 4 * i, true);
    if (r(NicTxSlot.STATUS) !== NicTx.Ready) return; // the doorbell rang before the slot was whole: the kernel's bug, the NIC waits
    const n = Math.min(r(NicTxSlot.NWORDS), PCH_RESULT_WORDS);
    const words = new Uint32Array(n);
    for (let i = 0; i < n; i++) words[i] = r(NIC_TX_HEAD_WORDS + i);
    this.dmaWords += NIC_TX_HEAD_WORDS + n;
    this.onTransmit?.({ key: r(NicTxSlot.KEY), words, arg: r(NicTxSlot.ARG) });
    this.view32.setUint32(at + 4 * NicTxSlot.STATUS, NicTx.Done, true);
    this.txHead = (this.txHead + 1) >>> 0;
    this.statTx++;
    if (this.ctrl & NicCtrl.TxIrq) this.interrupt();
  }

  private interrupt(): void {
    this.statIrq++;
    this.raise(IRQ.NIC);
  }

  // ---- the registers

  private word(reg: number): number {
    switch (reg) {
      case NIC_REG.STATUS:
        return (
          (this.linkUp ? NicStatus.Link : 0) |
          (this.rxPending > 0 ? NicStatus.RxPending : 0) |
          (this.txPending > 0 ? NicStatus.TxBusy : 0) |
          (this.dropped ? NicStatus.Dropped : 0) |
          (this.enabled ? NicStatus.Enabled : 0)
        );
      case NIC_REG.CTRL:
        return this.ctrl;
      case NIC_REG.RX_BASE:
        return this.rxBase;
      case NIC_REG.RX_SLOTS:
        return this.rxSlots;
      case NIC_REG.RX_HEAD:
        return this.rxHead;
      case NIC_REG.RX_TAIL:
        return this.rxTail;
      case NIC_REG.TX_BASE:
        return this.txBase;
      case NIC_REG.TX_SLOTS:
        return this.txSlots;
      case NIC_REG.TX_HEAD:
        return this.txHead;
      case NIC_REG.TX_TAIL:
        return this.txTail;
      case NIC_REG.STAT_RX:
        return this.statRx;
      case NIC_REG.STAT_DROP:
        return this.statDrop;
      case NIC_REG.STAT_TX:
        return this.statTx;
      case NIC_REG.STAT_IRQ:
        return this.statIrq;
      default:
        return 0;
    }
  }

  read(addr: number): number {
    return (this.word(addr & ~3) >>> (8 * (addr & 3))) & 0xff;
  }

  write(addr: number, val: number): void {
    const reg = addr & ~3,
      k = addr & 3;
    // (the status register writes the bits it clears, so a half written one starts from zero, not from what it reads)
    const cur = this.partial.get(reg) ?? (reg === NIC_REG.STATUS ? 0 : this.word(reg));
    const next = ((cur & ~(0xff << (8 * k))) | ((val & 0xff) << (8 * k))) >>> 0;
    if (k !== 3) {
      this.partial.set(reg, next);
      return;
    }
    this.partial.delete(reg);
    switch (reg) {
      case NIC_REG.CTRL:
        this.ctrl = next & (NicCtrl.Enable | NicCtrl.RxIrq | NicCtrl.TxIrq | NicCtrl.LinkIrq);
        break;
      case NIC_REG.RX_BASE:
        this.rxBase = next;
        break;
      case NIC_REG.RX_SLOTS:
        this.rxSlots = next;
        break;
      case NIC_REG.RX_TAIL:
        this.rxTail = next;
        break;
      case NIC_REG.TX_BASE:
        this.txBase = next;
        break;
      case NIC_REG.TX_SLOTS:
        this.txSlots = next;
        break;
      case NIC_REG.TX_TAIL:
        this.txTail = next;
        break;
      case NIC_REG.STATUS:
        if (next & NicStatus.Dropped) this.dropped = false;
        break; // write 1 to the sticky bit to clear it
      default:
        break; // the indexes and the counters the NIC owns are read only
    }
  }
}
