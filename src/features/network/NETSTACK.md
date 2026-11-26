# Network stack v2: interrupts, DMA and a simplified TCP

Status: **designed, stages 1 and 2 built.** Stage 1 is the CPU taking interrupts ([`CPU.md`](CPU.md) section 4). Stage 2 is the NIC with its rings in RAM and the kernel's driver, still without loss (section 3.6). Stages 3 to 5 are not built. This document is the design for replacing the timing-only network of [`NETWORK.md`](NETWORK.md) ("Built") with one the machine takes part in. Everything not marked built is a proposal; all numbers are placeholders for the balance pass.

## 1. Why change it

What exists (see `NETWORK.md` "Built", `Game.runTransfers` and `Game.feedKernel`):

- A download is a counter: `doneMB += downMbps / 8 / downloads` per base tick. When it reaches the job's size the job is "downloaded".
- The game then plugged a **virtual USB key** into the PCH with zero enumerate and flash waits, and the real kernel ingested it exactly as it would a key. The result was read out of the kernel's job table and uploaded the same way. (Stage 2 replaced this: section 3.6.)
- So the line, the router and the ISP decide _when_ a job arrives, and the machine decides nothing about _how_. A slow CPU, a busy job or a small RAM do not touch the network, and the network cannot fail: no loss, no retry.

What the owner wants to work towards: a stack where the packet path through the machine is visible and costs something. A NIC receives, the CPU is interrupted and loads the payload, packets can be lost and are resent. This is the design for that, built in steps that each keep the game playable.

## 2. The path of a received job

```text
remote server ──wire──▶ ISP ──▶ router ──▶ cable ──▶ NIC ──▶ RX ring (RAM) ──▶ interrupt ──▶ CPU handler ──▶ kernel ──▶ spool ──▶ queue
   (segments, loss, ACKs: the transport)        (bandwidth, loss)   (DMA or CPU copy)   (CPU.md)          (top half)     (bottom half)   (as today)
```

Step by step, and **who does each step**:

| #   | Step                                                                                                                                                                                                    | Done by                   | Costs                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------- |
| 1   | The server sends the job as a series of **segments**. The line limits how many bytes per tick; a segment can be lost on the way                                                                         | transport (game layer)    | time, bandwidth                                                   |
| 2   | A segment reaches the NIC. If the NIC's **RX ring** in RAM has no free slot, the NIC drops it                                                                                                           | NIC (device)              | a drop, a retransmit later                                        |
| 3   | The NIC writes the segment into the ring. A **DMA** NIC does it itself; a **PIO** NIC leaves it in its own window for the CPU to copy                                                                   | NIC / CPU                 | none / CPU cycles                                                 |
| 4   | The NIC **raises the NIC line**. A coalescing NIC raises it once per several segments or after a short timer                                                                                            | NIC                       |                                                                   |
| 5   | The CPU is interrupted: it drains its pipeline, jumps to the handler (the **top half**): save registers, read the ring head, acknowledge the line, mark work for the kernel, restore, `iret`            | CPU, real instructions    | pipeline drain + handler cycles, stolen from whatever was running |
| 6   | The kernel loop (the **bottom half**, between programs as today) sees the work flag, takes the finished segments off the ring, and when the last segment of a job is in, ingests the job into the spool | kernel, real instructions | CPU and disk time, as today's ingest                              |
| 7   | The NIC acknowledges to the sender. Cumulative ACKs are the NIC's hardware, not the CPU's                                                                                                               | NIC / transport           |                                                                   |

Uploading is the mirror: the kernel writes the result into a **TX ring**, tells the NIC, the NIC sends segments, ACKs come back, and the NIC raises an interrupt when the whole result has been sent so the kernel can free the job's spool slot.

A game MB is a **time unit**, not data the CPU touches. The real bytes are the job's program and result (tens to hundreds of words). They are split over the job's segments, so the CPU work per segment is a slice of the real words plus the fixed cost of the handler. A 3000 MB job is slow on a thin line, not expensive to copy.

## 3. Pieces

### 3.1 The NIC device

A memory-mapped device in its own clock domain (so it raises interrupts at CPU-cycle granularity: `CPU.md` "Using it from a device"). **As built, section 3.6 replaces this table**: one device bound to the uplink port, a different register set, and the ring slots are fixed-size. The proposal, for the record (offsets from a `NIC_BASE`):

| Reg                             | Meaning                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `STATUS`                        | link up, rx work waiting, tx busy, overflow seen                              |
| `RX_BASE`, `RX_SLOTS`           | the ring in RAM the kernel set up                                             |
| `RX_HEAD` (ro) / `RX_TAIL` (rw) | the NIC's write index / the kernel's read index. Full when `head + 1 == tail` |
| `RX_WINDOW`                     | PIO tiers only: the segment sits here until the CPU reads it                  |
| `TX_BASE`, `TX_LEN`, `TX_GO`    | the result to send                                                            |
| `IRQ_CTRL`                      | enable, coalescing count and timer                                            |
| `STATS`                         | segments received, dropped on a full ring, interrupts raised                  |

A ring slot is a descriptor: job id, segment number, segment count, the words that belong to it. The kernel reserves the ring in RAM at boot (a new region beside the job table). **Ring size is RAM**: the 16K starter machine can afford few slots, which is part of why it drops.

### 3.2 NIC tiers (the CPU-cost ladder)

| Part                              | Receive                                                         | Interrupts                                           | Notes                                                      |
| --------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| Onboard jack (Basic board and up) | **PIO**: the CPU reads the segment from the window word by word | one per segment                                      | the network is free and visibly expensive: it eats the CPU |
| `nic1`                            | **DMA** into the ring                                           | one per segment                                      | the handler only moves indexes                             |
| `nic2`                            | DMA                                                             | **coalesced**: one per 4 segments or a short timeout | fewer drains, less stolen time, more latency               |
| `nic3`                            | DMA                                                             | coalesced, **checksum offload**                      | the segment check the kernel would do is gone              |

The existing NIC specs (`nic1..3`, 1000 / 10000 / 40000 Mbit) keep their bandwidth, price and thermal numbers; this adds the CPU-side behaviour. Whether the onboard jack should really be PIO is an open decision (section 9).

**As built (stage 4).** The tiers differ in one thing: the **input FIFO**, the packets the chip holds while the kernel has no ring slot free. The onboard jack holds 2 segments, `nic1` 4, `nic2` 8, `nic3` 16 (`NIC_FIFO`, `fifoSegsOf` in `network/sim/specs.ts`; `netTick` sets the depth of the chip the cable is in). A segment that finds it full is dropped and counted (section 3.7), so a deeper chip rides out a longer spell of a busy kernel, and the player sees it as fewer resends on the busy OS tiers. Not built, and why: _PIO on the onboard jack_ (the lesson of a free network that costs CPU is real, but the first network lesson at level 4 runs on the weakest machine: section 9 point 2 keeps the DMA jack); _interrupt coalescing_ (OS 3 and up take one interrupt for each segment and each packet; coalescing is a later step); _checksum offload_ (segments carry no checksum, so there is no check for the kernel to do or to skip).

### 3.3 Segments

A transfer is cut into segments: `segMB = max(0.5, sizeMB / 128)`, so a job is at most 128 segments (24 MB: 48; 3000 MB: 128). Anything finer costs simulation time without teaching anything. The line moves `bandwidth / 8` MB per tick shared by all active transfers, as today; a tick moves a whole number of segments (the remainder carries over).

_Built differently (section 3.6, 3.7): a segment is one 64-word block of the job's program (a job is 1 to 11 segments), and it costs `downMB / segments` of line time. The remainder still carries over: the flow keeps the line time it has earned (its credit)._

### 3.4 The transport (a simplified TCP, in the game layer)

**Built in stage 3** (section 3.7): `src/features/network/sim/transport.ts`, a pure, seeded, unit-tested module with no dependence on the CPU. The text below is the design; the numbers that differ are in 3.7. Per transfer:

- **Sequence numbers** and a **cumulative ACK**: the receiver's `next expected`. A segment that arrives out of order is kept by the NIC only if the ring has room; otherwise it counts as lost. _(As built: the receiver takes segments in order only, so an out-of-order one is dropped and the kernel acknowledges the segment it wants again: go-back-N, no selective ACK.)_
- A **congestion window** `cwnd` (segments in flight) and `ssthresh`. A transfer **starts at the window that fills the line** (the bandwidth-delay product), so with no loss the time is the same as today (section 8). A loss halves `cwnd` (multiplicative decrease); each fully acknowledged round trip adds one (additive increase) until it is back at the line's window.
- A **round-trip time** in ticks (at least 1; the ISP plan adds more on the slow tiers) and a **retransmission timeout** of `max(3, 3 x rtt)` ticks for a segment that is not acknowledged. A timeout resends that segment; the sender counts retransmissions per segment. _(As built: the round trip is measured and the timeout follows it, RFC 6298 with a timestamp echo, section 3.7. The plan adds no round trip yet.)_
- **Give up**: a segment resent more than `MAX_RETRIES` (placeholder 8) times fails the transfer. The offer goes back to the list with `attempts + 1`, as a power loss does today.
- **Loss is rolled statelessly**: `lossRoll(gameSeed, transferId, seq, attempt)` is a hash to [0,1), compared with the segment's loss probability. No PRNG state to save or to keep in step with other draws, so determinism does not depend on event order, and "same save and seed, same run" holds.

Transfers are still **never saved** (`NETWORK.md` "Save"). A loaded game's offers restart; the ring is RAM and is empty after a boot.

### 3.5 Where loss comes from

A segment's loss probability is the combination `1 - (1 - a)(1 - b)(1 - c)...` of:

| Source                                                                                                                             | Why it is a gameplay lever                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The wire: ISP plan and router tier (placeholder: `isp1` / `router1` 2% each, `isp2` / `router2` 0.5%, higher tiers 0.1%)           | the cheap plan is lossy; buying up is a reason beyond bandwidth                                                                                                                                                         |
| A hot or throttled NIC card, a burnt cable                                                                                         | cooling matters for the network                                                                                                                                                                                         |
| **A full RX ring**                                                                                                                 | **the machine's own doing**: a slow CPU, a long-running job holding the CPU, a big handler or too little RAM for the ring makes the NIC drop. This is not a random number: it follows from the CPU/RAM the player built |
| Overload: more active transfers than `clients` is impossible (admission), but offered load above the router's capacity raises loss | a small router with a fast ISP drops                                                                                                                                                                                    |

The ring-overflow case is the point of the exercise: the line can be 1000 Mbit and the machine a starter box, and the transfer still limps because the CPU cannot empty the ring. A faster CPU (or DMA, or coalescing) is then the fix, not more bandwidth.

**As built (stage 4).** `Game.wireLoss()` (`network.ts`) is `1 - (1 - extra)(1 - plan)(1 - router)(1 - card)`:

| Source              | Built as                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ISP plan            | `IspSpec.loss`: `isp1` 2%, `isp2` 0.5%, `isp3` to `isp5` 0.1%                                                                                                                                                                                                                              |
| Router              | `RouterSpec.loss`: `router1` 2%, `router2` 0.5%, `router3` and `router4` 0.1%                                                                                                                                                                                                              |
| Hot NIC card        | the cabled card's thermal state: while it is `unstable` (above its unstable mark) its `errProb` (1% + 2% per degree, at most 50%); below that, nothing. Above the throttle mark the card already runs at half speed in `portInfo`. The onboard jack has no thermal state and loses nothing |
| Extra               | `ECONOMY.wireLoss` (0 by default): the tests use it for a lossy wire                                                                                                                                                                                                                       |
| Full RX ring / FIFO | not a number: the NIC drops a segment that finds its FIFO full and the driver one it has no slot, queue room or spool room for (sections 3.2 and 3.7)                                                                                                                                      |

`ECONOMY.lossTable` (default true) switches the first three off; the tests that pin a transfer to the tick set it to false. `runFlow` reads the loss every tick, so a card that heats up loses segments from that tick on. _Not built:_ a burnt cable (the cable is not a part that wears), router overload (admission already caps the clients at the router's `clients`, and the line is shared by them, so there is no offered load above capacity to drop), a round trip that depends on the plan.

### 3.6 As built (stage 2)

Code: `src/features/network/sim/nic.ts` (the device), `src/features/os/sim/nicdriver.ts` (the kernel's driver, toy-ISA asm inside every kernel image), the wire's side in `network.ts` (`wirePull`, `wireSend`, `adoptReceived`, `feedKernel`), constants in `src/core/sim/memmap.ts`, tests in `nic.test.ts` and `nicdriver.test.ts`.

- **Device.** One `Nic` at `NIC_BASE` (0x4017_0000), clocked like the other devices. Registers: `STATUS` (link, rx pending, tx busy, dropped, enabled), `CTRL` (enable, rx irq, tx irq; reset 0, so nothing reaches RAM before the kernel is ready), `RX_BASE` / `RX_SLOTS`, `RX_HEAD` (ro) / `RX_TAIL`, `TX_BASE` / `TX_SLOTS`, `TX_HEAD` (ro) / `TX_TAIL` (the doorbell) and four counters (segments in, drops, packets out, interrupts). The indexes run free; a slot is `index & (slots - 1)`. Word registers are written a byte at a time (the bus composes a word store from four, low byte first) and take effect when the top byte lands.
- **Segment.** One spool block of the program, 64 words (`NIC_SEG_WORDS`): a job of 24 to 641 words is 1 to 11 segments. This replaces the `segMB` idea of section 3.3 for the data the machine touches; the megabytes of a job still only set the time on the wire, and a segment is released to the NIC as the downloaded bytes cover it.
- **Receive.** `wirePull` offers the next due segment to the NIC (one per NIC step, into an input FIFO of 2 to 16 segments by chip, section 3.2; `NIC_FIFO_SEGS` is the smallest). The NIC DMAs it into the next free slot of the RX ring (4 slots of 280 bytes: a header of key, segment number, segment count, words, total and flags, then the payload) and moves `RX_HEAD`. A full ring keeps the segment in the FIFO. _(Stage 2: a full FIFO made the wire wait. Stage 3: the wire cannot wait, a segment that finds the FIFO full is dropped and counted, section 3.7.)_ The NIC writes `ram` itself, with no CPU and no protection.
- **Driver.** OS 1 and 2 poll (`knic`, once a pass of the loop between jobs: they run a job with interrupts off). OS 3 and up take the interrupt (see "The interrupt", below: the handler sets a flag, the kernel's loop runs `knic`). It takes a segment off the ring, finds or opens the job's slot in its table (state receiving, key with `NET_KEY`), writes the payload to the job's spool block with `blk_write` and, after the last, queues the job. In-order only. _(Stage 2: with no free slot the segment stayed in the ring and held up the ones behind it. Stage 3: it is dropped, and the sender's timeout sends it again, section 3.7.)_ It reads the link bit before every segment: a dead link frees the receiving slots and empties the ring.
- **Transmit.** A finished network job is posted by the kernel's own stores into the TX ring (4 slots of 48 bytes: status, key, words, argument, then the 8 result words), then `TX_TAIL`. The NIC DMAs it out, hands it to the wire (`wireSend`: an upload that waits for a client slot) and writes `Done` back; the kernel reclaims the slot and frees the job's table slot. A slot with no result words is an acknowledgement (stage 3 sends one for each segment it takes; its argument is the segment the kernel wants in the low byte and the segment's stamp above it, section 3.7).
- **RAM.** The area (`NICA`, 0xDA00, just under the job table) holds the kernel's words (`NICK`: reclaim index, last link, network jobs in the table, segments taken, drops, results sent) and both rings, inside the range the OS protects from the jobs. Every kernel image grew by about 255 words; a test keeps each image under `NICA`.
- **Host.** A download is whole when every byte has crossed the wire and the NIC has taken every segment; it waits in the receive window until the kernel has the job queued whole (`adoptReceived` moves it to the spool, before any cut of the link is handled). A cut link, a power loss or a reboot returns the unfinished downloads to the offers, flushes the FIFO and, after the next boot, `feedKernel` replays the spooled jobs the kernel does not know through the NIC (flag `NIC_FLAG_REPLAY`, nothing crosses the wire). The virtual USB key and, with it, `NetSnap.portBusyKey` are gone: a real key in the port no longer holds up the network.
- **Not built in stage 2.** The onboard jack is not PIO (every port is a DMA NIC, section 9 point 2), the NIC tiers do not differ yet (3.2), there is no interrupt handler in the kernel, no loss and no retransmission (stage 3, next section), no UI for rings and counters (stage 5).

### 3.7 As built (stage 3: the transport)

Code: `src/features/network/sim/transport.ts` (`Flow`, `lossRoll`, `TRANSPORT`), the wire in `network.ts` (`runFlow`, `deliverAcks`, `giveUp`, `wirePull`, `wireSend`, `adoptReceived`), the driver in `nicdriver.ts`. Tests: `transport.test.ts` (the flow alone, and against a model receiver), `nic.test.ts` ("when things go wrong": a full table, a deaf kernel, a lossy wire, the same run twice).

- **The flow.** One `Flow` for each download (and each replay). `step(now, shareMB)` returns the segments to put on the wire this tick, `ack(now, next)` takes an acknowledgement. The flow earns line time from its share of the bandwidth and spends it on segments, so with no loss and a roomy window a segment leaves on the tick the old rule `floor(segs x done / total)` gave (a test pins this). A flow with every segment sent holds no client slot while it waits for the last acknowledgements (`activeTransfers`), which keeps the pacing of stage 2.
- **The window.** The first window is what the line moves in one round trip (`NET.rttTicks`, 1 tick), at least 2 and at most `cwndMax` (64). It grows by one for each acknowledged segment below `ssthresh` (slow start), then by `1 / cwnd` (about one a round trip). A timeout sets `ssthresh = max(2, floor(cwnd / 2))` and `cwnd = 1`.
- **The round trip.** Every segment carries a stamp: the sender's clock, 24 bits of ticks, in the high bits of the header's flags word (`NIC_STAMP_SHIFT`; a TCP timestamp option, RFC 7323). The driver copies the stamp of the segment it answers into the acknowledgement's argument, above the segment it wants (`NIC_ACK_NEXT_MASK` is the low byte). The sender takes `now - stamp` as a round-trip sample from every acknowledgement that makes progress, so a segment that went twice is timed by the copy the kernel really answered (without the echo, Karn's rule would drop exactly those samples, and a flow against a slow kernel would never learn how slow it is). The sample includes the NIC's FIFO and ring wait and the kernel's turn to poll: a kernel that runs a job on OS 1 or 2 shows it as a long round trip. `deliverAcks` runs before the host adopts a job, so the last acknowledgement of a download one segment long still counts.
- **The estimate.** `RttEstimate` (`transport.ts`): the smoothed round trip `srtt` and its mean deviation `rttvar` (RFC 6298: the first sample sets `srtt = r`, `rttvar = r / 2`, later ones move them by 1/8 and 1/4). The downloads of a link **share one** (`Game.netRtt`, made by the first download, gone with the link in `loseTransfers`): a job of one segment has no time to learn the round trip alone. A replay keeps its own, since nothing crosses the wire.
- **The timeout.** `rto = min(96, max(3, est) x backoff)` ticks, where `est` is `ceil(3 x srtt)` until the first sample and `ceil(srtt + 4 x rttvar)` after it. Each timeout doubles `backoff` (3, 6, 12, 24, 48, 96 ticks); an acknowledgement that makes progress resets it. **A timeout sends only the first unacknowledged segment again**: the segments behind it are most likely in the receiver's ring and are acknowledged in their turn (no rewind: the flow does not send them twice). The window restarts from 1 and `ssthresh` halves. Not built: fast retransmit on three duplicate acknowledgements (a window is 2 to 11 segments, and one with a lost head and three more behind it is rare), selective acknowledgement, delayed acknowledgements.
- **Give up.** A segment that has been sent `1 + maxRetries` (9) times and is still not acknowledged fails the flow. `giveUp` returns the offer (`attempts + 1`, as a power loss does), counts it in `netCount.lost`, writes a note, and puts a reset segment (`NIC_FLAG_ABORT`) on the wire: the kernel frees the slot and the spool blocks it holds for that key.
- **Wire loss.** `lossRoll(seed, transfer, seq, attempt)` is compared with `Game.wireLoss()`, the loss table of 3.5 (the plan, the router, a hot card and `ECONOMY.wireLoss`, read every tick). A lost segment never reaches the NIC. `Game.netWire` counts segments sent, resent, lost and timeouts.
- **The NIC drops.** A segment gets to the NIC one tick after the sender put it on the wire. The NIC takes one per step into its FIFO (2 to 16 segments by chip) and moves it to the ring when a slot is free. A segment that finds the FIFO full is dropped: `STATUS.dropped` is set (sticky) and the drop counter counts it. A kernel that is busy (OS 1 and 2 run one program at a time and do not poll while it runs) therefore loses segments, and the sender recovers by timeout.
- **The driver acknowledges.** For every segment it takes: in order, it writes the spool block and posts an ACK with the next segment it wants; old or out of order, it counts a drop (`NICK.DROPS`) and posts the same ACK again (a duplicate; the sender does not act on it, no fast retransmit); a first segment with no free job slot, no queue room or no spool room is dropped without an ACK, so the sender backs off. A full TX ring skips the ACK (the next one covers it).
- **The host adopts early.** `adoptReceived` moves a download to the spool when the kernel's job for that key is queued or later, so a lost or late last ACK does not hold the transfer. A result packet for a key still in `downloads` ends the download as well.
- **Replays** (a boot wiped the kernel's table) are free flows: no line time, no loss, window 2.
- **Not built in stages 3 and 4.** The plan's share of the round trip, fast retransmit, delayed ACKs, selective ACK, PIO, interrupt coalescing and checksum offload (3.2), router overload and a burnt cable (3.5), and the counters in the snapshot and the panel (stage 5).

## 4. The CPU side (what stage 2 adds)

**The interrupt, as built.** OS 3 and up (they run with interrupts on, for the timer) take `IRQ.NIC`: the kernel sets `RxIrq`, `TxIrq` and `LinkIrq` in `CTRL` at boot (`nicInit(true)`), the line goes to core 0, and `ktimer` (the kernel's one interrupt entry) acknowledges it, sets the flag `NICK.EV` and clears the kernel's nap; the kernel's own context, the bottom half, clears the flag and runs `knic`. The end of a network job sets the flag too (the result is for the transmit ring), and so does the first pass after boot. A cut cable is a link interrupt (`LinkIrq`: the NIC raises the line when the link goes up or down), so the driver frees the receiving slots as before. OS 1 and 2 keep polling: OS 1 has no privilege levels (the memory protection drops the stores of a handler that interrupts a job) and neither OS runs a job with interrupts on, so a segment that comes while a job runs waits in the ring and the FIFO, as the doc of the stage 3 loss says. Not built: coalescing (one interrupt per segment and per packet), a handler that takes the segments itself (the handler only notes, and the context switch is the cost a real top half has), interrupts on OS 2 (its handler would run on physical addresses: possible, not done).

_The original proposal, from before the stage 2 build (which polled), follows; OS 3 and up now do most of it:_

- **A handler in the kernel** (`src/features/os/sim/kernel/`, assembly). Boot sets `VECTOR`, `MASK` (NIC line) and `CTRL`. The handler follows the convention of `CPU.md`: save, read `RX_HEAD`, acknowledge, set a "work waiting" flag in the kernel's data, restore, `iret`. For PIO it also copies the window.
- **The bottom half** is the kernel's existing idle/loop code: it already polls the PCH for a key between programs; it also checks the flag, drains the ring and ingests a complete job (`kingest`'s copy, sourced from a RAM staging buffer instead of the key window).
- The virtual-key feed in `Game.feedKernel` and the zero-latency USB timings go away. USB keys keep their path unchanged.
- **Running programs are interrupted.** The kernel runs one program at a time; a job in flight is paused by the handler for its length and resumes. With a busy network the job's turnaround grows by the handler cycles: there is no free lunch.

## 5. Receive livelock

If segments arrive faster than the CPU can run the handler, the CPU spends everything in the handler and the job never runs. This is a real effect (it needed NAPI/coalescing to fix) and it falls out of the design when a PIO NIC meets a fast line on a slow CPU. It is a feature: the player sees the job stall while the network is busy, and the fixes are real ones (coalescing NIC, faster CPU, slower plan). The simulation must still not hang: the ring bound and the drop rule cap the work per tick.

## 6. Observability (for the UI, stage 5)

**Built (the snapshot and the panel).** `net.stack` (`NetStackSnap` in `src/worker/game/types.ts`) holds the transport counters (sent, resent, lost on the wire, timeouts), the loss chance now (`Game.wireLoss()`), the shared round-trip estimate (`srtt`, `rttvar`, `rto`, or `null` before the first sample) and the card (`nic`: FIFO use and depth, RX and TX ring use and slots, the frames it took and sent, the segments the driver dropped, the DMA words, the interrupts raised: 0 on OS 1 and 2, which poll). Each download in `net.transfers` also carries `flow` (segments, acked, in flight, window, resent, timeouts, rto). The network panel shows them in a "Packets" fold (round trip, loss chance, segments and resends, card buffer) and one line under each download. The numbers are the real ones: nothing is invented for the display.

Not built: handler cycles and the CPU view of the handler. (`nic.irqs` counts the interrupts the NIC raised: 0 on OS 1 and 2, which poll.)

## 7. Plan

Each stage is committed on its own, with its tests, and keeps the game playable. The tutorial bot (`tutorial.bot.test.ts`) and the pacing numbers in `NETWORK.md` ("Pacing") must not regress at the end of stages 2 and 3.

1. **CPU interrupts. Built.** `iret`, the controller at `INTC_BASE`, drain-then-vector entry in all engines, tests on every engine. ([`CPU.md`](CPU.md))
2. **The NIC device and the kernel driver, still without loss. Built** (section 3.6). Device and registers, rings, DMA, a polling driver in the kernel, the virtual USB key removed. The transfers keep the bandwidth counters. Not in it: the PIO path, the interrupt handler and bottom half (the driver polls; the line is there for a later tier).
3. **The transport. Built** (section 3.7). `transport.ts` with segments, ACKs, the window, the timeout, retries and the stateless loss roll, unit-tested alone; wired between the line and the NIC; the NIC's drop when its FIFO is full and the driver's drop and ACK. Zero loss reproduces stage 2 (the timings of `NETWORK.md` "Pacing" hold; the patience test moved by one hundredth because the kernel image is a few blocks longer to boot).
4. **Loss sources and the NIC tiers. Built** (sections 3.2, 3.5 and 3.7). The loss table (plan, router, hot card), a FIFO depth for each chip, a timestamp echo and a shared round-trip estimate so the timer follows the kernel's real turn. Coalescing and checksum offload are not built, and the onboard jack stays a DMA jack (reasons in 3.2). Retuned with the bots (`NETWORK.md` "Measured with the transport and the loss table"): the jobs are CPU-bound, so the price ladder in `PROGRESSION.md` did not move.
5. **UI and render. Partly built.** The snapshot and the network panel numbers (section 6) are built. The NIC die shows the real buffers (`docs/render/net.md`): the receive queue's FIFO, the two descriptor rings in the DMA block, the words moved and the segments lost, and the part descriptions give the same numbers. The 40G card and the Edge router have QSFP+ ports and a 40GBASE-CR4 line side (the card's cages, the router's five ports, the plugs, the descriptions). Left: tutorial lines about "packets", if the lesson text needs them. There is no interrupt chip to show while the driver polls.

## 8. Invariants to test

- With zero loss and a roomy ring, a download takes the same time as `NETWORK.md` ("A 24 MB job at 50 Mbit takes 4 ticks") to within one tick, at every router/ISP/NIC combination in the tier table. This is what keeps the economy and the tutorial pacing intact.
- Determinism: the same save, seed and inputs give the same segments, drops and cycles.
- No interrupt is lost and none is taken while interrupts are off; every handler entry has a matching `iret` (`Intc.taken` against retired `iret`s).
- A transfer always ends: delivered, or failed after `MAX_RETRIES`, or lost to a power cut with the offer returned. No stuck transfers, no negative windows. _(Tested in `transport.test.ts`: with loss every flow ends, a deaf receiver fails the flow after 1 + `maxRetries` sends.)_
- Ring overflow only ever happens when the ring is full; a starved CPU (a job running, interrupts masked) produces drops and then recovers when it catches up. _(Tested at the device level: a full ring and a full FIFO drop the next segment, `nic.test.ts`. The same test at the level of a whole game with a busy CPU is open: the rig's jobs are too short to overflow four ring slots and two FIFO slots.)_
- Power loss, cable pull and save/load follow the rules of `NETWORK.md` ("Power loss", "Save") unchanged.

## 9. Open decisions

1. **Transport in the game layer, or in the player's kernel?** Recommended: the game layer, with the CPU doing the interrupts, the copies and the bookkeeping. TCP in the toy assembly would be authentic and a large project; it can come later as a separate OS tier.
2. **Is the onboard jack PIO?** It makes the free network cost CPU at level 4, when the machine is weakest. It may be too punishing for the first lesson; the alternative is a DMA jack with one interrupt per segment, and PIO only for a hypothetical cheaper card.
3. **Segment count** (128 per job) and whether the handler cost should scale with job size.
4. **Where the first handler lives**: kernel only (needs an OS, which the network already needs) or also the boot ROM.
5. **How much RAM the ring takes** and whether it is configurable by the OS tier.

## 10. What this supersedes in `NETWORK.md`

When stages 2 and 3 land, these parts of `NETWORK.md` are replaced by this document: "The feed (how it works)" and the virtual key, steps 3 and 4 of "The flow of a job", "What an OS step looks like to the kernel" (its register sketch is replaced by section 3.1 here), and "Spool"'s NIC rx window wording. The arrival channels, the USB fallback, retired keys, declining, the spool, the power-loss table and the save rules stay as they are.
