# Save / load and the worker protocol

Code: `src/sim/game/save.ts` (format, `parseSave`, `migrate`), `Game.toSave()` / `Game.fromSave(save, economy?)` in `game.ts`, `src/sim/protocol.ts` (messages), `src/sim/host.ts` (pure worker logic), `src/sim/worker.ts` (thin wiring), `src/game/store.ts` (main thread).

## Shape (`SaveV4`, `SAVE_VERSION` = 4)

Plain JSON, config only:

`version` (4), `seed`, `prngState` (machine PRNG, one uint32), `money`, `baseTick`, `nextKeyId`, `completed`, `errors`, `dropped`, `avgTurnaround` (reputation is derived from it and the tray), `lastCompleted`, `board` (`boardToJson`: tier, **installed** devices with spec, slot, clock setting, `burnt`, and (v4) the board's own `burnt` flag: a dead VRM), `inventory` (`[{id, spec}]`: owned, not installed; `spec` is a device id or a board tier id like `board1`), `nextInvId`, `cables` (`{atx, cpu, video, lan}` booleans; `lan` defaults to false when missing), `tray` (keys lying in the tray as `{id, template, seed, scale, arrival, deadline}`, oldest first), `plugged` (the key in the USB port, or null: same fields plus `attempts`, `pluggedAt`, `done`, `doneAt`, `result`), `tripped` (PSU hard trip), `progress` (the tutorial milestones, 15 booleans, see ASSEMBLY.md), `os` (v3: `{spec, deviceId}` of the installed OS, or `null`; the drive is the installed storage device with that id), and `sandbox` (optional, written only by a sandbox game: `true`; see [`SANDBOX.md`](SANDBOX.md)). Storage drives are plain `board.devices` entries and `inventory` may hold storage and OS item ids. Keys the OS has ingested and the player unplugged are saved as plain `tray` keys (the kernel's queue is RAM and does not survive a load). **Network block** (added with the network phase, additive, no version bump): optional `net { ispTier, routerTier, lan, networkLinked, deadTicks, offers[], spool[] }` where `offers` and `spool` are job seeds like tray keys (offers include downloads that were in flight; the spool is re-ingested by the kernel after the first boot), plus five new `progress` booleans (`ispBought routerInstalled lanConnected linkUp firstNetJob`) that default to false. Transfer progress is never saved. The sandbox flag is unaffected. A save without `net` loads with no plan, no router and no cable.

Programs are regenerated from `template + seed + scale` on load. About 1.5 KB.

## Not preserved

Powered state and phase (the game always loads **powered off**), disk contents and statistics (the boot image is rebuilt from `os` on load; `bytesRead/Written` restart), the kernel's job table, pipeline/registers/RAM/display contents, PCH register state, cache state, engine counters, clock-scheduler phase, device temperatures, the VRM temperature and burn-damage accumulators (temperatures restart at ambient; the board's burnt flag is saved), the event log, the economy config (the loader uses the build's `ECONOMY`; tests pass overrides). Fast-model calibration cache does not exist yet.

## Load semantics

The machine loads powered off with the phase `off`, wherever it was. A **plugged key stays plugged**:

- a job in progress (the key does not hold a result) **restarts from boot** at the next power-on: the ROM runs POST, finds the key in its one look at the port, loads it and runs it from the first instruction (the same as a hard power-off); `attempts`, `arrival` and `pluggedAt` are kept, so turnaround still counts from arrival;
- a finished key (`done`, with its `result`) stays finished: at power-on the ROM goes straight to `JOB DONE` (halted) and removing the key pays out;
- the machine is always off after a load: a plugged key plus a power press is the whole no-OS flow.

Saved while **halted with no key plugged**: load, press power once on both sides, and the games match exactly on money, tick, counters, reputation, tray, inventory, cables, progress, PRNG state and board over 500 ticks (tested). Saved with a job in flight: money, tray, counters, PRNG state and board match at the load instant; the job then finishes later than it would have (it restarts), so later values diverge. Loading the same save twice gives identical runs. Saved while hot (near `throttleC`): the machine restarts cool.

There is no offline progress: while the game is closed nothing runs, because without automation nothing happens unless the player plugs and removes keys.

## Versioning

`parseSave(unknown)` runs `migrate` (chain `MIGRATIONS[n]`: v_n to v_n+1), then validates (types, ranges, known specs and templates, board via `boardFromJson`, cables, progress) and throws `Error("save: ...")` with a specific message. Newer-than-supported and unknown versions are rejected. When the shape changes: bump `SAVE_VERSION`, add the migration, keep an old fixture in the tests (`save.test.ts` has a v1 fixture).

**`progress.coolerInstalled` (no version bump)**: the cooler used to be pre-mounted, so saves of every version up to now have no such flag. `parseSave` derives it when it is missing: true if the saved board has a cooler device (all older saves), else false. The shape otherwise did not change, so `SAVE_VERSION` stays 4; a v4 save that lacks the key is accepted, one that has it is read as is. Tested in `save.test.ts` (`coolerInstalled in older saves`). v1 saves get it from the all-true migration.

**`firstBootTick` and `progress.firstManualCycle` (no version bump)**: the client patience schedule (GAME.md) runs from the first boot, so `toSave` writes an optional `firstBootTick` (base tick of the first power-on, or `null` before it). A v4 save without it is accepted: the schedule then restarts at the load tick (`sinceFirstBoot` 0), never harsher than before. `progress.firstManualCycle` (new tutorial flag) is derived on load when missing: true iff `firstKeyEjected`. Both are optional/derived additions, so `SAVE_VERSION` stays 4; tested in `patience.test.ts`. A plugged key stays plugged and the machine restarts powered off, as before.

**Levels (no version bump, all optional)**: `clientBase` (the score, finite and >= 0), `level` (informational: the level is always derived from `clientBase` on load), `levelTicks` (level number to the base tick it was first reached, drives the job-class ramp; a level not listed counts as long reached), `declined` and `expired` (lifetime counters), and a `cls` (job class id) on every saved key. `parseSave` validates them. A save without `clientBase` (every save from before levels) loads with `clientBase = completed x 1.1`, the level derived from that, `levelTicks = {derivedLevel: loadTick}`, no level-up log line and no celebration (`leveledUpAt` null); parts already installed are never removed or hidden, whatever the level. A key without `cls` gets it from its template (`cli.scan` is `scan`, anything else `cli`). `recentlyUnlocked` and `leveledUpAt` are not saved. The network phase bumps the format to v5 and these ride along.

**`sandbox` (no version bump)**: a sandbox game writes the optional top-level `sandbox: true`; `toSave` leaves it out for a campaign game. `parseSave` checks it is a boolean when present, and `Game.fromSave` restores money to `SANDBOX_MONEY` and the sandbox rules. A save without it is a campaign game, as before. `SAVE_VERSION` stays 4. Tested in `sandbox.test.ts` (`sandbox save`).

**Migration 3 to 4** (board tier ladder and VRM): the old tier numbering shifts. **Old tier 0 (2 DIMMs, ATX) becomes Basic (tier 1); old tier 1 (the ATX+ board) becomes Mainstream (tier 2)**, so every installed part stays valid (all old slot ids exist on the new tier). Inventory ids shift the same way (`board1` becomes `board2`). Nothing else changes; the board is not burnt. A fresh v4 game starts on the new Starter board (tier 0). Tested in `save.test.ts` (`migration v3 -> v4`).

**Migration 2 to 3**: adds `os: null` and the three new milestones (`storageInstalled`, `osInstalled`, `firstOsJob`) as false. A v2 save has no storage or OS, so it loads powered off and keeps the reboot-per-job flow exactly as before (tested: the migrated game plays identically to the same game re-saved as v3).

**Migration 1 to 2**: a v1 save becomes a fully assembled, powered-off machine. The installed board is kept as is and **all three cables are connected**; the v1 queue becomes keys in the tray (same ids, seeds, arrivals), and the v1 in-flight request becomes a key at the **front** of the tray (it restarts as a normal job); each v1 `pending` purchase (money already spent) becomes an inventory item (`inv1`...); `nextReqId` becomes `nextKeyId`; all progress milestones are set to true (an existing player skips the tutorial); money, reputation (`avgTurnaround`), PRNG state, counters, `lastCompleted` and `tripped` are kept. Note that the retuned economy applies after loading (pacing, prices, RAM latency), since the loader uses the build's constants.

## Protocol

`ToSim` (also `uninstallOs`, see OS.md): `init {save?, seed?}` (restarts the sim; speed resets to 1x), `setSpeed {speed: 0|1|4|16}` (multiplier of base ticks per second; `64` is accepted only in a sandbox game), the sandbox tools `spawnKey`, `clearQueue`, `repairAll`, `setReputation` (refused outside a sandbox, see [`SANDBOX.md`](SANDBOX.md)), `purchase {id}` (to the inventory), `setCpuClock {clock}`, `powerCycle`, `requestSave`, and the assembly calls `install {invId, slotId?}`, `uninstall {deviceId}`, `connectCable {cable}`, `disconnectCable {cable}`, `powerButton`, `plugKey {keyId}`, `ejectKey` (ASSEMBLY.md).

`FromSim`: `ready`, `snapshot {snapshot}` (the `Game` snapshot), `saved {save}`, `error {message}` (bad save, a refused action with its reason, message before init).

The worker ticks every 100 ms of wall time: `advance` adds `elapsed x speed` base ticks to an accumulator and simulates the whole ones, at most `MAX_TICKS_PER_FRAME` = 128 per call in every game (backlog beyond that is dropped; there is no offline catch-up). A snapshot is posted at most every 100 ms and only if ticks ran, plus immediately after any action and init.

## Main thread (`src/game/store.ts`)

Signals `snapshot`, `speed`, `lastError`, `autosaveOffer`. Actions: `purchase`, `install`, `uninstall`, `connectCable`, `disconnectCable`, `powerButton`, `plugKey`, `ejectKey`, `setSpeed`, `setCpuClock`, `powerCycle`. `exportSave()` downloads `pipeline-city-<tick>.json`; `importSave(file)` validates (and migrates) on the main thread and restarts the worker with it. Every 10 s the latest save goes to `localStorage` (`pipeline-city.autosave`, in try/catch); on startup a valid autosave (any supported version) is offered (Continue / New game) before the sim starts.
