# Virtual memory: plan

Status: **plan, nothing built.** The OS tiers 2 and 3 (several programs, preemption) need it: today a program is built for `USER_BASE` and sees physical memory, so two programs cannot coexist, and the memory protection unit (docs/OS.md) is a bolt-on.

## What it is in this game
Each program gets its own **address space**: it always starts at the same virtual address, whatever physical pages hold it. The **MMU** translates every virtual address to a physical one through a **page table** the OS keeps in RAM, with a **TLB** (a small cache of translations) in front. A missing translation is a **page fault**: the OS maps a page (claiming it on first write: the "programs claim memory by writing" rule we have now), or loads it from the drive (swap), or kills the program (a write outside its space: the SEGFAULT we have now).

## Pieces
1. **Sim: MMU device** (`src/sim/machine/mmu.ts`): page table base register, enable bit, a TLB of N entries (N is a CPU spec), permission bits per page (read, write, execute, user). The bus asks the MMU before RAM. The MPU is replaced by page permissions (kernel pages not user-writable); the fault handler stays.
2. **Page walks cost cycles.** A TLB miss walks a two-level table: two RAM reads through the caches and DRAM (so it shows on the die and in the row buffers). A page fault costs a trap into the kernel.
3. **Engines:** loads, stores and instruction fetch translate; the engine keeps the translation for the access (like `missCost` keeps the RAM answer). Instruction fetch gets an ITLB, data a DTLB (`tlbEntries`, default 0 = off, so goldens stay). Faults must be precise: the engines already drain for interrupts, so a fault is an interrupt taken at the faulting instruction.
4. **ISA:** a few registers in the MMU's MMIO window (table base, enable, fault address, fault cause); no new opcodes. `iret` returns to the faulting instruction.
5. **OS (kernel in asm):** page-table builder, page-fault handler (claim a zeroed page, or swap in), frame allocator, per-process tables, context switch on `iret`. OS 2 (cooperative) switches on yield, OS 3 on a timer interrupt; both need the process table the CLI already shows.
6. **Swap:** pages evicted to the drive (the spool area) when RAM is full: this makes RAM size matter again once programs are many. It costs real drive time.

## Visual updates
- **CPU die:** MMU and TLB blocks next to the load/store and fetch units (floorplans for every architecture that has them; TLBs are small cell grids like the caches, entries show the virtual page and the frame); a translate step on the load/store and fetch paths (a packet through the TLB; a lit wire to the page walker and the memory controller on a TLB miss).
- **RAM view:** pages are coloured by owner already; with address spaces the magnifier shows both addresses and the page tables are a region of their own. A page fault outlines the page and shows it filling.
- **CLI monitor:** the process table gets virtual size, resident size, faults and swapped pages per process.
- **Memory scale** (docs/RAM.md "Larger memory"): the page tables are the natural place to cheat big memory: a sparse table maps virtual pages onto a small set of real frames.

## Order of work
1. MMU device and TLB model with tests on the bare machine (no OS), all engines.
2. Page walks through caches and DRAM, counters, die blocks and packets.
3. Kernel: tables, fault handler; claim-on-write replaces the dirty-page tracking in `game.ts`.
4. OS 2 (two programs resident), process table on the CLI.
5. Swap, OS 3 (timer, preemption).

Open questions: page size (256 B like the drive block and the DRAM row is simplest and matches the visuals); CPU tiers differ by TLB size and walk hardware (this is the CPU-architecture change the tree needs).
