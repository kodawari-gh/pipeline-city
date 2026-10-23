# Save / load and the worker protocol

Code: `src/sim/game/save.ts` (format, `parseSave`, `migrate`), `Game.toSave()` / `Game.fromSave(save, economy?)` in `game.ts`, `src/sim/protocol.ts` (messages), `src/sim/host.ts` (pure worker logic), `src/sim/worker.ts` (thin wiring), `src/game/store.ts` (main thread).

## Shape (`SaveV2`, `SAVE_VERSION` = 2)

Plain JSON, config only:

`version` (2), `seed`, `prngState` (machine PRNG, one uint32), `money`, `baseTick`, `nextKeyId`, `completed`, `errors`, `dropped`, `avgTurnaround` (reputation is derived from it and the tray), `lastCompleted`, `board` (`boardToJson`: tier, **installed** devices with spec, slot, clock setting, `burnt`), `inventory` (`[{id, spec}]`: owned, not installed; `spec` is a device id or a board tier id like `board1`), `nextInvId`, `cables` (`{atx, cpu, video}` booleans), `tray` (keys lying in the tray as `{id, template, seed, scale, arrival, deadline}`, oldest first), `plugged` (the key in the USB port, or null: same fields plus `attempts`, `pluggedAt`, `done`, `doneAt`, `result`), `tripped` (PSU hard trip), `progress` (the tutorial milestones, 12 booleans, see ASSEMBLY.md).

Programs are regenerated from `template + seed + scale` on load. About 1.5 KB.

## Not preserved

Powered state and phase (the game always loads **powered off**), pipeline/registers/RAM/display contents, PCH register state, cache state, engine counters, clock-scheduler phase, device temperatures and burn-damage accumulators (temperatures restart at ambient), the event log, the economy config (the loader uses the build's `ECONOMY`; tests pass overrides). Fast-model calibration cache does not exist yet.

## Load semantics

The machine loads powered off with the phase `off`, wherever it was. A **plugged key stays plugged**:

- a job in progress (the key does not hold a result) **restarts from boot** at the next power-on: the ROM runs POST, loads the key and runs it from the first instruction; `attempts`, `arrival` and `pluggedAt` are kept, so turnaround still counts from arrival;
- a finished key (`done`, with its `result`) stays finished: at power-on the ROM goes straight to REMOVE KEY and removing it pays out.

Saved while **waiting for a key** (no key plugged): load, press power once on both sides, and the games match exactly on money, tick, counters, reputation, tray, inventory, cables, progress, PRNG state and board over 500 ticks (tested). Saved with a job in flight: money, tray, counters, PRNG state and board match at the load instant; the job then finishes later than it would have (it restarts), so later values diverge. Loading the same save twice gives identical runs. Saved while hot (near `throttleC`): the machine restarts cool.

There is no offline progress: while the game is closed nothing runs, because without automation nothing happens unless the player plugs and removes keys.

## Versioning

`parseSave(unknown)` runs `migrate` (chain `MIGRATIONS[n]`: v_n to v_n+1), then validates (types, ranges, known specs and templates, board via `boardFromJson`, cables, progress) and throws `Error("save: ...")` with a specific message. Newer-than-supported and unknown versions are rejected. When the shape changes: bump `SAVE_VERSION`, add the migration, keep an old fixture in the tests (`save.test.ts` has a v1 fixture).

**Migration 1 to 2**: a v1 save becomes a fully assembled, powered-off machine. The installed board is kept as is and **all three cables are connected**; the v1 queue becomes keys in the tray (same ids, seeds, arrivals), and the v1 in-flight request becomes a key at the **front** of the tray (it restarts as a normal job); each v1 `pending` purchase (money already spent) becomes an inventory item (`inv1`...); `nextReqId` becomes `nextKeyId`; all progress milestones are set to true (an existing player skips the tutorial); money, reputation (`avgTurnaround`), PRNG state, counters, `lastCompleted` and `tripped` are kept. Note that the retuned economy applies after loading (pacing, prices, RAM latency), since the loader uses the build's constants.

## Protocol

`ToSim`: `init {save?, seed?}` (restarts the sim; speed resets to 1x), `setSpeed {speed: 0|1|4|16}` (multiplier of base ticks per second), `purchase {id}` (to the inventory), `setCpuClock {clock}`, `powerCycle`, `requestSave`, and the assembly calls `install {invId, slotId?}`, `uninstall {deviceId}`, `connectCable {cable}`, `disconnectCable {cable}`, `powerButton`, `plugKey {keyId}`, `ejectKey` (ASSEMBLY.md).

`FromSim`: `ready`, `snapshot {snapshot}` (the `Game` snapshot), `saved {save}`, `error {message}` (bad save, a refused action with its reason, message before init).

The worker ticks every 100 ms of wall time: `advance` adds `elapsed x speed` base ticks to an accumulator and simulates the whole ones, at most 64 per frame (backlog beyond that is dropped; there is no offline catch-up). A snapshot is posted at most every 100 ms and only if ticks ran, plus immediately after any action and init.

## Main thread (`src/game/store.ts`)

Signals `snapshot`, `speed`, `lastError`, `autosaveOffer`. Actions: `purchase`, `install`, `uninstall`, `connectCable`, `disconnectCable`, `powerButton`, `plugKey`, `ejectKey`, `setSpeed`, `setCpuClock`, `powerCycle`. `exportSave()` downloads `pipeline-city-<tick>.json`; `importSave(file)` validates (and migrates) on the main thread and restarts the worker with it. Every 10 s the latest save goes to `localStorage` (`pipeline-city.autosave`, in try/catch); on startup a valid autosave (any supported version) is offered (Continue / New game) before the sim starts.
