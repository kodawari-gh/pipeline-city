# Network stack v2: interrupts, DMA and a simplified TCP

Status: **designed, stage 1 built.** Stage 1 is the CPU taking interrupts ([`CPU.md`](CPU.md) section 4). Stages 2 to 5 are not built. This document is the design for replacing the timing-only network of [`NETWORK.md`](NETWORK.md) ("Built") with one the machine takes part in. Everything not marked built is a proposal; all numbers are placeholders for the balance pass.

## 1. Why change it

What exists (see `NETWORK.md` "Built", `Game.runTransfers` and `Game.feedKernel`):

- A download is a counter: `doneMB += downMbps / 8 / downloads` per base tick. When it reaches the job's size the job is "downloaded".
- The game then plugs a **virtual USB key** into the PCH with zero enumerate and flash waits, and the real kernel ingests it exactly as it would a key. The result is read out of the kernel's job table and uploaded the same way.
- So the line, the router and the ISP decide *when* a job arrives, and the machine decides nothing about *how*. A slow CPU, a busy job or a small RAM do not touch the network, and the network cannot fail: no loss, no retry.

What the owner wants to work towards: a stack where the packet path through the machine is visible and costs something. A NIC receives, the CPU is interrupted and loads the payload, packets can be lost and are resent. This is the design for that, built in steps that each keep the game playable.

## 2. The path of a received job

```
remote server ──wire──▶ ISP ──▶ router ──▶ cable ──▶ NIC ──▶ RX ring (RAM) ──▶ interrupt ──▶ CPU handler ──▶ kernel ──▶ spool ──▶ queue
   (segments, loss, ACKs: the transport)        (bandwidth, loss)   (DMA or CPU copy)   (CPU.md)          (top half)     (bottom half)   (as today)
```

Step by step, and **who does each step**:

| # | Step | Done by | Costs |
|---|---|---|---|
| 1 | The server sends the job as a series of **segments**. The line limits how many bytes per tick; a segment can be lost on the way | transport (game layer) | time, bandwidth |
| 2 | A segment reaches the NIC. If the NIC's **RX ring** in RAM has no free slot, the NIC drops it | NIC (device) | a drop, a retransmit later |
| 3 | The NIC writes the segment into the ring. A **DMA** NIC does it itself; a **PIO** NIC leaves it in its own window for the CPU to copy | NIC / CPU | none / CPU cycles |
| 4 | The NIC **raises the NIC line**. A coalescing NIC raises it once per several segments or after a short timer | NIC | |
| 5 | The CPU is interrupted: it drains its pipeline, jumps to the handler (the **top half**): save registers, read the ring head, acknowledge the line, mark work for the kernel, restore, `iret` | CPU, real instructions | pipeline drain + handler cycles, stolen from whatever was running |
| 6 | The kernel loop (the **bottom half**, between programs as today) sees the work flag, takes the finished segments off the ring, and when the last segment of a job is in, ingests the job into the spool | kernel, real instructions | CPU and disk time, as today's ingest |
| 7 | The NIC acknowledges to the sender. Cumulative ACKs are the NIC's hardware, not the CPU's | NIC / transport | |

Uploading is the mirror: the kernel writes the result into a **TX ring**, tells the NIC, the NIC sends segments, ACKs come back, and the NIC raises an interrupt when the whole result has been sent so the kernel can free the job's spool slot.

A game MB is a **time unit**, not data the CPU touches. The real bytes are the job's program and result (tens to hundreds of words). They are split over the job's segments, so the CPU work per segment is a slice of the real words plus the fixed cost of the handler. A 3000 MB job is slow on a thin line, not expensive to copy.

## 3. Pieces

### 3.1 The NIC device

A memory-mapped device in its own clock domain (so it raises interrupts at CPU-cycle granularity: `CPU.md` "Using it from a device"), one per network port: the board's jack, and each NIC card in a PCIe slot. Proposed registers (offsets from a `NIC_BASE`, one block per port like the storage ports):

| Reg | Meaning |
|---|---|
| `STATUS` | link up, rx work waiting, tx busy, overflow seen |
| `RX_BASE`, `RX_SLOTS` | the ring in RAM the kernel set up |
| `RX_HEAD` (ro) / `RX_TAIL` (rw) | the NIC's write index / the kernel's read index. Full when `head + 1 == tail` |
| `RX_WINDOW` | PIO tiers only: the segment sits here until the CPU reads it |
| `TX_BASE`, `TX_LEN`, `TX_GO` | the result to send |
| `IRQ_CTRL` | enable, coalescing count and timer |
| `STATS` | segments received, dropped on a full ring, interrupts raised |

A ring slot is a descriptor: job id, segment number, segment count, the words that belong to it. The kernel reserves the ring in RAM at boot (a new region beside the job table). **Ring size is RAM**: the 16K starter machine can afford few slots, which is part of why it drops.

### 3.2 NIC tiers (the CPU-cost ladder)

| Part | Receive | Interrupts | Notes |
|---|---|---|---|
| Onboard jack (Basic board and up) | **PIO**: the CPU reads the segment from the window word by word | one per segment | the network is free and visibly expensive: it eats the CPU |
| `nic1` | **DMA** into the ring | one per segment | the handler only moves indexes |
| `nic2` | DMA | **coalesced**: one per 4 segments or a short timeout | fewer drains, less stolen time, more latency |
| `nic3` | DMA | coalesced, **checksum offload** | the segment check the kernel would do is gone |

The existing NIC specs (`nic1..3`, 1000 / 10000 / 40000 Mbit) keep their bandwidth, price and thermal numbers; this adds the CPU-side behaviour. Whether the onboard jack should really be PIO is an open decision (section 9).

### 3.3 Segments

A transfer is cut into segments: `segMB = max(0.5, sizeMB / 128)`, so a job is at most 128 segments (24 MB: 48; 3000 MB: 128). Anything finer costs simulation time without teaching anything. The line moves `bandwidth / 8` MB per tick shared by all active transfers, as today; a tick moves a whole number of segments (the remainder carries over).

### 3.4 The transport (a simplified TCP, in the game layer)

A pure, seeded, unit-tested module (`src/sim/net/transport.ts`) with no dependence on the CPU. Per transfer:

- **Sequence numbers** and a **cumulative ACK**: the receiver's `next expected`. A segment that arrives out of order is kept by the NIC only if the ring has room; otherwise it counts as lost.
- A **congestion window** `cwnd` (segments in flight) and `ssthresh`. A transfer **starts at the window that fills the line** (the bandwidth-delay product), so with no loss the time is the same as today (section 8). A loss halves `cwnd` (multiplicative decrease); each fully acknowledged round trip adds one (additive increase) until it is back at the line's window.
- A **round-trip time** in ticks (at least 1; the ISP plan adds more on the slow tiers) and a **retransmission timeout** of `max(3, 3 x rtt)` ticks for a segment that is not acknowledged. A timeout resends that segment; the sender counts retransmissions per segment.
- **Give up**: a segment resent more than `MAX_RETRIES` (placeholder 8) times fails the transfer. The offer goes back to the list with `attempts + 1`, as a power loss does today.
- **Loss is rolled statelessly**: `lossRoll(gameSeed, transferId, seq, attempt)` is a hash to [0,1), compared with the segment's loss probability. No PRNG state to save or to keep in step with other draws, so determinism does not depend on event order, and "same save and seed, same run" holds.

Transfers are still **never saved** (`NETWORK.md` "Save"). A loaded game's offers restart; the ring is RAM and is empty after a boot.

### 3.5 Where loss comes from

A segment's loss probability is the combination `1 - (1 - a)(1 - b)(1 - c)...` of:

| Source | Why it is a gameplay lever |
|---|---|
| The wire: ISP plan and router tier (placeholder: `isp1` / `router1` 2% each, `isp2` / `router2` 0.5%, higher tiers 0.1%) | the cheap plan is lossy; buying up is a reason beyond bandwidth |
| A hot or throttled NIC card, a burnt cable | cooling matters for the network |
| **A full RX ring** | **the machine's own doing**: a slow CPU, a long-running job holding the CPU, a big handler or too little RAM for the ring makes the NIC drop. This is not a random number: it follows from the CPU/RAM the player built |
| Overload: more active transfers than `clients` is impossible (admission), but offered load above the router's capacity raises loss | a small router with a fast ISP drops |

The ring-overflow case is the point of the exercise: the line can be 1000 Mbit and the machine a starter box, and the transfer still limps because the CPU cannot empty the ring. A faster CPU (or DMA, or coalescing) is then the fix, not more bandwidth.

## 4. The CPU side (what stage 2 adds)

- **A handler in the kernel** (`src/sim/os/kernel.ts`, assembly). Boot sets `VECTOR`, `MASK` (NIC line) and `CTRL`. The handler follows the convention of `CPU.md`: save, read `RX_HEAD`, acknowledge, set a "work waiting" flag in the kernel's data, restore, `iret`. For PIO it also copies the window.
- **The bottom half** is the kernel's existing idle/loop code: it already polls the PCH for a key between programs; it also checks the flag, drains the ring and ingests a complete job (`kingest`'s copy, sourced from a RAM staging buffer instead of the key window).
- The virtual-key feed in `Game.feedKernel` and the zero-latency USB timings go away. USB keys keep their path unchanged.
- **Running programs are interrupted.** The kernel runs one program at a time; a job in flight is paused by the handler for its length and resumes. With a busy network the job's turnaround grows by the handler cycles: there is no free lunch.

## 5. Receive livelock

If segments arrive faster than the CPU can run the handler, the CPU spends everything in the handler and the job never runs. This is a real effect (it needed NAPI/coalescing to fix) and it falls out of the design when a PIO NIC meets a fast line on a slow CPU. It is a feature: the player sees the job stall while the network is busy, and the fixes are real ones (coalescing NIC, faster CPU, slower plan). The simulation must still not hang: the ring bound and the drop rule cap the work per tick.

## 6. Observability (for the UI, stage 5)

Counters on the `net` snapshot: segments sent, retransmitted, dropped (wire / ring), ring occupancy and the high-water mark, interrupts taken and the average and worst `lastLatency` / `maxLatency` of `Intc`, CPU cycles spent in handlers (to be added to `Intc`: cycles between `enter` and the matching `iret`), per-transfer `cwnd`, RTT and retries. The network panel shows loss and the window; the CPU view shows the handler's instructions passing through the pipeline (they are ordinary instructions) with a chip for the interrupt; the NIC prop's LED blinks on rx.

## 7. Plan

Each stage is committed on its own, with its tests, and keeps the game playable. The tutorial bot (`tutorial.bot.test.ts`) and the pacing numbers in `NETWORK.md` ("Pacing") must not regress at the end of stages 2 and 3.

1. **CPU interrupts. Built.** `iret`, the controller at `INTC_BASE`, drain-then-vector entry in all engines, tests on every engine. ([`CPU.md`](CPU.md))
2. **The NIC device and the kernel handler, still without loss.** Device and registers, ring, DMA and PIO paths, interrupt, kernel handler and bottom half, the virtual USB key removed. The transfers keep the bandwidth counters. Done when jobs arrive over the network through the interrupt path at the same speed as before (tolerance below).
3. **The transport.** `transport.ts` with segments, ACKs, the window, the timeout, retries and the stateless loss roll, unit-tested alone; wired between the line and the NIC; the ring-overflow drop. Zero loss reproduces stage 2.
4. **Loss sources and the NIC tiers.** The loss table, coalescing and checksum offload, the onboard-jack decision, RAM cost of the ring; retune with the bots (`NETWORK.md` "Pacing" rig) and update the numbers in `PROGRESSION.md` if the price ladder moves.
5. **UI and render.** Network panel numbers, interrupt chip and handler visible in the CPU view, tutorial lines about "packets" if the lesson text needs them.

## 8. Invariants to test

- With zero loss and a roomy ring, a download takes the same time as `NETWORK.md` ("A 24 MB job at 50 Mbit takes 4 ticks") to within one tick, at every router/ISP/NIC combination in the tier table. This is what keeps the economy and the tutorial pacing intact.
- Determinism: the same save, seed and inputs give the same segments, drops and cycles.
- No interrupt is lost and none is taken while interrupts are off; every handler entry has a matching `iret` (`Intc.taken` against retired `iret`s).
- A transfer always ends: delivered, or failed after `MAX_RETRIES`, or lost to a power cut with the offer returned. No stuck transfers, no negative windows.
- Ring overflow only ever happens when the ring is full; a starved CPU (a job running, interrupts masked) produces drops and then recovers when it catches up.
- Power loss, cable pull and save/load follow the rules of `NETWORK.md` ("Power loss", "Save") unchanged.

## 9. Open decisions

1. **Transport in the game layer, or in the player's kernel?** Recommended: the game layer, with the CPU doing the interrupts, the copies and the bookkeeping. TCP in the toy assembly would be authentic and a large project; it can come later as a separate OS tier.
2. **Is the onboard jack PIO?** It makes the free network cost CPU at level 4, when the machine is weakest. It may be too punishing for the first lesson; the alternative is a DMA jack with one interrupt per segment, and PIO only for a hypothetical cheaper card.
3. **Segment count** (128 per job) and whether the handler cost should scale with job size.
4. **Where the first handler lives**: kernel only (needs an OS, which the network already needs) or also the boot ROM.
5. **How much RAM the ring takes** and whether it is configurable by the OS tier.

## 10. What this supersedes in `NETWORK.md`

When stages 2 and 3 land, these parts of `NETWORK.md` are replaced by this document: "The feed (how it works)" and the virtual key, steps 3 and 4 of "The flow of a job", "What an OS step looks like to the kernel" (its register sketch is replaced by section 3.1 here), and "Spool"'s NIC rx window wording. The arrival channels, the USB fallback, retired keys, declining, the spool, the power-loss table and the save rules stay as they are.
