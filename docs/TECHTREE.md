# Tech tree: the principle and the planned ladders

**Principle (owner decision, revised):** there are no research points. A tier unlocks by **player level plus money plus real hardware requirements**. The level comes from the client-base score (lifetime jobs served, weighted by reputation) and gates what the shop offers: locked items stay visible with `Level N`, and the full ladder (level to unlock) is in [`PROGRESSION.md`](PROGRESSION.md), which supersedes the earlier "only money and hardware" rule. On top of the level, the hardware rules are unchanged: the board has to have the slot and the tier, the PSU the watts (and connectors), the cooler the capacity, the RAM the size, the storage the space, the OS the support. The sandbox ignores the level (everything unlocked). If the machine cannot carry a part, the shop shows it blocked with the first reason (`PurchaseSnap.blocked`), and install refuses it with the same reason. The tree is per device (a ladder per kind), not one global tree.

How it is enforced today: each device is a declarative spec (`src/sim/board/specs.ts`: `slot`, `price`, `idleW/loadW`, thermal) and `install` checks slot type and PSU watts; purchases are validated against the "plan" (installed board plus everything in the inventory); OS items are data in `src/sim/os/specs.ts` with `minRamBytes` and `diskBytes`. Adding a rung is adding a record, plus a new requirement field only when it needs a new rule.

Status: **built** (in the catalog and playable), **planned** (not in the sim yet). All numbers are placeholders.

## CPU (built: 12, a tree)

The CPUs form a **tree**, not a line (owner 2026-10-27). The trunk is the three early parts; from `cpu2` on each step has a generalist and **specialists** that lean one way, so two players with the same money build different machines. `tier` is the depth (siblings share a tier); `CpuSpec.after` names the part a CPU builds on and `CpuSpec.branch` the way it leans. Every part has its own die floorplan ([`DIE.md`](DIE.md)); the speed numbers in the picker are **measured** on the real engine ([`cpuProfile`](../src/sim/game/cpuprofile.ts): number crunching, big data, branchy code; benchmarks written for it, see the note there).

| Tier | Part | Engine | Leans | Level | Price |
|---|---|---|---|---|---|
| 0 | cpu0 unpipelined | `unpipelined` | start | start | free |
| 1 | cpu1 5-stage, no forwarding | `inorder` | | 1 | $200 |
| 2 | cpu2 5-stage + forwarding | `inorder`, D$ 16 | | 6 | $800 |
| 3 | cpu3 2-wide in-order | `inorder2` | generalist: crunching | 8 | $2,400 |
| 3 | cpu2d dual core (two cores, shared L2) | `inorder` D$ 16, L2 32, `cores` 2 | on cores (several programs at once) | 9 | $2,000 |
| 3 | cpu2f front end | `inorder` + I$ 8, 2-bit predictor 128 | branchy code | 9 | $1,500 |
| 3 | cpu2m memory | `inorder` + D$ 32 2-way, L2 32 | big data | 9 | $1,500 |
| 4 | cpu3t dual core, two threads each (switch-on-miss) | `inorder` D$ 16, L2 64, `cores` 2, `threads` 2 | on cores (four logical cores) | 11 | $5,000 |
| 4 | cpu4 out of order, ROB 8 | `ooo` | generalist | 11 | $6,000 |
| 4 | cpu3f 2-wide, front end | `inorder2` + I$ 16, 2-bit 256 | branchy | 11 | $3,600 |
| 4 | cpu3m 2-wide, memory | `inorder2` + D$ 64 4-way, L2 64 | big data | 11 | $3,600 |
| 5 | cpu4f out of order ROB 16, front end | `ooo` + I$ 32, 2-bit 512 | branchy | 13 | $8,500 |
| 5 | cpu4m out of order ROB 16, memory | `ooo` + D$ 64 4-way, L2 128 | big data | 13 | $8,500 |
| 6 | cpu4w 4-wide out of order, ROB 32 | `ooo` width 4 + everything | all | 15 | $12,000 |

From `cpu2` up an engine has `redirectPenalty` 2 (a jump waits for instruction memory unless there is an instruction cache), which is what the I-cache saves; the parts are only ever **additions** to their parent (the tests check that no specialist is slower than the part it builds on). Prices, power and levels are placeholders for the balance pass; the power numbers are kept under what the Enthusiast board's VRM feeds (a 130 W part droops it). Planned: multicore (`cpu5`: server style, many small cores, against HPC style, one big core; the die layouts exist, the simulation does not: [`DIE.md`](DIE.md), [`MULTICORE.md`](MULTICORE.md)) and the **CPU gallery** that shows the whole tree.

## RAM (built: 3)
ram0 16K (starter), ram1 32K fast, ram2 64K low-latency: a free DIMM slot and watts. Planned: more and bigger sticks per board tier, ECC (for secure workloads).

## Storage (built: 3, owner decision for this phase)
| Tier | Part | Key requirements | |
|---|---|---|---|
| 0 | hdd0 HDD 96K: slow seek, low power, cheap | a `sata` slot, PSU watts | built |
| 1 | ssd1 SATA SSD 64K: 20x faster | a `sata` slot, PSU watts | built |
| 2 | nvme2 NVMe SSD 128K: fastest | the `m2` slot (ATX+ board) | built |
| 3+ | bigger/faster NVMe, RAID of two drives | more m2 slots, board tier | planned |

## Cooler (built: 3)
Stock heatsink (starter), tower fan, liquid loop: cooler slot and watts. Planned: case fans that cool the non-CPU parts, a bigger radiator tier needing a bigger case/board.

## PSU (built: 3)
40 W, 100 W (plain ATX), 250 W (needs the ATX+ connector, i.e. the bigger board). Planned: 500 W+ with PCIe power connectors for GPUs, a connector count (SATA, PCIe, 8-pin) instead of watts alone.

## Board (built: 4)
| Tier | Board | Slots | Features | VRM | Price |
|---|---|---|---|---|---|
| 0 | Starter | 1 DIMM, 2 SATA, 1 USB, 1 PCIe, 0 M.2, ATX | HDMI x1, no ethernet | 2 x 12 A | start board (replacement $40) |
| 1 | Basic | 2 DIMM, 3 SATA, 2 USB, 2 PCIe, ATX | 100 Mbit ethernet | 3 x 12 A | $150 |
| 2 | Mainstream | 4 DIMM, 4 SATA, 2 M.2, 3 USB, 3 PCIe, ATX+ | 100 Mbit, 2 display ports | 4 x 15 A | $300 |
| 3 | Enthusiast | 8 DIMM, 6 SATA, 3 M.2, 4 USB, 4 PCIe, ATX+ | 1 Gbit, 2 display ports | 6 x 20 A | $700 |

You buy the **next tier** (`board1`, `board2`, `board3`), only while the machine is off; installed parts carry over. The requirement that matters: a CPU needs a VRM that can feed it (cpu2 wants Mainstream, a smaller board crashes and eventually burns). Planned: a second CPU socket and a server board. See [`VRM.md`](VRM.md).

## VRM heatsink (built: 3)
| Tier | Part | Effect | Price |
|---|---|---|---|
| 0 | vsink0 passive fins | 0.25 W/C of VRM cooling | $30 |
| 1 | vsink1 big fins | 0.5 W/C | $70 |
| 2 | vsink2 fins + small fan | 1.0 W/C, draws up to 1.5 W | $140 |

A `vrm-sink` slot on every board. Matters with a liquid CPU cooler (no airflow over the VRM) and when overclocking.

## Display (built: 1)
CLI monitor (text). Planned: a framebuffer/graphics display (needs a GPU on PCIe), bigger resolutions for render jobs.

## NIC (planned; full design in [`NETWORK.md`](NETWORK.md): cards, router, cable, ISP plans, levels)
Ethernet card in a PCIe slot (or on-board on the ATX+ board). Requires: PCIe slot, OS installed (the OS owns the network stack), enough RAM. Unlocks the network `WorkSource`: jobs arrive and results leave without USB keys (removes the USB enumerate/flash latency). Tiers: 100 Mbit, 1 Gbit, 10 Gbit (throughput bounds how many jobs can be ingested per second).

## Router (planned)
A separate device on the network side of the NIC: more clients and a better uplink. Requires a NIC and an OS. Tiers by ports and throughput; a tier decides how many clients can reach the machine, so it feeds demand.

## OS (built: tiers 1 to 3 of 4)
| Tier | OS | Key requirements | |
|---|---|---|---|
| 1 | Resident OS 1.0: boots once, job queue, one program at a time | 32K RAM, a drive with 12K + spool free | built |
| 2 | Paged OS: an address space per program, memory claimed on demand, the OS out of reach | 64K RAM, 24K free, a CPU with an MMU | built |
| 3 | Preemptive: timer interrupt, up to four programs at once | 64K RAM, 48K free, a CPU with an MMU | built |
| 4 | Multicore: programs spread over several CPU cores | | planned (data entry exists, locked) |

## GPU (planned)
A PCIe card running its own ISA (see ARCHITECTURE.md "Accelerators"). Tiers by lanes and memory. Requires: a PCIe slot, a PSU with a PCIe power connector and the watts, a cooler headroom, an OS that can launch its kernels (cooperative or better), and a display tier for graphics jobs.

## Network phase design notes (decided, not built)

- **USB keys die out once the network works.** When the NIC, router and ethernet cable are set up and the link is up, clients stop sending USB sticks: new key arrivals stop (keys already waiting in the tray can still be served). The earlier idea of a slow fade is superseded: the owner said to assume users stop sending sticks once the network exists. This is the reason to unlock the network: it removes the manual plugging, and the plug/unplug latency of the USB path.
- Network jobs are downloaded in full by the OS (time depends on NIC, router tier and job size) and results uploaded; no manual step per job.
- Onboard ethernet starts at board tier 1 (100 Mbit), and the Enthusiast board has 1 Gbit. PCIe NIC cards are the upgrade path. See `docs/VRM.md` and `docs/BOARD.md` for the board ladder.
