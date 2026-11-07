# Save / load and the worker protocol

Code: `src/worker/game/save.ts` (format, `parseSave`, `migrate`), `Game.toSave()` / `Game.fromSave(save, economy?)` (`persist.ts`, `game.ts`), `src/worker/protocol.ts` (messages), `src/worker/host.ts` (pure worker logic), `src/worker/worker.ts` (thin wiring), `src/app/store.ts` (main thread).

## Shape (`SaveV5`, `SAVE_VERSION` = 5)

Plain JSON, config only:

`version` (4), `seed`, `prngState` (machine PRNG, one uint32), `money`, `baseTick`, `nextKeyId`, `completed`, `errors`, `dropped`, `avgTurnaround` (reputation is derived from it and the tray), `lastCompleted`, `board` (`boardToJson`: tier, **`caseTier`** (the PC case, additive: a save without it puts the board in the smallest case that holds it), **installed** devices with spec, slot, clock setting, `burnt`, and (v4) the board's own `burnt` flag: a dead VRM), `inventory` (`[{id, spec}]`: owned, not installed; `spec` is a device id, a board tier id like `board1` or a case tier id like `case1`), `nextInvId`, `cables` (`{atx, cpu, video, lan}` booleans; `lan` defaults to false when missing), `video` (additive: the far end of the video cable, `"board"` or a GPU slot like `"pcie1"`; absent = board), `tray` (keys lying in the tray as `{id, template, seed, scale, arrival, deadline}`, oldest first), `plugged` (the key in the USB port, or null: same fields plus `attempts`, `pluggedAt`, `done`, `doneAt`, `result`), `tripped` (PSU hard trip), `progress` (the tutorial milestones, 15 booleans, see ASSEMBLY.md), `os` (v3: `{spec, deviceId}` of the installed OS, or `null`; the drive is the installed storage device with that id), and `sandbox` (optional, written only by a sandbox game: `true`; see [`SANDBOX.md`](SANDBOX.md)). Storage drives are plain `board.devices` entries and `inventory` may hold storage and OS item ids. Keys the OS has ingested and the player unplugged are saved as plain `tray` keys (the kernel's queue is RAM and does not survive a load). **Network block** (added with the network phase, additive, no version bump): optional `net { ispTier, routerTier, lan, networkLinked, deadTicks, offers[], spool[] }` where `offers` and `spool` are job seeds like tray keys (offers include downloads that were in flight; the spool is re-ingested by the kernel after the first boot), plus five new `progress` booleans (`ispBought routerInstalled lanConnected linkUp firstNetJob`) that default to false. Transfer progress is never saved. The sandbox flag is unaffected. A save without `net` loads with no plan, no router and no cable.

Programs are regenerated from `template + seed + scale` on load. About 1.5 KB.

## Not preserved

Powered state and phase (the game always loads **powered off**), raw disk bytes and statistics (the boot image is rebuilt from `os` on load, dataset bytes from their seeds; `bytesRead/Written` restart; the ledger, wear and bad groups ARE saved, see "Disks and contracts" below), the kernel's job table, pipeline/registers/RAM/display contents, PCH register state, cache state, engine counters, clock-scheduler phase, device temperatures, the VRM temperature and burn-damage accumulators (temperatures restart at ambient; the board's burnt flag is saved), the event log, the economy config (the loader uses the build's `ECONOMY`; tests pass overrides). The fast-model calibration cache does not exist yet (design: "Fast model" below).

## Load semantics

The machine loads powered off with the phase `off`, wherever it was. A **plugged key stays plugged**:

- a job in progress (the key does not hold a result) **restarts from boot** at the next power-on: the ROM runs POST, finds the key in its one look at the port, loads it and runs it from the first instruction (the same as a hard power-off); `attempts`, `arrival` and `pluggedAt` are kept, so turnaround still counts from arrival; the job log marks the run `reloaded` and counts its counters only from the restart (nothing new is saved for it: `ranAt` and the counters are re-stamped, see src/features/jobs/JOBS.md "The log");
- a finished key (`done`, with its `result`) stays finished: at power-on the ROM goes straight to `JOB DONE` (halted) and removing the key pays out;
- the machine is always off after a load: a plugged key plus a power press is the whole no-OS flow.

Saved while **halted with no key plugged**: load, press power once on both sides, and the games match exactly on money, tick, counters, reputation, tray, inventory, cables, progress, PRNG state and board over 500 ticks (tested). Saved with a job in flight: money, tray, counters, PRNG state and board match at the load instant; the job then finishes later than it would have (it restarts), so later values diverge. Loading the same save twice gives identical runs. Saved while hot (near `throttleC`): the machine restarts cool.

There is no offline progress: while the game is closed nothing runs, because without automation nothing happens unless the player plugs and removes keys. The design for a machine with an OS and a linked network is "Fast model" below (not built).

## Versioning

`parseSave(unknown)` runs `migrate` (chain `MIGRATIONS[n]`: v_n to v_n+1), then validates (types, ranges, known specs and templates, board via `boardFromJson`, cables, progress) and throws `Error("save: ...")` with a specific message. Newer-than-supported and unknown versions are rejected. When the shape changes: bump `SAVE_VERSION`, add the migration, keep an old fixture in the tests (`save.test.ts` has a v1 fixture).

**`cables.pcie` (no version bump, T70)**: the PCIe power lead of the accelerators (src/features/gpu/ACCEL.md). It is additive like the ethernet cable: `parseSave` fills `false` when a save has none, so a save from before it loads with the lead unplugged. ACCEL.md planned a 4 to 5 bump with a migration; an optional field needs none and this keeps the version chain short.

**Fan cables and radiators (no version bump)**: `cables` also holds `cpufan`, `vrmfan`, `ramfan`, `sysfan` and one `fan:<mount>` per fan mount of the saved case (src/features/cpu/ASSEMBLY.md "Fan cables and radiators"). A save that lacks them was made when the fans needed no plug, so `persist.ts` reads them as **plugged** (a new game starts them unplugged). A saved liquid cooler with no radiator gets a `rad1` on the case's top (or its front) so it keeps cooling. The radiator is an ordinary device in slot `rad-front` or `rad-top`; a save from when it took one mount (`rad-top1`, `rad-rear`) is moved to that side by `legacyRadiatorSlots`.

**`progress.coolerInstalled` (no version bump)**: the cooler used to be pre-mounted, so saves of every version up to now have no such flag. `parseSave` derives it when it is missing: true if the saved board has a cooler device (all older saves), else false. The shape otherwise did not change, so `SAVE_VERSION` stays 4; a v4 save that lacks the key is accepted, one that has it is read as is. Tested in `save.test.ts` (`coolerInstalled in older saves`). v1 saves get it from the all-true migration.

**`firstBootTick` and `progress.firstManualCycle` (no version bump)**: the client patience schedule (GAME.md) runs from the first boot, so `toSave` writes an optional `firstBootTick` (base tick of the first power-on, or `null` before it). A v4 save without it is accepted: the schedule then restarts at the load tick (`sinceFirstBoot` 0), never harsher than before. `progress.firstManualCycle` (new tutorial flag) is derived on load when missing: true iff `firstKeyEjected`. Both are optional/derived additions, so `SAVE_VERSION` stays 4; tested in `patience.test.ts`. A plugged key stays plugged and the machine restarts powered off, as before.

**Levels (no version bump, all optional)**: `clientBase` (the score, finite and >= 0), `level` (informational: the level is always derived from `clientBase` on load), `levelTicks` (level number to the base tick it was first reached, drives the job-class ramp; a level not listed counts as long reached), `declined` and `expired` (lifetime counters), and a `cls` (job class id) on every saved key. `parseSave` validates them. A save without `clientBase` (every save from before levels) loads with `clientBase = completed x 1.1`, the level derived from that, `levelTicks = {derivedLevel: loadTick}`, no level-up log line and no celebration (`leveledUpAt` null); parts already installed are never removed or hidden, whatever the level. A key without `cls` gets it from its template (`cli.scan` is `scan`, anything else `cli`). `recentlyUnlocked` and `leveledUpAt` are not saved. The network phase bumps the format to v5 and these ride along.

**`sandbox` (no version bump)**: a sandbox game writes the optional top-level `sandbox: true`; `toSave` leaves it out for a campaign game. `parseSave` checks it is a boolean when present, and `Game.fromSave` restores money to `SANDBOX_MONEY` and the sandbox rules. A save without it is a campaign game, as before. A sandbox save also carries the sandbox's own edits: `sandboxLevel` (the pinned rules level, an integer 1 to `MAX_LEVEL`, always written), `sandboxOff` (job classes switched off) and `sandboxKindsOff` (job dex kinds switched off), the two lists only when not empty. All optional and additive; ids that no longer exist are dropped on load and a campaign game ignores them. `SAVE_VERSION` stays 4. Tested in `sandbox.test.ts` (`sandbox save`).

**Disks and contracts (no version bump, both optional)**: `disks` is a list with one record per storage device that holds something or wore: `deviceId`, `mount` (`clean`, `dirty`, `damaged`, `unformatted`: the dirty flag survives), `files` (the ledger: `id`, `owner`, `kind`, `extents` as `[first, len]`, `soft`, `lost`, `seed`), `written` (blocks that hold data outside the files that reserve their blocks: the written part of a soft file, stray writes), `media` (`wear` as sparse `[group, writes]`, `bad` groups, `rng` the mechanical-fault stream) and `twin` (the same for a RAID module's second member). Records only, never bytes: on load the ledger and the `used` bitmap are rebuilt from the records (`DiskFs.restore`) and a dataset's bytes are regenerated from its `seed` (`datasetBytes`). The OS drive's `os` and `spool` records are not restored: `formatOs` recreates the boot image and the spool region first, then the other files (datasets) go on top. A record that no longer fits (blocks taken or out of range, a duplicate id) is dropped. A save without `disks` (every older save) loads with the OS drive recreated and every data drive blank (`unformatted`), as before. `contracts` holds `nextId`, `rng` (the offers' stream), `offers` and `active` (the terms, the drive and file ids, the read schedule's `rng` and `nextRead`, the counters, `owed`); reads waiting for the drive are not saved and are requested again. A running contract whose drive or file is gone settles as `lost` at the next tick. The job log keeps its contract entries (`contract` field) like any other. `parseSave` validates both blocks (types, ranges, known mount states, file kinds and contract kinds) and throws `save: ...` messages. Tested in `savedisk.test.ts` (round trips with datasets, wear, a lost file, a mirror, contracts; an old save without the fields; validation).

**Migration 3 to 4** (board tier ladder and VRM): the old tier numbering shifts. **Old tier 0 (2 DIMMs, ATX) becomes Basic (tier 1); old tier 1 (the ATX+ board) becomes Mainstream (tier 2)**, so every installed part stays valid (all old slot ids exist on the new tier). Inventory ids shift the same way (`board1` becomes `board2`). Nothing else changes; the board is not burnt. A fresh v4 game starts on the new Starter board (tier 0). Tested in `save.test.ts` (`migration v3 -> v4`).

**Migration 4 to 5** (fan parts): fans used to be built into the case and the heatsinks; now they are devices (`src/features/cpu/ASSEMBLY.md` "Fan parts"). The migration fits a basic fan of the case's size on every mount, a `fan92` on `cooler0`, one `fan120` on `cooler1` and a `fan40` on `vsink2` / `rsink2` (ids from `nextId`, a taken slot is skipped). A Full case drops `front3` / `top2` and their cables; plugged cables stay plugged, so an old machine turns the same fans. Tested in `fanparts.test.ts` (`saves from before the fan parts`).

**Migration 2 to 3**: adds `os: null` and the three new milestones (`storageInstalled`, `osInstalled`, `firstOsJob`) as false. A v2 save has no storage or OS, so it loads powered off and keeps the reboot-per-job flow exactly as before (tested: the migrated game plays identically to the same game re-saved as v3).

**Migration 1 to 2**: a v1 save becomes a fully assembled, powered-off machine. The installed board is kept as is and **all three cables are connected**; the v1 queue becomes keys in the tray (same ids, seeds, arrivals), and the v1 in-flight request becomes a key at the **front** of the tray (it restarts as a normal job); each v1 `pending` purchase (money already spent) becomes an inventory item (`inv1`...); `nextReqId` becomes `nextKeyId`; all progress milestones are set to true (an existing player skips the tutorial); money, reputation (`avgTurnaround`), PRNG state, counters, `lastCompleted` and `tripped` are kept. Note that the retuned economy applies after loading (pacing, prices, RAM latency), since the loader uses the build's constants.

## Protocol

`ToSim` (also `uninstallOs`, see OS.md): `init {save?, seed?}` (restarts the sim; speed resets to 1x), `setSpeed {speed: 0|1|4|16}` (multiplier of base ticks per second; `64` is accepted only in a sandbox game), the sandbox tools `spawnKey`, `clearQueue`, `repairAll`, `setReputation` (refused outside a sandbox, see [`SANDBOX.md`](SANDBOX.md)), `purchase {id}` (to the inventory), `setCpuClock {clock}`, `powerCycle`, `requestSave`, and the assembly calls `install {invId, slotId?}`, `uninstall {deviceId}`, `connectCable {cable}`, `disconnectCable {cable}`, `powerButton`, `plugKey {keyId}`, `ejectKey` (ASSEMBLY.md).

`FromSim`: `ready`, `snapshot {snapshot}` (the `Game` snapshot), `saved {save}`, `error {message}` (bad save, a refused action with its reason, message before init).

The worker ticks every 100 ms of wall time: `advance` adds `elapsed x speed` base ticks to an accumulator and simulates the whole ones, at most `MAX_TICKS_PER_FRAME` = 128 per call in every game (backlog beyond that is dropped; there is no offline catch-up). A snapshot is posted at most every 100 ms and only if ticks ran, plus immediately after any action and init.

## Main thread (`src/app/store.ts`)

Signals `snapshot`, `speed`, `lastError`, `autosaveOffer`. Actions: `purchase`, `install`, `uninstall`, `connectCable`, `disconnectCable`, `powerButton`, `plugKey`, `ejectKey`, `setSpeed`, `setCpuClock`, `powerCycle`. `exportSave()` downloads `pipeline-city-<tick>.json`; `importSave(file)` validates (and migrates) on the main thread and restarts the worker with it. Every 10 s the latest save goes to `localStorage` (`pipeline-city.autosave`, in try/catch); on startup a valid autosave (any supported version) is offered (Continue / New game) before the sim starts.

## Fast model (design, T87; not built)

Status: a design for the owner to approve (T54 builds it). Nothing below is in the code. Background: `docs/ARCHITECTURE.md` "Fidelity tiers" and "Calibration cache", `src/features/gpu/GPU.md` §9, `src/features/gpu/ACCEL.md` task 10, `src/features/cpu/MULTICORE.md`, `src/features/network/NETWORK.md` "Jobs over the network".

**One use: offline catch-up.** The live game always runs the detailed sim (tier 1), as today. The fast model only fills the time the game was closed. It applies only to the automated pipeline: an OS, a linked network and the machine on. Without them no job arrives on its own (`src/features/cpu/ASSEMBLY.md`), so nothing is caught up.

**Rule: conservative.** Where the model must guess, it guesses slower and poorer than the live game. Offline play never pays more than the same time played live.

### What is calibrated

The live sim measures each job that it runs to delivery. The fast model keeps the mean per **entry**:

- `run`: ticks from the job's first run to its result (`Key.ranAt` to `doneAt`, JOBS.md "The log"). This covers all threads and the work on a card, because it is wall ticks.
- `load`: ticks of the spool ingest (download end to first run), taken only from jobs that found the kernel queue empty. It needs a new stamp at the download's end.
- `work`: the instructions of the job, the `work` that `payout` reads.
- `n` (samples, capped at 16, then a running mean with weight 1/16) and `used` (the base tick of the last sample, for eviction).

Only time and work are kept. CPI, stalls and misses stay in the job log: the fast model needs how long, not why. Transfer times are not measured: they come from the job sizes and the bandwidth at catch-up time (NETWORK.md "Job sizes", "Effective bandwidth").

These samples do not count: a `reloaded` job, a job with no counter window (the machine restarted), the first job after a power-on (cold caches), and every job of a sandbox game.

### Key

An entry's key is `class | hw`. This differs from ARCHITECTURE.md "Calibration cache" (program seed + hardware hash): an offline job has a seed that never ran, so a key per seed would never match. The entry is the mean over the seeds the class drew, at the class's template and scale.

`hw` is a short hash (FNV-1a, 8 hex digits) of the sorted `slot=spec@clock` parts that can change the class's time. Each class has a **mask**: the parts it reads.

| part | in the mask of |
|---|---|
| CPU (spec, so the core count) and its clock setting | every class |
| RAM modules (spec, slot) and the memory clock setting | every class |
| OS spec (its `programSlots`) and the OS drive's spec | every class (every network job goes through the spool) |
| board tier and cooling: cooler, radiators, the fans that are plugged | every class (they set the clock the CPU and the cards can hold) |
| data drives (spec, slot, RAID) | `db` |
| TPM spec (fixed `tpm` domain, no clock setting) | `secure` |
| each working GPU: spec, slot and the clock setting of its domain (`pcie0`, `pcie1`) | `gpu`, `npu` (the NPU's fallback is the GPU) |
| each working NPU: spec, slot and its domain's clock setting | `npu` |

A card is **working** when the sim would launch on it (`Game.onCard`: fitted, not burnt, `pcie` lead plugged). A card that does not work is left out, so its key is the key of the CPU path. So a GPU swap changes the `gpu` and `npu` keys and keeps the `cli` entries (ACCEL.md task 10). The network is not in any key: its limits are read at catch-up time. Cloud-storage contracts are not jobs and have no entry.

### When an entry stops counting

- **A part or a clock setting changes:** nothing is deleted. The key changes, so the old entries stop matching. They stay, in case the player puts the part back.
- **Too few samples:** an entry with `n` under 3 is not used.
- **Eviction:** the cache holds at most 48 entries; a new one evicts the entry with the oldest `used`.
- **The engine's timing changes:** a constant `SIM_VERSION` is saved with the cache. A build with a different value drops the whole cache on load. Bump it when a change can move tick counts (the CPU engine, caches, the kernel, the GPU engine, transfer rules). A change of pay or prices does not: pay is computed at catch-up time with the build's `ECONOMY`.

### Save fields (optional, no version bump)

- `fastModel { v, entries: [{ cls, hw, run, load, work, n, used }] }`. About 3 KB at the cap.
- `savedAt`: wall time of the save (ms since 1970), from the main thread.
- `running`: `true` when the save was made with the machine on, the OS up and the link up. The load still starts the machine powered off, as today.

A save without them loads as today, with no catch-up. `parseSave` validates them; a bad cache is dropped, not an error.

### Offline catch-up

The main thread passes `now` with the save (`init {save, now}`), so the worker stays deterministic. On load:

1. **When.** Only if the save has `running`, a linked network with a plan, an OS, and is not a sandbox game. Elapsed `e = now - savedAt` in seconds; one base tick is one second (speed 1x). Nothing happens if `e` is under 60 s or negative (a clock moved back).
2. **Cap.** `e` is cut to `OFFLINE_CAP` (8 hours, 28,800 ticks; a placeholder for T56). The summary says when the cap cut it.
3. **Rates at the saved level.** Arrivals per tick: `demandRate(cfg, rep, demandMul)` (its mean, not a draw), split by the level's mix after the network's renormalisation (NETWORK.md "Arrival channels"). Only classes with a usable entry and met needs count. The arrivals of the other classes are left out: they neither pay nor expire, so a missing sample never costs reputation.
4. **Capacity.** For class `c` with share `p_c`: `down_c` and `up_c` are its sizes over `downMbps` and `upMbps`, `cpu_c = load_c + run_c` from its entry. The machine serves at most `mu = min(1 / sum(p_c down_c), programSlots / sum(p_c cpu_c), 1 / sum(p_c up_c), slots / sum(p_c (down_c + cpu_c + up_c)))` jobs a tick. `slots` is the spool's capacity (NETWORK.md "Spool"): a job holds its slot from its download's start to its upload's end. The done rate is `r = min(lambda, mu)`. The rest, `lambda - r`, expire.
5. **Turnaround and pay.** Load `rho = lambda / mu`. `T_c = min(deadline_c, (down_c + cpu_c + up_c) / (1 - rho))`, and `T_c = deadline_c` when `rho >= 1` (a full queue). Each done job pays `payout(cfg, work_c, T_c, late, levelPay)` (`slaFactor` for `web`), at the reputation of the window's start.
6. **Apply, job by job.** The window gives whole counts per class (floor). They go through the live rules one job at a time: money, `completed`, `expired`, the reputation's `avgTurnaround`, `clientBase` and the level. One source of truth: no closed form. A few thousand steps cost little.
7. **Level-ups.** The window is cut at each level-up and the rates are found again for the rest. `levelTicks` gets the tick of the cut. A class that unlocks inside the window has no entry yet, so it is left out.
8. **What the window takes.** The saved offers and spool are the first arrivals of the window: done if the window can serve them, else expired. They are then cleared, so the new session starts with an empty offer list. A tray key with its deadline inside the window expires, as it would. A plugged key stays plugged. `baseTick` moves forward by the window, so ramps and patience run on.
9. **Contracts.** Cloud-storage contracts move on by the window with every read served (the machine was up); a term that ends inside it settles as `completed`.
10. **What does not happen offline:** no wear, no heat, no throttle events, no burns, no PSU trip, no bad blocks, no PRNG draws. The PRNG state stays as saved, so the same save and the same `now` give the same result.

After the load, a **While you were away** panel shows the time (and "capped at 8 h" when cut), the jobs done and expired by class, the money earned and a level change.

### Proposed task split (for the owner to approve)

Each line is meant as one TODO entry, in dependency order:

1. **Samples and entries:** stamp the download's end; at delivery, add the job to its entry (`run`, `load`, `work`, `n`, `used`), with the skip rules. Pure sim. Tests: the same job on the same machine gives the same entry; `reloaded` and sandbox jobs add nothing.
2. **Hardware key and masks:** `hwKey(game, cls)`. Tests: a GPU swap keeps `cli` entries and changes `gpu` and `npu`; a CPU clock change moves every class; a TPM changes only `secure`; an unplugged `pcie` lead gives the CPU-path key.
3. **Save fields:** `fastModel`, `savedAt`, `running`; validation, the 48-entry cap, the `SIM_VERSION` drop. Tests in `save.test.ts`: a round trip, an old save without them, a bad cache dropped.
4. **Steady-state model:** a pure function from the entries, the mix, the rates and the network limits to done and expired rates and `T_c` per class. Tests: CPU-bound and link-bound cases, arrivals under capacity all done, arrivals over capacity expire, a class with no entry left out.
5. **Catch-up on load:** `init {save, now}`, the conditions, the cap, the job-by-job apply, level cuts, offers, spool, tray, contracts. Tests: the cap; no catch-up without an OS, a link, `running`, or in a sandbox; the same save loaded twice gives the same game; the PRNG state is unchanged; offline pay is never above the live sim's over the same window (a bot test).
6. **While you were away panel** [visual].
7. **Docs:** this section to "built", ARCHITECTURE.md "Calibration cache" (key per class, not per seed), GPU.md §9, ACCEL.md task 10.

Open points for the owner:

- The cap: 8 hours per load? A daily cap as well?
- Full rate offline, or a discount (many idle games pay less while away)?
- The machine loads powered off after a catch-up, as today. Or should it load on?
- A hidden tab loses time today (the host drops the backlog over 128 ticks a call). The same catch-up could fill that gap when over 60 s are dropped. A later task?
