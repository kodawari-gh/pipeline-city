# Jobs and the almanac

## The catalogue
A **job** is a generated program (docs/GEN.md) plus a **class** (`JOB_CLASSES` in `src/sim/game/levels.ts`: cli, scan, db, web, secure, gpu, npu, hpc) that says how many clients send it and what it needs by default. Inside a class there are **kinds of job**, the almanac's rows (`JOB_DEX` in `src/sim/game/jobdex.ts`). Each kind has its own generator template (the key keeps it, and it names the kind), its own **level** and, when it differs from the class, its own **needs**. The almanac groups them (`DEX_GROUPS`).

**How a kind arrives.** A class is picked from the level's mix, as before. Then `pickTask` chooses among the kinds of that class whose level the player has reached, by the key's seed (weights equal; no extra random draw, so the stream does not depend on it). While only the `legacy` kinds (the ones the class sent before it had several) have arrived, the class sends its own template as it always did, so the first levels play as they used to: levels 1 to 3 are the tutorial and send only the log, calculation and checksum. Everything else arrives one kind at a time from level 4.

**What "locked" means.** A kind has up to two locks, both shown in the almanac (a small `L7` and an icon per need on the row, the same as chips on the page):
- **Level.** Clients do not send it before the player's level reaches the kind's level.
- **Hardware (`needs`).** The machine has to be able to run it (an OS, a SATA SSD, RAM, a network plan of a given tier, a TPM of a given tier, ECC RAM). A job that arrives while the need is unmet cannot be plugged and is taken back at its deadline. The accelerator jobs have no hard need: they run on the CPU without a card, slower, at the same pay, and the page says by how much a card helps (`boost`, measured on the sim's cards).

How the sizes were chosen: a network kind's plan tier follows from what it moves (`WEB_SIZES`): its slower leg takes about 25 ticks on a Basic DSL, so the bigger ones ask for Cable (tier 2) or Fibre (tier 3); `tasks.test.ts` checks that every kind fits its own plan. A memory kind that keeps a buffer at 0x4000 needs RAM that covers it, and the heap kinds need RAM past 0x10000 and an OS.

### Everyday (10 kinds)
Only the CPU and the display; each leans on something different.

| job (almanac id) | template | level | locked behind | leans on |
|---|---|---|---|---|
| Log line (`log`) | `cli.log` | 1 | nothing | display speed, CPU clock |
| Calculation (`calc`) | `cli.calc` | 1 | nothing | CPU clock, multiplier and branch speed |
| Checksum (`checksum`) | `cli.checksum` | 1 | nothing | load and ALU speed, D-cache |
| Fibonacci (`fib`) | `cli.fib` | 4 | nothing | ALU latency, forwarding |
| Reverse text (`reverse`) | `cli.reverse` | 4 | nothing | display speed, byte stores |
| Greatest common divisor (`gcd`) | `cli.gcd` | 5 | nothing | branch predictor, CPU clock |
| Bit count (`popcount`) | `cli.popcount` | 5 | nothing | CPU clock, branch speed |
| Sort (`sort`) | `cli.sort` | 6 | nothing | loads and stores, D-cache, branches |
| Matrix product (`matmul`) | `cli.matmul` | 7 | nothing | the multiplier, loads, CPU width |
| CRC check (`crc`) | `cli.crc` | 8 | nothing | branch predictor, CPU clock |

### Memory-hungry (8 kinds)
Each walks memory in a different pattern, so a different part of the memory system limits it.

| job (almanac id) | template | level | locked behind | leans on |
|---|---|---|---|---|
| Memory scan (`scan`) | `cli.scan` | 5 | nothing | RAM latency, DRAM banks and open rows, D-cache size, memory channels |
| Pointer chase (`chase`) | `mem.chase` | 6 | 24K of RAM | RAM latency, D-cache size |
| Block copy (`stream`) | `mem.stream` | 6 | 17K of RAM | RAM bandwidth, open rows |
| Neighbour sum (`stencil`) | `mem.stencil` | 7 | 17K of RAM | D-cache, CPU width |
| Transpose (`transpose`) | `mem.transpose` | 7 | 17K of RAM | D-cache conflicts, DRAM banks |
| Prime sieve (`sieve`) | `mem.sieve` | 8 | 17K of RAM | D-cache, byte stores, branches |
| In-memory index (`db`) | `db.index` | 5 | an OS + a SATA SSD or better + 96K of RAM | RAM size, page faults (paged OS), TLB size, DRAM banks and row conflicts |
| Hash table (`hashtab`) | `mem.hashtab` | 8 | an OS + 65K of RAM | RAM past 64K, page faults (paged OS), TLB, DRAM banks |

### Network (8 kinds)
The wire part of each is `WEB_SIZES` (what arrives, what goes back); the program is the work the request is about. The stand-in that ran the calculation program is gone.

| job (almanac id) | template | level | locked behind | moves (down / up, MB) | leans on |
|---|---|---|---|---|---|
| Web page (`page`) | `web.page` | 4 | a Basic DSL plan | 4 / 25 | network plan, router, CPU clock |
| API call (`api`) | `web.api` | 4 | a Basic DSL plan | 1 / 1 | client slots, the multiplier |
| Name lookup (`dns`) | `web.dns` | 5 | a Basic DSL plan | 0.5 / 0.5 | client slots, branch predictor |
| Form check (`form`) | `web.form` | 5 | a Basic DSL plan | 8 / 4 | network plan, byte loads |
| Text search (`search`) | `web.search` | 6 | a Cable plan | 20 / 30 | upload speed, branches |
| Upload scan (`upload`) | `web.upload` | 7 | a Cable plan | 300 / 5 | download speed, loads |
| Image resize (`image`) | `web.image` | 8 | a Cable plan | 40 / 40 | network plan, byte loads, CPU width |
| Video chunk (`video`) | `web.video` | 9 | a Fibre plan | 5 / 600 | upload speed, the multiplier |

### Trust (7 kinds)
Each uses the TPM differently (one measurement, a chain, a burst of quotes, sealing, a hash in protected mode, a value sealed again every round). All need a TPM and ECC RAM; the burst of quotes needs the second module.

| job (almanac id) | template | level | locked behind | leans on |
|---|---|---|---|---|
| Signed transaction (`secure`) | `secure.sign` | 9 | a TPM + ECC RAM | TPM speed, protected-mode surcharge |
| Integrity check (`verify`) | `secure.verify` | 9 | a TPM + ECC RAM | TPM measure speed |
| Measured boot (`measure`) | `secure.measure` | 10 | a TPM + ECC RAM | TPM measure speed |
| Protected hash (`encrypt`) | `secure.encrypt` | 10 | a TPM + ECC RAM | the protected-mode surcharge (+2 / +1) |
| Key vault (`vault`) | `secure.vault` | 11 | a TPM + ECC RAM | the header trips (fixed on both modules) |
| Key rotation (`rotate`) | `secure.rotate` | 12 | a TPM + ECC RAM | the header trips, the multiplier |
| Attestation burst (`attest`) | `secure.attest` | 13 | a second-generation TPM + ECC RAM | TPM attest time (60 / 20) |

A quote is the machine's own random word (`machine/tpm.ts`), so the attestation job counts its quotes and prints the count; the others print values the instant fake in the reference interpreter also computes.

### Accelerators (9 kinds)
One job per GPU kernel and one per depth of network. None needs a card: without one the work runs on the CPU, slower, at the same pay (docs/ACCEL.md). The chip on a page, `boost`, is the speed-up measured on the sim (an 8-lane card against the CPU path; a 4x4 NPU against the CPU path).

| job (almanac id) | template | level | locked behind | a card helps | leans on |
|---|---|---|---|---|---|
| Array add (`vadd`) | `gpu.vadd` | 10 | nothing | GPU, about 2x | lanes, CPU copy speed |
| Scale and add (`saxpy`) | `gpu.saxpy` | 10 | nothing | GPU, about 2x | lanes, the multiplier |
| Threshold (`thresh`) | `gpu.thresh` | 11 | nothing | GPU, about 1.4x | lanes taking turns under the mask |
| Blur (`blur3`) | `gpu.blur3` | 11 | nothing | GPU, about 1.6x | lanes, card memory banks |
| Polynomial (`poly`) | `gpu.poly` | 12 | nothing | GPU, about 2x | lanes, card clock |
| Mandelbrot (`mandel`) | `gpu.mandel` | 13 | nothing | GPU, about 15x | lanes, divergence |
| Spinning balls (`sphere`) | `gpu.sphere` | 14 | nothing | GPU, about 7x | lanes, the multiplier |
| Perceptron (`perceptron`) | `npu.perceptron` | 12 | nothing | NPU, about 4x | NPU grid, else GPU, else CPU |
| Inference (`npu`) | `npu.infer` | 12 | nothing | NPU, about 8x | NPU grid, else GPU, else CPU |
| Deep network (`deep`) | `npu.deep` | 14 | nothing | NPU, about 9x | NPU grid, else GPU, else CPU |

`gpu.render`, the job that picked one of the first four kernels by seed, is still a template (a key saved before the split loads and runs) but no class sends it now.

### High-performance (7 kinds, `tasks.hpc.ts`)
The class `hpc` sends threaded programs (docs/MULTICORE.md section 7). Every kind needs the multicore OS 4 (`os >= 4`, which starts the threads) and as many logical cores as it has threads (`cores >= T`); payMul is the class's. One program serves any thread count: thread k (a0) takes its share by k and T (a1), the threads meet at barriers (a shared arrival counter) and add their partial results into one total with `amoadd`. Every kind is race free, so the text is the same under any interleaving, and a program started with a1 = 0 runs as one thread (the generic template tests, the plain reference).

| Kind | Template | Level | Threads | Needs | Leans on |
|---|---|---|---|---|---|
| Parallel sum (`hpc-reduce`) | `hpc.reduce` | 14 | 2 | 2 cores | cores, memory |
| Matrix product (`hpc-matmul`) | `hpc.matmul` | 14 | 2 | 2 cores | cores, the multiplier |
| N-body step (`hpc-nbody`) | `hpc.nbody` | 15 | 2 | 2 cores | cores, barriers after each step |
| Monte Carlo (`hpc-montecarlo`) | `hpc.montecarlo` | 15 | 4 | 4 cores | cores (scales best) |
| Parallel sort (`hpc-sort`) | `hpc.sort` | 16 | 4 | 4 cores | cores, the predictor; thread 0 merges alone |
| Graph search (`hpc-bfs`) | `hpc.bfs` | 17 | 8 | 8 cores | cores, memory latency, a barrier per level |
| Fourier transform (`hpc-fft`) | `hpc.fft` | 17 | 8 | 8 cores | cores, barriers per stage |

The level 14 server CPU (`cpu5s`) has eight logical cores, so it covers every kind. How much faster more hardware cores make a job shows on the long jobs (fft: about 5x from two cores to eight); a short job is dominated by the kernel's own work under the one big lock (start, page faults, the end of the job), so it can finish later on a bigger CPU than on a small one: that is for the balance pass (docs/MULTICORE.md M13).

### Why some groups are not ten
- **Everyday** reaches ten because a program needs only the CPU and the display, so each can be a different dependency (a chain, unpredictable branches, a shift loop, loads and stores, the multiplier, bytes written backwards, a bit loop).
- **Network** is eight: more would only be the same few programs with different sizes. The kinds already differ in size, plan tier and the program.
- **Trust** is seven: the module has six commands (measure, attest, seal, unseal, protect, unprotect), and each kind is a different mix of them. A seventh mix without a new command would repeat one.
- **Accelerators** are nine: the GPU has six distinct kernels and the NPU runs one operation (a dense layer and a ReLU over an 8x8 batch), so a network job can only differ in depth (one to six layers). A convolution, an attention or a different activation would be new NPU hardware, not a new job.
- **Memory-hungry** is eight: the access patterns that differ in what limits them are a stride (scan), a dependent chain (chase), a stream (copy), reuse (stencil), a conflict (transpose), flags (sieve) and scattered heap probes (index, hash table).

### Notes on the index job
Until the in-memory index, no job used more than 8K: RAM above that bought nothing. `db.index` is the first job whose working set is the point: it builds a table of 256-byte records (one per page) at `HEAP_BASE` 0x10000 (`indexBytes(scale)`: 32K at scale 1, doubling at 2, 4, 8 and 16 up to 512K), then makes lookups that scatter over all of it (`indexFill`, `indexProbe` in `src/sim/gen/kernels.ts`). Memory is needed at the same virtual addresses on every OS: physical memory on OS 1, demand-paged frames on OS 2 and 3 (docs/RAM.md "How much RAM the OS uses"). Measured on a cpu2 (base clock): the class's 32K job (scale 1) takes 33 ticks on OS 1, 633 on OS 2 and 1189 on OS 3; the 64K job (scale 3) takes 52 ticks on OS 1 and 1223 on OS 2. The difference is the page faults of a paged OS: one per page claimed, each a trap, a frame allocation, a zeroed page and a table update. This is a balance question (payout and patience were set when this job was a cheap placeholder) and is left for the balance pass.

## The almanac
The **Almanac** button in the bottom bar (beside Power; a modal like the shop, Esc closes it) (`src/ui/panels/AlmanacPanel.tsx`, data in `src/sim/game/jobdex.ts`) is a collection like a pokedex. It is mostly pictures, with words kept to a few.

**The collection** (left) is the kinds of job in collapsible groups (`DEX_GROUPS`: Everyday, Memory-hungry, Network, Trust, Accelerators, Coming soon), each with its colour, a pip per member (empty, met, finished) and a count. A group header folds it; "Coming soon" starts folded. Each job is one plain row, one column wide: its number (01, 02, ..., in the order the groups show them), its name, what it is locked behind (a small `L7` for the level, amber while the player is below it, and an icon for each piece of hardware it needs) and a badge (check: met, gold star: finished, lock: not met). The list carries no pictures, to stay quiet; the colour of the group is the only decoration.

**The sprite** (`spriteOf` in `src/sim/game/jobcode.ts`, drawn by `src/ui/kit/Sprite.tsx`) is the job's real program as a picture: one cell per instruction word that ran, coloured by what the instruction does (the colours of the listing: arithmetic blue, load amber, store green, multiply violet, branch pink, system grey), as bright as it ran often. A job that is not met is a dark silhouette of the same shape on its page. The sprite is on the job's page and in the job log's cards, not in the list.

**The page** (right) shows, for a met job: the big sprite and its number; the name and group; one line of what it is; three **rings** for what the job leans on (compute, memory, control, from the instructions it ran) and the instruction mix as a coloured bar; chips with an icon for what it needs (OS, SSD, RAM, a network plan, a TPM...), the level it arrives at (amber with a lock until the player reaches it, green with a check after), the memory it keeps and, for an accelerator job, a dashed chip for the card that is not needed but helps ("GPU: about 2x faster"); and the player's record (stars for finished jobs, the fastest run). Under that is **the program itself, always on the main page**: the assembly listing (address, bytes, the instruction coloured by kind, a heat bar, how often it ran), in a code window whose title bar toggles ASM, C++ and Python (C++ and Python once a job is finished) and, for ASM, the Listing or the assembler Text. The scale selector and the numbers of the run (instructions, pages, bytes per instruction) are in the metrics card above it, because they change the rings and the mix as well as the program. Last are the **ways to do it better** as chips, an icon for the part (`Tip.part`) and a few words (`Tip.short`): a click opens the sentence (`Tip.text`); a part that does not help (`Tip.none`) is crossed out so the player does not buy it for this job. They are locked chips until one job of the kind is finished.

| state | the page shows |
|---|---|
| not met | the silhouette, `? ? ?`, the level clients start sending it, what it needs, a locked program and locked tips |
| met (one arrived) | the above, with the sprite, rings and assembly, and locked tips and high-level code |
| done (one finished) | everything, with C++ and Python and the tips |
| planned | the silhouette, the name and a line (no kind is planned today) |

The record is per game (`Snapshot.dex`, saved as the optional `jobDex` field, no version bump): `seen` is the tick the first one arrived, `runs` the jobs delivered, `best` the fewest ticks between the key being taken and the job being done. It updates when a job arrives (`enqueue`) and when one is delivered (`deliver`), by the label the monitor shows (`Key.type`).

To add a kind of job: write its template (a `tasks.*.ts` file in `src/sim/gen`, registered in `templates.ts`), add its `DexEntry` (its class and template, its level and needs when they differ from the class, a blurb, what it leans on, the memory it keeps, tips each with a part and a few words), its `CODE_SOURCE` and `HIGH_LEVEL` (`jobcode.ts`), and put its id in a group of `DEX_GROUPS`. For a network kind add its sizes to `WEB_SIZES` (`net/specs.ts`). `jobdex.test.ts` checks that every non-placeholder class has an almanac entry, that every entry is in exactly one group and that the tips have short labels; `tasks.test.ts` that every kind has its own template, is sent only from its level, runs to the end in a game (the trust kinds against a TPM, the network kinds over the link) and is counted in the log and the almanac under its own name; the generator tests run every template on the reference interpreter and the engines.

## The log
The **Log** button in the bottom bar (beside Almanac; a modal, Esc closes it) (`src/ui/panels/LogPanel.tsx`, data and helpers in `src/sim/game/joblog.ts`) lists the jobs that ended, to find where the machine is slow. Every job that ends adds one `JobLogEntry` (`Game.addLog`), kept as the last 60 (`JOB_LOG_CAP`), sent in `Snapshot.jobLog` and saved as the optional `jobLog` field (no version bump):

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
The page of a job that has been met shows its program on the main page (`src/ui/panels/AlmanacPanel.tsx`, data in `src/sim/game/jobcode.ts`, colouring in `src/ui/tutorial/highlight.ts`):

- **Assembly** (the core view, unlocked when the job is met, and the tab the page opens on). The program the generator makes for the job (`profileOf(template, scale)`, a scale selector for the jobs that have one) is **run on the reference interpreter**, counting every instruction by what it does. From that the page draws:
  - **The sprite** and **where the work goes:** the program as a picture (see above), a bar of the instructions executed by kind (arithmetic and logic, loads, stores, multiplies, branches, system), and three **rings** for what the job leans on: *compute* (ALU and multiplier), *memory* (loads and stores) and *control* (branches), each a share of the instructions that did something. They point at the hardware to look at: CPU clock and width, caches and RAM, predictor.
  - **Numbers:** instructions run, distinct 256-byte pages touched and bytes moved per instruction, beside the tabs.
  - **Listing:** every word of the program with its address, its bytes, the instruction coloured by kind (the same colours as the die and the RAM view's pills), a heat bar and the count of how many times it ran, with the kernel labels. The words after the last executed instruction are the program's data and are folded into one line.
- **Source:** the assembler text the generator wrote, with labels and comments.
- **C++ and Python** (unlocked when one of the jobs has been finished): the same job as a person would write it, coloured, with the assembly kept as the truth. Hand-written per job in `HIGH_LEVEL`.

A **sandbox** game has the whole almanac open: every job (except the planned ones) counts as finished, with all tabs and the tips, and no record.

`jobcode.test.ts` runs every job's program (it halts, shows its text, and its counts add up to the instructions run), checks that the jobs differ in what they lean on and that their sprites have a cell per executed word and look different; `highlight.test.ts` checks the colouring and that the pieces always join back to the text.

Not built: the C++ and Python versions are written by hand, not compiled from or checked against the program (the assembly is the program), a side-by-side of a line of C++ with the instructions it became, tips that react to the machine, and entries for the sub-kinds of the GPU and NPU jobs.
