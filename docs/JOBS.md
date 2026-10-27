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
The **Almanac** button in the bottom bar (beside Power; a modal like the shop, Esc closes it) (`src/ui/AlmanacPanel.tsx`, data in `src/sim/game/jobdex.ts`) is a collection like a pokedex. It is mostly pictures, with words kept to a few.

**The collection** (left) is the kinds of job in collapsible groups (`DEX_GROUPS`: Everyday, Memory-hungry, Network, Trust, Accelerators, Coming soon), each with its colour, a pip per member (empty, met, finished) and a count. A group header folds it; "Coming soon" starts folded. Each job is one plain row, one column wide: its number (01, 02, ...), its name and a badge (check: met, gold star: finished, lock: not met). The list carries no pictures, to stay quiet; the colour of the group is the only decoration.

**The sprite** (`spriteOf` in `src/sim/game/jobcode.ts`, drawn by `src/ui/Sprite.tsx`) is the job's real program as a picture: one cell per instruction word that ran, coloured by what the instruction does (the colours of the listing: arithmetic blue, load amber, store green, multiply violet, branch pink, system grey), as bright as it ran often. A job that is not met is a dark silhouette of the same shape on its page. The sprite is on the job's page and in the job log's cards, not in the list.

**The page** (right) shows, for a met job: the big sprite and its number; the name and group; one line of what it is; three **rings** for what the job leans on (compute, memory, control, from the instructions it ran) and the instruction mix as a coloured bar; chips with an icon for what it needs (OS, SSD, RAM, TPM...), the level it arrives at and the memory it keeps; and the player's record (stars for finished jobs, the fastest run). Under that is **the program itself, always on the main page**: the assembly listing (address, bytes, the instruction coloured by kind, a heat bar, how often it ran), in a code window whose title bar toggles ASM, C++ and Python (C++ and Python once a job is finished) and, for ASM, the Listing or the assembler Text. The scale selector and the numbers of the run (instructions, pages, bytes per instruction) are in the metrics card above it, because they change the rings and the mix as well as the program. Last are the **ways to do it better** as chips, an icon for the part (`Tip.part`) and a few words (`Tip.short`): a click opens the sentence (`Tip.text`); a part that does not help (`Tip.none`) is crossed out so the player does not buy it for this job. They are locked chips until one job of the kind is finished.

| state | the page shows |
|---|---|
| not met | the silhouette, `? ? ?`, the level clients start sending it, what it needs, a locked program and locked tips |
| met (one arrived) | the above, with the sprite, rings and assembly, and locked tips and high-level code |
| done (one finished) | everything, with C++ and Python and the tips |
| planned | the silhouette, the name and a line (hpc) |

The record is per game (`Snapshot.dex`, saved as the optional `jobDex` field, no version bump): `seen` is the tick the first one arrived, `runs` the jobs delivered, `best` the fewest ticks between the key being taken and the job being done. It updates when a job arrives (`enqueue`) and when one is delivered (`deliver`), by the label the monitor shows (`Key.type`).

The web class is a stand-in (it runs the calculation program, levels.ts), so its page shows that program until real web code exists.

To add a job: write its template, give it a class, add its `DexEntry` (blurb, what it leans on, memory, tips each with a part and a few words) and put its id in a group of `DEX_GROUPS`. `jobdex.test.ts` checks that every non-placeholder class has an almanac entry, that every entry is in exactly one group, and that the tips have short labels.

## The log
The **Log** button in the bottom bar (beside Almanac; a modal, Esc closes it) (`src/ui/LogPanel.tsx`, data and helpers in `src/sim/game/joblog.ts`) lists the jobs that ended, to find where the machine is slow. Every job that ends adds one `JobLogEntry` (`Game.addLog`), kept as the last 60 (`JOB_LOG_CAP`), sent in `Snapshot.jobLog` and saved as the optional `jobLog` field (no version bump):

| outcome | when |
|---|---|
| done | the client has the result (`deliver`: key collected, or the result uploaded) |
| expired | a client took back a job the machine could not run, at its deadline |
| declined | the player declined it (`declineKey`) |

A done job's time is cut in three, in base ticks (seconds): **waiting** (key arrival until the machine took it: the key plugged, or the download started), **running** (taken until the result was written: `doneAt`) and **collecting** (result written until the client had it). A job that never ran has only the wait.

For a run, the log also keeps a **window of the engine's counters** from the job being taken to its result landing (`Key.c0` read at plug or download, `closeWindow` at `doneAt`, `windowOf` the difference): cycles, instructions, the five stall causes, cache hits and misses, TLB misses and page faults. It counts the whole machine, so with several programs at once the numbers are shared among them; if the machine restarted in between (the counters went backwards) the job has no window. The counters are not saved with a running key: a job that is mid-run when the game is loaded logs without a window.

**On the machine now** is a band at the top of the log, live (the log redraws with every snapshot): one row for each job the machine has been given and has not finished with, from `Snapshot.plugged`, `net.spooled`, `net.offers` and `tray` (`inFlight` in `LogPanel.tsx`), the running one first. A row is the job's sprite, a coloured stage chip (In the tray, On offer, Downloading 42%, Loading, On the drive, Queued with how many are ahead, Running, Result ready, Writing result, Uploading, Collect it, or a lock and "Cannot run" with the missing parts in its tooltip), a bar of the same three phases that fills toward the job's deadline (a tick marks the deadline, a ring turns amber when it is past), the time so far, and the Almanac button. While a job runs the row also carries a live tag, the same reading as the log gives (`liveVerdict`), from the counters since the machine took it (`KeySnap.live`, `KeySnap.startedAt`, `KeySnap.finishedAt`; `livePhases` cuts the time). It shows six rows and counts the rest.

The view is drawn rather than written. The **overview** (`aggregate`, `byKind`) is:
- **A ring of where the time goes** (waiting amber, running cyan, collecting violet) with the average job's total in the middle, three big percentages and one coloured **tag** for what held it up.
- **Inside the runs:** bars, each with an icon and a colour, for what the cycles of the runs were spent on (`stallShares`: waiting on memory, mispredicted branches, waiting on earlier results, the memory port) and instructions per cycle.
- **By kind of job**, the ones that cost the most time first: a card with the job's sprite (the almanac's picture), its count (with small badges for lost and late ones), its average phase bar, its tag and an **Almanac** button that opens that job's page (`openAlmanacFor`, on the assembly).

The tag is the verdict as a kind and one or two words (`Verdict.kind`, `.tag`): *Queue* (a long wait: busy or off machine, a download), *Result sat* (a long collect), *Memory-bound*, *Branchy*, *Dependencies*, *Port-bound* (the biggest stall of the run, at least a fifth of the cycles), *Paging* (page faults and TLB misses on a paged OS), *Compute-bound* (no stall stands out), *Taken back*, *Declined*. The sentence and what to try are its tooltip (`verdictOf` writes them), so the page holds almost no text.

The short list beside it is the recent jobs: the sprite, the name, the phase bar, the time and a coloured icon for the tag. Picking one shows its sprite, tag, payout, ring and three percentages, and the cycle bars of its run, with a way back to the overview.

`joblog.test.ts` covers the phases, the counter window, the readings, the summary, the per-kind aggregation, and a game that logs a finished job (with a window and a save round trip) and a declined one.

Not built: the log is not written to disk beyond the save (the last 60 only), a job's page faults are the machine's during the run (not its own when several run), and the readings are text rather than a chart over time.

## Reading the code
The page of a job that has been met shows its program on the main page (`src/ui/AlmanacPanel.tsx`, data in `src/sim/game/jobcode.ts`, colouring in `src/ui/highlight.ts`):

- **Assembly** (the core view, unlocked when the job is met, and the tab the page opens on). The program the generator makes for the job (`profileOf(template, scale)`, a scale selector for the jobs that have one) is **run on the reference interpreter**, counting every instruction by what it does. From that the page draws:
  - **The sprite** and **where the work goes:** the program as a picture (see above), a bar of the instructions executed by kind (arithmetic and logic, loads, stores, multiplies, branches, system), and three **rings** for what the job leans on: *compute* (ALU and multiplier), *memory* (loads and stores) and *control* (branches), each a share of the instructions that did something. They point at the hardware to look at: CPU clock and width, caches and RAM, predictor.
  - **Numbers:** instructions run, distinct 256-byte pages touched and bytes moved per instruction, beside the tabs.
  - **Listing:** every word of the program with its address, its bytes, the instruction coloured by kind (the same colours as the die and the RAM view's pills), a heat bar and the count of how many times it ran, with the kernel labels. The words after the last executed instruction are the program's data and are folded into one line.
- **Source:** the assembler text the generator wrote, with labels and comments.
- **C++ and Python** (unlocked when one of the jobs has been finished): the same job as a person would write it, coloured, with the assembly kept as the truth. Hand-written per job in `HIGH_LEVEL`.

A **sandbox** game has the whole almanac open: every job (except the planned ones) counts as finished, with all tabs and the tips, and no record.

`jobcode.test.ts` runs every job's program (it halts, shows its text, and its counts add up to the instructions run), checks that the jobs differ in what they lean on and that their sprites have a cell per executed word and look different; `highlight.test.ts` checks the colouring and that the pieces always join back to the text.

Not built: the C++ and Python versions are written by hand, not compiled from or checked against the program (the assembly is the program), a side-by-side of a line of C++ with the instructions it became, tips that react to the machine, and entries for the sub-kinds of the GPU and NPU jobs.
