# Economy and game loop

Code: `src/sim/game` (import from `src/sim/game`). No DOM imports; it runs inside the sim worker. **All numbers are placeholders** in one object, `ECONOMY` in `economy.ts`.

The assembly side (inventory, install, cables, power, phases, boot ROM, USB keys, progress flags) is in [`ASSEMBLY.md`](ASSEMBLY.md); this file covers the economy and the per-tick loop.

## API (`game.ts`)

```ts
const g = new Game({ seed, economy?: Partial<EconomyConfig>, preassembled?: boolean });
g.advanceBaseTick();            // one base tick = 1 s at 1x
g.purchase("cpu1");             // { ok: true, invId } | { ok: false, reason }: buys into the inventory
g.install(invId, slotId?);      // parts: only while the machine is off
g.powerButton(); g.plugKey(id); g.ejectKey();   // see ASSEMBLY.md
g.setCpuClock(1.5);             // overclock / underclock, range-checked
g.powerCycle();                 // clear a PSU hard trip and reboot
g.snapshot();                   // plain JSON-serialisable object
```

Public fields for tests/tools: `money`, `baseTick`, `completed`, `errors`, `dropped`, `lastCompleted`, `board`, `cables`, `progress`, `powered`, `machine`, `thermal`, `pch`.

Per `advanceBaseTick`: key arrivals (two PRNG draws per tick) -> `machine.advanceBaseTick()` if powered and not halted (the ROM and the plugged key's job run on the CPU engine; the PCH registers drive the phase) -> `thermal.step` (powered or not) -> thermal error roll while the CPU is busy -> `syncRates`. Everything random comes from the machine PRNG, so a seed plus a player script is fully reproducible (`src/sim/game/operator.ts` is such a script).

Starting machine: see ASSEMBLY.md (bare board and crate). With `preassembled: true`: board tier 0 with `cpu0` (unpipelined), `ram0` (16K), `display0`, `cooler0` (stock), `psu0` (40 W), cables connected, powered on. The Machine's RAM is allocated at 64K regardless of the installed DIMM (RAM size is fixed at Machine construction); the installed RAM changes the size the PCH reports, the cache miss penalty (several sticks run at the slowest one) and which jobs arrive (`mix.minRamBytes`, an optional unlock; the starting mix has none).

## Jobs

A job is a key (see ASSEMBLY.md "Keys and the queue"). `startQueue` (default one `cli.log`) is the key in the tray at tick 0, the guided first job; afterwards a key arrives with probability `demandRate` per tick (once the machine has booted for the first time). Each is `generate(template, seed)` from `src/sim/gen`; its payout base `work` is the reference instruction count of the standalone program. The tray holds at most `queueCap` keys; an arrival into a full tray is dropped and costs reputation.

The job runs on the engine built at power-on (`applyEngine`, ROM image as the program). Parts cannot change while the machine is on, so "CPU upgrades only between requests" is now structural: install needs power off, and the next power-on builds a fresh engine with cold caches.

**Payout and reputation happen when the key is removed** (`ejectKey`): `payout = round((payBase + payPerInstr * work * payMul) * speed * (late ? lateFactor : 1))`, `speed = clamp(targetTurnaround / turnaround, speedMin, speedMax)`, `turnaround` = key arrival to key removal, `late` = past the soft deadline (`deadlineTicks` after arrival; still paid, at `lateFactor`). The flat `payBase` ($20) covers the boot that every job pays for.

**Reputation and demand**: `avgTurnaround` is an EMA (`emaAlpha`) of turnaround (arrival to removal, so waiting in the tray and the player's own slowness count), starting at the target; a key the client has to take back (tray full) feeds `giveUpTurnaround` into it. `reputation = clamp(targetTurnaround / max(avgTurnaround, age of the oldest waiting key), repMin, repMax)`; `demandRate = baseDemandPerTick * reputation`.

**Thermal errors**: while the machine is busy, `thermal.errorRoll(cpu)` can fire (only when the CPU is above its unstable temperature), and so can `thermal.vrmErrorRoll()` (only while the board VRM is overloaded or hot; reason "VRM voltage droop", see [`VRM.md`](VRM.md)). Both take the same path below. A burnt VRM leaves the board dead (phase `error`, "board dead: replace the board"). The machine crashes and cold-reboots, the plugged key's job restarts from the ROM, `errors` and the key's `attempts` increment. A burnt CPU, a burnt PSU or a tripped PSU leaves the machine in phase `error` until the player powers off and repairs it.

## Purchases

Items are device spec ids: CPU `cpu1`, `cpu2`; RAM `ram1`, `ram2`; cooler `cooler1`, `cooler2`; PSU `psu1`, `psu2` (needs the ATX+ board in the plan, so it shows as blocked until `board1` is owned), the VRM heatsinks `vsink0`..`vsink2`, and the boards `board1` (Basic, $150), `board2` (Mainstream, $300), `board3` (Enthusiast, $700): only the next tier is offered, and a board is bought **only while powered off**. While the board is burnt the same tier is also offered as a replacement. `offers()` in `economy.ts` lists devices plus the next board tier for a board. **`purchase` validates against the "plan"**: the installed board with every better inventory item applied (`plannedBoard()` in `game.ts`), so you can buy `psu1` and then `cpu2` before installing either, and you are not offered what you already own. Only higher tiers are offered, plus a same-tier replacement of a burnt part. The bought item goes to the inventory (`inventory` in the snapshot); installing it is a separate action (`install`), swapping over the old part, which returns to the inventory. A board (`upgradeBoard` in `src/sim/board`) carries every installed device over with the same instance ids, clocks and burnt flags (cables stay connected, a plain ATX PSU moves to the ATX+ connector on Mainstream and up); `board2` is what unlocks `psu2` (250 W) and the M.2 slot. The tier ladder is in [`VRM.md`](VRM.md). The clock setting is free via `setCpuClock`; a new part starts at its base clock. Example refusal: `cpu2` needs 41 W of rated load, so a bigger PSU must be in the plan first.

## Storage and the OS

Storage drives and OS tiers are purchasable items too (`hdd0`, `ssd1`, `nvme2`, `os1`; `os2`/`os3` are locked "later" entries). They are not "one per machine" upgrades: `purchase` validates a drive against the free slots of its type in the plan (installed plus inventory, including a `board1` in the inventory for the M.2 slot) and an OS against owning a drive and enough planned RAM. With an OS installed jobs are ingested from keys into a queue and the machine does not reboot between jobs; payout and reputation happen when the flashed key is removed (the same `payout()` formula, turnaround = arrival to that removal), and keys the OS holds count toward the "oldest waiting" age that drives reputation. Everything is in [`OS.md`](OS.md). New `EconomyConfig` fields: `usbEnumTicks` 3, `usbFlashTicks` 2 (USB latency under an OS; 0 without).

## Snapshot (`Snapshot`)

Assembly and key fields are listed in ASSEMBLY.md. The economy fields: `money, cycle` (total CPU cycles), `baseTick, queueLength` (keys in the tray), `queueCap, request` (the plugged key's job: `{id, template, arrivalTick, deadlineTick, payoutEstimate, engineCycle, attempts}` or null), `boardTier`, `board` (tier name, burnt, features, slots, VRM state, heatsink: see VRM.md), `pipe` (pipeline stages while powered), `display` (the monitor text), `counters` (engine view counters by name since power-on), `completed, errors, dropped, lastCompleted` (`{id, template, payout, turnaround, execTicks, late, attempts, completedAt}`; `execTicks` = plug to result, `completedAt` = removal tick), `avgTurnaround, reputation, demandRate`, `devices[]` (installed parts), `power` (`totalW, budgetW, psuFactor, off, tripped`), `cpuClock` (`{value, min, max}`), `purchases[]` (`id, name, kind, price, affordable, blocked?`).

## Pacing: the "1 tick = 1 second" caveat

The CPU domain runs `cpuCyclesPerClock` = **36** engine cycles per spec clock unit per base tick (`syncRates`; the display domain too). The starting CPU therefore does 36 cycles/s, `cpu1` (clock 2) 72, `cpu2` (clock 3) 108. The world clock is unchanged (1 base tick = 1 s at 1x). It was 4 when a job was a 22-instruction program; now every job also pays for the boot ROM (about 320 instructions for a small job, 5 cycles each on the unpipelined CPU), so the factor was raised until the first complete job (power-on, POST, plug, load, run, write, remove) takes 45-48 s.

Measured at 1x on the starting machine (`game.test.ts`, 30 seeds, bot with 2 s reaction per manual step): power-on to the first payout **45-48 s**, first payout **$49-50** (a `cli.log` job: `payBase` 20 + 1.2 x ~24 instructions, speed ~1.1), cheapest part ($50 cooler) affordable right after, `ram1` ($100) at 105-323 s (median ~165 s) in a no-spend run, `cpu1` ($200) a few minutes later. Plugging the key to its result: `cli.log` 35 s, `cli.scan` (scale 4) 182 s.

## CPU vs RAM

The starting traffic is a mix (`ECONOMY.mix`): `cli` (log/calc/checksum, weight 1) and `cli.scan` scale 4 (weight 0.5, so one key in three once fully ramped in, `payMul` 2 because it is heavier work per key). **Onboarding ramp:** scan has `rampTicks: 300`, its weight rises linearly from 0 to 0.5 over the first 300 ticks (`pickTemplate` takes the tick), so the early game is mostly quick `cli` jobs. Scan walks a RAM table with a 64 or 128 byte stride, so **every load misses** the data cache: its time is mostly RAM latency. Log/calc/checksum have no cacheable loads, so RAM does nothing for them. The boot ROM touches no RAM through the cache (its copies are device loads and write-through stores), so boot time is pure CPU.

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

`setCpuClock` raises throughput until the stock cooler cannot keep up: on `cpu2` + `psu1` + stock cooler, clock 3 (base) settles ~75 C with light throttling and is the best performer; clock 4.5 runs hot, makes errors (each one reboots the machine and restarts the job) and burns the CPU within about 100 ticks, after which the machine sits in phase `error` until the player powers off and swaps the CPU (tested). The throttle only trims 20%, so the machine can settle at the unstable edge on a moderate overclock and errors are then rare; the idle phases (waiting for a key, REMOVE KEY) cool the CPU, so heat is less severe than when it was always busy.
