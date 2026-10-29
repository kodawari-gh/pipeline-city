# Timed CPU engines

Code: `src/sim/engines` (import from `src/sim/engines`). No DOM imports. The timed engines (unpipelined, in-order of width 1 or 2, out-of-order) implement `Engine` from `src/sim/machine/engine.ts` (unchanged) and also `PipelineEngine`: `view`, `invalidateCache()`, `flipPredictor(pc?)`.

```ts
import { createEngine } from "src/sim/engines";
machine.attach(createEngine({ kind: "inorder", forwarding: true, sharedPort: false }), program);
```

`EngineConfig` is plain data: `{kind: "ref"}` (RefEngine), `{kind: "unpipelined", ...EngineSettings}`, `{kind: "inorder", ...InOrderSettings}`, `{kind: "inorder2", ...InOrderSettings}` (the in-order engine at width 2), `{kind: "ooo", ...OooSettings}`. The game does not use inorder2 / ooo yet (board specs and save still know only the first three).

## Common behaviour

- **Interrupts** ([`CPU.md`](CPU.md) section 4): every engine reports `drained` (nothing in flight), can `holdFetch` (stop fetching so it drains) and `redirect(pc)`. `Machine.stepCpu` uses them to enter a handler between two instructions. `iret` is a register-less jump to the interrupt controller's `EPC`, flagged as `jalr`; the in-order engines never bundle it behind another instruction and the out-of-order one issues it only as the oldest ROB entry. With no interrupt raised nothing changes (the golden charts are unchanged).

- **Atomics** (`amoadd`, `amoswap`, flag `F.Amo`): read and write one RAM word in a single step, never through the L1 (it is not filled, and a line of it is dropped on the same core), so each costs `HIT_LAT + L2/DRAM miss cost` and takes the shared L2 port on a multicore machine. In order they run in MEM like a load whose store half lands at once. The out-of-order engine issues one only as the oldest ROB entry (every older store has committed), does the read-modify-write at issue and writes `rd` at commit; younger loads wait behind it like behind an unfinished store and never forward its operand. A bad address (not word-aligned RAM) faults like a bad load. `atomics.test.ts` checks every engine against the reference, and two cores on a spin lock.
- **Fetch is a real bus read** of the instruction word; `InstrPool.decodeSlot` decodes it straight into the pool's typed arrays with no allocation (same layout and zeros as `decode` in `src/sim/isa`; `decode.test.ts` compares them on random words). Fetches outside RAM or unaligned give an illegal instruction, which only throws `RangeError` if it reaches EX (wrong-path fetches are squashed first).
- **ecall** halts when it enters WB (`halted` is true, `cycle` is the cycle it shows W). Anything fetched behind it is squashed. `pc` after halting is the address after the ecall, like the reference.
- **Data cache**: direct-mapped, tags only (RAM is write-through, no-allocate, so data always comes from RAM). Only RAM addresses are cached; device (MMIO) accesses bypass it so status polling is always live. A load miss freezes MEM for `missPenalty` extra cycles (`StallCache` counts them). Stores never miss.
- **Instruction cache** is not modelled yet (fetch always takes one cycle).
- `reset(machine, program)` loads the program, clears registers (sp = top of RAM), pipeline, predictor and cache (cold). Flip the predictor or toggle options after `reset`.
- Cycle numbering: the first `step()` is cycle 1 and shows the first instruction in F. The timeline cell for cycle `c` shows where an instruction sits during `c`.

`EngineSettings` (both engines): `cacheLines` 8, `cacheLineBytes` 16, `missPenalty` 4, `timelineRows` 32 (>= 8), `timelineCols` 64.

## Unpipelined (`UnpipelinedEngine`)

One instruction at a time: 5 cycles each (F D X M W), plus `missPenalty` extra M cycles on a load miss. No prediction, no hazards, branches resolve in EX with no penalty. Work happens as the instruction enters a stage: IF reads the word, ID decodes, EX reads registers and computes, MEM accesses data, WB writes back.

## In-order 5-stage (`InOrderEngine`, width 1 or 2)

`InOrderSettings` adds `forwarding` (default true), `sharedPort` (default false) and `width` (1..4, default 1; kind `inorder2` is width 2). The first two live in `engine.options` and may be toggled between steps.

- **Register file** is written in WB before that cycle's reads, so a consumer 3 instructions behind a producer never stalls. Operands are read in EX.
- **Forwarding on**: EX operands are bypassed from the MEM latch (non-loads). The only stall is load-use: 1 bubble (`StallLoad`). **Off**: the consumer waits in ID until the producer has written back: 2 / 1 / 0 bubbles at distance 1 / 2 / 3 (`StallData`).
- **Control flow** is resolved in EX. Fetch predicts: conditional branches use a 1-bit table (64 entries, indexed by `(pc >> 2) % 64`, starts not-taken, updated in EX), `jal` is always predicted taken with the right target (BTB-like predecode in fetch), `jalr` (so `ret`) is predicted not-taken and always flushes. A wrong prediction squashes IF and ID and injects 2 flush bubbles (`StallFlush += 2`).
- **Cache miss** freezes everything behind MEM (IF, ID, EX hold; WB drains). A mispredict found in EX during a freeze still flushes.
- **Shared port**: with `sharedPort`, a fetch in the same cycle as a load/store in MEM loses and an IF bubble with cause `Struct` appears.
- **Width W > 1 (inorder2)**: each stage has W lanes (lane 0 is the oldest). ID holds up to W instructions and issues them as one bundle when (a) each passes the hazard rules above against the previous bundle, (b) no instruction reads or writes a register an earlier one in the bundle writes (RAW / WAW), (c) at most one is a load/store, (d) a branch / jal / jalr / ecall ends the bundle. Otherwise the rest wait in ID one more cycle (`PairBreaks`; `DualIssues` counts cycles two issued together). Fetch brings up to W instructions per cycle and ends a group after any control instruction; a mispredict squashes the whole IF and ID and injects 2 flush bubbles as at width 1. A load-use stall holds the younger instruction and lets older bundle mates through. A cache miss freezes all lanes; a shared port makes the whole fetch group lose. At width 1 every timing is identical to the original engine (the width 1 golden charts did not change).
- Test hooks: `invalidateCache()` empties the cache, `flipPredictor(pc?)` flips one entry (or all). Correctness must not depend on either.
- **Threads (switch-on-miss, width 1, `cpu3t`)**: `engine.addThread(core)` (via `Machine.attachThread`) gives one pipeline several logical cores; the first runs, the others start parked. Each slot in the pool carries a `thread`, and the helpers (registers, MMU, interrupt state) follow it (`useThread`). One thread fetches at a time (`activeCore`; null when every thread waits). When a plain load misses in MEM and another thread is not parked or ended, the load goes to its thread's **miss buffer** (one per thread; it counts the same cycles down, then fills the line, writes its register and retires), the thread's younger instructions in EX, ID and IF are squashed (a `Switch` bubble in IF, `StallSwitch` +2, `ThreadSwitches` +1) and fetch goes on at the next ready thread's saved pc; the first thread resumes at the load's pc + 4 when its miss has landed and fetch is free. An atomic, or an `iret`/`ecall` in EX, freezes the pipe as usual. An interrupt for a thread that is not fetching asks for the core (`switchTo`): the switch happens once the pipeline is empty. A thread that parks or ends hands the core on (`yieldThread`, `endThread`). The machine steps a hardware core once per cycle for the thread it fetches for (`Machine.pickThread`); the TLB is per logical core (each thread has its own entries, which is the tagged TLB with its entries partitioned). A thread that keeps the pipeline for `THREAD_TIMEOUT` (24) cycles while another could run is switched away like a missed load (a lock spinner never misses, so the holder would starve). With one thread, or the others parked, nothing of this runs and the cycles are the plain engine's. Test: `threads.test.ts`.

## Observability: `engine.view` (read-only, live typed arrays)

Documented in `src/sim/engines/view.ts`. Nothing is allocated per step. The renderer should read, never write.

| Field | Type | Meaning |
|---|---|---|
| `width` | number | lanes per stage (1; 2 for inorder2). Stage arrays are indexed `stage * width + lane`, lane 0 oldest; a bubble sits in lane 0 |
| `stageKind[5*width]` | Uint8Array | per stage IF ID EX MEM WB: `SlotKind` Empty 0 / Instr 1 / Bubble 2 |
| `stageId[5*width]` | Int32Array | dynamic instruction id (-1 for none or bubble) |
| `stagePc[5*width]` | Uint32Array | pc of the occupant |
| `stageCause[5*width]` | Uint8Array | bubble cause: `Cause` None 0, Load 1, Data 2, Flush 3, Struct 4 |
| `stageStalled[5*width]` | Uint8Array | 1 if the occupant is held this cycle (ID hazard stall, pairing hold, cache freeze) |
| `counters` | Float64Array | indexed by `Counter` (below) |
| `timeline` | views | ring buffer of the last `rows` instructions |
| `nextId` | number | ids handed out; newest id is `nextId - 1` |

`Counter`: Cycles, Retired, StallLoad, StallData, StallFlush, StallStruct, StallCache, Flushes (mispredicted branch/jalr), FlushedInstrs (squashed wrong-path instructions), Branches, BranchMispredicts, CacheHits, CacheMisses, then the wide-engine counters StallRobFull, StallSchedFull, Issued, LoadForwards, LoadWaits, RobOccupancySum, SchedOccupancySum (ooo) and DualIssues, PairBreaks (inorder width > 1); counters an engine does not use stay 0. Names in `COUNTER_NAMES`. IPC = Retired / Cycles; average ROB occupancy = RobOccupancySum / Cycles. Stall counters count bubbles (or frozen cycles for the cache), by cause.

`timeline`: `rows x cols` ring. Row of instruction `id` is `id % rows`; `id[row]`, `pc[row]`, `word[row]` (raw word, disassemble with `src/sim/isa`), `fate[row]` (`Fate`: InFlight 0, Retired 1, Flushed 2). `codes[row * cols + cycle % cols]` is the stage code for that cycle: `StageCode` None 0, F 1, D 2, X 3, M 4, W 5, Flushed 6, S 7, R 8, C 9; letters in `STAGE_CODE_CHARS = " FDXMWxSRC"` (in-order uses F D X M W x, ooo uses F D S X R C x). A cell is valid while `id[row]` is the instruction you want and the cycle is within the last `cols` cycles. A stalled instruction repeats its letter each cycle; a squashed one gets `x` in the cycle it dies.

## Out-of-order (`OooEngine`, kind `ooo`)

Single core, ported in behaviour from `legacy/src/b2.js`. `OooSettings` (plus the cache settings above): `robSize` 8, `schedSize` 6, `fetchQueue` 4, `width` 2 (fetch / dispatch, 1..4), `commitWidth` (default = width). Sizes are fixed at construction (CPU upgrades apply between requests).

Pipeline: fetch queue (F) -> decode (D, up to `width` entries) -> dispatch (rename via the RAT, one ROB entry + one scheduler entry each; ecall and illegal words skip the scheduler and are done on arrival) -> scheduler (S) -> unit (X) -> result in the ROB (R) -> commit (C). A step runs back to front: commit, execute, issue, dispatch, decode refill, fetch, so a dependent instruction issues the cycle its producer shows R, and a cell shows the stage the instruction is in during that cycle.

- **Units**: ALU0, ALU1 (latency 1; also branches and jumps), MUL (3), LSU (load hit 2, forwarded 2, miss 2 + `missPenalty`, store 1). The LSU does one memory op at a time but a miss does not freeze anything else. Issue is oldest first, at most one instruction per free unit per cycle.
- **Rename**: a register read takes the value from the register file unless an older in-flight writer exists (RAT), in which case it waits for that writer's result. Registers are written only at commit.
- **Memory ordering (conservative)**: a load waits until every older store has executed (`SchedWhy.Memory`, counted in `LoadWaits`), then takes the value from the youngest older store that fully covers it (store-to-load forwarding, `LoadForwards`), waits for the commit if the overlap is only partial (e.g. `sb` then `lw`) or the store is to a device, and otherwise reads RAM and the data cache (hit / miss counted at issue; the line is filled when the load completes). Loads from device addresses, and unaligned or out-of-range ones, run only when they are the oldest instruction in the ROB (`SchedWhy.Head`), so wrong-path work never touches a device and faults are precise. **Stores write memory at commit.**
- **Control flow**: same fetch-time prediction as in-order (1-bit table, jal taken, jalr not taken; a fetch group ends after any control instruction; fetch stops after an ecall until a squash). Branches resolve when they complete (R): the table is updated and, on a mispredict, everything younger is squashed (ROB tail, queues, units, scheduler entries; `x` in the timeline), the RAT is rebuilt from the ROB and fetch restarts at the right pc in the same cycle. There are no flush bubbles; the cost is the refill (about 4 to 5 cycles). `Flushes` / `BranchMispredicts` / `FlushedInstrs` count as in-order.
- **Commit**: up to `commitWidth` finished instructions per cycle, in order. ecall halts when it commits (`pc` is then the address after it) and squashes younger work. An illegal instruction throws `RangeError` only when it commits. Registers and memory equal the reference interpreter at every halt.
- A `commitWidth` larger than `width` lets the ROB drain the backlog that built up under a long miss; with equal widths the machine cannot exceed `width` IPC overall.
- `invalidateCache()` and `flipPredictor(pc?)` work as in-order. `sharedPort` / `forwarding` do not apply.

### Out-of-order view (`engine.view` is an `OooView`)

Same `counters` and `timeline` as above; the inherited `stage*` arrays are unused (empty). Everything is a live typed array, ids are dynamic instruction ids (-1 = empty), nothing is allocated per step.

| Field | Meaning |
|---|---|
| `fetchId/fetchPc[fetchQueueSize]` | fetch queue, oldest first |
| `decodeId/decodePc[width]` | decode queue, oldest first |
| `robId/robPc/robState[robSize]` | the ROB as a ring: logical entry k (0 = oldest) is at `(occ[Occ.RobHead] + k) % robSize` for k < `occ[Occ.Rob]`. `RobState`: Empty 0, Waiting 1 (in the scheduler), Executing 2, Done 3 |
| `schedId/schedPc/schedWhy[schedSize]` | scheduler slots (fixed position until issue). `SchedWhy`: None 0, Operands 1 (waiting for a producer), Memory 2 (load behind an older store), Unit 3 (ready, unit busy), Head 4 (device load waiting to be oldest) |
| `unitId/unitPc/unitLeft/unitTotal[4]` | ALU0 ALU1 MUL LSU (`Unit`): occupant, cycles left, total latency (progress = 1 - left / total) |
| `occ[6]` | counts, indexed by `Occ`: Fetch, Decode, Rob, Sched, Units, RobHead |
| `stall[3]` | why a part made no progress this cycle, indexed by `OooPart` (Fetch, Dispatch, Commit): `FetchStall` None / QueueFull / Stopped (after ecall), `DispatchStall` None / Empty / RobFull / SchedFull, `CommitStall` None / Empty / HeadPending (oldest not done yet) |
| `robSize, schedSize, fetchQueueSize, width` | the configuration |

Timeline lifecycle of an instruction: `F` in the fetch queue, `D` in decode, `S` waiting in the scheduler, `X` in a unit (one letter per cycle of latency), `R` result ready waiting for commit, `C` the commit cycle, `x` the cycle it was squashed. Example (the load misses; dependents wait, the ecall is already done):

```
li s3, 4096    |FDSXRC.........
lw t0, 0(s3)   |FDSSXXXXXXRC...
add t1, t0, t0 |.FDSSSSSSSXRC..
addi t2, t1, 1 |.FDSSSSSSSSXRC.
sw t2, 4(s3)   |..FDSSSSSSSSXRC
ecall          |..FDSRRRRRRRRRC
```

### Full SMT (`threads: 2`, `cpu5h`)

`OooSettings.threads` (1 or 2, `MAX_SMT_THREADS`) makes each logical core a **lane**: its own fetch pc, fetch queue and decode queue, RAT, and a ROB of `robSize / threads` entries (the fetch queue is split the same way). The scheduler, the units (two ALUs, MUL, LSU), the caches, the predictor and the pool of in-flight slots are shared: issue picks the oldest ready entry of either lane, so a thread that is stalled leaves its units to the other, and one that is not competes for them (`Counter.SmtUnitConflicts` counts the cycles an entry waited for a unit the other thread held). Fetch and dispatch give each slot to the lanes in turn; commit takes `commitWidth` entries per cycle from the lane with the older head. A flush (branch, page fault, MMU register write) squashes only its own lane. Helpers (registers, MMU, interrupt state, the bus's core) follow the lane being served (`on(t)`); `Machine.stepSmt` serves each thread's timer, park state, interrupts and protection trips every cycle. `ecall` ends only its thread; the engine halts when every lane has ended or is parked. With one thread, or the second parked, a lane runs as the plain engine did (single-thread goldens are cycle-identical; a parked thread still keeps its half of the ROB and the queue). Test: `smt.test.ts`.

A store that commits to the MMU registers also flushes everything younger in its lane: those instructions were fetched and translated under the old state (the kernel's turn-translation-off store is followed straight away by physical-address accesses).

## Optional parts (all off by default)

Engine settings that a CPU spec can turn on (docs/TECHTREE.md, docs/DIE.md); with them off an engine is exactly as described above (the golden timings do not move; `features.test.ts` "off means off" checks counters too).

| Setting | Default | What it does |
|---|---|---|
| `ways` | 1 | Data cache lines per set (power of two, at most `cacheLines`); least recently used replacement. 1 = direct mapped. |
| `icacheLines` | 0 | Instruction cache (same line size as the data cache; tags only). Fetch that carries on in sequence is a stream and always free (the line is filled on the way); only a **jump** (taken branch, jump, flush, interrupt) has to find its target: a hit is free, a miss waits the miss cost (the L2's if it holds the line, else RAM's; `StallIFetch` counts the cycles, `ICacheHits`/`ICacheMisses` the lookups), then the line is filled; a redirect during the wait starts a new lookup. Not on the unpipelined engine. On the out-of-order engine the stall shows as `FetchStall.ICache`. |
| `redirectPenalty` | 0 | What a jump costs **without** an instruction cache: it waits this many cycles for its target (counted in `StallIFetch`). Default 0 = ideal instruction memory (the engine tests); the specs from `cpu2` up set 2, which is what an instruction cache saves. `cpu0` and `cpu1` leave it 0, so the tutorial's CPUs keep their timings. |
| `l2Lines`, `l2Penalty` | 0, 2 | One L2 (4-way) behind both L1 caches. An L1 miss that hits it costs `l2Penalty` cycles instead of `missPenalty`; an L2 miss costs `missPenalty` and fills the L2 (`L2Hits`/`L2Misses`). |
| `predEntries`, `predBits` | 64, 1 | The branch predictor table: entries and bits per entry. 2 bits = saturating counters (predict taken from 2), which stop a loop exit from flipping the next entry's prediction. `flipPredictor` toggles the prediction and keeps the strength. |

**`MemSystem`** (`memsys.ts`, [`MULTICORE.md`](MULTICORE.md) section 2) holds the L2 and the DRAM and answers `missCost(addr, cycle, counters, events)`: the L2's hit time, or RAM's cost (flat penalty or the DRAM's) with the line filled into the L2. An engine builds its own from its settings, so a single core is unchanged. `useMemSystem(mem)` (before `reset`) hands it one shared with other cores; the engine then does not reset it (its owner does), and `L2Hits`, `L2Misses` and the events go to the asking engine. The L1 caches and the predictor stay in the engine.

**Shared system (several cores)**, switched on by `Machine` (`mem.shared`, only with more than one core; a single core's system never does any of this, so goldens are unchanged):
- **One L2 port.** `missCost` queues each L2 lookup behind the last: one per cycle, on the machine's cycle count (`mem.now`, which `Machine.stepCpu` advances; the cores' own counts differ when one is stalled). The wait is added to the miss cost and counted in `StallL2Port`; every lookup counts in `L2PortBusy` (the sum over cores is `mem.portBusy`). The order a collision is decided in is the step order, which rotates (`Machine` starts at core `now % cores`), so no core always wins. The queue is also in front of the DRAM, which keeps its own per-channel and per-bank queues.
- **Invalidate on write.** An engine that joins the system (`join`, at reset) is told of every store by the others: the store's `logMem(1, ...)` calls `storeLanded`, which drops the line from every other core's L1 D and L1 I (`DataCache.drop`) and logs `Ev.Inval` (which cache, slot, line, writing core) to the victim. `CoherenceInvals` counts lines dropped from this core; `CoherenceMisses` counts its L1 misses on a line dropped that way (`takeDropped`, consumed once). The L2 is never invalidated. Data always comes from RAM, so values are right regardless; this is the timing rule. Two cores writing different words of one line ping-pong it (`coherence.test.ts`).

Counters 22 to 26 are the new ones (`view.ts`). Interrupts stay precise with every part on (`interrupts.test.ts` runs the wide engines with all of them).

## Measured CPI

Cycles per retired instruction, mean of 12 seeds, default settings (cache 8x16 B, miss penalty 4), standalone programs (no boot ROM). `ooo` is robSize 8 / schedSize 6 / fetchQueue 4; `ooo32` is 32 / 16 / 8 with commitWidth 4.

| Program | unpipelined | inorder | inorder2 | ooo | ooo32 |
|---|---|---|---|---|---|
| cli (log, calc, checksum mix) | 5.03 | 1.30 | 1.03 | 0.95 | 0.92 |
| cli.log | 5.00 | 1.32 | 1.08 | 0.95 | 0.91 |
| cli.scan x4 (cache hostile) | 5.30 | 1.45 | 1.15 | 0.96 | 0.93 |

The programs are short and branchy, so the wide engines are bound by fetch (one group per cycle, ended by every control instruction) rather than by the execution units; the gain of ooo over inorder2 is mostly miss overlap on scan.

## Tests

`src/sim/engines/*.test.ts` (the original files are unchanged; the wide engines add `wide.test.ts`, `wide.timing.test.ts`, `wide.golden.test.ts`): correctness against `src/sim/ref` (registers, RAM, display) for every configuration on hand-written and seeded random programs (`testgen.ts`, test-only) with random cache invalidations and predictor flips; timing sanity (bubble counts, flush, freeze length); golden stage charts as inline snapshots (update with `npx vitest run -u` after an intended timing change); determinism. The wide engines are also checked on the generated game programs (every template from `src/sim/gen`, several seeds and scales, display text included), on ROB sizes from 2 to 32 entries, width 4, and with invalidations and predictor flips mid-run; timing sanity covers the pairing rules, a load miss overtaken by independent work, ooo vs inorder2 CPI on the scan job, mispredict squash cost, store-to-load forwarding and the view invariants.
