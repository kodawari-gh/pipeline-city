# Sandbox mode

A sandbox game is a campaign game with the money and the tutorial taken out, and a few tools added for trying ideas fast. **The physics stays.** Slots, watts, cooling, the VRM and the power-off rule all still apply; the sandbox only removes what costs time and money.

Code: `src/sim/game/game.ts` (the `sandbox` option), `sandbox.ts` (the sandbox tools), `shop.ts` (the purchase rules), `src/sim/game/economy.ts` (`SANDBOX_MONEY`, `sandboxOffers`), `src/sim/protocol.ts` (`SANDBOX_SPEEDS`), `src/sim/host.ts` (the 64x refusal and the catch-up cap), `src/sim/game/save.ts` (the optional `sandbox` field), `src/game/store.ts` (`startSim` options and the tool actions), `src/ui/panels/NewGame.tsx` (the dialog), `src/ui/shop/SandboxTools.tsx` (the chip and its tools), `src/ui/panels/Hud.tsx` (the infinity sign), `src/ui/tutorial/tutorial.ts` (no tutorial), `src/sim/bench/speed.ts` and `tools/bench-speed.mjs` (the 64x benchmark, see Speed). Tests: `src/sim/game/sandbox.test.ts`, `src/ui/tutorial/tutorial.test.ts` (the sandbox cases).

## Starting one

The **New game** dialog (menu, or the Welcome back prompt's New game) offers two choices:

- **Campaign**: a bare board and the starter crate, the tutorial, money you earn and spend.
- **Sandbox**: then pick **Assembled machine** (the **most powerful machine the game supports**, installed and cabled, powered off, ready for the power button: see below) or **Bare board** (the same crate as the campaign, in the inventory, nothing installed).

In code: `startSim(null, { sandbox: true, preassembled: assembled, maxed: assembled })`, which becomes `new Game({ sandbox: true, preassembled, maxed })`. **The maxed machine** (`Game.buildMaxRig`, the `maxed` option, only with `sandbox` and `preassembled`): the biggest case and board (Full tower, Enthusiast), the top of every ladder (`specsOfKind`: the best CPU, cooler, PSU, VRM heatsink and RAM-VRM heatsink), every DIMM slot filled with the best RAM, every M.2 slot with the fastest drive, the fastest network card, the best OS that is not `later`, the best router and ISP plan, the ethernet cable on the card and the other cables plugged, powered off, with an empty log. It is built with the sandbox's free `purchase` and `install`, so a new tier is picked up by itself, and a part the rules refuse throws with the reason. Plain `preassembled` (the starter machine) is unchanged: the tests and the bench rely on it. In dev scripts use `startSim(null, { sandbox: true, preassembled: true, maxed: true })`. A new sandbox game starts with every progress flag set. `currentStep` and `offerNextLesson` return nothing for a sandbox game, so no tutorial card and no "Next lesson: the OS" offer appear, even though the flags look like a finished campaign.

## What is unlocked

- **Money** is a constant, `SANDBOX_MONEY` = 1,000,000,000. The sim never spends or earns it (income is added only `if (!sandbox)`), and the HUD shows an infinity sign instead of the number.
- **Prices are free.** `cost()` returns 0 in a sandbox, the picker reads "free" instead of a price, and nothing is unaffordable.
- **Every implemented part can be bought**, at any tier, not only the next one. `sandboxOffers` lists every spec of the buyable kinds (CPU, RAM, cooler, PSU, VRM heatsink), including the ones you already have (a swap). Storage drives (`hdd0`, `ssd1`, `nvme2`) and the OS tiers that are not "later" (`os1`) are listed as well, and can be bought more than once; the slots still limit them. The network parts are free too: `nic1..3` (a PCIe card, in the device list), every router (`router1..4`, installed into the router spot) and every ISP plan (`isp1..5`, applied at once; the sandbox plan counts as the web class's plan). The ethernet cable and the link work as in a campaign; USB keys retire after the first link.
- **Any motherboard tier directly**: every tier above the installed one, and the same tier as a replacement when the board is burnt (`sandboxOffers`). A board purchase still needs the machine powered off.
- **Levels are ignored for unlocks** (docs/PROGRESSION.md): nothing is locked, there is no client base (`clientBase` stays 0) and no level-up. The rules (patience, payout, demand and the arrival mix) use a **pinned rules level**, 8 by default, set with the `setLevel` tool (1 to 18). `snapshot.level.sandbox` is true and `level.level` is the pinned level.
- **Nothing else changes in the game rules**: the reputation, demand, keys and expiry run as in a campaign. Jobs the machine cannot run (`web`, `gpu`, ... have no device yet) still arrive and expire; declining is free (the job leaves and `declined` counts, no reputation cost).

## What the physics still enforces

- **Slots**: a part fits only a free socket of its type (CPU, DIMM, PCIe, SATA, M.2, USB, cooler, monitor, ATX, ATX+, VRM heatsink). A tier without a slot type has none of it; the drive counts are limited by the free SATA or M.2 slots.
- **Power**: the PSU's watts against the parts' rated load, and the connector (a PSU with the ATX+ connector needs the ATX+ board). The power button is refused without a PSU and the 24-pin cable, as in the campaign.
- **Cooling**: the CPU's heat and throttle rules, the cooler mounts on the CPU, and the VRM heatsink and liquid-cooler rules.
- **VRM limits**: phases, amps and the crash and burn-out behaviour (`docs/VRM.md`). A board that burns out is dead until you buy a board of the same or a higher tier; the sandbox's `repairAll` can revive it instead.
- **Powered-off installs**: parts, cables, boards, storage and the OS change only while the machine is off (`power the machine off first`).
- **OS RAM minimum and drive needs**: an OS needs its minimum RAM in the plan and a drive to install on (`needs 32K of RAM`, `install a storage drive first`).
- **Keys**: one USB key is read at a boot, the tray holds `queueCap` (10) keys, and the OS queue has its own slots.

## What stays locked

- **Later OS tiers** (`os4`) are listed as "planned: not available yet" in every game. The sandbox does not unlock them.
- **Things that are not built** are not in the sandbox either (see `docs/TODO.md`).
- The monitor has one spec, so there is nothing to buy for it.

## Sandbox tools

Shown as the **SANDBOX** chip in the HUD bar. Each is a `ToSim` message and a `Game` method, refused with `sandbox mode only` outside a sandbox game (`NOT_SANDBOX`):

| Tool | What it does |
|---|---|
| `spawnKey(template, scale)` | Adds a key with a generator template (for example `cli`, `cli.log`, `cli.scan`) at scale 1 to 16 to the tray, or a job class id (`db`, `web`, `secure`, `gpu`, `npu`, `hpc`: the class sets template and scale and carries its needs, so it may be unrunnable). Refused when the tray is full. |
| `setLevel(level)` | Pins the rules level (patience, payout, demand, arrival mix) at 1 to 18; refused in a campaign (`sandbox mode only`). |
| `setJobClasses(off)` | Chooses which job classes arrive on their own: `off` lists the classes that stop (`cli`, `scan`, `db`, `web`, `secure`, `gpu`, `npu`, `hpc`; empty = all arrive). A class the pinned level has no share for never arrives anyway. With every class off nothing arrives; `spawnKey` still adds any. Not saved, like the pinned level. Shown as the "Arriving on their own" checkboxes in the tools popover. |
| `clearQueue()` | Throws away every key in the tray. The plugged key and the keys the OS holds stay. |
| `repairAll()` | Un-burns every part and the board, cools everything to ambient, clears a PSU trip. Works powered or not. |
| `setReputation(value)` | Sets reputation within the economy's range (0.4 to 4). The turnaround average is set to match, and it moves as usual afterwards. |

The store actions are `spawnKey`, `clearQueue`, `repairAll`, `setReputation`, `setJobClasses` and `setLevel` in `src/game/store.ts`.

## Speed

The speed segment in the HUD offers the campaign speeds (pause, then 0.25x, 0.5x, 1x, 2x, 3x; the sim's `Speed` values 1, 2, 4, 8, 12). A sandbox also has **64x**, toggled from the SANDBOX chip (`SANDBOX_SPEEDS`). `setSpeed(64)` is refused in a campaign game (`64x is for the sandbox only`).

The catch-up cap is `MAX_TICKS_PER_FRAME` = **128** base ticks per call, in every game (`host.ts`). The worker calls every 100 ms, so 64x needs about 6.4 ticks per call; the cap only matters after a throttled tab (128 ticks is 2 s of game time at 64x, about 10 ms of work).

### Measured: is 64x sustainable?

`npm run bench:speed` (not part of `npm test`, about 25 s) runs `src/sim/bench/speed.ts` through `tools/bench-speed.mjs`. It drives the worker's host loop (`advance` with the wall time since the last call, then a snapshot when something advanced) on a busy high-end sandbox build: the Enthusiast board, cpu2, ram2, the 250 W PSU, the liquid cooler, VRM fins with a fan, NVMe with `os1`, and a scale-16 scan job kept in the tray. The machine is powered and the OS is up. The OS runs a job about half the time; the rest is the bot's key waiting on the USB latency (enumerate, ingest, flash), which is real sim behaviour. Machine: AMD Ryzen 9 7900X (12 cores, 24 threads), Windows 11, Node 24 (V8), one thread. Other work was running on the same machine during the runs.

Two modes per speed. **Flat out**: back-to-back calls of 100 ms game time, which gives the cost of a tick and the ceiling. **Paced**: 8 s of real time with the worker's 100 ms timer, which gives the ticks delivered against the ticks owed.

| Speed | Flat out: ms per tick | Flat-out ceiling | Paced: ticks/s delivered (share of owed) | Worst paced call (ticks + snapshot) |
|---|---|---|---|---|
| 1x | 0.09 | about 12,000x | 0.99 (99.5%) | 1 ms |
| 4x | 0.07 | about 13,800x | 3.96 (99.1%) | 2 ms |
| 16x | 0.08 | about 13,000x | 15.94 (99.7%) | 16 ms |
| 64x | 0.09 | about 12,000x | 63.88 (99.8%) | 13 ms |

Over three runs the cost stayed at 0.06 to 0.09 ms per tick (the job-running and idle phases cost the same), the ceiling was 12,000 to 16,500x, and a snapshot cost about 0.4 ms and 13 KB.

**64x is sustainable on this machine, and the sim is not the limit.** At 64x the sim uses about 1% of one core (64 ticks at 0.085 ms, plus 10 snapshots at 0.46 ms, each second). The flat-out ceiling is about 190 times 64x, so a machine would have to be about 190 times slower to fall below it. Every paced run kept up, and the catch-up cap was never reached.

The practical limit at high speed is on the client, not in the sim: the main thread receives a 13 KB snapshot up to 10 times a second, then applies it and redraws the board, the pipeline and the monitor. That side is not measured by the bench.

## Saves

A sandbox game writes an optional top-level field `sandbox: true` (`Game.toSave`). A save without it loads as a campaign game, as before. `SAVE_VERSION` stays **4**: the field is optional and validated as a boolean (`parseSave`), so no migration is needed. Loading a sandbox save sets money back to `SANDBOX_MONEY`. See [`SAVE.md`](SAVE.md).

## Tests

`src/sim/game/sandbox.test.ts` covers the free and constant-money rules, the offers (any tier, replacement of a burnt board), the physics that still applies, the tools and their refusals outside a sandbox, the 64x refusal, the sandbox save field and the assembled and bare starts. `src/ui/tutorial/tutorial.test.ts` covers "a sandbox game has no tutorial and no offer". The speed benchmark is not a test and is not run by `npm test`: `npm run bench:speed`.
