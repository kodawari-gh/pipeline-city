# Virtual memory

Status: **built** — the MMU and TLB (`src/sim/machine/mmu.ts`), translation and precise page faults in all four engines, the paged OS 2 (`src/sim/os/kernel.ts`, `kernelSource(true)`), the TLB on the die and the VM line on the CLI monitor. Not built: several programs resident at once (cooperative / preemptive switching: OS 2's `programSlots` is 1 for now), swap to the drive, the page tables as a navigable view in the RAM magnifier.

## The hardware
A CPU either has an **MMU** (`CpuSpec.mmu = { tlb }`: cpu2 and up; cpu0 and cpu1 have none) or it does not. With translation on, the CPU's instruction fetches, loads and stores use **virtual addresses**: a 20-bit space (1 MiB) of 256-byte pages (the size of a drive block and of a DRAM row), translated through a **two-level page table** the OS keeps in RAM:

```
virtual address:  [ level 1 index (6) | level 2 index (6) | offset (8) ]
table entry:      bit 0 valid, bit 1 write, bit 2 execute, bits 8.. the frame (physical address >> 8)
```

Addresses from `DEVICE_BASE` (0x4000_0000) up are devices and are never translated. The MMU is a device on the bus at `MMU_BASE` (`MMU_REG`: status, control, table, vector, fault address and cause, TLB entries, fault count).

- **TLB.** A translation the TLB has costs nothing. A miss is a **table walk**: two reads of the table, each paid like any cache miss (through the L2 and DRAM, so a walk can hit or miss the L2 and open a DRAM row) and waited out by the CPU. The TLB is unified, fully associative, least-recently-used; writing the table register or the control flush bit empties it. Caches are physical: a translation precedes every cache lookup.
- **Page faults** are **precise and restartable.** A fault is an access the tables do not allow (no page, a write to a read-only page, a fetch from a page without execute, an address outside 20 bits). The faulting instruction has done nothing, everything older has finished, everything younger is gone; the CPU goes to the OS handler (`MMU_REG.VECTOR`) on physical addresses; `iret` re-runs the instruction with translation on again (the MMU remembers it was on: a trap or an interrupt switches it off, `iret` back on). The handler reads the faulting address and cause from the MMU and the retry address from the interrupt controller (`EPC`). Engines: the in-order ones take it at EX (the stage is never speculative), the out-of-order one at commit (a wrong-path fault is squashed with the instruction); fetch faults ride on the fetched slot so speculative fetch never traps. Counters `tlbHits / tlbMisses / pageFaults`.

A CPU without an MMU cannot switch translation on (`STATUS` bit 0 is 0), and programs only ever see physical memory.

## OS 2 (the paged OS)
`os2` ("Paged OS 2.0", level 8; `OsSpec.needsMmu`) cannot be installed on a CPU without an MMU, and a machine whose CPU was swapped for one falls back to the key loader. Its kernel gives every job an address space (`kmap`) before it runs:

| virtual | what | how |
|---|---|---|
| 0x0000–0x0fff | the boot ROM (the job ends by jumping into it) | identity, read and run |
| 0x1000.. | the program's image | physical + 0x1000, read, write, run |
| 0x4000–0x7fff | the heap | **claimed by page faults** |
| 0xc000–(kernel end) | the OS (header, kernel, job table) | identity, read and run, **never written** |
| 0xf000–0xffff | the stack | **claimed by page faults** |

`kpf` is the page-fault handler: a fault on a page of the heap or the stack takes a frame from the kernel's bump pointer (`KBUMP`, from `PAGED_HEAP` up to the tables at `PAGED_TABLES`), zeroes it, maps it read and write, and returns; the program's registers are restored, the instruction runs again. Any other fault (the OS, the ROM, an unmapped page, a write to read-only memory, no frames left) goes to `kfault`: the job is killed with the `SEGFAULT` result and counted (`KFAULTS`, `Snapshot.faults`), exactly like OS 1's protection fault. So **programs claim memory as they need it**, and the frames they claimed are what the RAM view and the CLI process table show (`work` regions, read from `KBUMP`); the frames go back when the next job starts. OS 1 keeps the memory protection unit and needs no MMU.

## Seen
- **Die:** a `TLB` block (one cell per entry, showing the virtual page and the frame it maps to) between the register file and the D-cache, with a link from fetch and one from the load/store unit ("translate") and one to the L2 or the system bus ("page walk"); drawn only on CPUs with an MMU.
- **CLI monitor:** `VM  TLB 8  HIT 91%  FAULTS 12` under the memory line (page faults the kernel fixed count; killed jobs are `Snapshot.faults`).
- **RAM view:** the program at physical + 0x1000, its claimed frames, and `Page tables` as OS memory.
- **Shop and picker:** the CPU's TLB size is a stat; its description says "MMU, n-entry TLB" or "no MMU: physical memory only". OS 2's install is blocked with the reason on a CPU without one.

## Next
1. Several programs resident (OS 2's second half): a process table per address space, cooperative switching when a program yields, a context switch in the kernel (registers, table register).
2. Preemption (OS 3): a timer interrupt, the same context switch on a clock.
3. Swap: evict pages to the spool when the frames run out; real drive time, so RAM size matters again.
4. The page tables in the RAM magnifier (virtual and physical address side by side, a fault outlining its page), and live TLB events on the die (a fill, a walk, a fault).
