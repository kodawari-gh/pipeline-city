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

export { NIC_FIFO_SEGS, type NicPacket, type NicSegment } from './nictypes';
export { Nic } from './nicdevice';
