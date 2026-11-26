// The NIC device implementation (docs/NETSTACK.md section 3.1). Types live in nictypes.ts.
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
import { NIC_FIFO_SEGS } from './nictypes';
import type * as nicTypes from './nictypes';

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
    if (up === this.link) {
      return;
    }
    this.link = up;
    if (this.enabled && this.ctrl & NicCtrl.LinkIrq) {
      this.interrupt();
    }
  }
  private link = false;
  /** Where the packets the NIC sends go (the wire). */
  onTransmit: ((p: nicTypes.NicPacket) => void) | null = null;
  /** Where the segments come from: the wire. Each NIC step the input FIFO asks for one while it has room (null: the wire has none for the NIC now). */
  pull: (() => nicTypes.NicSegment | null) | null = null;
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
  private fifo: nicTypes.NicSegment[] = [];
  /** Word registers are written a byte at a time; a register takes effect when its top byte lands. */
  private readonly partial = new Map<number, number>();
  private readonly view32: DataView;

  /** `ram`: the machine's memory, which the DMA engine reads and writes. `raise`: a line to the interrupt controller (`Machine.raise`). */
  constructor(
    ram: Uint8Array,
    private readonly raise: (line: number) => void,
  ) {
    this.view32 = new DataView(ram.buffer, ram.byteOffset, ram.byteLength);
  }

  /** Power-on reset (and a pulled plug): registers, rings' indexes and the FIFO are gone. The rings' memory is RAM, which is blank at power-on anyway. */
  reset(): void {
    this.ctrl = 0;
    this.rxBase = 0;
    this.rxSlots = 0;
    this.rxHead = 0;
    this.rxTail = 0;
    this.txBase = 0;
    this.txSlots = 0;
    this.txHead = 0;
    this.txTail = 0;
    this.statRx = 0;
    this.statDrop = 0;
    this.statTx = 0;
    this.statIrq = 0;
    this.dmaWords = 0;
    this.dropped = false;
    this.fifo = [];
    this.partial.clear();
  }

  get enabled(): boolean {
    return (this.ctrl & NicCtrl.Enable) !== 0 && this.rxSlots > 0;
  }

  /** The wire offers a segment: taken into the FIFO if the NIC runs, the link is up and there is room; false: not now, the wire keeps it and asks again. */
  accept(seg: nicTypes.NicSegment): boolean {
    if (!this.enabled || !this.linkUp || this.fifo.length >= this.fifoSegs) {
      return false;
    }
    this.fifo.push(seg);
    return true;
  }

  /** The wire is cut (the cable is out, the link is gone): what the FIFO held is lost. The rings and the registers stay: the kernel is still there. */
  flush(): void {
    this.fifo = [];
  }

  view(): nicTypes.NicView {
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

  tick(): void {
    if (!this.enabled) {
      return;
    }
    // a segment arrives from the wire; the FIFO full, it is lost (the wire cannot wait: nothing tells it to)
    if (this.linkUp && this.pull) {
      const seg = this.pull();
      if (seg) {
        if (this.fifo.length < this.fifoSegs) {
          this.fifo.push(seg);
        } else {
          this.drop();
        }
      }
    }
    if (this.fifo.length > 0 && this.rxPending < this.rxSlots) {
      const next = this.fifo.shift();
      if (next !== undefined) {
        this.receive(next);
      }
    }
    if (this.linkUp && this.txSlots > 0 && this.txPending > 0) {
      this.transmit();
    }
  }

  /** A segment found no room: counted, and the sticky `Dropped` bit set. */
  private drop(): void {
    this.statDrop++;
    this.dropped = true;
  }

  /** DMA a segment into the next slot of the receive ring and tell the kernel. */
  private receive(seg: nicTypes.NicSegment): void {
    const at = this.rxBase + (this.rxHead % this.rxSlots) * NIC_RX_SLOT_BYTES;
    const w = (i: number, v: number): void => {
      this.view32.setUint32(at + 4 * i, v >>> 0, true);
    };
    const n = Math.min(seg.words.length, NIC_SEG_WORDS);
    w(NicRx.KEY, seg.key);
    w(NicRx.SEQ, seg.seq);
    w(NicRx.COUNT, seg.count);
    w(NicRx.NWORDS, n);
    w(NicRx.TOTAL, seg.total);
    w(NicRx.FLAGS, seg.flags);
    for (let i = 0; i < NIC_SEG_WORDS; i++) {
      w(NIC_RX_HEAD_WORDS + i, i < n ? (seg.words[i] ?? 0) : 0);
    }
    this.dmaWords += NIC_RX_HEAD_WORDS + NIC_SEG_WORDS;
    this.rxHead = (this.rxHead + 1) >>> 0;
    this.statRx++;
    if (this.ctrl & NicCtrl.RxIrq) {
      this.interrupt();
    }
  }

  /** DMA the next ready packet out of the transmit ring, hand it to the wire and write the slot's status back. */
  private transmit(): void {
    const at = this.txBase + (this.txHead % this.txSlots) * NIC_TX_SLOT_BYTES;
    const r = (i: number): number => this.view32.getUint32(at + 4 * i, true);
    if (r(NicTxSlot.STATUS) !== NicTx.Ready) {
      return; // the doorbell rang before the slot was whole: the kernel's bug, the NIC waits
    }
    const n = Math.min(r(NicTxSlot.NWORDS), PCH_RESULT_WORDS);
    const words = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      words[i] = r(NIC_TX_HEAD_WORDS + i);
    }
    this.dmaWords += NIC_TX_HEAD_WORDS + n;
    this.onTransmit?.({ key: r(NicTxSlot.KEY), words, arg: r(NicTxSlot.ARG) });
    this.view32.setUint32(at + 4 * NicTxSlot.STATUS, NicTx.Done, true);
    this.txHead = (this.txHead + 1) >>> 0;
    this.statTx++;
    if (this.ctrl & NicCtrl.TxIrq) {
      this.interrupt();
    }
  }

  private interrupt(): void {
    this.statIrq++;
    this.raise(IRQ.NIC);
  }

  private status(): number {
    return (
      (this.linkUp ? NicStatus.Link : 0) |
      (this.rxPending > 0 ? NicStatus.RxPending : 0) |
      (this.txPending > 0 ? NicStatus.TxBusy : 0) |
      (this.dropped ? NicStatus.Dropped : 0) |
      (this.enabled ? NicStatus.Enabled : 0)
    );
  }

  private word(reg: number): number {
    const words: Record<number, () => number> = {
      [NIC_REG.STATUS]: () => this.status(),
      [NIC_REG.CTRL]: () => this.ctrl,
      [NIC_REG.RX_BASE]: () => this.rxBase,
      [NIC_REG.RX_SLOTS]: () => this.rxSlots,
      [NIC_REG.RX_HEAD]: () => this.rxHead,
      [NIC_REG.RX_TAIL]: () => this.rxTail,
      [NIC_REG.TX_BASE]: () => this.txBase,
      [NIC_REG.TX_SLOTS]: () => this.txSlots,
      [NIC_REG.TX_HEAD]: () => this.txHead,
      [NIC_REG.TX_TAIL]: () => this.txTail,
      [NIC_REG.STAT_RX]: () => this.statRx,
      [NIC_REG.STAT_DROP]: () => this.statDrop,
      [NIC_REG.STAT_TX]: () => this.statTx,
      [NIC_REG.STAT_IRQ]: () => this.statIrq,
    };
    return words[reg]?.() ?? 0;
  }

  read(addr: number): number {
    return (this.word(addr & ~3) >>> (8 * (addr & 3))) & 0xff;
  }

  write(addr: number, val: number): void {
    const reg = addr & ~3,
      k = addr & 3;
    const cur = this.partial.get(reg) ?? (reg === NIC_REG.STATUS ? 0 : this.word(reg));
    const next = ((cur & ~(0xff << (8 * k))) | ((val & 0xff) << (8 * k))) >>> 0;
    if (k !== 3) {
      this.partial.set(reg, next);
      return;
    }
    this.partial.delete(reg);
    this.store(reg, next);
  }

  /** A whole register write lands. */
  private store(reg: number, next: number): void {
    if (reg === NIC_REG.CTRL) {
      this.ctrl = next & (NicCtrl.Enable | NicCtrl.RxIrq | NicCtrl.TxIrq | NicCtrl.LinkIrq);
    } else if (reg === NIC_REG.RX_BASE) {
      this.rxBase = next;
    } else if (reg === NIC_REG.RX_SLOTS) {
      this.rxSlots = next;
    } else if (reg === NIC_REG.RX_TAIL) {
      this.rxTail = next;
    } else if (reg === NIC_REG.TX_BASE) {
      this.txBase = next;
    } else if (reg === NIC_REG.TX_SLOTS) {
      this.txSlots = next;
    } else if (reg === NIC_REG.TX_TAIL) {
      this.txTail = next;
    } else if (reg === NIC_REG.STATUS && next & NicStatus.Dropped) {
      this.dropped = false;
    }
  }
}
