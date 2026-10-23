# Tech tree: the principle and the planned ladders

**Principle (owner decision):** there are no research points. A tier unlocks by **money plus real hardware requirements**: the board has to have the slot and the tier, the PSU the watts (and connectors), the cooler the capacity, the RAM the size, the storage the space, the OS the support. If the machine cannot carry a part, the shop shows it blocked with the first reason (`PurchaseSnap.blocked`), and install refuses it with the same reason. The tree is per device (a ladder per kind), not one global tree.

How it is enforced today: each device is a declarative spec (`src/sim/board/specs.ts`: `slot`, `price`, `idleW/loadW`, thermal) and `install` checks slot type and PSU watts; purchases are validated against the "plan" (installed board plus everything in the inventory); OS items are data in `src/sim/os/specs.ts` with `minRamBytes` and `diskBytes`. Adding a rung is adding a record, plus a new requirement field only when it needs a new rule.

Status: **built** (in the catalog and playable), **planned** (not in the sim yet). All numbers are placeholders.

## CPU (built: 3 of ~8)
| Tier | Part | Key requirements | |
|---|---|---|---|
| 0 | cpu0 unpipelined | cpu socket | built (starter) |
| 1 | cpu1 5-stage, no forwarding | PSU >= rated load (100 W for the usual build) | built |
| 2 | cpu2 5-stage + forwarding, cache | 100 W+ PSU, tower cooler advised | built |
| 3 | 2-wide in-order | bigger PSU (250 W), better cooler | planned (engines agent) |
| 4 | out-of-order | 250 W PSU, liquid cooling | planned (engines agent) |
| 5 | multicore | board with a second core slot or a bigger socket tier, shared L2 | planned |

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
| 0 | Starter | 1 DIMM, 1 SATA, 1 USB, 0 PCIe, 0 M.2, ATX | HDMI x1, no ethernet | 2 x 12 A | start board (replacement $40) |
| 1 | Basic | 2 DIMM, 2 SATA, 2 USB, 1 PCIe, ATX | 100 Mbit ethernet | 3 x 12 A | $150 |
| 2 | Mainstream | 4 DIMM, 2 SATA, 1 M.2, 3 USB, 2 PCIe, ATX+ | 100 Mbit, 2 display ports | 4 x 15 A | $300 |
| 3 | Enthusiast | 8 DIMM, 2 SATA, 1 M.2, 4 USB, 4 PCIe, ATX+ | 1 Gbit, 2 display ports | 6 x 20 A | $700 |

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

## NIC (planned)
Ethernet card in a PCIe slot (or on-board on the ATX+ board). Requires: PCIe slot, OS installed (the OS owns the network stack), enough RAM. Unlocks the network `WorkSource`: jobs arrive and results leave without USB keys (removes the USB enumerate/flash latency). Tiers: 100 Mbit, 1 Gbit, 10 Gbit (throughput bounds how many jobs can be ingested per second).

## Router (planned)
A separate device on the network side of the NIC: more clients and a better uplink. Requires a NIC and an OS. Tiers by ports and throughput; a tier decides how many clients can reach the machine, so it feeds demand.

## OS (built: tier 1 of 3)
| Tier | OS | Key requirements | |
|---|---|---|---|
| 1 | Resident OS 1.0: boots once, job queue, one program at a time | 32K RAM, a drive with 12K + spool free | built |
| 2 | Cooperative multitasking: several programs resident, switch on yield | 64K RAM, 24K free, `programSlots` 2 (data field) | planned (data entry exists, locked) |
| 3 | Preemptive: timer interrupt, fair scheduling | 64K RAM, 48K free, `programSlots` 4, a CPU with an interrupt line | planned (data entry exists, locked) |

## GPU (planned)
A PCIe card running its own ISA (see ARCHITECTURE.md "Accelerators"). Tiers by lanes and memory. Requires: a PCIe slot, a PSU with a PCIe power connector and the watts, a cooler headroom, an OS that can launch its kernels (cooperative or better), and a display tier for graphics jobs.
