# Economy and game loop

Code: `src/features/economy/sim` (import from `src/features/economy/sim`). No DOM imports; it runs inside the sim worker. **All numbers are placeholders** in one object, `ECONOMY` in `economy.ts`.

The assembly side (inventory, install, cables, power, phases, boot ROM, USB keys, progress flags) is in [`ASSEMBLY.md`](ASSEMBLY.md); this file covers the economy and the per-tick loop.

## API (`game.ts` and the feature files beside it)

```ts
const g = new Game({ seed, economy?: Partial<EconomyConfig>, preassembled?: boolean });
g.advanceBaseTick();            // one base tick = 1 s at 1x
g.purchase("cpu1");             // { ok: true, invId } | { ok: false, reason }: buys into the inventory
g.install(invId, slotId?);      // parts: only while the machine is off
g.powerButton(); g.plugKey(id); g.ejectKey();   // see ASSEMBLY.md
g.setCpuClock(1.5);             // overclock / underclock, range-checked
g.powerCycle();                 // clear a PSU hard trip and cold-reboot
g.snapshot();                   // plain JSON-serialisable object
```

Public fields for tests/tools: `money`, `baseTick`, `completed`, `errors`, `dropped`, `lastCompleted`, `board`, `cables`, `progress`, `powered`, `machine`, `thermal`, `pch`.

Per `advanceBaseTick`: key arrivals (two PRNG draws per tick) -> `machine.advanceBaseTick()` if powered and not halted (the ROM and the plugged key's job run on the CPU engine; the PCH registers drive the phase) -> `thermal.step` (powered or not) -> thermal error roll while the CPU is busy -> `syncRates`. Everything random comes from the machine PRNG, so a seed plus a player script is fully reproducible (`src/features/economy/sim/operator.ts` is such a script).

Starting machine: see ASSEMBLY.md (bare board and crate; the stock cooler is in the crate and mounts on the CPU). With `preassembled: true`: board tier 0 with `cpu0` (unpipelined), `ram0` (16K), `display0`, `cooler0` (stock), `psu0` (40 W), cables connected, powered on. The Machine's RAM is allocated at 64K regardless of the installed DIMM (RAM size is fixed at Machine construction); the installed RAM changes the size the PCH reports, the cache miss penalty (several sticks run at the slowest one) and which jobs arrive (`mix.minRamBytes`, an optional unlock; the starting mix has none).

## Jobs

A job is a key (see ASSEMBLY.md "Keys and the queue"). `startQueue` (default one `cli.log`) is the key in the tray at tick 0, the guided first job; afterwards a key arrives with probability `demandRate` per tick (once the machine has booted for the first time). Each is `generate(template, seed)` from `src/features/jobs/sim/gen`; its payout base `work` is the reference instruction count of the standalone program. The tray holds at most `queueCap` keys; an arrival into a full tray is dropped and costs reputation. Arrivals are job classes by level (below).

The job runs on the engine built at power-on (`applyEngine`, ROM image as the program). Parts cannot change while the machine is on, so "CPU upgrades only between requests" is now structural: install needs power off, and the next power-on builds a fresh engine with cold caches.

**Payout and reputation happen when the key is removed** (`ejectKey`): `payout = round((payBase + payPerInstr * work * payMul) * speed * (late ? lateFactor : 1) * levelPayMul)`, `speed = clamp(targetTurnaround / turnaround, speedMin, speedMax)`, `turnaround` = key arrival to key removal, `late` = past the soft deadline (`deadlineTicks` after arrival; still paid, at `lateFactor`). The flat `payBase` ($20) covers the boot that every job pays for. The speed bonus uses the plain `targetTurnaround` (60); the patience does not change the speed bonus. `payMul` is the job class's (scan 2, db 2, ...); `levelPayMul` is the level's. The removal also adds the client-base points (below).

**Reputation and demand**: `avgTurnaround` is an EMA (`emaAlpha`) of turnaround (arrival to removal, so waiting in the tray and the player's own slowness count), starting at the start target (`targetTurnaround * patienceMul(level)`, reputation 1); a key the client has to take back (tray full, or an unrunnable job at its deadline) feeds `giveUpTurnaround * patienceMul` into it, a declined job feeds `targetTurnaround * patienceMul` (one third). `reputation = clamp(targetTurnaround * patienceMul / max(avgTurnaround, age of the oldest waiting runnable key), repMin, repMax)`; `demandRate = baseDemandPerTick * demandMul(level) * reputation`. Jobs the machine cannot run are left out of the "oldest waiting" age: the player is punished once, at the expiry.

### Levels: patience, pay, demand and the job mix (built; design in [`PROGRESSION.md`](PROGRESSION.md))

The player has a **level** (1 to 18) derived from the **client base** score: every delivered job adds `clamp(reputation, 0.5, 2)` (`Game.clientBase`, `snapshot.level`); expired, dropped, declined and aborted jobs add nothing; the level never goes down. The whole table (names, thresholds, per-level multipliers, unlocks, arrival mix, job classes with their needs) is data in `src/features/economy/sim/levels.ts`; the code only reads it.

- **Patience** is the level's `patienceMul` (4 at levels 1 and 2, 3 at level 3, down to 0.5 at 18). It scales exactly what the old tick schedule scaled: the reputation target, the key deadline (fixed when the key arrives) and the give-up turnaround. `Snapshot.patience = {mul, targetTurnaround, deadlineTicks, sinceFirstBoot}` (`sinceFirstBoot` is informational now). The first-boot tick still marks when clients start arriving.
- **Payout** is the old formula times the level's `payMul` (`round(1.11^(level-1), 2)`), applied last; the speed bonus keeps the plain `targetTurnaround` 60.
- **Demand** is `baseDemandPerTick x demandMul(level) x reputation` (`demandMul = 1 + 0.12 (level-1)`).
- **Arrivals** pick a **job class** from the level's row of the mix table: `cli` (log, calc, checksum), `scan`, `db` (level 3), `web` (4), `secure` (9), `gpu` (10), `npu` (12), `hpc` (14). A class ramps in from 0 over its `rampTicks` after its first level (scan over 300 ticks from the start, the others 600), heavy classes (all but `cli` and `scan`) scale with `clamp(reputation, 0.5, 1.5)`. Levels 1 and 2 are the old one-in-three scan mix. `EconomyConfig.mix` is now only a test override (a fixed template mix; undefined by default).
- **Job needs**: a class carries `needs` (`os`, `storage` tier, `net`, `tpm`, `gpu`, `npu`, `cores`). `db` needs an OS and a SATA SSD or better (placeholder template: a heavy checksum). `web`, `secure`, `gpu`, `npu` and `hpc` are **placeholders**: their devices do not exist yet, so they arrive (once their level is reached, per the table) and can never be run; they borrow an existing template for the program. Every key shows `cls`, `needs` (chips), `runnable`, `missing` (long phrases), `expiresTick` and `declinable`. `plugKey` refuses a key the machine cannot run (`cannot run this job: it needs a GPU`), which with an OS is the refusal at ingest. `trayKeyIds()` lists only runnable keys (what a bot plugs).
- **Expiry**: an unrunnable key still in the tray at its deadline (`arrival + deadlineTicks x patienceMul`) is taken back: `expired` +1, `giveUpTurnaround x mul` into the average, no payout, no points, a log line (`expire`). Buying the missing device in time makes it runnable at once. Runnable keys are never taken back (they are just late).
- **Declining**: `declineKey(keyId)` (tray key, or a key the OS ingested that is still queued) and `declineJob(id)` (an OS queue row, by key id; the network phase adds offers) remove the job at once, add 1 to `declined`, feed `targetTurnaround x patienceMul` into the average (one third of an expiry; nothing in the sandbox), and pay nothing. Refusals: `plugged`, `running`, `result waiting`, `no waiting job N`.
- **Unlock gating**: `purchase` refuses an item whose unlock level is above the player's with `needs Level N (Name)` before looking at money or hardware; `snapshot.purchases[].locked = {level, name}` lists the locked ones (greyed tiles) and every purchasable id has a level in the unlock table. Installed parts and inventory are never touched by the level; `install` is not gated (it can only install what was bought). `EconomyConfig.levelGating` (default true) switches the gate off for tests that are about hardware; the sandbox never gates.
- **Snapshot**: `level` (`level, name, clientBase, floor, next, progress, patienceMul, payMul, demandMul, leveledUpAt, recentlyUnlocked, upcoming[], sandbox`), `expired`, `declined`, `postTicks`; a `level` log event on each level-up. `new Game({startLevel})` starts a campaign at a level (client base at its threshold).

Measured with the bots (placeholders): see "Pacing" below and PROGRESSION.md "Built".

Also fixed per boot and not shortened by a faster CPU: the **POST time** (cold-boot wait before the ROM runs): `22 + min(40, 0.25 x RAM KiB) + 2 x sticks + init ticks of the devices (cpu 1, display 1, hdd 4, SATA SSD 2, NVMe 1)`, capped at 90 (`EconomyConfig.coldBoot`, `postTicks()`); the Starter machine is exactly 30, so more RAM and drives lengthen it (cpu2, one 64K stick, NVMe, monitor: 43). `coldBootTicks` is an optional override (tests set 0). A no-OS machine pays it per job; an OS machine once. `Snapshot.postTicks` shows it.

### Patience history

Before levels the patience followed a schedule of base ticks since the first boot (4 until tick 900, linear down to 0.6 at tick 3000). The old numbers: with the mid-game rig of `patience.test.ts` the no-OS bot fell to reputation 0.5 late and the OS bot stayed at 0.8. Now the same comparison is made per level (the bot starts at level 3, 5 and 7 with and without the OS, `patience.test.ts`): reputation after tick 600, 3000 s, 4 seeds: no OS 0.67 / 0.66 / 0.59, OS 0.92 / 0.89 / 0.80, with 50 / 41 / 40 versus 73 / 68 / 66 jobs. Honest caveat from before still holds: OS v1 is not faster per job than a fast CPU's manual cycle, it wins by skipping the cold boot and the power cycle.

### Crashes

**Thermal errors**: while the machine is busy, `thermal.errorRoll(cpu)` can fire (only when the CPU is above its unstable temperature), and so can `thermal.vrmErrorRoll()` (only while the board VRM is overloaded or hot; reason "VRM voltage droop", see [`VRM.md`](VRM.md)). Both take the same path below. A burnt VRM leaves the board dead (phase `error`, "board dead: replace the board"). The machine crashes and cold-reboots, the plugged key's job restarts from the ROM (the key is still in the port, so the ROM's one look finds it), `errors` and the key's `attempts` increment. A burnt CPU, a burnt PSU or a tripped PSU leaves the machine in phase `error` until the player powers off and repairs it.

## Purchases

Items are device spec ids: CPU `cpu1`, `cpu2`; RAM `ram1`, `ram2`; cooler `cooler1`, `cooler2`; PSU `psu1`, `psu2` (needs the ATX+ board in the plan, so it shows as blocked until `board1` is owned), the VRM heatsinks `vsink0`..`vsink2`, and the boards `board1` (Basic, $150), `board2` (Mainstream, $300), `board3` (Enthusiast, $700): only the next tier is offered, and a board is bought **only while powered off**. While the board is burnt the same tier is also offered as a replacement. `offers()` in `economy.ts` lists devices plus the next board tier for a board. **`purchase` validates against the "plan"**: the installed board with every better inventory item applied (`plannedBoard()` in `game.ts`), so you can buy `psu1` and then `cpu2` before installing either, and you are not offered what you already own. Only higher tiers are offered, plus a same-tier replacement of a burnt part. The bought item goes to the inventory (`inventory` in the snapshot); installing it is a separate action (`install`), swapping over the old part, which returns to the inventory. A board (`upgradeBoard` in `src/features/board/sim`) carries every installed device over with the same instance ids, clocks and burnt flags (cables stay connected, a plain ATX PSU moves to the ATX+ connector on Mainstream and up); `board2` is what unlocks `psu2` (250 W) and the M.2 slot. The tier ladder is in [`VRM.md`](VRM.md). The clock setting is free via `setCpuClock`; a new part starts at its base clock. Example refusal: `cpu2` needs 41 W of rated load, so a bigger PSU must be in the plan first.

### Selling

A spare in the inventory can be sold (`sell(invId)`, message `sell`): the player gets `SELL_RATE` (80%) of its list price, rounded down, so 20% is lost (`sellValue` in `economy.ts`; `InventorySnap.sellPrice`). The starter crate's free parts count as the $10 spare floor (they sell for $8), the same price the shop asks for them. Only inventory items: an installed part must be uninstalled first. The part a queued swap is waiting to fit is refused. The sandbox has no money, so selling is refused there. In the UI: select a tile, press its Sell button.

## The power bill

Code: `src/features/economy/sim/bill.ts` (`billTick`, called first in `advanceBaseTick`); UI: `src/features/economy/ui/progress/PowerBill.tsx`, `billChip` in `src/core/ui/logic.ts`. Owner decisions (T127): a **flat rate**, **periodic and auto-paid**, an unpaid bill **cuts the wall**, the HUD shows **a line plus a detail popover**.

- **Rate**: `EconomyConfig.powerRatePerWh` dollars per Wh of `Snapshot.energy.wh` (one game tick counts as one second, so the rate is a game-scale placeholder: `CAMPAIGN_POWER_RATE` 0.15, about $2 for a 54 W machine per period). The default is **0 = no bill**, which keeps the tests and bots as they were; `host.ts` gives a new or loaded campaign the rate. The sandbox never has a bill.
- **Issue**: the clock starts at the first tick after the first power-on; every `billPeriodTicks` (600 = 10 game minutes) the energy since the last bill becomes a bill of `ceil(Wh x rate)` whole dollars (nothing if the machine drew nothing).
- **Payment**: by itself, every tick, as soon as `money >= unpaid` (no button). A bill the money cannot cover stays as `unpaid` and the next bills add to it.
- **Unpaid**: `billGraceTicks` (120) after the first unpaid bill the wall is cut (`powerCut`): a powered machine is hard-powered-off (like the power button), and the power button refuses with the reason (`Snapshot.noPowerReason`). The moment the money covers the debt it is paid and the wall comes back; the machine stays off until the player presses power. **Known risk**: a cut machine earns nothing, so a player at $0 can only recover by selling spares (`sell`); the balance of rate and grace is a placeholder to tune.
- **Snapshot**: `bill` (`BillSnap`: rate, period, `nextTick`, `accruedWh` / `accruedCost` since the last bill, `unpaid`, `cutTick`, `cut`, `last`, `paidTotal`), null when there is no bill. Log events of kind `bill`.
- **HUD**: a chip beside reputation: `$cost mm:ss` (running cost and time to the next bill), amber `$N due, cut in ...` while unpaid, red `CUT $N` when cut; click for the popover (rate, draw now, Wh and cost since the last bill, next and last bill, total paid).
- **Save**: the optional `bill` block (`SavedBill` in `save.ts`, additive, no version bump) carries the meter (`wh`), the billed energy, the due tick, the unpaid amount and since when, the cut flag, the total paid and the last bill. A save without it starts a fresh meter and a new clock.

## Sandbox

`new Game({ sandbox: true })` is the same game with the money and the tutorial changed: money is the constant `SANDBOX_MONEY` (1e9, shown as infinity), every purchase is free, every part and board tier can be bought directly, and five tools (spawn a key, clear the tray, repair everything, set reputation, set the rules level) work. Levels are ignored for unlocks and the rules level is pinned at 8. The physics, the power-off rule and the later OS tiers are unchanged. Speed 64x is allowed only here. Full list, starts and saves: [`SANDBOX.md`](SANDBOX.md).

## Storage and the OS

Storage drives and OS tiers are purchasable items too (`hdd0`, `ssd1`, `nvme2`, `os1`, `os2`, `os3`; `os4` is a locked "later" entry). They are not "one per machine" upgrades: `purchase` validates a drive against the free slots of its type in the plan (installed plus inventory, including a `board1` in the inventory for the M.2 slot) and an OS against owning a drive and enough planned RAM. With an OS installed jobs are ingested from keys into a queue and the machine does not reboot between jobs; payout and reputation happen when the flashed key is removed (the same `payout()` formula, turnaround = arrival to that removal), and keys the OS holds count toward the "oldest waiting" age that drives reputation. Everything is in [`OS.md`](OS.md). New `EconomyConfig` fields: `usbEnumTicks` 3, `usbFlashTicks` 2 (USB latency under an OS; 0 without).

## The network (summary; full text in [`NETWORK.md`](NETWORK.md) "Built")

`Game` has a second work source, `NetworkSource` (`src/features/network/sim/source.ts`), the offer list behind the same `WorkSource` interface. Once the link has been up (`networkLinked`, sticky, saved) arrivals become offers and the tray stops (`usbFallbackTicks` 300, `usbFallbackMul` 1/3 bring keys back after a long dead link). The OS downloads an offer in the background (`jobSizes`, `bandwidth()`), spools it on the drive, runs it as ever and uploads the result; payout, reputation and client base apply at **delivery** (upload end). New calls: `connectCable("lan", port?)` (also while powered), `uninstall("router")`, `install(routerInvId, "router")`, `purchase` of `nic1..3` / `router1..4` / `isp1..5` (a plan applies at once). `declineKey` accepts offers and spooled jobs not started. Snapshot: `net` (see NETWORK.md), `os.spool`, `os.queue[].persisted`, key stages `offer | downloading | spooled | uploading`. A second memory stick of the best tier is offered while a DIMM slot is free.

## Snapshot (`Snapshot`)

Assembly and key fields are listed in ASSEMBLY.md. The economy fields: `money, cycle` (total CPU cycles), `baseTick, queueLength` (keys in the tray), `queueCap, request` (the plugged key's job: `{id, template, arrivalTick, deadlineTick, payoutEstimate, engineCycle, attempts}` or null), `boardTier`, `board` (tier name, burnt, features, slots, VRM state, heatsink: see VRM.md), `pipe` (pipeline stages while powered), `display` (the monitor text), `counters` (engine view counters by name since power-on), `completed, errors, dropped, lastCompleted` (`{id, template, payout, turnaround, execTicks, late, attempts, completedAt}`; `execTicks` = plug to result, `completedAt` = removal tick), `avgTurnaround, reputation, demandRate`, `devices[]` (installed parts), `power` (`totalW, budgetW, psuFactor, off, tripped`), `cpuClock` (`{value, min, max}`), `purchases[]` (`id, name, kind, price, affordable, blocked?, locked?: {level, name}`), `energy` (`wallW, wh`) and `bill` (see "The power bill").

## Pacing: the "1 tick = 1 second" caveat

The CPU domain runs `cpuCyclesPerClock` = **36** engine cycles per spec clock unit per base tick (`syncRates`; the display domain too). The starting CPU therefore does 36 cycles/s, `cpu1` (clock 2) 72, `cpu2` (clock 3) 108. The world clock is unchanged (1 base tick = 1 s at 1x). It was 4 when a job was a 22-instruction program; now every job also pays for the boot ROM (about 320 instructions for a small job, 5 cycles each on the unpipelined CPU), so the factor was raised until the first complete job (power-on, POST, plug, load, run, write, remove) takes 45-48 s.

Measured at 1x on the starting machine (`game.test.ts`, 30 seeds, bot with 2 s reaction per manual step): power-on to the first payout **45-48 s**, first payout **$49-50** (a `cli.log` job: `payBase` 20 + 1.2 x ~24 instructions, speed ~1.1), cheapest part ($50 cooler) affordable right after, `ram1` ($100) at 105-323 s (median ~165 s) in a no-spend run, `cpu1` ($200) a few minutes later. Plugging the key to its result: `cli.log` 35 s, `cli.scan` (scale 4) 182 s.

## CPU vs RAM

The starting traffic (levels 1 and 2, `LEVELS[0].mix`) is `cli` (log/calc/checksum, 67%) and `cli.scan` scale 4 (33%, one key in three once fully ramped in, `payMul` 2 because it is heavier work per key). **Onboarding ramp:** scan has `rampTicks: 300`, its weight rises linearly from 0 over the first 300 ticks (`jobMix` takes the tick), so the early game is mostly quick `cli` jobs. Scan walks a RAM table with a 64 or 128 byte stride, so **every load misses** the data cache: its time is mostly RAM latency. Log/calc/checksum have no cacheable loads, so RAM does nothing for them. The boot ROM touches no RAM through the cache (its copies are device loads and write-through stores), so boot time is pure CPU.

RAM specs: `ram0` latency 200 (RAM ticks; doubled from 100 when the boot made jobs CPU-heavier, so RAM stays a real choice), `ram1` 12 at twice the RAM clock, `ram2` 4. The miss penalty is `ceil(latency * cpuClock / ramClock)`: a fast CPU on slow RAM waits twice as many cycles per miss (`cpu1` on `ram0`: 400 cycles), so a faster CPU alone barely helps scan.

Measured time from plugging the key to its result (seconds, nothing else running):

| job | base | +cpu1 | +ram1 | +cpu1+ram1 |
|---|---|---|---|---|
| `cli.log` | 35 | 7 | 35 | 7 |
| `cli.scan` scale 4 | 182 | 105 | 95 | 19 |

CPU is the big win for log (and shortens the boot of every job), RAM is the big win for scan, and scan needs both to really fly. Which first purchase pays more over time depends on the mix (`tradeoff.test.ts`, 800 ticks, mean of 6 seeds, bot player with 2 s reaction per manual step, income = money earned including what was spent on the two parts; first purchase bought as soon as affordable, installed by the bot with a power cycle, then the other):

| mix | nothing | cpu1 only | ram1 only | cpu1 then ram1 | ram1 then cpu1 |
|---|---|---|---|---|---|
| log only | $451 | $1693 | $469 | $1724 | $1241 |
| starting (33% scan, ramped in) | $442 | $780 | $720 | $3261 | $3105 |
| scan heavy (80% scan, no ramp) | $471 | $743 | $811 | $2458 | $3683 |

Log-heavy traffic: CPU first by a wide margin. Starting mix: no dominant choice (the two orders within about 5%, the single parts within about 8%; the test asserts a 0.65 to 1.5 band). Scan-heavy: RAM first. Balance numbers (`payMul`, scan scale, RAM latencies and prices) are placeholders.

## Overclock and heat

`setCpuClock` raises throughput until the stock cooler cannot keep up: on `cpu2` + `psu1` + stock cooler, clock 3 (base) settles ~75 C with light throttling and is the best performer; clock 4.5 runs hot, makes errors (each one reboots the machine and restarts the job) and burns the CPU within about 100 ticks, after which the machine sits in phase `error` until the player powers off and swaps the CPU (tested). The throttle only trims 20%, so the machine can settle at the unstable edge on a moderate overclock and errors are then rare; the idle phases (the cold-boot wait, halted) cool the CPU, so heat is less severe than when it was always busy; the thermal tests set `coldBootTicks: 0` to keep the CPU busy.
