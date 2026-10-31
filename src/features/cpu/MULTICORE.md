# Multicore: shared caches, coherence, SMT, scheduling, `hpc` jobs

Status: **design, not built** (T85). It is the plan for T53 (multicore) and T50 (the `hpc` class runnable). It builds on the engines ([`ENGINES.md`](ENGINES.md)), the machine and interrupts ([`MACHINE.md`](MACHINE.md), [`CPU.md`](CPU.md)), the OS ladder ([`OS.md`](OS.md)), paging ([`VM.md`](VM.md)), the VRM ([`VRM.md`](VRM.md)) and the level ladder ([`PROGRESSION.md`](PROGRESSION.md)). The multicore die layouts already exist ([`DIE.md`](DIE.md) "Multicore"). Numbers are placeholders for the balance pass.

## Decided (owner, 2026-10-29)

1. **Atomics are instructions**: `amoadd` and `amoswap` (section 4), not a device.
2. **Consumer multicore first**: simple multicore parts arrive at **level 9** (after `cpu3`), using the simplest cores, before the level 14 server and HPC parts.
3. **Logical and hardware cores, both by tier**: switch-on-miss multithreading on the in-order consumer parts, full simultaneous multithreading (SMT) on the out-of-order HPC part (section 5). The 8-thread `hpc` kinds run on 8 logical cores, so no extra 8-core part is needed.
4. **The kernel runs on any core**, under **one big kernel lock** first. Finer locks are a later upgrade.
5. **Both styles at level 14**: `cpu5s` server (many small cores) and `cpu5h` HPC (few big cores).
6. **The `hpc` mix stays as in the table** (12 to 26 percent from level 14): jobs without the cores expire, which is the push to buy them, as with the other device-bound jobs.

## What the player gets

- From level 9 a dual-core CPU, then multithreaded cores, then the level 14 server and HPC chips: more programs at once, and later one job over many cores.
- The OS ladder learns to use them: one program per core from `os2`, preemption on every core with `os3`, multithreaded jobs with `os4`.
- `hpc` jobs: one job, several threads that meet at a barrier. More cores finish them sooner, up to the serial part (Amdahl, visible on the die).
- Contention to look at: the shared L2 and the memory controller light up per core, a store on one core visibly knocks a line out of another core's cache, two threads on one core take turns, and the VRM works harder.

## 1. The model

```
 core 0                                core 1                    a core: engine, L1 I and D, TLB, MMU
 [engine][L1I/D][TLB]                  [engine][L1I/D][TLB]      a logical core (hardware thread): registers, pc,
   thread 0a [regs][pc]  thread 0b       thread 1a  thread 1b      interrupt state, timer, its own interrupt line
          \                              /
           shared L2 (one port per cycle)            <- MemSystem, owned by the Machine
                  |
           memory controller + DRAM (dram.ts)        <- shared: channels, banks, row buffers
                  |
           bus: RAM, display, storage, PCH, GPU, NPU, TPM, interrupt controller
```

- **Words.** A *core* is a hardware core: one pipeline. A *logical core* (hardware thread) is what the OS schedules on: registers, pc and interrupt state. A core without multithreading has one logical core. Job needs count **logical** cores; speed depends on how many are hardware cores.
- **All cores share one clock** (the `cpu` domain). On each CPU tick `Machine.stepCpu` steps core 0, then core 1, and so on, in index order. Same save and seed, same cycles.
- **Cores are identical** inside one CPU (one `EngineConfig` per spec, plus `cores` and `threads` per core).
- **Per logical core** (moves out of `Machine`): registers (today `machine.regs`), pc, interrupt state (EPC, pending, enable), the interval timer, the display row base. **Per core**: the engine and its L1 caches, predictor, TLB (entries tagged by thread) and MMU. **Shared**: RAM, the L2, the DRAM controller, every device.
- **The bus knows who is asking.** `Machine` sets `bus.core` (the logical core) before each access window, so per-core devices (interrupt controller banks, MMU, timer, display row base) answer per core. Nothing else in the bus changes.

## 2. Shared caches

Today each engine owns its L1 D, optional I-cache, optional L2 and optional `Dram` (`EngineBase` in `src/features/cpu/sim/engines/common.ts`).

A new `MemSystem` (`src/features/memory/sim/memsys.ts`) holds the L2 and the `Dram` and answers "what does a miss at this address cost". The L1 caches stay in the engine (private to a core, shared by its threads). On a single-core CPU the engine builds its own `MemSystem` exactly as today, so **every golden timing stays the same**. On a multicore CPU the `Machine` builds one and hands it to every engine at `reset`.

- **One L2 port.** The L2 takes one lookup per CPU cycle. Several cores missing in the same cycle are served one per cycle in **round-robin order starting at `cycle % cores`** (rotation, so the last core is not starved; still deterministic). A core that loses waits a cycle and counts `StallL2Port`. An L2 miss goes on to the DRAM controller, which already queues bursts per channel and bank.
- **No inclusion is enforced**: L1s are tag-only and write-through, so evicting an L2 line never touches an L1.
- **Counters per core**: `L2Hits`, `L2Misses`, `StallL2Port`, the coherence counters below; chip totals (`L2PortBusy`) for the die view.

## 3. The coherence rule

The caches are **tags only** and RAM is **write-through, no-allocate** (ENGINES.md "Common behaviour"): data always comes from RAM. So the simulation is **functionally coherent for free**: a load on any core sees the newest store from any core. Coherence here is a **timing rule**.

**The rule (invalidate on write):** when a store or an atomic from core k lands (MEM on the in-order engines, commit on the out-of-order one, the point it writes RAM), every *other* core's L1 D and L1 I drops that line if it has it. The L2 is shared and never invalidated by a store. Threads of one core share its L1, so they never invalidate each other.

- Cost: the other core's next load to the line misses its L1 and pays the L2 cost. Counted as `CoherenceInvals` and `CoherenceMisses`.
- **False sharing is real and visible**: two cores writing different words of one 16-byte line ping-pong it. The `hpc` generators avoid it (line-aligned slices); a lesson or a sandbox job can show it.
- Instruction caches are invalidated too, so a kernel on one core loading a program another core has old code of is right in timing as well.
- The TLB is not touched by stores (see section 6: no shootdown is needed).

**Memory order.** In-order cores step in a fixed order and every store lands at one point: sequentially consistent. Out-of-order cores may read RAM before another core's older store lands, so a racy program could see an order no interleaving gives. **Rule: the game never sends racy programs.** Threads share data only across a barrier or an atomic, and atomics on the out-of-order engine run only at the ROB head (section 4). Every generated program gives the same result under any timing, and a test proves it (section 10). Squashing loads on an invalidation, as real out-of-order cores do, is not built.

## 4. Atomics: `amoadd` and `amoswap`

Two R-format instructions (opcodes left to the implementer, as for the rest of the ISA):

| Instruction | Does |
|---|---|
| `amoadd rd, rs2, (rs1)` | `rd = mem[rs1]; mem[rs1] = rd + rs2` as one step |
| `amoswap rd, rs2, (rs1)` | `rd = mem[rs1]; mem[rs1] = rs2` as one step |

- Word-aligned RAM addresses only; on a device address or misaligned it faults like a bad load.
- **In-order engines**: the read and the write happen in MEM in the same cycle. Cores step one after another, so nothing can come between them. The value comes from RAM; the access **always goes to the L2** (`l2Penalty`, or RAM's cost on an L2 miss), never hits the L1, and invalidates the line in the other cores (section 3). It counts as a load for load-use hazards and as a store for the shared port.
- **Out-of-order engine**: issued only as the oldest ROB entry (`SchedWhy.Head`, as device loads are), so every older store has committed; it reads and writes at commit. Younger loads to the same address wait for it (the conservative ordering already covers a store).
- **Threads of one core**: the atomic is done in one step, so the other thread cannot slip in either.
- The reference interpreter, the assembler, the disassembler and all four engines learn them; the engine tests run them against the reference like every instruction.
- **How programs use them**: a spin lock is `amoswap` of 1, spinning on a plain `lw` until it reads 0 (the load hits the L1 until the owner's release invalidates it: test-and-test-and-set, and the coherence traffic is visible); a barrier is `amoadd` on a counter, then a spin on a generation word.

**Core id, waking and parking** go in the interrupt controller (CPU.md section 4), banked per logical core by `bus.core`: `CORE_ID` (read: the asking logical core), `CORES` (logical cores), `IPI` (write a mask: raise those cores' interrupt line, an inter-processor interrupt), `PARK` (the asking logical core stops fetching until an interrupt; draws idle power), `ROUTE[line]` (which core takes each device line; default core 0).

## 5. Logical cores: two kinds of multithreading

Each core with `threads: 2` holds two logical cores. Which kind depends on the engine:

- **Switch-on-miss (in-order consumer parts).** One thread runs at a time. When its load misses the L1 in MEM, the load moves into a per-thread **miss buffer** (it writes its register when the miss ends), the thread's younger instructions in IF, ID and EX are squashed (as a mispredict: 2 flush bubbles, cause `Switch`), and fetch continues from the other thread's pc. When the other thread misses in turn, or runs out (parked, halted), the core switches back, and the first thread refetches after its load. With one runnable thread it is exactly the plain engine (goldens unchanged). What the player sees: memory-bound jobs hide each other's misses; a compute-bound pair gains nothing. Counters: `ThreadSwitches`, `StallSwitch`.
- **Full SMT (out-of-order HPC part).** Both threads are in the pipeline at once. Fetch alternates per cycle, favouring the thread with fewer instructions in flight. Each thread has its own RAT and half of the ROB; the scheduler, the units, the LSU and the caches are shared. Commit takes from either thread, oldest first within a thread. A mispredict squashes only its own thread. What the player sees: units that sat idle under one thread fill up, and two heavy threads fight for the scheduler. Counters per thread: `Retired`, `Issued`; per core: `SmtUnitConflicts`.
- **Register state** is per thread; the TLB is shared with entries tagged by thread (a context switch on one thread flushes only its entries). Interrupts are taken per thread, between that thread's instructions.
- **The die view** shows a thread's instructions in its own tint; the in-order engine's stage occupant carries a thread bit.

## 6. Scheduling across cores (the OS ladder)

The OS sees logical cores. Each tier adds one thing:

| OS (level) | On a multicore CPU |
|---|---|
| `os1` (3) | core 0 only, the others parked: it knows one core |
| `os2` Paged (8) | **one program per logical core**, each run to completion (no timer), kernel under the big lock. Up to `programSlots` = logical cores, at most 4 |
| `os3` Preemptive (13) | preemption on every logical core: a timer per core, the job table as the shared ready list, up to 8 programs |
| `os4` Multicore (14) | **multithreaded jobs** (section 7), affinity, park and wake |

On a single-core CPU each OS is exactly as today. So the level 9 dual core pays off with `os2` (level 8): two jobs at once.

- **The kernel runs on any core, under one big kernel lock** (an `amoswap` spin lock). Whichever core needs the kernel (a timer tick, a fault, a device interrupt routed to it, a job ending) takes the lock, works and releases it. Drivers stay as they are because only one core is ever inside the kernel. The kernel's own context (ingest, network, spool, flashing results) is a context in the ready list like a program, so any free core runs it. Device interrupts are routed to core 0 by default; the kernel may move them.
- **Picking**: on a timer tick (os3 and up) a core saves its context, takes the lock, picks the next ready context that is not running elsewhere (a "running on core c" field in the PCB), releases the lock and switches. `os4` prefers the context the core ran last (warm L1 and TLB) and counts `migrations`.
- **Idle cores park** (`PARK`). When a context becomes ready, the core that made it ready wakes one parked core with an `IPI`.
- **Display rows.** The display is a device and is never translated (VM.md), and several cores print at once. The display gets a **row base per logical core**: a write to `JOB_ROW` from logical core c lands in row `JOB_ROW + rowBase[c]`. The kernel sets it when it switches a context in; OS 3's row save and restore stay per core. A job's text and the output step are unchanged.
- **No TLB shootdowns.** A page fault only adds a mapping (a TLB never holds a missing one), and a job's pages are freed only when all its threads have ended. Each core loads its own table on a switch. If a later OS frees pages of a live job, it needs an `IPI` shootdown, not designed here.
- **Finer locking** (a lock per driver and for the job table) is a later upgrade, a natural `os5`; the big lock is measured first (its wait shows as `KernelLockSpins`).

## 7. How a job uses two or more cores (`os4`)

A job declares its thread count `T` in its header (a new generator meta field `threads`, 1 for every existing job).

1. The kernel loads the image once and builds one address space. It makes **T contexts** sharing the page table, each with its own PCB and stack (thread k's stack top is `STACK_TOP - k x 4K`, claimed by page faults) and `a0 = k`, `a1 = T` at entry.
2. The threads are ordinary contexts in the ready list and spread over the free logical cores. With fewer cores than threads they time-share: correct, only slower.
3. Each thread works on its slice (line-aligned), arrives at the job's barrier (`amoadd`), and thread 0 combines the partial results and prints the line. The others end at the barrier.
4. The job is done when all T threads have ended (a live-thread count in the job table); the output step runs as today. A fault in any thread kills the job (`SEGFAULT`).

**Generator**: new `tasks.hpc.ts` with the kinds of JOBS.md "Coming soon": serial setup, a parallel part split by `a0`, a barrier, a serial combine and print. `expectedText` is computed in TypeScript as for every template.

**Reference interpreter**: runs the T threads round-robin, one instruction each. The programs are race-free, so the text is the same under any interleaving; a test runs several to prove it.

**Speed**: the parallel part is most of the work (80 to 90 percent at scale 1), so 2 hardware cores take about 0.55 of the time and 4 about 0.33. Two threads on one core gain much less (switch-on-miss: only the misses overlap; SMT: the idle units). Pay uses the class's `payMul`; a kind that wants more cores pays more.

**Needs**: the class keeps `{kind: "cores", min: 2}` (logical cores) and adds `{kind: "os", min: 4}`; a kind can ask for more (`min: 4`, `min: 8`). Without them the job arrives, waits and expires.

## 8. Board, power and VRM demand

**Power.** The CPU line in `thermal.ts` is `idleW * r + (loadW - idleW) * load * r^3`. For a multicore CPU `load` becomes **busy hardware cores / cores**, plus **15 percent of a core** for each core whose second thread is busy too (more of the core switches). A parked logical core counts as idle. `loadW` is the whole chip with every core busy (single thread). The chip has one temperature and one throttle.

**VRM demand** keeps its form (`demand = P / vcore`), so it follows the busy cores. Proposed parts, checked against VRM.md's rule that a CPU at stock on its own board never nears `throttleC` (load ratio well under 1):

| Part (level) | Cores x threads (logical) | Core | loadW | Board it needs | Load ratio at stock, all busy |
|---|---|---|---|---|---|
| `cpu2d` Duo (9) | 2 x 1 (2) | `cpu2` class 5-stage, shared L2 32 lines | 70 W | Enthusiast (120 A) | 0.58 (on Mainstream 1.17: crashes, the lesson) |
| `cpu3t` Duo-T (11) | 2 x 2 switch-on-miss (4) | `cpu2` class + miss buffers, L2 64 lines | 80 W | Enthusiast | 0.67 + the SMT share, warm |
| `cpu5s` server (14) | 4 x 2 switch-on-miss (8) | `cpu2` class, L2 64 lines, 4 channels | 95 W | Enthusiast with a heatsink, `board4` to overclock | 0.79 on Enthusiast; 0.48 on `board4` |
| `cpu5h` HPC (14) | 2 x 2 full SMT (4) | `cpu4` class out-of-order, L2 64 lines, 4 channels | 115 W | Enthusiast with a fan heatsink, `board4` to overclock | 0.96 on Enthusiast; 0.58 on `board4` |

- `board4` (server, level 15): one usable socket, VRM proposed 8 x 25 A = 200 A, more PCIe. The second socket is NUMA (each socket its own memory) and is **not** in this design: it stays a drawn, empty socket.
- **Memory**: several cores missing at once are memory-bound; the level 14 parts get a 4-channel controller, which needs four sticks (Enthusiast has 8 DIMM slots): RAM becomes a multicore purchase too.
- **PSU and cooling**: `psu3` (500 W, level 10) carries them; liquid cooling (`cooler3`, level 11) helps the chip but, as VRM.md says, takes the airflow off the VRM: a real trade-off with these parts.

## 9. Unlock levels

| Level | Buy | Jobs |
|---|---|---|
| 8 | `os2` learns one program per core (exists, single-core today) | |
| 9 | `cpu2d` Duo, about $2,000 (needs Enthusiast, also level 9) | none new: two jobs at once is the gain |
| 11 | `cpu3t` Duo-T, about $5,000 | |
| 13 | `os3` learns preemption on every core | |
| 14 | `cpu5s` (about $9,000), `cpu5h` (about $11,000), `os4` (about $3,000) | `hpc` arrives (12 percent, ramping over 600 ticks): `hpc.reduce` (2), `hpc.matmul` (2) |
| 15 | `board4`, `psu4` | `hpc.nbody` (2), `hpc.montecarlo` (4) |
| 16 | | `hpc.sort` (4) |
| 17 | | `hpc.bfs` (8), `hpc.fft` (8): 8 logical cores, so `cpu5s` |

`cpu5` in `levels.ts` becomes the two ids; `cpu2d` and `cpu3t` are new rows in PROGRESSION.md's table and the CPU tree (TECHTREE.md). Sandbox: everything unlocked.

## 10. What else changes

- **Saves**: config only. The CPU id implies its cores and threads; the OS id its behaviour. In-flight jobs restart from the start. No new save field is expected; if one is needed, bump the version with a migration.
- **Fast model and calibration**: the CPU id is in the hardware config hash, so the key already changes. Measurements are per job, all threads included.
- **Worker cost**: n cores is about n times the step cost of one. Only the focused machine runs detailed (ARCHITECTURE "Fidelity tiers"); measure with `src/features/sandbox/sim/speed.ts` before shipping 4 cores.
- **Snapshot**: a summary per logical core for every core (running, parked, in the kernel; its context; IPC; stall cause), detailed pipeline state only for the core the die view focuses (`c<k>.` hover ids exist).
- **Render and UI** (after the sim): live state per tile, thread tints, the shared L2 cell tinted by the core that touched it last, an invalidation as a short flash from tile to tile, parked tiles dimmed; a core selector in the trace panel.
- **Tests**: single-core and single-thread goldens unchanged (the `MemSystem` split and the thread support must not move a cycle); atomics against the reference on every engine; a multicore CPU under `os1` behaves as its core 0 alone; `hpc` programs equal the reference under several interleavings and every engine; determinism per seed with 2 and 4 cores, with and without threads; coherence counters on a false-sharing program; switch-on-miss hiding a miss; `os2` running two jobs on a Duo; `os3` and `os4` running 8 programs on 4 cores; the VRM table in `vrm.test.ts`.

## 11. Task split (for owner approval)

In the TODO format; numbers are placeholders (`M1` ...) to be given T numbers when approved. One session each, in dependency order.

- [x] M1 [auto] {opus} Split the L2 and DRAM out of the engines into a `MemSystem`; single-core timings unchanged. Files: `src/features/memory/sim/memsys.ts`, `common.ts`, engine files. Docs: `ENGINES.md`. Done when: every golden and engine test passes unchanged and a test shares one `MemSystem` between two engines.
- [x] M2 [auto] {opus} Per-core machine: `Core` and logical-core state (regs, pc, interrupt state, timer, MMU), `bus.core`, `stepCpu` over cores in order. Files: `src/core/sim/*`, the engines' `machine.regs` uses, `refEngine.ts`. Docs: `MACHINE.md`, `CPU.md`. Done when: a 1-core machine is cycle-identical and a 2-core machine runs two programs side by side.
- [x] M3 [auto] {opus} Shared L2 port arbitration and the invalidate-on-write rule with their counters. Files: `memsys.ts`, `common.ts`, `view.ts`. Docs: `ENGINES.md`. Done when: tests show port stalls, a false-sharing ping-pong, and values equal the reference.
- [x] M4 [auto] {opus} `amoadd` and `amoswap`: ISA, assembler, reference, all four engines. Files: `src/features/cpu/sim/isa`, `src/features/cpu/sim/asm`, `src/features/cpu/sim/ref`, `src/features/cpu/sim/engines`. Docs: `ISA.md`, `ENGINES.md`. Done when: engine-vs-reference tests with atomics pass and a 2-core spin lock test counts correctly.
- [x] M5 [auto] {sonnet} Per-core interrupt controller banks (`CORE_ID`, `CORES`, `IPI`, `PARK`, `ROUTE`) and the display row base per logical core. Files: `src/core/sim/hw/intc.ts`, `display.ts`. Docs: `CPU.md`. Done when: unit tests for IPI, park and wake, routing and row base on a 2-core machine.
- [x] M6 [auto] {opus} `cpu2d` Duo spec (power per busy core, VRM numbers, die plan) and `os2` one program per core under the big kernel lock. Files: `specs.ts`, `thermal.ts`, `levels.ts`, `src/features/os/sim/kernel.ts`. Docs: `OS.md`, `TECHTREE.md`, `VRM.md`, `PROGRESSION.md`. Done when: a Duo runs two jobs at once under `os2`, a single core is unchanged, and the VRM rows hold in tests.
- [x] M7 [auto] {opus} Switch-on-miss threads in the in-order engine (miss buffer, per-thread state, thread-tagged TLB) and `cpu3t`. Files: `src/features/cpu/sim/engines/inorder.ts`, `common.ts`, `view.ts`, `specs.ts`. Docs: `ENGINES.md`. Done when: one thread is cycle-identical, two memory-bound threads finish sooner than one after the other, values equal the reference.
- [x] M8 [auto] {opus} `os3` preemption on every core: per-core timers, shared ready list, kernel context on any core. Files: `kernel.ts`, game wiring. Docs: `OS.md`. Done when: 8 programs on 4 logical cores all finish with the right text, deterministic per seed.
- [x] M9 [auto] {opus} `os4` and threaded jobs: `threads` meta, T contexts per job, affinity, park and wake, reference interpreter with interleaved threads. Files: `kernel.ts`, `src/features/os/sim/specs.ts`, `src/features/jobs/sim/gen/build.ts`, `src/features/cpu/sim/ref`. Docs: `OS.md`, `GEN.md`. Done when: a 2-thread test job gives the same text under several interleavings and on every engine.
- [x] M10 [auto] {opus} Full SMT in the out-of-order engine (per-thread RAT and ROB half, shared units) and the `cpu5s`, `cpu5h` specs. Files: `src/features/cpu/sim/engines/ooo.ts`, `view.ts`, `specs.ts`, `levels.ts`. Docs: `ENGINES.md`, `TECHTREE.md`. Done when: one thread is cycle-identical, two threads raise core IPC, values equal the reference.
- [x] M11 [auto] {opus} `tasks.hpc.ts` with the seven kinds, almanac entries, the `hpc` class off its placeholder (T50). Files: `src/features/jobs/sim/gen/tasks.hpc.ts`, `levels.ts`, `jobdex.ts`. Docs: `JOBS.md`, `GEN.md`. Done when: the kinds run on 2, 4 and 8 logical cores, faster with more hardware cores, and the generic template tests pass.
- [x] M12 [auto] {sonnet} Snapshot per logical core, live die tiles with thread tints, a core selector in the trace panel. Files: `src/features/cpu/sim/pipesnap.ts`, `src/features/cpu/render/*`, `src/core/ui/panels/*`. Docs: `DIE.md`, `UI.md`. Done when: a running `hpc` job shows every tile live and the selector switches the detailed view.
- [ ] M13 [owner] Balance pass: prices, `hpc` pay, the big kernel lock's cost, measured with the Operator bot at levels 9, 11 and 14; decide whether finer kernel locks (an `os5`) are worth building.
