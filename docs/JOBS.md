# Jobs and the almanac

## The jobs today
A job is a generated program (docs/GEN.md) plus a class (`JOB_CLASSES` in `src/sim/game/levels.ts`) that says what it needs and when clients start sending it.

| class | job (almanac id) | template | what it leans on | memory it keeps | needs |
|---|---|---|---|---|---|
| cli | log, calc, checksum | `cli.log` / `cli.calc` / `cli.checksum` | display, CPU clock / multiplier / loads | bytes | nothing |
| scan | scan | `cli.scan` | RAM latency, banks, D-cache | up to about 8K at 0x4000 | nothing |
| db | in-memory index (db) | `db.index` | RAM size, page faults, TLB, DRAM row conflicts | 32K to 512K at 0x10000 | an OS, a SATA SSD, RAM past the table (96K for the class's 32K) |
| secure | signed transaction | `secure.sign` | TPM, protected-mode surcharge | a few words | TPM and ECC |
| gpu | GPU batch | `gpu.render` | GPU lanes, else the CPU | hundreds of bytes | nothing (a card is faster) |
| npu | inference | `npu.infer` | NPU, else GPU, else CPU | up to a few K | nothing (a card is faster) |
| web, hpc | planned | | | | a network link / several cores |

Until the in-memory index, no job used more than 8K: RAM above that bought nothing. `db.index` is the first job whose working set is the point: it builds a table of 256-byte records (one per page) at `HEAP_BASE` 0x10000 (`indexBytes(scale)`: 32K at scale 1, doubling at 2, 4, 8 and 16 up to 512K), then makes lookups that scatter over all of it (`indexFill`, `indexProbe` in `src/sim/gen/kernels.ts`). Memory is needed at the same virtual addresses on every OS: physical memory on OS 1, demand-paged frames on OS 2 and 3 (docs/RAM.md "How much RAM the OS uses"). Measured on a cpu2 (base clock): the class's 32K job (scale 1) takes 33 ticks on OS 1, 633 on OS 2 and 1189 on OS 3; the 64K job (scale 3) takes 52 ticks on OS 1 and 1223 on OS 2. The difference is the page faults of a paged OS: one per page claimed, each a trap, a frame allocation, a zeroed page and a table update. This is a balance question (payout and patience were set when this job was a cheap placeholder) and is left for the balance pass.

## The almanac
The **Almanac** button in the bottom bar (beside Power; a modal like the shop, Esc closes it) (`src/ui/AlmanacPanel.tsx`, data in `src/sim/game/jobdex.ts`): one card per kind of job, like a pokedex. Each fills in as the player meets it:

| state | shown |
|---|---|
| not met | `? ? ?` and the level clients start sending it |
| met (one arrived) | name, what it is, what it leans on, the memory it keeps, what it needs, the level |
| done (one finished) | the above plus **how to do it better** (tips, each something the sim really does) and the player's record: how many were finished and the fastest run in ticks of machine time |
| planned | name and blurb only (web, hpc) |

The record is per game (`Snapshot.dex`, saved as the optional `jobDex` field, no version bump): `seen` is the tick the first one arrived, `runs` the jobs delivered, `best` the fewest ticks between the key being plugged and the job being done. It updates when a job arrives (`enqueue`) and when one is delivered (`deliver`), by the label the monitor shows (`Key.type`).

To add a job: write its template, give it a class, add its `DexEntry` (blurb, what it leans on, memory, tips). `jobdex.test.ts` checks that every non-placeholder class has an almanac entry and every playable entry has at least two tips.

## The log
The **Log** button in the bottom bar (beside Almanac; a modal, Esc closes it) (`src/ui/LogPanel.tsx`, data and helpers in `src/sim/game/joblog.ts`) lists the jobs that ended, to find where the machine is slow. Every job that ends adds one `JobLogEntry` (`Game.addLog`), kept as the last 60 (`JOB_LOG_CAP`), sent in `Snapshot.jobLog` and saved as the optional `jobLog` field (no version bump):

| outcome | when |
|---|---|
| done | the client has the result (`deliver`: key collected, or the result uploaded) |
| expired | a client took back a job the machine could not run, at its deadline |
| declined | the player declined it (`declineKey`) |

A done job's time is cut in three, in base ticks (seconds): **waiting** (key arrival until the machine took it: the key plugged, or the download started), **running** (taken until the result was written: `doneAt`) and **collecting** (result written until the client had it). A job that never ran has only the wait.

For a run, the log also keeps a **window of the engine's counters** from the job being taken to its result landing (`Key.c0` read at plug or download, `closeWindow` at `doneAt`, `windowOf` the difference): cycles, instructions, the five stall causes, cache hits and misses, TLB misses and page faults. It counts the whole machine, so with several programs at once the numbers are shared among them; if the machine restarted in between (the counters went backwards) the job has no window. The counters are not saved with a running key: a job that is mid-run when the game is loaded logs without a window.

The view: a list of rows (id, kind, a bar in the three phases scaled to the longest in view, total time, payout or *late* / *taken back* / *declined*), filterable by kind and ordered newest or slowest. With no row picked, the right side is a **summary** (counts, the average job's three phases, and the average of each kind of job, longest first). A row opens its **detail**: the three phases, the ticks, the margin to the deadline, the player's fastest run of that kind from the almanac, a **reading** and the machine's counters for the run. `verdictOf` writes the reading from the largest phase: a long wait points at throughput (a faster CPU, an OS that runs several programs, a network plan), a long collect at removing the key, and for a run the biggest stall share (memory, mispredicted branches, earlier results, the memory port), page faults on a paged OS, or compute bound when none stands out.

`joblog.test.ts` covers the phases, the counter window, the readings, the summary, and a game that logs a finished job (with a window and a save round trip) and a declined one.

Not built: the log is not written to disk beyond the save (the last 60 only), a job's page faults are the machine's during the run (not its own when several run), and the readings are text rather than a chart over time.

## Reading the code
A card for a job that has been met has tabs (`src/ui/AlmanacPanel.tsx`, data in `src/sim/game/jobcode.ts`, colouring in `src/ui/highlight.ts`):

- **Assembly** (the core view, unlocked when the job is met). The program the generator makes for the job (`profileOf(template, scale)`, a scale selector for the jobs that have one) is **run on the reference interpreter**, counting every instruction by what it does. The view shows:
  - **Where the work goes:** a bar of the instructions executed by kind (arithmetic and logic, loads, stores, multiplies, branches, system) with their shares, and three **reliance** bars: *compute* (ALU and multiplier), *memory* (loads and stores) and *control* (branches), each a share of the instructions that did something. They point at the hardware to look at: CPU clock and width, caches and RAM, predictor.
  - **Chips:** instructions run, words of code and of data, distinct 256-byte pages touched, bytes moved (per instruction), and the share of conditional branches taken.
  - **Listing:** every word of the program with its address, its bytes, the instruction coloured by kind (the same colours as the die and the RAM view's pills), a heat bar and the count of how many times it ran, with the kernel labels. The words after the last executed instruction are the program's data and are folded into one line.
  - **Source:** the assembler text the generator wrote, with labels and comments.
- **C++ and Python** (unlocked when one of the jobs has been finished): the same job as a person would write it, coloured, with the assembly above kept as the truth. Hand-written per job in `HIGH_LEVEL`.

A **sandbox** game has the whole almanac open: every job (except the planned ones) counts as finished, with all tabs and the tips, and no record.

`jobcode.test.ts` runs every job's program (it halts, shows its text, and its counts add up to the instructions run) and checks that the jobs differ in what they lean on; `highlight.test.ts` checks the colouring and that the pieces always join back to the text.

Not built: the C++ and Python versions are written by hand, not compiled from or checked against the program (the assembly is the program), a side-by-side of a line of C++ with the instructions it became, tips that react to the machine, and entries for the sub-kinds of the GPU and NPU jobs.
