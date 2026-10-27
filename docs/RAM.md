# RAM

## DRAM and the memory controller (`src/sim/engines/dram.ts`)
Behind the caches the CPU reaches DRAM through its **memory controller**. Memory is cut into rows of 256 bytes (a page, the OS's unit too), held in **banks** (in **bank groups**), interleaved over **channels**: page `p` is in channel `p % channels`, bank `(p / channels) % banks`, row above that. Each bank has one row open in its row buffer. An access costs:

| outcome | cost |
|---|---|
| row hit (the open row) | tCL |
| bank closed (activate) | tRCD + tCL |
| conflict (another row open: precharge first) | tRP + tRCD + tCL |

plus `burst` cycles to move the line on the channel's data bus. A bus carries one burst at a time and wants a longer gap between two bursts of the same bank group (ccdL) than of different groups (ccdS), so back-to-back misses queue and **two channels serve two misses at once**. A **refresh** closes one bank's row every 6000 cycles in turn (round robin over all banks) and keeps the bank busy for tRFC. The **page policy** is the controller's: `open` keeps a row open (hits for streams, conflicts for scattered access), `closed` precharges at once (never a hit or a conflict), `adaptive` closes a bank's row after a conflict and keeps it otherwise. Counters `rowHits / rowEmpty / rowConflicts`, events `Ev.Row`.

Who decides what: the **RAM stick** (`RamSpec`) has banks, bank groups, row size, tCL / tRCD / tRP and burst in RAM ticks (the CPU/RAM clock ratio converts them to cycles in `engineConfigFor`, so overclocking RAM helps) and `ecc`. The **CPU** (`CpuSpec.memory`) has the controller: channels (1, 2 or 4; the controller drives `min(channels, sticks)` of them, so dual channel needs two sticks) and the page policy. Unpipelined CPUs and engines without a `dram` setting keep the flat `missPenalty` (engine goldens do not move).

## The ladder (`RamSpec.gen`)
Capacities stay inside what the sim addresses (the OS uses 64K; no stick is larger, sizes are real bytes, nothing is scaled). Sticks differ the way real memory generations did: more banks, bank groups (DDR4), tighter timings, ECC, and on DDR5 two independent sub-channels per stick. Timings are in RAM ticks (the game's early-game pacing keeps SDR very slow).

| id | stick | level | banks / groups | tCL / tRCD / tRP / burst | channels per stick | ECC |
|---|---|---|---|---|---|---|
| ram0 | SDRAM 16K | start | 2 / 1 | 80 / 120 / 100 / 8 | 1 | no |
| ram1 | DDR2 32K | 1 | 4 / 1 | 5 / 7 / 6 / 2 | 1 | no |
| ram1b | DDR3 32K | 3 | 8 / 1 | 4 / 5 / 4 / 2 | 1 | no |
| ram2 | DDR4 64K | 5 | 16 / 4 | 2 / 2 / 2 / 1 | 1 | no |
| ram3 | DDR4 ECC 64K | 9 | 16 / 4 | 2 / 3 / 2 / 1 | 1 | yes |
| ram4 | DDR5 64K | 11 | 32 / 8 | 2 / 2 / 2 / 1 | 2 | no |
| ram5 | DDR5 ECC 64K | 13 | 32 / 8 | 2 / 3 / 2 / 1 | 2 | yes |

The DRAM the CPU reaches takes the weakest stick's banks and the slowest stick's timing. A controller drives `min(channels, sub-channels of all sticks)` channels, so one DDR5 stick already feeds a dual-channel controller, where DDR4 needs two sticks. The stick art shows the generation: accent colour, a key notch in a different place on each generation, and the DDR5 power-management chip.

Not modelled: the CPU only supporting some generations (a board/CPU would refuse a DDR5 stick), ranks, on-die ECC, XMP profiles, row sizes other than 256 bytes. Larger memory needs the scaling or the wider address space (see "Larger memory" below).

Controllers: cpu0 none; cpu1, cpu2, cpu2f: 1 channel, open page; cpu2m: 2 open; cpu3 family, cpu4, cpu4f: 2 adaptive; cpu4m, cpu4w: 4 adaptive.

Not modelled (yet): reordering requests (first-ready first-come first-served): the caches block on one miss at a time, so a queue rarely holds two requests; it comes with overlapping misses (miss-under-miss, prefetch). Write batching and bus turnaround (stores do not reach DRAM individually). Ranks.

## ECC and bit flips
`RamSpec.ecc` marks error-correcting sticks (ram3). Memory can suffer a **bit flip** (`EconomyConfig.memoryFlipRate`, the chance per base tick that a bit flips in memory the running job uses; **very low by default (0.00005 a tick: about one flip in five and a half hours of running)**, to be tuned in the balance pass). Plain RAM keeps the flip (the job may crash or answer wrongly; `Snapshot.bitFlips`, logged); ECC RAM corrects it (`Snapshot.eccCorrected`, logged). A **TPM needs ECC**: the module is off the bus unless every working stick is ECC, and `secure` jobs need `{tpm, ecc}` (`Caps.ecc`). Counters are this session's, not saved.

## Look
No text on the sticks. A stick's chips are a grid of 256-byte pages (docs/DIE.md "Memory"); the open row of every bank is outlined; an ECC stick has a ninth, smaller chip of parity bits in green.

## Larger memory (evaluation, not built)
The sim array stays 64 KiB. Each RAM tier gets a *scale* (one sim page stands for N real pages); chips become windows onto a sparse virtual space; the OS table and workload footprints are scaled numbers; only touched pages (`Bus.dirty`, regions) are real, everything else is drawn procedurally by level of detail (far: bank and row heat; near: pages). DRAM timing already works on any address, so it needs nothing more.

## Virtual memory
Built: `docs/VM.md` (the MMU, the paged OS 2).
