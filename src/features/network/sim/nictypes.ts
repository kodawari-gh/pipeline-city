// NIC types and the smallest chip FIFO depth (docs/NETSTACK.md section 3.1).
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
