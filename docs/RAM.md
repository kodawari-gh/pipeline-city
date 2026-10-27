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
Capacities are real bytes, nothing is scaled; the biggest stick is 256K and four of them fill the 1 MiB a paged OS can use (see "How much RAM the OS uses"). Sticks differ the way real memory generations did: more banks, bank groups (DDR4), tighter timings, ECC, and on DDR5 two independent sub-channels per stick. Timings are in RAM ticks (the game's early-game pacing keeps SDR very slow).

| id | stick | level | banks / groups | tCL / tRCD / tRP / burst | channels per stick | ECC |
|---|---|---|---|---|---|---|
| ram0 | SDRAM 16K | start | 2 / 1 | 80 / 120 / 100 / 8 | 1 | no |
| ram1 | DDR2 32K | 1 | 4 / 1 | 5 / 7 / 6 / 2 | 1 | no |
| ram1b | DDR3 64K | 3 | 8 / 1 | 4 / 5 / 4 / 2 | 1 | no |
| ram2 | DDR4 128K | 5 | 16 / 4 | 2 / 2 / 2 / 1 | 1 | no |
| ram3 | DDR4 ECC 128K | 9 | 16 / 4 | 2 / 3 / 2 / 1 | 1 | yes |
| ram4 | DDR5 256K | 11 | 32 / 8 | 2 / 2 / 2 / 1 | 2 | no |
| ram5 | DDR5 ECC 256K | 13 | 32 / 8 | 2 / 3 / 2 / 1 | 2 | yes |

The DRAM the CPU reaches takes the weakest stick's banks and the slowest stick's timing. A controller drives `min(channels, sub-channels of all sticks)` channels, so one DDR5 stick already feeds a dual-channel controller, where DDR4 needs two sticks. The stick art shows the generation: accent colour, a key notch in a different place on each generation, and the DDR5 power-management chip.

Not modelled: the CPU only supporting some generations (a board/CPU would refuse a DDR5 stick), ranks, on-die ECC, XMP profiles, row sizes other than 256 bytes. Larger memory needs the scaling or the wider address space (see "Larger memory" below).

Controllers: cpu0 none; cpu1, cpu2, cpu2f: 1 channel, open page; cpu2m: 2 open; cpu3 family, cpu4, cpu4f: 2 adaptive; cpu4m, cpu4w: 4 adaptive.

Not modelled (yet): reordering requests (first-ready first-come first-served): the caches block on one miss at a time, so a queue rarely holds two requests; it comes with overlapping misses (miss-under-miss, prefetch). Write batching and bus turnaround (stores do not reach DRAM individually). Ranks.

## How much RAM the OS uses
The machine's memory array is 1 MiB (`MACHINE_RAM_BYTES`, the paged OSes' 20-bit virtual space); the installed sticks decide how much of it exists: `PCH_REG.RAM_KB`, what the screens show and what the OS manages (the first 64K are always backed: OS 1 keeps its kernel at 0xC000). Above 1 MiB nothing is used (a maxed board's extra sticks add nothing yet).

| OS | what it does with RAM above 64K |
|---|---|
| OS 1 | nothing special: programs use physical addresses, so a program may use 0x10000 up directly (the memory protection only guards the ROM and the OS) |
| OS 2 | the kernel reads the size, and its frame allocator hands out the frames between the program and the tables, then everything from 0x10000 up; a program's **big heap** is virtual 0x10000 up, claimed by page faults, with a second-level table allocated on the first touch of each 16K of it |
| OS 3 | needs 256K: a frame map (a word per 256-byte frame, up to 4096) at 0x10000 and the kernel's identity table at 0x14000 sit above 64K; the same big heap per program; frames come from a next-fit allocator, and a program's tables are freed with its frames |

The big heap (`HEAP_BASE` 0x10000) is where memory-hungry jobs keep their data (the in-memory index, `db.index`, docs/JOBS.md). Under a paged OS claiming it costs a page fault per page, which is real time.

## ECC and bit flips
`RamSpec.ecc` marks error-correcting sticks (ram3). Memory can suffer a **bit flip** (`EconomyConfig.memoryFlipRate`, the chance per base tick that a bit flips in memory the running job uses; **very low by default (0.00005 a tick: about one flip in five and a half hours of running)**, to be tuned in the balance pass). Plain RAM keeps the flip (the job may crash or answer wrongly; `Snapshot.bitFlips`, logged); ECC RAM corrects it (`Snapshot.eccCorrected`, logged). A **TPM needs ECC**: the module is off the bus unless every working stick is ECC, and `secure` jobs need `{tpm, ecc}` (`Caps.ecc`). Counters are this session's, not saved.

## Look
No text on the sticks. A stick's chips are a grid of 256-byte pages (docs/DIE.md "Memory"); the open row of every bank is outlined; an ECC stick has a ninth, smaller chip of parity bits in green.

## Larger memory (evaluation, not built)
The sim array stays 64 KiB. Each RAM tier gets a *scale* (one sim page stands for N real pages); chips become windows onto a sparse virtual space; the OS table and workload footprints are scaled numbers; only touched pages (`Bus.dirty`, regions) are real, everything else is drawn procedurally by level of detail (far: bank and row heat; near: pages). DRAM timing already works on any address, so it needs nothing more.

## Virtual memory
Built: `docs/VM.md` (the MMU, the paged OS 2).
