# Save / load and the worker protocol

Code: `src/sim/game/save.ts` (format, `parseSave`, `migrate`), `Game.toSave()` / `Game.fromSave(save, economy?)` in `game.ts`, `src/sim/protocol.ts` (messages), `src/sim/host.ts` (pure worker logic), `src/sim/worker.ts` (thin wiring), `src/game/store.ts` (main thread).

## Shape (`SaveV1`)

Plain JSON, config only:

`version` (1), `seed`, `prngState` (machine PRNG, one uint32), `money`, `baseTick`, `nextReqId`, `completed`, `errors`, `dropped`, `avgTurnaround` (reputation is derived from it), `lastCompleted`, `board` (`boardToJson`: tier, devices with spec, slot, clock setting, `burnt`), `pending` (purchases waiting for the current request: device spec ids or a board tier id like `board1`), `queue` (waiting requests as `{id, template, seed, scale, arrival, deadline}`), `current` (the in-flight request, same fields plus `startTick`, `attempts`), `tripped` (PSU hard trip).

Programs are regenerated from `template + seed + scale` on load. About 1 KB.

## Not preserved

Pipeline/registers/RAM/display contents, cache state, engine counters, clock-scheduler phase, device temperatures and burn-damage accumulators (temperatures restart at ambient), the economy config (the loader uses the build's `ECONOMY`; tests pass overrides). Fast-model calibration cache does not exist yet.

## Load semantics

An in-flight request restarts from its first instruction with a fresh engine and blank display (`attempts` and `startTick` are kept, so turnaround still counts from arrival). Hence:

- Saved while **idle** (no request running): continuing matches an uninterrupted run exactly on money, tick, counters, reputation, queue, PRNG state and board (tested over 400 ticks). Idle temperatures are below any throttle point, and clock phase is 0 at base tick boundaries for the integer rates used.
- Saved while a request is **in flight**: money, queue, counters, PRNG state and board match at the load instant; the request then finishes later than it would have (it restarts), so later values diverge. Loading the same save twice gives identical runs.
- Saved while hot (near `throttleC`): the machine restarts cool, so it can run slightly faster than the uninterrupted game.

## Versioning

`parseSave(unknown)` runs `migrate` (chain `MIGRATIONS[n]`: v_n to v_n+1; empty today, identity for v1), then validates (types, ranges, known specs and templates, board via `boardFromJson`) and throws `Error("save: ...")` with a specific message. Newer-than-supported and unknown versions are rejected. When the shape changes: bump `SAVE_VERSION`, add the migration, keep an old fixture in the tests.

## Protocol

`ToSim`: `init {save?, seed?}` (restarts the sim; speed resets to 1x), `setSpeed {speed: 0|1|4|16}` (multiplier of base ticks per second), `purchase {id}`, `setCpuClock {clock}`, `powerCycle`, `requestSave`.

`FromSim`: `ready`, `snapshot {snapshot}` (the `Game` snapshot), `saved {save}`, `error {message}` (bad save, refused purchase or clock, message before init).

The worker ticks every 100 ms of wall time: `advance` adds `elapsed x speed` base ticks to an accumulator and simulates the whole ones, at most 64 per frame (backlog beyond that is dropped; real offline catch-up is out of scope). A snapshot is posted at most every 100 ms and only if ticks ran, plus immediately after purchase / clock / power cycle / init.

## Main thread (`src/game/store.ts`)

Signals `snapshot`, `speed`, `lastError`, `autosaveOffer`. `purchase`, `setSpeed`, `setCpuClock`, `powerCycle`. `exportSave()` downloads `pipeline-city-<tick>.json`; `importSave(file)` validates on the main thread and restarts the worker with it. Every 10 s the latest save goes to `localStorage` (`pipeline-city.autosave`, in try/catch); on startup a valid autosave is offered (Continue / New game) before the sim starts.
