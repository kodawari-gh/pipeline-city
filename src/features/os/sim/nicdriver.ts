// The kernel's network driver, in the toy ISA (docs/NETSTACK.md section 3). It sits in every OS tier's main loop and talks to the NIC (`network/sim/nic.ts`) the way a driver does: through the
// registers and two rings in RAM, never through the wire's own state.
//
//   receive   the NIC has DMA'd a segment of a job's program into the next slot of the receive ring. The driver finds the job's slot in the table (or opens one, state Receiving), writes the
//             segment's payload to the job's spool block with `blk_write`, and when the last one is in the job is queued like one that came in on a USB key. A segment that is not the next one the
//             job wants, a copy of one already taken, and a segment that finds no free slot are thrown away (counted): the sender goes back to the segment the acknowledgement names.
//   ack       for each segment of a known job the driver drops a packet with no result words into the transmit ring: the key and the next segment the job wants (a cumulative acknowledgement).
//             With the transmit ring full it sends none: the next one says the same and more. A segment with the abort flag (the sender gave up) frees the job's slot if it is still receiving.
//   transmit  a network job that has finished (state Result, the top bit of its key set) is put into the next transmit slot by the kernel's own stores: the key, the result words, status Ready.
//             Then the doorbell (`TX_TAIL`). The NIC reads the slot by DMA, sends it, and writes status Done back. The next pass reclaims the slot and frees the job's table slot.
//   link      a dead link ends every receive in progress (their slots are freed) and empties the ring: what the NIC had is stale.
//
// How the driver is reached depends on the tier. OS 1 and 2 run a job to the end with interrupts off (OS 1 has no privilege: a handler's stores would hit the memory protection of the job it
// interrupted), so they poll: `knic` runs on each pass of the kernel's loop, between jobs. OS 3 and up run with interrupts on (the timer), so the NIC's line is taken: the handler (`ktimer`, the
// kernel's one interrupt entry) only acknowledges the line and sets the flag `NICK.EV`, and the kernel's own context, the bottom half, runs `knic` when it finds the flag set. The flag is also set when
// a network job ends (a result to send) and once at boot. With no traffic the kernel never runs the driver.
// Calling convention: `knic` (call it with `ra`) keeps s0 (PCH base), s1 (the boot drive's port) and s3 (the OS header) and clobbers a0-a3, t0-t4, s2 and ra.

import {
  JobState, KSLOT, KSLOT_BYTES, NET_KEY, NIC_AREA_END, NIC_BASE, NIC_FLAG_ABORT, NIC_REG, NIC_RX_AT, NIC_RX_HEAD_WORDS, NIC_RX_SLOT_BYTES, NIC_RX_SLOTS, NIC_STAMP_SHIFT, NIC_TX_AT, NIC_TX_HEAD_WORDS, NIC_TX_SLOT_BYTES, NIC_TX_SLOTS,
  NICA, NICK, NicCtrl, NicRx, NicStatus, NicTx, NicTxSlot, OS_HEADER, OS_SPOOL_MAP, PCH_REG, PCH_RESULT_WORDS, PchPhase,
} from "@/core/sim/memmap";

/** What the driver needs from the kernel it is built into. */
export interface NicDriverEnv {
  /** The job table's address. */
  kd: number;
  /** The lines that put the end of the usable job table into `end` (clobbers only `end`), given the table's start in `base`. */
  jtEnd: (end: string, base: string) => string[];
  /** The kernel spools to the drive the block's top byte names (`spool_port`); the resident OS 1 has its own drive only. */
  spoolPort: boolean;
  /** The address of the job sequence counter (the queue order). */
  seqAt: number;
}

const word = (n: number): number => 4 * n;
const nk = (k: keyof typeof NICK): number => NICA + NICK[k];
const hdr = (k: keyof typeof OS_HEADER): number => 4 * OS_HEADER[k];

/** The ring sizes are powers of two: the slot of an index is `index & (slots - 1)`. */
if ((NIC_RX_SLOTS & (NIC_RX_SLOTS - 1)) !== 0 || (NIC_TX_SLOTS & (NIC_TX_SLOTS - 1)) !== 0) throw new Error("NIC rings must have a power of two slots");

/**
 * The lines for `kmain`: clear the driver's area, give the NIC its rings and turn it on. The NIC keeps its indexes across a restart of the kernel, so the kernel's side of each ring starts
 * where the NIC's side is. `irq`: the tier takes the NIC's interrupt: the NIC is switched off first (a line left over from the kernel that ran before is not taken into a half cleared area), it is
 * then switched on with its interrupts, and the flag is set so that the first pass of the loop looks at the rings and the link.
 */
export function nicInit(irq = false): string[] {
  return [
    ...(irq ? [`  li t4, ${NIC_BASE}`, `  sw zero, ${NIC_REG.CTRL}(t4)`] : []),
    `  li t0, ${NICA}`,
    `  li t1, ${NIC_AREA_END}`,
    "nc_zero:",
    "  sw zero, 0(t0)",
    "  addi t0, t0, 4",
    "  bne t0, t1, nc_zero",
    `  li t4, ${NIC_BASE}`,
    `  li t0, ${NIC_RX_AT}`,
    `  sw t0, ${NIC_REG.RX_BASE}(t4)`,
    `  li t0, ${NIC_RX_SLOTS}`,
    `  sw t0, ${NIC_REG.RX_SLOTS}(t4)`,
    `  li t0, ${NIC_TX_AT}`,
    `  sw t0, ${NIC_REG.TX_BASE}(t4)`,
    `  li t0, ${NIC_TX_SLOTS}`,
    `  sw t0, ${NIC_REG.TX_SLOTS}(t4)`,
    `  lw t0, ${NIC_REG.RX_HEAD}(t4)`,
    `  sw t0, ${NIC_REG.RX_TAIL}(t4)`,
    `  lw t0, ${NIC_REG.TX_HEAD}(t4)`,
    `  sw t0, ${NIC_REG.TX_TAIL}(t4)`,
    `  sw t0, ${nk("TXC")}(zero)`,
    ...(irq ? ["  li t0, 1", `  sw t0, ${nk("EV")}(zero)`] : []),
    `  li t0, ${irq ? NicCtrl.Enable | NicCtrl.RxIrq | NicCtrl.TxIrq | NicCtrl.LinkIrq : NicCtrl.Enable}`,
    `  sw t0, ${NIC_REG.CTRL}(t4)`,
  ];
}

/** The `knic` routine: one pass over the NIC's rings. */
export function nicPoll(env: NicDriverEnv): string[] {
  const { kd, jtEnd, spoolPort, seqAt } = env;
  const rxSlot = (out: string, idx: string): string[] => [
    `  andi ${out}, ${idx}, ${NIC_RX_SLOTS - 1}`,
    `  li t3, ${NIC_RX_SLOT_BYTES}`,
    `  mul ${out}, ${out}, t3`,
    `  li t3, ${NIC_RX_AT}`,
    `  add ${out}, ${out}, t3`,
  ];
  const txSlot = (out: string, idx: string): string[] => [
    `  andi ${out}, ${idx}, ${NIC_TX_SLOTS - 1}`,
    `  li t3, ${NIC_TX_SLOT_BYTES}`,
    `  mul ${out}, ${out}, t3`,
    `  li t3, ${NIC_TX_AT}`,
    `  add ${out}, ${out}, t3`,
  ];
  return [
    "knic:",
    "  mv s2, ra",
    `  li t4, ${NIC_BASE}`,
    "nc_rx:", // every turn of the receive loop starts here: a cable pulled in the middle of a ring ends the loop at the next segment
    // ---- the link: when it has just gone down, the receives in progress are lost and the ring is stale
    `  lw t0, ${NIC_REG.STATUS}(t4)`,
    `  andi t0, t0, ${NicStatus.Link}`,
    `  lw t1, ${nk("LINK")}(zero)`,
    `  sw t0, ${nk("LINK")}(zero)`,
    "  bne t0, zero, nc_up",
    "  beq t1, zero, nc_out", // it was down already
    `  li t0, ${kd}`,
    ...jtEnd("t1", "t0"),
    "nc_ab:",
    `  lw t2, ${KSLOT.STATE}(t0)`,
    `  li t3, ${JobState.Receiving}`,
    "  bne t2, t3, nc_abn",
    `  sw zero, ${KSLOT.STATE}(t0)`,
    `  lw t2, ${nk("JOBS")}(zero)`,
    "  addi t2, t2, -1",
    `  sw t2, ${nk("JOBS")}(zero)`,
    "nc_abn:",
    `  addi t0, t0, ${KSLOT_BYTES}`,
    "  bne t0, t1, nc_ab",
    `  lw t0, ${NIC_REG.RX_HEAD}(t4)`,
    `  sw t0, ${NIC_REG.RX_TAIL}(t4)`,
    "  j nc_out",

    // ---- receive: the next segment of the ring
    "nc_up:",
    // ---- give back the transmit slots the NIC has sent (every turn: the acknowledgements below need free slots)
    `  lw t0, ${nk("TXC")}(zero)`,
    `  lw t1, ${NIC_REG.TX_HEAD}(t4)`,
    "nc_rc:",
    "  beq t0, t1, nc_rd",
    ...txSlot("t2", "t0"), // t2 = the slot
    `  lw t3, ${word(NicTxSlot.NWORDS)}(t2)`,
    "  beq t3, zero, nc_rf", // an acknowledgement carries no job
    `  lw a0, ${word(NicTxSlot.ARG)}(t2)`, // the job table slot the result came from
    `  lw t3, ${KSLOT.STATE}(a0)`,
    `  addi t3, t3, ${-JobState.Sending}`,
    "  bne t3, zero, nc_rf",
    `  sw zero, ${KSLOT.STATE}(a0)`, // the NIC has the result: the job's slot is free
    `  lw t3, ${nk("JOBS")}(zero)`,
    "  addi t3, t3, -1",
    `  sw t3, ${nk("JOBS")}(zero)`,
    "nc_rf:",
    `  sw zero, ${word(NicTxSlot.STATUS)}(t2)`,
    "  addi t0, t0, 1",
    "  j nc_rc",
    "nc_rd:",
    `  sw t0, ${nk("TXC")}(zero)`,
    // ---- receive: the next segment of the ring
    `  lw t0, ${NIC_REG.RX_HEAD}(t4)`,
    `  lw t1, ${NIC_REG.RX_TAIL}(t4)`,
    "  beq t0, t1, nc_sp0",
    ...rxSlot("a2", "t1"), // a2 = the slot (header, then the payload)
    `  lw t0, ${word(NicRx.FLAGS)}(a2)`,
    `  andi t0, t0, ${NIC_FLAG_ABORT}`,
    "  bne t0, zero, nc_rst",
    `  lw a0, ${word(NicRx.KEY)}(a2)`,
    `  li t0, ${NET_KEY}`,
    "  or a0, a0, t0",
    "  call find_slot", // a0 = the job's slot, or 0
    "  bne a0, zero, nc_have",
    // the first segment of a job: it needs a free slot, room in the queue and in its spool area
    `  lw t0, ${word(NicRx.SEQ)}(a2)`,
    "  bne t0, zero, nc_drop", // the first segments were lost: the later ones cannot be taken, the sender goes back to the first
    `  li t0, ${kd}`,
    ...jtEnd("t1", "t0"),
    "  li a1, 0", // slots in use
    "  li a0, 0", // the first free one
    "nc_as:",
    `  lw t2, ${KSLOT.STATE}(t0)`,
    "  bne t2, zero, nc_au",
    "  bne a0, zero, nc_an",
    "  mv a0, t0",
    "  j nc_an",
    "nc_au:",
    "  addi a1, a1, 1",
    "nc_an:",
    `  addi t0, t0, ${KSLOT_BYTES}`,
    "  bne t0, t1, nc_as",
    "  beq a0, zero, nc_drop", // no free slot: the segment is lost, the sender sends it again after its timeout
    `  lw t2, ${hdr("QUEUE_SLOTS")}(s3)`,
    "  bge a1, t2, nc_drop", // the queue is at its bound
    `  lw t0, ${word(NicRx.COUNT)}(a2)`,
    `  lw t2, ${hdr("SPOOL_BLOCKS")}(s3)`,
    "  blt t2, t0, nc_drop", // the program is longer than a spool area: this job can never be taken
    "  mv a3, a0",
    `  li t0, ${kd}`,
    "  sub t0, a3, t0",
    "  srli t0, t0, 6",
    "  slli t0, t0, 2",
    "  add t0, t0, s3",
    `  lw t1, ${4 * OS_SPOOL_MAP}(t0)`, // its first spool block (the top byte names the drive)
    `  sw t1, ${KSLOT.LBA}(a3)`,
    `  lw t0, ${word(NicRx.KEY)}(a2)`,
    `  li t1, ${NET_KEY}`,
    "  or t0, t0, t1",
    `  sw t0, ${KSLOT.KEY}(a3)`,
    `  lw t0, ${word(NicRx.TOTAL)}(a2)`,
    `  sw t0, ${KSLOT.LEN}(a3)`,
    `  sw zero, ${KSLOT.RESULT}(a3)`, // the segment it wants next: 0
    `  li t0, ${JobState.Receiving}`,
    `  sw t0, ${KSLOT.STATE}(a3)`,
    `  lw t0, ${nk("JOBS")}(zero)`,
    "  addi t0, t0, 1",
    `  sw t0, ${nk("JOBS")}(zero)`,
    "  j nc_seg",
    "nc_have:",
    "  mv a3, a0",
    `  lw t0, ${KSLOT.STATE}(a3)`,
    `  li t1, ${JobState.Receiving}`,
    "  bne t0, t1, nc_late", // the job is whole already: a late copy of one of its segments
    "nc_seg:",
    `  li t0, ${PchPhase.OsIngest}`,
    `  sw t0, ${PCH_REG.PHASE}(s0)`,
    `  lw t0, ${word(NicRx.SEQ)}(a2)`,
    `  lw t1, ${KSLOT.RESULT}(a3)`,
    "  beq t0, t1, nc_write",
    "  j nc_ooo", // not the segment the job wants (an old copy that waited in the ring, or one that jumped ahead): not taken, and the acknowledgement says which one is. Never a restart: the copies of segment 0 a sender's timeouts leave behind would undo the job's progress
    "nc_write:",
    `  lw a1, ${KSLOT.LBA}(a3)`,
    "  add a1, a1, t0", // the job's spool block of this segment
    `  addi a2, a2, ${word(NIC_RX_HEAD_WORDS)}`, // the payload
    "  mv a0, s1",
    ...(spoolPort ? ["  call spool_port"] : []),
    "  call blk_write",
    `  addi a2, a2, ${-word(NIC_RX_HEAD_WORDS)}`,
    `  lw t0, ${KSLOT.RESULT}(a3)`,
    "  addi t0, t0, 1",
    `  sw t0, ${KSLOT.RESULT}(a3)`,
    `  lw t1, ${nk("GOT")}(zero)`,
    "  addi t1, t1, 1",
    `  sw t1, ${nk("GOT")}(zero)`,
    "  mv a1, t0", // the acknowledgement says which segment the job wants next
    `  lw t1, ${word(NicRx.COUNT)}(a2)`,
    "  bne t0, t1, nc_ack", // more to come: the slot stays Receiving
    // the last segment is in: the job joins the queue
    `  sw zero, ${KSLOT.RESULT}(a3)`,
    `  li t1, ${seqAt}`,
    "  lw t2, 0(t1)",
    "  addi t2, t2, 1",
    "  sw t2, 0(t1)",
    `  sw t2, ${KSLOT.SEQ}(a3)`,
    `  li t2, ${JobState.Queued}`,
    `  sw t2, ${KSLOT.STATE}(a3)`,
    "  j nc_ack",
    "nc_late:", // a copy of a segment of a job the kernel has whole: thrown away, and the acknowledgement says it has all
    `  lw a1, ${word(NicRx.COUNT)}(a2)`,
    "  j nc_dup",
    "nc_ooo:", // a segment the job does not want yet: thrown away, and the acknowledgement says which one it does
    `  lw a1, ${KSLOT.RESULT}(a3)`,
    "nc_dup:",
    `  lw t0, ${nk("DROPS")}(zero)`,
    "  addi t0, t0, 1",
    `  sw t0, ${nk("DROPS")}(zero)`,
    // The acknowledgement (a1 = the next segment wanted, a2 = the slot with the key): a packet with no result words in the next transmit slot, then the doorbell. With the ring full it is not sent:
    // the next one says the same and more.
    "nc_ack:",
    `  lw t0, ${NIC_REG.TX_TAIL}(t4)`,
    `  lw t1, ${nk("TXC")}(zero)`,
    "  sub t2, t0, t1",
    `  li t3, ${NIC_TX_SLOTS}`,
    "  bge t2, t3, nc_skip",
    ...txSlot("t1", "t0"), // t1 = the slot
    `  lw t3, ${word(NicRx.KEY)}(a2)`,
    `  sw t3, ${word(NicTxSlot.KEY)}(t1)`,
    `  sw zero, ${word(NicTxSlot.NWORDS)}(t1)`,
    `  lw t3, ${word(NicRx.FLAGS)}(a2)`, // the segment's stamp (above the flags) goes back in the acknowledgement, with the segment wanted below it
    `  srli t3, t3, ${NIC_STAMP_SHIFT}`,
    `  slli t3, t3, ${NIC_STAMP_SHIFT}`,
    "  or t3, t3, a1",
    `  sw t3, ${word(NicTxSlot.ARG)}(t1)`,
    `  li t3, ${NicTx.Ready}`,
    `  sw t3, ${word(NicTxSlot.STATUS)}(t1)`,
    "  addi t0, t0, 1",
    `  sw t0, ${NIC_REG.TX_TAIL}(t4)`,
    "  j nc_skip",
    "nc_drop:", // a segment the kernel cannot take (no slot, no room, not the start of a job): lost
    `  lw t0, ${nk("DROPS")}(zero)`,
    "  addi t0, t0, 1",
    `  sw t0, ${nk("DROPS")}(zero)`,
    "nc_skip:", // the slot is read: the kernel's index moves on
    `  lw t0, ${NIC_REG.RX_TAIL}(t4)`,
    "  addi t0, t0, 1",
    `  sw t0, ${NIC_REG.RX_TAIL}(t4)`,
    "  j nc_rx",
    "nc_rst:", // the sender gave the transfer up: the job it was sending is not coming, so its slot is free
    `  lw a0, ${word(NicRx.KEY)}(a2)`,
    `  li t0, ${NET_KEY}`,
    "  or a0, a0, t0",
    "  call find_slot",
    "  beq a0, zero, nc_skip",
    `  lw t0, ${KSLOT.STATE}(a0)`,
    `  li t1, ${JobState.Receiving}`,
    "  bne t0, t1, nc_skip",
    `  sw zero, ${KSLOT.STATE}(a0)`,
    `  lw t0, ${nk("JOBS")}(zero)`,
    "  addi t0, t0, -1",
    `  sw t0, ${nk("JOBS")}(zero)`,
    "  j nc_skip",

    // ---- transmit: write the packets of the network jobs that have finished (only while the table holds a network job)
    "nc_sp0:",
    `  lw t1, ${nk("JOBS")}(zero)`,
    "  beq t1, zero, nc_out",
    "nc_sp:",
    `  lw t0, ${NIC_REG.TX_TAIL}(t4)`,
    `  lw t1, ${nk("TXC")}(zero)`,
    "  sub t2, t0, t1", // slots in use
    `  li t3, ${NIC_TX_SLOTS}`,
    "  bge t2, t3, nc_out", // the ring is full: the next pass
    `  li a3, ${kd}`,
    ...jtEnd("a2", "a3"),
    "nc_q:",
    `  lw t2, ${KSLOT.STATE}(a3)`,
    `  li t3, ${JobState.Result}`,
    "  bne t2, t3, nc_qn",
    `  lw t2, ${KSLOT.KEY}(a3)`,
    "  bge t2, zero, nc_qn", // a USB job: its result goes onto the key
    // t0 = the tail. The kernel drops the packet into the slot with plain stores.
    `  andi t1, t0, ${NIC_TX_SLOTS - 1}`,
    `  li t3, ${NIC_TX_SLOT_BYTES}`,
    "  mul t1, t1, t3",
    `  li t3, ${NIC_TX_AT}`,
    "  add t1, t1, t3", // t1 = the slot
    "  slli t2, t2, 1",
    "  srli t2, t2, 1", // the key without the network bit
    `  sw t2, ${word(NicTxSlot.KEY)}(t1)`,
    `  li t3, ${PCH_RESULT_WORDS}`,
    `  sw t3, ${word(NicTxSlot.NWORDS)}(t1)`,
    `  sw a3, ${word(NicTxSlot.ARG)}(t1)`,
    `  addi a0, a3, ${KSLOT.RESULT}`,
    `  addi a1, t1, ${word(NIC_TX_HEAD_WORDS)}`,
    `  addi t3, a0, ${word(PCH_RESULT_WORDS)}`,
    "nc_cp:",
    "  lw t2, 0(a0)",
    "  sw t2, 0(a1)",
    "  addi a0, a0, 4",
    "  addi a1, a1, 4",
    "  bne a0, t3, nc_cp",
    `  li t2, ${NicTx.Ready}`,
    `  sw t2, ${word(NicTxSlot.STATUS)}(t1)`,
    `  li t2, ${JobState.Sending}`,
    `  sw t2, ${KSLOT.STATE}(a3)`,
    `  lw t2, ${nk("SENT")}(zero)`,
    "  addi t2, t2, 1",
    `  sw t2, ${nk("SENT")}(zero)`,
    "  addi t0, t0, 1",
    `  sw t0, ${NIC_REG.TX_TAIL}(t4)`, // the doorbell: the NIC reads the slot
    "  j nc_sp",
    "nc_qn:",
    `  addi a3, a3, ${KSLOT_BYTES}`,
    "  bne a3, a2, nc_q",
    "nc_out:",
    "  jalr zero, s2, 0",
  ];
}
