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

Until the in-memory index, no job used more than 8K: RAM above that bought nothing. `db.index` is the first job whose working set is the point: it builds a table of 256-byte records (one per page) at `HEAP_BASE` 0x10000 (`indexBytes(scale)`: 32K at scale 1, doubling at 2, 4, 8 and 16 up to 512K), then makes lookups that scatter over all of it (`indexFill`, `indexProbe` in `src/sim/gen/kernels.ts`). Memory is needed at the same virtual addresses on every OS: physical memory on OS 1, demand-paged frames on OS 2 and 3 (docs/RAM.md "How much RAM the OS uses"). Measured on a cpu2, one 32K-scale-1-class job takes a few tens of ticks on OS 1; the 64K job (scale 3) took 172 ticks on OS 1 and about 1400 on OS 2, almost all of it page faults.

## The almanac
`Menu > Almanac` (`src/ui/AlmanacPanel.tsx`, data in `src/sim/game/jobdex.ts`): one card per kind of job, like a pokedex. Each fills in as the player meets it:

| state | shown |
|---|---|
| not met | `? ? ?` and the level clients start sending it |
| met (one arrived) | name, what it is, what it leans on, the memory it keeps, what it needs, the level |
| done (one finished) | the above plus **how to do it better** (tips, each something the sim really does) and the player's record: how many were finished and the fastest run in ticks of machine time |
| planned | name and blurb only (web, hpc) |

The record is per game (`Snapshot.dex`, saved as the optional `jobDex` field, no version bump): `seen` is the tick the first one arrived, `runs` the jobs delivered, `best` the fewest ticks between the key being plugged and the job being done. It updates when a job arrives (`enqueue`) and when one is delivered (`deliver`), by the label the monitor shows (`Key.type`).

To add a job: write its template, give it a class, add its `DexEntry` (blurb, what it leans on, memory, tips). `jobdex.test.ts` checks that every non-placeholder class has an almanac entry and every playable entry has at least two tips.

Not built: per-run detail (which hardware limited this run), tips that react to the machine (for example "your RAM is the limit"), and entries for the sub-kinds of the GPU and NPU jobs.
