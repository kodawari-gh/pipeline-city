# Multicore: shared caches, coherence, scheduling, `hpc` jobs

Status: **design, not built** (T85). It is the plan for T53 (multicore) and T50 (the `hpc` class runnable). Everything here builds on what exists: the engines ([`ENGINES.md`](ENGINES.md)), the machine and interrupts ([`MACHINE.md`](MACHINE.md), [`CPU.md`](CPU.md)), the preemptive OS 3 ([`OS.md`](OS.md) "OS 3"), paging ([`VM.md`](VM.md)), the VRM ([`VRM.md`](VRM.md)) and the level ladder ([`PROGRESSION.md`](PROGRESSION.md)). The multicore die layouts already exist ([`DIE.md`](DIE.md) "Multicore"). Numbers are placeholders for the balance pass. Each **proposal** is a default the owner can overrule; the open choices are listed at the end, before the task split.

## What the player gets

- A CPU with 2 to 4 cores (`cpu5s` server style: four small in-order cores; `cpu5h` HPC style: two out-of-order cores; [`TECHTREE.md`](TECHTREE.md) already names the two styles).
- `os4` Multicore OS 4.0 runs programs on every core at once. Under `os1` to `os3` a multicore CPU runs on core 0 and parks the others (honest: those kernels know one core).
- `hpc` jobs: one job, several threads, one per core, that meet at a barrier. More cores finish them sooner, up to the serial part of the job (Amdahl, visible on the die).
- Contention to look at: the shared L2 and the memory controller light up per core, a store on one core visibly knocks a line out of another core's cache, and the VRM works harder.

## 1. The model

```
 core 0                core 1               ...      each core: engine, registers, pc, L1 I and D, TLB, MMU,
 [engine][regs][L1I/D][TLB]  [engine][regs][L1I/D][TLB]      timer, its own interrupt line
          \                    /
           shared L2 (one port per cycle)        <- MemSystem, owned by the Machine
                  |
           memory controller + DRAM (dram.ts)    <- shared: channels, banks, row buffers
                  |
           bus: RAM, display, storage, PCH, GPU, NPU, TPM, sync unit (new)
```

- **All cores share one clock** (the `cpu` domain). On each CPU tick `Machine.stepCpu` steps core 0, then core 1, and so on, in index order. Same save and seed, same cycles: still deterministic.
- **Cores are identical** inside one CPU (one `EngineConfig` per spec, plus `cores: n`). Mixing big and small cores on one chip is out of scope.
- **Per core** (moves out of `Machine` into a `Core`): registers (today `machine.regs`), the engine with its L1 caches, predictor and TLB, the MMU registers, the interval timer, and the interrupt state (EPC, pending, enable). **Shared**: RAM, the L2, the DRAM controller, every device.
- **The bus knows who is asking.** `Machine` sets `bus.core` before stepping each core, so a device can answer per core (the sync unit's `CORE_ID`, the display's row base, the per-core MMU and timer windows). One bus window per per-core device; the device picks the bank by `bus.core`. Nothing else in the bus changes.

## 2. Shared caches

Today each engine owns its L1 D, optional I-cache, optional L2 and optional `Dram` (`EngineBase` in `src/sim/engines/common.ts`).

**Proposal:** split out a `MemSystem` (`src/sim/engines/memsys.ts`) that holds the L2 and the `Dram` and answers "what does a miss at this address cost". The L1 caches stay in the engine (private). On a single-core CPU the engine builds its own `MemSystem` exactly as today, so **every golden timing stays the same**. On a multicore CPU the `Machine` builds one and hands it to every engine at `reset`.

- **One L2 port.** The L2 takes one lookup per CPU cycle. Several cores missing their L1 in the same cycle are served one per cycle, in **round-robin order starting at `cycle % cores`** (fixed order would starve the last core; rotation is still deterministic). A core that loses waits a cycle and counts `StallL2Port`. An L2 miss goes on to the DRAM controller, which already queues bursts per channel and bank; two cores streaming through the same bank group show up as row conflicts.
- **Inclusive enough.** The L2 is shared and unified (instructions and data). No inclusion is enforced: L1s are tag-only and write-through, so evicting an L2 line never needs to touch an L1.
- **Counters per core**: `L2Hits`, `L2Misses`, `StallL2Port`, plus the coherence counters below. The `MemSystem` keeps chip totals (`L2PortBusy` cycles) for the die view.
- **Size**: the multicore specs get a bigger L2 than any single core (64 lines, the default the die layout already draws: `SHARED L2 · all cores`).

## 3. The coherence rule

The caches are **tags only** and RAM is **write-through, no-allocate** (ENGINES.md "Common behaviour"): data always comes from RAM. So the simulation is **functionally coherent for free**: a load on any core sees the newest store from any core. Coherence here is a **timing rule**, which is what makes it simple and safe to add.

**The rule (invalidate on write):** when a store from core k lands (MEM on the in-order engines, commit on the out-of-order one, the same point it writes RAM), every *other* core's L1 D and L1 I drops the line holding that address if it has it. The L2 is shared, so it is never invalidated by a store.

- What it costs: the other core's next load to that line misses its L1 and pays the L2 cost. Counted as `CoherenceInvals` (lines dropped in this core by others) and `CoherenceMisses` (misses on a line this core had until another core wrote it).
- **False sharing is real and visible**: two cores writing different words of the same 16-byte line ping-pong the line. The `hpc` generators avoid it on purpose (each thread's slice is line-aligned), and a later lesson or a sandbox job can show it on purpose.
- Instruction caches are invalidated too, so a kernel loading a program on one core while another core has old code cached is correct in timing as well (it already is in values).
- The TLB is not touched by stores (see section 5 for why no TLB shootdown is needed).

**Memory order.** In-order cores: cores step in a fixed order and every store lands at one point, so the machine is sequentially consistent. Out-of-order cores: a load may read RAM before an older store of *another* core lands, so a racy program could see an order that no interleaving gives. **Proposal:** the game never sends racy programs. Threads share data only across a barrier or a fetch-and-add of the sync unit (section 4), and sync unit accesses are device accesses, which the out-of-order engine already runs only at the head of the ROB, after every older store has committed. So every generated program gives the same result under any timing, which is tested (section 9). Squashing loads on an invalidation (what real out-of-order cores do) is not needed and not built.

## 4. The sync unit (new device)

Threads need an atomic operation and a way to wake each other. **Proposal: a device, not new instructions.** The ISA has no atomics (docs/ISA.md). A device read is already uncached, never speculative and, on the out-of-order engine, done only at the ROB head; cores step one after another. So a read with a side effect is atomic with no engine change.

`SYNC_BASE` (a free window, e.g. `0x4013_0000`), registers in words:

| Register | Read | Write |
|---|---|---|
| `CORE_ID` | the asking core's index | - |
| `CORES` | number of cores | - |
| `FADD[0..7]` | returns the value, then adds 1 (fetch-and-add) | sets the value |
| `BARRIER[0..3]` | the generation number | arrive: the count goes up; at the target the generation goes up and the count resets |
| `BTARGET[0..3]` | | how many arrivals release barrier k |
| `KICK` | | bit c raises core c's interrupt line (an inter-processor interrupt) |
| `PARK` | | the asking core stops fetching until a kick or its timer wakes it (the "idle" state, draws idle power) |

Device latency follows the other devices (a few CPU cycles), so a spin on a barrier is visible bus traffic on the die and in the bus view. The kernel uses `FADD` as a lock (ticket lock) for its run queue. A job spins on `BARRIER` with a short back-off. The registers belong to the machine; `os4` hands each job its own `FADD` and `BARRIER` indices (the kernel's are 0, the job slot's above).

**Rejected for now:** an `amoadd` / `amoswap` instruction. It is more "real" but touches the ISA, the assembler, the reference interpreter and all four engines' memory stages. It can replace the device later without changing the generated programs' shape.

## 5. Scheduling across cores (`os4`)

`os4` is `os3` (preemptive, paged, a PCB per context) with a run queue shared by the cores. Requirements: 256K of RAM like `os3`, a multicore CPU with an MMU. `programSlots` 8 (data entry exists).

- **The kernel context runs on core 0 only.** Ingesting keys, network transfers, spooling and flashing results stay where they are and as they are. Cores 1 to n-1 only run program contexts. This keeps every existing device driver single-threaded: no driver ever needs a lock.
- **One shared ready list**, the job table, guarded by a ticket lock on `FADD[0]`. Each core has its own timer and its own `SLICE_CYCLES`. On a timer tick a core saves its context, takes the lock, picks the next ready context nobody runs (`kpick` with a "running on core c" field in the PCB), releases the lock and switches.
- **Affinity**: a core prefers the context it ran last (its L1 and TLB are warm). Moves to another core are counted as `migrations` and shown in the trace panel.
- **Idle cores park** (`PARK`). When core 0 starts a program or a thread becomes ready, it kicks one parked core (`KICK`). A parked core draws idle power (section 7).
- **Display rows.** The display is a device, so the MMU cannot remap it (VM.md: device addresses are never translated), and two cores now print at the same time. **Proposal:** the display gets a per-core row base register; a write from core c to `JOB_ROW` lands in row `JOB_ROW + rowBase[c]`. The kernel sets the row base when it switches a context in, and the save/restore of the row in the PCB (OS 3) is kept per core. A job's text and the output step are unchanged.
- **No TLB shootdowns.** A context's page table changes in two ways: a page fault adds a mapping (a TLB never holds a missing mapping, so other cores need no flush) and the end of the job frees everything (only after all its threads have ended). Each core's MMU loads its own table on a switch, as OS 3 does. So per-core TLBs need no cross-core flush. If a later OS frees pages of a live job, it needs a `KICK`-based shootdown, not designed here.
- **Costs** are measured like OS 3's (about 800 cycles a switch on `cpu2`): add the lock (a few device reads) and the migration misses.

## 6. How a job uses two or more cores

A job declares its thread count `T` in its header (a new generator meta field `threads`, 1 for every existing job). Under `os4`:

1. The kernel loads the image once and builds one address space. It makes **T contexts** that share the page table, each with its own PCB, its own stack (thread k's stack top is `STACK_TOP - k x 4K`, claimed by page faults like today) and `a0 = k`, `a1 = T` at entry.
2. The threads are ordinary contexts in the ready list, so they spread over the free cores. With fewer free cores than threads they time-share, still correctly, only slower.
3. Each thread works on its slice (rows of a matrix, a range of an array), arrives at the job's barrier, and thread 0 combines the partial results and prints the line. The other threads end at the barrier.
4. The job is done when all T threads have ended (a per-job live-thread count in the job table); the output step then runs as today. A fault in any thread kills the job (`SEGFAULT`, as OS 3).

**Generator**: new `tasks.hpc.ts` with the kinds JOBS.md "Coming soon" lists. Each is serial setup, a parallel part split by `a0` with line-aligned slices, a barrier, a serial combine and print. `expectedText` is computed in TypeScript as for every template.

**Reference interpreter**: runs the T threads round-robin, one instruction each, with an instant sync unit. Because the programs are race-free (section 3), the text is the same for any interleaving; a test runs several interleavings to prove it.

**Why it pays more on more cores**: the parallel part is most of the work (about 80 to 90 percent at scale 1), so 2 cores take about 0.55 of the time and 4 cores about 0.33, while the barrier spin, the shared L2 and false sharing show where it stops scaling. Pay uses the class's `payMul` (5 today); a kind that wants 4 cores pays more than a 2-core one.

**Needs**: the class keeps `{kind: "cores", min: 2}` and adds `{kind: "os", min: 4}`; a kind can ask for more cores (`min: 4`, `min: 8`). On a machine without them the job arrives, waits and expires like every unrunnable job.

## 7. Board, power and VRM demand

**Power.** The thermal model's CPU line is `idleW * r + (loadW - idleW) * load * r^3` (`thermal.ts`). For a multicore CPU `load` becomes **busy cores / cores** (a parked core counts as idle), and `loadW` is the whole chip with every core busy. So one job on a four-core chip draws about a quarter of the dynamic power, and the VRM sees the jump when `hpc` jobs fill the cores. The chip has one temperature and one throttle (no per-core hot spots).

**VRM demand** is unchanged in form (`demand = P / vcore`), so it follows the busy cores. Proposed numbers, checked against VRM.md's board ladder and its rule that a CPU at stock on its own board never nears `throttleC`:

| Part | Cores | loadW | Stock demand, all busy | On Enthusiast (120 A) | On Server board4 (proposed 8 x 25 A = 200 A) |
|---|---|---|---|---|---|
| `cpu5s` server | 4 x in-order (cpu2 class, L2 64 lines) | 85 W | 85 A | 0.71 of rating: warm, heavy-load loss, fine with a VRM heatsink | 0.43 |
| `cpu5h` HPC | 2 x out-of-order (cpu4 class) | 110 W | 110 A | 0.92: unstable when overclocked, needs a fan heatsink at stock | 0.55 |

- **Proposal:** both parts are allowed on Enthusiast (level 9) so they work at level 14, but they are the first parts whose stock load leaves almost no VRM room there. `board4` (level 15, already in the table) is where they belong for overclocking, and the reason to buy it.
- **Memory**: four in-order cores missing at once are memory-bound; both parts get a 4-channel controller (`memory: {channels: 4}`), which needs four sticks to pay off. Enthusiast has 8 DIMM slots, so RAM sticks become a multicore purchase too.
- **PSU and cooling**: `psu3` (500 W, level 10) carries them; `cooler3` (liquid, level 11) helps the chip and, as VRM.md says, takes the airflow off the VRM: a real trade-off with these parts.
- **Second socket** (`board4`, PROGRESSION.md level 15): two chips is NUMA (each socket its own memory) and is **not** in this design. `board4` ships with one usable socket; the second stays a drawn, empty socket until a later note.

## 8. Unlock levels

Following PROGRESSION.md's table (the rows below only add detail):

| Level | What | Notes |
|---|---|---|
| 13 | `os3` (exists) | threads and contexts are already there |
| 14 | `cpu5s` (after `cpu3`, about $9,000), `cpu5h` (after `cpu4`, about $11,000), `os4` (about $3,000) | `hpc` arrives (12 percent of the mix, ramping over 600 ticks): kinds `hpc.reduce` (2 cores) and `hpc.matmul` (2 cores) |
| 15 | `board4` server (one socket used, 200 A VRM, more PCIe), `psu4` | `hpc.nbody` (2), `hpc.montecarlo` (4) |
| 16 | | `hpc.sort` (4) |
| 17 | **proposed** `cpu6s` 8 small cores (needs `board4`) | `hpc.bfs` (8), `hpc.fft` (8) |
| 18 | | no new kind |

`cpu5` in `levels.ts` becomes the two ids. The 8-core kinds need a part that does not exist in the table yet (`cpu6s`); without it they would be locked forever, so either it is approved or those two kinds are dropped (open question 2). Sandbox: everything unlocked, as always.

## 9. What else changes

- **Saves**: config only, as today. The CPU id implies its cores; `os4` is an OS id. An in-flight `hpc` job restarts from the start, like every job. No new save field is expected; if `Core` state needs one, bump the version with a migration.
- **Fast model and calibration**: the key gets the core count (it is in the hardware config hash already if the CPU id is). Per-program measurements are per job, all threads included.
- **Worker cost**: n cores is about n times the step cost of one. Only the focused machine runs detailed (ARCHITECTURE "Fidelity tiers"), so this is bounded; measure with `src/sim/bench/speed.ts` before shipping 8 cores.
- **Snapshot**: per-core summary for every core (state: running, parked, in the kernel; context; IPC; stall cause), detailed pipeline state only for the core the die view focuses. The die view picks a core tile (`c<k>.` hover ids exist).
- **Render and UI** (after the sim): live state per tile, the shared L2 cell tinted by the core that touched it last, an invalidation drawn as a short flash from the writing tile to the losing tile, parked tiles dimmed. Trace panel: a core selector. Details go to `render/` docs when built.
- **Tests**: single-core goldens unchanged (the `MemSystem` split must not move a cycle); a multicore CPU under `os1` behaves exactly as its core 0 alone; `hpc` programs equal the reference under several interleavings and every engine; determinism per seed with 2 and 4 cores; coherence counters on a hand-written false-sharing program; `os4` runs 8 programs on 4 cores and every result matches; the VRM numbers above in `vrm.test.ts`.

## 10. Open questions for the owner

1. **Device or instructions for atomics**: the sync unit (proposed) or an `amoadd` instruction.
2. **8-core kinds**: approve a `cpu6s` 8-core part at level 17, or drop `hpc.bfs` and `hpc.fft` (or make them 4-core).
3. **Kernel on core 0 only** (proposed, no driver locks) or a kernel that runs on any core (more parallel ingest, much more work).
4. **Two styles at level 14** (`cpu5s` and `cpu5h`, proposed) or one `cpu5` first and the second style later.
5. **Mix share**: keep `hpc` at the table's 12 to 26 percent, or lower it until the player owns cores (today a quarter of late arrivals would expire on a single-core machine).

## 11. Proposed task split (for owner approval)

In the TODO format; numbers are placeholders (`M1` ...) to be given T numbers when approved. Each is one session; the order is the dependency order.

- [ ] M1 [auto] {opus} Split L2 and DRAM out of the engines into a `MemSystem`; single-core timings unchanged. Files: `src/sim/engines/memsys.ts`, `common.ts`, engine files. Docs: `ENGINES.md`. Done when: every golden and engine test passes unchanged and a test shares one `MemSystem` between two engines.
- [ ] M2 [auto] {opus} Per-core state in the machine: `Core` (regs, engine, interrupt state, timer, MMU), `bus.core`, `stepCpu` over cores in order. Files: `src/sim/machine/*`, engines' `machine.regs` uses, `refEngine.ts`. Docs: `MACHINE.md`, `CPU.md`. Done when: a 1-core machine is cycle-identical and a 2-core machine runs two programs side by side in tests.
- [ ] M3 [auto] {opus} Shared L2 port arbitration and the invalidate-on-write rule with their counters. Files: `memsys.ts`, `common.ts`, `view.ts`. Docs: `ENGINES.md`, this note. Done when: tests show port stalls, a false-sharing ping-pong, and values still equal the reference.
- [ ] M4 [auto] {sonnet} The sync unit device and the display's per-core row base. Files: `src/sim/machine/sync.ts`, `display.ts`, `memmap.ts`. Docs: `CPU.md` memory map. Done when: unit tests for fetch-and-add, barrier, kick and park on a 2-core machine.
- [ ] M5 [auto] {opus} Multicore CPU specs `cpu5s`, `cpu5h` (cores, power per busy core, VRM numbers), `levels.ts` ids, die plan wiring. Files: `specs.ts`, `thermal.ts`, `levels.ts`, `vrm.test.ts`. Docs: `TECHTREE.md`, `VRM.md`, `PROGRESSION.md`. Done when: the parts install, run on core 0 under `os1` to `os3`, and the VRM table above holds in tests.
- [ ] M6 [auto] {opus} `os4`: shared ready list with a ticket lock, kernel on core 0, affinity, park and kick, per-core timer and row base. Files: `src/sim/os/kernel.ts`, `specs.ts`, game wiring. Docs: `OS.md`. Done when: 8 programs on 4 cores all finish with the right text, deterministic per seed.
- [ ] M7 [auto] {opus} Threaded jobs: `threads` meta, T contexts per job in `os4`, reference interpreter with interleaved threads. Files: `src/sim/gen/build.ts`, `src/sim/ref`, `kernel.ts`. Docs: `GEN.md`, `OS.md`. Done when: a 2-thread test job gives the same text under several interleavings and on every engine.
- [ ] M8 [auto] {opus} `tasks.hpc.ts` with the level 14 to 16 kinds, almanac entries, `hpc` class off its placeholder (T50). Files: `src/sim/gen/tasks.hpc.ts`, `levels.ts`, `jobdex.ts`. Docs: `JOBS.md`, `GEN.md`. Done when: the kinds run on a 2- and 4-core machine, faster with more cores, and the generic template tests pass.
- [ ] M9 [auto] {sonnet} Snapshot per core and the die view's live tiles, core selector in the trace panel. Files: `src/sim/game/pipesnap.ts`, `src/render/die/*`, `src/ui/panels/*`. Docs: `DIE.md`, `UI.md`. Done when: a running `hpc` job shows every tile live and the selector switches the detailed view.
- [ ] M10 [owner] Balance pass: prices, `hpc` mix share and pay, measured with the Operator bot on a level 14 machine; decide the 8-core part (open question 2).
