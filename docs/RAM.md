# RAM

## DRAM model (`src/sim/engines/dram.ts`)
Behind the caches the CPU reaches DRAM: **banks**, each with one **row** open in its row buffer. A row is 256 bytes (a page, the OS's unit too); banks interleave by row (row r of bank b is page `r * banks + b`). An access costs a **row hit** (the open row), an **activate** (bank closed) or a **conflict** (another row open: precharge, then activate). A **refresh** closes one bank's row in turn every 6000 CPU cycles. Misses that reach RAM (an L1 miss with no L2, or an L2 miss) pay this instead of the flat `missPenalty`; counters `rowHits / rowEmpty / rowConflicts`, events `Ev.Row` in the stored-state log. A sequential scan therefore stays on open rows and scattered access keeps opening new ones (tested).

`RamSpec` has `banks` (2 / 4 / 8 for ram0..2), `rowBytes` and `rowHit` (share of `latency`). `engineConfigFor` builds `EngineConfig.dram` from the slowest stick's timing and the fewest banks; unpipelined CPUs keep the flat penalty. Without a `dram` setting nothing changes (goldens).

## Look
A stick is labelled by what it is (`8 BANKS`), not its size. At the CPU die's zoom a DRAM chip's grid has one column per bank and the row open in each bank is outlined; the OS's page colours and READ / WRITE highlights stay (docs/DIE.md "Memory"). `RamMap.dram` carries the open rows.

## Larger memory (evaluation)
The sim array stays 64 KiB. To show GB: each RAM tier gets a *scale* (1 sim page stands for N real pages); chips become windows onto a sparse virtual space; the OS table and workload footprints are scaled numbers; only touched pages (`Bus.dirty`, regions) are materialised, everything else is drawn procedurally by LoD (far: bank/row heat; near: pages). DRAM timing already works on any address. Not built yet.
